import { MongoClient } from 'mongodb';

const withDatabase = async (uri, fn) => {
  const client = new MongoClient(uri, {
    maxPoolSize: 1,
    minPoolSize: 0,
    serverSelectionTimeoutMS: 5000,
    connectTimeoutMS: 5000,
    socketTimeoutMS: 5000,
  });
  try {
    await client.connect();
    const db = client.db("Kondaas");
    return await fn(db);
  } finally {
    await client.close(true);
  }
};

// ─── Haversine Distance (km) ───────────────────────────────────────────────
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

// ─── Get Today's Date in IST (YYYYMMDD) ────────────────────────────────────
function getTodayDate() {
  return new Date()
    .toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" })
    .replace(/-/g, "");
}

const sendFCMNotification = async (fcmToken, customerData, distance, c) => {
  try {
    const bearerToken = c.env.FCM_BEARER_TOKEN;
    if (!bearerToken || !fcmToken) return false;

    // Ensure distance is a valid string for the payload
    const distStr = typeof distance === 'number' ? distance.toFixed(1) : "0.0";

    const payload = {
      message: {
        token: fcmToken,
        notification: {
          title: "New Order Nearby!",
          body: `A customer is ${distStr} km away from you. Tap to accept.`
        },
        // --- Added Android Specific Config for Custom Sound ---
        android: {
          notification: {
            sound: "kondaas",                // Refers to kondaas.mp3 in the app's raw folder
            channel_id: "custom_sound_channel_v2" // Matches the channel created in the app
          }
        },
        // ------------------------------------------------------
        data: {
          type: "new_order",
          customerName: String(customerData.name || "New Customer"),
          distance: distStr,
          customerMobile: String(customerData.mobile || "")
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

    if (response.ok) {
      console.log("✅ FCM Sent with Custom Sound");
      return true;
    } else {
      const errorText = await response.text();
      console.error(`❌ FCM Error: ${response.status} - ${errorText}`);
      return false;
    }
  } catch (err) {
    console.error("❌ FCM Exception:", err.message);
    return false;
  }
};


export const addOrder = async (c) => {
  try {
    const uri = c.env.MONGODB_URI;
    const body = await c.req.json();

    const {
      name,
      mobile,
      whatsappNo,
      email,
      city,
      comment,
      referredBy,
      latitude,
      longitude,
      address
    } = body;

    // 1. Save Lead with status: "unaccepted"
    const lead = await withDatabase(uri, async (db) => {
      // We still use dashes for the database record to keep it readable (YYYY-MM-DD)
      const todayDateOnly = new Date().toLocaleDateString("en-CA", { 
        timeZone: "Asia/Kolkata" 
      });

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
        status: "unaccepted",
        createdAt: todayDateOnly, 
      });

      return {
        _id: result.insertedId,
        name,
        mobile,
        latitude,
        longitude
      };
    });

    console.log(`✅ New lead created with ID: ${lead._id}`);

    // 2. Nearest Worker Assignment + Notification
    if (latitude && longitude) {
      // --- UPDATED: Now using your safety function ---
      const todayKey = getTodayDate(); // Generates "20260413"
      // -----------------------------------------------

      const activeWorkers = await withDatabase(uri, async (db) => {
        return await db.collection("locations")
          .find({ [todayKey]: { $exists: true } })
          .toArray();
      });

      if (activeWorkers.length > 0) {
        const customerLat = parseFloat(latitude);
        const customerLon = parseFloat(longitude);

        const workersWithDistance = activeWorkers
          .map(worker => {
            const todayEntries = worker[todayKey];
            if (!Array.isArray(todayEntries)) return null;

            const latestEntry = todayEntries.find(e => e.isLatest === true);
            if (!latestEntry) return null;

            const dist = haversineDistance(
              customerLat,
              customerLon,
              parseFloat(latestEntry.latitude),
              parseFloat(latestEntry.longitude)
            );

            return {
              phoneNo: worker.phoneNo,
              distance: dist
            };
          })
          .filter(Boolean);

        if (workersWithDistance.length > 0) {
          workersWithDistance.sort((a, b) => a.distance - b.distance);
          const nearestWorker = workersWithDistance[0];

          // Your test token
          const testFcmToken = "dTSLlagcSGaaUL1E06SWKk:APA91bEAdMbrGXCHfyAn3lP7LRVVNYc5y4tGelSc9oy4qkW_QRNJBE-jwPB0-EDH3bNyUFJvRUpMjwBC2kXcWIBqTlTn9oX_8nAnsYk4gOwAKsJQIYXHKz8";

          const customerData = {
            name: lead.name,
            mobile: lead.mobile
          };

          // Trigger the FCM with the custom sound logic we just added
          await sendFCMNotification(testFcmToken, customerData, nearestWorker.distance, c);
        }
      }
    }

    return c.json({
      message: "Order added successfully!",
      id: lead._id
    }, 201);

  } catch (err) {
    console.error("addOrder error:", err.message);
    return c.json({ error: "Internal server error" }, 500);
  }
};




export const rejectOrder = async (c) => {
  try {
    const uri = c.env.MONGODB_URI;
    const boardToken = c.env.BOARD_API_TOKEN;
    
    // 1. Updated request body to use surveyorNumber
    const { mobile, reason, surveyorNumber } = await c.req.json();

    if (!mobile || !reason || !surveyorNumber) {
      return c.json({ error: "Customer mobile, reason, and surveyor number are required" }, 400);
    }

    return await withDatabase(uri, async (db) => {
      // 2. Fetch the Lead details
      const lead = await db.collection("lead").findOne({ mobile });
      
      if (!lead) return c.json({ error: "Lead not found in local DB" }, 404);

      const customerName = lead.name || "Unknown";

      // 3. Prepare Board API Payload
      const boardUrl = "https://board.trisentrix.com/api/boards/MdwEaR2BjBaFJcG6P/lists/Lv8QCE5vvBn4H7XRz/cards";
      
      const payload = {
        authorId: "na9Foqu5XL6YfX2kv", 
        swimlaneId: "fxPfDfFn9wArHSp6M",
        // Updated title with Surveyor info
        title: `${customerName} - ${mobile} (Surveyor: ${surveyorNumber})`,
        // Updated description with Surveyor info
        description: `Reject Reason: ${reason}\n Customer Phone: ${mobile}\n Customer Name: ${customerName}\n Rejected By (Surveyor): ${surveyorNumber}`
      };

      // 4. Post to External Board
      const boardResponse = await fetch(boardUrl, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${boardToken.trim()}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      if (boardResponse.ok) {
        return c.json({ message: "Successfully posted to Trisentrix Board" });
      } else {
        const errorText = await boardResponse.text();
        console.error(`❌ Board Error: ${boardResponse.status} - ${errorText}`);
        return c.json({ error: "Board sync failed" }, 500);
      }
    });

  } catch (err) {
    console.error("rejectOrder error:", err.message);
    return c.json({ error: "Internal server error" }, 500);
  }
};
// ─── Other Controllers (Cleaned) ───────────────────────────────────────────

export const updateOrder = async (c) => {
  try {
    const uri = c.env.MONGODB_URI;
    const { mobile, name, whatsappNo, email, city, comment, referredBy, latitude, longitude, address } = await c.req.json();

    const existing = await withDatabase(uri, async (db) => {
      return await db.collection("lead").findOne({ mobile });
    });

    if (!existing) return c.json({ error: "Order not found!" }, 404);

    if (whatsappNo && whatsappNo !== mobile) {
      return c.json({ error: "WhatsApp number must be the same as mobile number!" }, 400);
    }
    if (!address && (!latitude || !longitude)) {
      return c.json({ error: "Either address or latitude and longitude must be provided!" }, 400);
    }

    await withDatabase(uri, async (db) => {
      await db.collection("lead").updateOne(
        { mobile },
        {
          $set: {
            name,
            whatsappNo: whatsappNo || null,
            email: email || null,
            city,
            comment,
            referredBy,
            latitude: latitude || null,
            longitude: longitude || null,
            address: address || null,
          },
        }
      );
    });

    return c.json({ message: "Order updated successfully!" });

  } catch (err) {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
};

export const updateOrderStatus = async (c) => {
  try {
    const uri = c.env.MONGODB_URI;
    const { mobile, status } = await c.req.json();

    const allowedStatuses = ["accepted", "inprogress", "completed"];
    if (!allowedStatuses.includes(status)) {
      return c.json({ error: "Invalid status! Allowed values are: accepted, inprogress, completed" }, 400);
    }

    const existing = await withDatabase(uri, async (db) => {
      return await db.collection("lead").findOne({ mobile });
    });

    if (!existing) return c.json({ error: "Order not found!" }, 404);

    await withDatabase(uri, async (db) => {
      await db.collection("lead").updateOne(
        { mobile },
        { $set: { status } }
      );
    });

    return c.json({ message: `Order status updated to ${status} successfully!` });

  } catch (err) {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
};

export const getOrders = async (c) => {
  try {
    const uri = c.env.MONGODB_URI;

    const orders = await withDatabase(uri, async (db) => {
      return await db.collection("lead").find({}).toArray();
    });

    return c.json(orders);

  } catch (err) {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
};