const test = require('node:test');
const assert = require('node:assert/strict');
const Store = require('../../models/Store');
const Pdv = require('../../models/Pdv');
const router = require('../pdvs');

const storeId = '650000000000000000000001';
const post = router.stack.find(layer => layer.route?.path === '/' && layer.route.methods.post).route.stack.at(-1).handle;
const base = { nome: 'PDV serviços de teste', codigo: 'PDV-TEST', empresa: storeId, empresaEmitenteFiscal: storeId, tipoOperacao: 'fiscal', ambientesHabilitados: [], ambientePadrao: '' };
const response = () => ({ statusCode: 200, status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; } });

function mockModels(t, store) {
  let created;
  t.mock.method(Store, 'findById', () => ({ lean: async () => ({ _id: storeId, ...store }) }));
  t.mock.method(Pdv, 'exists', async () => null);
  t.mock.method(Pdv, 'findOne', () => ({ select() { return this; }, lean: async () => null }));
  t.mock.method(Pdv, 'create', async payload => {
    created = payload;
    const record = new Pdv(payload);
    const error = record.validateSync();
    if (error) throw error;
    return { populate: async () => record.toObject() };
  });
  return () => created;
}

test('PDV fiscal somente serviços pode ser cadastrado sem CSC, série ou ambiente de NFC-e', async (t) => {
  const created = mockModels(t, { nfse: { enabled: true, environment: 'homologacao', serieDps: '1' } });
  const res = response();
  await post({ body: { ...base }, user: { id: 'teste', role: 'admin' } }, res);
  assert.equal(res.statusCode, 201, res.body?.message);
  assert.equal(created().serieNfce, '');
  assert.deepEqual(created().ambientesHabilitados, []);
  assert.equal(created().ambientePadrao, '');
  assert.equal(created().configuracoesFiscal.tipoEmissaoPadrao, 'fiscal');
});

test('PDV fiscal sem NFC-e nem NFS-e configuradas continua bloqueado', async (t) => {
  const created = mockModels(t, { nfse: { enabled: false } });
  const res = response();
  await post({ body: { ...base }, user: {} }, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /Habilite um ambiente de NFC-e/);
  assert.equal(created(), undefined);
});

test('NFS-e habilitada não permite habilitar ambiente de produtos sem CSC', async (t) => {
  const created = mockModels(t, { nfse: { enabled: true } });
  const res = response();
  await post({ body: { ...base, serieNfce: '1', ambientesHabilitados: ['homologacao'], ambientePadrao: 'homologacao' }, user: {} }, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /CSC/);
  assert.equal(created(), undefined);
});

test('configuração tradicional de NFC-e com CSC preserva série, ambiente e numeração', async (t) => {
  const created = mockModels(t, { cscIdHomologacao: '000001', cscTokenHomologacaoArmazenado: true });
  const res = response();
  await post({ body: { ...base, serieNfce: '7', numeroNfceInicial: 100, ambientesHabilitados: ['homologacao'], ambientePadrao: 'homologacao' }, user: {} }, res);
  assert.equal(res.statusCode, 201, res.body?.message);
  assert.equal(created().serieNfce, '7');
  assert.equal(created().numeroNfceInicial, 100);
  assert.deepEqual(created().ambientesHabilitados, ['homologacao']);
  assert.equal(created().ambientePadrao, 'homologacao');
});

test('NFS-e não libera ambiente padrão que não está habilitado para NFC-e', async (t) => {
  mockModels(t, { nfse: { enabled: true } });
  const res = response();
  await post({ body: { ...base, ambientePadrao: 'producao' }, user: {} }, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /ambientes habilitados/);
});
