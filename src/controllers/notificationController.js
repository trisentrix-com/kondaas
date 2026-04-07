import { MongoClient, Binary, ObjectId  } from 'mongodb';

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

//  convert epoch to IST time with AM/PM
const epochToTime = (epoch) => {
  return new Date(epoch).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kolkata'
  });
};

export const addNotification = async (c) => {
  try {
    const uri = c.env.MONGODB_URI;
    const { from, to, mode, content, contentType, status, retryAt, startedAt, retryCount } = await c.req.json();

    if (!from || !to || !mode || !content || !contentType) {
      return c.json({ error: "from, to, mode, content and contentType are required!" }, 400);
    }

    //  convert base64 content to binary for MongoDB
    const contentBinary = new Binary(Buffer.from(content, 'base64'));

    await withDatabase(uri, async (db) => {
      await db.collection("notifications").insertOne({
        from,
        to,
        mode,
        content: contentBinary,
        contentType,
        status: status || "pending",
        retryAt: retryAt ? epochToTime(retryAt) : null,       // ✅ epoch → "10:32 AM"
        startedAt: startedAt ? epochToTime(startedAt) : null, // ✅ epoch → "10:32 AM"
        retryCount: retryCount || 0,
        createdAt: new Date()
      });
    });

    return c.json({ message: "Notification added successfully!" }, 201);

  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
};



export const updateNotification = async (c) => {
  try {
    const uri = c.env.MONGODB_URI;
    const { id, status, retryAt, startedAt, retryCount } = await c.req.json();

    if (!id) {
      return c.json({ error: "id is required!" }, 400);
    }


    const updateFields = {};
    if (status !== undefined) updateFields.status = status;
    if (retryCount !== undefined) updateFields.retryCount = retryCount;
    if (retryAt !== undefined) updateFields.retryAt = retryAt ? epochToTime(retryAt) : null;
    if (startedAt !== undefined) updateFields.startedAt = startedAt ? epochToTime(startedAt) : null;

    if (Object.keys(updateFields).length === 0) {
      return c.json({ error: "No fields to update!" }, 400);
    }

    let notFound = false;
    await withDatabase(uri, async (db) => {
      const existing = await db.collection("notifications").findOne({ _id: new ObjectId(id) });
      if (!existing) {
        notFound = true;
        return;
      }
      await db.collection("notifications").updateOne(
        { _id: new ObjectId(id) },
        { $set: updateFields }
      );
    });

    if (notFound) {
      return c.json({ error: "Notification not found!" }, 404);
    }

    return c.json({ message: "Notification updated successfully!" });

  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
};