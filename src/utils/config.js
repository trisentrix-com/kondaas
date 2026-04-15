/**
 * Fetches the system secrets from the config collection.
 * @param {object} db - The MongoDB database instance.
 * @returns {object} The system keys object.
 */
export const getSystemKeys = async (db) => {
  const config = await db.collection("config").findOne({ _id: "system_keys" });
  
  if (!config) {
    throw new Error("System configuration ('system_keys') not found in MongoDB!");
  }
  
  return config;
};