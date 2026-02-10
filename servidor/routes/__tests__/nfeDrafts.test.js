const test = require('node:test');
const assert = require('node:assert');

const router = require('../nfeDrafts');

test('formatNDup gera 001/002/003', () => {
  assert.strictEqual(router._test.formatNDup(1), '001');
  assert.strictEqual(router._test.formatNDup(2), '002');
  assert.strictEqual(router._test.formatNDup(3), '003');
});
