const axios = require("axios");
const Trade = require("./models/Trade");
const { getAccessToken } = require("./tokenManager");

async function syncOrders() {
  try {
    const token = getAccessToken();
    if (!token) return;

    const response = await axios.get(
      "https://api.upstox.com/v2/order/retrieve-all",
      {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 10000
      }
    );

    const brokerOrders = response.data?.data || [];

    // 🔹 Create map of broker orders
    const brokerMap = new Map();
    brokerOrders.forEach(o => {
      brokerMap.set(o.order_id, o);
    });

    // 🔹 Get all OPEN trades from DB
    const openTrades = await Trade.find({
      status: { $in: ["OPEN", "PARTIAL"] }
    });

    for (const trade of openTrades) {
      const brokerOrder = brokerMap.get(trade.orderId);

      const isLocalOnlyOrder = (id) => typeof id === "string" && /^(TEST-|LOCAL-|DEBUG-)/i.test(id);
      if (isLocalOnlyOrder(trade.orderId)) {
        console.log("⏭️ Skipping local-only trade order:", trade.orderId);
        continue;
      }

      // ==============================
      // ✅ CASE 1: FOUND IN BROKER
      // ==============================
      if (brokerOrder) {
        const newStatus = mapStatus(brokerOrder.status);
        const entryPriceToSave = brokerOrder.average_price || brokerOrder.price || 0;
        const updateFields = {
          status: newStatus,
          filled_qty: brokerOrder.filled_quantity || 0,
          avg_price: brokerOrder.average_price || 0,
          raw: brokerOrder
        };

        if (entryPriceToSave > 0) {
          updateFields.entry_price = entryPriceToSave;
        }

        try {
          await Trade.updateOne(
            { orderId: trade.orderId },
            updateFields
          );

          if (global.io) {
            global.io.emit("order_update", {
              orderId: trade.orderId,
              status: newStatus
            });
          }
        } catch (updateErr) {
          console.error(`❌ Failed to update trade ${trade.orderId}:`, updateErr.message);
        }
      }

      // ==============================
      // ❗ CASE 2: NOT IN BROKER
      // ==============================
      else {
        console.log("⚠️ Not found in broker:", trade.orderId);

        try {
          await Trade.updateOne(
            { orderId: trade.orderId },
            {
              status: "CLOSED" // or "CANCELLED" if you prefer
            }
          );

          if (global.io) {
            global.io.emit("order_update", {
              orderId: trade.orderId,
              status: "CLOSED"
            });
          }
        } catch (updateErr) {
          console.error(`❌ Failed to close trade ${trade.orderId}:`, updateErr.message);
        }
      }
    }

  } catch (err) {
    console.error("❌ Sync error:", err.response?.data || err.message);
  }
}

// ==============================
// STATUS MAP
// ==============================
function mapStatus(status) {
  if (!status) return "OPEN";

  status = status.toLowerCase();

  if (status.includes("complete")) return "CLOSED";
  if (status.includes("cancel")) return "CANCELLED";
  if (status.includes("reject")) return "FAILED";
  if (status.includes("partial")) return "PARTIAL";

  return "OPEN";
}

// ==============================
// SYNC SPECIFIC ORDER
// ==============================
async function syncSpecificOrder(orderId) {
  try {
    if (!orderId) return null;

    const token = getAccessToken();
    if (!token) return null;

    const response = await axios.get(
      "https://api.upstox.com/v2/order/retrieve-all",
      {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 10000
      }
    );

    const brokerOrders = response.data?.data || [];
    const brokerOrder = brokerOrders.find(o => o.order_id === orderId);

    if (brokerOrder) {
      const newStatus = mapStatus(brokerOrder.status);
      const entryPriceToSave = brokerOrder.average_price || brokerOrder.price || 0;
      const updateFields = {
        status: newStatus,
        filled_qty: brokerOrder.filled_quantity || 0,
        avg_price: brokerOrder.average_price || 0,
        raw: brokerOrder
      };

      if (entryPriceToSave > 0) {
        updateFields.entry_price = entryPriceToSave;
      }

      try {
        const updatedTrade = await Trade.findOneAndUpdate(
          { orderId: orderId },
          updateFields,
          { new: true }
        );

        if (global.io) {
          global.io.emit("order_update", {
            orderId: orderId,
            status: newStatus,
            avg_price: brokerOrder.average_price || 0
          });
        }

        return updatedTrade;
      } catch (updateErr) {
        console.error(`❌ Failed to update trade ${orderId}:`, updateErr.message);
        return null;
      }
    } else {
      console.log("⚠️ Order not found in broker:", orderId);
      return null;
    }
  } catch (err) {
    console.error("❌ Sync specific order error:", err.response?.data || err.message);
    return null;
  }
}

module.exports = { syncOrders, syncSpecificOrder };
