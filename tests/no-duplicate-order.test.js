const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Trade = require('../models/Trade');
const { isDuplicateOrderRequest, hasRecentOpenOrder } = require('../orderService');

const tableFile = path.join(__dirname, '..', 'data', 'tables', 'trades.json');
if (fs.existsSync(tableFile)) {
  fs.unlinkSync(tableFile);
}

const baseOrder = {
  TS: 'NIFTY 50',
  transaction_type: 'BUY',
  quantity: 1,
  product: 'CNC',
  order_type: 'MARKET'
};

const now = Date.now();

assert.strictEqual(
  isDuplicateOrderRequest(baseOrder, now),
  false,
  'first request should not be marked duplicate'
);

assert.strictEqual(
  isDuplicateOrderRequest(baseOrder, now + 15000),
  true,
  'same order within 30 seconds should be treated as duplicate'
);

assert.strictEqual(
  isDuplicateOrderRequest({ ...baseOrder, transaction_type: 'SELL' }, now + 15000),
  false,
  'different side should not be treated as duplicate'
);

(async () => {
  await Trade.create({
    trading_symbol: 'NIFTY 50',
    side: 'BUY',
    quantity: 1,
    status: 'OPEN',
    time: new Date().toISOString()
  });

  const existingOpenDuplicate = await hasRecentOpenOrder(baseOrder, Date.now());
  assert.strictEqual(existingOpenDuplicate, true, 'should detect an existing open duplicate order');

  if (fs.existsSync(tableFile)) {
    fs.unlinkSync(tableFile);
  }

  console.log('duplicate order guard test passed');
})();
