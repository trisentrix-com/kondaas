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
      // 1. Get System Keys from DB
      const keys = await getSystemKeys(db);
      const { todayDateOnly, todayKey } = getISTDateStrings();

      // 2. Save Lead to MongoDB
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
        createdAt: todayDateOnly,
      });

      const leadId = result.insertedId;

      // 3. Sync to Flowtrix Board
      const dbBoardToken = keys.flowtrix?.boardToken?.trim();
      if (dbBoardToken) {
        try {
          await fetch("http://flowtrix:8080/api/boards/kALDJ4Yi9Q78wuDnZ/lists/rGsxfBXrLqm7b8M4f/cards", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${dbBoardToken}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              title: `${name} - ${mobile}`,
              description: `New Entry\n Phone: ${mobile}\n Name: ${name}`,
              authorId: "rithikuser001",
              swimlaneId: "qWzLaocWgSMpBBS6z"
            })
          });
          console.log("✅ Flowtrix Board Sync Successful");
        } catch (syncErr) {
          console.error("❌ Flowtrix Sync failed:", syncErr.message);
        }
      }

      // 4. Notification Logic
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
            
            // DYNAMIC TOKENS: Pulling from the DB 'keys' object
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

      return c.json({ message: "Order added and synced successfully!", id: leadId }, 201);
    });
  } catch (err) {
    console.error("❌ AddOrder Error:", err.message);
    return c.json({ error: "Internal server error" }, 500);
  }
};


export const rejectOrder = async (c) => {
  try {
    const { mobile, surveyorNumber, reason } = await c.req.json();

    if (!mobile) {
      return c.json({ error: "Mobile number is required" }, 400);
    }

    return await withDatabase(MONGODB_URI, async (db) => {
      // 1. VALIDATION: Check if this lead exists in our DB first
      const leadExists = await db.collection("lead").findOne({ mobile });

      if (!leadExists) {
        console.warn(`⚠️ Rejection blocked: Mobile ${mobile} not found in database.`);
        return c.json({ error: "No lead found with this mobile number. Rejection ignored." }, 404);
      }

      // 2. Get the token from DB
      const keys = await getSystemKeys(db);
      const boardToken = keys.flowtrix?.boardToken?.trim();

      if (boardToken) {
        try {
          // 3. POST to Flowtrix (Now that we know the lead is real)
          const boardResponse = await fetch("http://flowtrix:8080/api/boards/kALDJ4Yi9Q78wuDnZ/lists/4TP3iFH6AhAoxysuA/cards", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${boardToken}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              title: `${mobile}`,
              description: `Phone: ${mobile}\n Surveyor number : ${surveyorNumber}\nReject Reason: ${reason}`,
              authorId: "rithikuser001",
              swimlaneId: "qWzLaocWgSMpBBS6z"
            })
          });

          if (boardResponse.ok) {
            console.log(`✅ Rejection synced for verified lead: ${mobile}`);
            return c.json({ message: "Rejected and synced successfully" });
          } else {
            return c.json({ error: "Board sync failed" }, 500);
          }
        } catch (syncErr) {
          console.error("❌ Network Error reaching Flowtrix:", syncErr.message);
          return c.json({ error: "Flowtrix API unreachable" }, 500);
        }
      }

      return c.json({ error: "Authentication token not found" }, 500);
    });
  } catch (err) {
    return c.json({ error: "Internal server error" }, 500);
  }
};


export const completeOrder = async (c) => {
  try {
    const { mobile, surveyorNumber } = await c.req.json();

    return await withDatabase(MONGODB_URI, async (db) => {
      const keys = await getSystemKeys(db);
      const lead = await db.collection("lead").findOne({ mobile });

      if (!lead) return c.json({ error: "Lead not found" }, 404);

      // CHANGED: Use flowtrix instead of trisentrix
      const token = keys?.flowtrix?.boardToken;

      if (!token) return c.json({ error: "Flowtrix board token missing in DB" }, 500);

      const boardResponse = await fetch("https://smugger-milagros-semblably.ngrok-free.dev/api/boards/xJQn5HmYG4P6n6ijY/lists/drznJ9DKKkhiZ4FGp/cards", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token.trim()}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          authorId: "LeuLZuxmRPqH3hY3o",
          swimlaneId: "24SZXeX95zNYKrsno",
          title: `${lead.name} - ${mobile}`,
          description: `Completed\n Phone: ${mobile}\n Surveyor number : ${surveyorNumber}`
        })
      });

      if (boardResponse.ok) {
        return c.json({ message: "Completed and synced locally" });
      } else {
        const errorData = await boardResponse.text();
        console.error("Board sync failed:", errorData);
        return c.json({ error: "Board sync failed" }, 500);
      }
    });
  } catch (err) {
    console.error("Internal server error:", err);
    return c.json({ error: "Internal server error" }, 500);
  }
};

export const acceptOrder = async (c) => {
  try {
    const { mobile, surveyorNumber } = await c.req.json();

    return await withDatabase(MONGODB_URI, async (db) => {
      const keys = await getSystemKeys(db);
      const lead = await db.collection("lead").findOne({ mobile });

      if (!lead) return c.json({ error: "Lead not found" }, 404);

      // CHANGED: Use flowtrix instead of trisentrix
      const token = keys?.flowtrix?.boardToken;

      if (!token) return c.json({ error: "Flowtrix board token missing in DB" }, 500);

      const boardResponse = await fetch("https://smugger-milagros-semblably.ngrok-free.dev/api/boards/xJQn5HmYG4P6n6ijY/lists/7xsP7NWGxHLfGqkPL/cards", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token.trim()}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          authorId: "LeuLZuxmRPqH3hY3o",
          swimlaneId: "24SZXeX95zNYKrsno",
          title: `${lead.name} - ${mobile}`,
          description: `Accepted\n Phone: ${mobile}\n Surveyor number : ${surveyorNumber}`
        })
      });

      if (boardResponse.ok) {
        return c.json({ message: "Completed and synced locally" });
      } else {
        const errorData = await boardResponse.text();
        console.error("Board sync failed:", errorData);
        return c.json({ error: "Board sync failed" }, 500);
      }
    });
  } catch (err) {
    console.error("Internal server error:", err);
    return c.json({ error: "Internal server error" }, 500);
  }
};

export const inprogressOrder = async (c) => {
  try {
    const { mobile, surveyorNumber } = await c.req.json();

    return await withDatabase(MONGODB_URI, async (db) => {
      const keys = await getSystemKeys(db);
      const lead = await db.collection("lead").findOne({ mobile });

      if (!lead) return c.json({ error: "Lead not found" }, 404);

      // CHANGED: Use flowtrix instead of trisentrix
      const token = keys?.flowtrix?.boardToken;

      if (!token) return c.json({ error: "Flowtrix board token missing in DB" }, 500);

      const boardResponse = await fetch("https://smugger-milagros-semblably.ngrok-free.dev/api/boards/xJQn5HmYG4P6n6ijY/lists/7ZH3sbjMTCj4kBDgM/cards", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token.trim()}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          authorId: "LeuLZuxmRPqH3hY3o",
          swimlaneId: "24SZXeX95zNYKrsno",
          title: `${lead.name} - ${mobile}`,
          description: `Inprogress\n Phone: ${mobile}\n Surveyor number : ${surveyorNumber}`
        })
      });

      if (boardResponse.ok) {
        return c.json({ message: "Completed and synced locally" });
      } else {
        const errorData = await boardResponse.text();
        console.error("Board sync failed:", errorData);
        return c.json({ error: "Board sync failed" }, 500);
      }
    });
  } catch (err) {
    console.error("Internal server error:", err);
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