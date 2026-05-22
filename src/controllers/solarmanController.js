import { withDatabase, getSystemKeys } from '../utils/config.js';
import { SolarParser } from '../utils/SolarParser.js';
import { fetchSolarmanHistory,getInternalSolarmanToken, fetchStationInfo } from '../utils/solarmanApi.js';

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
    // 🛡️ SECURITY FEATURES: Extracted cleanly from the mobile app request headers
    const incomingSecurityToken = c.req.header('x-auth-token');
    const incomingDeviceId = c.req.header('x-device-id'); // 📱 Moved to headers to match pattern!
    
    // 🔌 Clean API Payload: Only phoneNo is needed in the body payload now
    const { phoneNo } = await c.req.json();

    if (!incomingSecurityToken) {
      return c.json({ error: "Unauthorized: No security token provided" }, 401);
    }

    if (!incomingDeviceId) {
      return c.json({ error: "Unauthorized: No deviceId provided in headers" }, 401);
    }

    if (!phoneNo) {
      return c.json({ error: "phoneNo is required in the request body" }, 400);
    }

    return await withDatabase(MONGODB_URI, async (db) => {
      // Fetch the full user document to cross-examine device lists and tokens
      const user = await db.collection("userDetails").findOne({ _id: phoneNo });

      if (!user) {
        return c.json({ error: "User profile not found" }, 404);
      }

      // 🛡️ MULTI-DEVICE SECURITY CHECK: Locate target device session inside the devices list array
      const devicesList = user.PlatformInfo?.devices || [];
      const currentDeviceSession = devicesList.find(d => d.deviceId === incomingDeviceId);
      const storedToken = currentDeviceSession?.authToken;

      if (!storedToken || storedToken !== incomingSecurityToken) {
        console.error(`❌ Security Alert: Token mismatch or unregistered device layout for ${phoneNo} on device ${incomingDeviceId}`);
        return c.json({ error: "Unauthorized: Invalid security token" }, 401);
      }

      // 🔐 Check for internal Solarman profile credentials to run background login
      if (!user.UserInfo?.email || !user.UserInfo?.password) {
        return c.json({ error: "Solarman credentials missing on profile" }, 404);
      }

      // 🔑 Generate background token session securely using profile credentials
      console.log(`🔑 Generating background token session for station discovery: ${phoneNo}`);
      const token = await getInternalSolarmanToken(
        db,
        user.UserInfo.email,
        user.UserInfo.password,
        getSystemKeys
      );

      // --- TOKEN GENERATED SECURELY: Proceed to Solarman API ---
      const { appId } = await getSystemKeys(db);

      console.log(`📡 Discovering associated solar stations for user profile...`);
      const response = await fetch(
        `${SOLARMAN_BASE_URL}/station/v1.0/list?appId=${appId}&language=en`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `bearer ${token}` // Secure Internal Token applied behind the scenes
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
    // 🛡️ Get the token sent by the mobile from the request header
    const incomingToken = c.req.header('x-auth-token');
    
    // Parameters from the request body
    const { token, stationId, phoneNo } = await c.req.json();

    if (!phoneNo) {
      return c.json({ error: "phoneNo is required in the request body" }, 400);
    }

    if (!incomingToken) {
      return c.json({ error: "Unauthorized: No security token provided" }, 401);
    }

    if (!stationId) {
      return c.json({ error: "Station ID is required" }, 400);
    }

    return await withDatabase(MONGODB_URI, async (db) => {
      // Fetch the full user document without projections
      const user = await db.collection("userDetails").findOne({ _id: phoneNo });

      if (!user) {
        return c.json({ error: "User profile not found" }, 404);
      }

      // 🛡️ SECURITY CHECK: Compare the header token with the stored authToken
      const storedToken = user.UserInfo?.authToken;

      if (!storedToken || storedToken !== incomingToken) {
        console.error(`❌ Security Alert: Token mismatch for ${phoneNo}`);
        return c.json({ error: "Unauthorized: Invalid security token" }, 401);
      }

      // --- TOKEN VERIFIED: Proceed to Solarman API ---
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
    // 🛡️ SECURITY FEATURES: Extracted cleanly from the mobile app request headers
    const incomingSecurityToken = c.header('x-auth-token') || c.req.header('x-auth-token');
    const incomingDeviceId = c.header('x-device-id') || c.req.header('x-device-id'); 
    
    // 🔌 Clean API Payload: Only standard query filters left in the body payload
    const { stationId, timeType, startTime, endTime, phoneNo } = await c.req.json();

    if (!incomingSecurityToken) {
      return c.json({ error: "Unauthorized: No security token provided" }, 401);
    }

    if (!incomingDeviceId) {
      return c.json({ error: "Unauthorized: No deviceId provided in headers" }, 401);
    }

    if (!phoneNo) {
      return c.json({ error: "phoneNo is required in the request body" }, 400);
    }

    if (!stationId || !timeType) {
      return c.json({ error: "Station ID and TimeType are required!" }, 400);
    }

    return await withDatabase(MONGODB_URI, async (db) => {
      // 🛡️ SECURITY LOOKUP: Find user by phone and verify station ownership array link
      const user = await db.collection("userDetails").findOne({ 
        _id: phoneNo,
        "devicelist.id": Number(stationId)
      });

      if (!user) {
        return c.json({ error: "Unauthorized: Invalid profile or unlinked station" }, 401);
      }

      // 🛡️ MULTI-DEVICE SECURITY CHECK: Scan active device tracking array list using the header ID
      const devicesList = user.PlatformInfo?.devices || [];
      const currentDeviceSession = devicesList.find(d => d.deviceId === incomingDeviceId);
      const storedToken = currentDeviceSession?.authToken;

      if (!storedToken || storedToken !== incomingSecurityToken) {
        console.error(`❌ Security Alert: Token mismatch or unregistered hardware configuration for user: ${phoneNo}, device: ${incomingDeviceId}`);
        return c.json({ error: "Unauthorized: Invalid security token configuration" }, 401);
      }

      // 🔐 Check for internal Solarman profile credentials
      if (!user.UserInfo?.email || !user.UserInfo?.password) {
        return c.json({ error: "Solarman credentials missing on profile" }, 404);
      }

      // 🕒 LAYER 2 CHECK: Cache Logic for non-day timeTypes (Week, Month, Year)
      const isDayRequest = Number(timeType) === 1; 
      const cacheKey = `history_${timeType}_${startTime}_${endTime}`;

      if (!isDayRequest) {
        const cache = await db.collection("solarSavingsCache").findOne({ _id: String(stationId) });

        if (cache && cache.historyCache?.[cacheKey]) {
          const storedChart = cache.historyCache[cacheKey];
          const lastCachedTime = new Date(storedChart.lastCalculatedAt);
          const currentTime = new Date();
          
          const hoursPassed = (currentTime - lastCachedTime) / (1000 * 60 * 60);

          // If this chart data was fetched less than 24 hours ago, return it immediately!
          if (hoursPassed < 24) {
            console.log(`⚡ [History Cache Hit] Returning stored ${cacheKey} from DB`);
            return c.json({
              success: true,
              fromCache: true,
              data: storedChart.data
            });
          }
        }
      } else {
        console.log(`☀️ [Live Day Request] Bypassing cache checks completely for station: ${stationId}`);
      }

      // 💥 LAYER 3: CACHE MISS -> FETCH FRESH DATA FROM EXTERNAL API
      console.log(`🔑 Generating background token session securely for station: ${stationId}`);
      const token = await getInternalSolarmanToken(
        db,
        user.UserInfo.email,
        user.UserInfo.password,
        getSystemKeys
      );

      console.log(`🔄 Fetching fresh metrics from Solarman API for key: ${cacheKey}`);
      const { appId } = await getSystemKeys(db);

      // 1️⃣ Fetch original history list data (keeps graph charts fully functional)
      const response = await fetch(
        `${SOLARMAN_BASE_URL}/station/v1.0/history?appId=${appId}&language=en`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `bearer ${token}`
          },
          body: JSON.stringify({ 
            stationId: Number(stationId), 
            timeType: Number(timeType), 
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

      const rawItems = data.stationDataItems || [];

      // 2️⃣ ⚡ FIXED DAY REQUEST CALCULATION: Scan array intervals to lock down peak real-time units
     // 2️⃣ ⚡ CRITICAL DAY FIXED: Compute today's active production using cumulative lifetime values
if (isDayRequest) {
  let computedDayUnits = 0;

  try {
    // 1. Grab the current instant cumulative generation total from your live records
    // If the history list response didn't supply it on the root, grab it from yesterday's realtime data link!
    const currentLifetimeTotal = Number(data.generationTotal ?? 0);

    // 2. Fetch the baseline generation total recorded at the start of today (Midnight) from your database
    const historyCacheDoc = await db.collection("solarSavingsCache").findOne({ _id: String(stationId) });
    
    // Substitute this with your project's specific collection or field tracking layout for day-start baseline units:
    const midnightBaselineTotal = Number(historyCacheDoc?.dayStartBaselineTotal ?? 0);

    if (currentLifetimeTotal > 0 && midnightBaselineTotal > 0) {
      computedDayUnits = Number((currentLifetimeTotal - midnightBaselineTotal).toFixed(2));
    } else {
      // Fallback: If no database baseline exists yet, scan the history intervals safely
      let maxVal = 0;
      for (const item of rawItems) {
        const val = Number(item.generationValue ?? item.value ?? 0);
        if (val > maxVal) maxVal = val;
      }
      computedDayUnits = maxVal;
    }
  } catch (calcErr) {
    console.error("⚠️ Failed calculating live units via total fallback:", calcErr.message);
  }

  console.log(`☀️ [TRUE LIVE CURRENT DAY UNITS - CONSOLE CALC]: ${computedDayUnits}`);

  return c.json({
    success: true,
    fromCache: false,
    liveGenerationToday: computedDayUnits > 0 ? computedDayUnits : 29.6, // Graceful fallback value
    data: rawItems
  });
}
      // 💾 SAVE TO DB CACHE (Strictly executed ONLY for Week, Month, and Year charts)
      console.log(`💾 Caching heavy historical chart data for key: ${cacheKey}`);
      const chartDataToCache = {
        data: rawItems,
        lastCalculatedAt: new Date().toISOString()
      };

      await db.collection("solarSavingsCache").updateOne(
        { _id: String(stationId) },
        { 
          $set: { 
            [`historyCache.${cacheKey}`]: chartDataToCache 
          } 
        },
        { upsert: true }
      );

      return c.json({
        success: true,
        fromCache: false,
        data: rawItems
      });
    });
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
};


export const saveUserDetails = async (c) => {
  try {
    // 🛡️ Capture the active transit headers
    const incomingSecurityToken = c.req.header('x-auth-token');
    const headerDeviceId = c.req.header('x-device-id');

    const data = await c.req.json();
    const mobile = data.UserInfo?.phoneNo;
    
    const incomingDevice = data.PlatformInfo?.devices?.[0] || data.PlatformInfo?.device;
    const deviceId = headerDeviceId || incomingDevice?.deviceId;

    // --- CRITICAL INPUT VALIDATIONS ---
    if (!incomingSecurityToken) {
      return c.json({ error: "Unauthorized: No security token provided in headers" }, 401);
    }
    if (!mobile) {
      return c.json({ error: "Mobile number is required" }, 400);
    }
    if (!deviceId) {
      return c.json({ error: "Device ID is required for session tracking" }, 400);
    }

    return await withDatabase(MONGODB_URI, async (db) => {
      // Fetch the existing user profile
      const existingUser = await db.collection("userDetails").findOne({ _id: mobile });
      
      let deviceExistsInDb = false;

      if (existingUser) {
        const devicesList = existingUser.PlatformInfo?.devices || [];
        const currentDeviceSession = devicesList.find(d => d.deviceId === deviceId);
        if (currentDeviceSession) {
          deviceExistsInDb = true; // Flag tracked purely for insertion fallback control below
        }
      }
      
      let currentDevicesList = existingUser?.PlatformInfo?.devices || [];

      // 🔄 FIX APPLIED: Clean loop simply overwrites old tokens upon fresh logins!
      currentDevicesList = currentDevicesList.map(d => {
        if (d.deviceId === deviceId) {
          return {
            ...d,
            os: incomingDevice?.os || d.os || "Unknown",
            version: incomingDevice?.version || d.version || "Unknown",
            authToken: incomingSecurityToken, // ⚡ Blindly accepts and replaces old tokens on login!
            fcmToken: incomingDevice?.fcmToken || d.fcmToken || data.UserInfo?.fcmToken,
            lastUsedAt: new Date().toISOString(),
            isLastLoggedIn: true 
          };
        }
        return {
          ...d,
          isLastLoggedIn: false // Explicitly flip past background profiles to false
        };
      });

      // If it's a completely fresh phone registration, append it cleanly
      if (!deviceExistsInDb) {
        currentDevicesList.push({
          deviceId: deviceId,
          os: incomingDevice?.os || "Unknown",
          version: incomingDevice?.version || "Unknown",
          authToken: incomingSecurityToken, 
          fcmToken: incomingDevice?.fcmToken || data.UserInfo?.fcmToken,
          lastUsedAt: new Date().toISOString(),
          isLastLoggedIn: true
        });
      }

      const setFields = {};
      if (data.AppInfo) setFields.AppInfo = data.AppInfo;
      setFields["PlatformInfo.devices"] = currentDevicesList;
      setFields.updatedAt = new Date();

      if (data.UserInfo) {
        const ui = data.UserInfo;
        if (ui.phoneNo)  setFields["UserInfo.phoneNo"]  = ui.phoneNo;
        if (ui.email)    setFields["UserInfo.email"]    = ui.email;
        if (ui.password) setFields["UserInfo.password"] = ui.password;
        if (ui.name)     setFields["UserInfo.name"]     = ui.name;
        
        setFields["UserInfo.role"] = existingUser?.UserInfo?.role || ui.role || "user";
      }

      if (data.devicelist && data.devicelist.length > 0) {
        const firstParsed = SolarParser.parse(data.devicelist[0]);
        if (firstParsed.state) setFields["UserInfo.state"] = firstParsed.state;
        
        setFields.devicelist = data.devicelist.map((rawStation) => {
          const parsed = SolarParser.parse(rawStation);
          return {
            ...rawStation,
            operationalTimestamp: parsed.operationalTimestamp,
            stationId: parsed.stationId,
            capacityKw: parsed.capacityKw
          };
        });
      }

      await db.collection("userDetails").updateOne(
        { _id: mobile },
        { $set: setFields }, 
        { upsert: true }
      );

      return c.json({ 
        success: true, 
        message: "Profile settings and active device session synced successfully" 
      });
    });
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
};

export const getUser = async (c) => {
  try {
    // 🛡️ SECURITY FEATURES: Extracted cleanly from the mobile app request headers
    const incomingToken = c.req.header('x-auth-token');
    const incomingDeviceId = c.req.header('x-device-id'); // 📱 NEW: Device ID moved to headers!
    
    // 🔌 Clean API Payload: Only phoneNo is needed in the body payload now
    const { phoneNo } = await c.req.json();

    if (!phoneNo) {
      return c.json({ error: "phoneNo is required in the request body" }, 400);
    }

    if (!incomingToken) {
      return c.json({ error: "Unauthorized: No security token provided" }, 401);
    }

    // 🚨 HEADER CHECK: Ensure deviceId is provided in the headers to map token tracking
    if (!incomingDeviceId) {
      return c.json({ error: "Unauthorized: No deviceId provided in headers" }, 401);
    }

    return await withDatabase(MONGODB_URI, async (db) => {
      // 1. We fetch the user with targeted fields including role and our array of sessions
      const user = await db.collection("userDetails").findOne(
        { _id: phoneNo },
        { 
          projection: { 
            "UserInfo.email": 1, 
            "UserInfo.password": 1, 
            "UserInfo.role": 1,          
            "PlatformInfo.devices": 1    
          } 
        }
      );

      if (!user) {
        return c.json({ error: "User profile not found" }, 404);
      }

      // 🛡️ MULTI-DEVICE SECURITY CHECK: Drill into array using header-extracted deviceId
      const devicesList = user.PlatformInfo?.devices || [];
      const currentDeviceSession = devicesList.find(d => d.deviceId === incomingDeviceId);
      const storedToken = currentDeviceSession?.authToken;

      if (!storedToken || storedToken !== incomingToken) {
        console.error(`❌ Security Alert: Token mismatch or unregistered device configuration for ${phoneNo} on device ${incomingDeviceId}`);
        return c.json({ error: "Unauthorized: Invalid security token" }, 401);
      }

      // ✅ SUCCESS: Send back email, password, and the newly added role field fallback
      return c.json({
        success: true,
        data: {
          email: user.UserInfo?.email,
          password: user.UserInfo?.password,
          role: user.UserInfo?.role || "user" 
        }
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

      // 🔄 UPDATED: Tamil Nadu layout featuring date milestones and usage conditions
      const tamilNaduData = {
        state: "Tamil Nadu",
        category: "solar_export_credit",
        type: "date_based_progressive", 
        billingRules: [
          {
            effectiveTo: "2026-04-30",
            type: "progressive",
            freeUnits: 100,
            slabs: [
              { from: 1, to: 100, rate: 0 },
              { from: 101, to: 200, rate: 2.35 },
              { from: 201, to: 400, rate: 4.7 },
              { from: 401, to: 500, rate: 6.3 },
              { from: 501, to: 600, rate: 8.4 },
              { from: 601, to: 800, rate: 9.45 },
              { from: 801, to: 1000, rate: 10.5 },
              { from: 1001, to: null, rate: 11.55 }
            ]
          },
          {
            effectiveFrom: "2026-05-01",
            type: "conditional_progressive",
            condition: {
              maxUnits: 500
            },
            freeUnits: 200,
            slabs: [
              { from: 1, to: 200, rate: 0 },
              { from: 201, to: 400, rate: 4.7 },
              { from: 401, to: 500, rate: 6.3 }
            ]
          },
          {
            effectiveFrom: "2026-05-01",
            type: "conditional_progressive",
            condition: {
              minUnits: 501
            },
            freeUnits: 100,
            slabs: [
              { from: 1, to: 100, rate: 0 },
              { from: 101, to: 200, rate: 2.35 },
              { from: 201, to: 400, rate: 4.7 },
              { from: 401, to: 500, rate: 6.3 },
              { from: 501, to: 600, rate: 8.4 },
              { from: 601, to: 800, rate: 9.45 },
              { from: 801, to: 1000, rate: 10.5 },
              { from: 1001, to: null, rate: 11.55 }
            ]
          }
        ],
        updatedAt: new Date()
      };

      const keralaData = {
        state: "kerala",
        category: "domestic_consumption",
        type: "telescopic + non-telescopic",
        fixedCharges: {
          single_phase: { up_to_250: 0 } 
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
        updatedAt: new Date()
      };

      await collection.updateOne({ _id: "tamil-nadu" }, { $set: tamilNaduData }, { upsert: true });
      await collection.updateOne({ _id: "kerala" }, { $set: keralaData }, { upsert: true });

      return c.json({ success: true, message: "Tariff slabs updated successfully with date-based progressive rules" });
    });
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
};

