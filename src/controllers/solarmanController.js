import { withDatabase, getSystemKeys } from '../utils/config.js';

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
    if (!mobile) {
      return c.json({ error: "Mobile number is required" }, 400);
    }

    return await withDatabase(MONGODB_URI, async (db) => {

      // ✅ Only update fields that are actually present in the request
      const setFields = {};

      if (data.AppInfo) setFields.AppInfo = data.AppInfo;
      if (data.PlatformInfo) setFields.PlatformInfo = data.PlatformInfo;
      if (data.devicelist) setFields.devicelist = data.devicelist;
      setFields.updatedAt = new Date();

      // ✅ UserInfo - field by field, skip undefined/null values
      if (data.UserInfo) {
        const userInfo = data.UserInfo;
        if (userInfo.phoneNo)       setFields["UserInfo.phoneNo"]       = userInfo.phoneNo;
        if (userInfo.email)         setFields["UserInfo.email"]         = userInfo.email;
        if (userInfo.password)      setFields["UserInfo.password"]      = userInfo.password;
        if (userInfo.plainPassword) setFields["UserInfo.plainPassword"] = userInfo.plainPassword;
        if (userInfo.fcmToken)      setFields["UserInfo.fcmToken"]      = userInfo.fcmToken;
        if (userInfo.name)          setFields["UserInfo.name"]          = userInfo.name;
        // Add any other UserInfo fields here
      }

      const result = await db.collection("userDetails").updateOne(
        { _id: mobile },
        { $set: setFields }, 
        { upsert: true }
      );

      return c.json({ 
        success: true, 
        message: result.upsertedCount > 0 ? "User created" : "User details updated",
        id: mobile 
      });
    });

  } catch (err) {
    console.error("❌ Error saving user details:", err.message);
    return c.json({ error: err.message }, 500);
  }
};

export const getUser = async (c) => {
  try {
    // Getting the phone number from the body as requested
    const { phoneNo } = await c.req.json();

    if (!phoneNo) {
      return c.json({ error: "phoneNo is required in the request body" }, 400);
    }

    return await withDatabase(MONGODB_URI, async (db) => {
      // Searching the userDetails collection by the mobile anchor (_id)
      const user = await db.collection("userDetails").findOne({ _id: phoneNo });

      if (!user) {
        return c.json({ error: "User profile not found" }, 404);
      }

      
    

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