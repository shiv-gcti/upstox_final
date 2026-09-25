const fs = require("fs");
const axios = require("axios");
const config = require("./config");
const qs = require("qs");

let tokenData = null;

function isTokenExpired() {
  try {
    if (!tokenData?.access_token) {
      return true;
    }

    const createdAt = Number(tokenData.created_at || tokenData.createdAt || 0);
    const expiresIn = Number(tokenData.expires_in || 3600);

    if (!createdAt) {
      return false;
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    return nowSeconds >= createdAt + expiresIn;
  } catch (err) {
    console.error("❌ Token expiry check failed:", err.message);
    return true;
  }
}

// ================= LOAD TOKEN =================
function loadToken() {
  try {
    if (fs.existsSync(config.TOKEN_FILE)) {
      const data = JSON.parse(fs.readFileSync(config.TOKEN_FILE, "utf8"));
      tokenData = data;
      console.log("🔑 Token Loaded");
      return data;
    }
  } catch (err) {
    console.error("❌ Error loading token:", err.message);
  }
  return null;
}

// ================= SAVE TOKEN =================
function saveToken(data) {
  try {
    fs.writeFileSync(config.TOKEN_FILE, JSON.stringify(data, null, 2));
    tokenData = data;
    console.log("💾 Token Saved");
  } catch (err) {
    console.error("❌ Error saving token:", err.message);
  }
}

// ================= GET ACCESS TOKEN (SAFE) =================
function getAccessToken() {
  if (!tokenData) {
    loadToken();
  }

  if (isTokenExpired()) {
    console.warn("⚠️ Access token expired. Please login again.");
    tokenData = null;
    return null;
  }

  if (!tokenData?.access_token) {
    console.error("❌ Access token missing. Please login again.");
    return null;
  }

  return tokenData.access_token;
}

// ================= REFRESH TOKEN =================
async function refreshToken() {
  try {
    if (!tokenData?.refresh_token) {
      throw new Error("No refresh token available");
    }

    console.log("🔄 Refreshing token...");

    const response = await axios.post(
      "https://api.upstox.com/v2/login/authorization/token",
      qs.stringify({
        grant_type: "refresh_token",
        refresh_token: tokenData.refresh_token,
        client_id: config.API_KEY,
        client_secret: config.API_SECRET
      }),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        }
      }
    );

    saveToken(response.data);

    console.log("✅ Token refreshed successfully");

    return response.data.access_token;

  } catch (err) {
    console.error("❌ Token Refresh Failed:", err.response?.data || err.message);
    throw err;
  }
}

// ================= AUTO GET VALID TOKEN =================
async function getValidAccessToken() {
  try {
    let token = getAccessToken();
    return token;
  } catch (err) {
    console.log("⚠️ Token invalid, trying refresh...");
    await refreshToken();
    return getAccessToken();
  }
}

module.exports = {
  loadToken,
  saveToken,
  getAccessToken,
  getValidAccessToken,
  refreshToken,
  isTokenExpired
};