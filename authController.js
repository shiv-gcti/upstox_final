const axios = require("axios");
const qs = require("qs");   // 👈 ADD THIS
const config = require("./config");
const { saveToken } = require("./tokenManager");

// Step 1: Login redirect
function login(req, res) {
  const loginUrl = `https://api.upstox.com/v2/login/authorization/dialog?response_type=code&client_id=${encodeURIComponent(config.API_KEY)}&redirect_uri=${encodeURIComponent(config.REDIRECT_URI)}`;
  res.redirect(loginUrl);
}

// Step 2: Callback (IMPORTANT PART)
async function callback(req, res) {
  const code = req.query.code;

  if (!code) {
    return res.send("❌ No code received");
  }

  try {
    // 🔥 THIS IS WHERE YOUR CODE GOES
    const response = await axios.post(
      "https://api.upstox.com/v2/login/authorization/token",
      qs.stringify({
        grant_type: "authorization_code",
        code: code,
        client_id: config.API_KEY,
        client_secret: config.API_SECRET,
        redirect_uri: config.REDIRECT_URI
      }),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        }
      }
    );

    // Save token
    saveToken({
      ...response.data,
      created_at: Math.floor(Date.now() / 1000)
    });

    // Keep dashboard session active after broker OAuth callback.
    if (!req.session.user) {
      req.session.user = process.env.DASHBOARD_USER || "dashboard-user";
    }

    console.log("✅ Token Generated & Saved");
    return res.redirect("/dashboard.html?brokerLogin=success");

  } catch (err) {
    const apiError = err.response?.data;
    console.error("❌ Token Error:", apiError || err.message);
    return res.status(400).json({
      success: false,
      message: "Token generation failed. Check Upstox app client_id and redirect_uri match exactly.",
      upstoxError: apiError || null
    });
  }
}

module.exports = { login, callback };