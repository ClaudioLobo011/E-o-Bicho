const test = require('node:test');
const assert = require('node:assert');

const router = require('../nfeDrafts');

test('formatNDup gera 001/002/003', () => {
  assert.strictEqual(router._test.formatNDup(1), '001');
  assert.strictEqual(router._test.formatNDup(2), '002');
  assert.strictEqual(router._test.formatNDup(3), '003');
});

test('normalizeStockMovement normaliza remover/adicionar', () => {
  assert.strictEqual(router._test.normalizeStockMovement('remover'), 'saida');
  assert.strictEqual(router._test.normalizeStockMovement('adicionar'), 'entrada');
  assert.strictEqual(router._test.normalizeStockMovement('saída'), 'saida');
  assert.strictEqual(router._test.normalizeStockMovement('invalido'), '');
});

test('collectStockMovementsFromItems agrega quantidades por productId', async () => {
  const productId = '65a123456789012345678901';
  const quantities = await router._test.collectStockMovementsFromItems({
    items: [
      { productId, qty: '2,500' },
      { productId, qtyTrib: '1,000' },
      { productId, quantity: 0.5 },
      { productId: '65a123456789012345678902', qty: '0' },
    ],
    session: null,
  });

  assert.strictEqual(quantities.size, 1);
  assert.strictEqual(Number(quantities.get(productId).toFixed(6)), 4);
});
