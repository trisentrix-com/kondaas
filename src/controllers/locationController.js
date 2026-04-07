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

const parseTime = (timeStr) => {
  const [time, modifier] = timeStr.split(' ');
  let [hours, minutes] = time.split(':').map(Number);
  if (modifier === 'PM' && hours !== 12) hours += 12;
  if (modifier === 'AM' && hours === 12) hours = 0;
  return hours * 60 + minutes;
};

// ✅ converts epoch to date and time
const epochToDateTime = (epoch) => {
  const IST_OFFSET = 5.5 * 60 * 60 * 1000; // IST = UTC + 5:30
  const istDate = new Date(epoch + IST_OFFSET);

  const year = istDate.getUTCFullYear();
  const month = String(istDate.getUTCMonth() + 1).padStart(2, '0');
  const day = String(istDate.getUTCDate()).padStart(2, '0');
  const date = `${year}${month}${day}`; // → "20260406"

  let hours = istDate.getUTCHours();
  const minutes = String(istDate.getUTCMinutes()).padStart(2, '0');
  const modifier = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  const time = `${String(hours).padStart(2, '0')}:${minutes} ${modifier}`; // → "11:20 AM"

  return { date, time };
};

export const addLocation = async (c) => {
  try {
    const uri = c.env.MONGODB_URI;

  
    const { phoneNo, latitude, longitude, epoch } = await c.req.json();

    if (!phoneNo || !latitude || !longitude || !epoch) {
      return c.json({ error: "phoneNo, latitude, longitude and epoch are required!" }, 400);
    }

   
    const { date, time } = epochToDateTime(epoch);  //epoch-convert//

    const newEntry = {
      time: time,
      latitude: latitude,
      longitude: longitude,
      isLatest: true
    };

    await withDatabase(uri, async (db) => {
      const existing = await db.collection("locations").findOne({ phoneNo: phoneNo });

      if (!existing) {
        await db.collection("locations").insertOne({
          phoneNo: phoneNo,
          [date]: [newEntry]
        });
      } else {
        await db.collection("locations").updateOne(
          { phoneNo: phoneNo },
          { $push: { [date]: { ...newEntry, isLatest: false } } }
        );

        const doc = await db.collection("locations").findOne({ phoneNo: phoneNo });
        const entries = doc[date] || [];

        let latestIndex = 0;
        let latestTime = 0;
        entries.forEach((entry, index) => {
          const entryTime = parseTime(entry.time);
          if (entryTime > latestTime) {
            latestTime = entryTime;
            latestIndex = index;
          }
        });

        const updatedEntries = entries.map((entry, index) => ({
          ...entry,
          isLatest: index === latestIndex
        }));

        await db.collection("locations").updateOne(
          { phoneNo: phoneNo },
          { $set: { [date]: updatedEntries } }
        );
      }
    });

    return c.json({ message: "Location saved successfully!" });

  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
};

export const getLocationByTime = async (c) => {
  try {
    const uri = c.env.MONGODB_URI;
    const { mobiles, date, startTime, endTime } = await c.req.json();

    if (!mobiles || !date || !startTime || !endTime) {
      return c.json({ error: "mobiles, date, startTime and endTime are required!" }, 400);
    }

    const docs = await withDatabase(uri, async (db) => {
      return await db.collection("locations").find({ phoneNo: { $in: mobiles } }).toArray();
    });

    const start = parseTime(startTime);
    const end = parseTime(endTime);

    const result = docs.map((doc) => {
      const entries = doc[date] || [];
      const filtered = entries.filter((entry) => {
        const entryTime = parseTime(entry.time);
        return entryTime >= start && entryTime <= end;
      });
      return {
        phoneNo: doc.phoneNo,
        entries: filtered
      };
    });

    return c.json(result);

  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
};

export const getCurrentLocation = async (c) => {
  try {
    const uri = c.env.MONGODB_URI;
    const { mobiles } = await c.req.json();

    if (!mobiles) {
      return c.json({ error: "mobiles is required!" }, 400);
    }

    // ✅ backend calculates today's date automatically
    const IST_OFFSET = 5.5 * 60 * 60 * 1000;
    const istDate = new Date(Date.now() + IST_OFFSET);
    const year = istDate.getUTCFullYear();
    const month = String(istDate.getUTCMonth() + 1).padStart(2, '0');
    const day = String(istDate.getUTCDate()).padStart(2, '0');
    const date = `${year}${month}${day}`;

    const docs = await withDatabase(uri, async (db) => {
      return await db.collection("locations").find({ phoneNo: { $in: mobiles } }).toArray();
    });

    const result = docs.map((doc) => {
      const entries = doc[date] || [];
      const latest = entries.find((entry) => entry.isLatest === true);
      return {
        phoneNo: doc.phoneNo,
        currentLocation: latest || null
      };
    });

    return c.json(result);

  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
};