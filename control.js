// ==============================
// 🟢 TRADING CONTROL SYSTEM
// ==============================

let tradingEnabled = true;

// ==============================
// ▶️ START / STOP TRADING
// ==============================
function startTrading() {
  tradingEnabled = true;
  console.log("🟢 Trading ENABLED");
}

function stopTrading() {
  tradingEnabled = false;
  console.log("🔴 Trading DISABLED");
}

function isTradingEnabled() {
  return tradingEnabled;
}

// ==============================
// 🚫 DUPLICATE SIGNAL PROTECTION
// ==============================
const recentSignals = new Map();

function isDuplicate(signal) {
  const key = `${signal.TS}_${signal.TT}_${signal.Q}`;

  if (recentSignals.has(key)) return true;

  recentSignals.set(key, Date.now());

  setTimeout(() => recentSignals.delete(key), 10000);

  return false;
}

// ==============================
// ⚡ TRADE LIMIT CONTROL
// ==============================
let maxTradesPerMinute = 5;
let tradeCount = 0;
let lastReset = Date.now();

function canTrade() {
  const now = Date.now();

  if (now - lastReset > 60000) {
    tradeCount = 0;
    lastReset = now;
  }

  if (tradeCount >= maxTradesPerMinute) {
    return false;
  }

  tradeCount++;
  return true;
}

// ==============================
// 📦 EXPORTS (ONLY ONCE)
// ==============================
module.exports = {
  isTradingEnabled,
  startTrading,
  stopTrading,
  isDuplicate,
  canTrade
};