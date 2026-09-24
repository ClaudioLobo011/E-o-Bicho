const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const { configure, preparePlan } = require('../../scripts/configure-nfse-services');
const Store = require('../../models/Store');
const Service = require('../../models/Service');
const FiscalDefaultRule = require('../../models/FiscalDefaultRule');
const { normalizeStoreNfse } = require('../../utils/nfseConfig');

const now = new Date('2026-09-23T12:00:00.000Z');
const previous = new Date('2026-09-23T11:00:00.000Z');
const companyId = '650000000000000000000001';
const otherId = '650000000000000000000002';
const serviceIds = ['650000000000000000000003', '650000000000000000000004'];
const oid = value => new mongoose.Types.ObjectId(value);
const initialNfse = normalizeStoreNfse({ enabled: false });
let replica;
let directory;
let backup;

function plan() {
  return {
    execution: {
      catalogSource: 'current-database', reviewedAt: previous.toISOString(), validUntil: '2026-09-30T23:59:59-03:00',
      expectedCompany: { id: companyId, cnpj: '11222333000181', updatedAt: previous.toISOString(), nfse: initialNfse },
      storeNfsePatch: { enabled: true, environment: 'homologacao', serieDps: '1', regimeEspecialTributacao: '0', opSimpNac: '1', incluirInscricaoMunicipal: false },
      rules: [{
        code: 701, name: 'Higiene de animais — teste', classificationResolved: true, taxesResolved: true, expected: { exists: false },
        fiscal: { nfse: {
          codigoTributacaoNacional: '050801', codigoTributacaoMunicipal: '002', codigoNbs: '114056000',
          descricao: 'Higiene de animais', tributacaoIss: '1', aliquotaIss: 5, tipoRetencaoIss: '1', municipioPrestacao: '3304557',
          totalTributosModo: 'percentual', pTotTribFed: 13.45, pTotTribEst: 0, pTotTribMun: 2.36,
          tributosFonte: 'Fonte sintética de teste', tributosVersao: 'TESTE', tributosCodigoReferencia: '114056000',
          tributosVigenciaInicio: '2026-09-01', tributosVigenciaFim: '2026-09-30', ibsCbs: { enabled: false },
        } },
      }],
    },
    services: serviceIds.map((id, index) => ({ serviceId: id, name: `Serviço teste ${index + 1}`, readyToApply: true,
      classificationResolved: true, taxesResolved: true, expected: { updatedAt: previous.toISOString(), fiscalForCompany: null }, fiscalRuleCode: '701', descricao: '' })),
  };
}

before(async () => {
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replica.getUri(), { dbName: 'nfse-config-isolated', autoIndex: false, autoCreate: false });
  await Store.createCollection(); await Service.createCollection(); await FiscalDefaultRule.createCollection();
  await FiscalDefaultRule.collection.createIndex({ empresa: 1, code: 1 }, { unique: true });
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nfse-config-isolated-'));
});

beforeEach(async () => {
  await mongoose.connection.db.command({ collMod: 'services', validator: {} });
  await Promise.all([Store.deleteMany({}), Service.deleteMany({}), FiscalDefaultRule.deleteMany({})]);
  await Store.collection.insertOne({ _id: oid(companyId), nome: 'Loja teste', razaoSocial: 'Empresa sintética', cnpj: '11.222.333/0001-81', nfse: initialNfse, updatedAt: previous, certificadoSenhaCriptografada: 'SEGREDO-QUE-NAO-DEVE-IR-AO-BACKUP', regimeTributario: 'normal' });
  await Service.collection.insertMany(serviceIds.map((id, index) => ({ _id: oid(id), nome: `Serviço teste ${index + 1}`, valor: 70 + index, grupo: oid(otherId), ativo: true, fiscalPorEmpresa: { [otherId]: { fiscalRuleCode: '51', descricao: 'Preservar outra empresa' } }, updatedAt: previous })));
  backup = path.join(directory, crypto.randomUUID());
});

after(async () => { await mongoose.disconnect(); await replica?.stop(); if (directory) fs.rmSync(directory, { recursive: true, force: true }); });

test('plano de pesquisa e cache antigo nunca autorizam escrita', async () => {
  const research = { services: [{ serviceId: serviceIds[0], name: 'Banho', readyToApply: false, classificationStatus: 'aguardando banco atual' }] };
  assert.equal((await configure(research, { apply: true, now, backupDirectory: backup })).ready, false);
  const cached = plan(); cached.execution.catalogSource = 'cache';
  assert.equal(preparePlan(cached, now).ready, false);
  assert.equal(await FiscalDefaultRule.countDocuments(), 0); assert.equal(fs.existsSync(backup), false);
});

test('simulação retorna alterações concretas sem salvar ou criar backup', async () => {
  const result = await configure(plan(), { now, backupDirectory: backup });
  assert.equal(result.mode, 'dry-run'); assert.equal(result.applied, false); assert.equal(result.operations.length, 4);
  assert.equal((await Store.findById(companyId).lean()).nfse.enabled, false);
  assert.equal(await FiscalDefaultRule.countDocuments(), 0); assert.equal(fs.existsSync(backup), false);
  assert.doesNotMatch(JSON.stringify(result), /SEGREDO|certificadoSenha/);
});

test('aplicação atômica preserva preços, grupo, outra empresa e certificados; replay não escreve novamente', async () => {
  const result = await configure(plan(), { apply: true, now, backupDirectory: backup });
  assert.equal(result.applied, true); assert.equal(result.verified, true); assert.equal(fs.existsSync(result.backupPath), true);
  const store = await Store.collection.findOne({ _id: oid(companyId) });
  assert.equal(store.nfse.environment, 'homologacao'); assert.equal(store.nfse.enabled, true);
  assert.equal(store.regimeTributario, 'normal'); assert.match(store.certificadoSenhaCriptografada, /SEGREDO/);
  const services = await Service.find({}).sort({ nome: 1 }).lean();
  services.forEach((service, index) => { assert.equal(service.valor, 70 + index); assert.equal(String(service.grupo), otherId); assert.equal(service.fiscalPorEmpresa[otherId].fiscalRuleCode, '51'); assert.equal(service.fiscalPorEmpresa[companyId].fiscalRuleCode, '701'); });
  const savedRule = await FiscalDefaultRule.findOne({ code: 701 }).lean();
  assert.equal(savedRule.tipo, 'servico'); assert.equal(savedRule.fiscal.nfse.tributosVersao, 'TESTE');
  assert.doesNotMatch(fs.readFileSync(result.backupPath, 'utf8'), /SEGREDO|certificadoSenha/);
  const replay = await configure(plan(), { apply: true, now: new Date(now.getTime() + 1000), backupDirectory: backup });
  assert.equal(replay.applied, false); assert.equal(replay.alreadyConfigured, true);
  assert.equal(fs.readdirSync(backup).length, 1); assert.equal(await FiscalDefaultRule.countDocuments(), 1);
  assert.equal((await Service.findById(serviceIds[0]).lean()).updatedAt.toISOString(), now.toISOString());
});

test('versão atual ou nome divergente interrompe antes de qualquer mutação', async () => {
  await Service.collection.updateOne({ _id: oid(serviceIds[1]) }, { $set: { updatedAt: now } });
  await assert.rejects(configure(plan(), { apply: true, now, backupDirectory: backup }), /mudou desde a revisão/);
  assert.equal((await Store.findById(companyId).lean()).nfse.enabled, false); assert.equal(await FiscalDefaultRule.countDocuments(), 0);
  assert.equal(fs.existsSync(backup), false);
  const changed = plan(); changed.services[1].name = 'Nome que não existe';
  await assert.rejects(configure(changed, { now }), /ID\/nome divergente/);
});

test('CNPJ errado, código de produto ou nome de outra regra jamais são sobrescritos', async () => {
  const wrong = plan(); wrong.execution.expectedCompany.cnpj = '12345678000199';
  await assert.rejects(configure(wrong, { apply: true, now, backupDirectory: backup }), /ID\/CNPJ/);
  await FiscalDefaultRule.collection.insertOne({ empresa: oid(companyId), code: 701, tipo: 'produto', name: 'Produto existente', fiscal: { cfop: '5102' }, updatedAt: previous });
  await assert.rejects(configure(plan(), { apply: true, now, backupDirectory: backup }), /regra de produto/);
  assert.equal((await FiscalDefaultRule.findOne({ code: 701 }).lean()).fiscal.cfop, '5102');
});

test('recusa produção, impostos não resolvidos, confirmação antiga e vigência vencida', () => {
  for (const mutate of [
    p => { p.execution.storeNfsePatch.environment = 'producao'; },
    p => { p.execution.rules[0].taxesResolved = false; },
    p => { p.services[0].classificationResolved = false; },
    p => { p.execution.reviewedAt = '2026-08-31T12:00:00Z'; },
    p => { p.execution.validUntil = '2026-09-22T23:00:00Z'; },
    p => { p.execution.rules[0].fiscal.nfse.tributosVigenciaFim = '2026-09-22'; },
    p => { delete p.services[0].expected.fiscalForCompany; },
    p => { p.execution.storeNfsePatch.regimeTributario = 'simples'; },
  ]) { const value = plan(); mutate(value); assert.equal(preparePlan(value, now).ready, false); }
});

test('alíquota calculada pelo município exige prova explícita e não grava percentual proibido na DPS', async () => {
  const value = plan(); value.execution.rules[0].fiscal.nfse.aliquotaIss = null;
  assert.equal(preparePlan(value, now).ready, false);
  value.execution.rules[0].issRateResolvedByMunicipality = { confirmed: true, rate: 5, source: 'https://example.test/parametros-municipais' };
  assert.equal(preparePlan(value, now).ready, true);
  await configure(value, { apply: true, now, backupDirectory: backup });
  assert.equal((await FiscalDefaultRule.findOne({ code: 701 }).lean()).fiscal.nfse.aliquotaIss, null);
});

test('serviços não resolvidos ficam identificados e não recebem vínculo fiscal', async () => {
  const partial = plan(); partial.services[1].readyToApply = false; partial.services[1].classificationStatus = 'Confirmar execução do exame';
  const result = await configure(partial, { apply: true, now, backupDirectory: backup });
  assert.equal(result.selectedServices, 1); assert.equal(result.blockedServices.length, 1);
  assert.equal((await Service.findById(serviceIds[1]).lean()).fiscalPorEmpresa[companyId], undefined);
});

test('atualiza somente NFS-e da regra de serviço exata e preserva outros campos fiscais', async () => {
  const value = plan();
  const beforeFiscal = { ...preparePlan(value, now).rules[0].desired, aliquotaIss: 4 };
  await FiscalDefaultRule.collection.insertOne({ empresa: oid(companyId), code: 701, name: 'Nome anterior', tipo: 'servico', fiscal: { nfse: beforeFiscal, campoLegado: 'preservar' }, updatedAt: previous });
  value.execution.rules[0].expected = { exists: true, name: 'Nome anterior', tipo: 'servico', nfse: beforeFiscal, updatedAt: previous.toISOString() };
  await configure(value, { apply: true, now, backupDirectory: backup });
  const rule = await FiscalDefaultRule.findOne({ code: 701 }).lean();
  assert.equal(rule.fiscal.nfse.aliquotaIss, 5); assert.equal(rule.fiscal.campoLegado, 'preservar');
  assert.equal(await FiscalDefaultRule.countDocuments(), 1);
});

test('erro após gravar empresa/regra dentro da transação desfaz tudo e conserva auditoria anterior', async () => {
  await mongoose.connection.db.command({ collMod: 'services', validator: { [`fiscalPorEmpresa.${companyId}.fiscalRuleCode`]: { $ne: '701' } } });
  await assert.rejects(configure(plan(), { apply: true, now, backupDirectory: backup }), /validation/i);
  assert.equal((await Store.findById(companyId).lean()).nfse.enabled, false); assert.equal(await FiscalDefaultRule.countDocuments(), 0);
  assert.equal((await Service.findById(serviceIds[0]).lean()).fiscalPorEmpresa[companyId], undefined);
  assert.equal(fs.readdirSync(backup).length, 1);
});
