const axios = require("axios");
const { getAccessToken } = require("./tokenManager");
const { getTargetPoints } = require("./targetConfig");
const Trade = require("./models/Trade");

const MAX_LTP_STALE_MS = Number(process.env.MAX_LTP_STALE_MS || 30000);

// ==============================
// 📊 ACTIVE POSITION TRACKER
// ==============================
const activePositions = new Map(); // key: orderId, value: position data

// ==============================
// 🎯 REGISTER POSITION FOR MONITORING
// ==============================
async function registerPosition(trade) {
  try {
    if (!trade || !trade.orderId) {
      console.log("⚠️ Invalid trade for registration");
      return;
    }

    const tradingSymbol = trade.trading_symbol || trade.instrument;
    const baseSymbol = tradingSymbol.split(" ")[0];
    const configuredTargetPoints = Number(trade.target_points);
    const configuredStopLossPoints = Number(trade.stop_loss_points);
    const targetPoints = Number.isFinite(configuredTargetPoints) && configuredTargetPoints > 0
      ? configuredTargetPoints
      : getTargetPoints(baseSymbol);
    const stopLossPoints = Number.isFinite(configuredStopLossPoints) && configuredStopLossPoints > 0
      ? configuredStopLossPoints
      : null;

    const entryPrice = Number(
      trade.entry_price || trade.avg_price || trade.price
    );
    
    // ✅ VALIDATION: Entry price must be valid positive number
    if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
      console.log(`⚠️ Invalid entry price ${entryPrice} for ${trade.instrument}, skipping registration`);
      return;
    }

    // Calculate target price based on side
    let targetPrice;
    if (trade.side === "BUY") {
      targetPrice = entryPrice + targetPoints;
    } else { // SELL
      targetPrice = entryPrice - targetPoints;
    }

    // Normalize for safety
    targetPrice = Number(targetPrice);
    if (!Number.isFinite(targetPrice)) {
      console.error(`❌ Target price is not a finite number for ${trade.orderId}`);
      return;
    }

    // ✅ Validate target price is also valid
    if (!Number.isFinite(targetPrice) || targetPrice <= 0) {
      console.error(`❌ Invalid target price calculated: ${targetPrice}`);
      return;
    }

    const stopLossPrice = stopLossPoints === null
      ? null
      : trade.side === "BUY"
        ? entryPrice - stopLossPoints
        : entryPrice + stopLossPoints;

    if (stopLossPrice !== null && (!Number.isFinite(stopLossPrice) || stopLossPrice <= 0)) {
      console.error(`❌ Invalid stop-loss price calculated: ${stopLossPrice}`);
      return;
    }

    const positionData = {
      orderId: trade.orderId,
      instrument: trade.instrument,
      tradingSymbol,
      exchange: trade.exchange,
      side: trade.side,
      quantity: trade.quantity,
      orderQuantity: Number(trade.requested_quantity || trade.quantity),
      entryPrice: entryPrice,
      targetPrice: targetPrice,
      targetPoints: targetPoints,
      stopLossPrice,
      stopLossPoints,
      lastLtpAt: null,
      registeredAt: new Date(),
      status: "MONITORING", // MONITORING, BOOKED, FAILED
      tradeId: trade._id
    };

    activePositions.set(trade.orderId, positionData);

    await Trade.updateOne(
      { orderId: trade.orderId },
      {
        entry_price: entryPrice,
        target_price: targetPrice,
        target_points: targetPoints,
        stop_loss_price: stopLossPrice,
        stop_loss_points: stopLossPoints
      }
    );

    console.log(`
    ✅ POSITION REGISTERED FOR PROFIT BOOKING
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    📍 Order ID: ${trade.orderId}
    🏷️  Instrument: ${trade.instrument}
    💰 Entry Price: ${entryPrice}
    🎯 Target Price: ${targetPrice}
    📈 Points: ${targetPoints}
    🔄 Side: ${trade.side}
    📦 Quantity: ${trade.quantity}
    `);

  } catch (err) {
    console.error("❌ Error registering position:", err.message);
  }
}

// ==============================
// 📡 FETCH CURRENT LTP (WITH TIMEOUT & VALIDATION)
// ==============================
async function getLTP(instrumentToken, exchange) {
  try {
    const token = getAccessToken();
    
    if (!token) {
      console.error("❌ No access token for LTP fetch");
      return null;
    }

    // ✅ Handle instrument_key format: could be "NSE_EQ|INE731H01025" or "INE731H01025"
    let key = instrumentToken;
    if (!key.includes(":") && !key.includes("|")) {
      // If it's just the ISIN code, prepend exchange
      key = `${exchange}_EQ|${key}`;
    }

    console.log(`📍 Fetching LTP for: ${key}`);

    const res = await axios.get(
      `https://api.upstox.com/v2/market-quote/ltp`,
      {
        params: {
          mode: "LTP",
          instrument_key: key
        },
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json"
        },
        timeout: 5000
      }
    );

    if (res.data && res.data.data) {
      const ltpData = Object.values(res.data.data)[0];
      const ltp = ltpData?.last_price || null;
      if (ltp) {
        console.log(`💹 LTP: ${ltp}`);
      }
      return ltp;
    }

    return null;
  } catch (err) {
    console.error("❌ LTP Fetch Error:", err.response?.data?.errors || err.message);
    return null;
  }
}

// ==============================
// ✅ BOOK PROFIT (PLACE CLOSING ORDER)
// ==============================
async function bookProfit(position, exitReason = "TP") {
  try {
    console.log(`\n🎬 ATTEMPTING TO BOOK PROFIT FOR ${position.orderId}`);

    const { placeOrder } = require("./orderService");

    // Opposite transaction type
    const closingTxnType = position.side === "BUY" ? "SELL" : "BUY";

    // Create closing order payload
    const closingOrder = {
      TS: position.tradingSymbol,
      quantity: position.orderQuantity,
      transaction_type: closingTxnType,
      order_type: "MARKET",
      product: "NRML",
      validity: "DAY",
      skipProfitBooking: true
    };

    console.log("🚀 Closing Order Payload:", closingOrder);

    // Place closing order
    await placeOrder(closingOrder);

    // Update position status
    position.status = "BOOKED";
    position.bookedAt = new Date();
    activePositions.set(position.orderId, position);

    // Update trade in database
    await Trade.updateOne(
      { orderId: position.orderId },
      {
        status: "CLOSED",
        target_price: position.targetPrice,
        stop_loss_price: position.stopLossPrice,
        pnl: exitReason === "SL"
          ? -position.stopLossPoints
          : exitReason === "TP"
            ? position.targetPoints
            : null,
        exit_time: new Date(),
        profit_booked: exitReason === "TP",
        exit_reason: exitReason
      }
    );

    // Emit to frontend
    if (global.io) {
      global.io.emit("profit_booked", {
        orderId: position.orderId,
        instrument: position.instrument,
        entryPrice: position.entryPrice,
        targetPrice: position.targetPrice,
        points: position.targetPoints,
        exitReason,
        side: position.side,
        quantity: position.quantity
      });
    }

    console.log(`
    ✅ PROFIT BOOKED SUCCESSFULLY!
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    📍 Order ID: ${position.orderId}
    🏷️  Instrument: ${position.instrument}
    💰 Entry Price: ${position.entryPrice}
    🎯 Target Price: ${position.targetPrice}
    📈 Profit Points: ${position.targetPoints}
    `);

  } catch (err) {
    console.error("❌ Error booking profit:", err.message);
    position.status = "FAILED";
    activePositions.set(position.orderId, position);
  }
}

// ==============================
// 🔍 CHECK ALL POSITIONS (MAIN MONITORING LOOP)
// ==============================
async function checkAndBookProfits() {
  try {
    if (activePositions.size === 0) {
      return; // No active positions
    }

    console.log(`\n📊 CHECKING ${activePositions.size} ACTIVE POSITION(S)...`);

    for (const [orderId, position] of activePositions) {
      try {
        // ✅ VALIDATION: Check position data integrity
        if (!position || !position.instrument || !position.exchange || !position.side) {
          console.error(`❌ Invalid position data for ${orderId}`);
          position.status = "FAILED";
          activePositions.set(orderId, position);
          continue;
        }

        // Skip if already booked or failed
        if (position.status !== "MONITORING") {
          console.log(`⏭️  Skipping ${orderId} - Status: ${position.status}`);
          continue;
        }

        // Fetch current LTP
        const currentLTP = await getLTP(position.instrument, position.exchange);

        if (!currentLTP || currentLTP <= 0) {
          const now = Date.now();
          const lastLtpAt = position.lastLtpAt || position.registeredAt.getTime();
          const staleForMs = now - lastLtpAt;
          console.log(`⚠️  Could not fetch valid LTP for ${position.instrument}`);

          if (staleForMs >= MAX_LTP_STALE_MS) {
            console.error(`❌ LTP stale for ${staleForMs}ms; forcing market exit for ${position.orderId}`);
            position.status = "BOOKING";
            activePositions.set(position.orderId, position);
            await bookProfit(position, "LTP_UNAVAILABLE");
          }

          continue;
        }

        position.lastLtpAt = Date.now();
        activePositions.set(position.orderId, position);

        console.log(`
        📍 ${position.instrument}
        💹 Current LTP: ${currentLTP}
        🎯 Target Price: ${position.targetPrice}
        💰 Entry Price: ${position.entryPrice}
        🔄 Side: ${position.side}
        `);

        // Check if target is reached
        let exitReason = null;

        const targetHit = position.side === "BUY"
          ? currentLTP >= position.targetPrice
          : currentLTP <= position.targetPrice;
        const stopLossHit = position.stopLossPrice !== null && (position.side === "BUY"
          ? currentLTP <= position.stopLossPrice
          : currentLTP >= position.stopLossPrice);

        if (stopLossHit) {
          exitReason = "SL";
          console.log(`🛑 ${position.side} STOP LOSS HIT at ${currentLTP}`);
        } else if (targetHit) {
          exitReason = "TP";
          console.log(`✅ BUY TARGET HIT! LTP (${currentLTP}) >= Target (${position.targetPrice})`);
        }

        if (exitReason) {
          console.log(`✅ ${exitReason} exit threshold reached for ${position.orderId}`);
        }

        // ✅ RACE CONDITION FIX: Mark as BOOKING to prevent double-booking
        if (exitReason && position.status === "MONITORING") {
          position.status = "BOOKING";
          activePositions.set(position.orderId, position);
          await bookProfit(position, exitReason);
        }

      } catch (err) {
        console.error(`❌ Error processing position ${orderId}:`, err.message);
      }
    }

  } catch (err) {
    console.error("❌ Error in checkAndBookProfits:", err.message);
  }
}

// ==============================
// ⏰ START MONITORING LOOP
// ==============================
let monitoringInterval = null;

function startProfitBooking(interval = 5000) {
  if (monitoringInterval) {
    console.log("⚠️  Profit booking already running");
    return;
  }

  console.log(`🟢 PROFIT BOOKING STARTED (Checking every ${interval}ms)`);

  monitoringInterval = setInterval(() => {
    checkAndBookProfits();
  }, interval);
}

// ==============================
// 🛑 STOP MONITORING LOOP
// ==============================
function stopProfitBooking() {
  if (monitoringInterval) {
    clearInterval(monitoringInterval);
    monitoringInterval = null;
    console.log("🔴 PROFIT BOOKING STOPPED");
  }
}

// ==============================
// 📊 GET MONITORING STATUS
// ==============================
function getMonitoringStatus() {
  return {
    isActive: monitoringInterval !== null,
    activePositions: activePositions.size,
    positions: Array.from(activePositions.values())
  };
}

// ==============================
// 🗑️ CLEAR BOOKED POSITIONS (MEMORY LEAK FIX)
// ==============================
function clearBookedPositions() {
  let cleared = 0;
  const now = Date.now();
  const RETENTION_TIME = 3600000; // 1 hour
  
  for (const [orderId, position] of activePositions) {
    if (position.status !== "MONITORING") {
      // Keep failed/booked positions for 1 hour for debugging
      const posTime = position.bookedAt || position.registeredAt;
      if (posTime instanceof Date) {
        const age = now - posTime.getTime();
        if (age > RETENTION_TIME) {
          activePositions.delete(orderId);
          cleared++;
        }
      }
    }
  }

  if (cleared > 0) {
    console.log(`🗑️  Cleaned up ${cleared} old completed positions (Memory: ${activePositions.size} active)`);
  }
  return cleared;
}

// ==============================
// ⏰ CLEANUP TIMER (Run every 30 minutes - MEMORY LEAK FIX)
// ==============================
let cleanupTimer = null;

function startCleanupTimer() {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    clearBookedPositions();
  }, 1800000); // 30 minutes
  console.log("🧹 Position cleanup timer started");
}

function stopCleanupTimer() {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
    console.log("🧹 Position cleanup timer stopped");
  }
}

module.exports = {
  registerPosition,
  checkAndBookProfits,
  startProfitBooking,
  stopProfitBooking,
  getMonitoringStatus,
  clearBookedPositions,
  startCleanupTimer,
  stopCleanupTimer,
  activePositions
};
