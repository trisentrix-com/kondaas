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

const TEMPLATE_ID = "solarv1";

export const createTemplate = async (c) => {
  try {
    const uri = c.env.MONGODB_URI;
    const { schema, uischema } = await c.req.json();

    if (!schema || !uischema) {
      return c.json({ error: "schema and uischema are required!" }, 400);
    }

    const existing = await withDatabase(uri, async (db) => {
      return await db.collection("templates").findOne({ id: TEMPLATE_ID });
    });

    if (existing) {
      return c.json({ error: "Template already exists!" }, 400);
    }

    await withDatabase(uri, async (db) => {
      await db.collection("templates").insertOne({
        id: TEMPLATE_ID,
        schema,
        uischema
      });
    });

    return c.json({ message: "Template created successfully!" }, 201);

  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
};

export const updateTemplate = async (c) => {
  try {
    const uri = c.env.MONGODB_URI;
    const { schema, uischema } = await c.req.json();

    if (!schema || !uischema) {
      return c.json({ error: "schema and uischema are required!" }, 400);
    }

    const existing = await withDatabase(uri, async (db) => {
      return await db.collection("templates").findOne({ id: TEMPLATE_ID });
    });

    if (!existing) {
      return c.json({ error: "Template not found!" }, 404);
    }

    await withDatabase(uri, async (db) => {
      await db.collection("templates").updateOne(
        { id: TEMPLATE_ID },
        { $set: { schema, uischema } }
      );
    });

    return c.json({ message: "Template updated successfully!" });

  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
};

export const getTemplate = async (c) => {
  try {
    const uri = c.env.MONGODB_URI;

    const template = await withDatabase(uri, async (db) => {
      return await db.collection("templates").findOne({ id: TEMPLATE_ID });
    });

    if (!template) {
      return c.json({ error: "Template not found!" }, 404);
    }

    return c.json(template);

  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
};
