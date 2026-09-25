const assert = require('assert');
const fs = require('fs');
const path = require('path');

(async () => {
  const Trade = require(path.join(__dirname, '..', 'models', 'Trade')).forTable('trades_test');
  const tableFile = path.join(__dirname, '..', 'data', 'tables', 'trades_test.json');

  if (fs.existsSync(tableFile)) {
    fs.unlinkSync(tableFile);
  }

  const testOrderId = 'TEST-ORDER-LOCAL-1';

  await Trade.create({
    orderId: testOrderId,
    side: 'BUY',
    instrument: 'NSE_EQ|INE',
    quantity: 10,
    trading_symbol: 'INFY',
    status: 'OPEN',
    entry_price: 1500,
    target_price: 1600,
    profit_booking_status: 'NOT_STARTED'
  });

  const trades = await Trade.find({ orderId: testOrderId });
  assert(trades.length >= 1, 'expected at least one saved trade');

  const updated = await Trade.findOneAndUpdate(
    { orderId: testOrderId },
    { status: 'PARTIAL', filled_qty: 5 },
    { new: true }
  );

  assert(updated.status === 'PARTIAL', 'expected status to update in local store');

  await Trade.clearAll();
  const clearedTrades = await Trade.find({ orderId: testOrderId });
  assert(clearedTrades.length === 0, 'expected trade log to be cleared at daily reset');

  if (fs.existsSync(tableFile)) {
    fs.unlinkSync(tableFile);
  }
  console.log('trade store test passed');
})();
