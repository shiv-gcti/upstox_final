// ==============================
// 🎯 TARGET BASED PROFIT CONFIG
// ==============================
// Define target points (in rupees) for different symbols
// You can add as many symbols as needed

const TARGET_POINTS = {
  // Format: "SYMBOL": target_points_in_rupees
  // Examples:
  "BANKNIFTY": 50,        // 50 rupees profit target
  "NIFTY": 10,            // 30 rupees profit target
  "FINNIFTY": 40,         // 40 rupees profit target
  "SENSEX": 100,          // 100 rupees profit target
  "INDIAVIX": 2,          // 2 rupees profit target
  
  // Add more symbols below
  "RELIANCE": 10,
  "HDFC": 15,
  "INFOSYS": 12,
  "ICICI": 8,
  "TCS": 20,
};

// ==============================
// 🔍 GET TARGET FOR SYMBOL
// ==============================
function getTargetPoints(symbol) {
  if (!symbol) return null;
  
  // Extract base symbol (without expiry/strike info)
  const baseSymbol = symbol.split(" ")[0];
  
  return TARGET_POINTS[baseSymbol] || 50; // Default 50 if not found
}

// ==============================
// 📝 UPDATE TARGET CONFIG
// ==============================
function updateTargetPoints(symbol, points) {
  TARGET_POINTS[symbol] = points;
  console.log(`✅ Target updated: ${symbol} = ${points} points`);
}

// ==============================
// 📊 GET ALL TARGETS
// ==============================
function getAllTargets() {
  return TARGET_POINTS;
}

module.exports = {
  TARGET_POINTS,
  getTargetPoints,
  updateTargetPoints,
  getAllTargets
};
