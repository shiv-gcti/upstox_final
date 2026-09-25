const fs = require("fs");
const config = require("./config");

let tokenData = null;

function loadToken() {
  try {
    if (!fs.existsSync(config.TOKEN_FILE)) {
      console.warn("⚠️ Token file not found. Please login from Dashboard.");
      tokenData = null;
      return null;
    }

    const data = JSON.parse(
      fs.readFileSync(config.TOKEN_FILE, "utf8")
    );

    tokenData = data;

    console.log("🔑 Token Loaded");

    return data;
  } catch (err) {
    console.error("❌ Error loading token:", err.message);
    tokenData = null;
    return null;
  }
}

function saveToken(data) {
  try {
    fs.writeFileSync(
      config.TOKEN_FILE,
      JSON.stringify(data, null, 2),
      { mode: 0o600 }
    );

    tokenData = data;

    console.log("💾 Token Saved");

    return data;
  } catch (err) {
    console.error("❌ Error saving token:", err.message);
    return null;
  }
}

function getAccessToken() {
  if (!tokenData) {
    loadToken();
  }

  if (!tokenData?.access_token) {
    console.warn("⚠️ No access token found. Please login from Dashboard.");
    return null;
  }

  return tokenData.access_token;
}

/*
 * Your application intentionally gets a fresh Upstox
 * token through Dashboard login every morning.
 *
 * Therefore we do NOT calculate expiry using
 * created_at + 3600 and we do NOT attempt OAuth
 * refresh using a refresh_token that does not exist
 * in your saved token.
 */
function isTokenExpired() {
  return !getAccessToken();
}

/*
 * Kept for compatibility with existing code.
 * The application uses the token saved by Dashboard login.
 */
async function getValidAccessToken() {
  return getAccessToken();
}

/*
 * Kept for compatibility with existing imports.
 * Your current Upstox token does not contain refresh_token,
 * so automatic OAuth refresh is intentionally not performed.
 */
async function refreshToken() {
  throw new Error(
    "No refresh token available. Please login to Upstox from Dashboard."
  );
}

module.exports = {
  loadToken,
  saveToken,
  getAccessToken,
  getValidAccessToken,
  refreshToken,
  isTokenExpired
};