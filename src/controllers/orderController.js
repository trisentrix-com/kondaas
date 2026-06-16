import { withDatabase, getSystemKeys } from '../utils/config.js';
import { getZohoAccessToken } from '../utils/zohoAuth.js'; // 🔑 Imported from your utils helper!
import admin from 'firebase-admin';

const MONGODB_URI = process.env.MONGODB_URI;

// 🧮 Geolocation mathematical routing formula
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Radius of the earth in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) *
    Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const getISTDateStrings = () => {
  const date = new Date();
  const todayDateOnly = date.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const todayKey = todayDateOnly.replace(/-/g, "");
  return { todayDateOnly, todayKey };
};

export const addOrder = async (c) => {
  try {
    const body = await c.req.json();
    
    // 🔍 Extract identifying info for the Zoho entry
    const mobile = body.mobileNumber || body.mobile || body.Mobile; 
    const customerName = body.customerName || body.firstName || body.First_Name;

    // 🛑 Strict Business Rule: Mobile Number is mandatory for Zoho Leads
    if (!mobile) {
      return c.json({ error: "Validation Error: Mobile number field is required to register a lead." }, 400);
    }

    return await withDatabase(MONGODB_URI, async (db) => {
      // 🔐 Grab active authorization credentials dynamically
      const zohoToken = await getZohoAccessToken(db);

      // 🏷️ Compute mandatory fallback fields
      const computedLastName = body.lastName || body.Last_Name || body.firstName || body.First_Name || customerName || "Unknown Lead";

      // 📦 Pure Dynamic Payload Builder
      const zohoPayload = {
        data: [
          {
            ...body,
            Last_Name: computedLastName,
            Mobile: String(mobile)
          }
        ]
      };

      console.log(`📡 Forwarding pure dynamic payload to Zoho CRM for customer: ${customerName || 'New Lead'}`);

      const zohoResponse = await fetch("https://www.zohoapis.in/crm/v8/Leads", {
        method: "POST",
        headers: {
          "Authorization": `Zoho-oauthtoken ${zohoToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(zohoPayload)
      });

      if (!zohoResponse.ok) {
        const errDetails = await zohoResponse.text();
        console.error("❌ Zoho Insertion Blocked:", errDetails);
        return c.json({ error: "Failed to create lead inside Zoho CRM module.", details: errDetails }, 500);
      }

      const zohoResult = await zohoResponse.json();
      const statusBlock = zohoResult.data?.[0];

      if (statusBlock?.status !== "success") {
        return c.json({ error: "High level payload error rejected by Zoho.", details: statusBlock }, 400);
      }

      const zohoLeadId = statusBlock.details.id;
      console.log(`✅ Record successfully provisioned. Zoho Lead ID: ${zohoLeadId}`);

      return c.json({ 
        success: true,
        message: "Order successfully added and synced with Zoho.", 
        id: zohoLeadId
      }, 201);
    });
  } catch (err) {
    console.error("❌ AddOrder Error Exception:", err.message);
    return c.json({ error: "Internal server error" }, 500);
  }
};

export const rejectOrder = async (c) => {
  try {
    const body = await c.req.json();
    const { customerMobile, surveyorNumber, comment, receivedAt,name,address } = body;

    if (!comment) {
      return c.json({ error: "Rejection reason (comment) is required" }, 400);
    }

    return await withDatabase(MONGODB_URI, async (db) => {
      // Safe local insert maintaining standard auditing schemas exclusively
      const adminRejectPayload = {
        name: name,
        address: address,
        surveyorNumber: surveyorNumber || "N/A",
        customerMobile: customerMobile,
        comment: comment,
        time: receivedAt ? new Date(Number(receivedAt)).toISOString() : null
      };

      await db.collection("admin_reject").insertOne(adminRejectPayload);
      console.log(`✅ Rejection tracked locally in admin_reject collection for surveyor: ${surveyorNumber}`);
      
      return c.json({ success: true, message: "Order rejection cataloged locally." });
    });
  } catch (err) {
    console.error("❌ RejectOrder Exception Error:", err.message);
    return c.json({ error: "Internal server error" }, 500);
  }
};

export const completeOrder = async (c) => {
  try {
    const body = await c.req.json();
    const { customerMobile, surveyorNumber, receivedAt,name,address } = body;

    return await withDatabase(MONGODB_URI, async (db) => {
      // Safe local insert maintaining standard auditing schemas exclusively
      const adminCompletePayload = {
        surveyorNumber: surveyorNumber || "N/A",
        customerMobile: customerMobile,
        name: name,
        address: address,
        time: receivedAt ? new Date(Number(receivedAt)).toISOString() : null
      };

      await db.collection("admin_complete").insertOne(adminCompletePayload);
      console.log(`✅ Completion tracked locally in admin_complete collection for surveyor: ${surveyorNumber}`);
      
      return c.json({ success: true, message: "Order completion cataloged locally." });
    });
  } catch (err) {
    console.error("❌ Completion Exception Error:", err.message);
    return c.json({ error: "Internal server error" }, 500);
  }
};

export const getAdminRejections = async (c) => {
  try {
    return await withDatabase(MONGODB_URI, async (db) => {
      const rejections = await db.collection("admin_reject").find({}).sort({ time: -1 }).toArray();
      return c.json({ success: true, count: rejections.length, data: rejections }, 200);
    });
  } catch (err) {
    return c.json({ error: "Internal server error" }, 500);
  }
};

export const getAdminCompletions = async (c) => {
  try {
    return await withDatabase(MONGODB_URI, async (db) => {
      const completions = await db.collection("admin_complete").find({}).sort({ time: -1 }).toArray();
      return c.json({ success: true, count: completions.length, data: completions }, 200);
    });
  } catch (err) {
    return c.json({ error: "Internal server error" }, 500);
  }
};

export const updateOrder = async (c) => {
  try {
    const body = await c.req.json();
    
    // 🛑 Strict Business Rule: Explicit Zoho 'id' string is mandatory to target the right lead
    if (!body.id) {
      return c.json({ error: "Validation Error: A specific Zoho 'id' field is required to update an order." }, 400);
    }

    const targetZohoId = body.id;

    return await withDatabase(MONGODB_URI, async (db) => {
      // 🔐 Grab active authorization credentials dynamically
      const zohoToken = await getZohoAccessToken(db);

      // 📦 Build the pure dynamic update payload
      const zohoPayload = {
        data: [
          {
            // Inject the specific ID inside the data block array as mandated by Zoho API guidelines
            id: targetZohoId,

            // 🚀 Directly dump every single other field passed from the frontend completely as-is
            ...body
          }
        ]
      };

      console.log(`📡 Forwarding pure target update to Zoho CRM for explicit Record ID: ${targetZohoId}`);

      // 3. Make the PUT update request directly to that specific record's endpoint string
      const response = await fetch(`https://www.zohoapis.in/crm/v8/Leads/${targetZohoId}`, {
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
        return c.json({ error: "Failed to update record inside Zoho CRM module.", details: errDetails }, 500);
      }

      return c.json({ 
        success: true, 
        message: "Targeted Zoho CRM profile data synchronized cleanly!", 
        id: targetZohoId 
      });
    });
  } catch (err) {
    console.error("❌ UpdateOrder Error Exception:", err.message);
    return c.json({ error: "Internal server error" }, 500);
  }
};

export const updateSurveyStatus = async (c) => {
  try {
    const body = await c.req.json();
    const { id, status } = body;

    // 1. Parameter Validation
    if (!id || !status) {
      return c.json({ error: "Validation Error: Missing required fields 'id' or 'status'." }, 400);
    }

    // Standardize input string for robust comparison matching
    const normalizedStatus = status.toLowerCase().trim().replace(/[\s_]+/g, '-');

    // 2. Exact Mapping to Zoho's case-sensitive dropdown configurations
    let zohoValue = null;

    if (normalizedStatus === "scheduled") {
      zohoValue = "Scheduled";
    } else if (normalizedStatus === "rejected") {
      zohoValue = "Rejected";
    } else if (normalizedStatus === "completed") {
      zohoValue = "Completed";
    } else if (normalizedStatus === "accepted") {
      zohoValue = "Accepted";
    } else if (normalizedStatus === "inprogress" || normalizedStatus === "in-progress") {
      zohoValue = "In-Progress"; // 🎯 Matches your specific capital letters and hyphen!
    }

    // Fallback if the requested value doesn't match your system options
    if (!zohoValue) {
      return c.json({ 
        error: `Validation Error: '${status}' is not recognized. Must be one of: scheduled, rejected, completed, accepted, inprogress` 
      }, 400);
    }

    return await withDatabase(MONGODB_URI, async (db) => {
      // 🔐 Grab active authorization credentials dynamically from your config / DB
      const zohoToken = await getZohoAccessToken(db);

      // 3. Build the precise payload using the perfectly formatted zohoValue
      const zohoPayload = {
        data: [
          {
            id: String(id),
            Site_Survey_Status: zohoValue 
          }
        ]
      };

      console.log(`📡 Transmitting Targeted Dropdown Update to Zoho CRM Deals for record ID: ${id} -> Value: ${zohoValue}...`);

      // 4. 🚀 FIX: Switched module path from /Leads/ to /Deals/ to target converted profiles
      const response = await fetch(`https://www.zohoapis.in/crm/v8/Deals/${id}`, {
        method: "PUT",
        headers: {
          "Authorization": `Zoho-oauthtoken ${zohoToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(zohoPayload)
      });

      if (!response.ok) {
        const errTxt = await response.text();
        console.error("❌ Zoho Dropdown Update execution failed:", errTxt);
        return c.json({ error: "Failed to update record state on Zoho.", details: errTxt }, 500);
      }

      const result = await response.json();
      console.log("✅ Zoho Server Response Status Payload:", JSON.stringify(result));

      return c.json({ 
        success: true, 
        message: `Zoho Site Survey Status successfully transitioned to '${zohoValue}' inside Deals module.`,
        id: id
      });
    });

  } catch (err) {
    console.error("❌ Dropdown Update Exception Error:", err.message);
    return c.json({ error: "Internal server error" }, 500);
  }
};


export const updateLocalDealSurveyStatus = async (c) => {
  try {
    const body = await c.req.json();
    const { deal_id, siteSurveyStatus } = body;

    // 🛑 Validation: Ensure we have the target deal and the status payload
    if (!deal_id || !siteSurveyStatus) {
      return c.json({ error: "Missing required fields: deal_id or siteSurveyStatus" }, 400);
    }

    // Standardize status format (converts "In Progress" or "in-progress" -> "inprogress")
    const cleanedStatus = siteSurveyStatus.toLowerCase().replace(/[\s-_]/g, '').trim();

    // Strict validation to keep your frontend status filtering working smoothly
    const allowedStatuses = ["accepted", "inprogress", "completed"];
    if (!allowedStatuses.includes(cleanedStatus)) {
      return c.json({ 
        error: `Invalid status setup. Must be one of: ${allowedStatuses.join(", ")}` 
      }, 400);
    }

    return await withDatabase(MONGODB_URI, async (db) => {
      
      console.log(`🔄 Updating local status for Deal [${deal_id}] to matching state: ${cleanedStatus}`);

      // Update document parameters inside your local MongoDB "deals" collection
      const result = await db.collection("deals").updateOne(
        { deal_id: deal_id },
        { 
          $set: { 
            siteSurveyStatus: cleanedStatus,
            updatedAt: new Date().toISOString()
          } 
        }
      );

      if (result.matchedCount === 0) {
        console.log(`⚠️ No local record found to track for Deal ID: ${deal_id}`);
        return c.json({ error: "Deal record not found in local tracking matrix." }, 404);
      }

      console.log(`✅ Successfully shifted status for Deal [${deal_id}] to pipeline flag: ${cleanedStatus}`);

      return c.json({ 
        success: true, 
        message: `Site survey stage successfully shifted to ${cleanedStatus}.`,
        deal_id: deal_id,
        currentLocalStatus: cleanedStatus
      }, 200);
    });

  } catch (err) {
    console.error("❌ Update Local Survey Status Exception:", err.message);
    return c.json({ error: "Internal server error updating local pipeline flags" }, 500);
  }
};

export const getOrders = async (c) => {
  try {
    return await withDatabase(MONGODB_URI, async (db) => {
      // 🔐 Grab active authorization credentials dynamically out of RAM / config collection
      const zohoToken = await getZohoAccessToken(db);

      // 🏷️ Requesting all necessary Deal layout parameters from Zoho CRM
      const fieldsParam = "id,Deal_Name,Contact_Name,Mobile,WhatsApp_Number,Email,Stage,Description,Wattage_Required,Created_Time,Site_Survey_Status," +
                          "Address_City,Address_Street_Address,Address_Coordinates_Latitude,Address_Coordinates_Longitude," +
                          "City,Street_Address,Latitude,Longitude";
      
      console.log("📡 Admin Dashboard: Fetching active records from Zoho Deals engine...");
      
      const response = await fetch(`https://www.zohoapis.in/crm/v8/Deals?fields=${fieldsParam}&per_page=50`, {
        method: "GET",
        headers: {
          "Authorization": `Zoho-oauthtoken ${zohoToken}`,
          "Content-Type": "application/json"
        }
      });

      if (!response.ok) {
        const errTxt = await response.text();
        console.error("❌ Zoho Fetch Deals failed for Admin:", errTxt);
        return c.json({ error: "Failed to retrieve records from Zoho Deals module." }, 500);
      }

      const result = await response.json();
      
      // Remap Zoho API Deal fields to clean, standardized JSON keys for your Admin Mobile UI
      const orders = (result.data || []).map(deal => {
        const rawStatus = deal.Site_Survey_Status || "";
        const cleanedSurveyStatus = rawStatus.toLowerCase().replace('-', '').trim();

        return {
          id: deal.id, 
          name: deal.Deal_Name || (deal.Contact_Name ? deal.Contact_Name.name : "Unknown Customer"),
          mobile: deal.Mobile || null,
          whatsappNo: deal.WhatsApp_Number || null,
          email: deal.Email || null,
          
          // Dual Fallback Mapping logic matching your current CRM setup layouts
          city: deal.Address_City || deal.City || null,
          address: deal.Address_Street_Address || deal.Street_Address || null,
          latitude: deal.Address_Coordinates_Latitude || deal.Latitude || null,
          longitude: deal.Address_Coordinates_Longitude || deal.Longitude || null,
          
          comment: deal.Description || "",
          status: deal.Stage?.toLowerCase() || "unaccepted", 
          siteSurveyStatus: cleanedSurveyStatus || "accepted",
          kilovolt: deal.Wattage_Required || null,
          
          // Extract the profile creation timestamp cleanly
          date: deal.Created_Time || null 
        };
      });

      return c.json(orders);
    });
  } catch (err) {
    console.error("❌ GetOrders (Deals Mapping) Error Exception:", err.message);
    return c.json({ error: "Internal server error" }, 500);
  }
};
/**
 * 🗑️ Delete Order (Searches Zoho CRM by mobile number field key and deletes the record)
 */
export const deleteOrder = async (c) => {
  try {
    const body = await c.req.json();
    
    // 🛑 Strict Business Rule: Explicit Zoho 'id' string is mandatory to target the precise deal
    if (!body.id) {
      return c.json({ error: "Validation Error: A specific Zoho 'id' field is required to delete an order." }, 400);
    }

    const targetZohoId = body.id;

    return await withDatabase(MONGODB_URI, async (db) => {
      // 🔐 Grab active authorization credentials dynamically
      const zohoToken = await getZohoAccessToken(db);

      console.log(`🗑️ Initializing targeted erasure from Zoho CRM for Deal ID: ${targetZohoId}`);

      // 1. Send the HTTP DELETE request straight to Zoho's explicit DEALS endpoint
      const response = await fetch(`https://www.zohoapis.in/crm/v8/Deals/${targetZohoId}`, {
        method: "DELETE",
        headers: { 
          "Authorization": `Zoho-oauthtoken ${zohoToken}` 
        }
      });

      if (!response.ok) {
        const errDetails = await response.text();
        console.error("❌ Zoho Deletion Blocked:", errDetails);
        return c.json({ error: "Zoho CRM deletion operation failed.", details: errDetails }, 500);
      }

      console.log(`✅ Successfully deleted deal with ID: ${targetZohoId} from Zoho CRM.`);

      // 2. 🧹 LOCAL CLEANUP: Also remove the assignment tracking record from your local MongoDB
      const dbCleanup = await db.collection("deals").deleteOne({ deal_id: targetZohoId });
      
      if (dbCleanup.deletedCount > 0) {
        console.log(`🧹 Local DB Cleanup: Removed deal ${targetZohoId} from local 'deals' collection.`);
      } else {
        console.log(`ℹ️ Local DB Cleanup: No local assignment document found for deal ${targetZohoId}.`);
      }
      
      return c.json({ 
        success: true, 
        message: "Deal record deleted successfully from Zoho CRM and local tracking.",
        id: targetZohoId
      }, 200);
    });
  } catch (err) {
    console.error("❌ DeleteOrder Error Exception:", err.message);
    return c.json({ error: "Internal server error" }, 500);
  }
};

export const handleZohoDealWebhook = async (c) => {
  try {
    let payload = {};
    
    // 1. Grab any URL query string parameters (e.g., ?deal_id=123)
    const queryParams = c.req.query();
    if (Object.keys(queryParams).length > 0) {
      payload = { ...payload, ...queryParams };
    }

    // 2. Read the raw text body to handle direct streams safely
    const rawText = await c.req.text();
    
    if (rawText && rawText.trim().length > 0) {
      try {
        // Check if it's a pure JSON string
        const parsedJson = JSON.parse(rawText);
        payload = { ...payload, ...parsedJson };
      } catch {
        // If it's a form-encoded string (key1=val1&key2=val2)
        const searchParams = new URLSearchParams(rawText);
        const formObj = Object.fromEntries(searchParams.entries());
        payload = { ...payload, ...formObj };
      }
    }

    console.log("==================== 🔔 ZOHO WEBHOOK TRIPPED ====================");
    console.log("Incoming Payload Data:", JSON.stringify(payload, null, 2));
    console.log("================================================================");

    // Execute database operations safely using your wrapper
    return await withDatabase(MONGODB_URI, async (db) => {
      
      // 1. Query for all users whose role is admin
      const admins = await db.collection("userDetails")
        .find({ "UserInfo.role": "admin" })
        .toArray();

      console.log(`🔍 DB Check: Found ${admins.length} matching admin documents.`);

      // 2. Safely collect all active fcmTokens into a clean array
      let fcmTokens = [];
      admins.forEach((adminUser, idx) => {
        console.log(`👤 Processing Admin [${idx}]: Phone: ${adminUser.UserInfo?.phoneNo || "N/A"}`);
        
        const devices = adminUser.PlatformInfo?.devices;
        if (devices && Array.isArray(devices)) {
          console.log(`📱 Found ${devices.length} devices mapped for this admin.`);
          devices.forEach((device, dIdx) => {
            console.log(`   👉 Device [${dIdx}] Token State:`, device.fcmToken ? "Token Available" : "Token is EMPTY/MISSING");
            if (device.fcmToken) {
              fcmTokens.push(device.fcmToken);
            }
          });
        } else {
          console.log(`⚠️ Admin [${idx}] has no active 'PlatformInfo.devices' array structure.`);
        }
      });

      console.log("📊 Total Collected Admin Tokens Array Count:", fcmTokens.length);

      // 3. Fire notifications if any admin devices were tracked down
      if (fcmTokens.length > 0) {
        const message = {
          notification: {
            title: "New Deal Created! 🚀",
            body: `Deal: ${payload.deal_name || "New Opportunity"} is now in ${payload.stage || "Qualification"}.`,
          },
          data: {
            deal_id: payload.deal_id || "",
          },
          tokens: fcmTokens,
        };

        const response = await admin.messaging().sendEachForMulticast(message);
        console.log(`✅ Push notifications dispatched successfully to ${response.successCount} admin devices.`);
      } else {
        console.log("⚠️ No active admin FCM tokens found in the database.");
      }

      return c.json({ success: true, message: "Captured and notifications processed" }, 200);
    });

  } catch (err) {
    console.error("❌ Webhook Processing Error Exception:", err.message);
    return c.json({ error: "Failed to process deal webhook pipeline" }, 500);
  }
};


export const assignDealToSurveyor = async (c) => {
  try {
    const body = await c.req.json();
    
    // Extract everything matching your clean getOrders/Deals layout mapping
    const { 
      id, // This is your deal_id from Zoho
      name, // This is the Deal_Name / Contact_Name
      mobile,
      whatsappNo,
      email,
      city,
      address,
      latitude,
      longitude,
      comment,
      status,
      kilovolt,
      date,
      surveyorNumber // The phone number the admin picked
    } = body;

    if (!id || !surveyorNumber) {
      return c.json({ error: "Missing required fields: id (deal_id) or surveyorNumber" }, 400);
    }

    return await withDatabase(MONGODB_URI, async (db) => {
      
      // 1. Pack the complete matching layout structure to save into your local DB
      const fullDealPayload = {
        deal_id: id,
        deal_name: name || "New Site Opportunity",
        mobile: mobile || null,
        whatsappNo: whatsappNo || null,
        email: email || null,
        city: city || null,
        address: address || null,
        latitude: latitude || null,
        longitude: longitude || null,
        comment: comment || "",
        status: status || "unaccepted",
        siteSurveyStatus:"notassigned",
        kilovolt: kilovolt || null,
        date: date || null,
        assignedTo: surveyorNumber,
        assignedAt: new Date().toISOString(),
      };

      // Update or insert the full document layout into your local database
      await db.collection("deals").updateOne(
        { deal_id: id },
        { $set: fullDealPayload },
        { upsert: true }
      );

      console.log(`🎯 Complete Deal payload for [${id}] successfully mapped to surveyor: ${surveyorNumber}`);

      // 2. Look up the specific surveyor's profile to get their FCM tokens
      const surveyorProfile = await db.collection("userDetails").findOne({
        "UserInfo.phoneNo": surveyorNumber,
        "UserInfo.role": "surveyor"
      });

      if (!surveyorProfile) {
        console.log(`⚠️ Assignment saved, but surveyor profile not found for number: ${surveyorNumber}`);
        return c.json({ success: true, message: "Deal assigned locally, but surveyor profile missing." }, 200);
      }

      // 3. Extract tokens from the surveyor's devices array
      let surveyorTokens = [];
      const devices = surveyorProfile.PlatformInfo?.devices;
      if (devices && Array.isArray(devices)) {
        devices.forEach((device) => {
          if (device.fcmToken) {
            surveyorTokens.push(device.fcmToken);
          }
        });
      }

      // 4. Send targeted push notification to this specific surveyor
      if (surveyorTokens.length > 0) {
        const message = {
          notification: {
            title: "New Job Assigned! 📋",
            body: `You have been assigned to site survey: ${fullDealPayload.deal_name}.`,
          },
          data: {
            deal_id: id,
            click_action: "FLUTTER_NOTIFICATION_CLICK",
            type: "ASSIGNMENT"
          },
          tokens: surveyorTokens,
        };

        const response = await admin.messaging().sendEachForMulticast(message);
        console.log(`🚀 Notification sent to surveyor (${surveyorNumber}). Success count: ${response.successCount}`);
      } else {
        console.log(`⚠️ Surveyor found, but no active FCM tokens registered for phone: ${surveyorNumber}`);
      }

      return c.json({ success: true, message: "Deal successfully assigned and surveyor notified with full record fields." }, 200);
    });

  } catch (err) {
    console.error("❌ Assignment Endpoint Error:", err.message);
    return c.json({ error: "Internal server error during assignment pipeline" }, 500);
  }
};


export const getSurveyorDeals = async (c) => {
  try {
    // Grab the logged-in surveyor's mobile number sent from their app
    const { surveyorNumber } = c.req.query();

    if (!surveyorNumber) {
      return c.json({ error: "Missing surveyor identity verification parameter" }, 400);
    }

    return await withDatabase(MONGODB_URI, async (db) => {
      
      // Query the deals collection looking strictly for matches against their phone number
      const assignedDeals = await db.collection("deals")
        .find({ assignedTo: surveyorNumber })
        .sort({ assignedAt: -1 }) // Sort so newest jobs pop up first
        .toArray();

      console.log(`📱 Surveyor Workspace [${surveyorNumber}] loaded. Sent back ${assignedDeals.length} detailed tasks.`);

      // Send the entire structure back exactly how the UI models expect it
      return c.json({ success: true, deals: assignedDeals }, 200);
    });

  } catch (err) {
    console.error("❌ Fetch Surveyor Dashboard Exception:", err.message);
    return c.json({ error: "Failed to pull surveyor task workspace" }, 500);
  }
};