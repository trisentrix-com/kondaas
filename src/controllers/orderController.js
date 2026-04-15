import { MongoClient } from 'mongodb';
import { getSystemKeys } from '../utils/config.js'; // Assumes this is where the utility lives

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

// --- UPDATED: Takes bearerToken as an argument now ---
const sendFCMNotification = async (deviceToken, customerData, distance, bearerToken) => {
  try {
    if (!bearerToken || !deviceToken) return false;

    const distStr = typeof distance === 'number' ? distance.toFixed(1) : "0.0";

    const payload = {
      message: {
        token: deviceToken,
        notification: {
          title: "New Order Nearby!",
          body: `A customer is ${distStr} km away from you. Tap to accept.`
        },
        android: {
          notification: {
            sound: "kondaas",
            channel_id: "custom_sound_channel_v2"
          }
        },
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

    return response.ok;
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
      name, mobile, whatsappNo, email, city, comment,
      referredBy, latitude, longitude, address
    } = body;

    return await withDatabase(uri, async (db) => {
      // Fetch DB keys
      const keys = await getSystemKeys(db);

      const todayDateOnly = new Date().toLocaleDateString("en-CA", { 
        timeZone: "Asia/Kolkata" 
      });

      const result = await db.collection("lead").insertOne({
        name, mobile, whatsappNo: whatsappNo || null,
        email: email || null, city, comment, referredBy,
        latitude: latitude || null, longitude: longitude || null,
        address: address || null, status: "unaccepted",
        createdAt: todayDateOnly, 
      });

      const leadId = result.insertedId;

      // Nearest Worker Assignment
      if (latitude && longitude) {
        const todayKey = getTodayDate();
        const activeWorkers = await db.collection("locations")
          .find({ [todayKey]: { $exists: true } })
          .toArray();

        if (activeWorkers.length > 0) {
          const customerLat = parseFloat(latitude);
          const customerLon = parseFloat(longitude);

          const workersWithDistance = activeWorkers.map(worker => {
            const todayEntries = worker[todayKey];
            const latestEntry = todayEntries?.find(e => e.isLatest === true);
            if (!latestEntry) return null;

            return {
              phoneNo: worker.phoneNo,
              distance: haversineDistance(
                customerLat, customerLon,
                parseFloat(latestEntry.latitude), parseFloat(latestEntry.longitude)
              )
            };
          }).filter(Boolean);

          if (workersWithDistance.length > 0) {
            workersWithDistance.sort((a, b) => a.distance - b.distance);
            const nearestWorker = workersWithDistance[0];

            // Use test token for now, but use FCM token from DB keys
            const testFcmToken = "dzsOBEHPRGeTtZIjOWcQac:APA91bHdkfJhL6w37tcv0cOjMg74lJTJsTbCZPzjkPz6hfSt3dYyRx88ecFgMeAHSmpYzQKBu-U0ze0kvkN9H9vwr1keaQw-mR-n4zmEMXvp7xzOg6HV5E0";
            
            await sendFCMNotification(
                testFcmToken, 
                { name, mobile }, 
                nearestWorker.distance, 
                keys.firebase.fcmToken
            );
          }
        }
      }

      return c.json({ message: "Order added successfully!", id: leadId }, 201);
    });

  } catch (err) {
    return c.json({ error: "Internal server error" }, 500);
  }
};

export const rejectOrder = async (c) => {
  try {
    const uri = c.env.MONGODB_URI;
    const { mobile, reason, surveyorNumber } = await c.req.json();

    if (!mobile || !reason || !surveyorNumber) {
      return c.json({ error: "Required fields missing" }, 400);
    }

    return await withDatabase(uri, async (db) => {
      const keys = await getSystemKeys(db);
      const lead = await db.collection("lead").findOne({ mobile });
      
      if (!lead) return c.json({ error: "Lead not found" }, 404);
     
      const boardResponse = await fetch("https://board.trisentrix.com/api/boards/MdwEaR2BjBaFJcG6P/lists/Lv8QCE5vvBn4H7XRz/cards", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${keys.trisentrix.boardToken.trim()}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          authorId: "na9Foqu5XL6YfX2kv", 
          swimlaneId: "fxPfDfFn9wArHSp6M",
          title: `${lead.name} - ${mobile} (Surveyor: ${surveyorNumber})`,
          description: `Reject Reason: ${reason}\n Surveyor: ${surveyorNumber}`
        })
      });

      return boardResponse.ok ? c.json({ message: "Rejected and synced" }) : c.json({ error: "Board sync failed" }, 500);
    });
  } catch (err) {
    return c.json({ error: "Internal server error" }, 500);
  }
};

export const completeOrder = async (c) => {
  try {
    const uri = c.env.MONGODB_URI;
    const { mobile, surveyorNumber } = await c.req.json();

    return await withDatabase(uri, async (db) => {
      const keys = await getSystemKeys(db);
      const lead = await db.collection("lead").findOne({ mobile });
      
      if (!lead) return c.json({ error: "Lead not found" }, 404);

      const boardResponse = await fetch("https://board.trisentrix.com/api/boards/MdwEaR2BjBaFJcG6P/lists/uWQW5XKbrMZESKKMv/cards", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${keys.trisentrix.boardToken.trim()}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          authorId: "na9Foqu5XL6YfX2kv", 
          swimlaneId: "fxPfDfFn9wArHSp6M",
          title: `${lead.name} - ${mobile}`,
          description: `Completed by Surveyor: ${surveyorNumber}`
        })
      });

      return boardResponse.ok ? c.json({ message: "Completed and synced" }) : c.json({ error: "Board sync failed" }, 500);
    });
  } catch (err) {
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