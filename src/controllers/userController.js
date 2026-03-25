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

export const addUser = async (c) => {
  try {
    const uri = c.env.MONGODB_URI;
    const { firstName, lastName, mobile, address, feedback, ebData } = await c.req.json();

    const existing = await withDatabase(uri, async (db) => {
      return await db.collection("forms").findOne({ mobile: mobile });
    });

    if (existing) {
      return c.json({ error: "Mobile number already registered!" }, 400);
    }

    await withDatabase(uri, async (db) => {
      await db.collection("forms").insertOne({
        firstName,
        lastName,
        mobile,
        address,
        feedback,
        ebData
      });
    });

    return c.json({ message: "User added successfully!" }, 201);

  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
};

export const updateUser = async (c) => {
  try {
    const uri = c.env.MONGODB_URI;
    const { mobile, firstName, lastName, address, feedback, ebData } = await c.req.json();

    const existing = await withDatabase(uri, async (db) => {
      return await db.collection("forms").findOne({ mobile: mobile });
    });

    if (!existing) {
      return c.json({ error: "Mobile number not found!" }, 404);
    }

    await withDatabase(uri, async (db) => {
      await db.collection("forms").updateOne(
        { mobile: mobile },
        { $set: { firstName, lastName, address, feedback, ebData } }
      );
    });

    return c.json({ message: "User updated successfully!" });

  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
};