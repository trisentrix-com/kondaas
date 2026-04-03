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

export const addForm = async (c) => {
  try {
    const uri = c.env.MONGODB_URI;
    const body = await c.req.json();

    const mobileNumber = body.mobileNumber || body.customerDetails?.mobileNumber;

    if (!mobileNumber) {
      return c.json({ error: "Mobile number is required!" }, 400);
    }

  
    let alreadyExists = false;
    await withDatabase(uri, async (db) => {
      const existing = await db.collection("forms").findOne({ mobileNumber });
      if (existing) {
        alreadyExists = true;
        return;
      }
      await db.collection("forms").insertOne({
        mobileNumber,
        ...body
      });
    });

    if (alreadyExists) {
      return c.json({ error: "Mobile number already registered!" }, 400);
    }

    return c.json({ message: "Form submitted successfully!" }, 201);

  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
};

export const updateForm = async (c) => {
  try {
    const uri = c.env.MONGODB_URI;
    const body = await c.req.json();
    const mobileNumber = body.mobileNumber;

   
    let notFound = false;
    await withDatabase(uri, async (db) => {
      const existing = await db.collection("forms").findOne({ mobileNumber });
      if (!existing) {
        notFound = true;
        return;
      }
      await db.collection("forms").updateOne(
        { mobileNumber },
        {
          $set: {
            ...body,
            updatedAt: new Date(),
          }
        }
      );
    });

    if (notFound) {
      return c.json({ error: "Mobile number not found!" }, 404);
    }

    return c.json({ message: "Form updated successfully!" });

  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
};

export const updateMobileNumber = async (c) => {
  try {
    const uri = c.env.MONGODB_URI;
    const { oldMobileNumber, newMobileNumber } = await c.req.json();

    if (!oldMobileNumber || !newMobileNumber) {
      return c.json({ error: "Both old and new mobile numbers are required" }, 400);
    }

    let result = null;
    await withDatabase(uri, async (db) => {
      const oldExists = await db.collection("forms").findOne({ mobileNumber: oldMobileNumber });
      if (!oldExists) { result = 'not_found'; return; }

      const newExists = await db.collection("forms").findOne({ mobileNumber: newMobileNumber });
      if (newExists) { result = 'already_taken'; return; }

      await db.collection("forms").updateOne(
        { mobileNumber: oldMobileNumber },
        { $set: { mobileNumber: newMobileNumber } }
      );
    });

    if (result === 'not_found') return c.json({ error: "Old mobile number not found!" }, 404);
    if (result === 'already_taken') return c.json({ error: "New mobile number already registered!" }, 400);

    return c.json({ message: "Mobile number updated successfully!" });

  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
};