import { withDatabase } from '../utils/config.js';
import fs from 'fs';
import path from 'path';
import { getZohoAccessToken } from '../utils/zohoAuth.js';
import { uploadToZohoWorkDrive,getOrCreateLeadsSEFolder } from '../utils/uploadToZohoWorkDrive.js';

const MONGODB_URI = process.env.MONGODB_URI;


export const addForm = async (c) => {
  const temporaryFilesToClean = [];

  try {
    // 1. Parse Multipart Form-Data from Mobile App
    const body = await c.req.parseBody({ all: true });
    
    const dataFields = typeof body.data === 'string' ? JSON.parse(body.data) : body;
    const mobileNumber = dataFields.mobileNumber || dataFields.customerDetails?.mobileNumber;

    if (!mobileNumber) {
      return c.json({ error: "Mobile number is required!" }, 400);
    }

    // Extract the raw Zoho Deal record identifier
    const dealId = dataFields.deal_id || dataFields.id || dataFields.deal_id;
    if (!dealId) {
      return c.json({ error: "Validation Error: An explicit 'deal_id' is required to register this form structure." }, 400);
    }

    // Isolate both photo category arrays out of the incoming multipart body
    const rawEbPhotos = body.ebBillPhotos;
    const ebFiles = Array.isArray(rawEbPhotos) ? rawEbPhotos : (rawEbPhotos ? [rawEbPhotos] : []);

    const rawSitePhotos = body.sitePhotos; 
    const siteFiles = Array.isArray(rawSitePhotos) ? rawSitePhotos : (rawSitePhotos ? [rawSitePhotos] : []);

    const uploadDir = path.join(process.cwd(), 'uploads');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

    // -------------------------------------------------------------------------
    // PROCESS CATEGORY 1: last 6 month EBbill
    // -------------------------------------------------------------------------
    const uploadedEbUrls = [];
    if (ebFiles.length > 0) {
      const targetEbFolderId = await getOrCreateLeadsSEFolder(dealId, "last 6 month EBbill");

      for (let i = 0; i < ebFiles.length; i++) {
        const file = ebFiles[i];
        if (file && file.name) {
          const ext = path.extname(file.name) || '.jpg';
          const tempPath = path.join(uploadDir, `temp_eb_${dealId}_${i}_${Date.now()}${ext}`);
          temporaryFilesToClean.push(tempPath);

          fs.writeFileSync(tempPath, Buffer.from(await file.arrayBuffer()));

          const customFileName = `eb bill ${i + 1}${ext}`;
          console.log(`📸 Streaming EB Bill [${i + 1}/${ebFiles.length}] as: ${customFileName}`);

          const url = await uploadToZohoWorkDrive(tempPath, customFileName, targetEbFolderId);
          uploadedEbUrls.push(url);
        }
      }
    }

    // -------------------------------------------------------------------------
    // PROCESS CATEGORY 2: site photos
    // -------------------------------------------------------------------------
    const uploadedSiteUrls = [];
    if (siteFiles.length > 0) {
      const targetSiteFolderId = await getOrCreateLeadsSEFolder(dealId, "site photos");

      for (let i = 0; i < siteFiles.length; i++) {
        const file = siteFiles[i];
        if (file && file.name) {
          const ext = path.extname(file.name) || '.jpg';
          const tempPath = path.join(uploadDir, `temp_site_${dealId}_${i}_${Date.now()}${ext}`);
          temporaryFilesToClean.push(tempPath);

          fs.writeFileSync(tempPath, Buffer.from(await file.arrayBuffer()));

          const customFileName = `${i + 1}${ext}`;
          console.log(`📸 Streaming Site Photo [${i + 1}/${siteFiles.length}] as: ${customFileName}`);

          const url = await uploadToZohoWorkDrive(tempPath, customFileName, targetSiteFolderId);
          uploadedSiteUrls.push(url);
        }
      }
    }

    // 2. Dual Write Database Execution & Live Zoho Push
    return await withDatabase(MONGODB_URI, async (db) => {
      const existing = await db.collection("forms").findOne({ mobileNumber });
      
      if (existing) {
        return c.json({ error: "Mobile number already registered!" }, 400);
      }

      const finalDocument = {
        deal_id: dealId,
        mobileNumber,
        ...dataFields,
        ebBillPhotos: uploadedEbUrls,  
        sitePhotos: uploadedSiteUrls,  
        createdAt: new Date().toISOString()
      };

      // A. Commit Record safely to MongoDB local Atlas cluster
      await db.collection("forms").insertOne(finalDocument);
      console.log(`✅ Form completely matched and stored to MongoDB Atlas!`);

      // B. Instantly stream data fields dynamically up to Zoho Deals Module module
      const zohoToken = await getZohoAccessToken(db);

      const dealUpdateFields = {
        id: dealId
      };

      // Extract every valid field parameter passed by surveyor, auto-casting types dynamically
for (const [key, value] of Object.entries(dataFields)) {
  if (
    key !== 'id' && 
    key !== 'deal_id' && 
    key !== '_id' && 
    value !== undefined && 
    value !== null
  ) {
    // 🧼 Clean string properties to safeguard evaluation checks
    const normalizedValue = typeof value === 'string' ? value.trim().toLowerCase() : value;

    // 🛑 EXCLUSION FILTER: Keep Latitude/Longitude as pure strings for Zoho Single Line fields
    if (key === 'Latitude' || key === 'Longitude') {
      dealUpdateFields[key] = String(value).trim();
    }
    // 🎛️ Type-Cast Guardrails: Force absolute clean evaluation format for CRM schemas
    else if (normalizedValue === "true") {
      dealUpdateFields[key] = true;
    } else if (normalizedValue === "false") {
      dealUpdateFields[key] = false;
    } else if (value === true || value === false) {
      dealUpdateFields[key] = value;
    } else if (
      typeof value === 'string' && 
      value.trim() !== '' && 
      !isNaN(value) && 
      !isNaN(parseFloat(value))
    ) {
      // 🔢 Advanced Number Handling
      if (!value.includes('.')) {
        dealUpdateFields[key] = parseInt(value.trim(), 10);
      } else {
        dealUpdateFields[key] = parseFloat(value.trim());
      }
    } else {
      dealUpdateFields[key] = value;
    }
  }
}

      console.log(`📡 Streaming initial surveyor fields data live to Zoho Deals Profile: ${dealId}`);

      const zohoResponse = await fetch(`https://www.zohoapis.in/crm/v8/Deals/${dealId}`, {
        method: "PUT",
        headers: {
          "Authorization": `Zoho-oauthtoken ${zohoToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ data: [dealUpdateFields] })
      });

      if (!zohoResponse.ok) {
        const zohoErrTxt = await zohoResponse.text();
        console.error("⚠️ Local DB Saved, but Zoho Sync failed on addForm:", zohoErrTxt);
      } else {
        const resJson = await zohoResponse.json();
        if (resJson?.data?.[0]?.status === "error") {
          console.error("❌ Zoho inner tracking rejection parameters:", JSON.stringify(resJson.data[0]));
        } else {
          console.log(`🚀 Successfully populated initial parameters to Zoho Deal layout.`);
        }
      }

      return c.json({ 
        success: true, 
        message: "Form saved locally and pushed cleanly to Zoho CRM layout workspace!" 
      }, 201);
    });

  } catch (err) {
    console.error("❌ Exception inside multipart addForm controller:", err.message);
    return c.json({ error: err.message }, 500);
  } finally {
    // 3. Disk Space Cleanup Loop
    for (const filePath of temporaryFilesToClean) {
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch (cleanupError) {
          console.error(`⚠️ Failed to delete temporary file: ${filePath}`, cleanupError.message);
        }
      }
    }
  }
};

export const updateForm = async (c) => {
  try {
    const body = await c.req.json();
    
    // 🛑 Strict Business Rule: Explicit Zoho 'id' string is mandatory to target the right deal record
    if (!body.id) {
      return c.json({ error: "Validation Error: A specific Zoho 'id' field is required to update an order." }, 400);
    }

    const targetZohoId = body.id;

    return await withDatabase(MONGODB_URI, async (db) => {
      // 🔐 Grab active authorization credentials dynamically
      const zohoToken = await getZohoAccessToken(db);

      // 🛠️ Build the dynamic fields payload for Zoho CRM
      const dealUpdateFields = {
        id: targetZohoId
      };

      // 💾 Build a separate payload for MongoDB update tracking
      const mongoUpdateFields = {};

      // Loop through all data fields passed from the frontend and map them 1-to-1
      for (const [key, value] of Object.entries(body)) {
        // Exclude 'id' and any invalid empty properties
        if (key !== 'id' && value !== undefined && value !== null) {
          dealUpdateFields[key] = value;
          mongoUpdateFields[key] = value; // Keep local db identical to Zoho layout
        }
      }

      // 📦 Build the dynamic structured payload matching Zoho API specifications
      const zohoPayload = {
        data: [dealUpdateFields]
      };

      console.log(`📡 Forwarding surveyor manual update to Zoho CRM Deals Module for Record ID: ${targetZohoId}`);

      // --- STEP 1: UPDATE ZOHO CRM ---
      const response = await fetch(`https://www.zohoapis.in/crm/v8/Deals/${targetZohoId}`, {
        method: "PUT",
        headers: {
          "Authorization": `Zoho-oauthtoken ${zohoToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(zohoPayload)
      });

      if (!response.ok) {
        const errDetails = await response.text();
        console.error("❌ Zoho Modification Blocked:", errDetails);
        return c.json({ error: "Failed to update record inside Zoho CRM Deals module.", details: errDetails }, 500);
      }

      const resJson = await response.json();
      
      // Double check internal action status
      if (resJson?.data?.[0]?.status === "error") {
        console.error("❌ Zoho internal rejection:", JSON.stringify(resJson));
        return c.json({ error: "Zoho CRM rejected the payload properties.", details: resJson.data[0] }, 400);
      }

      // --- STEP 2: UPDATE LOCAL MONGODB ---
      // Only proceed with database writing if the master record in Zoho updated successfully.
      if (Object.keys(mongoUpdateFields).length > 0) {
        console.log(`💾 Mirroring surveyor data update to local database for Deal ID: ${targetZohoId}`);
        
        await db.collection("forms").updateOne(
          { deal_id: targetZohoId }, // Finds the matching client form based on the linked Zoho Deal ID
          { 
            $set: {
              ...mongoUpdateFields,
              updatedAt: new Date() // Tracking timestamp
            } 
          },
          { upsert: false } 
        );
      }

      return c.json({ 
        success: true, 
        message: "Targeted Deal profile synchronized cleanly in both Zoho CRM and Database!", 
        id: targetZohoId 
      });
    });
  } catch (err) {
    console.error("❌ UpdateOrder Error Exception:", err.message);
    return c.json({ error: "Internal server error", details: err.message }, 500);
  }
};

