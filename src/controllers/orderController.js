import { withDatabase, getSystemKeys } from '../utils/config.js';
import { GoogleAuth } from 'google-auth-library';

const MONGODB_URI = process.env.MONGODB_URI;




function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
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

// 1. Updated FCM function to include kilovolt in the message
const sendFCMNotification = async (deviceToken, customerData, leadId, kilovolt, address) => {
  try {
    if (!deviceToken) return false;

    // 🤖 AUTOMATION MAGIC: This automatically reads aws-wif.json via your environment variable
    const auth = new GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/firebase.messaging']
    });
    const client = await auth.getClient();
    const tokenResponse = await client.getAccessToken();
    const accessToken = tokenResponse.token;

    if (!accessToken) {
      console.error("❌ Failed to automatically generate GCP access token.");
      return false;
    }

    const kvInfo = kilovolt ? ` [${kilovolt}]` : "";
    const addrInfo = address ? ` at ${address}` : "";
    const statusBody = `Customer: ${customerData.name || "New"}${kvInfo}${addrInfo}. Tap to accept.`;

    const payload = {
      message: {
        token: deviceToken.trim(),
        android: {
          priority: "high",
          notification: {
            title: "New Lead Assigned!",
            body: statusBody,
            sound: "kondaas",
            channel_id: "custom_sound_channel_v2",
            click_action: "LEAD_NOTIFICATION_ACTION",
          }
        },
        data: {
          type: "new_order",
          title: "New Lead Assigned!",
          body: statusBody,
          customerName: String(customerData.name || "New Customer"),
          customerMobile: String(customerData.mobile || ""),
          leadId: leadId ? leadId.toString() : "",
          kilovolt: kilovolt ? String(kilovolt) : "",
          address: address || "",
          show_actions: "true"
        }
      }
    };

    const response = await fetch("https://fcm.googleapis.com/v1/projects/kondaas-5dfaa/messages:send", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`, // Using our newly automated token!
        "Content-Type": "application/json; charset=UTF-8"
      },
      body: JSON.stringify(payload)
    });

    return response.ok;
  } catch (err) {
    console.error("❌ FCM Exception:", err.message);
    return false;
  }
};

export const addOrder = async (c) => {
  try {
    const body = await c.req.json();
    const { name, mobile, whatsappNo, email, city, comment, referredBy, latitude, longitude, address, kilovolt } = body;

    return await withDatabase(MONGODB_URI, async (db) => {
      const keys = await getSystemKeys(db);
      const { todayDateOnly, todayKey } = getISTDateStrings();

      // 🔄 UPDATED: Production Board & List Setup for Administration Board
      const boardId = "dbiYtzsTX7BaSX3pk";
      const newEntryListId = "xSfLcnhqcz7h56hPz"; // New leads list
      const flowtrixToken = keys.flowtrix?.boardToken || "fjfOx8r_zrkmU6A4XjBeXqwRvVAlTB7c2eklkav4PHj"; // Fallback token
      
      let flowtrixCardId = null;

      // Sync to Flowtrix FIRST to get the Card ID
      try {
        // Port kept at 8080 for internal docker network communications
        const flowtrixResponse = await fetch(`http://flowtrix:8080/api/boards/${boardId}/lists/${newEntryListId}/cards`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${flowtrixToken}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            title: `${name}-${mobile}`,
            authorId: "Lxc9EwKM5j4ov95ZT",
            swimlaneId: "rF336Crux7KAqNXmQ" // New Administration Swimlane ID
          })
        });

        if (flowtrixResponse.ok) {
          const responseData = await flowtrixResponse.json();
          flowtrixCardId = responseData._id; 
          console.log("✅ Flowtrix Board Sync Successful. Card ID:", flowtrixCardId);
        }
      } catch (syncErr) {
        console.error("❌ Flowtrix Sync failed:", syncErr.message);
      }

      // Save Lead to MongoDB (Including the captured Card ID)
      const result = await db.collection("lead").insertOne({
        name,
        mobile,
        whatsappNo: whatsappNo || null,
        email: email || null,
        city,
        comment,
        referredBy,
        latitude: latitude || null,
        longitude: longitude || null,
        address: address || null,
        kilovolt: kilovolt || null,
        status: "unaccepted",
        flowtrixCardId: flowtrixCardId,
        currentListId: newEntryListId, // Initialized with xSfLcnhqcz7h56hPz
        createdAt: todayDateOnly,
      });

      const leadId = result.insertedId;

      // Notification Logic (FCM)
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
            
            const targetFcmToken = keys.firebase?.testFcmToken; 

            // 🤖 CLEANER & AUTOMATED: Calling the function without passing a manual token parameter
            await sendFCMNotification(
              targetFcmToken, 
              { name, mobile }, 
              leadId, 
              kilovolt, 
              address
            );
          }
        }
      }

      return c.json({ 
        message: "Order added and synced successfully!", 
        id: leadId,
        flowtrixId: flowtrixCardId 
      }, 201);
    });
  } catch (err) {
    console.error("❌ AddOrder Error:", err.message);
    return c.json({ error: "Internal server error" }, 500);
  }
};

export const syncToFlowtrix = async (c) => {
  try {
    const body = await c.req.json();
    const { 
      customerMobile, 
      surveyorNumber, 
      status, 
      receivedAt, // Epoch integer from frontend for Accepted
      startAt,    // Epoch integer from frontend for InProgress
      dueAt,      // Epoch integer from frontend for InProgress
      endAt       // Epoch integer from frontend for Completed
    } = body;

    const listIdMap = {
      "new leads": "xSfLcnhqcz7h56hPz",
      "accepted": "XKJT3KxZr77o9Kmxa",
      "inprogress": "7TrNeSYhfHipPqtch",
      "completed": "zu4QHWmQQ2ydjQtrr"
    };

    const targetListId = listIdMap[status.toLowerCase()];
    if (!targetListId) return c.json({ error: "Invalid or unsupported status for standard sync" }, 400);

    return await withDatabase(MONGODB_URI, async (db) => {
      const keys = await getSystemKeys(db);
      
      const lead = await db.collection("lead").findOne({ 
        $or: [
          { mobile: customerMobile }, 
          { mobile: String(customerMobile) },
          { mobile: Number(customerMobile) }
        ] 
      });

      if (!lead || !lead.flowtrixCardId) {
        console.error(`❌ Lead not found for mobile: ${customerMobile}`);
        return c.json({ error: "Lead not found in database." }, 404);
      }

      const currentOriginId = lead.currentListId || "xSfLcnhqcz7h56hPz";
      console.log(`📡 Moving from: ${currentOriginId} -> To: ${targetListId}`);

      const boardId = "dbiYtzsTX7BaSX3pk";
      const flowtrixToken = keys.flowtrix?.boardToken || "SDkKCXbBAN3tf17Wwa-YPAl6S5dqUS6v_TFWBvaKLwe";

      // 📦 Build the baseline Flowtrix payload
      const flowtrixBody = {
        listId: targetListId, 
        description: `${status.toUpperCase()}/ surveyor number - ${surveyorNumber}`
      };

      // 🔄 Dynamically convert and attach frontend Epoch timestamps to Flowtrix payload ONLY
      const currentStatus = status.toLowerCase();
      
      if (currentStatus === "accepted" && receivedAt) {
        flowtrixBody.receivedAt = new Date(Number(receivedAt)).toISOString();
      } 
      else if (currentStatus === "inprogress") {
        if (startAt) flowtrixBody.startAt = new Date(Number(startAt)).toISOString();
        if (dueAt) flowtrixBody.dueAt = new Date(Number(dueAt)).toISOString();
      } 
      else if (currentStatus === "completed" && endAt) {
        flowtrixBody.endAt = new Date(Number(endAt)).toISOString();
      }

      // Flowtrix API Call (Port 8080)
      const response = await fetch(`http://flowtrix:8080/api/boards/${boardId}/lists/${currentOriginId}/cards/${lead.flowtrixCardId}`, {
        method: "PUT",
        headers: {
          "Authorization": `Bearer ${flowtrixToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(flowtrixBody)
      });

      if (response.ok) {
        // 🔒 SAFE DATABASE UPDATE: Keeps your exact original schema structure
        const updateResult = await db.collection("lead").updateOne(
          { _id: lead._id }, 
          { 
            $set: { 
              currentListId: targetListId, 
              status: status.toLowerCase() 
            } 
          }
        );

        if (updateResult.modifiedCount > 0) {
          console.log(`✅ DB Success: currentListId updated to ${targetListId}`);
        }

        return c.json({ success: true, message: `Moved to ${status}` });
      } else {
        const errorText = await response.text();
        console.error("❌ Flowtrix Error:", errorText);
        return c.json({ error: "Flowtrix update failed", details: errorText }, 500);
      }
    });
  } catch (err) {
    console.error("❌ Exception:", err.message);
    return c.json({ error: "Internal server error" }, 500);
  }
};

export const rejectOrder = async (c) => {
  try {
    const body = await c.req.json();
    const { 
      customerMobile, 
      surveyorNumber, 
      comment,
      receivedAt 
    } = body;

    if (!comment) {
      return c.json({ error: "Rejection reason (comment) is required" }, 400);
    }

    const rejectListId = "KqQcQRx6HubqfH3hz"; 

    return await withDatabase(MONGODB_URI, async (db) => {
      const keys = await getSystemKeys(db);
      
      const lead = await db.collection("lead").findOne({ 
        $or: [
          { mobile: customerMobile }, 
          { mobile: String(customerMobile) },
          { mobile: Number(customerMobile) }
        ] 
      });

      if (!lead || !lead.flowtrixCardId) {
        console.error(`❌ Lead not found for rejection mobile: ${customerMobile}`);
        return c.json({ error: "Lead not found in database." }, 404);
      }

      const currentOriginId = lead.currentListId || "xSfLcnhqcz7h56hPz";
      console.log(`📡 Rejecting Lead: Moving from ${currentOriginId} -> To: ${rejectListId}`);

      const boardId = "dbiYtzsTX7BaSX3pk";
      const flowtrixToken = keys.flowtrix?.boardToken || "SDkKCXbBAN3tf17Wwa-YPAl6S5dqUS6v_TFWBvaKLwe";

      // 📦 Build the rejection payload for Flowtrix external boards
      const flowtrixBody = {
        listId: rejectListId,
        description: `Rejected/ surveyor number - ${surveyorNumber || 'N/A'}`,
        comment: comment
      };

      if (receivedAt) {
        flowtrixBody.receivedAt = new Date(Number(receivedAt)).toISOString();
      }

      // Flowtrix API Call (Port 8080)
      const response = await fetch(`http://flowtrix:8080/api/boards/${boardId}/lists/${currentOriginId}/cards/${lead.flowtrixCardId}`, {
        method: "PUT",
        headers: {
          "Authorization": `Bearer ${flowtrixToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(flowtrixBody)
      });

      if (response.ok) {
        // 🔒 SAFE DATABASE UPDATE: Modifies tracking targets without adding timestamp data
        await db.collection("lead").updateOne(
          { _id: lead._id }, 
          { 
            $set: { 
              currentListId: rejectListId, 
              status: "rejected"
            } 
          }
        );

        console.log(`✅ Lead for mobile ${customerMobile} marked as Rejected.`);
        return c.json({ success: true, message: "Order rejected and synced successfully" });
      } else {
        const errorText = await response.text();
        console.error("❌ Flowtrix Rejection Sync Error:", errorText);
        return c.json({ error: "Flowtrix rejection update failed", details: errorText }, 500);
      }
    });
  } catch (err) {
    console.error("❌ RejectOrder Exception Error:", err.message);
    return c.json({ error: "Internal server error" }, 500);
  }
};



export const updateOrder = async (c) => {
  try {
    const body = await c.req.json();
    const { mobile } = body;

    return await withDatabase(MONGODB_URI, async (db) => {
      const existing = await db.collection("lead").findOne({ mobile });
      if (!existing) return c.json({ error: "Order not found!" }, 404);

      const { name, whatsappNo, email, city, comment, referredBy, latitude, longitude, address } = body;

      await db.collection("lead").updateOne(
        { mobile },
        { $set: { name, whatsappNo: whatsappNo || null, email: email || null, city, comment, referredBy, latitude, longitude, address } }
      );
      return c.json({ message: "Order updated successfully!" });
    });
  } catch (err) {
    return c.json({ error: "Internal server error" }, 500);
  }
};

export const updateOrderStatus = async (c) => {
  try {
    const { mobile, status } = await c.req.json();
    if (!["accepted", "inprogress", "completed"].includes(status)) {
      return c.json({ error: "Invalid status" }, 400);
    }

    return await withDatabase(MONGODB_URI, async (db) => {
      const result = await db.collection("lead").updateOne({ mobile }, { $set: { status } });
      if (result.matchedCount === 0) return c.json({ error: "Order not found!" }, 404);
      return c.json({ message: `Order status updated to ${status}` });
    });
  } catch (err) {
    return c.json({ error: "Internal server error" }, 500);
  }
};

export const getOrders = async (c) => {
  try {
    const orders = await withDatabase(MONGODB_URI, async (db) => {
      return await db.collection("lead").find({}).toArray();
    });
    return c.json(orders);
  } catch (err) {
    return c.json({ error: "Internal server error" }, 500);
  }
};