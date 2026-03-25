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

export const addLocation = async (c) => {
  try {
    const uri = c.env.MONGODB_URI;
    const { mobile, lat, long } = await c.req.json();

    const today = new Date();
    const dateStr = today.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const date = dateStr.replace(/-/g, '');

    const time = today.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      timeZone: 'Asia/Kolkata'
    });

    const newEntry = {
      time: time,
      lat: lat,
      long: long,
      isLatest: true
    };

    const existing = await withDatabase(uri, async (db) => {
      return await db.collection("locations").findOne({ mobile: mobile });
    });

    if (!existing) {
      await withDatabase(uri, async (db) => {
        await db.collection("locations").insertOne({
          mobile: mobile,
          [date]: [newEntry]
        });
      });
    } else {
      await withDatabase(uri, async (db) => {
        await db.collection("locations").updateOne(
          { mobile: mobile },
          { $push: { [date]: { ...newEntry, isLatest: false } } }
        );

        const doc = await db.collection("locations").findOne({ mobile: mobile });
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
          { mobile: mobile },
          { $set: { [date]: updatedEntries } }
        );
      });
    }

    return c.json({ message: "Location saved successfully!" });

  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
};

export const getLocationByTime = async (c) => {
  try {
    const uri = c.env.MONGODB_URI;
    const { mobiles, startTime, endTime, date } = await c.req.json();

    const docs = await withDatabase(uri, async (db) => {
      return await db.collection("locations").find({ mobile: { $in: mobiles } }).toArray();
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
        mobile: doc.mobile,
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

    const today = new Date();
    const dateStr = today.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const date = dateStr.replace(/-/g, '');

    const docs = await withDatabase(uri, async (db) => {
      return await db.collection("locations").find({ mobile: { $in: mobiles } }).toArray();
    });

    const result = docs.map((doc) => {
      const entries = doc[date] || [];
      const latest = entries.find((entry) => entry.isLatest === true);
      return {
        mobile: doc.mobile,
        currentLocation: latest || null
      };
    });

    return c.json(result);

  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
};