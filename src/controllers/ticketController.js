import { withDatabase } from '../utils/config.js';

const MONGODB_URI = process.env.MONGODB_URI;

export const createTicket = async (c) => {
  try {
    // Read the pure data directly from the frontend request body
    const body = await c.req.json();
    
    return await withDatabase(MONGODB_URI, async (db) => {
      const collection = db.collection("createTicket");

      // Map the frontend payload exactly to your requested DB layout rules
      const ticketDocument = {
        _id: String(body.TicketNo), // Frontend-generated ID sets the primary database key
        Description: String(body.Description),
        PhoneNo: String(body.PhoneNo),
        TicketNo: String(body.TicketNo),
        assignedTo: String(body.assignedTo || ""),
        createdAt: new Date(), // Automatically captures the timestamp when processed
        createdBy: String(body.createdBy),
        deviceId: body.deviceId ? Number(body.deviceId) : null, // Saves as a clean integer number
        status: String(body.status || "Open"),
        type: String(body.type)
      };

      // Safely insert the complete object directly into MongoDB
      await collection.insertOne(ticketDocument);
      console.log(`🎫 Ticket ${ticketDocument._id} stored successfully.`);

      return c.json({ success: true, ticketId: ticketDocument._id });
    });

  } catch (err) {
    console.error("❌ Ticket Error:", err.message);
    return c.json({ success: false, error: err.message }, 500);
  }
};



export const getTicketsByUser = async (c) => {
  try {
    
    const phoneNo = c.req.query('PhoneNo');

    if (!phoneNo) {
      return c.json({ success: false, error: "PhoneNo query parameter is required" }, 400);
    }

    return await withDatabase(MONGODB_URI, async (db) => {
      const collection = db.collection("createTicket");

      // Find all tickets matching the phone number, sorted by newest created date first
      const tickets = await collection
        .find({ PhoneNo: String(phoneNo) })
        .sort({ createdAt: -1 })
        .toArray();

      return c.json({ 
        success: true, 
        count: tickets.length,
        data: tickets 
      });
    });

  } catch (err) {
    console.error("❌ Get Tickets Error:", err.message);
    return c.json({ success: false, error: err.message }, 500);
  }
};