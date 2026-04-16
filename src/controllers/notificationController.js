import { MongoClient, Binary, ObjectId } from 'mongodb';

import { getSystemKeys } from '../utils/config.js';

// --- HELPER: Database Connection (Kept exactly as requested) ---
const withDatabase = async (uri, fn) => {
  const client = new MongoClient(uri, {
    maxPoolSize: 1,
    serverSelectionTimeoutMS: 5000,
  });
  try {
    await client.connect();
    const db = client.db("Kondaas");
    return await fn(db);
  } finally {
    await client.close(true);
  }
};

// --- THE WORKER: Background WhatsApp Process ---
const processWhatsAppNotification = async (notificationId, c) => {
  const uri = c.env?.MONGODB_URI || process.env.MONGODB_URI;

  try {
    await withDatabase(uri, async (db) => {
      // 1. Fetch the keys from the config collection first
      const keys = await getSystemKeys(db);
      const BASE_URL = keys.whatsapp.apiUrl;
      const API_KEY = keys.whatsapp.apiKey;

      // 2. CLAIM: Lock the notification
      const notification = await db.collection("notifications").findOneAndUpdate(
        { _id: notificationId, status: "pending" },
        { $set: { status: "processing", startedAt: new Date() } },
        { returnDocument: 'after' }
      );

      if (!notification) return;

      const buffer = notification.content.buffer;
      const type = notification.contentType;
      const formattedNumber = `91${notification.to}`;

      let action = "";
      let payload = { number: formattedNumber };

      if (type === "text") {
        action = "sendText/trisentrix";
        payload.text = buffer.toString('utf8');
      }
      else if (type === "pdf") {
        action = "sendMedia/trisentrix";
        const fileUrl = buffer.toString('utf8');
        payload = {
          number: formattedNumber,
          mediatype: "document",
          media: fileUrl,
          fileName: "Kondaas_Report.pdf",
          caption: "Your document from Kondaas is ready."
        };
      }
      else if (type === "audio") {
        action = "sendMedia/trisentrix";
        const audioUrl = buffer.toString('utf8');
        payload = {
          number: formattedNumber,
          mediatype: "audio",
          media: audioUrl,
        };
      }

      // 3. SEND: Using the keys we pulled from the DB
      const response = await fetch(`${BASE_URL}${action}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": API_KEY
        },
        body: JSON.stringify(payload)
      });

      // 4. FINALIZE
      if (response.ok) {
        await db.collection("notifications").updateOne(
          { _id: notificationId },
          { $set: { status: "completed", completedAt: new Date() } }
        );
        console.log(`✅ WhatsApp ${type} sent to ${formattedNumber}`);
      } else {
        const errorText = await response.text();
        throw new Error(`API Error ${response.status}: ${errorText}`);
      }
    });
  } catch (err) {
    console.error("❌ WhatsApp Task Failed:", err.message);
    await withDatabase(uri, async (db) => {
      await db.collection("notifications").updateOne(
        { _id: notificationId },
        { $set: { status: "failed" }, $inc: { retryCount: 1 } }
      );
    });
  }
};

// --- THE OFFICE: Add Notification ---
export const addNotification = async (c) => {
  try {
    const uri = c.env?.MONGODB_URI || process.env.MONGODB_URI;
    const body = await c.req.json();
    const { from, to, mode, content, contentType } = body;

    if (!from || !to || !mode || !content || !contentType) {
      return c.json({ error: "Missing required fields" }, 400);
    }

    const contentBinary = new Binary(Buffer.from(content, 'base64'));

    const notificationId = await withDatabase(uri, async (db) => {
      const result = await db.collection("notifications").insertOne({
        ...body,
        content: contentBinary,
        status: "pending",
        createdAt: new Date()
      });
      return result.insertedId;
    });

    if (mode === "whatsapp") {
      c.executionCtx.waitUntil(processWhatsAppNotification(notificationId, c));
    }

    return c.json({ message: "Notification queued", id: notificationId }, 201);
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
};

// --- THE BRIDGE: Automated Scenario Notification ---
export const triggerScenarioNotification = async (c) => {
  try {
    const uri = c.env?.MONGODB_URI || process.env.MONGODB_URI;
    const { surveyorNumber, customerMobile, scenarioType } = await c.req.json();

    return await withDatabase(uri, async (db) => {
      const lead = await db.collection("lead").findOne({ mobile: customerMobile });
      if (!lead) return c.json({ error: "Lead not found" }, 404);

      const customerName = lead.name || "Customer";
      const whatsappTo = lead.whatsappNo || lead.mobile;

      let messageText = "";
      if (scenarioType === 1) {
        messageText = `Hello ${customerName}, your Kondaas technician has started from the office and this is his contact number ${surveyorNumber}.`;
      } else if (scenarioType === 2) {
        messageText = `Hello ${customerName}, your technician is just 300 meters away!`;
      } else if (scenarioType === 3) {
        messageText = `Hello ${customerName}, your technician has arrived.`;
      }

      const base64Content = Buffer.from(messageText).toString('base64');

      const notificationResult = await db.collection("notifications").insertOne({
        from: "Kondaas_System",
        to: whatsappTo,
        mode: "whatsapp",
        content: new Binary(Buffer.from(base64Content, 'base64')),
        contentType: "text",
        status: "pending",
        retryCount: 0,
        createdAt: new Date()
      });

      c.executionCtx.waitUntil(processWhatsAppNotification(notificationResult.insertedId, c));

      return c.json({
        message: `Scenario ${scenarioType} queued for ${customerName}`,
        id: notificationResult.insertedId
      });
    });
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
};



export const updateNotification = async (c) => {
  try {
    const uri = c.env?.MONGODB_URI || process.env.MONGODB_URI;
    const { id, status, retryAt, startedAt, retryCount } = await c.req.json();

    if (!id) return c.json({ error: "id is required!" }, 400);

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

    if (notFound) return c.json({ error: "Notification not found!" }, 404);

    return c.json({ message: "Notification updated successfully!" });

  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
};