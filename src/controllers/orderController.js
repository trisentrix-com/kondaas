import { withDatabase, getSystemKeys } from '../utils/config.js';
import { getZohoAccessToken } from '../utils/zohoAuth.js'; // 🔑 Imported from your utils helper!

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

/**
 * 📥 Add Order (Create Lead inside Zoho CRM & Init Surveyor Dispatch Queue)
 */
export const addOrder = async (c) => {
  try {
    const body = await c.req.json();
    const { name, mobile, whatsappNo, email, city, comment, referredBy, latitude, longitude, address, kilovolt } = body;

    return await withDatabase(MONGODB_URI, async (db) => {
      const { todayKey } = getISTDateStrings();

      // 🔐 Grab active authorization credentials from your clean utility file
      const zohoToken = await getZohoAccessToken(db);

      // 🗺️ Build a clean descriptive string for coordinates since Zoho layout has no dedicated lat/long boxes
      const geoInfo = latitude && longitude ? `[Coordinates: ${latitude}, ${longitude}]\n` : '';
      const finalDescription = `${geoInfo}${comment || ''}`.trim();

      
      const zohoPayload = {
        data: [
          {
            Last_Name: name || "Unknown Lead",        
            Customer_Name: name || "Unknown Lead",    
            Mobile: String(mobile),
            Whatsapp_Number: whatsappNo ? String(whatsappNo) : null,
            Email: email || null,
            City: city || null,                        
            Street: address || null,                  
            Description: finalDescription || null,
            Wattage_Required: kilovolt ? String(kilovolt) : null
            
          }
        ]
      };

      console.log(`📡 Sending validated layout payload to Zoho CRM for customer: ${name}`);

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

      // 🔍 Extract the unique Zoho Record String ID!
      const zohoLeadId = statusBlock.details.id;
      console.log(`✅ Record successfully provisioned. Zoho Lead ID: ${zohoLeadId}`);

      // 📡 Proximity Geolocation Scan and Worker Assignment Routing (Kept completely functional)
      if (latitude && longitude) {
        const activeWorkers = await db.collection("locations")
          .find({ [todayKey]: { $exists: true } }).toArray();

        if (activeWorkers.length > 0) {
          const customerLat = parseFloat(latitude);
          const customerLon = parseFloat(longitude);

          const workersWithDistance = activeWorkers.map(worker => {
            const latestEntry = worker[todayKey]?.find(e => e.isLatest === true);
            if (!latestEntry) return null;

            return {
              phoneNo: worker.phoneNo,
              distance: haversineDistance(customerLat, customerLon, parseFloat(latestEntry.latitude), parseFloat(latestEntry.longitude))
            };
          }).filter(Boolean);

          if (workersWithDistance.length > 0) {
            workersWithDistance.sort((a, b) => a.distance - b.distance);
            
            console.log(`📋 Sorted ${workersWithDistance.length} surveyors by proximity for Zoho Lead ID: ${zohoLeadId}`);
            
            // 🚀 Insert assignment task into local background queue using Zoho ID
            await db.collection("jobs_queue").insertOne({
              taskType: "SURVEYOR_CASCADING_DISPATCH",
              leadId: zohoLeadId, // Cleanly mapped to Zoho's String ID instead of an old Mongo object!
              surveyorsList: workersWithDistance, 
              currentIndex: 0,                                    
              status: "pending",
              runAt: new Date()                                  
            });

            console.log(`⏳ Cascading dispatch engine task initialized for Zoho Lead ID: ${zohoLeadId}`);
          }
        }
      }

      return c.json({ 
        success: true,
        message: "Order added and Zoho CRM cascading routing started successfully!", 
        id: zohoLeadId
      }, 201);
    });
  } catch (err) {
    console.error("❌ AddOrder Error Exception:", err.message);
    return c.json({ error: "Internal server error" }, 500);
  }
};

/**
 * ❌ Reject Order (Logs logs into local admin_reject only)
 */
export const rejectOrder = async (c) => {
  try {
    const body = await c.req.json();
    const { customerMobile, surveyorNumber, comment, receivedAt } = body;

    if (!comment) {
      return c.json({ error: "Rejection reason (comment) is required" }, 400);
    }

    return await withDatabase(MONGODB_URI, async (db) => {
      // Safe local insert maintaining standard auditing schemas exclusively
      const adminRejectPayload = {
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

/**
 * 📋 Get Admin Rejection History Logs
 */
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

/**
 * 📝 Update Order Profile Parameters inside Zoho CRM
 */
export const updateOrder = async (c) => {
  try {
    const body = await c.req.json();
    const { name, mobile, whatsappNo, email, city, comment, latitude, longitude, address, kilovolt } = body;

    return await withDatabase(MONGODB_URI, async (db) => {
      const zohoToken = await getZohoAccessToken(db);

      const searchResponse = await fetch(`https://www.zohoapis.in/crm/v8/Leads/search?phone=${mobile}`, {
        method: "GET",
        headers: { "Authorization": `Zoho-oauthtoken ${zohoToken}` }
      });

      const searchResult = await searchResponse.json();
      const zohoRecord = searchResult.data?.[0];

      if (!zohoRecord?.id) return c.json({ error: "Lead profile not found in Zoho CRM." }, 404);

      const geoInfo = latitude && longitude ? `[Coordinates: ${latitude}, ${longitude}]\n` : '';
      const finalDescription = `${geoInfo}${comment || ''}`.trim();

      const updatePayload = {
        data: [
          {
            id: zohoRecord.id,
            Last_Name: name,
            Customer_Name: name,
            Mobile: String(mobile),
            Whatsapp_Number: whatsappNo ? String(whatsappNo) : null,
            Email: email || null,
            City: city || null,
            Street: address || null,
            Description: finalDescription || null,
            Wattage_Required: kilovolt ? String(kilovolt) : null
          }
        ]
      };

      const response = await fetch(`https://www.zohoapis.in/crm/v8/Leads/${zohoRecord.id}`, {
        method: "PUT",
        headers: {
          "Authorization": `Zoho-oauthtoken ${zohoToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(updatePayload)
      });

      if (!response.ok) return c.json({ error: "Failed to update record inside Zoho." }, 500);
      return c.json({ message: "Zoho CRM profile data synchronized cleanly!" });
    });
  } catch (err) {
    return c.json({ error: "Internal server error" }, 500);
  }
};

/**
 * 📊 Get Orders (Fetches live list directly from Zoho using field parameters)
 */
export const getOrders = async (c) => {
  try {
    return await withDatabase(MONGODB_URI, async (db) => {
      const zohoToken = await getZohoAccessToken(db);

      // Explicitly specify required fields string matching your layout blueprint
      const fieldsParam = "Last_Name,Customer_Name,Mobile,Whatsapp_Number,Email,City,Lead_Status,Street,Description,Wattage_Required";
      
      const response = await fetch(`https://www.zohoapis.in/crm/v8/Leads?fields=${fieldsParam}&per_page=50`, {
        method: "GET",
        headers: {
          "Authorization": `Zoho-oauthtoken ${zohoToken}`,
          "Content-Type": "application/json"
        }
      });

      if (!response.ok) {
        const errTxt = await response.text();
        console.error("❌ Zoho Fetch Leads failed:", errTxt);
        return c.json({ error: "Failed to retrieve records from Zoho." }, 500);
      }

      const result = await response.json();
      
      // Remap Zoho keys to clean output variables for mobile client rendering uniformity
      const orders = (result.data || []).map(lead => {
        const coordMatch = lead.Description?.match(/\[Coordinates:\s*([^,]+),\s*([^\]]+)\]/);
        return {
          id: lead.id,
          name: lead.Customer_Name || lead.Last_Name,
          mobile: lead.Mobile,
          whatsappNo: lead.Whatsapp_Number,
          email: lead.Email,
          city: lead.City,
          address: lead.Street,
          comment: lead.Description?.replace(/\[Coordinates:\s*[^\]]+\]\n?/, ''),
          status: lead.Lead_Status?.toLowerCase() || "unaccepted",
          latitude: coordMatch ? coordMatch[1] : null,
          longitude: coordMatch ? coordMatch[2] : null,
          kilovolt: lead.Wattage_Required
        };
      });

      return c.json(orders);
    });
  } catch (err) {
    return c.json({ error: "Internal server error" }, 500);
  }
};

/**
 * 🗑️ Delete Order (Deletes record permanently from Zoho CRM)
 */
export const deleteOrder = async (c) => {
  try {
    const body = await c.req.json();
    const { mobile } = body;

    if (!mobile) return c.json({ error: "Customer mobile number is required to delete a lead" }, 400);

    return await withDatabase(MONGODB_URI, async (db) => {
      const zohoToken = await getZohoAccessToken(db);

      const searchResponse = await fetch(`https://www.zohoapis.in/crm/v8/Leads/search?phone=${mobile}`, {
        method: "GET",
        headers: { "Authorization": `Zoho-oauthtoken ${zohoToken}` }
      });

      const searchResult = await searchResponse.json();
      const zohoRecord = searchResult.data?.[0];

      if (!zohoRecord?.id) return c.json({ error: "Lead not found in Zoho CRM database." }, 404);

      console.log(`🗑️ Erasing record from Zoho CRM matching ID: ${zohoRecord.id}`);

      const response = await fetch(`https://www.zohoapis.in/crm/v8/Leads/${zohoRecord.id}`, {
        method: "DELETE",
        headers: { "Authorization": `Zoho-oauthtoken ${zohoToken}` }
      });

      if (!response.ok) return c.json({ error: "Zoho CRM deletion operation failed." }, 500);

      console.log(`✅ Successfully deleted lead with mobile: ${mobile} from Zoho CRM.`);
      return c.json({ success: true, message: "Lead record deleted successfully from Zoho CRM." }, 200);
    });
  } catch (err) {
    console.error("❌ deleteOrder Exception Error:", err.message);
    return c.json({ error: "Internal server error" }, 500);
  }
};