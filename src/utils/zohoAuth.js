export const getZohoAccessToken = async (db) => {
  // 1. Fetch credentials from your existing system keys collection
  const keys = await db.collection("system_keys").findOne({ type: "zoho" });
  
  const clientId = "1000.W93Q46VSNZAZ29S0ITI69BDUUZE98V";
  const clientSecret = "ff353bd704e741c0f551de25008552d6eab46e92f5";
  const refreshToken = keys?.refreshToken;

  const now = Date.now();

  // 2. If we have a saved token and it has at least 5 minutes left before expiring, use it!
  if (keys?.accessToken && keys?.expiresAt && (keys.expiresAt - now > 300000)) {
    return keys.accessToken;
  }

  console.log("🔄 Zoho Access Token expired or missing. Refreshing via Zoho Accounts API...");

  // 3. Make the POST request to Zoho India token endpoint to get a fresh ticket
  const response = await fetch("https://accounts.zoho.in/oauth/v2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token"
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Failed to refresh Zoho Token: ${errText}`);
  }

  const data = await response.json();

  // 4. Calculate exactly when this token will die (current time + 3600 seconds)
  const expiresAt = now + (data.expires_in * 1000);

  // 5. Securely save it back to your MongoDB configuration keys so other requests can reuse it
  await db.collection("system_keys").updateOne(
    { type: "zoho" },
    {
      $set: {
        accessToken: data.access_token,
        expiresAt: expiresAt,
        refreshToken: refreshToken, // keep it safe
        updatedAt: new Date()
      }
    },
    { upsers: true }
  );

  console.log("✅ Successfully stored fresh 60-minute Zoho token in DB.");
  return data.access_token;
};