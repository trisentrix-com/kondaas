import { withDatabase, Binary, ObjectId, getSystemKeys } from '../utils/config.js';
import { generatePDF } from '../utils/pdfGenerator.js';
import { uploadToR2 } from '../utils/s3Upload.js';
import { getInvoiceTemplate } from '../templates/invoiceTemplate.js';
import path from 'path';
import fs from 'fs';

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
      // contentString contains the Cloud URL for PDFs
      const contentString = notification.content.buffer.toString('utf8');

      let action = (type === "text") ? "sendText/narayanan" : "sendMedia/narayanan";
      let payload = { number: formattedNumber };

      if (type === "text") {
        payload.text = contentString;
      } else {
        payload = {
          ...payload,
          mediatype: "document",
          media: contentString, 
          fileName: "Kondaas_Invoice.pdf", 
          // FIX: Prioritize notification.caption from the DB!
          caption: notification.caption || "Thank you for choosing Kondaas!" 
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
        // Log the error body to see why the API rejected it (helps with 500 errors)
        const errorData = await response.text();
        throw new Error(`API Error ${response.status}: ${errorData}`);
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
      // --- STEP 1: VERIFY EXISTENCE IN LEADS ---
      const lead = await db.collection("lead").findOne({ mobile: customerMobile });
      if (!lead) return c.json({ error: "Lead not found in leads collection" }, 404);

      const customerName = lead.name || "Customer";
      const whatsappTo = lead.whatsappNo || lead.mobile;
      
      const messages = {
        1: `Hello ${customerName}, your Kondaas technician has started. Arrival in ${eta || 'soon'} min. Contact: ${surveyorNumber}.`,
        2: `Hello ${customerName}, your technician is just 300 meters away!`,
        3: `Hello ${customerName}, your technician has arrived.`,
        4: `Hello ${customerName}, your technician has completed the work. Thank you for choosing Kondaas!`
      };

      // --- STEP 2: ALWAYS SEND THE TEXT MESSAGE FIRST ---
      const textResult = await db.collection("notifications").insertOne({
        from: "Kondaas_System",
        to: whatsappTo,
        mode: "whatsapp",
        content: new Binary(Buffer.from(messages[scenarioType], 'utf8')),
        contentType: "text",
        status: "pending",
        createdAt: new Date()
      });

      processWhatsAppNotification(textResult.insertedId).catch(err => console.error(err));

      // --- STEP 3: IF SCENARIO 4, FETCH FORM DATA & GENERATE PDF ---
      if (scenarioType === 4) {
        (async () => {
          try {
            console.log("📄 Heavy Work: Fetching Form Data & Generating PDF...");
            
            // Fetch technical data from FORMS collection specifically for the PDF
            const formData = await db.collection("forms").findOne({ mobileNumber: customerMobile });
            
            if (!formData) {
              console.error("❌ PDF Cancelled: No entry found in 'forms' collection for this mobile.");
              return;
            }

            const shortId = Math.random().toString(36).substring(7);
            const fileName = `Inv_${shortId}.pdf`; 
            const filePath = path.join(process.cwd(), fileName);
            
            // Add invoice details to the formData object for the template
            formData.invoiceNo = `INV-${shortId.toUpperCase()}`;
            formData.invoiceDate = new Date().toLocaleDateString('en-IN');

            // Pass the rich FORM data to the template
            const html = getInvoiceTemplate(formData); 
            await generatePDF(html, filePath);
            
            await uploadToR2(filePath, fileName);

            fs.unlink(filePath, (err) => {
              if (err) console.error("❌ Error deleting local PDF:", err.message);
              else console.log(`🗑️ Successfully cleaned up local file: ${fileName}`);
            });

            const publicBaseUrl = "https://pub-779720c6e2884996a1a81145da8c5bea.r2.dev";
            const finalPublicUrl = `${publicBaseUrl}/${fileName}`;

            const pdfResult = await db.collection("notifications").insertOne({
              from: "Kondaas_System",
              to: whatsappTo,
              mode: "whatsapp",
              content: new Binary(Buffer.from(finalPublicUrl.trim(), 'utf8')),
              contentType: "pdf",
              caption: "Here is your formal invoice. Thank you!",
              status: "pending",
              createdAt: new Date()
            });

            processWhatsAppNotification(pdfResult.insertedId).catch(err => console.error(err));
          } catch (pdfErr) {
            console.error("❌ Background PDF Work Failed:", pdfErr);
          }
        })();
      }

      return c.json({ 
        message: `Scenario ${scenarioType} message sent. PDF processing in background.`, 
        id: textResult.insertedId 
      });
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