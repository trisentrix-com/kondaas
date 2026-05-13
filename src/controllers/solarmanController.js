import { withDatabase, getSystemKeys } from '../utils/config.js';
import { SolarParser } from '../utils/SolarParser.js';

const SOLARMAN_BASE_URL = "https://globalapi.solarmanpv.com";
const MONGODB_URI = process.env.MONGODB_URI;

/**
 * Helper to fetch Solarman keys once per request
 */
const getKeys = async (db) => {
  const keys = await getSystemKeys(db);
  return keys.solarman;
};

export const getSolarmanToken = async (c) => {
  try {
    const { email, password } = await c.req.json();
   
    if (!email || !password) {
      return c.json({ error: "email and password are required!" }, 400);
    }

    return await withDatabase(MONGODB_URI, async (db) => {
      const { appId, appSecret } = await getKeys(db);

      const response = await fetch(
        `${SOLARMAN_BASE_URL}/account/v1.0/token?appId=${appId}&language=en`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ appSecret, email, password })
        }
      );

      const data = await response.json();

      if (!response.ok) {
        return c.json({
          error: data.msg || "Failed to get token",
          raw: data
        }, 400);
      }

      return c.json(data);
    });
  } catch (err) {
    return c.json({ error: err.message }, 500);
  } 
};

export const getSolarmanStations = async (c) => {
  try {
    const { token } = await c.req.json();
    if (!token) return c.json({ error: "Access token is required!" }, 400);

    return await withDatabase(MONGODB_URI, async (db) => {
      const { appId } = await getKeys(db);

      const response = await fetch(
        `${SOLARMAN_BASE_URL}/station/v1.0/list?appId=${appId}&language=en`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `bearer ${token}`
          },
          body: JSON.stringify({ page: 1, size: 10 })
        }
      );

      const data = await response.json();

      if (!data.success) {
        return c.json({ error: data.msg || "Failed to fetch stations", raw: data }, 400);
      }

      return c.json({
        message: "Stations retrieved successfully",
        stations: data.stationList || []
      });
    });
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
};

export const getSolarmanDevices = async (c) => {
  try {
    const { token, stationId } = await c.req.json();

    return await withDatabase(MONGODB_URI, async (db) => {
      const { appId } = await getKeys(db);

      const response = await fetch(
        `${SOLARMAN_BASE_URL}/station/v1.0/device?appId=${appId}&language=en`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `bearer ${token}`
          },
          body: JSON.stringify({ stationId, page: 1, size: 20 })
        }
      );

      const data = await response.json();

      return c.json({
        success: data.success,
        message: data.msg || "Response received",
        devices: data.deviceList || data.deviceListItems || data.stationDeviceList || []
      });
    });
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
};

export const getSolarmanRealTimeData = async (c) => {
  try {
    const { token, deviceId } = await c.req.json();

    if (!token || !deviceId) {
      return c.json({ error: "Token and Device ID are required!" }, 400);
    }

    return await withDatabase(MONGODB_URI, async (db) => {
      const { appId } = await getKeys(db);

      const response = await fetch(
        `${SOLARMAN_BASE_URL}/device/v1.0/currentData?appId=${appId}&language=en`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `bearer ${token}`
          },
          body: JSON.stringify({ deviceId })
        }
      );

      const data = await response.json();

      if (!data.success) {
        return c.json({ error: data.msg || "Failed to fetch real-time data", raw: data }, 400);
      }

      return c.json({
        message: "Real-time data retrieved successfully",
        deviceId,
        dataList: data.dataList || []
      });
    });
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
};

export const getSolarmanHistory = async (c) => {
  try {
    // timeType: 1(Day/Frame), 2(Month/Days), 3(Year/Months), 4(Lifetime/Years)
    const { token, stationId, timeType, startTime, endTime } = await c.req.json();

    if (!token || !stationId || !timeType) {
      return c.json({ error: "Token, Station ID, and TimeType are required!" }, 400);
    }

    return await withDatabase(MONGODB_URI, async (db) => {
      const { appId } = await getKeys(db);

      // Solarman expects specific formats:
      // timeType 1 & 2: YYYY-MM-DD
      // timeType 3: YYYY-MM
      // timeType 4: YYYY
      
      const response = await fetch(
        `${SOLARMAN_BASE_URL}/station/v1.0/history?appId=${appId}&language=en`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `bearer ${token}`
          },
          body: JSON.stringify({ 
            stationId, 
            timeType, 
            startTime, 
            endTime 
          })
        }
      );

      const data = await response.json();

      if (!data.success) {
        return c.json({ 
          error: data.msg || "Solarman History Error", 
          code: data.code,
          raw: data 
        }, 400);
      }

      return c.json({
        success: true,
        // stationDataItems contains the list of values for your charts
        data: data.stationDataItems || [] 
      });
    });
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
};


//user details  alternate for firebase storage are


export const saveUserDetails = async (c) => {
  try {
    const data = await c.req.json();
    const mobile = data.UserInfo?.phoneNo;
    if (!mobile) return c.json({ error: "Mobile number is required" }, 400);

    return await withDatabase(MONGODB_URI, async (db) => {
      const setFields = {};

      // Map basic info
      if (data.AppInfo) setFields.AppInfo = data.AppInfo;
      if (data.PlatformInfo) setFields.PlatformInfo = data.PlatformInfo;
      setFields.updatedAt = new Date();

      if (data.UserInfo) {
        const ui = data.UserInfo;
        if (ui.phoneNo)       setFields["UserInfo.phoneNo"]  = ui.phoneNo;
        if (ui.email)         setFields["UserInfo.email"]    = ui.email;
        if (ui.password)      setFields["UserInfo.password"] = ui.password;
        if (ui.name)          setFields["UserInfo.name"]     = ui.name;
      }

      // 🚀 AUTO-DETECTION: Use SolarParser instead of trusting user input
      if (data.devicelist && data.devicelist[0]) {
        const rawStation = data.devicelist[0];
        const parsed = SolarParser.parse(rawStation);
        
        if (parsed.state) setFields["UserInfo.state"] = parsed.state;
        
        setFields.devicelist = [{
          ...rawStation,
          operationalTimestamp: parsed.operationalTimestamp,
          stationId: parsed.stationId,
          capacityKw: parsed.capacityKw
        }];
      }

      await db.collection("userDetails").updateOne(
        { _id: mobile },
        { $set: setFields }, 
        { upsert: true }
      );

      return c.json({ success: true, message: "Profile saved via SolarParser" });
    });
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
};

export const getUser = async (c) => {
  try {
    const { phoneNo } = await c.req.json();

    if (!phoneNo) {
      return c.json({ error: "phoneNo is required in the request body" }, 400);
    }

    return await withDatabase(MONGODB_URI, async (db) => {
      const user = await db.collection("userDetails").findOne({ _id: phoneNo });

      if (!user) {
        return c.json({ error: "User profile not found" }, 404);
      }

      // We return the whole document so the app can access UserInfo.state, 
      // UserInfo.email, and the devicelist for the dashboard.
      return c.json({
        success: true,
        data: user
      });
    });
  } catch (err) {
    console.error("❌ Error in getUser:", err.message);
    return c.json({ error: err.message }, 500);
  }
};


export const seedTariffSlabs = async (c) => {
  try {
    return await withDatabase(MONGODB_URI, async (db) => {
      const collection = db.collection("solarExportSlabs");

      // 1. TAMIL NADU DATA
      const tamilNaduData = {
        state: "Tamil Nadu",
        category: "solar_export_credit",
        description: "Monthly surplus solar export credit slabs",
        displayName: "Tamil Nadu",
        effectiveFrom: new Date("2020-01-01T00:00:00Z"),
        effectiveTo: null,
        type: "progressive",
        slabs: [
          { from: 1, to: 100, rate: 0 },
          { from: 101, to: 200, rate: 2.35 },
          { from: 201, to: 400, rate: 4.7 },
          { from: 401, to: 500, rate: 6.3 },
          { from: 501, to: 600, rate: 8.4 },
          { from: 601, to: 800, rate: 9.45 },
          { from: 801, to: 1000, rate: 10.5 },
          { from: 1001, to: null, rate: 11.55 }
        ],
        updatedAt: new Date("2026-01-01T14:00:00Z")
      };

      // 2. KERALA DATA (More complex structure)
      const keralaData = {
        state: "kerala",
        category: "domestic_consumption",
        description: "KSEB LT-I Domestic tariff slabs (monthly basis) - KSERC order 2025-2027",
        displayName: "Kerala (KSEB) - Domestic LT",
        effectiveFrom: "2025-04-01",
        effectiveTo: "2027-03-31",
        type: "telescopic + non-telescopic",
        fixedCharges: {
          notes: "Fixed charges in ₹/consumer/month, vary by connected load and phase.",
          single_phase: { up_to_250: 160, above_250: 200 },
          three_phase: { up_to_250: 240, above_250: 310 }
        },
        slabs: {
          telescopic_up_to_250: [
            { from: 0, to: 50, rate: 3.35 },
            { from: 51, to: 100, rate: 4.25 },
            { from: 101, to: 150, rate: 5.35 },
            { from: 151, to: 200, rate: 7.2 },
            { from: 201, to: 250, rate: 8.5 }
          ],
          non_telescopic_above_250: [
            { from: 251, to: 300, rate: 6.75 },
            { from: 301, to: 350, rate: 7.6 },
            { from: 351, to: 400, rate: 7.95 },
            { from: 401, to: 500, rate: 8.25 },
            { from: 501, to: null, rate: 9.2 }
          ]
        },
        source: "KSERC tariff order 2025-2027 (effective April 2025)",
        updatedAt: new Date("2026-02-16T18:30:00Z"),
        updatedBy: "admin-ezhil"
      };

      // Execute Upserts
      await collection.updateOne({ _id: "tamil-nadu" }, { $set: tamilNaduData }, { upsert: true });
      await collection.updateOne({ _id: "kerala" }, { $set: keralaData }, { upsert: true });

      return c.json({ success: true, message: "Tariff slabs updated successfully" });
    });
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
};


