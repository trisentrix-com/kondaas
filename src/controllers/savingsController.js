import { withDatabase, getSystemKeys } from '../utils/config.js';
import SolarExportCalculator from '../utils/SolarExportCalculator.js';
import { SolarParser } from '../utils/SolarParser.js'; 
import { fetchSolarmanHistory,getInternalSolarmanToken, fetchStationInfo } from '../utils/solarmanApi.js';

const MONGODB_URI = process.env.MONGODB_URI;

export const calculateUserSavings = async (c) => {
  try {
    const { phoneNo } = await c.req.json();
    if (!phoneNo) return c.json({ error: "Phone number is required" }, 400);

    return await withDatabase(MONGODB_URI, async (db) => {
      // 1. Get User Data
      const user = await db.collection("userDetails").findOne({ _id: phoneNo });
      if (!user || !user.UserInfo?.email || !user.UserInfo?.password) {
        return c.json({ error: "Solarman credentials missing" }, 404);
      }

      const device = user.devicelist?.[0];
      const stationId = device?.id;
      if (!stationId) return c.json({ error: "No solar station linked" }, 404);

      // 2. Get Token
      const token = await getInternalSolarmanToken(
        db,
        user.UserInfo.email,
        user.UserInfo.password, // ✅ plain password use பண்ணு
        getSystemKeys
      );

      // 3. State Detection — fetchStationInfo வழியா
      const rawStationData = await fetchStationInfo(stationId, token, db, getSystemKeys);
      const parsed = SolarParser.parse(rawStationData);
      if (!parsed?.state) {
        return c.json({ error: "Could not detect state" }, 404);
      }

      // 4. Load Tariff
      const stateId = parsed.state.toLowerCase().replace(/\s+/g, '-');
      const tariffTemplate = await db.collection("solarExportSlabs")
        .findOne({ _id: stateId });
      if (!tariffTemplate) {
        return c.json({ error: `Tariff not found for: ${stateId}` }, 404);
      }

      // 5. Sync state to DB
      if (user.UserInfo.state !== parsed.state) {
        await db.collection("userDetails").updateOne(
          { _id: phoneNo },
          { $set: { "UserInfo.state": parsed.state } }
        );
      }

      // 6. operationalTimestamp — DB-ல இல்லன்னா Solarman-லயே எடு
      const startTs = device?.operationalTimestamp
        || rawStationData?.startOperatingTime  // ✅ fetchStationInfo response-லயே இருக்கு
        || device?.createdDate;

      if (!startTs) return c.json({ error: "No operational date found" }, 404);

      // 7. Historical Calculation Loop
      const startDate = new Date(startTs * 1000);
      const now = new Date();
      const monthlyRecords = {};
      let cumulativeUnits = 0;
      let cumulativeCost = 0;

      let cursor = new Date(startDate.getFullYear(), startDate.getMonth(), 1);

      while (cursor <= now) {
        const year = cursor.getFullYear();
        const month = String(cursor.getMonth() + 1).padStart(2, '0');
        const monthKey = `${year}-${month}`;

        const solarResponse = await fetchSolarmanHistory({
          stationId,
          timeType: 3,
          startTime: monthKey,
          endTime: monthKey,
          token,
          db,
          getKeys: getSystemKeys
        });

        const units = Number(solarResponse?.stationDataItems?.[0]?.generationValue || 0);
        const cost = SolarExportCalculator.calculateMonthlyCredit(units, tariffTemplate);

        monthlyRecords[monthKey] = {
          units: Number(units.toFixed(2)),
          cost: Number(cost.toFixed(2))
        };

        cumulativeUnits += units;
        cumulativeCost += cost;

        cursor.setMonth(cursor.getMonth() + 1);
      }

      return c.json({
        success: true,
        data: {
          stationId,
          state: parsed.state,
          cumulativeUnits: Number(cumulativeUnits.toFixed(2)),
          cumulativeCost: Number(cumulativeCost.toFixed(2)),
          monthlyRecords
        }
      });
    });

  } catch (err) {
    console.error("❌ Calculation Error:", err.message);
    return c.json({ error: err.message }, 500);
  }
};