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

export const addOrder = async (c) => {
  try {
    const uri = c.env.MONGODB_URI;
    const { name, mobile, whatsappNo, email, city, comment, referredBy, latitude, longitude } = await c.req.json();

    // ✅ only check if whatsappNo is provided
    if (whatsappNo && whatsappNo !== mobile) {
      return c.json({ error: "WhatsApp number must be the same as mobile number!" }, 400);
    }



    await withDatabase(uri, async (db) => {
      await db.collection("order").insertOne({
        name,
        mobile,
        whatsappNo: whatsappNo || null, 
        email: email || null,
        city,
        comment,
        referredBy,
        latitude,
        longitude,

      });
    });

    return c.json({ message: "Order added successfully!" }, 201);

  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
};


export const getOrders = async (c) => {
  try {
    const uri = c.env.MONGODB_URI;

    const orders = await withDatabase(uri, async (db) => {
      return await db.collection("order").find({}).toArray();
    });

    return c.json(orders);

  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
};