import { withDatabase, Binary, ObjectId, getSystemKeys } from '../utils/config.js';
import { generatePDF } from '../utils/pdfGenerator.js';
import { uploadToR2 } from '../utils/s3Upload.js';
import { getInvoiceTemplate } from '../templates/invoiceTemplate.js';
import path from 'path';

const MONGODB_URI = process.env.MONGODB_URI;

/**
 * --- THE WORKER ---
 * Handles the actual WhatsApp API call in the background.
 */
const processWhatsAppNotification = async (notificationId) => {
  try {
    await withDatabase(MONGODB_URI, async (db) => {
      const keys = await getSystemKeys(db);
      const { apiUrl: BASE_URL, apiKey: API_KEY } = keys.whatsapp;

      const notification = await db.collection("notifications").findOneAndUpdate(
        { _id: notificationId, status: "pending" },
        { $set: { status: "processing", startedAt: new Date() } },
        { returnDocument: 'after' }
      );

      if (!notification) return;

      const type = notification.contentType;
      const formattedNumber = `91${notification.to}`;
      const contentString = notification.content.buffer.toString('utf8');

      let action = (type === "text") ? "sendText/narayanan" : "sendMedia/narayanan";
      let payload = { number: formattedNumber };

      if (type === "text") {
        payload.text = contentString;
      } else {
        // For Scenario 4, the contentString is the Cloud URL.
        // The caption is pulled from the notification record if you store it, 
        // or we use a standard one here.
        payload = {
          ...payload,
          mediatype: "document",
          media: contentString, 
          fileName: "Kondaas_Invoice.pdf", 
          caption: notification.caption || "Your technician has completed the work. Thank you for choosing Kondaas!" 
        };
      }

      const response = await fetch(`${BASE_URL}${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "apikey": API_KEY },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        await db.collection("notifications").updateOne(
          { _id: notificationId },
          { $set: { status: "completed", completedAt: new Date() } }
        );
        console.log(`✅ WhatsApp sent to ${formattedNumber}`);
      } else {
        throw new Error(`API Error ${response.status}`);
      }
    });
  } catch (err) {
    console.error("❌ WhatsApp Task Failed:", err.message);
    await withDatabase(MONGODB_URI, async (db) => {
      await db.collection("notifications").updateOne(
        { _id: notificationId },
        { $set: { status: "failed" }, $inc: { retryCount: 1 } }
      );
    });
  }
};

/**
 * --- THE BRIDGE ---
 * Automated Scenario logic with PDF generation for Scenario 4.
 */
export const triggerScenarioNotification = async (c) => {
  try {
    const { surveyorNumber, customerMobile, scenarioType, eta } = await c.req.json();

    return await withDatabase(MONGODB_URI, async (db) => {
      const lead = await db.collection("lead").findOne({ mobile: customerMobile });
      if (!lead) return c.json({ error: "Lead not found" }, 404);

      const customerName = lead.name || "Customer";
      const whatsappTo = lead.whatsappNo || lead.mobile;
      
      const messages = {
        1: `Hello ${customerName}, your Kondaas technician has started. Arrival in ${eta || 'soon'} min. Contact: ${surveyorNumber}.`,
        2: `Hello ${customerName}, your technician is just 300 meters away!`,
        3: `Hello ${customerName}, your technician has arrived.`,
        4: `Hello ${customerName}, your technician has completed the work. Thank you for choosing Kondaas!`
      };

      let finalContent = messages[scenarioType] || "";
      let contentType = "text";
      let notificationCaption = "";

      // --- PDF GENERATION LOGIC FOR SCENARIO 4 ---
      if (scenarioType === 4) {
        try {
          console.log("📄 Scenario 4: Generating PDF...");
          
          const shortId = Math.random().toString(36).substring(7);
          const fileName = `Inv_${shortId}.pdf`; 
          const filePath = path.join(process.cwd(), fileName);
          
          lead.invoiceNo = `INV-${shortId.toUpperCase()}`;
          lead.invoiceDate = new Date().toLocaleDateString('en-IN');

          const html = getInvoiceTemplate(lead); 
          await generatePDF(html, filePath);
          
          const cloudUrl = await uploadToR2(filePath, fileName);
          
          finalContent = String(cloudUrl).trim(); 
          contentType = "pdf"; 
          // We store the message as a caption so the worker can send it with the file
          notificationCaption = messages[4];
          
          console.log(`🔗 PDF URL Generated: ${finalContent}`);
        } catch (pdfErr) {
          console.error("PDF Flow failed, falling back to text:", pdfErr);
          finalContent = messages[4];
          contentType = "text";
        }
      }

      const result = await db.collection("notifications").insertOne({
        from: "Kondaas_System",
        to: whatsappTo,
        mode: "whatsapp",
        content: new Binary(Buffer.from(finalContent, 'utf8')),
        contentType: contentType,
        caption: notificationCaption, // Pass the text message here
        status: "pending",
        createdAt: new Date()
      });

      processWhatsAppNotification(result.insertedId).catch(err => console.error(err));

      return c.json({ message: `Scenario ${scenarioType} processed`, id: result.insertedId });
    });
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
};

/**
 * --- MANUAL ENDPOINTS ---
 */
export const addNotification = async (c) => {
  try {
    const body = await c.req.json();
    const { to, mode, content, contentType } = body;

    if (!to || !mode || !content || !contentType) {
      return c.json({ error: "Missing required fields" }, 400);
    }

    const contentBinary = new Binary(Buffer.from(content, 'utf8'));

    const notificationId = await withDatabase(MONGODB_URI, async (db) => {
      const result = await db.collection("notifications").insertOne({
        ...body,
        content: contentBinary,
        status: "pending",
        createdAt: new Date()
      });
      return result.insertedId;
    });

    if (mode === "whatsapp") {
      processWhatsAppNotification(notificationId).catch(err =>
        console.error("Background WhatsApp Error:", err)
      );
    }

    return c.json({ message: "Notification queued", id: notificationId }, 201);
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
};

export const updateNotification = async (c) => {
  try {
    const { id, status, retryCount } = await c.req.json();
    if (!id) return c.json({ error: "id is required!" }, 400);

    const updateResult = await withDatabase(MONGODB_URI, async (db) => {
      return await db.collection("notifications").updateOne(
        { _id: new ObjectId(id) },
        { $set: { status, retryCount, updatedAt: new Date() } }
      );
    });

    if (updateResult.matchedCount === 0) return c.json({ error: "Not found" }, 404);
    return c.json({ message: "Updated successfully" });
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
};