const axios = require("axios");
const Trade = require("./models/Trade");
const { getAccessToken } = require("./tokenManager");
const { findInstrument } = require("./instrumentStore");

async function getPositions() {
  try {
    const token = getAccessToken();

    const res = await axios.get(
      "https://api.upstox.com/v2/portfolio/short-term-positions",
      {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    );

    const positions = res.data.data || [];

    const openTrades = await Trade.find(
      {
        status: { $in: ["OPEN", "PARTIAL"] },
        quantity: { $ne: 0 }
      },
      { instrument: 1, trading_symbol: 1, entry_price: 1, target_price: 1 }
    );

    const positionMapByToken = new Map();
    const positionMapBySymbol = new Map();

    openTrades.forEach(trade => {
      const data = {
        entry_price: trade.entry_price || 0,
        target_price: trade.target_price || 0,
        stop_loss_price: trade.stop_loss_price || 0
      };

      if (trade.instrument) {
        positionMapByToken.set(trade.instrument, data);
      }

      if (trade.trading_symbol) {
        positionMapBySymbol.set(trade.trading_symbol.toUpperCase(), data);
      }
    });

    return positions.map(position => {
      // Prefer symbol-based mapping first (more reliable than token mapping)
      const symKey = position.trading_symbol?.toUpperCase();
      const tradePositionBySymbol = symKey ? positionMapBySymbol.get(symKey) : undefined;

      // Fallback to token-based mapping if symbol mapping fails
      const token = findInstrument(position.trading_symbol)?.instrument_token;
      const tradePositionByToken = token
        ? positionMapByToken.get(token)
        : undefined;

      const tradePosition = tradePositionBySymbol || tradePositionByToken;
      const entryPrice = tradePosition?.entry_price;
      const targetPrice = tradePosition?.target_price;
      const stopLossPrice = tradePosition?.stop_loss_price;

      if (entryPrice > 0) {
        position.entry_price = entryPrice;
        if (!position.average_price || position.average_price === 0) {
          position.average_price = entryPrice;
        }
      }

      if (targetPrice > 0) {
        position.target_price = targetPrice;
      }

      if (stopLossPrice > 0) {
        position.stop_loss_price = stopLossPrice;
      }

      return position;
    });

  } catch (err) {
    console.error("❌ Position Error:", err.response?.data);
    return [];
  }
}

module.exports = { getPositions };