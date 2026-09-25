const { placeOrder } = require("./orderService");
const { isTradingEnabled } = require("./control");

// ==============================
// 🚫 DUPLICATE SIGNAL PROTECTION
// ==============================
const recentSignals = new Map();

function isDuplicate(signal) {
  const key = `${String(signal.TS).trim().toUpperCase()}_${String(signal.TT).trim().toUpperCase()}_${Number(signal.Q)}`;

  if (recentSignals.has(key)) return true;

  recentSignals.set(key, Date.now());

  setTimeout(() => recentSignals.delete(key), 10000);

  return false;
}

// ==============================
// 🔁 CONVERT TRADINGVIEW → INTERNAL FORMAT
// ==============================
function convertTV(signal) {
  try {
    const transactionType = String(signal.TT || "").trim().toUpperCase();
    const targetPoints = signal.TP ?? signal.target_points ?? signal.targetPoints;
    const stopLossPoints = signal.SL ?? signal.stop_loss_points ?? signal.stopLossPoints;

    return {
      TS: String(signal.TS).trim(),

      quantity: Number(signal.Q),
      product: signal.P || "NRML",
      validity: signal.VL || "DAY",
      price: 0,

      order_type: signal.OT || "MARKET",
      transaction_type: transactionType,
      target_points: targetPoints === undefined || targetPoints === "" ? null : Number(targetPoints),
      stop_loss_points: stopLossPoints === undefined || stopLossPoints === "" ? null : Number(stopLossPoints),

      disclosed_quantity: 0
    };
  } catch (err) {
    console.log("❌ Conversion error:", err.message);
    return null;
  }
}
// ==============================
// 📡 WEBHOOK HANDLER (WITH VALIDATION)
// ==============================
async function handleWebhook(req, res) {
  try {
    const body = req.body;

    // ✅ BODY VALIDATION (CRITICAL)
    if (!body) {
      console.error("❌ Empty webhook body received");
      return res.status(400).send("Invalid request: empty body");
    }

    if (typeof body !== 'object' && !Array.isArray(body)) {
      console.error("❌ Invalid webhook body type:", typeof body);
      return res.status(400).send("Invalid request: body must be object or array");
    }

    console.log("📡 Signal Received:", JSON.stringify(body));

    if (global.io) {
      global.io.emit("signal", body);
    }

    // 🚫 trading OFF check
    if (!isTradingEnabled()) {
      return res.send("⛔ Trading Disabled");
    }

    const signals = Array.isArray(body) ? body : [body];
    const validSignals = [];

    for (const s of signals) {
      const symbol = typeof s?.TS === "string" ? s.TS.trim() : "";
      const quantity = Number(s?.Q);
      const transactionType = typeof s?.TT === "string" ? s.TT.trim().toUpperCase() : "";
      const targetPoints = s?.TP ?? s?.target_points ?? s?.targetPoints;
      const stopLossPoints = s?.SL ?? s?.stop_loss_points ?? s?.stopLossPoints;
      const hasValidTarget = targetPoints === undefined || targetPoints === "" || (Number.isFinite(Number(targetPoints)) && Number(targetPoints) > 0);
      const hasValidStopLoss = stopLossPoints === undefined || stopLossPoints === "" || (Number.isFinite(Number(stopLossPoints)) && Number(stopLossPoints) > 0);

      if (!symbol || !Number.isFinite(quantity) || quantity <= 0 || !["BUY", "SELL"].includes(transactionType) || !hasValidTarget || !hasValidStopLoss) {
        console.log("❌ Invalid signal:", s);
        continue;
      }

      validSignals.push({ ...s, TS: symbol, Q: quantity, TT: transactionType });
    }

    if (validSignals.length === 0) {
      return res.status(400).send("Invalid request: expected TS, positive Q, and TT BUY or SELL");
    }

    for (const s of validSignals) {

      // 🚫 duplicate filter
      if (isDuplicate(s)) {
        console.log("⚠️ Duplicate ignored:", s.TS);
        continue;
      }

      const order = convertTV(s);
      if (!order) continue;

      console.log("📤 Final Order:", order);

      await placeOrder(order);
    }

    res.send("✅ Signal processed");

  } catch (err) {
    console.error("❌ Webhook Error:", err.message);
    res.status(500).send("Error");
  }
}

module.exports = { handleWebhook };