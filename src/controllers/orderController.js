import { withDatabase, getSystemKeys } from '../utils/config.js';

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
const sendFCMNotification = async (deviceToken, customerData, bearerToken, leadId, kilovolt, address) => {
  try {
    if (!deviceToken || !bearerToken) return false;

    const kvInfo = kilovolt ? ` [${kilovolt}]` : "";
    const addrInfo = address ? ` at ${address}` : "";
    // Prepare the string once to ensure consistency
    const statusBody = `Customer: ${customerData.name || "New"}${kvInfo}${addrInfo}. Tap to accept.`;

    const payload = {
      message: {
        token: deviceToken.trim(),
        // We REMOVE the global 'notification' key here.
        // This stops the "N/A" ghost notification from the System Brain.
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
        "Authorization": `Bearer ${bearerToken.trim()}`,
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

      // 1. New Flowtrix Config from your KT
      const boardId = "2FswXA8aPgN77czTc";
      const newEntryListId = "MdzfSFNPpJK2kJwtE";
      const flowtrixToken = "RbVRbci-5iBEZ8NtaWpDagU8FiwQwdDD6nOEqCcmBbw";
      
      let flowtrixCardId = null;

      // 2. Sync to Flowtrix FIRST to get the Card ID
      try {
        const flowtrixResponse = await fetch(`http://flowtrix:8080/api/boards/${boardId}/lists/${newEntryListId}/cards`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${flowtrixToken}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            title: `${name} - ${mobile}`,
            description: `New Entry\n Phone: ${mobile}\n Name: ${name}`,
            authorId: "Lxc9EwKM5j4ov95ZT",
            swimlaneId: "ce7E2A4yMHQ4dnyC5"
          })
        });

        if (flowtrixResponse.ok) {
          const responseData = await flowtrixResponse.json();
          // This is the 'fecMFhX3vDPkuCkHF' style ID we need for the PUT requests later
          flowtrixCardId = responseData._id; 
          console.log("✅ Flowtrix Board Sync Successful. Card ID:", flowtrixCardId);
        }
      } catch (syncErr) {
        console.error("❌ Flowtrix Sync failed:", syncErr.message);
      }

      // 3. Save Lead to MongoDB (Including the captured Card ID)
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
        currentListId: "MdzfSFNPpJK2kJwtE", 
        createdAt: todayDateOnly,
      });

      const leadId = result.insertedId;

      // 4. Notification Logic (FCM)
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
            const bearerToken = keys.firebase?.fcmToken;

            await sendFCMNotification(
              targetFcmToken, 
              { name, mobile }, 
              bearerToken, 
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
    const { customerMobile, surveyorNumber, status } = await c.req.json();

    const listIdMap = {
      "accepted": "mtcXAPeWbNmFYfTAX",
      "inprogress": "BNynXwMhgJfGpmWfX",
      "completed": "A4p7fzj8975NAmjny",
      "rejected": "FARBgod3N6na4iFok"
    };

    const targetListId = listIdMap[status.toLowerCase()];
    if (!targetListId) return c.json({ error: "Invalid status" }, 400);

    return await withDatabase(MONGODB_URI, async (db) => {
      // 1. Find the lead (Trying both String and Number types to be safe)
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

      const currentOriginId = lead.currentListId || "MdzfSFNPpJK2kJwtE";
      console.log(`📡 Moving from: ${currentOriginId} -> To: ${targetListId}`);

      const boardId = "2FswXA8aPgN77czTc";
      const flowtrixToken = "RbVRbci-5iBEZ8NtaWpDagU8FiwQwdDD6nOEqCcmBbw";

      // 2. Flowtrix API Call
      const response = await fetch(`http://flowtrix:8080/api/boards/${boardId}/lists/${currentOriginId}/cards/${lead.flowtrixCardId}`, {
        method: "PUT",
        headers: {
          "Authorization": `Bearer ${flowtrixToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          listId: targetListId, 
          description: `${status.toUpperCase()}\n Surveyor: ${surveyorNumber}`
        })
      });

      if (response.ok) {
        // 3. SECURE DB UPDATE: Use the unique _id from the lead we just found
        const updateResult = await db.collection("lead").updateOne(
          { _id: lead._id }, 
          { $set: { currentListId: targetListId } }
        );

        if (updateResult.modifiedCount > 0) {
          console.log(`✅ DB Success: currentListId updated to ${targetListId}`);
        } else {
          console.warn("⚠️ Flowtrix moved, but DB already had this List ID.");
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