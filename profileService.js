const axios = require("axios");
const fs = require("fs");
const { getAccessToken, loadToken } = require("./tokenManager");
const { TOKEN_FILE } = require("./config");

function getCachedProfile() {
  try {
    if (!fs.existsSync(TOKEN_FILE)) return null;
    const data = JSON.parse(fs.readFileSync(TOKEN_FILE, "utf8"));
    if (!data) return null;

    return {
      user_name: data.user_name || data.name || data.broker || "Broker User",
      user_id: data.user_id || data.userId || data.client_id || data.clientId || "N/A",
      userId: data.user_id || data.userId || data.client_id || data.clientId || "N/A",
      userName: data.user_name || data.name || data.broker || "Broker User",
      name: data.user_name || data.name || data.broker || "Broker User",
      client_id: data.user_id || data.userId || data.client_id || data.clientId || "N/A",
      clientId: data.user_id || data.userId || data.client_id || data.clientId || "N/A"
    };
  } catch (err) {
    console.error("❌ Cached profile read failed:", err.message);
    return null;
  }
}

async function getProfile() {
  try {
    const token = getAccessToken();
    const cached = getCachedProfile();

    if (!token && cached) {
      return cached;
    }

    if (!token) {
      return cached;
    }

    const res = await axios.get(
      "https://api.upstox.com/v2/user/profile",
      {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    );

    return res.data.data || cached;

  } catch (err) {
    console.error("❌ Profile Error:", err.response?.data || err.message);
    return getCachedProfile();
  }
}

module.exports = { getProfile, getCachedProfile };
