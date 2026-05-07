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