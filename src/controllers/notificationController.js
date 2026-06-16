import { withDatabase, Binary, ObjectId, getSystemKeys } from '../utils/config.js';
import { generatePDF } from '../utils/pdfGenerator.js';
import { uploadToZohoWorkDrive,uploadSurveyorPhoto } from '../utils/uploadToZohoWorkDrive.js';
import { getInvoiceTemplate } from '../templates/invoiceTemplate.js';
import path from 'path';
import fs from 'fs';

const MONGODB_URI = process.env.MONGODB_URI;

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
    // 📥 STEP 1 & 3: Extract deal_id alongside the standard notification body
    const { deal_id, surveyorNumber, customerMobile, name, scenarioType, eta, mapsUrl } = await c.req.json();
    
    return await withDatabase(MONGODB_URI, async (db) => {

      const customerName = name;
      const whatsappTo = customerMobile;
      
      const messages = {
        1: `Hello ${customerName}, your Kondaas technician has started. Arrival in ${eta || 'soon'} min. Contact: ${surveyorNumber}.${mapsUrl ? `\n\n📍 Track Location: ${mapsUrl}` : ''}`,
        2: `Hello ${customerName}, your technician is just 300 meters away!`,
        3: `Hello ${customerName}, your technician has arrived.`,
        4: `Hello ${customerName}, your technician has completed the work. Thank you for choosing Kondaas! and kindly give rating.`
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

      // --- STEP 3: IF SCENARIO 4, FETCH FORM DATA & GENERATE PDF FOR ZOHO WORKDRIVE ---
      if (scenarioType === 4) {
        (async () => {
          try {
            console.log("📄 Heavy Background Process: Generating Invoice PDF for Zoho Workspace...");
            
            // Validation: Make sure we don't try to name a file undefined
            if (!deal_id) {
              console.error("❌ PDF Cancelled: Missing 'deal_id' in payload request.");
              return;
            }

            const formData = await db.collection("forms").findOne({ mobileNumber: customerMobile });
            
            if (!formData) {
              console.error("❌ PDF Cancelled: No entry found in 'forms' collection for this mobile.");
              return;
            }

            // 🎯 FILE NAME OVERRIDE: Swapped from shortId to Zoho Deal ID
            const fileName = `${deal_id}.pdf`; 
            const filePath = path.join(process.cwd(), fileName);
            
            // Set up invoice view parameters for the HTML rendering layout
            formData.invoiceNo = `INV-${deal_id}`;
            formData.invoiceDate = new Date().toLocaleDateString('en-IN');

            const html = getInvoiceTemplate(formData); 
            await generatePDF(html, filePath);
            
            // 🔄 UPLOADER SWAP: Sent straight to Zoho WorkDrive
            const finalPublicUrl = await uploadToZohoWorkDrive(filePath, fileName);
            
            // Clean local files from node process memory disk space
            fs.unlink(filePath, (err) => {
              if (err) console.error("❌ Error deleting local temporary PDF:", err.message);
              else console.log(`🗑️ Cleaned up local workspace file: ${fileName}`);
            });

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
        message: `Scenario ${scenarioType} message sent.`, 
        id: textResult.insertedId 
      });
    });
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
};


export const handleSurveyorPhotoUpload = async (c) => {
  let temporaryFilePath = null;

  try {
    // 1. Parse the multipart/form-data payload directly via Hono
    const body = await c.req.parseBody();
    
    const photoFile = body['photo']; // This is a web File object or Blob
    const phoneNo = body['phoneNo'];
    const date = body['date'];

    // 2. Validate parameters
    if (!photoFile || !phoneNo || !date) {
      return c.json({
        success: false,
        message: "Validation Error: Missing required multipart fields: 'photo', 'phoneNo', or 'date'."
      }, 400);
    }

    console.log(`📸 Processing incoming site photo from Surveyor: ${phoneNo} for date: ${date}...`);

    // 3. Create a clean local uploads directory if it doesn't exist
    const uploadDir = './uploads';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    // 4. Convert the incoming web File stream to a local workspace file buffer
    const arrayBuffer = await photoFile.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    // Create a secure transient filename inside our local folder
    temporaryFilePath = path.join(uploadDir, `temp_${Date.now()}_${photoFile.name}`);
    fs.writeFileSync(temporaryFilePath, buffer);

    // 5. Fire your unified Zoho WorkDrive wrapper handler
    const workDriveUrl = await uploadSurveyorPhoto(temporaryFilePath, phoneNo, date);

    // 6. Return successful payload url mapping to the surveyor's mobile application
    return c.json({
      success: true,
      message: "Photo synced to Zoho WorkDrive successfully.",
      url: workDriveUrl
    }, 200);

  } catch (error) {
    console.error("❌ Surveyor Photo Route Pipeline Failed:", error.message);
    return c.json({
      success: false,
      message: "Internal server crash during WorkDrive photo sync operation.",
      error: error.message
    }, 500);

  } finally {
    // 7. 🔥 CRITICAL Disk Space Cleanup: Always remove transient workspace asset files
    if (temporaryFilePath && fs.existsSync(temporaryFilePath)) {
      fs.unlink(temporaryFilePath, (err) => {
        if (err) console.error("⚠️ Failed to remove temporary upload photo file:", err.message);
        else console.log(`🗑️ Cleaned up temporary local workspace photo asset: ${temporaryFilePath}`);
      });
    }
  }
};


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