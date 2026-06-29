import { withDatabase } from '../utils/config.js';


const MONGODB_URI = process.env.MONGODB_URI;

export const getDealInfo = async (c) => {
    try {
        // 1. Extract query parameters from the frontend URL request (default to Page 1)
        const page = parseInt(c.req.query("page") || "1", 10);
        const limit = parseInt(c.req.query("limit") || "20", 10);

        // Safeguard against invalid pagination parameters
        const activePage = page < 1 ? 1 : page;
        const activeLimit = limit < 1 ? 20 : limit;

        // 2. Compute the exact skip offset using the pagination formula
        const skipValue = (activePage - 1) * activeLimit;

        return await withDatabase(MONGODB_URI, async (db) => {
            const formsCollection = db.collection("forms");

            // 3. Run parallel lookups: fetch data (with projection filtering) and count totals concurrently
            const [formsData, totalForms] = await Promise.all([
                formsCollection
                    .find({})
                    .sort({ _id: -1 })
                    .skip(skipValue)
                    .limit(activeLimit)
                    .project({
                        // 🚫 Exclude heavy image data and long strings
                        Site_Engineer_Signature: 0,
                        Customer_Confirmation_Signature: 0,
                        ebBillPhotos: 0,
                        sitePhotos: 0
                    })
                    .toArray(),
                formsCollection.countDocuments({})
            ]);

            // 4. Send back the clean, lightweight response with pagination metadata
            return c.json({
                success: true,
                data: formsData,
                pagination: {
                    totalItems: totalForms,
                    currentPage: activePage,
                    limit: activeLimit,
                    totalPages: Math.ceil(totalForms / activeLimit),
                    hasNextPage: skipValue + formsData.length < totalForms,
                    hasPrevPage: activePage > 1
                }
            }, 200);
        });

    } catch (err) {
        console.error("❌ Fetching Paginated Forms Error Exception:", err.message);
        return c.json({ error: "Failed to fetch form details repository" }, 500);
    }
};