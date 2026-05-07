import { withDatabase, Binary, ObjectId, getSystemKeys } from '../utils/config.js';

// Centralized URI fetching
const MONGODB_URI = process.env.MONGODB_URI;

/**
 * --- THE WORKER ---
 * Handles the actual WhatsApp API call in the background.
 * Optimized for Node.js Event Loop.
 */
const processWhatsAppNotification = async (notificationId) => {
  try {
    await withDatabase(MONGODB_URI, async (db) => {
      // 1. Fetch Configuration        
      const keys = await getSystemKeys(db);
      const { apiUrl: BASE_URL, apiKey: API_KEY } = keys.whatsapp;

      // 2. CLAIM & LOCK: Ensure no other process picks this up
      const notification = await db.collection("notifications").findOneAndUpdate(
        { _id: notificationId, status: "pending" },
        { $set: { status: "processing", startedAt: new Date() } },
        { returnDocument: 'after' }
      );

      if (!notification) return;

      const buffer = notification.content.buffer;
      const type = notification.contentType;
      const formattedNumber = `91${notification.to}`;

      let action = (type === "text") ? "sendText/narayanan" : "sendMedia/narayanan";
      let payload = { number: formattedNumber };

      // 3. CONSTRUCT PAYLOAD
      if (type === "text") {
        payload.text = buffer.toString('utf8');
      } else {
        payload = {
          ...payload,
          mediatype: type === "pdf" ? "document" : "audio",
          media: buffer.toString('utf8'),
          ...(type === "pdf" && { 
            fileName: "Kondaas_Report.pdf", 
            caption: "Your document from Kondaas is ready." 
          })
        };
      }

      // 4. EXTERNAL API CALL
      const response = await fetch(`${BASE_URL}${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "apikey": API_KEY },
        body: JSON.stringify(payload)
      });

      // 5. FINALIZE
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
    // Update DB with failure status
    await withDatabase(MONGODB_URI, async (db) => {
      await db.collection("notifications").updateOne(
        { _id: notificationId },
        { $set: { status: "failed" }, $inc: { retryCount: 1 } }
      );
    });
  }
};

/**
 * --- THE OFFICE ---
 * Endpoints for adding new notifications.
 */
export const addNotification = async (c) => {
  try {
    const body = await c.req.json();
    const { to, mode, content, contentType } = body;

    if (!to || !mode || !content || !contentType) {
      return c.json({ error: "Missing required fields" }, 400);
    }

    const contentBinary = new Binary(Buffer.from(content, 'base64'));

    const notificationId = await withDatabase(MONGODB_URI, async (db) => {
      const result = await db.collection("notifications").insertOne({
        ...body,
        content: contentBinary,
        status: "pending",
        createdAt: new Date()
      });
      return result.insertedId;
    });

    if (mode === "whatsapp") {
   
      processWhatsAppNotification(notificationId).catch(err =>
        console.error("Background WhatsApp Error:", err)
      );
    }

    return c.json({ message: "Notification queued", id: notificationId }, 201);
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
};

/**
 * --- THE BRIDGE ---
 * Automated Scenario logic.
 */
export const triggerScenarioNotification = async (c) => {
  try {
    const { surveyorNumber, customerMobile, scenarioType, eta } = await c.req.json();

    return await withDatabase(MONGODB_URI, async (db) => {
      const lead = await db.collection("lead").findOne({ mobile: customerMobile });
      if (!lead) return c.json({ error: "Lead not found" }, 404);

      const customerName = lead.name || "Customer";
      const whatsappTo = lead.whatsappNo || lead.mobile;

      // --- NEW TIME FORMATTING LOGIC ---
      let etaString = eta ? `${eta} min` : "soon"; // Default fallback
      
      if (eta) {
        const totalMinutes = parseInt(eta);
        if (totalMinutes < 60) {
          etaString = `${totalMinutes} min`;
        } else {
          const hours = Math.floor(totalMinutes / 60);
          const mins = totalMinutes % 60;
          const formattedMins = mins < 10 ? `0${mins}` : mins;
          etaString = `${hours}.${formattedMins} hrs`;
        }
      }
      // ---------------------------------

      const messages = {
        1: `Hello ${customerName}, your Kondaas technician has started from the office. The technician will arrive in ${etaString}. Contact: ${surveyorNumber}.`,
        2: `Hello ${customerName}, your technician is just 300 meters away!`,
        3: `Hello ${customerName}, your technician has arrived.`
      };

      const messageText = messages[scenarioType] || "";
      const base64Content = Buffer.from(messageText).toString('base64');

      const result = await db.collection("notifications").insertOne({
        from: "Kondaas_System",
        to: whatsappTo,
        mode: "whatsapp",
        content: new Binary(Buffer.from(base64Content, 'base64')),
        contentType: "text",
        status: "pending",
        retryCount: 0,
        createdAt: new Date()
      });

      // Background trigger
      processWhatsAppNotification(result.insertedId).catch(err =>
        console.error("Background Notification Error:", err)
      );

      return c.json({ 
        message: `Scenario ${scenarioType} queued for ${customerName}`, 
        id: result.insertedId,
        formattedTime: etaString // Helpful for debugging Postman
      });
    });
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
};

/**
 * --- MANUAL UPDATE ---
 */
export const updateNotification = async (c) => {
  try {
    const { id, status, retryCount } = await c.req.json();
    if (!id) return c.json({ error: "id is required!" }, 400);

    const updateResult = await withDatabase(MONGODB_URI, async (db) => {
      return await db.collection("notifications").updateOne(
        { _id: new ObjectId(id) },
        { $set: { status, retryCount, updatedAt: new Date() } }
      );
    });

    if (updateResult.matchedCount === 0) return c.json({ error: "Not found" }, 404);
    return c.json({ message: "Updated successfully" });
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
};