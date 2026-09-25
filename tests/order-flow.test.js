const assert = require("assert");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const tokenManager = require("../tokenManager");

const Trade = require("../models/Trade");
const tradesFile = path.join(__dirname, "..", "data", "tables", "trades.json");
const originalPost = axios.post;
const originalGet = axios.get;
const originalGetAccessToken = tokenManager.getAccessToken;
const orderPayloads = [];
let getCallCount = 0;

async function run() {
  tokenManager.getAccessToken = () => "test-access-token";
  axios.post = async (url, payload) => {
    assert.strictEqual(url, "https://api.upstox.com/v2/order/place");
    orderPayloads.push(payload);
    return {
      data: {
        data: {
          order_id: orderPayloads.length === 1 ? "TEST-ENTRY-1" : "TEST-EXIT-1",
          average_price: orderPayloads.length === 1 ? 100 : 160
        }
      }
    };
  };
  axios.get = async (url) => {
    getCallCount += 1;

    if (url.includes("retrieve-all")) {
      return {
        data: {
          data: [{
            order_id: "TEST-ENTRY-1",
            status: "complete",
            filled_quantity: 25,
            average_price: 100
          }]
        }
      };
    }

    return { data: { data: { "NSE_EQ|TEST": { last_price: 200 } } } };
  };

  const { placeOrder } = require("../orderService");
  const profitBooking = require("../profitBooking");
  const { findInstrument } = require("../instrumentStore");
  const instrument = findInstrument("GBPINR 130 CE 14 AUG 26");

  await Trade.clearAll();

  const result = await placeOrder({
    TS: "GBPINR 130 CE 14 AUG 26",
    quantity: 25,
    transaction_type: "buy",
    product: "NRML",
    validity: "DAY",
    order_type: "MARKET",
    target_points: 20,
    stop_loss_points: 10
  });

  assert.strictEqual(result.data.order_id, "TEST-ENTRY-1");
  assert.strictEqual(orderPayloads[0].quantity, 25);
  assert.strictEqual(orderPayloads[0].instrument_token, instrument.instrument_token);
  assert.strictEqual(orderPayloads[0].transaction_type, "BUY");
  assert.strictEqual(orderPayloads[0].product, "D");

  await new Promise((resolve) => setImmediate(resolve));
  const positions = profitBooking.getMonitoringStatus().positions;
  assert.strictEqual(positions.length, 1);
  assert.strictEqual(positions[0].tradingSymbol, "GBPINR 130 CE 14 AUG 26");
  assert.strictEqual(positions[0].orderQuantity, 25);
  assert.strictEqual(positions[0].targetPrice, 120);
  assert.strictEqual(positions[0].stopLossPrice, 90);

  await profitBooking.checkAndBookProfits();

  assert.strictEqual(orderPayloads[1].quantity, 25);
  assert.strictEqual(orderPayloads[1].instrument_token, instrument.instrument_token);
  assert.strictEqual(orderPayloads[1].transaction_type, "SELL");
  assert.ok(getCallCount >= 2, "expected order sync and LTP requests");

  const trades = await Trade.find();
  const entry = trades.find((trade) => trade.orderId === "TEST-ENTRY-1");
  const exit = trades.find((trade) => trade.orderId === "TEST-EXIT-1");
  assert.strictEqual(entry.status, "CLOSED");
  assert.strictEqual(entry.profit_booked, true);
  assert.strictEqual(entry.target_price, 120);
  assert.strictEqual(entry.stop_loss_price, 90);
  assert.strictEqual(exit.side, "SELL");
  assert.strictEqual(exit.quantity, 25);

  await profitBooking.registerPosition({
    orderId: "TEST-SL-POSITION",
    instrument: instrument.instrument_token,
    trading_symbol: "GBPINR 130 CE 14 AUG 26",
    exchange: "NFO",
    side: "SELL",
    quantity: 26,
    requested_quantity: 26,
    entry_price: 100,
    target_points: 20,
    stop_loss_points: 10
  });
  await profitBooking.checkAndBookProfits();
  assert.strictEqual(orderPayloads[2].quantity, 26);
  assert.strictEqual(orderPayloads[2].transaction_type, "BUY");
  assert.strictEqual(
    profitBooking.getMonitoringStatus().positions.find((position) => position.orderId === "TEST-SL-POSITION").status,
    "BOOKED"
  );

  await Trade.clearAll();
  if (fs.existsSync(tradesFile)) fs.unlinkSync(tradesFile);
  console.log("order flow test passed");
}

run()
  .catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  })
  .finally(() => {
    axios.post = originalPost;
    axios.get = originalGet;
    tokenManager.getAccessToken = originalGetAccessToken;
  });
