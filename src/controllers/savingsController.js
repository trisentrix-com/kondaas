import { withDatabase, getSystemKeys } from '../utils/config.js';
import SolarExportCalculator from '../utils/SolarExportCalculator.js';
import { SolarParser } from '../utils/SolarParser.js'; 
import { fetchSolarmanHistory, getInternalSolarmanToken, fetchStationInfo } from '../utils/solarmanApi.js';

const MONGODB_URI = process.env.MONGODB_URI;
const SOLARMAN_BASE_URL = "https://globalapi.solarmanpv.com";

export const calculateUserSavings = async (c) => {
  try {
    // 🛡️ SECURITY HEADERS: Extracted cleanly from transit layers
    const incomingToken = c.req.header('x-auth-token');
    const headerDeviceId = c.req.header('x-device-id'); 

    // Clean payload parameter data block
    const data = await c.req.json();
    const phoneNo = data.phoneNo;
    const selectedStationId = data.stationId;
    
    // 🔄 HYBRID TRACKER: Fallback chain checks body payload so stationId arrays never drop!
    const deviceId = headerDeviceId || data.deviceId;

    if (!phoneNo) return c.json({ error: "Phone number is required" }, 400);
    
    if (!incomingToken) {
      return c.json({ error: "Unauthorized: No security token provided" }, 401);
    }

    if (!deviceId) {
      return c.json({ error: "Unauthorized: No deviceId provided in headers or body" }, 401);
    }

    return await withDatabase(MONGODB_URI, async (db) => {
      // 1. Get User Data Profile
      const user = await db.collection("userDetails").findOne({ _id: phoneNo });
      if (!user) return c.json({ error: "User profile not found" }, 404);

      // Verify active hardware credentials match current transit token context
      const devicesList = user.PlatformInfo?.devices || [];
      const currentDeviceSession = devicesList.find(d => d.deviceId === deviceId);
      const storedToken = currentDeviceSession?.authToken;

      if (!storedToken || storedToken !== incomingToken) {
        console.error(`❌ Security Alert: Token mismatch or unregistered hardware configuration for ${phoneNo} on device ${deviceId}`);
        return c.json({ error: "Unauthorized: Invalid security token" }, 401);
      }

      if (!user.UserInfo?.email || !user.UserInfo?.password) {
        return c.json({ error: "Solarman credentials missing" }, 404);
      }

      // CHOOSE THE CORRECT STATION DYNAMICALLY
      let targetDevice = null;
      if (selectedStationId) {
        targetDevice = user.devicelist?.find(d => String(d.id) === String(selectedStationId));
      }
      if (!targetDevice) {
        targetDevice = user.devicelist?.find(d => d.isLastLoggedIn === true) || user.devicelist?.[0];
      }

      const stationId = targetDevice?.id;
      if (!stationId) return c.json({ error: "No solar station linked or found match" }, 404);

      // 🕒 LAYER 2 CHECK: Separate Cache Storage Collection
      const cache = await db.collection("solarSavingsCache").findOne({ _id: String(stationId) });
      
      if (cache && cache.lastCalculatedAt) {
        const lastCachedTime = new Date(cache.lastCalculatedAt);
        const currentTime = new Date();
        
        // Calculate the difference in hours
        const hoursPassed = (currentTime - lastCachedTime) / (1000 * 60 * 60);

        // If it was calculated less than 24 hours ago, return it immediately!
        if (hoursPassed < 24) {
          console.log(`⚡ [Separate Cache Hit] Returning stored DB savings for station ${stationId}`);
          return c.json({
            success: true,
            fromCache: true,
            data: {
              stationId: Number(stationId),
              state: cache.state,
              cumulativeUnits: cache.cumulativeUnits,
              cumulativeCost: cache.cumulativeCost,
              monthlyRecords: cache.monthlyRecords
            }
          });
        }
      }

      // 💥 LAYER 3: CACHE MISS -> FETCH FRESH DATA FROM SOLARMAN
      console.log(`🔄 [Cache Miss/Expired] Fetching fresh calculations from Solarman for station ${stationId}`);

      // 2. Obtain Token for Solarman
      const token = await getInternalSolarmanToken(
        db,
        user.UserInfo.email,
        user.UserInfo.password, 
        getSystemKeys
      );

      // 3. Extract Real-Time Station Info & Run through Parser
      const rawStationData = await fetchStationInfo(stationId, token, db, getSystemKeys);
      const parsed = SolarParser.parse(rawStationData);
      
      if (!parsed?.state) {
        return c.json({ error: "Could not detect state" }, 404);
      }

      // 4. Load Tariff Rules Document Template
      const stateId = parsed.state.toLowerCase().replace(/\s+/g, '-');
      const tariffTemplate = await db.collection("solarExportSlabs").findOne({ _id: stateId });
      if (!tariffTemplate) {
        return c.json({ error: `Tariff not found for: ${stateId}` }, 404);
      }

      // 5. Sync state to DB if context changes dynamically
      if (user.UserInfo.state !== parsed.state) {
        await db.collection("userDetails").updateOne(
          { _id: phoneNo },
          { $set: { "UserInfo.state": parsed.state } }
        );
      }

      // Map operational starting date constraints
      const startTs = targetDevice?.operationalTimestamp
        || rawStationData?.startOperatingTime  
        || targetDevice?.createdDate;

      if (!startTs) return c.json({ error: "No operational date found" }, 404);

      
      // 6. Historical Monthly Calculation Loop
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

        const rawUnits = Number(solarResponse?.stationDataItems?.[0]?.generationValue || 0);
        cumulativeUnits += rawUnits;

        // 🔍 LIVE DEBUG CONSOLE: Catching the current month's math in action
        if (monthKey === "2026-05") {
          console.log("\n=================== 🕵️‍♂️ CURRENT MONTH DEBUG LOG ===================");
          console.log("📍 Target Month Key:  ", monthKey);
          console.log("📊 Raw Units Received:", rawUnits);
          console.log("📑 State Logged:      ", parsed.state);
          console.log("🔑 Generated StateId: ", stateId);
          console.log("🗂️ Tariff Doc From DB:", tariffTemplate ? "FOUND (True)" : "NOT FOUND (False)");
          
          if (tariffTemplate) {
            console.log("📜 DB Tariff Type:    ", tariffTemplate.type);
            console.log("📦 Total Rule Blocks: ", tariffTemplate.billingRules?.length || 0);
          }

          // Force check the calculator utility's direct execution
          const testCost = SolarExportCalculator.calculateMonthlyCredit(rawUnits, tariffTemplate, monthKey);
          console.log("💰 Final Math Output: ", testCost);
          console.log("==================================================================\n");
        }

        const cost = SolarExportCalculator.calculateMonthlyCredit(rawUnits, tariffTemplate, monthKey);

        monthlyRecords[monthKey] = {
          units: Number(rawUnits.toFixed(2)),
          cost: Number(cost.toFixed(2))
        };

        cumulativeCost += cost;
        cursor.setMonth(cursor.getMonth() + 1);
      }

      // 🚀 MATCHING FRONTEND SNAP: Fetching true total generation from the exact realTime endpoint
      let trueApiLifetimeUnits = 0;
      try {
        const systemKeys = await getSystemKeys(db);
        const appId = systemKeys.solarman?.appId;

        // Call the exact path verified by the working frontend snippet: station/v1.0/realTime
        const realTimeResponse = await fetch(
          `${SOLARMAN_BASE_URL}/station/v1.0/realTime?appId=${appId}&language=en`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `bearer ${token}`
            },
            body: JSON.stringify({ stationId: Number(stationId) }) // Uses stationId directly
          }
        );
 
        const realTimeJson = await realTimeResponse.json();

        // Map generationTotal directly off the response object payload root properties
        if (realTimeJson && realTimeJson.generationTotal !== undefined) {
          trueApiLifetimeUnits = Number(realTimeJson.generationTotal);
          console.log(`🎯Captured direct hardware odometer total: ${trueApiLifetimeUnits}`);
        }
      } catch (failsafeErr) {
        console.error("⚠️ Failsafe realTime station fetch skipped:", failsafeErr.message);
      }

      // Ensure cache uses the real-time odometer hardware value if it exceeds loop calculations
      const finalCumulativeUnits = (trueApiLifetimeUnits > cumulativeUnits) 
        ? trueApiLifetimeUnits 
        : cumulativeUnits;

      // 💾 SAVE STRUCTURAL RECORD CONTEXT BACK TO THE CACHE COLLECTION
      const savingsResult = {
        state: parsed.state,
        cumulativeUnits: Number(finalCumulativeUnits.toFixed(2)),
        cumulativeCost: Number(cumulativeCost.toFixed(2)),
        monthlyRecords,
        lastCalculatedAt: new Date().toISOString()
      };

      await db.collection("solarSavingsCache").updateOne(
        { _id: String(stationId) },
        { 
          $set: {
            state: savingsResult.state,
            cumulativeUnits: savingsResult.cumulativeUnits,
            cumulativeCost: savingsResult.cumulativeCost,
            monthlyRecords: savingsResult.monthlyRecords,
            lastCalculatedAt: savingsResult.lastCalculatedAt
          } 
        },
        { upsert: true }
      );

      return c.json({
        success: true,
        fromCache: false,
        data: {
          stationId: Number(stationId),
          ...savingsResult
        }
      });
    });

  } catch (err) {
    console.error("❌ Calculation Error:", err.message);
    return c.json({ error: err.message }, 500);
  }
};