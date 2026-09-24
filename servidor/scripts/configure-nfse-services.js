'use strict';

// Simulação por padrão. Nunca importa o servidor, emite notas ou lê certificados.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const mongoose = require('mongoose');
mongoose.set('autoCreate', false);
mongoose.set('autoIndex', false);
const Store = require('../models/Store');
const Service = require('../models/Service');
const FiscalDefaultRule = require('../models/FiscalDefaultRule');
const { normalizeStoreNfse, validateNfseFiscal, normalizeServiceFiscalMap } = require('../utils/nfseConfig');

const own = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);
const idPattern = /^[a-f\d]{24}$/i;
const storeKeys = ['enabled', 'environment', 'serieDps', 'regimeEspecialTributacao', 'opSimpNac', 'regApTribSN', 'incluirInscricaoMunicipal'];
const metadataKeys = ['tributosFonte', 'tributosVersao', 'tributosVigenciaInicio', 'tributosVigenciaFim', 'tributosCodigoReferencia'];
const text = (value) => String(value ?? '').trim();
const digits = (value) => text(value).replace(/\D/g, '');
const localDate = (now) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
const normalize = (value) => {
  if (value instanceof Date) return value.toISOString();
  if (value?.toHexString) return value.toHexString();
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, normalize(value[key])]));
  return value;
};
const same = (left, right) => JSON.stringify(normalize(left ?? null)) === JSON.stringify(normalize(right ?? null));
const fail = (message) => { throw Object.assign(new Error(message), { code: 'NFSE_CONFIGURATION_BLOCKED' }); };
const requireDate = (value, label) => {
  if (!text(value) || Number.isNaN(new Date(value).getTime())) fail(`${label}: data obrigatória ou inválida.`);
  return new Date(value);
};
const checkKeys = (value, allowed, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label}: objeto obrigatório.`);
  const extra = Object.keys(value).filter(key => !allowed.includes(key));
  if (extra.length) fail(`${label}: campos não permitidos (${extra.join(', ')}).`);
};
const hash = (plan) => crypto.createHash('sha256').update(JSON.stringify(normalize(plan))).digest('hex');

function preparePlan(plan, now = new Date()) {
  const selected = (Array.isArray(plan?.services) ? plan.services : []).filter(service => service.readyToApply === true);
  const blocked = (Array.isArray(plan?.services) ? plan.services : []).filter(service => service.readyToApply !== true)
    .map(service => ({ serviceId: service.serviceId, name: service.name, reason: service.classificationStatus || service.notes || 'Classificação ou tributos ainda não confirmados.' }));
  if (!plan?.execution) return { ready: false, blockers: ['Plano de pesquisa sem execution revisada. O cache não é autorização para gravar.'], blockedServices: blocked, selectedServices: selected.length };
  try {
    const execution = plan.execution;
    if (execution.catalogSource !== 'current-database') fail('A execução exige catálogo conferido no banco atual; cache não pode ser usado para gravar.');
    const reviewedAt = requireDate(execution.reviewedAt, 'execution.reviewedAt');
    const validUntil = requireDate(execution.validUntil, 'execution.validUntil');
    if (reviewedAt > new Date(now.getTime() + 60000) || now - reviewedAt > 24 * 60 * 60 * 1000) fail('A conferência do banco deve ter ocorrido nas últimas 24 horas.');
    if (validUntil < now || validUntil < reviewedAt) fail('A validade do plano expirou.');
    if (!selected.length) fail('Nenhum serviço com classificação e tributos confirmados foi selecionado.');
    const company = execution.expectedCompany;
    if (!idPattern.test(text(company?.id)) || !/^\d{14}$/.test(digits(company?.cnpj))) fail('Informe ID e CNPJ exatos da empresa emitente esperada.');
    requireDate(company.updatedAt, 'expectedCompany.updatedAt');
    checkKeys(company.nfse, storeKeys, 'expectedCompany.nfse');
    checkKeys(execution.storeNfsePatch, storeKeys, 'storeNfsePatch');
    const desiredStore = normalizeStoreNfse({ ...company.nfse, ...execution.storeNfsePatch });
    if (desiredStore.environment !== 'homologacao') fail('Este configurador não habilita nem altera a emissão em produção.');
    const rules = [];
    const ruleCodes = new Set();
    for (const rule of execution.rules || []) {
      if (!Number.isSafeInteger(rule.code) || rule.code < 1 || ruleCodes.has(rule.code) || !text(rule.name)) fail('Regra sem código/nome exatos ou código repetido.');
      if (rule.classificationResolved !== true || rule.taxesResolved !== true) fail(`Regra ${rule.code}: classificação ou tributos não resolvidos.`);
      if (typeof rule.expected?.exists !== 'boolean') fail(`Regra ${rule.code}: informe expected.exists.`);
      if (rule.expected.exists) {
        requireDate(rule.expected.updatedAt, `Regra ${rule.code}.expected.updatedAt`);
        if (!text(rule.expected.name) || rule.expected.tipo !== 'servico' || !own(rule.expected, 'nfse')) fail(`Regra ${rule.code}: valores anteriores incompletos.`);
      }
      if (!rule.fiscal?.nfse) fail(`Regra ${rule.code}: fiscal.nfse obrigatório.`);
      const fiscal = validateNfseFiscal(rule.fiscal.nfse);
      if (!fiscal.codigoNbs || !fiscal.codigoTributacaoMunicipal || !fiscal.municipioPrestacao) fail(`Regra ${rule.code}: complete classificação nacional, municipal, NBS e local da prestação.`);
      if (fiscal.tributacaoIss === '1' && fiscal.aliquotaIss === null) {
        const municipal = rule.issRateResolvedByMunicipality;
        if (desiredStore.opSimpNac !== '1' || fiscal.tipoRetencaoIss !== '1' || municipal?.confirmed !== true || !Number.isFinite(municipal.rate) || municipal.rate < 0 || municipal.rate > 5 || !/^https:\/\//.test(text(municipal.source))) fail(`Regra ${rule.code}: alíquota omitida exige evidência municipal confirmada para o cálculo pelo município.`);
      }
      const metadata = Object.fromEntries(metadataKeys.map(key => [key, text(rule.fiscal.nfse[key])]));
      if (metadataKeys.some(key => !metadata[key])) fail(`Regra ${rule.code}: informe fonte, versão, vigência e código de referência dos tributos.`);
      for (const field of ['tributosVigenciaInicio', 'tributosVigenciaFim']) {
        const date = new Date(`${metadata[field]}T12:00:00Z`);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(metadata[field]) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== metadata[field]) fail(`Regra ${rule.code}: vigência tributária inválida.`);
      }
      if (metadata.tributosVigenciaInicio > localDate(now) || metadata.tributosVigenciaFim < localDate(now) || metadata.tributosVigenciaFim < metadata.tributosVigenciaInicio) fail(`Regra ${rule.code}: fonte tributária fora da vigência.`);
      if (localDate(validUntil) > metadata.tributosVigenciaFim) fail(`Regra ${rule.code}: validade do plano supera a vigência dos tributos.`);
      const desired = { ...fiscal, ...metadata };
      const fiscalKeys = Object.keys(desired);
      checkKeys(rule.fiscal.nfse, fiscalKeys, `Regra ${rule.code}.fiscal.nfse`);
      if (rule.expected.exists && rule.expected.nfse !== null) checkKeys(rule.expected.nfse, fiscalKeys, `Regra ${rule.code}.expected.nfse`);
      ruleCodes.add(rule.code);
      rules.push({ ...rule, desired });
    }
    const services = [];
    const ids = new Set();
    for (const service of selected) {
      if (!idPattern.test(text(service.serviceId)) || ids.has(service.serviceId) || !text(service.name)) fail('Serviço sem ID/nome exatos ou ID repetido.');
      if (service.classificationResolved !== true || service.taxesResolved !== true) fail(`${service.name}: classificação ou tributos não resolvidos.`);
      requireDate(service.expected?.updatedAt, `${service.name}.expected.updatedAt`);
      if (!own(service.expected, 'fiscalForCompany')) fail(`${service.name}: informe o vínculo fiscal anterior, ou null se ausente.`);
      if (!ruleCodes.has(Number(service.fiscalRuleCode))) fail(`${service.name}: regra fiscal não incluída no plano.`);
      const desired = normalizeServiceFiscalMap({ [company.id]: { fiscalRuleCode: text(service.fiscalRuleCode), descricao: text(service.descricao) } })[company.id];
      if (service.expected.fiscalForCompany !== null) checkKeys(service.expected.fiscalForCompany, ['fiscalRuleCode', 'descricao'], `${service.name}.expected.fiscalForCompany`);
      ids.add(service.serviceId);
      services.push({ ...service, desired });
    }
    if (rules.some(rule => !services.some(service => Number(service.fiscalRuleCode) === rule.code))) fail('O plano contém regra sem nenhum serviço selecionado.');
    return { ready: true, hash: hash(plan), company, desiredStore, rules, services, blockedServices: blocked, selectedServices: services.length };
  } catch (error) {
    return { ready: false, blockers: [error.message], blockedServices: blocked, selectedServices: selected.length };
  }
}

async function inspect(prepared, session = null) {
  const options = { session };
  const indexes = await FiscalDefaultRule.collection.indexes();
  if (!indexes.some(index => index.unique === true && index.key?.empresa === 1 && index.key?.code === 1 && Object.keys(index.key).length === 2)) fail('Índice único empresa/code das regras fiscais ausente. O configurador não cria índices automaticamente.');
  const companyId = new mongoose.Types.ObjectId(prepared.company.id);
  const company = await Store.collection.findOne({ _id: companyId }, { ...options, projection: { _id: 1, nome: 1, razaoSocial: 1, cnpj: 1, nfse: 1, updatedAt: 1 } });
  if (!company || digits(company.cnpj) !== digits(prepared.company.cnpj)) fail('ID/CNPJ da empresa não correspondem ao plano.');
  checkKeys(company.nfse || {}, storeKeys, 'Store.nfse atual');
  const operations = [];
  const before = { company, rules: [], services: [] };
  if (!same(company.nfse || {}, prepared.desiredStore)) {
    if (!same(company.updatedAt, prepared.company.updatedAt) || !same(company.nfse || {}, prepared.company.nfse)) fail('A empresa mudou desde a revisão. Gere uma nova conferência.');
    operations.push({ type: 'company', id: companyId, old: company, next: prepared.desiredStore });
  }
  for (const rule of prepared.rules) {
    const current = await FiscalDefaultRule.collection.findOne({ empresa: companyId, code: rule.code }, { ...options, projection: { _id: 1, empresa: 1, code: 1, tipo: 1, name: 1, 'fiscal.nfse': 1, updatedAt: 1 } });
    const nameCollision = await FiscalDefaultRule.collection.findOne({ empresa: companyId, name: rule.name, code: { $ne: rule.code } }, { ...options, projection: { code: 1 } });
    if (nameCollision) fail(`Regra ${rule.code}: nome já usado em outro código (${nameCollision.code}).`);
    if (current && current.tipo !== 'servico') fail(`Regra ${rule.code}: código ocupado por regra de produto. Nenhuma alteração foi aplicada.`);
    if (current) checkKeys(current.fiscal?.nfse || {}, Object.keys(rule.desired), `Regra ${rule.code} atual`);
    before.rules.push(current || { empresa: companyId, code: rule.code, absent: true });
    if (current && current.name === rule.name && same(current.fiscal?.nfse, rule.desired)) continue;
    if (rule.expected.exists) {
      if (!current || !same(current.updatedAt, rule.expected.updatedAt) || current.name !== rule.expected.name || !same(current.fiscal?.nfse, rule.expected.nfse)) fail(`Regra ${rule.code}: valores anteriores ou versão divergentes.`);
    } else if (current) fail(`Regra ${rule.code}: já existe e difere do plano.`);
    operations.push({ type: 'rule', id: current?._id || new mongoose.Types.ObjectId(), old: current, code: rule.code, name: rule.name, next: rule.desired });
  }
  for (const service of prepared.services) {
    const current = await Service.collection.findOne({ _id: new mongoose.Types.ObjectId(service.serviceId) }, { ...options, projection: { _id: 1, nome: 1, ativo: 1, [`fiscalPorEmpresa.${prepared.company.id}`]: 1, updatedAt: 1 } });
    if (!current || current.nome !== service.name || current.ativo === false) fail(`${service.name}: ID/nome divergente, ausente ou serviço inativo.`);
    const fiscal = current.fiscalPorEmpresa?.[prepared.company.id] ?? null;
    if (fiscal !== null) checkKeys(fiscal, ['fiscalRuleCode', 'descricao'], `${service.name}: vínculo atual`);
    before.services.push(current);
    if (same(fiscal, service.desired)) continue;
    if (!same(current.updatedAt, service.expected.updatedAt) || !same(fiscal, service.expected.fiscalForCompany)) fail(`${service.name}: registro mudou desde a revisão; cache antigo não pode substituir o atual.`);
    operations.push({ type: 'service', id: current._id, name: current.nome, old: current, next: service.desired });
  }
  return { before, operations };
}

function safeOperations(operations) {
  return operations.map(operation => ({ type: operation.type, id: String(operation.id), ...(operation.name ? { name: operation.name } : {}), ...(operation.code ? { code: operation.code } : {}), next: operation.next }));
}

async function configure(plan, { apply = false, now = new Date(), backupDirectory = path.resolve(__dirname, '../../.codex-artifacts/nfse-config-backups') } = {}) {
  const prepared = preparePlan(plan, now);
  if (!prepared.ready) return { mode: apply ? 'apply' : 'dry-run', applied: false, ...prepared };
  const report = { checkedAt: now.toISOString(), mode: apply ? 'apply' : 'dry-run', planSha256: prepared.hash, company: { id: prepared.company.id, cnpj: digits(prepared.company.cnpj) }, blockedServices: prepared.blockedServices, selectedServices: prepared.services.length, applied: false };
  if (!apply) {
    const current = await inspect(prepared);
    return { ...report, ready: true, operations: safeOperations(current.operations), current: normalize(current.before), alreadyConfigured: current.operations.length === 0 };
  }
  const session = await mongoose.startSession();
  let committed;
  let backupPath;
  try {
    await session.withTransaction(async () => {
      // Revalida identidade, versões e valores no mesmo snapshot da escrita.
      const current = await inspect(prepared, session);
      committed = current;
      if (!current.operations.length) return;
      fs.mkdirSync(backupDirectory, { recursive: true });
      backupPath = path.join(backupDirectory, `${now.toISOString().replace(/[:.]/g, '-')}-${prepared.hash.slice(0, 12)}-${crypto.randomUUID()}.before.json`);
      fs.writeFileSync(backupPath, JSON.stringify({ ...report, current: normalize(current.before), operations: safeOperations(current.operations) }, null, 2), { flag: 'wx', mode: 0o600 });
      const companyId = new mongoose.Types.ObjectId(prepared.company.id);
      for (const operation of current.operations) {
        let result;
        if (operation.type === 'company') {
          result = await Store.collection.updateOne({ _id: operation.id, cnpj: operation.old.cnpj, updatedAt: operation.old.updatedAt, nfse: operation.old.nfse }, { $set: { nfse: operation.next, updatedAt: now } }, { session });
        } else if (operation.type === 'rule' && !operation.old) {
          await FiscalDefaultRule.collection.insertOne({ _id: operation.id, empresa: companyId, code: operation.code, name: operation.name, tipo: 'servico', fiscal: { nfse: operation.next }, createdAt: now, updatedAt: now }, { session });
          continue;
        } else if (operation.type === 'rule') {
          result = await FiscalDefaultRule.collection.updateOne({ _id: operation.id, tipo: 'servico', updatedAt: operation.old.updatedAt, 'fiscal.nfse': operation.old.fiscal?.nfse }, { $set: { name: operation.name, 'fiscal.nfse': operation.next, updatedAt: now } }, { session });
        } else {
          const field = `fiscalPorEmpresa.${prepared.company.id}`;
          result = await Service.collection.updateOne({ _id: operation.id, nome: operation.old.nome, updatedAt: operation.old.updatedAt, [field]: operation.old.fiscalPorEmpresa?.[prepared.company.id] ?? { $exists: false } }, { $set: { [field]: operation.next, updatedAt: now } }, { session });
        }
        if (result?.matchedCount !== 1) fail('Um registro mudou durante a transação; nenhuma configuração foi aplicada.');
      }
    }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
    const verified = await inspect(prepared);
    if (verified.operations.length) fail('A verificação após a aplicação não corresponde ao plano. Consulte a auditoria.');
    return { ...report, ready: true, applied: committed.operations.length > 0, alreadyConfigured: committed.operations.length === 0, operations: safeOperations(committed.operations), backupPath: backupPath || null, verified: true };
  } finally { await session.endSession(); }
}

async function main(args = process.argv.slice(2)) {
  const options = { apply: false };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--apply') options.apply = true;
    else if (arg === '--dry-run') options.apply = false;
    else if (['--plan', '--output-review', '--backup-directory'].includes(arg)) { if (!args[index + 1]) fail(`Informe valor para ${arg}.`); options[arg.slice(2)] = args[++index]; }
    else if (arg === '--help') { console.log('node servidor/scripts/configure-nfse-services.js --plan arquivo.json [--output-review revisao.json] [--apply] [--backup-directory pasta]\nPadrão: simulação. Execução exige catálogo atual, versões e valores anteriores, classificação e tributos resolvidos. Produção não é habilitada.'); return; }
    else fail(`Argumento desconhecido: ${arg}`);
  }
  if (!options.plan) fail('Informe --plan arquivo.json.');
  const planPath = path.resolve(options.plan);
  const output = path.resolve(options['output-review'] || `${planPath.replace(/\.json$/i, '')}.review.json`);
  if (output === planPath) fail('O relatório não pode sobrescrever o plano.');
  const plan = JSON.parse(fs.readFileSync(planPath, 'utf8').replace(/^\uFEFF/, ''));
  let report;
  try {
    const prepared = preparePlan(plan);
    if (!prepared.ready) report = { mode: options.apply ? 'apply' : 'dry-run', applied: false, ...prepared };
    else {
      require('dotenv').config({ path: path.resolve(__dirname, '../.env'), quiet: true });
      if (!process.env.MONGO_URI) fail('MONGO_URI não configurada.');
      await mongoose.connect(process.env.MONGO_URI, { autoCreate: false, autoIndex: false, serverSelectionTimeoutMS: 12000, connectTimeoutMS: 6000 });
      report = await configure(plan, { apply: options.apply, backupDirectory: options['backup-directory'] ? path.resolve(options['backup-directory']) : undefined });
    }
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ mode: report.mode, ready: report.ready, applied: report.applied, selectedServices: report.selectedServices, blockedServices: report.blockedServices?.length || 0, operations: report.operations?.length || 0, blockers: report.blockers, output }));
    if (!report.ready) process.exitCode = 2;
  } finally { await mongoose.disconnect(); }
}

if (require.main === module) main().catch(error => { console.error(JSON.stringify({ code: error.code || error.name, message: error.code === 'NFSE_CONFIGURATION_BLOCKED' ? error.message : 'Falha ao conferir/aplicar o plano. Nenhuma credencial foi registrada; verifique a conexão e os dados de revisão.' })); process.exitCode = 1; });
module.exports = { preparePlan, configure, main };
