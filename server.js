require("dotenv").config();

const express = require("express");
const http = require("http");
const session = require("express-session");
const { Server } = require("socket.io");

const { getProfile, getCachedProfile } = require("./profileService");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*" }
});

global.io = io;

// ================= MIDDLEWARE =================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.set("trust proxy", 1);

app.use(session({
  secret: "supersecret",
  proxy: true,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    // Auto-detect HTTPS and set secure cookie accordingly.
    secure: "auto",
    sameSite: "lax",

  }
}));

// ================= STATIC =================
app.use(express.static("public"));

// ================= SERVICES =================
const { syncOrders } = require("./syncService");
const { loadToken, isTokenExpired, getAccessToken } = require("./tokenManager");
const { handleWebhook } = require("./webhookController");
const { login, callback } = require("./authController");
const { getPositions } = require("./positionService");
const connectDB = require("./db");
const Trade = require("./models/Trade");
const { startTrading, stopTrading } = require("./control");
const { ensureLocalFile } = require("./instrumentStore");
const { startProfitBooking, stopProfitBooking, getMonitoringStatus, startCleanupTimer, stopCleanupTimer } = require("./profitBooking");

// ================= LOGIN =================
app.post("/login", (req, res) => {
  const { username, password } = req.body;

  if (
    username === process.env.DASHBOARD_USER &&
    password === process.env.DASHBOARD_PASS
  ) {
    req.session.user = username;
    return res.json({
      success: true,
      redirect: "/"
    });
  }

  return res.status(401).json({ error: "Invalid credentials" });
});

// ================= AUTH MIDDLEWARE =================
function isAuthenticated(req, res, next) {
  const publicRoutes = [
    "/login",
    "/login.html",
    "/login-upstox",
    "/callback",
    "/webhook",
    "/profile",
    "/control",
    "/status"
  ];

  if (publicRoutes.includes(req.path)) return next();

  if (req.session.user) return next();

  return res.redirect("/login.html");
}

app.use(isAuthenticated);


// ================= ROUTES =================

// ✅ Allow dashboard page to load always
app.get("/", (req, res) => {
  res.sendFile(__dirname + "/public/index.html");
});

// (optional but fine)
app.get("/index.html", (req, res) => {
  res.sendFile(__dirname + "/public/index.html");
});


// UPSTOX LOGIN
app.get("/login-upstox", login);
app.get("/callback", callback);


//=================== Logout=======================
app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/");   // ✅ now this will work
  });
});


// ================= WEBHOOK =================
app.post("/webhook", handleWebhook);

// ================= API ROUTES =================
function getMsUntilNextMidnight() {
  const now = new Date();
  const nextMidnight = new Date(now);
  nextMidnight.setHours(24, 0, 0, 0);
  return nextMidnight.getTime() - now.getTime();
}

function startDailyTradeLogReset() {
  const clearTradeLog = async () => {
    const result = await Trade.clearAll();
    console.log(`🗑️ Trade log cleared at 00:00:00 (${result.deletedCount} records removed)`);
  };

  const nextDelay = getMsUntilNextMidnight();

  setTimeout(() => {
    clearTradeLog();
    setInterval(clearTradeLog, 24 * 60 * 60 * 1000);
    console.log("🧹 Daily trade log reset scheduled for 00:00:00");
  }, nextDelay);
}

app.get("/status", (req, res) => {
  res.json({
    server: "running",
    tokenExpired: isTokenExpired(),
    time: new Date()
  });
});

app.get("/control", (req, res) => {
  res.json({
    trading: true,
    status: "online"
  });
});

app.get("/positions", async (req, res) => {
  const positions = await getPositions();
  res.json(positions);
});

app.get("/trades", async (req, res) => {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const trades = await Trade.find({
    time: { $gte: startOfDay }
  }).sort({ time: -1 });

  res.json(trades);
});

// ================= CONTROL =================
app.get("/start", (req, res) => {
  startTrading();
  res.send("Trading Started");
});

app.get("/stop", (req, res) => {
  stopTrading();
  res.send("Trading Stopped");
});

// ================= PROFIT BOOKING =================
app.get("/profit-booking/start", (req, res) => {
  const interval = req.query.interval || 5000; // Default 5 seconds
  startProfitBooking(Number(interval));
  res.json({
    status: "STARTED",
    message: `Profit booking started (checking every ${interval}ms)`
  });
});

app.get("/profit-booking/stop", (req, res) => {
  stopProfitBooking();
  res.json({
    status: "STOPPED",
    message: "Profit booking monitoring stopped"
  });
});

app.get("/profit-booking/status", (req, res) => {
  const status = getMonitoringStatus();
  res.json({
    isActive: status.isActive,
    activePositions: status.activePositions,
    positions: status.positions
  });
});

// ================= PROFILE =================
app.get("/profile", async (req, res) => {
  try {
    const brokerProfile = await getProfile();
    const cachedName = brokerProfile?.user_name || brokerProfile?.userName || brokerProfile?.name || process.env.DASHBOARD_USER || req.session.user || "N/A";
    const cachedClientId = brokerProfile?.user_id || brokerProfile?.userId || brokerProfile?.client_id || brokerProfile?.clientId || "N/A";

    const isLoggedIn = Boolean(req.session.user || brokerProfile || (process.env.DASHBOARD_USER && process.env.DASHBOARD_PASS));

    return res.json({
      loggedIn: isLoggedIn,
      brokerConnected: Boolean(brokerProfile),
      name: cachedName,
      clientId: cachedClientId
    });

  } catch (err) {
    console.error("Profile error:", err);
    const fallback = getCachedProfile ? getCachedProfile() : null;
    return res.json({
      loggedIn: Boolean(req.session.user || fallback),
      brokerConnected: Boolean(fallback),
      name: fallback?.user_name || fallback?.name || req.session.user || "N/A",
      clientId: fallback?.user_id || fallback?.userId || fallback?.client_id || fallback?.clientId || "N/A"
    });
  }
});

// ================= SOCKET =================
io.on("connection", (socket) => {
  console.log("Dashboard connected:", socket.id);
});

// ================= START SERVER =================
async function startServer() {
  await connectDB();
  loadToken();
  await ensureLocalFile();

  server.on("error", (err) => {
    if (err && err.code === "EADDRINUSE") {
      console.error(`❌ Port 3000 is already in use. Stop the stale server before starting the app again.`);
      process.exit(1);
    }

    console.error("❌ Server startup error:", err && err.message ? err.message : err);
    process.exit(1);
  });

  server.listen(3000, () => {
    console.log("Server running on port 3000");
  });

  setInterval(syncOrders, 2000);

  // ==============================
  // 🎯 START PROFIT BOOKING (Auto)
  // ==============================
  // Check positions every 5 seconds
  startProfitBooking(5000);
  console.log("✅ Profit booking service started automatically");

  // ==============================
  // 🧹 START CLEANUP TIMER
  // ==============================
  startCleanupTimer();
  console.log("✅ Memory cleanup timer started");

  startDailyTradeLogReset();
  console.log("✅ Daily trade log reset scheduled");
}

startServer();
