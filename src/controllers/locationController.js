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
  const d = new Date(epoch);

  const date = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
                .replace(/-/g, ''); 

  const time = d.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kolkata'
  });  

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

    // ✅ receive epoch for start and end time
    const { mobiles, startEpoch, endEpoch } = await c.req.json();

    if (!mobiles || !startEpoch || !endEpoch) {
      return c.json({ error: "mobiles, startEpoch and endEpoch are required!" }, 400);
    }

    // ✅ convert epochs to date and time
    const { date, time: startTime } = epochToDateTime(startEpoch);
    const { time: endTime } = epochToDateTime(endEpoch);

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

    // ✅ receive epoch for date
    const { mobiles, epoch } = await c.req.json();

    if (!mobiles || !epoch) {
      return c.json({ error: "mobiles and epoch are required!" }, 400);
    }

    // ✅ convert epoch to date
    const { date } = epochToDateTime(epoch);

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