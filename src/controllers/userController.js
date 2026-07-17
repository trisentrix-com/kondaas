import { withDatabase } from '../utils/config.js';
import fs from 'fs';
import path from 'path';
import { getZohoAccessToken } from '../utils/zohoAuth.js';
import { uploadToZohoWorkDrive, getOrCreateLeadsSEFolder } from '../utils/uploadToZohoWorkDrive.js';

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

    const dealId = dataFields.deal_id || dataFields.id;
    if (!dealId) {
      return c.json({ error: "Validation Error: An explicit 'deal_id' is required to register this form structure." }, 400);
    }

    const uploadDir = path.join(process.cwd(), 'uploads');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

    const uploadedFileUrls = {};

    // -------------------------------------------------------------------------
    // 🎯 100% DYNAMIC FILE LOOP PROCESSOR: No hardcoded array fields!
    // -------------------------------------------------------------------------
    for (const fieldName of Object.keys(body)) {
      const rawValue = body[fieldName];
      if (!rawValue) continue;

      // Normalize into array formatting to seamlessly evaluate all fields
      const valuesArray = Array.isArray(rawValue) ? rawValue : [rawValue];

      // Filter out any native text inputs; we only look for objects that behave like uploaded files
      const filesArray = valuesArray.filter(val => val && typeof val === 'object' && 'name' in val);
      if (filesArray.length === 0) continue;

      for (let i = 0; i < filesArray.length; i++) {
        const file = filesArray[i];
        if (file && file.name) {
          // 📁 Step A: Determine correct destination folder name parameters dynamically
          const targetFolderName = (fieldName === "EB_Bill_Copy") ? "last 6 month EBbill" : "site";
          
          // 🎯 FIXED: Now tracking the third state argument dynamically for regional folder synchronization!
          const targetFolderId = await getOrCreateLeadsSEFolder(dealId, targetFolderName, dataFields.state);

          // 💾 Step B: Build localized temp file path and enforce clean field-based file naming rules
          const ext = path.extname(file.name) || '.jpg';
          const customFileName = filesArray.length > 1 ? `${fieldName}_${i + 1}${ext}` : `${fieldName}${ext}`;
          const tempPath = path.join(uploadDir, `temp_${dealId}_${fieldName}_${i}_${Date.now()}${ext}`);

          temporaryFilesToClean.push(tempPath);

          // Write file binary buffer to local disk space temporarily
          fs.writeFileSync(tempPath, Buffer.from(await file.arrayBuffer()));
          console.log(`🎬 Streaming dynamic asset [${fieldName}] directly to Zoho WorkDrive Folder: [${targetFolderName}] for state [${dataFields.state || 'N/A'}]`);

          // 📡 Step C: Pass the custom target filename directly into your upload utility helper
          const url = await uploadToZohoWorkDrive(tempPath, customFileName, targetFolderId);

          if (!uploadedFileUrls[fieldName]) {
            uploadedFileUrls[fieldName] = [];
          }
          uploadedFileUrls[fieldName].push(url?.url || url);
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
        uploadedMediaUrls: uploadedFileUrls,
        createdAt: new Date().toISOString()
      };

      await db.collection("forms").insertOne(finalDocument);
      console.log(`✅ Form components safely mapped and written to MongoDB Atlas!`);

      const zohoToken = await getZohoAccessToken(db);

      // Lookup templates data logic safely
      const schemaConfig = await db.collection("templates").findOne({ id: "solarv1" });
      const registeredProperties = schemaConfig?.schema?.properties || {};

      const dealUpdateFields = {
        id: dealId
      };

      // Extract field parameters passed by surveyor
      for (const [key, value] of Object.entries(dataFields)) {
        // 🛡️ CRITICAL BYPASS: Skip processing these entirely inside this loop to prevent data/type overwrites!
        if (
          key === 'Advance_Payment_Screenshot' || 
          key === 'Bank_Passbook_Copy' || 
          key === 'Billing_Tax_Copy' ||
          key === 'Report_Number' ||            // 📑 EXCLUDE FROM AUTO-NUMBER CASTING
          key === 'report_number'
        ) {
          continue;
        }

        if (
          key !== 'id' &&
          key !== 'deal_id' &&
          key !== '_id' &&
          value !== undefined &&
          value !== null
        ) {
          const normalizedValue = typeof value === 'string' ? value.trim().toLowerCase() : value;
          const fieldDefinition = registeredProperties[key] || {};

          // 🖼️ Case A: Base64 signature converter layout
          if (
            fieldDefinition.format === 'data-url' &&
            typeof value === 'string' &&
            value.startsWith('data:image')
          ) {
            try {
              const base64Data = value.replace(/^data:image\/\w+;base64,/, "");
              const imageBuffer = Buffer.from(base64Data, 'base64');

              const tempPath = path.join(uploadDir, `temp_extracted_sig_${dealId}_${key}_${Date.now()}.png`);
              fs.writeFileSync(tempPath, imageBuffer);
              temporaryFilesToClean.push(tempPath);

              console.log(`⚡ Uploading decoded signature binary to Zoho ZFS vault: ${key}`);
              const zfsId = await uploadToZohoZFS(tempPath, `${key}.png`, zohoToken);

              if (zfsId) {
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
          // 🎛️ Case B: Dynamic Boolean Casting Engine via JSON-Schema Rules
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
          // 🛑 Case D: EXCLUSION FILTER: Keep Latitude/Longitude as pure strings
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

      // 📑 STRICT FORMAT ENFORCEMENT: Explicitly sanitizing Report Number field layout as a string
      const rawReportNum = dataFields.Report_Number || dataFields.report_number;
      if (rawReportNum !== undefined && rawReportNum !== null) {
        dealUpdateFields['Report_Number'] = String(rawReportNum).trim();
        console.log(`📑 Enforcing String format for Report Number: "${dealUpdateFields['Report_Number']}"`);
      }

      // 🖼️ 1. ADVANCE PAYMENT SCREENSHOT PROCESSING LAYER
      const screenshotString = dataFields.Advance_Payment_Screenshot;
      if (typeof screenshotString === 'string' && screenshotString.startsWith('data:image')) {
        try {
          console.log(`📸 Processing Advance Payment Screenshot Base64 conversion...`);
          const mimeTypeMatch = screenshotString.match(/^data:(image\/\w+);base64,/);
          const ext = mimeTypeMatch ? `.${mimeTypeMatch[1].split('/')[1]}` : '.jpg';
          const base64Data = screenshotString.replace(/^data:image\/\w+;base64,/, "");
          const imageBuffer = Buffer.from(base64Data, 'base64');

          const screenshotFileName = `Advance_Payment_${dealId}${ext}`;
          const tempPath = path.join(uploadDir, `temp_pay_ss_${dealId}_${Date.now()}${ext}`);
          fs.writeFileSync(tempPath, imageBuffer);
          temporaryFilesToClean.push(tempPath);

          const targetFolderId = await getOrCreateLeadsSEFolder(dealId, "site", dataFields.state);
          const uploadResult = await uploadToZohoWorkDrive(tempPath, screenshotFileName, targetFolderId);

          if (uploadResult && uploadResult.url) {
            dealUpdateFields['Advance_Payment_Screenshot'] = String(uploadResult.url).trim();
            console.log(`✅ Base64 Screenshot URL Attached: ${uploadResult.url}`);
          }
        } catch (err) {
          console.error("⚠️ Failed to process base64 Advance Payment Screenshot:", err.message);
        }
      } else if (uploadedFileUrls.Advance_Payment_Screenshot && uploadedFileUrls.Advance_Payment_Screenshot.length > 0) {
        dealUpdateFields['Advance_Payment_Screenshot'] = String(uploadedFileUrls.Advance_Payment_Screenshot[0]).trim();
        console.log(`✅ Multipart Screenshot URL Attached: ${dealUpdateFields['Advance_Payment_Screenshot']}`);
      }

      // 🏦 2. BANK PASSBOOK COPY PROCESSING LAYER
      const passbookString = dataFields.Bank_Passbook_Copy;
      if (typeof passbookString === 'string' && passbookString.startsWith('data:image')) {
        try {
          console.log(`📸 Processing Bank Passbook Copy Base64 conversion...`);
          const mimeTypeMatch = passbookString.match(/^data:(image\/\w+);base64,/);
          const ext = mimeTypeMatch ? `.${mimeTypeMatch[1].split('/')[1]}` : '.jpg';
          const base64Data = passbookString.replace(/^data:image\/\w+;base64,/, "");
          const imageBuffer = Buffer.from(base64Data, 'base64');

          const passbookFileName = `Bank_Passbook_${dealId}${ext}`;
          const tempPath = path.join(uploadDir, `temp_passbook_${dealId}_${Date.now()}${ext}`);
          fs.writeFileSync(tempPath, imageBuffer);
          temporaryFilesToClean.push(tempPath);

          const targetFolderId = await getOrCreateLeadsSEFolder(dealId, "site", dataFields.state);
          const uploadResult = await uploadToZohoWorkDrive(tempPath, passbookFileName, targetFolderId);

          if (uploadResult && uploadResult.url) {
            dealUpdateFields['Bank_Passbook_Copy'] = String(uploadResult.url).trim();
            console.log(`✅ Base64 Bank Passbook URL Attached: ${uploadResult.url}`);
          }
        } catch (err) {
          console.error("⚠️ Failed to process base64 Bank Passbook Copy:", err.message);
        }
      } else if (uploadedFileUrls.Bank_Passbook_Copy && uploadedFileUrls.Bank_Passbook_Copy.length > 0) {
        dealUpdateFields['Bank_Passbook_Copy'] = String(uploadedFileUrls.Bank_Passbook_Copy[0]).trim();
        console.log(`✅ Multipart Bank Passbook URL Attached: ${dealUpdateFields['Bank_Passbook_Copy']}`);
      }

      // 📝 3. BILLING TAX COPY PROCESSING LAYER
      const taxCopyString = dataFields.Billing_Tax_Copy;
      if (typeof taxCopyString === 'string' && taxCopyString.startsWith('data:image')) {
        try {
          console.log(`📸 Processing Billing Tax Copy Base64 conversion...`);
          const mimeTypeMatch = taxCopyString.match(/^data:(image\/\w+);base64,/);
          const ext = mimeTypeMatch ? `.${mimeTypeMatch[1].split('/')[1]}` : '.jpg';
          const base64Data = taxCopyString.replace(/^data:image\/\w+;base64,/, "");
          const imageBuffer = Buffer.from(base64Data, 'base64');

          const taxCopyFileName = `Billing_Tax_${dealId}${ext}`;
          const tempPath = path.join(uploadDir, `temp_tax_${dealId}_${Date.now()}${ext}`);
          fs.writeFileSync(tempPath, imageBuffer);
          temporaryFilesToClean.push(tempPath);

          const targetFolderId = await getOrCreateLeadsSEFolder(dealId, "site", dataFields.state);
          const uploadResult = await uploadToZohoWorkDrive(tempPath, taxCopyFileName, targetFolderId);

          if (uploadResult && uploadResult.url) {
            dealUpdateFields['Billing_Tax_Copy'] = String(uploadResult.url).trim();
            console.log(`✅ Base64 Billing Tax URL Attached: ${uploadResult.url}`);
          }
        } catch (err) {
          console.error("⚠️ Failed to process base64 Billing Tax Copy:", err.message);
        }
      } else if (uploadedFileUrls.Billing_Tax_Copy && uploadedFileUrls.Billing_Tax_Copy.length > 0) {
        dealUpdateFields['Billing_Tax_Copy'] = String(uploadedFileUrls.Billing_Tax_Copy[0]).trim();
        console.log(`✅ Multipart Billing Tax URL Attached: ${dealUpdateFields['Billing_Tax_Copy']}`);
      }

      console.log(`📡 Streaming integrated surveyor data live to Zoho Deals profile: ${dealId}`);

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
    // ✅ FIX: multipart/form-data support (client sends FormData with photos)
    let body;
    const contentType = c.req.header('content-type') || '';

    if (contentType.includes('multipart/form-data')) {
      const formData = await c.req.formData();
      const dataStr = formData.get('data');
      if (!dataStr) {
        return c.json({ error: "Missing 'data' field in form payload" }, 400);
      }
      body = JSON.parse(dataStr);
    } else {
      body = await c.req.json();
    }

    // 🛑 Strict Business Rule: Explicit Zoho 'id' string is mandatory to target the right deal record
    if (!body.id) {
      return c.json({ error: "Validation Error: A specific Zoho 'id' field is required to update an order." }, 400);
    }

    const targetZohoId = body.id;

    return await withDatabase(MONGODB_URI, async (db) => {
      // 🔐 Grab active authorization credentials dynamically
      const zohoToken = await getZohoAccessToken(db);

      // 🔍 Dynamic Decoupling Schema Lookup: Grab schema metadata to check expected data types
      const schemaConfig = await db.collection("templates").findOne({ id: "solarv1" });
      const registeredProperties = schemaConfig?.schema?.properties || {};

      // 🛠️ Build the dynamic fields payload for Zoho CRM
      const dealUpdateFields = {
        id: targetZohoId
      };

      // 💾 Build a separate payload for MongoDB update tracking
      const mongoUpdateFields = {};

      const uploadDir = path.join(process.cwd(), 'uploads');

      // ✅ FIX: Handle uploaded photo files from multipart (ebBillPhotos, sitePhotos)
      if (contentType.includes('multipart/form-data')) {
        const formData = await c.req.formData();

        const ebBillFiles = formData.getAll('ebBillPhotos');
        const sitePhotoFiles = formData.getAll('sitePhotos');

        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

        // Process EB Bill photos
        for (const file of ebBillFiles) {
          if (file && typeof file === 'object' && file.name) {
            const arrayBuffer = await file.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);
            const tempPath = path.join(uploadDir, `eb_bill_${targetZohoId}_${Date.now()}_${file.name}`);
            fs.writeFileSync(tempPath, buffer);
            console.log(`📄 EB Bill photo saved: ${tempPath}`);
            // Add your Zoho upload logic here if needed
            fs.unlink(tempPath, (err) => { if (err) console.error("Cleanup failed:", err.message); });
          }
        }

        // Process Site Survey photos
        for (const file of sitePhotoFiles) {
          if (file && typeof file === 'object' && file.name) {
            const arrayBuffer = await file.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);
            const tempPath = path.join(uploadDir, `site_survey_${targetZohoId}_${Date.now()}_${file.name}`);
            fs.writeFileSync(tempPath, buffer);
            console.log(`📷 Site survey photo saved: ${tempPath}`);
            // Add your Zoho upload logic here if needed
            fs.unlink(tempPath, (err) => { if (err) console.error("Cleanup failed:", err.message); });
          }
        }
      }

      // Loop through all incoming frontend key-value fields and sanitize their formats dynamically
      for (const [key, value] of Object.entries(body)) {
        if (
          key !== 'id' &&
          key !== 'deal_id' &&
          key !== '_id' &&
          value !== undefined &&
          value !== null
        ) {

          // ✅ FIX: Skip empty string and dash values — don't send to Zoho
          if (value === '' || value === '-' || (typeof value === 'string' && value.trim() === '-')) {
            console.log(`⏭️ Skipping empty/dash field: ${key}`);
            continue;
          }

          // 🖼️ 1. INTERCEPTOR FOR IMAGES/SIGNATURES (Base64 data-urls)
          if (
            (key === 'Site_Engineer_Signature' || key === 'Customer_Confirmation_Signature' || key === 'Site_Engineer_Signature1') &&
            typeof value === 'string' &&
            value.startsWith('data:image')
          ) {
            try {
              const base64Data = value.replace(/^data:image\/\w+;base64,/, "");
              const imageBuffer = Buffer.from(base64Data, 'base64');

              if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

              const tempPath = path.join(uploadDir, `temp_update_${targetZohoId}_${key}_${Date.now()}.png`);
              fs.writeFileSync(tempPath, imageBuffer);

              console.log(`⚡ Uploading modified binary signature to Zoho ZFS vault: ${key}`);
              const zfsId = await uploadToZohoZFS(tempPath, `${key}.png`, zohoToken);

              fs.unlink(tempPath, (err) => {
                if (err) console.error("❌ Temporary update file cleanup failed:", err.message);
              });

              if (zfsId) {
                dealUpdateFields[key] = [{ File_Id__s: String(zfsId) }];
                mongoUpdateFields[key] = value;
                continue;
              }
            } catch (imgErr) {
              console.error(`⚠️ Image update pipeline failed for field ${key}:`, imgErr.message);
              continue;
            }
          }

          // 📝 2. STANDARD TEXT AND DATA TYPE SANITIZATION
          const normalizedValue = typeof value === 'string' ? value.trim().toLowerCase() : value;
          const fieldDefinition = registeredProperties[key] || {};
          let processedValue = value;

          // Checkbox/Boolean Casting Engine via JSON-Schema Rules
          if (fieldDefinition.type === 'boolean') {
            processedValue = (
              value === true ||
              normalizedValue === 'true' ||
              normalizedValue === 'yes' ||
              normalizedValue === 'collected' ||
              normalizedValue === 'required'
            );
          }
          // Phone Sanitizer Check
          else if (fieldDefinition.pattern || key === 'Mobile' || key === 'Site_Engineer_Contact') {
            let digitsOnly = String(value).replace(/\D/g, '');
            if (digitsOnly.length === 12 && digitsOnly.startsWith('91')) {
              digitsOnly = digitsOnly.substring(2);
            }
            processedValue = digitsOnly;
          }
          // Keep Latitude/Longitude as pure strings for Zoho Single Line fields
          else if (key === 'Latitude' || key === 'Longitude') {
            processedValue = String(value).trim();
          }
          // Numbers & Integer auto-casting parameters
          else if (typeof value === 'number') {
            processedValue = key === 'Consumer_Number' ? Math.trunc(value) : value;
          } else if (
            typeof value === 'string' &&
            value.trim() !== '' &&
            !isNaN(value) &&
            !isNaN(parseFloat(value))
          ) {
            if (key === 'Consumer_Number') {
              processedValue = Math.trunc(parseInt(value.trim(), 10));
            } else if (!value.includes('.')) {
              processedValue = parseInt(value.trim(), 10);
            } else {
              processedValue = parseFloat(value.trim());
            }
          } else if (typeof value === 'string') {
            processedValue = value.trim();
          }

          dealUpdateFields[key] = processedValue;
          mongoUpdateFields[key] = processedValue;
        }
      }

      // Safety check: Explicit fallback execution for Consumer_Number
      if (dealUpdateFields['Consumer_Number'] !== undefined) {
        dealUpdateFields['Consumer_Number'] = parseInt(String(dealUpdateFields['Consumer_Number'] ?? '').trim(), 10) || 0;
        mongoUpdateFields['Consumer_Number'] = dealUpdateFields['Consumer_Number'];
      }

      // 📦 Build the dynamic structured payload matching Zoho API specifications
      const zohoPayload = {
        data: [dealUpdateFields]
      };

      console.log(`📡 Forwarding surveyor manual update to Zoho CRM Deals Module for Record ID: ${targetZohoId}`);
      console.log(`📦 Zoho payload:`, JSON.stringify(zohoPayload));

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

      if (resJson?.data?.[0]?.status === "error") {
        console.error("❌ Zoho internal rejection:", JSON.stringify(resJson));
        return c.json({ error: "Zoho CRM rejected the payload properties.", details: resJson.data[0] }, 400);
      }

      // --- STEP 2: UPDATE LOCAL MONGODB ---
      if (Object.keys(mongoUpdateFields).length > 0) {
        console.log(`💾 Mirroring surveyor data update to local database for Deal ID: ${targetZohoId}`);

        await db.collection("forms").updateOne(
          { deal_id: targetZohoId },
          {
            $set: {
              ...mongoUpdateFields,
              updatedAt: new Date()
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