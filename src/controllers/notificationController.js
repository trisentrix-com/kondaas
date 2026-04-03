import { MongoClient, Binary } from 'mongodb';

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

export const addNotification = async (c) => {
  try {
    const uri = c.env.MONGODB_URI;
    const { from, to, mode, content, contentType, status, retryAt, startedAt, retryCount } = await c.req.json();

    if (!from || !to || !mode || !content || !contentType) {
      return c.json({ error: "from, to, mode, content and contentType are required!" }, 400);
    }

    // ✅ convert base64 content to binary for MongoDB
    const contentBinary = new Binary(Buffer.from(content, 'base64'));

    await withDatabase(uri, async (db) => {
      await db.collection("notifications").insertOne({
        from,
        to,
        mode,
        content: contentBinary,
        contentType,
        status: status || "pending",
        retryAt: retryAt || null,
        startedAt: startedAt || null,
        retryCount: retryCount || 0,
        createdAt: new Date()  // ← MongoDB auto time
      });
    });

    return c.json({ message: "Notification added successfully!" }, 201);

  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
};