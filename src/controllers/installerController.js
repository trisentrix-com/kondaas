import { withDatabase } from '../utils/config.js'; 
import admin from "firebase-admin";

const MONGODB_URI = process.env.MONGODB_URI;

const parseTime = (timeStr) => {
  const [time, modifier] = timeStr.split(' ');
  let [hours, minutes] = time.split(':').map(Number);
  if (modifier === 'PM' && hours !== 12) hours += 12;
  if (modifier === 'AM' && hours === 12) hours = 0;
  return hours * 60 + minutes;
};

const epochToDateTime = (epoch) => {
  const IST_OFFSET = 5.5 * 60 * 60 * 1000;
  const istDate = new Date(epoch + IST_OFFSET);
  const year = istDate.getUTCFullYear();
  const month = String(istDate.getUTCMonth() + 1).padStart(2, '0');
  const day = String(istDate.getUTCDate()).padStart(2, '0');
  const date = `${year}${month}${day}`;

  let hours = istDate.getUTCHours();
  const minutes = String(istDate.getUTCMinutes()).padStart(2, '0');
  const modifier = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  const time = `${String(hours).padStart(2, '0')}:${minutes} ${modifier}`;

  return { date, time };
};

export const addLocation = async (c) => {
  try {
    const { phoneNo, latitude, longitude, epoch } = await c.req.json();
    if (!phoneNo || !latitude || !longitude || !epoch) {
      return c.json({ error: "Required fields missing!" }, 400);
    }

    const { date, time } = epochToDateTime(epoch);
    const newEntry = { time, latitude, longitude, isLatest: true };

    return await withDatabase(MONGODB_URI, async (db) => {
      const doc = await db.collection("installer-location").findOne({ phoneNo });

      if (!doc || !doc[date]) {
        // Handle first entry of the day
        await db.collection("installer-location").updateOne(
          { phoneNo },
          { $push: { [date]: newEntry } },
          { upsert: true }
        );
      } else {
        // Recalculate based on time-strings to handle network lag/out-of-order pings
        const entries = [...doc[date], newEntry];
        let latestTime = -1;
        let latestIndex = -1;

        entries.forEach((entry, index) => {
          const entryTime = parseTime(entry.time);
          if (entryTime >= latestTime) {
            latestTime = entryTime;
            latestIndex = index;
          }
        });

        const updatedEntries = entries.map((entry, index) => ({
          ...entry,
          isLatest: index === latestIndex
        }));

        await db.collection("installer-location").updateOne(
          { phoneNo },
          { $set: { [date]: updatedEntries } }
        );
      }
      return c.json({ message: "Location saved successfully!" });
    });
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
};

export const getLocationByTime = async (c) => {
  try {
    const { mobiles, date, startTime, endTime } = await c.req.json();
    if (!mobiles || !date || !startTime || !endTime) return c.json({ error: "Missing fields" }, 400);

    const start = parseTime(startTime);
    const end = parseTime(endTime);

    return await withDatabase(MONGODB_URI, async (db) => {
      const docs = await db.collection("installer-location").find({ phoneNo: { $in: mobiles } }).toArray();
      const result = docs.map((doc) => {
        const entries = doc[date] || [];
        const filtered = entries.filter((entry) => {
          const entryTime = parseTime(entry.time);
          return entryTime >= start && entryTime <= end;
        });
        return { phoneNo: doc.phoneNo, entries: filtered };
      });
      return c.json(result);
    });
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
};

export const getCurrentLocation = async (c) => {
  try {
    const { mobiles } = await c.req.json();
    if (!mobiles) return c.json({ error: "mobiles is required!" }, 400);

    const { date } = epochToDateTime(Date.now());

    return await withDatabase(MONGODB_URI, async (db) => {
      const docs = await db.collection("installer-location").find({ phoneNo: { $in: mobiles } }).toArray();
      const result = docs.map((doc) => {
        const entries = doc[date] || [];
        const latest = entries.find((entry) => entry.isLatest === true);
        return { phoneNo: doc.phoneNo, currentLocation: latest || null };
      });
      return c.json(result);
    });
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
};


export const getLogisticProducts = async (c) => {
  try {
    console.log("📡 Fetching comprehensive list of kondaas-products from Atlas matrix...");

    return await withDatabase(MONGODB_URI, async (db) => {
      // 1. Target the specific kondaas-products collection
      const products = await db.collection("kondaas-products")
        .find({})
        .toArray();

      // 2. Return the data payload with a success status
      return c.json({
        success: true,
        count: products.length,
        data: products
      }, 200);
    });

  } catch (err) {
    console.error("❌ Exception inside getLogisticProducts controller:", err.message);
    return c.json({ 
      success: false, 
      error: "Internal server error fetching logistics inventory catalog",
      details: err.message 
    }, 500);
  }
};


export const notifyInstallerETA = async (c) => {
  try {
    const body = await c.req.json();
    const { logisticMemberNumber, installerNumber, eta } = body;

    // Fast validation check
    if (!installerNumber || !eta) {
      return c.json({ error: "Missing required fields: installerNumber or eta" }, 400);
    }

    return await withDatabase(MONGODB_URI, async (db) => {
      
      // 1. Look up the targeted installer's profile to fetch their active device tokens
      const installerProfile = await db.collection("userDetails").findOne({
        "UserInfo.phoneNo": installerNumber,
        "UserInfo.role": "installer"
      });

      if (!installerProfile) {
        console.log(`⚠️ Installer profile not found for phone number: ${installerNumber}`);
        return c.json({ error: "Target installer profile not found" }, 404);
      }

      // 2. Extract tokens from the installer's devices array
      let installerTokens = [];
      const devices = installerProfile.PlatformInfo?.devices;
      if (devices && Array.isArray(devices)) {
        devices.forEach((device) => {
          if (device.fcmToken) {
            installerTokens.push(device.fcmToken);
          }
        });
      }

      // 3. Send standard push notification to this specific installer
      if (installerTokens.length > 0) {
        const message = {
          notification: {
            title: "Delivery Coming Your Way! 🚚",
            body: `Logistics member (${logisticMemberNumber || 'Team'}) is arriving. ETA: ${eta}.`,
          },
          data: {
            click_action: "FLUTTER_NOTIFICATION_CLICK",
            type: "DELIVERY_ETA"
          },
          tokens: installerTokens,
        };

        const response = await admin.messaging().sendEachForMulticast(message);
        console.log(`🚀 ETA push alert sent to installer (${installerNumber}). Success count: ${response.successCount}`);
      } else {
        console.log(`⚠️ Installer found, but no active FCM tokens registered for phone: ${installerNumber}`);
      }

      return c.json({ 
        success: true, 
        message: "Installer successfully notified of incoming logistics arrival." 
      }, 200);
    });

  } catch (err) {
    console.error("❌ NotifyInstallerETA Endpoint Error:", err.message);
    return c.json({ error: "Internal server error during ETA alert delivery" }, 500);
  }
};
