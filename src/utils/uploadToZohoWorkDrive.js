import fs from 'fs';
import path from 'path';
import axios from 'axios';
import FormData from 'form-data';
import { withDatabase } from './config.js';
import { getZohoAccessToken } from './zohoAuth.js';

const MONGODB_URI = process.env.MONGODB_URI;

// =========================================================================
// 🎯 REGIONAL ROOT FOLDER SETTINGS
// =========================================================================
const ZOHO_ROOT_KERALA = "6a1v05bb43a52fc994c29a089b2200398c21a";
const ZOHO_ROOT_TAMILNADU = "6a1v0ef07d0ed14ec49ada78a6812588bdf6c";

// Keep your common global attendance root untouched as requested
const ATTENDANCE_FOLDER_ID = "1dapl3d793070176e414aa88cc0a2652e819c";
// =========================================================================


export const createZohoPublicDownloadUrl = async (db, resourceId) => {
  try {
    if (!resourceId) {
      console.error("⚠️ Cannot create public link: resourceId is undefined or missing.");
      return null;
    }

    const zohoToken = await getZohoAccessToken(db);

    // 🎯 Clean and strict Zoho WorkDrive link payload layout
    const payload = {
      data: {
        type: "links",
        attributes: {
          resource_id: String(resourceId).trim(),
          link_name: "WhatsApp Sharing Link",
          allow_download: true,
          request_user_data: false,
          role_id: "34" // 🎯 CRITICAL: View/Download role permissions identifier for public sharing links
        }
      }
    };

    console.log(`🔗 Requesting Zoho public link for file resource ID: ${resourceId}`);

    const response = await fetch("https://workdrive.zoho.in/api/v1/links", {
      method: "POST",
      headers: {
        "Authorization": `Zoho-oauthtoken ${zohoToken}`,
        "Content-Type": "application/json",
        "Accept": "application/vnd.api+json" // Required for strict JSON-API parsing by Zoho
      },
      body: JSON.stringify(payload)
    });

    const result = await response.json();

    if (!response.ok) {
      console.error("❌ Failed to create public share link in Zoho:", JSON.stringify(result));
      return null;
    }

    // Capture the public URL returned cleanly by Zoho's response attributes object map
    const userUrl = result?.data?.attributes?.url;
    if (!userUrl) {
      console.error("⚠️ Zoho response did not contain a valid URL mapping.");
      return null;
    }

    // Append the final parameter so WhatsApp's stream engine downloads the direct file raw binary stream
    const directDownloadUrl = `${userUrl}?directDownload=true`;
    console.log(`🚀 Final Customer Share Link configured: ${directDownloadUrl}`);
    
    return directDownloadUrl;

  } catch (error) {
    console.error("❌ Exception inside createZohoPublicDownloadUrl helper:", error.message);
    return null;
  }
};

export const uploadToZohoWorkDrive = async (filePath, fileName, targetFolderId) => {
  try {
    const WORKDRIVE_FOLDER_ID = targetFolderId || ZOHO_ROOT_TAMILNADU;

    return await withDatabase(MONGODB_URI, async (db) => {
      const zAccessToken = await getZohoAccessToken(db);
      const form = new FormData();

      const finalFileName = fileName || path.basename(filePath);

      form.append('content', fs.createReadStream(filePath), { filename: finalFileName });
      form.append('parent_id', WORKDRIVE_FOLDER_ID);
      form.append('override-name-exist', 'true');

      console.log(`📡 Pushing ${finalFileName} securely to Zoho WorkDrive Folder [${WORKDRIVE_FOLDER_ID}]...`);

      const response = await axios.post('https://workdrive.zoho.in/api/v1/upload', form, {
        headers: {
          'Authorization': `Zoho-oauthtoken ${zAccessToken}`,
          ...form.getHeaders()
        }
      });

      const resourceData = response.data?.data?.[0];
      // Robust fallback extraction handling Zoho API's shifting payload properties keys
      const fileId = resourceData?.id || resourceData?.attributes?.resource_id || resourceData?.attributes?.id;
      const workDriveUrl = resourceData?.attributes?.permalink || `https://workdrive.zoho.in/api/v1/download/${fileId}`;

      console.log(`✅ File synced to Zoho WorkDrive successfully: ${workDriveUrl}`);

      return {
        url: workDriveUrl,
        fileId: fileId
      };
    });

  } catch (error) {
    const errorDetails = error.response?.data ? JSON.stringify(error.response.data) : error.message;
    console.error("❌ Zoho WorkDrive Upload Failed:", errorDetails);
    throw new Error(`WorkDrive integration crash: ${errorDetails}`);
  }
};


export const uploadSurveyorAttendancePhoto = async (filePath, mobileNumber, time, fileExtension) => {
  try {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const dateString = `${year}-${month}-${day}`;

    const targetDayFolderId = await getOrCreateDateFolder(dateString, mobileNumber);

    const customZohoName = `SI_${time.replace(/:/g, '-')}${fileExtension}`;
    console.log(`📸 Target Surveyor Day Folder Resolved. Storing photo as: ${customZohoName}`);

    const uploadedUrl = await uploadToZohoWorkDrive(filePath, customZohoName, targetDayFolderId);
    return uploadedUrl;

  } catch (err) {
    console.error(`❌ Attendance wrapper crashed for surveyor mobile: ${mobileNumber}`, err.message);
    throw err;
  }
};


// ✨ FIXED: Now points cleanly to workdrive.zoho.in/api/v1/ instead of old crm domains
const findExistingZohoFolder = async (folderName, parentFolderId, accessToken) => {
  try {
    const response = await axios.get(`https://workdrive.zoho.in/api/v1/folders/${parentFolderId}/files`, {
      headers: { 'Authorization': `Zoho-oauthtoken ${accessToken}` }
    });

    const items = response.data?.data || [];
    const exactMatch = items.find(item => item.attributes?.name === folderName && item.attributes?.type === 'folder');

    return exactMatch ? exactMatch.id : null;
  } catch (err) {
    console.error(`⚠️ Error verifying folder existence in Zoho for "${folderName}":`, err.message);
    return null;
  }
};


export const getOrCreateDateFolder = async (dateString, mobileNumber) => {
  const [year, month, day] = dateString.split('-');
  const monthFolderName = `${year}-${month}`;
  const dayFolderName = day;

  const surveyorPathKey = `${mobileNumber}`;
  const monthPathKey = `${mobileNumber}/${monthFolderName}`;
  const fullDayPathKey = `${mobileNumber}/${monthFolderName}/${dayFolderName}`;

  return await withDatabase(MONGODB_URI, async (db) => {
    const cacheCollection = db.collection("zoho_folders");

    const cachedDayFolder = await cacheCollection.findOne({ type: "day", path: fullDayPathKey });
    if (cachedDayFolder) {
      console.log(`📋 Cache Hit! Found Surveyor Day Folder ID: ${cachedDayFolder.zohoFolderId}`);
      return cachedDayFolder.zohoFolderId;
    }

    console.log(`📝 Cache Miss! Path [${fullDayPathKey}] not in local DB. Resolving tree verification...`);
    const zAccessToken = await getZohoAccessToken(db);

    // 🔎 STEP 2: Surveyor Mobile Root Folder
    let surveyorFolderId;
    const cachedSurveyorFolder = await cacheCollection.findOne({ type: "surveyor", path: surveyorPathKey });

    if (cachedSurveyorFolder) {
      surveyorFolderId = cachedSurveyorFolder.zohoFolderId;
    } else {
      surveyorFolderId = await findExistingZohoFolder(mobileNumber, ATTENDANCE_FOLDER_ID, zAccessToken);

      if (surveyorFolderId) {
        console.log(`🎯 Found existing Surveyor Folder directly in Zoho (${mobileNumber}). Re-caching to DB...`);
      } else {
        console.log(`📁 Creating brand-new Surveyor Mobile Folder "${mobileNumber}" inside Attendance Root...`);
        // ✨ FIXED: URL changed to WorkDrive endpoint layout
        const surveyorRes = await axios.post('https://workdrive.zoho.in/api/v1/files', {
          data: { type: "files", attributes: { name: mobileNumber, parent_id: ATTENDANCE_FOLDER_ID } }
        }, {
          headers: { 'Authorization': `Zoho-oauthtoken ${zAccessToken}`, 'Content-Type': 'application/json' }
        });
        surveyorFolderId = surveyorRes.data?.data?.id || surveyorRes.data?.data?.attributes?.id;
      }

      if (!surveyorFolderId) throw new Error("Failed to extract surveyorFolderId.");

      await cacheCollection.updateOne(
        { type: "surveyor", path: surveyorPathKey },
        { $set: { zohoFolderId: surveyorFolderId, createdAt: new Date() } },
        { upsert: true }
      );
    }

    // 🔎 STEP 3: Month Folder Tree (YYYY-MM)
    let monthFolderId;
    const cachedMonthFolder = await cacheCollection.findOne({ type: "month", path: monthPathKey });

    if (cachedMonthFolder) {
      monthFolderId = cachedMonthFolder.zohoFolderId;
    } else {
      monthFolderId = await findExistingZohoFolder(monthFolderName, surveyorFolderId, zAccessToken);

      if (monthFolderId) {
        console.log(`🎯 Found existing Month Folder directly in Zoho (${monthFolderName}). Re-caching to DB...`);
      } else {
        console.log(`📁 Creating Month Folder "${monthFolderName}" inside Surveyor folder...`);
        // ✨ FIXED: URL changed to WorkDrive endpoint layout
        const monthRes = await axios.post('https://workdrive.zoho.in/api/v1/files', {
          data: { type: "files", attributes: { name: monthFolderName, parent_id: surveyorFolderId } }
        }, {
          headers: { 'Authorization': `Zoho-oauthtoken ${zAccessToken}`, 'Content-Type': 'application/json' }
        });
        monthFolderId = monthRes.data?.data?.id || monthRes.data?.data?.attributes?.id;
      }

      if (!monthFolderId) throw new Error("Failed to extract monthFolderId.");

      await cacheCollection.updateOne(
        { type: "month", path: monthPathKey },
        { $set: { zohoFolderId: monthFolderId, createdAt: new Date() } },
        { upsert: true }
      );
    }

    // 🔎 STEP 4: Day Folder Tree (DD)
    let dayFolderId;
    dayFolderId = await findExistingZohoFolder(dayFolderName, monthFolderId, zAccessToken);

    if (dayFolderId) {
      console.log(`🎯 Found existing Day Folder directly in Zoho (${dayFolderName}). Re-caching to DB...`);
    } else {
      console.log(`📁 Creating Day Folder "${dayFolderName}" inside Month Folder...`);
      // ✨ FIXED: URL changed to WorkDrive endpoint layout
      const dayRes = await axios.post('https://workdrive.zoho.in/api/v1/files', {
        data: { type: "files", attributes: { name: dayFolderName, parent_id: monthFolderId } }
      }, {
        headers: { 'Authorization': `Zoho-oauthtoken ${zAccessToken}`, 'Content-Type': 'application/json' }
      });
      dayFolderId = dayRes.data?.data?.id || dayRes.data?.data?.attributes?.id;
    }

    if (!dayFolderId) throw new Error("Failed to extract dayFolderId.");

    await cacheCollection.updateOne(
      { type: "day", path: fullDayPathKey },
      { $set: { zohoFolderId: dayFolderId, createdAt: new Date() } },
      { upsert: true }
    );

    return dayFolderId;
  });
};


const findExistingLeadsFolder = async (folderName, parentFolderId, accessToken) => {
  try {
    const response = await axios.get(`https://workdrive.zoho.in/api/v1/folders/${parentFolderId}/files`, {
      headers: { 'Authorization': `Zoho-oauthtoken ${accessToken}` }
    });

    const items = response.data?.data || [];
    const exactMatch = items.find(item => item.attributes?.name === folderName && item.attributes?.type === 'folder');

    return exactMatch ? exactMatch.id : null;
  } catch (err) {
    console.error(`⚠️ Error scanning Zoho folder for matching name "${folderName}":`, err.message);
    return null;
  }
};


export const getOrCreateLeadsSEFolder = async (dealId, subfolderType, state) => {
  // 🎯 Dynamic State Switch Logic
  const isKerala = state && String(state).trim().toLowerCase() === "kerala";
  const SELECTED_ROOT_ID = isKerala ? ZOHO_ROOT_KERALA : ZOHO_ROOT_TAMILNADU;
  const regionPrefix = isKerala ? "kerala" : "tn";

  const dealPathKey = `${regionPrefix}/${dealId}`;
  const fullSubfolderPathKey = `${regionPrefix}/${dealId}/${subfolderType}`;

  return await withDatabase(MONGODB_URI, async (db) => {
    const cacheCollection = db.collection("zoho_folders");

    const cachedSubfolder = await cacheCollection.findOne({
      type: "leads_se_subfolder",
      path: fullSubfolderPathKey
    });

    if (cachedSubfolder) {
      console.log(`📋 Cache Hit! Found [${regionPrefix.toUpperCase()}] Subfolder [${subfolderType}] ID: ${cachedSubfolder.zohoFolderId}`);
      return cachedSubfolder.zohoFolderId;
    }

    console.log(`📝 Cache Miss! Path [${fullSubfolderPathKey}] not cached. Verifying live folder structure...`);
    const zAccessToken = await getZohoAccessToken(db);

    // =========================================================================
    // 🔍 LIVE DEBUGGING FOOTPRINT PRINT ENGINE
    // =========================================================================
    console.log("-----------------------------------------");
    console.log(`📡 [DEBUG] Target State Context : ${regionPrefix.toUpperCase()}`);
    console.log(`📡 [DEBUG] Selected Root ID     : ${SELECTED_ROOT_ID}`);
    console.log(`📡 [DEBUG] Active OAuth Token    : ${zAccessToken ? `${zAccessToken.substring(0, 15)}... (Truncated)` : "MISSING ❌"}`);
    console.log("-----------------------------------------");
    // =========================================================================

    let dealFolderId;
    const cachedDealFolder = await cacheCollection.findOne({ type: "leads_se_deal", path: dealPathKey });

    if (cachedDealFolder) {
      dealFolderId = cachedDealFolder.zohoFolderId;
    } else {
      dealFolderId = await findExistingLeadsFolder(String(dealId), SELECTED_ROOT_ID, zAccessToken);

      if (dealFolderId) {
        console.log(`🎯 Found existing Deal Folder inside Zoho [${regionPrefix.toUpperCase()}] (${dealId}). Re-caching...`);
      } else {
        console.log(`📁 Creating Deal ID Folder "${dealId}" inside [${regionPrefix.toUpperCase()}] Root...`);
        try {
          const dealRes = await axios.post('https://workdrive.zoho.in/api/v1/files', {
            data: {
              type: "files",
              attributes: {
                name: String(dealId),
                parent_id: SELECTED_ROOT_ID
              }
            }
          }, {
            headers: {
              'Authorization': `Zoho-oauthtoken ${zAccessToken}`,
              'Content-Type': 'application/json'
            }
          });

          dealFolderId = dealRes.data?.data?.id || dealRes.data?.data?.attributes?.id;
        } catch (err) {
          console.error("❌ Zoho API Refused Regional Deal Folder Creation!");
          if (err.response) {
            console.error("🔹 HTTP Status Code:", err.response.status);
            console.error("🔹 Zoho API Raw Payload Details:", JSON.stringify(err.response.data, null, 2));
          } else {
            console.error("🔹 System Error Message:", err.message);
          }
          throw err;
        }
      }

      if (!dealFolderId) throw new Error("Failed to resolve dealFolderId.");

      await cacheCollection.updateOne(
        { type: "leads_se_deal", path: dealPathKey },
        { $set: { zohoFolderId: dealFolderId, createdAt: new Date() } },
        { upsert: true }
      );
    }

    let subfolderFolderId = await findExistingLeadsFolder(subfolderType, dealFolderId, zAccessToken);

    if (subfolderFolderId) {
      console.log(`🎯 Found existing Subfolder [${subfolderType}] inside Zoho Deal. Re-caching...`);
    } else {
      console.log(`📁 Creating Subfolder "${subfolderType}" inside Regional Deal folder [${dealFolderId}]...`);
      try {
        const subfolderRes = await axios.post('https://workdrive.zoho.in/api/v1/files', {
          data: {
            type: "files",
            attributes: {
              name: subfolderType,
              parent_id: dealFolderId
            }
          }
        }, {
          headers: {
            'Authorization': `Zoho-oauthtoken ${zAccessToken}`,
            'Content-Type': 'application/json'
          }
        });

        subfolderFolderId = subfolderRes.data?.data?.id || subfolderRes.data?.data?.attributes?.id;
      } catch (err) {
        console.error(`❌ Zoho API Refused Subfolder [${subfolderType}] Creation!`);
        if (err.response) {
          console.error("🔹 HTTP Status Code:", err.response.status);
          console.error("🔹 Zoho API Raw Payload Details:", JSON.stringify(err.response.data, null, 2));
        } else {
          console.error("🔹 System Error Message:", err.message);
        }
        throw err;
      }
    }

    if (!subfolderFolderId) throw new Error(`Failed to resolve subfolderFolderId for ${subfolderType}.`);

    await cacheCollection.updateOne(
      { type: "leads_se_subfolder", path: fullSubfolderPathKey },
      { $set: { zohoFolderId: subfolderFolderId, createdAt: new Date() } },
      { upsert: true }
    );

    return subfolderFolderId;
  });
};