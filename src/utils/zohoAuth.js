// utils/zohoAuth.js

// 🧠 Global runtime variables sitting strictly in your AWS Server's volatile RAM memory
let cachedToken = null;
let tokenExpiryTime = null;

export const getZohoAccessToken = async (db) => {
  const now = Date.now();

  // 1. If RAM contains a valid token with more than 5 minutes left, return it instantly (0ms)
  if (cachedToken && tokenExpiryTime && (tokenExpiryTime - now > 300000)) {
    return cachedToken;
  }

  console.log("🔄 RAM cache token missing or expired. Fetching fresh credentials from Atlas...");

  // 2. Query by the exact _id: "system_keys" mapping your Atlas layout
  const keysDoc = await db.collection("config").findOne({ _id: "system_keys" });
  const zohoConfig = keysDoc?.zoho;

  if (!zohoConfig || !zohoConfig.clientId || !zohoConfig.clientSecret || !zohoConfig.refreshToken) {
    throw new Error("❌ Zoho configuration properties (clientId, clientSecret, or refreshToken) are missing inside Atlas system_keys object.");
  }

  console.log("📡 Requesting a fresh access token from Zoho Accounts API...");

  // 3. Make the POST request to Zoho India token endpoint using the dynamic keys
  const response = await fetch("https://accounts.zoho.in/oauth/v2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      client_id: zohoConfig.clientId,
      client_secret: zohoConfig.clientSecret,
      refresh_token: zohoConfig.refreshToken,
      grant_type: "refresh_token"
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Failed to refresh Zoho Token: ${errText}`);
  }

  const data = await response.json();

  // 4. Save the fresh token and calculate the exact expiration deadline strictly in RAM variables
  cachedToken = data.access_token;
  tokenExpiryTime = now + (data.expires_in * 1000);

  console.log("✅ Fresh 60-minute token saved securely inside internal AWS server memory.");
  
  return cachedToken;
};