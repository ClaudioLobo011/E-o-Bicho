const test = require('node:test');
const assert = require('node:assert/strict');
const { getPdvNfseConfiguration, resolveSaleNfseEnvironment } = require('../../utils/nfseEnvironment');
const store = { nfse: { enabled: true, environment: 'producao', productionEnabledAt: new Date('2026-09-24T13:00:00.500Z') } };
const pdv = { ambientePadrao: 'producao', ambientesHabilitados: ['producao'] };
const resolve = (sale, extra = {}) => resolveSaleNfseEnvironment({ sale, pdv, store, ...extra });

test('configuração por PDV conserva homologação e não modifica cadastro de origem', () => {
  const testPdv = { ambientePadrao: 'homologacao', ambientesHabilitados: ['homologacao'] };
  assert.equal(getPdvNfseConfiguration(testPdv, store).environment, 'homologacao');
  assert.equal(getPdvNfseConfiguration({ ambientePadrao: 'producao', ambientesHabilitados: ['homologacao'] }, store).environment, 'homologacao');
  assert.equal(getPdvNfseConfiguration(pdv, store).environment, 'producao');
  assert.equal(getPdvNfseConfiguration({}, store).environment, 'homologacao');
  assert.equal(getPdvNfseConfiguration({ ambientePadrao: '' }, store).environment, 'homologacao');
  assert.equal(getPdvNfseConfiguration({ ambientePadrao: 'producao', ambientesHabilitados: [] }, store).environment, 'homologacao');
  assert.equal(store.nfse.environment, 'producao');
});

test('corte de produção compara milissegundos sem arredondar Date do banco', () => {
  assert.throws(() => resolve({ createdAt: new Date('2026-09-24T13:00:00.499Z') }), /anterior à ativação/);
  assert.equal(resolve({ createdAt: new Date('2026-09-24T13:00:00.500Z') }), 'producao');
  assert.throws(() => resolve({ createdAt: 'invalida' }), /anterior à ativação/);
  assert.throws(() => resolve({}), /anterior à ativação/);
});

test('snapshot válido, documentos e prova de homologação nunca são promovidos pelo cadastro novo', () => {
  assert.equal(resolve({ receiptSnapshot: { nfseEnvironment: 'homologacao' } }), 'homologacao');
  assert.equal(resolve({}, { documentEnvironments: ['homologacao', 'homologacao'] }), 'homologacao');
  assert.equal(resolve({ fiscalXmlContent: '<NFe><ide><tpAmb>2</tpAmb></ide></NFe>' }), 'homologacao');
  assert.throws(() => resolve({}, { documentEnvironments: ['homologacao', 'producao'] }), /ambientes diferentes/);
  assert.throws(() => resolve({ nfseEnvironment: 'producao', receiptSnapshot: { nfseEnvironment: 'homologacao' } }), /divergente/);
  assert.throws(() => resolve({ nfseEnvironment: 'incorreto' }), /inválido/);
});
