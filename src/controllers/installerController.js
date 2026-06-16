import { withDatabase } from '../utils/config.js'; 

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

export const createInstallerProduct = async (c) => {
  try {
    const body = await c.req.json();
    const { mobile, productName, productPrice, manufacturedDate } = body;

    // 1. Full Payload Validation
    if (!mobile || !productName || productPrice === undefined || productPrice === null || !manufacturedDate) {
      return c.json({ 
        error: "Validation Error: 'mobile', 'productName', 'productPrice', and 'manufacturedDate' are all required fields." 
      }, 400);
    }

    // 2. Data Sanitization & Formatting
    const cleanedMobile = String(mobile).trim();
    const cleanedProductName = String(productName).trim();
    
    // Validate Price
    const parsedPrice = parseFloat(productPrice);
    if (isNaN(parsedPrice) || parsedPrice < 0) {
      return c.json({ error: "Validation Error: 'productPrice' must be a valid positive number." }, 400);
    }

    // Validate and Parse Manufacturing Date
    const parsedMfgDate = new Date(manufacturedDate);
    if (isNaN(parsedMfgDate.getTime())) {
      return c.json({ error: "Validation Error: 'manufacturedDate' is invalid. Please use a standard format (e.g., YYYY-MM-DD)." }, 400);
    }

    // 3. Persist to MongoDB Atlas
    return await withDatabase(MONGODB_URI, async (db) => {
      const collection = db.collection("installer-products");

      const newInstallerRecord = {
        mobile: cleanedMobile,
        productName: cleanedProductName,
        productPrice: parsedPrice,
        manufacturedDate: parsedMfgDate,
        createdAt: new Date(), // Record tracking timestamp,
        status: "pickup" 
      };

      console.log(`📦 Storing comprehensive Installer product details for mobile: ${cleanedMobile}...`);
      
      const insertResult = await collection.insertOne(newInstallerRecord);

      return c.json({
        success: true,
        message: "Installer product and pricing records successfully stored.",
        recordId: insertResult.insertedId
      }, 201);
    });

  } catch (err) {
    console.error("❌ Installer Product Capture Exception:", err.message);
    return c.json({ error: "Internal server error" }, 500);
  }
};