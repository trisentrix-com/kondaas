import { withDatabase } from '../utils/config.js';
import fs from 'fs';
import path from 'path';
import { getZohoAccessToken } from '../utils/zohoAuth.js';
import { uploadToZohoWorkDrive,getOrCreateLeadsSEFolder } from '../utils/uploadToZohoWorkDrive.js';

const MONGODB_URI = process.env.MONGODB_URI;

const uploadToZohoZFS = async (localFilePath, fileName, zohoToken) => {
  try {
    const formData = new FormData();
    const fileBuffer = fs.readFileSync(localFilePath);
    const fileBlob = new Blob([fileBuffer]);
    
    // Standard ZFS upload parameter expects 'file'
    formData.append('file', fileBlob, fileName);

    const response = await fetch('https://www.zohoapis.in/crm/v8/files', {
      method: 'POST',
      headers: {
        'Authorization': `Zoho-oauthtoken ${zohoToken}`
      },
      body: formData
    });

    if (!response.ok) {
      throw new Error(`ZFS Core API HTTP Error: ${response.status}`);
    }

    const json = await response.json();
    return json?.data?.[0]?.details?.id || null;
  } catch (error) {
    console.error(`❌ Exception inside Zoho ZFS attachment processor for ${fileName}:`, error.message);
    return null;
  }
};

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
          console.log(`📸 Streaming EB Bill [${i + 1}/${ebFiles.length}]`);

          const url = await uploadToZohoWorkDrive(tempPath, file.name, targetEbFolderId);
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
          console.log(`📸 Streaming Site Photo [${i + 1}/${siteFiles.length}]`);

          const url = await uploadToZohoWorkDrive(tempPath, file.name, targetSiteFolderId);
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

      await db.collection("forms").insertOne(finalDocument);
      console.log(`✅ Form completely matched and stored to MongoDB Atlas!`);

      const zohoToken = await getZohoAccessToken(db);

      // 🔍 Dynamic Decoupling Lookup: Source properties directly from the target templates workspace
      const schemaConfig = await db.collection("templates").findOne({ id: "solarv1" });
      const registeredProperties = schemaConfig?.schema?.properties || {};

      const dealUpdateFields = {
        id: dealId
      };

      // Extract every field parameter passed by surveyor, auto-casting types dynamically
      for (const [key, value] of Object.entries(dataFields)) {
        if (
          key !== 'id' && 
          key !== 'deal_id' && 
          key !== '_id' && 
          value !== undefined && 
          value !== null
        ) {
          const normalizedValue = typeof value === 'string' ? value.trim().toLowerCase() : value;
          const fieldDefinition = registeredProperties[key] || {};

          // 🖼️ Case A: Base64 data-url converter & background ZFS file attachment pipeline handler
       if (fieldDefinition.format === 'data-url' && typeof value === 'string' && value.startsWith('data:image')) {
  try {
    const base64Data = value.replace(/^data:image\/\w+;base64,/, "");
    const imageBuffer = Buffer.from(base64Data, 'base64');
    
    const tempPath = path.join(uploadDir, `temp_extracted_sig_${dealId}_${key}_${Date.now()}.png`);
    fs.writeFileSync(tempPath, imageBuffer);
    temporaryFilesToClean.push(tempPath);

    console.log(`⚡ Uploading decoded signature binary to Zoho ZFS vault: ${key}`);
    const zfsId = await uploadToZohoZFS(tempPath, `${key}.png`, zohoToken);
    
    if (zfsId) {
      // Zoho v8 Image Upload custom layout fields expect an array tracking the uppercase File_Id__s property
      dealUpdateFields[key] = [
        {
          File_Id__s: String(zfsId)
        }
      ];
    }
  } catch (err) {
    console.error(`⚠️ Failed to process base64 signature layout field configuration for ${key}:`, err.message);
  }
}
          // 🎛️ Case B: Dynamic Checkbox/Boolean Casting Engine via JSON-Schema Rules
          else if (fieldDefinition.type === 'boolean') {
            dealUpdateFields[key] = (
              value === true ||
              normalizedValue === 'true' ||
              normalizedValue === 'yes' ||
              normalizedValue === 'collected' ||
              normalizedValue === 'required'
            );
          }
          // 📞 Case C: Phone Sanitizer Check
          else if (fieldDefinition.pattern || key === 'Mobile' || key === 'Site_Engineer_Contact') {
            let digitsOnly = String(value).replace(/\D/g, ''); 
            if (digitsOnly.length === 12 && digitsOnly.startsWith('91')) {
              digitsOnly = digitsOnly.substring(2);
            }
            dealUpdateFields[key] = digitsOnly;
          }
          // 🛑 Case D: EXCLUSION FILTER: Keep Latitude/Longitude as pure strings for Zoho Single Line fields
          else if (key === 'Latitude' || key === 'Longitude') {
            dealUpdateFields[key] = String(value).trim();
          }
          // ⚙️ Case E: Numbers & Integer auto-casting parameters
          else if (typeof value === 'number') {
            if (key === 'Consumer_Number') {
              dealUpdateFields[key] = Math.trunc(value);
            } else {
              dealUpdateFields[key] = value;
            }
          } else if (
            typeof value === 'string' && 
            value.trim() !== '' && 
            !isNaN(value) && 
            !isNaN(parseFloat(value))
          ) {
            if (key === 'Consumer_Number') {
              dealUpdateFields[key] = Math.trunc(parseInt(value.trim(), 10));
            } else if (!value.includes('.')) {
              dealUpdateFields[key] = parseInt(value.trim(), 10);
            } else {
              dealUpdateFields[key] = parseFloat(value.trim());
            }
          } else {
            dealUpdateFields[key] = value;
          }
        }
      }
      
      dealUpdateFields['Consumer_Number'] = parseInt(String(dealUpdateFields['Consumer_Number'] ?? '').trim(), 10) || 0;

      console.log(`📡 Streaming integrated surveyor text and image layout live to Zoho Deals profile: ${dealId}`);

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
          console.log(`🚀 Successfully populated text and image components to Zoho Deal layout.`);
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
    // Disk Space Cleanup Loop
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

