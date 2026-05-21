import { withDatabase } from '../utils/config.js';

const MONGODB_URI = process.env.MONGODB_URI;

/**
 * POST /api/referrals/create
 * Stores a new referral record directly passed by the frontend
 */
export const createReferral = async (c) => {
  try {
    const body = await c.req.json();
    
    return await withDatabase(MONGODB_URI, async (db) => {
      const collection = db.collection("referrals");

      // Build the document structure following your exact payload blueprint
      const referralDocument = {
        _id: String(body.id), // The frontend-generated unique ID serves as primary key
        PurchaseAt: String(body.PurchaseAt || ""),
        PurchaseTracking: String(body.PurchaseTracking || ""),
        amountCredited: body.amountCredited !== undefined ? body.amountCredited : null,
        bonusAmount: body.bonusAmount !== undefined ? body.bonusAmount : null,
        createdAt: new Date(), // Seamlessly sets current operational timestamp
        description: body.description !== undefined ? body.description : null,
        friendName: String(body.friendName),
        friendPhNo: String(body.friendPhNo),
        productID: String(body.productID || "Solar"),
        refererPhNo: String(body.refererPhNo),
        salesId: String(body.salesId || ""),
        status: String(body.status || "")
      };

      // Direct insertion call
      await collection.insertOne(referralDocument);
      console.log(`🤝 Referral record ${referralDocument._id} saved successfully.`);

      return c.json({ success: true, referralId: referralDocument._id }, 201);
    });

  } catch (err) {
    console.error("❌ Create Referral Error:", err.message);
    return c.json({ success: false, error: err.message }, 500);
  }
};

/**
 * GET /api/referrals?refererPhNo=1111111111
 * Pulls all referrals created by a specific user profile
 */
export const getReferralsByReferer = async (c) => {
  try {
    // Extract the existing customer phone number from the URL string parameters
    const refererPhNo = c.req.query('refererPhNo');

    if (!refererPhNo) {
      return c.json({ success: false, error: "refererPhNo query parameter is required" }, 400);
    }

    return await withDatabase(MONGODB_URI, async (db) => {
      const collection = db.collection("referrals");

      // Query the index and sort chronologically by the newest additions
      const referralHistory = await collection
        .find({ refererPhNo: String(refererPhNo) })
        .sort({ createdAt: -1 })
        .toArray();

      return c.json({
        success: true,
        count: referralHistory.length,
        data: referralHistory
      });
    });

  } catch (err) {
    console.error("❌ Get Referrals Error:", err.message);
    return c.json({ success: false, error: err.message }, 500);
  }
};