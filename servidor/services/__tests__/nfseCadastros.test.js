const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeStoreNfse, normalizeNfseFiscal, validateNfseFiscal, normalizeServiceFiscalMap,
} = require('../../utils/nfseConfig');
const { normalizeFiscalData, mergeFiscalData } = require('../fiscalRuleEngine');
const Store = require('../../models/Store');
const Service = require('../../models/Service');
const Rule = require('../../models/FiscalDefaultRule');

const storeId = '0123456789abcdef01234567';
const serviceFiscal = {
  codigoTributacaoNacional: '010101', codigoTributacaoMunicipal: '001', codigoNbs: '123456789',
  descricao: 'Descrição de teste', tributacaoIss: '1', tipoRetencaoIss: '1', aliquotaIss: null,
  totalTributosModo: 'percentual', pTotTribFed: 0, pTotTribEst: 0, pTotTribMun: 0,
  ibsCbs: { enabled: true, finNFSe: '0', indFinal: '1', indDest: '0', cIndOp: '100301', CST: '000', cClassTrib: '000001' },
};

test('empresa nova mantém NFS-e desativada e não inventa enquadramento', () => {
  const config = normalizeStoreNfse();
  assert.equal(config.enabled, false);
  assert.equal(config.environment, 'homologacao');
  assert.equal(config.opSimpNac, '');
  assert.equal(config.serieDps, '');
  assert.equal(config.incluirInscricaoMunicipal, false);
  assert.equal(new Store({ nome: 'Teste' }).toObject().nfse.enabled, false);
});

test('habilitação valida série própria e dados explícitos do regime', () => {
  assert.throws(() => normalizeStoreNfse({ enabled: true }), /Para habilitar/);
  for (const serieDps of ['0', '50000', '1.2', 'x']) assert.throws(() => normalizeStoreNfse({ serieDps }), /série/);
  assert.throws(() => normalizeStoreNfse({ enabled: true, serieDps: '1', opSimpNac: '3', regimeEspecialTributacao: '0' }), /apuração/);
  assert.equal(normalizeStoreNfse({ enabled: true, serieDps: '00499', opSimpNac: '3', regApTribSN: '1', regimeEspecialTributacao: '9' }).serieDps, '00499');
});

test('dados fiscais ausentes continuam ausentes e zero explícito é preservado', () => {
  assert.equal(normalizeNfseFiscal({ aliquotaIss: '' }).aliquotaIss, null);
  assert.equal(normalizeNfseFiscal({ aliquotaIss: null }).aliquotaIss, null);
  assert.equal(normalizeNfseFiscal({ aliquotaIss: '  ' }).aliquotaIss, null);
  assert.equal(normalizeNfseFiscal({ aliquotaIss: 0 }).aliquotaIss, 0);
  assert.equal(normalizeNfseFiscal({}).tributacaoIss, '');
  const fiscal = validateNfseFiscal(serviceFiscal);
  assert.equal(fiscal.pTotTribFed, 0);
  assert.equal(fiscal.ibsCbs.CST, '000');
  assert.equal(fiscal.ibsCbs.finNFSe, '0');
  assert.equal(fiscal.codigoTributacaoMunicipal, '001');
});

test('normalizador fiscal e merge não apagam a NFS-e nem alteram dados legados de mercadoria', () => {
  const normalized = normalizeFiscalData({ cfop: { nfce: { dentroEstado: '5102' } }, nfse: serviceFiscal });
  assert.deepEqual(normalized.nfse, normalizeNfseFiscal(serviceFiscal));
  assert.equal(normalized.cfop.nfce.dentroEstado, '5102');
  assert.deepEqual(mergeFiscalData(normalized, { origem: '0' }).nfse, normalized.nfse);
  const legacy = new Rule({ empresa: storeId, code: 1, name: 'Legada' });
  assert.equal(legacy.tipo, 'produto');
});

test('referência opcional de tributos é preservada e exige período completo com datas reais', () => {
  const source = { tributosFonte: 'IBPT', tributosVersao: '26.2.A', tributosVigenciaInicio: '2026-08-20', tributosVigenciaFim: '2026-09-30', tributosCodigoReferencia: '114059400' };
  const fiscal = validateNfseFiscal({ ...serviceFiscal, ...source });
  const rule = new Rule({ empresa: storeId, code: 1, name: 'Teste', tipo: 'servico', fiscal: normalizeFiscalData({ nfse: fiscal }) }).toObject();
  for (const [key, value] of Object.entries(source)) assert.equal(rule.fiscal.nfse[key], value);
  assert.equal(validateNfseFiscal(serviceFiscal).tributosVigenciaInicio, '');
  for (const dates of [
    { tributosVigenciaInicio: '2026-08-20' }, { tributosVigenciaFim: '2026-09-30' },
    { tributosVigenciaInicio: '2026-02-30', tributosVigenciaFim: '2026-09-30' },
    { tributosVigenciaInicio: '20/08/2026', tributosVigenciaFim: '2026-09-30' },
    { tributosVigenciaInicio: '2026-10-01', tributosVigenciaFim: '2026-09-30' },
  ]) assert.throws(() => validateNfseFiscal({ ...serviceFiscal, ...dates }), { status: 400 });
});

test('validação rejeita códigos incompletos e alíquotas inválidas', () => {
  for (const change of [
    { codigoTributacaoNacional: '' }, { codigoTributacaoMunicipal: '1' }, { codigoNbs: '123' },
    { aliquotaIss: NaN }, { aliquotaIss: false }, { aliquotaIss: 6 }, { totalTributosModo: '' }, { pTotTribFed: null },
    { tributacaoIss: '2', tipoImunidade: '0' },
    { ibsCbs: { ...serviceFiscal.ibsCbs, finNFSe: '1' } },
  ]) assert.throws(() => validateNfseFiscal({ ...serviceFiscal, ...change }), { status: 400 });
  assert.throws(() => validateNfseFiscal({ ...serviceFiscal, totalTributosModo: 'simples', pTotTribSN: null }), /Simples/);
});

test('mapa fiscal preserva empresas e descrições sem permitir caminhos MongoDB arbitrários', () => {
  const map = normalizeServiceFiscalMap({ [storeId]: { fiscalRuleCode: 3, descricao: ' Banho ' } });
  assert.deepEqual(map, { [storeId]: { fiscalRuleCode: '3', descricao: 'Banho' } });
  assert.deepEqual(new Service({ fiscalPorEmpresa: map }).toObject().fiscalPorEmpresa, map);
  assert.throws(() => normalizeServiceFiscalMap({ 'empresa.$set': { fiscalRuleCode: '3' } }), /Empresa inválida/);
  assert.throws(() => normalizeServiceFiscalMap({ [storeId]: { fiscalRuleCode: '3x' } }), /Código/);
  assert.deepEqual(normalizeServiceFiscalMap({ [storeId]: { fiscalRuleCode: '', descricao: '' } }), {});
});

function routeHandler(router, method, path) {
  return router.stack.find(layer => layer.route?.path === path && layer.route.methods[method]).route.stack.at(-1).handle;
}
function response() {
  return { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}

test('edição de regra de serviço preserva campos e sinaliza sincronização de serviços', async (t) => {
  const router = require('../../routes/fiscalDefaultRules');
  let update;
  let touched;
  t.mock.method(Store, 'exists', async () => ({ _id: storeId }));
  t.mock.method(Rule, 'findOne', () => ({ lean: async () => ({ tipo: 'servico', code: 7 }) }));
  t.mock.method(Rule, 'findOneAndUpdate', (query, change) => {
    update = change.$set;
    return { lean: async () => ({ ...update, code: 7 }) };
  });
  t.mock.method(Rule, 'countDocuments', async () => 1);
  t.mock.method(Service, 'updateMany', async (query, change) => { touched = { query, change }; return {}; });
  const res = response();
  await routeHandler(router, 'put', '/:code')({ params: { code: '7' }, body: { storeId, tipo: 'servico', name: 'Teste', fiscal: { nfse: serviceFiscal } }, user: { id: 'test', storeIds: [storeId] } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(update.fiscal.nfse, normalizeNfseFiscal(serviceFiscal));
  assert.equal(touched.query[`fiscalPorEmpresa.${storeId}.fiscalRuleCode`], '7');
  assert.ok(touched.change.$set.updatedAt instanceof Date);
});

test('tipo de regra não pode mudar após cadastro e serviço não aceita regra de produto', async (t) => {
  t.mock.method(console, 'error', () => {});
  const ruleRouter = require('../../routes/fiscalDefaultRules');
  t.mock.method(Store, 'exists', async () => ({ _id: storeId }));
  t.mock.method(Rule, 'findOne', () => ({ lean: async () => ({ tipo: 'produto', code: 7 }) }));
  const res = response();
  await routeHandler(ruleRouter, 'put', '/:code')({ params: { code: '7' }, body: { storeId, tipo: 'servico', name: 'Teste', fiscal: { nfse: serviceFiscal } }, user: { storeIds: [storeId] } }, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /tipo/);
  const serviceRouter = require('../../routes/adminServicos');
  t.mock.method(Service, 'findById', () => ({ select: () => ({ lean: async () => ({ fiscalPorEmpresa: {} }) }) }));
  const serviceRes = response();
  await routeHandler(serviceRouter, 'put', '/:id')({ params: { id: storeId }, body: { fiscalPorEmpresa: { [storeId]: { fiscalRuleCode: '7' } } }, user: { storeIds: [storeId] } }, serviceRes);
  assert.equal(serviceRes.statusCode, 400);
  assert.match(serviceRes.body.message, /regra fiscal de serviço/);
});

test('alteração comercial de serviço sem bloco fiscal preserva vínculos existentes', async (t) => {
  const router = require('../../routes/adminServicos');
  let update;
  t.mock.method(Service, 'findByIdAndUpdate', (id, payload) => {
    update = payload;
    return { populate: async () => ({ _id: id, nome: payload.nome, fiscalPorEmpresa: { [storeId]: { fiscalRuleCode: '7' } } }) };
  });
  const res = response();
  await routeHandler(router, 'put', '/:id')({ params: { id: storeId }, body: { nome: 'Nome alterado' }, user: { storeIds: [storeId] } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(Object.hasOwn(update, 'fiscalPorEmpresa'), false);
  assert.equal(res.body.fiscalPorEmpresa[storeId].fiscalRuleCode, '7');
});

test('todas as operações de regras recusam empresa fora do acesso antes de consultar o banco', async (t) => {
  t.mock.method(console, 'error', () => {});
  const router = require('../../routes/fiscalDefaultRules');
  t.mock.method(Store, 'exists', async () => { assert.fail('Não deve consultar empresa não autorizada'); });
  for (const [method, path] of [['get', '/'], ['post', '/'], ['put', '/:code'], ['delete', '/:code']]) {
    const res = response();
    await routeHandler(router, method, path)({ params: { code: '7' }, query: { storeId }, body: { storeId, name: 'Regra' }, user: { role: 'funcionario', storeIds: [] } }, res);
    assert.equal(res.statusCode, 403, method);
  }
});

test('acesso global fiscal respeita desativação do modo admin master', () => {
  const { assertFiscalStoreAccess, visibleServiceFiscal } = require('../../utils/fiscalStoreAccess');
  assert.doesNotThrow(() => assertFiscalStoreAccess({ user: { role: 'admin_master' } }, storeId));
  assert.throws(() => assertFiscalStoreAccess({ headers: { 'x-admin-master-active': 'false' }, user: { role: 'admin_master', storeIds: [] } }, storeId), { status: 403 });
  assert.throws(() => assertFiscalStoreAccess({ user: { role: 'admin_master' } }, { $ne: null }), { status: 400 });
  assert.deepEqual(visibleServiceFiscal({ user: { storeIds: [] } }, { nome: 'Serviço', fiscalPorEmpresa: { [storeId]: { fiscalRuleCode: '7' } } }), { nome: 'Serviço', fiscalPorEmpresa: {} });
});

test('edição fiscal do serviço altera somente caminhos autorizados e preserva demais empresas omitidas', async (t) => {
  const router = require('../../routes/adminServicos');
  const otherStore = 'abcdef0123456789abcdef01';
  const map = { [storeId]: { fiscalRuleCode: '7', descricao: '' }, [otherStore]: { fiscalRuleCode: '8', descricao: 'Manter' } };
  t.mock.method(Service, 'findById', () => ({ select: () => ({ lean: async () => ({ fiscalPorEmpresa: map }) }) }));
  t.mock.method(Store, 'exists', async () => ({ _id: storeId }));
  t.mock.method(Rule, 'findOne', query => {
    assert.equal(query.empresa, storeId);
    return { lean: async () => ({ tipo: 'servico', code: 9 }) };
  });
  let update;
  t.mock.method(Service, 'findByIdAndUpdate', (id, payload) => {
    update = payload;
    return { populate: async () => ({ _id: id, fiscalPorEmpresa: map }) };
  });
  const res = response();
  await routeHandler(router, 'put', '/:id')({ params: { id: storeId }, body: { nome: 'Novo nome', fiscalPorEmpresa: { [storeId]: { fiscalRuleCode: '9' } } }, user: { storeIds: [storeId] } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(update.$set.nome, 'Novo nome');
  assert.equal(update.$set[`fiscalPorEmpresa.${storeId}`].fiscalRuleCode, '9');
  assert.equal(Object.hasOwn(update.$set, 'fiscalPorEmpresa'), false);
  assert.equal(Object.keys(update.$set).some(key => key.includes(otherStore)), false);
  assert.equal(update.$unset, undefined);
  assert.equal(res.body.fiscalPorEmpresa[otherStore], undefined);
});

test('serviço recusa alteração ou remoção explícita do vínculo fiscal de outra empresa', async (t) => {
  t.mock.method(console, 'error', () => {});
  const router = require('../../routes/adminServicos');
  t.mock.method(Service, 'findById', () => ({ select: () => ({ lean: async () => ({ fiscalPorEmpresa: { [storeId]: { fiscalRuleCode: '7', descricao: '' } } }) }) }));
  t.mock.method(Service, 'findByIdAndUpdate', () => { assert.fail('Não deve alterar serviço'); });
  for (const config of [{ fiscalRuleCode: '8' }, { fiscalRuleCode: '', descricao: '' }]) {
    const res = response();
    await routeHandler(router, 'put', '/:id')({ params: { id: storeId }, body: { fiscalPorEmpresa: { [storeId]: config } }, user: { role: 'funcionario', storeIds: [] } }, res);
    assert.equal(res.statusCode, 403);
  }
});
