import { MongoClient } from 'mongodb';
import { getSystemKeys } from '../utils/config.js';


const withDatabase = async (uri, fn) => {
  const client = new MongoClient(uri, {
    maxPoolSize: 1,
    minPoolSize: 0,
    serverSelectionTimeoutMS: 5000,
  });
  try {
    await client.connect();
    const db = client.db("Kondaas");
    return await fn(db);
  } finally {
    await client.close(true);
  }
};
const SOLARMAN_BASE_URL = "https://globalapi.solarmanpv.com";

export const getSolarmanToken = async (c) => {
  try {
    const { email, password } = await c.req.json();
    const uri = c.env?.MONGODB_URI || process.env.MONGODB_URI;

    if (!email || !password) {
      return c.json({ error: "email and password are required!" }, 400);
    }

    // Wrap in withDatabase to access the config collection
    return await withDatabase(uri, async (db) => {

      // 1. Fetch keys from MongoDB
      const keys = await getSystemKeys(db);
      const { appId, appSecret } = keys.solarman;

      // 2. Call Solarman API using DB keys
      const response = await fetch(
        `${SOLARMAN_BASE_URL}/account/v1.0/token?appId=${appId}&language=en`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            appSecret, // From DB
            email,
            password
          })
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
    const uri = c.env?.MONGODB_URI || process.env.MONGODB_URI;

    if (!token) {
      return c.json({ error: "Access token is required!" }, 400);
    }

    return await withDatabase(uri, async (db) => {
      // 1. Get our appId from the DB config (Solarman needs this in the URL)
      const keys = await getSystemKeys(db);
      const { appId } = keys.solarman;

      // 2. Call the Station List endpoint
      const response = await fetch(
        `https://globalapi.solarmanpv.com/station/v1.0/list?appId=${appId}&language=en`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `bearer ${token}` // Use the token here
          },
          body: JSON.stringify({
            page: 1,
            size: 10 // Let's fetch the first 10 stations
          })
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
    const uri = c.env?.MONGODB_URI || process.env.MONGODB_URI;

    return await withDatabase(uri, async (db) => {
      const keys = await getSystemKeys(db);
      const { appId } = keys.solarman;

      // Stick to the Station Device endpoint since your token likes it
      const response = await fetch(
        `https://globalapi.solarmanpv.com/station/v1.0/device?appId=${appId}&language=en`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `bearer ${token}`
          },
          body: JSON.stringify({
            stationId: stationId,
            page: 1,
            size: 20

          })
        }
      );

      const data = await response.json();

      // If success is true but list is empty, it means no hardware is bound
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
    const uri = c.env?.MONGODB_URI || process.env.MONGODB_URI;

    if (!token || !deviceId) {
      return c.json({ error: "Token and Device ID are required!" }, 400);
    }

    return await withDatabase(uri, async (db) => {
      const keys = await getSystemKeys(db);
      const { appId } = keys.solarman;

      const response = await fetch(
        `https://globalapi.solarmanpv.com/device/v1.0/currentData?appId=${appId}&language=en`,
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

      // 'dataList' contains all the sensor readings (Voltage, Power, etc.)
      return c.json({
        message: "Real-time data retrieved successfully",
        deviceId: deviceId,
        dataList: data.dataList || []
      });
    });
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
};