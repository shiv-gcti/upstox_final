const assert = require('assert');

const tokenManager = require('../tokenManager');
assert.strictEqual(typeof tokenManager.isTokenExpired, 'function', 'isTokenExpired should be exported');

const orderService = require('../orderService');
assert.ok(orderService && typeof orderService.placeOrder === 'function', 'placeOrder should be available');

console.log('runtime regression checks passed');
