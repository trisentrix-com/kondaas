import axios from 'axios';

// Base URL for Solarman Global API
const SOLARMAN_BASE_URL = "https://globalapi.solarmanpv.com";

/**
 * Fetch detailed station information
 */
export const fetchStationInfo = async (stationId, token, db, getKeys) => {
  try {
    const keys = await getKeys(db);
    const appId = keys.solarman?.appId;

    const response = await axios.post(
      `${SOLARMAN_BASE_URL}/station/v1.0/list?appId=${appId}&language=en`,
      { page: 1, size: 100 },
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        }
      }
    );

    const data = response.data;
    if (data.success === "false") throw new Error(data.msg || "Failed to fetch list");

    // FIND the specific station in the list
    const stations = data.stationList || [];
    const targetStation = stations.find(s => Number(s.id) === Number(stationId));

    if (!targetStation) throw new Error("Station not found in Solarman list");

    return targetStation; // Returns the single object your Parser expects
  } catch (error) {
    const errorMsg = error.response?.data?.msg || error.message;
    throw new Error(`Failed to fetch station details: ${errorMsg}`);
  }
};

/**
 * Get Internal Token
 */
export const getInternalSolarmanToken = async (db, email, password, getKeys) => {
  try {
    const keys = await getKeys(db);

    if (!keys.solarman?.appId || !keys.solarman?.appSecret) {
      throw new Error("API Keys (appId/appSecret) missing in database.");
    }

    const { appId, appSecret } = keys.solarman;

    const response = await axios.post(
      `${SOLARMAN_BASE_URL}/account/v1.0/token?appId=${appId}&language=en`,
      { appSecret, email, password },
      { headers: { "Content-Type": "application/json" } }
    );

    const data = response.data;

    if (data && data.access_token) {
      return data.access_token;
    } else {
      throw new Error(data.msg || "Authentication failed with Solarman.");
    }
  } catch (error) {
    const errorMsg = error.response?.data?.msg || error.message;
    console.error("❌ Solarman Auth Utility Error:", errorMsg);
    throw new Error(`Solarman Auth Failed: ${errorMsg}`);
  }
};

/**
 * Fetch Historical Data
 */
export const fetchSolarmanHistory = async ({ stationId, timeType, startTime, endTime, token, db, getKeys }) => {
  try {
    // Consistency: Add appId to history headers if possible
    const keys = await getKeys(db);
    const appId = keys.solarman?.appId;

    const response = await axios.post(
      `${SOLARMAN_BASE_URL}/station/v1.0/history`,
      {
        stationId: Number(stationId),
        timeType: Number(timeType),
        startTime,
        endTime,
        useParam: "generationValue" 
      },
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'appId': appId
        }
      }
    );

    return response.data;
  } catch (error) {
    const errorMsg = error.response?.data?.msg || error.message;
    console.error("❌ Solarman History Utility Error:", errorMsg);
    throw new Error(`Failed to fetch history: ${errorMsg}`);
  }
};