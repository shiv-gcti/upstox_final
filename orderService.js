const axios = require("axios");
const { getAccessToken } = require("./tokenManager");
const Trade = require("./models/Trade");

const { findInstrument } = require("./instrumentStore");
const { decodeSymbol } = require("./symbolDecoder");
const { syncSpecificOrder } = require("./syncService");

const DUPLICATE_ORDER_WINDOW_MS = 30 * 1000;
const recentOrderRequests = new Map();

function normalizeOrderKey(order = {}) {
  const symbol = String(order.TS || order.symbol || order.trading_symbol || "").trim().toUpperCase();
  const action = String(order.transaction_type || order.side || order.action || "").trim().toUpperCase();
  const quantity = Number(order.quantity || 0);
  const product = String(order.product || "CNC").trim().toUpperCase();
  const orderType = String(order.order_type || "MARKET").trim().toUpperCase();
  const exchange = String(order.exchange || "").trim().toUpperCase();

  return `${exchange}|${symbol}|${action}|${quantity}|${product}|${orderType}`;
}

async function hasRecentOpenOrder(order, now = Date.now()) {
  if (!order || !order.TS) {
    return false;
  }

  const symbol = String(order.TS || order.symbol || order.trading_symbol || "").trim().toUpperCase();
  const action = String(order.transaction_type || order.side || order.action || "").trim().toUpperCase();

  if (!symbol || !action) {
    return false;
  }

  const trades = await Trade.find({
    trading_symbol: symbol,
    side: action,
    status: { $in: ["OPEN", "PARTIAL"] }
  });

  return trades.some((trade) => {
    const tradeTime = new Date(trade.time || trade.createdAt || trade.updatedAt || 0).getTime();
    return Number.isFinite(tradeTime) && (now - tradeTime) <= DUPLICATE_ORDER_WINDOW_MS;
  });
}

function isDuplicateOrderRequest(order, now = Date.now()) {
  if (!order || !order.TS) {
    return false;
  }

  const key = normalizeOrderKey(order);
  const previous = recentOrderRequests.get(key);

  if (!previous) {
    recentOrderRequests.set(key, now);
    return false;
  }

  if (now - previous <= DUPLICATE_ORDER_WINDOW_MS) {
    return true;
  }

  recentOrderRequests.set(key, now);
  return false;
}

function clearDuplicateOrderRequest(order) {
  recentOrderRequests.delete(normalizeOrderKey(order));
}

// ==============================
// 🚀 PLACE ORDER (MCX_FO + LOT SIZE)
// ==============================
async function placeOrder(order) {
  let duplicateReserved = false;

  try {
    const token = getAccessToken();
    
    if (!token) {
      throw new Error("❌ No access token available");
    }

    const action = (order.transaction_type || "").trim().toUpperCase();
    const quantity = Number(order.quantity);
    const rawSymbol = order.TS;

    if (!["BUY", "SELL"].includes(action)) {
      throw new Error("Invalid Action");
    }

    // ✅ QUANTITY VALIDATION (CRITICAL)
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error(`Invalid quantity: ${quantity}. Must be positive number`);
    }

    if (!rawSymbol) {
      throw new Error("Symbol missing");
    }

    if (await hasRecentOpenOrder(order)) {
      throw new Error(`Duplicate order request rejected: same open order already exists within ${DUPLICATE_ORDER_WINDOW_MS / 1000} seconds`);
    }

    // ==============================
    // 🧠 STEP 1: DECODE SYMBOL
    // ==============================
    const decoded = decodeSymbol(rawSymbol);
    console.log("🧠 Decoded:", decoded);

    let instrumentKey = null;
    let instrumentData = null;
    let exchange = decoded.exchange;

    const resolveInstrument = (res) => {
      if (!res) return null;
      if (typeof res === "object") {
        instrumentData = res;
        return res.instrument_token;
      } else {
        instrumentData = null;
        return res;
      }
    };

    // ==============================
    // 🔍 STEP 2: FIND INSTRUMENT
    // ==============================
    if (decoded.instrumentType === "EQ") {
      const formats = [`${decoded.symbol} EQ`, `${decoded.symbol}`];

      for (const f of formats) {
        const res = findInstrument(f);
        instrumentKey = resolveInstrument(res);
        if (instrumentKey) break;
      }

      exchange = decoded.exchange || "NSE";
    }

    else if (decoded.instrumentType === "FUT") {
      const formats = [
        `${decoded.symbol} FUT ${decoded.day} ${decoded.month} ${decoded.year}`,
        `${decoded.symbol} ${decoded.month} ${decoded.year} FUT`,
        `${decoded.symbol} FUT`
      ];

      for (const f of formats) {
        const res = findInstrument(f);
        instrumentKey = resolveInstrument(res);
        if (instrumentKey) break;
      }
    }

    else if (decoded.instrumentType === "OPT") {
      const shortYear = decoded.year.slice(-2);

      const formats = [
        `${decoded.symbol} ${decoded.strike} ${decoded.optionType} ${decoded.day} ${decoded.month} ${shortYear}`,
        `${decoded.symbol} ${decoded.day} ${decoded.month} ${shortYear} ${decoded.optionType} ${decoded.strike}`
      ];

      for (const f of formats) {
        const res = findInstrument(f);
        instrumentKey = resolveInstrument(res);
        if (instrumentKey) break;
      }
    }

    if (!instrumentKey) {
      throw new Error("Instrument not found: " + rawSymbol);
    }

    // ==============================
    // 🔥 LOT SIZE
    // ==============================
    const lotSize =
      instrumentData && instrumentData.lot_size
        ? Number(instrumentData.lot_size)
        : 1;

    const finalQty = quantity * lotSize;

    if (isDuplicateOrderRequest(order)) {
      throw new Error(`Duplicate order request rejected: same order was placed within ${DUPLICATE_ORDER_WINDOW_MS / 1000} seconds`);
    }
    duplicateReserved = true;

    console.log(
      `📦 Lot Size: ${lotSize} | Input Qty: ${quantity} | Final Qty: ${finalQty}`
    );

    console.log("🎯 Matched:", instrumentKey, "| Exchange:", exchange);

    // ==============================
    // 🚀 STEP 3: BUILD PAYLOAD
    // ==============================
    const orderPayload = {
      quantity: finalQty,
      product: String(order.product || "CNC").trim().toUpperCase() === "NRML" ? "D" : "I",
      validity: order.validity || "DAY",
      price: 0,

      instrument_token: instrumentKey,
      exchange: exchange,

      order_type: order.order_type || "MARKET",
      transaction_type: action,

      disclosed_quantity: 0,
      trigger_price: 0,
      is_amo: false
    };

    console.log("📡 Sending:", orderPayload);

    // ==============================
    // 📤 STEP 4: API CALL (WITH TIMEOUT)
    // ==============================
    const response = await axios.post(
      "https://api.upstox.com/v2/order/place",
      orderPayload,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        timeout: 10000
      }
    );

    const orderData = response.data;
    const orderId = orderData.data?.order_id;
    if (!orderId) {
      throw new Error("Broker response did not include an order ID");
    }
    const initialAvgPrice =
      orderData?.data?.average_price ||
      orderData?.data?.avg_price ||
      orderData?.average_price ||
      orderData?.avg_price ||
      orderData?.data?.price ||
      orderData?.price ||
      0;
    const initialPrice =
      orderData?.data?.price ||
      orderData?.price ||
      orderData?.data?.average_price ||
      orderData?.average_price ||
      0;

    console.log("✅ Order Success:", orderData);

    // ==============================
    // 🧾 STEP 5: SAVE TRADE (IMPORTANT CHANGE)
    // ==============================
    const trade = await Trade.create({
      side: action,                 // BUY or SELL
      quantity: finalQty,
      requested_quantity: quantity,
      lot_size: lotSize,
      instrument: instrumentKey,
      trading_symbol: decoded.tradingSymbol || rawSymbol,
      exchange,

      orderId: orderId,

      price: initialPrice,
      avg_price: initialAvgPrice,
      entry_price: initialAvgPrice || initialPrice,
      target_points: order.target_points,
      stop_loss_points: order.stop_loss_points,
      filled_qty: 0,

      status: "OPEN",              // ALWAYS OPEN initially

      order_type: order.order_type,
      product: order.product,

      raw: orderData,
      time: new Date(),
      profit_booking_status: "NOT_STARTED"
    });

    if (!order.skipProfitBooking) {
      const maxRetries = 10;
      let retryCount = 0;

      const attemptRegistration = async () => {
        retryCount++;
        const syncedTrade = await syncSpecificOrder(orderId);

        if (
          syncedTrade &&
          Number(syncedTrade.filled_qty) > 0 &&
          Number(syncedTrade.entry_price) > 0 &&
          Number(syncedTrade.avg_price) > 0
        ) {
          syncedTrade.profit_booking_status = "MONITORING";
          await syncedTrade.save();

          const { registerPosition } = require("./profitBooking");
          await registerPosition(syncedTrade);
          console.log("✅ Position registered for profit booking");
        } else if (retryCount < maxRetries) {
          setTimeout(attemptRegistration, 2000);
        } else {
          console.log(
            "⚠️  Max retries reached for profit booking registration. Synced Trade:",
            syncedTrade
              ? `avg_price=${syncedTrade.avg_price}, filled_qty=${syncedTrade.filled_qty}, status=${syncedTrade.status}`
              : "null"
          );
        }
      };

      attemptRegistration().catch(err =>
        console.error("❌ Error in profit booking registration:", err.message)
      );
    }

    // ==============================
    // 📡 PUSH TO FRONTEND
    // ==============================
    if (global.io) {
      global.io.emit("order_update", { orderId });
    }

    return orderData;

  } catch (err) {
    if (duplicateReserved) {
      clearDuplicateOrderRequest(order);
    }
    console.error("❌ Error:", err.response?.data || err.message);
    throw err;
  }
}

// ==============================
// 📊 TRADE LOG
// ==============================
async function getTradeLog() {
  return await Trade.find().sort({ createdAt: -1 });
}

// ==============================
module.exports = {
  placeOrder,
  getTradeLog,
  isDuplicateOrderRequest,
  hasRecentOpenOrder,
  DUPLICATE_ORDER_WINDOW_MS,
  normalizeOrderKey,
  recentOrderRequests,
  clearDuplicateOrderRequest
};	
