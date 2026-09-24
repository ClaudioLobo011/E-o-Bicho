const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeStoreNfse, prepareStoreNfseForSave } = require('../../utils/nfseConfig');
const Store = require('../../models/Store');

const production = { enabled: true, environment: 'producao', serieDps: '49997', opSimpNac: '1', regimeEspecialTributacao: '0' };
const activation = '2026-09-24T14:00:00.000Z';

test('first production activation uses server time instead of a client-supplied date', () => {
  const config = prepareStoreNfseForSave({ ...production, productionEnabledAt: '2020-01-01T00:00:00Z' }, {}, new Date(activation));
  assert.equal(config.productionEnabledAt, activation);
  assert.equal(new Store({ nome: 'Teste', nfse: config }).toObject().nfse.productionEnabledAt.toISOString(), activation);
});

test('editing, disabling, or toggling environment preserves the original activation boundary', () => {
  const previous = { ...production, productionEnabledAt: new Date(activation) };
  for (const change of [{}, { enabled: false }, { environment: 'homologacao' }, { productionEnabledAt: null }, { productionEnabledAt: '2020-01-01T00:00:00Z' }]) {
    const config = prepareStoreNfseForSave({ ...production, ...change }, previous, new Date('2026-10-01T00:00:00Z'));
    assert.equal(config.productionEnabledAt, activation);
  }
});

test('homologation or disabled production does not start a production activation', () => {
  for (const change of [{ environment: 'homologacao' }, { enabled: false }]) {
    const config = prepareStoreNfseForSave({ ...production, ...change, productionEnabledAt: activation });
    assert.equal(config.productionEnabledAt, undefined);
  }
});

test('internal normalization preserves a valid activation date and rejects a corrupt one', () => {
  assert.equal(normalizeStoreNfse({ ...production, productionEnabledAt: new Date(activation) }).productionEnabledAt, activation);
  assert.throws(() => normalizeStoreNfse({ ...production, productionEnabledAt: 'invalid' }), /ativação/);
  assert.throws(() => prepareStoreNfseForSave(production, { productionEnabledAt: 'invalid' }), /ativação/);
});

test('concurrent company edit cannot erase the production activation saved by another request', async t => {
  const router = require('../../routes/stores');
  const oldVersion = new Date('2026-09-24T13:00:00Z');
  const current = { _id: '0123456789abcdef01234567', codigo: '1', updatedAt: new Date(activation), nfse: { ...production, productionEnabledAt: activation } };
  t.mock.method(Store, 'findById', async () => ({ ...current, updatedAt: oldVersion, nfse: { ...production, environment: 'homologacao' } }));
  let conditionalWrite = false;
  t.mock.method(Store, 'findOneAndUpdate', async filter => {
    assert.equal(String(filter._id), String(current._id));
    assert.equal(filter.updatedAt.getTime(), oldVersion.getTime());
    conditionalWrite = true;
    return null; // MongoDB refuses the stale version; the concurrent value remains.
  });
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  const handler = router.stack.find(layer => layer.route?.path === '/:id' && layer.route.methods.put).route.stack.at(-1).handle;
  await handler({ params: { id: current._id }, body: { nome: 'Teste', codigo: '1', nfse: { ...production, environment: 'homologacao' } } }, res);
  assert.equal(conditionalWrite, true);
  assert.equal(res.statusCode, 409);
  assert.match(res.body.message, /Recarregue/);
  assert.equal(current.nfse.productionEnabledAt, activation);
});
