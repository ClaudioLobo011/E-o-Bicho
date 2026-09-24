const test = require('node:test');
const assert = require('node:assert/strict');
const { getNfseEnvironmentSnapshot, preserveNfseEnvironmentSnapshot } = require('../../utils/pdvNfseSaleSnapshot');
const PdvState = require('../../models/PdvState');

test('NFS-e environment schema preserves both explicit environments and leaves legacy sales unstamped', () => {
  const state = new PdvState({ completedSales: [
    { id: 'test', nfseEnvironment: 'homologacao' },
    { id: 'real', nfseEnvironment: 'producao' },
    { id: 'legacy' },
  ] }).toObject();
  assert.deepEqual(state.completedSales.map(sale => sale.nfseEnvironment), ['homologacao', 'producao', undefined]);
  assert.equal(getNfseEnvironmentSnapshot({ nfseEnvironment: 'PRODUCAO' }), undefined);
  assert.equal(getNfseEnvironmentSnapshot({ nfseEnvironment: 1 }), undefined);
  assert.equal(getNfseEnvironmentSnapshot({ receiptSnapshot: { nfseEnvironment: 'homologacao' } }), 'homologacao');
});

test('stale snapshot cannot change original NFS-e environment or mutate its input', () => {
  const receiptSnapshot = { nfseEnvironment: 'producao', pagamentos: { items: [{ valor: 10 }] } };
  const incoming = { id: 'sale', customerName: 'Cliente', receiptSnapshot, nfseEnvironment: 'producao' };
  const merged = preserveNfseEnvironmentSnapshot(incoming, { nfseEnvironment: 'homologacao' });
  assert.equal(merged.nfseEnvironment, 'homologacao');
  assert.equal(merged.receiptSnapshot.nfseEnvironment, 'homologacao');
  assert.equal(incoming.receiptSnapshot.nfseEnvironment, 'producao');
  assert.deepEqual(merged.receiptSnapshot.pagamentos, receiptSnapshot.pagamentos);
  assert.equal(merged.customerName, 'Cliente');
});

test('legacy state merge cannot stamp an old sale as production retroactively', () => {
  const result = preserveNfseEnvironmentSnapshot({ nfseEnvironment: 'producao', receiptSnapshot: { nfseEnvironment: 'producao', items: [] } }, { id: 'old-sale' });
  assert.equal(result.nfseEnvironment, undefined);
  assert.equal(result.receiptSnapshot.nfseEnvironment, undefined);
  assert.deepEqual(result.receiptSnapshot.items, []);
});
