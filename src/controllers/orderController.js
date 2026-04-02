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
    const { name, mobile, whatsappNo, email, city, comment, referredBy, latitude, longitude, address } = await c.req.json();

    if (whatsappNo && whatsappNo !== mobile) {
      return c.json({ error: "WhatsApp number must be the same as mobile number!" }, 400);
    }
    if (!address && (!latitude || !longitude)) {
      return c.json({ error: "Either address or latitude and longitude must be provided!" }, 400);
    }

    await withDatabase(uri, async (db) => {
      await db.collection("lead").insertOne({
        name,
        mobile,
        whatsappNo: whatsappNo || null,
        email: email || null,
        city,
        comment,
        referredBy,
        latitude: latitude || null,
        longitude: longitude || null,
        address: address || null,
        status: "unassigned"
      });
    });

    return c.json({ message: "Order added successfully!" }, 201);

  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
};

export const updateOrder = async (c) => {
  try {
    const uri = c.env.MONGODB_URI;
    const { mobile, name, whatsappNo, email, city, comment, referredBy, latitude, longitude, address } = await c.req.json();

    const existing = await withDatabase(uri, async (db) => {
      return await db.collection("lead").findOne({ mobile: mobile });
    });

    if (!existing) {
      return c.json({ error: "Order not found!" }, 404);
    }

    if (whatsappNo && whatsappNo !== mobile) {
      return c.json({ error: "WhatsApp number must be the same as mobile number!" }, 400);
    }

    if (!address && (!latitude || !longitude)) {
      return c.json({ error: "Either address or latitude and longitude must be provided!" }, 400);
    }

    await withDatabase(uri, async (db) => {
      await db.collection("lead").updateOne(
        { mobile: mobile },
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
            address: address || null
          }
        }
      );
    });

    return c.json({ message: "Order updated successfully!" });

  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
};

export const updateOrderStatus = async (c) => {
  try {
    const uri = c.env.MONGODB_URI;
    const { mobile, status } = await c.req.json();

    const allowedStatuses = ["accepted", "inprogress"];
    if (!allowedStatuses.includes(status)) {
      return c.json({ error: "Invalid status! Allowed values are: assigned, inprogress" }, 400);
    }

    const existing = await withDatabase(uri, async (db) => {
      return await db.collection("lead").findOne({ mobile: mobile });
    });

    if (!existing) {
      return c.json({ error: "Order not found!" }, 404);
    }

    await withDatabase(uri, async (db) => {
      await db.collection("lead").updateOne(
        { mobile: mobile },
        { $set: { status: status } }
      );
    });

    return c.json({ message: `Order status updated to ${status} successfully!` });

  } catch (err) {
    return c.json({ error: err.message }, 500);
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
    return c.json({ error: err.message }, 500);
  }
};
