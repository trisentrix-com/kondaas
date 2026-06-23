import { withDatabase, Binary, ObjectId, getSystemKeys } from '../utils/config.js';
import { generatePDF } from '../utils/pdfGenerator.js';
import { getZohoAccessToken } from '../utils/zohoAuth.js';
import { uploadToZohoWorkDrive,uploadSurveyorAttendancePhoto,getOrCreateLeadsSEFolder } from '../utils/uploadToZohoWorkDrive.js';
import { getInvoiceTemplate,getSurveyReportTemplate } from '../templates/invoiceTemplate.js';
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
    const { deal_id, surveyorNumber, customerMobile, name, scenarioType, eta, mapsUrl } = await c.req.json();
    
    // 🧼 Clean and strip phone formatting symbols
    let cleanedCustomerMobile = customerMobile ? String(customerMobile).replace(/\D/g, '') : null;
    if (cleanedCustomerMobile && cleanedCustomerMobile.length === 12 && cleanedCustomerMobile.startsWith('91')) {
      cleanedCustomerMobile = cleanedCustomerMobile.substring(2);
    }

    return await withDatabase(MONGODB_URI, async (db) => {
      const customerName = name;
      const whatsappTo = cleanedCustomerMobile; 
      
      const messages = {
        1: `Hello ${customerName}, your Kondaas technician has started. Arrival in ${eta || 'soon'} min. Contact: ${surveyorNumber}.${mapsUrl ? `\n\n📍 Track Location: ${mapsUrl}` : ''}`,
        2: `Hello ${customerName}, your technician is just 300 meters away!`,
        3: `Hello ${customerName}, your technician has arrived.`,
        4: `Hello ${customerName}, your technician has completed the work. Thank you for choosing Kondaas! and kindly give rating.`
      };

      // --- STEP 1: ALWAYS SEND THE TEXT MESSAGE FIRST ---
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

      // --- STEP 2: SCENARIO 4 HEAVY BACKGROUND COMPILATION TREE ---
      if (scenarioType === 4) {
        (async () => {
          try {
            if (!deal_id) {
              console.error("❌ Document Generation Cancelled: Missing 'deal_id' in payload request.");
              return;
            }

            console.log(`📄 Fetching forms record for clean mobile: ${cleanedCustomerMobile}...`);
            const formData = await db.collection("forms").findOne({ mobileNumber: cleanedCustomerMobile });
            
            if (!formData) {
              console.error(`❌ Document Generation Cancelled: No form entry found for mobile: ${cleanedCustomerMobile}`);
              return;
            }

            // Bind transaction details into form reference object memory 
            formData.deal_id = deal_id;
            formData.invoiceNo = `INV-${deal_id}`;
            formData.invoiceDate = new Date().toLocaleDateString('en-IN');

            // -------------------------------------------------------------
            // 📑 PART A: GENERATE & UPLOAD THE SITE SURVEY TECHNICAL REPORT
            // -------------------------------------------------------------
            console.log("🛠️ Compiling Technical Survey Report PDF...");
            const surveyFileName = `Survey_Report_${deal_id}.pdf`;
            const surveyFilePath = path.join(process.cwd(), surveyFileName);

            const surveyHtml = getSurveyReportTemplate(formData);
            await generatePDF(surveyHtml, surveyFilePath);

            console.log(`🔄 Resolving Zoho WorkDrive "Survey" Folder for Deal ID [${deal_id}]...`);
            const targetSurveyFolderId = await getOrCreateLeadsSEFolder(deal_id, "Survey");
            
            const surveyPublicUrl = await uploadToZohoWorkDrive(surveyFilePath, surveyFileName, targetSurveyFolderId);
            console.log(`✅ Survey Report synced successfully to Zoho: ${surveyPublicUrl}`);

            // Clear local temporary survey workspace file
            fs.unlink(surveyFilePath, (err) => {
              if (err) console.error("❌ Error deleting local temporary survey PDF:", err.message);
            });

            // ----------------------------------------------------------------------
            // 🎯 LINK ATTACHMENT: ATTACH WORKDRIVE URL TO ZOHO CRM
            // ----------------------------------------------------------------------
            try {
              console.log(`📡 Attaching survey report link to Zoho CRM Deals for ID: ${deal_id}`);
              const zohoToken = await getZohoAccessToken(db);

              const linkPayload = {
                id: deal_id,
                Site_Survey: surveyPublicUrl // Attach the fresh generated file URL
              };

              const crmResponse = await fetch(`https://www.zohoapis.in/crm/v8/Deals/${deal_id}`, {
                method: "PUT",
                headers: {
                  "Authorization": `Zoho-oauthtoken ${zohoToken}`,
                  "Content-Type": "application/json"
                },
                body: JSON.stringify({ data: [linkPayload] })
              });

              if (!crmResponse.ok) {
                const errDetails = await crmResponse.text();
                console.error("❌ Zoho CRM Link Attachment Blocked:", errDetails);
              } else {
                console.log(`✅ Site Survey WorkDrive link updated on Zoho record.`);
              }
            } catch (crmErr) {
              console.error("⚠️ Non-blocking warning: CRM link attachment dropped:", crmErr.message);
            }

            // -------------------------------------------------------------
            // 📑 PART C: GENERATE & UPLOAD THE COMMERCIAL INVOICE
            // -------------------------------------------------------------
            console.log("💰 Compiling Commercial Invoice PDF...");
            const invoiceFileName = `${deal_id}.pdf`; 
            const invoiceFilePath = path.join(process.cwd(), invoiceFileName);

            const invoiceHtml = getInvoiceTemplate(formData); 
            await generatePDF(invoiceHtml, invoiceFilePath);
            
            console.log(`🔄 Resolving Zoho WorkDrive "Invoice" Folder for Deal ID [${deal_id}]...`);
            const targetInvoiceFolderId = await getOrCreateLeadsSEFolder(deal_id, "Invoice");
            
            const invoicePublicUrl = await uploadToZohoWorkDrive(invoiceFilePath, invoiceFileName, targetInvoiceFolderId);
            console.log(`✅ Invoice synced successfully to Zoho: ${invoicePublicUrl}`);
            
            // Clear local temporary invoice workspace file
            fs.unlink(invoiceFilePath, (err) => {
              if (err) console.error("❌ Error deleting local temporary invoice PDF:", err.message);
            });

            // -------------------------------------------------------------
            // 📥 PART D: QUEUE INVOICE WHATSAPP DELIVERY TO CLIENT
            // -------------------------------------------------------------
            const pdfResult = await db.collection("notifications").insertOne({
              from: "Kondaas_System",
              to: whatsappTo,
              mode: "whatsapp",
              content: new Binary(Buffer.from(invoicePublicUrl.trim(), 'utf8')),
              contentType: "pdf",
              caption: "Here is your formal invoice. Thank you!",
              status: "pending",
              createdAt: new Date()
            });
            processWhatsAppNotification(pdfResult.insertedId).catch(err => console.error(err));

          } catch (pdfErr) {
            console.error("❌ Background PDF Document Tree Generation Failed:", pdfErr);
          }
        })();
      }

      return c.json({ 
        message: `Scenario ${scenarioType} flow executed.`, 
        id: textResult.insertedId 
      });
    });
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
};

//attendance photo upload handler
export const handleSurveyorPhotoUpload = async (c) => {
  let temporaryFilePath = null;

  try {
    const body = await c.req.parseBody();
    
    const photoFile = body['photo']; 
    const phoneNo = body['phoneNo'];
    const time = body['time']; 

    if (!photoFile || !phoneNo || !time) {
      return c.json({
        success: false,
        message: "Validation Error: Missing required multipart fields: 'photo', 'phoneNo', or 'time'."
      }, 400);
    }

    console.log(`📸 Processing incoming attendance photo from Surveyor: ${phoneNo} at ${time}...`);

    const uploadDir = './uploads';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    const arrayBuffer = await photoFile.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    const fileExt = path.extname(photoFile.name) || '.jpg';
    
    temporaryFilePath = path.join(uploadDir, `temp_${Date.now()}_${photoFile.name}`);
    fs.writeFileSync(temporaryFilePath, buffer);

    const workDriveUrl = await uploadSurveyorAttendancePhoto(temporaryFilePath, phoneNo, time, fileExt);

    return c.json({
      success: true,
      message: "Attendance photo synced to Zoho WorkDrive attendance folder successfully.",
      url: workDriveUrl
    }, 200);

  } catch (error) {
    console.error("❌ Surveyor Attendance Photo Route Pipeline Failed:", error.message);
    return c.json({
      success: false,
      message: "Internal server crash during WorkDrive attendance photo sync operation.",
      error: error.message
    }, 500);

  } finally {
    if (temporaryFilePath && fs.existsSync(temporaryFilePath)) {
      try {
        fs.unlinkSync(temporaryFilePath);
        console.log(`🗑️ Cleaned up temporary local workspace photo asset: ${temporaryFilePath}`);
      } catch (err) {
        console.error("⚠️ Failed to remove temporary upload photo file:", err.message);
      }
    }
  }
};
//for leads dynamic folder with yyyy-mm-dd date structure in zoho tree layout



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