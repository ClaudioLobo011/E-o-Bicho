'use strict';

const crypto = require('crypto');
const mongoose = require('mongoose');
const { cpf, cnpj } = require('cpf-cnpj-validator');
const NfseDocument = require('../models/NfseDocument');
const Store = require('../models/Store');
const Service = require('../models/Service');
const FiscalDefaultRule = require('../models/FiscalDefaultRule');
const User = require('../models/User');
const { nextScopedSequence } = require('../utils/sequences');
const { decryptBuffer, decryptText } = require('../utils/certificates');
const { extractCertificatePair, _test: fiscalHelpers } = require('./nfceEmitter');
const { validateNfseFiscal } = require('../utils/nfseConfig');
const { buildDpsXml, buildDpsId, signXml, parseAuthorizedXml, buildCancellationXml, parseXml } = require('./nfseXml');
const { createTransport, decompressXml } = require('./nfseTransport');
const xpath = require('xpath');

const text = (value) => String(value ?? '').trim();
const digits = (value) => text(value).replace(/\D/g, '');
const id = (value) => text(value?._id || value?.id || value);
const plain = (value) => value?.toObject ? value.toObject({ flattenMaps: true }) : value || {};
const hash = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const cents = (value) => Math.round(Number(value) * 100);
const sum = (items, field) => items.reduce((total, item) => total + cents(item[field]), 0) / 100;
const isService = (item) => ['service', 'servico', 'serviço'].includes(text(item.itemType || item.tipoItem || item.type || item.kind).toLowerCase()) || !!(item.serviceId || item.servicoId || item.servico);
const documentFields = '+dpsXml +xmlContent +lockToken +cancelRequestXml +cancelEventXml';
const LOCK_MS = 180000;
const PROGRESS_STAGES = ['building_xml', 'signing', 'transmitting'];
function publicProgress(value) {
  if (!value || !PROGRESS_STAGES.includes(value.stage)) return null;
  const timestamp = input => Number.isFinite(Date.parse(input || '')) ? new Date(input).toISOString() : undefined;
  const steps = {};
  for (const stage of PROGRESS_STAGES) {
    const startedAt = timestamp(value.steps?.[stage]?.startedAt);
    const completedAt = timestamp(value.steps?.[stage]?.completedAt);
    if (startedAt) steps[stage] = { startedAt, ...(completedAt ? { completedAt } : {}) };
  }
  return { stage: value.stage, updatedAt: timestamp(value.updatedAt),
    documentIndex: Number(value.documentIndex) || 1, documentCount: Number(value.documentCount) || 1, steps };
}
const cancelledSale = (sale) => ['cancelled', 'cancelado', 'cancelada', 'canceled'].includes(text(sale?.status).toLowerCase());
const FREE_SERVICES_NOTICE = 'Os serviços desta venda são gratuitos; não há valor de serviço para emitir NFS-e.';
// Leiaute nacional v1.01, MUN.INCID_INFO.SERV.: grupo 05 tem incidência no
// estabelecimento do prestador. Guia Emissor Nacional Web, página 24, e RN E0187/E0204.
const UNIDENTIFIED_CUSTOMER_CODES = new Set(['050101', '050102', '050201', '050202', '050301', '050401', '050501', '050601', '050701', '050801', '050901']);
const IBS_REQUIRES_CUSTOMER = new Set(['030102', '050102', '100101', '100301', '100501', '030103', '050103', '100102', '100201', '100302', '100401', '100502', '100601']);
const isComplimentaryService = (item) => {
  const source = item.source || {};
  const unit = source.unitPrice ?? source.unitValue ?? source.valorUnitario ?? source.valor ?? source.preco;
  const total = source.totalPrice ?? source.totalValue ?? source.subtotal ?? source.total;
  const quantity = source.quantity ?? source.quantidade ?? source.qtd;
  const numeric = (value) => ['string', 'number'].includes(typeof value) && text(value) !== '' && Number.isFinite(Number(value));
  const explicitZero = (value) => numeric(value) && Number(value) === 0;
  const optionalZero = (value) => value === undefined || value === null || explicitZero(value);
  if (!numeric(quantity) || Number(quantity) <= 0 || !optionalZero(unit) || !optionalZero(total)) return false;
  if (['valorSemAjuste', 'baseUnitPrice', 'subtotalSemAjuste', 'baseSubtotal', 'originalSubtotal'].some((field) => !optionalZero(source[field]))) return false;
  if (['itemDiscountValue', 'discountValue', 'desconto', 'descontoItemValor', 'discount', 'itemAdditionValue', 'additionValue', 'acrescimo', 'acrescimoItemValor', 'addition'].some((field) => !optionalZero(source[field]))) return false;
  return item.quantity > 0 && item.unitPrice === 0 && item.total === 0 && item.netTotal === 0 && item.discount === 0 && item.addition === 0
    && (explicitZero(unit) || (unit === undefined && explicitZero(total)));
};

async function reloadCanonicalSale({ sale, pdv }, injected = {}) {
  const Sale = injected.Sale || require('../models/PdvStateSale');
  const State = injected.State || require('../models/PdvStateNormalized');
  const saleId = text(sale.id);
  const [record, state] = await Promise.all([
    Sale.findOne({ pdv: id(pdv), saleId }).lean(),
    State.findOne({ pdv: id(pdv) }, { completedSales: { $elemMatch: { id: saleId } }, updatedAt: 1 }).lean(),
  ]);
  const current = state?.completedSales?.find((entry) => text(entry.id) === saleId);
  const mirrored = record?.payload ? { ...record.payload, id: text(record.payload.id || record.saleId) } : null;
  // O espelho da venda pode atualizar de forma assíncrona depois do estado do caixa.
  // Um cancelamento persistido em qualquer fonte nunca é revogado por um retrato antigo.
  if (cancelledSale(current)) return current;
  if (cancelledSale(mirrored)) return mirrored;
  if (!current) return mirrored;
  if (!mirrored) return current;
  const stateTime = new Date(state.updatedAt || 0).getTime();
  const mirrorSourceTime = new Date(record.sourceUpdatedAt || 0).getTime();
  return stateTime >= mirrorSourceTime ? current : mirrored;
}

class NfseValidationError extends Error {
  constructor(issues) { super(issues.join(' ')); this.name = 'NfseValidationError'; this.code = 'NFSE_NOT_READY'; this.status = 422; this.issues = issues; }
}

function sourceItems(sale) {
  // sale.items preserva serviceId; fiscalItemsSnapshot legado podia perdê-lo.
  const lists = [sale.items, sale.fiscalItemsSnapshot, sale.receiptSnapshot?.items, sale.receiptSnapshot?.itens, sale.receiptSnapshot?.cart?.items];
  return lists.find((list) => Array.isArray(list) && list.length) || [];
}

function projectItems(sale) {
  const raw = sourceItems(sale);
  const normalized = raw.map((item, index) => {
    const adapted = { ...item, unitPrice: item.unitPrice ?? item.unitValue ?? item.valorUnitario ?? item.valor ?? item.preco, totalPrice: item.totalPrice ?? item.totalValue ?? item.subtotal ?? item.total, itemType: isService(item) ? 'servico' : 'produto' };
    return { ...fiscalHelpers.normalizeFiscalItem(adapted), source: item, index, serviceId: id(item.serviceId || item.servicoId || item.servico || item.service?._id || (isService(item) ? item.productId || item.id || item._id : '')) };
  });
  const discount = sale.receiptSnapshot?.totais?.descontoValor ?? sale.receiptSnapshot?.totais?.desconto ?? sale.discountValue ?? 0;
  const addition = sale.receiptSnapshot?.totais?.acrescimoValor ?? sale.receiptSnapshot?.totais?.acrescimo ?? sale.additionValue ?? 0;
  return fiscalHelpers.buildFiscalProjection({ items: normalized, discount, addition }, { itemsOnly: true }).adjustedItems;
}

function statedSaleTotal(sale) {
  // O recibo web inclui textos de apresentação ("R$ 70,00"). O total numérico
  // canônico da venda é prioritário; formato monetário legado tem parser estrito.
  const value = sale.totalLiquido ?? sale.total ?? sale.receiptSnapshot?.totais?.totalLiquido ?? sale.receiptSnapshot?.totais?.liquido;
  if (typeof value === 'string' && /^R\$\s*-?(?:\d+|\d{1,3}(?:\.\d{3})+),\d{2}$/.test(value.trim())) return Number(value.trim().replace(/^R\$\s*/, '').replace(/\./g, '').replace(',', '.'));
  return value;
}

function literalDate(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const parsed = new Date(`${value}T12:00:00Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : '';
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function normalizeCustomer(sale, registered = {}) {
  const source = { ...plain(registered), ...plain(sale.receiptSnapshot?.cliente), ...plain(sale.receiptSnapshot?.customer), ...plain(sale.customer) };
  const document = digits(sale.customerDocument || source.documento || source.document || source.cpf || source.cnpj);
  const name = text(sale.customerName || source.nomeCompleto || source.razaoSocial || source.nome || source.name);
  const addr = source.enderecoFiscal || source.address || (typeof source.endereco === 'object' ? source.endereco : null);
  let address;
  if (addr) {
    address = { municipality: digits(addr.codigoIbgeMunicipio || addr.codigoIbge || addr.ibge || addr.municipality), zip: digits(addr.cep || addr.zip), street: text(addr.logradouro || addr.rua || addr.street), number: text(addr.numero || addr.number), district: text(addr.bairro || addr.district), complement: text(addr.complemento || addr.complement) };
  }
  return { document, name, ...(address ? { address } : {}), email: text(source.emailFiscal || source.email) };
}

function validateRuleForIssuer(rule, issuer, name) {
  const issues = [];
  if (rule.totalTributosModo === 'nao_informar' && issuer.opSimpNac !== '2') issues.push(`${name}: não informar tributos aproximados é permitido somente para MEI.`);
  if (rule.totalTributosModo === 'simples' && issuer.opSimpNac !== '3') issues.push(`${name}: percentual do Simples requer prestador ME/EPP.`);
  if (rule.tributacaoIss === '3') issues.push(`${name}: exportação exige os dados de comércio exterior; não é suportada por este fechamento de PDV.`);
  if (rule.tipoRetencaoIss === '3') issues.push(`${name}: retenção por intermediário exige identificar o intermediário; use fluxo fiscal específico.`);
  if (rule.tipoRetencaoIss !== '1' && (rule.tributacaoIss !== '1' || issuer.opSimpNac === '2' || issuer.regimeEspecialTributacao !== '0')) issues.push(`${name}: retenção ISS incompatível com o regime ou tributação selecionados.`);
  if (rule.ibsCbs?.enabled && rule.ibsCbs.indDest !== '0') issues.push(`${name}: o destinatário deve ser o tomador identificado nesta venda; outro destinatário exige cadastro específico.`);
  if (rule.ibsCbs?.enabled && !/^\d{9}$/.test(rule.codigoNbs)) issues.push(`${name}: NBS é obrigatório ao informar IBS/CBS.`);
  if (rule.paisResultado && rule.tributacaoIss !== '3') issues.push(`${name}: país do resultado só pode ser informado para exportação.`);
  if (rule.aliquotaIss !== null && rule.aliquotaIss !== undefined && (rule.aliquotaIss < 0 || rule.aliquotaIss > 5)) issues.push(`${name}: alíquota do ISS deve estar entre 0% e 5%.`);
  if (rule.aliquotaIss !== null && rule.aliquotaIss !== undefined && (issuer.opSimpNac === '2' || rule.tributacaoIss !== '1' || issuer.regimeEspecialTributacao !== '0')) issues.push(`${name}: não informe alíquota ISS para MEI, imunidade, não incidência ou regime especial.`);
  if (issuer.opSimpNac === '3' && issuer.regApTribSN === '1') {
    if (rule.tipoRetencaoIss === '1' && rule.aliquotaIss !== null && rule.aliquotaIss !== undefined) issues.push(`${name}: ME/EPP pelo Simples sem retenção não deve informar alíquota ISS na DPS.`);
    if (rule.tipoRetencaoIss === '2' && !(rule.aliquotaIss >= 1.8 && rule.aliquotaIss <= 5)) issues.push(`${name}: ME/EPP pelo Simples com retenção exige alíquota ISS entre 1,8% e 5%.`);
  }
  return issues;
}

async function loadCertificate(store) {
  const cert = store.certificadoArquivoCriptografado;
  const password = store.certificadoSenhaCriptografada;
  if (!cert || !password) throw new NfseValidationError(['Configure o certificado digital e sua senha no cadastro da empresa.']);
  const pair = extractCertificatePair(decryptBuffer(cert), decryptText(password));
  const parsed = new crypto.X509Certificate(pair.certificatePem);
  const now = Date.now();
  if (new Date(parsed.validFrom).getTime() > now || new Date(parsed.validTo).getTime() < now) throw new NfseValidationError(['O certificado digital está fora do período de validade.']);
  const subjectCnpj = parsed.subject.match(/(?:CN=.*?:|serialNumber=)(\d{14})(?:\n|$)/)?.[1];
  if (subjectCnpj && subjectCnpj !== digits(store.cnpj)) throw new NfseValidationError(['O CNPJ do certificado não corresponde ao emitente da NFS-e.']);
  return pair;
}

const publicDocument = (document) => {
  const d = plain(document);
  const progress = publicProgress(d.progress);
  return { id: id(d), pdv: id(d.pdv), saleId: d.saleId, saleCode: d.saleCode, store: id(d.store), issuerName: text(d.issuerName || d.snapshot?.issuer?.name), issuerCnpj: digits(d.issuerCnpj || d.snapshot?.issuer?.cnpj), approximateTaxes: approximateTaxes(d.snapshot?.group?.rule, d.total), status: d.status, number: d.number || '', accessKey: d.accessKey || '', verificationCode: d.verificationCode || '', consultationUrl: d.consultationUrl || '', xmlContent: d.xmlContent || '', total: d.total, environment: d.environment, issuedAt: d.issuedAt || null, error: d.error || '', dpsId: d.dpsId, dpsNumber: d.dpsNumber, dpsSerie: d.dpsSerie, cancellationReason: d.cancellationReason || '', cancelledAt: d.cancelledAt || null,
    ...(progress ? { progress, progressStage: d.status === 'authorized' ? 'authorized' : ['rejected', 'unknown'].includes(d.status) ? 'error' : progress.stage } : {}) };
};
function approximateTaxes(rule, total) {
  if (!rule || rule.totalTributosModo === 'nao_informar' || !Number.isFinite(Number(total))) return null;
  const amount = (rate) => Number.isFinite(Number(rate)) ? Math.round(cents(total) * Number(rate) / 100) / 100 : null;
  const federal = rule.totalTributosModo === 'percentual' ? amount(rule.pTotTribFed) : null;
  const state = rule.totalTributosModo === 'percentual' ? amount(rule.pTotTribEst) : null;
  const municipal = rule.totalTributosModo === 'percentual' ? amount(rule.pTotTribMun) : null;
  return { mode: rule.totalTributosModo, federal, state, municipal, total: rule.totalTributosModo === 'simples' ? amount(rule.pTotTribSN) : (cents(federal) + cents(state) + cents(municipal)) / 100,
    source: text(rule.tributosFonte), version: text(rule.tributosVersao), referenceCode: text(rule.tributosCodigoReferencia), validFrom: text(rule.tributosVigenciaInicio), validUntil: text(rule.tributosVigenciaFim) };
}
function aggregateStatus(documents) {
  if (!documents.length) return 'not_requested';
  if (documents.every((d) => d.status === 'authorized')) return 'authorized';
  if (documents.every((d) => d.status === 'cancelled')) return 'cancelled';
  if (documents.some((d) => d.status === 'authorized')) return 'partial';
  if (documents.some((d) => d.status === 'unknown')) return 'unknown';
  if (documents.some((d) => d.status === 'processing')) return 'processing';
  if (documents.some((d) => d.status === 'rejected')) return 'rejected';
  return 'pending';
}

function findCancellationEvent(payload, accessKey, environment) {
  const packed = [];
  function collect(value, depth = 0) {
    if (!value || depth > 8 || packed.length > 1000) return;
    if (Array.isArray(value)) { value.forEach((v) => collect(v, depth + 1)); return; }
    if (typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if ((key === 'eventoXmlGZipB64' || key === 'xmlGZipB64') && typeof child === 'string') packed.push(child);
      else if (child && typeof child === 'object') collect(child, depth + 1);
    }
  }
  collect(payload);
  for (const value of packed) {
    const xml = decompressXml(value);
    const parsed = parseXml(xml);
    const event = xpath.select1("/*[local-name()='evento']/*[local-name()='infEvento']", parsed);
    if (!event) continue; // Um pedido sozinho não comprova cancelamento.
    const key = String(xpath.select1("string(.//*[local-name()='chNFSe'])", event) || '');
    if (key !== accessKey) continue;
    const tpAmb = String(xpath.select1("string(.//*[local-name()='tpAmb'])", event) || '');
    if (environment && tpAmb !== (environment === 'producao' ? '1' : '2')) continue;
    if (xpath.select(".//*[local-name()='e101101' or local-name()='e105102' or local-name()='e105104' or local-name()='e305101']", event).length) {
      const timestamp = String(xpath.select1("string(./*[local-name()='dhProc'])", event) || '');
      return { xml, cancelledAt: timestamp ? new Date(timestamp) : null };
    }
  }
  return null;
}

const { resolveSaleNfseEnvironment } = require('../utils/nfseEnvironment');

function createNfseService(dependencies = {}) {
  const Model = dependencies.Model || NfseDocument;
  const SaleLock = dependencies.SaleLock || NfseDocument.SaleLock;
  const models = { Store, Service, FiscalDefaultRule, User, ...dependencies.models };
  const nextNumber = dependencies.nextNumber || nextScopedSequence;
  const certificateLoader = dependencies.certificateLoader || loadCertificate;
  const transportFactory = dependencies.transportFactory || createTransport;
  const now = dependencies.now || (() => new Date());
  const reloadSale = dependencies.reloadSale || reloadCanonicalSale;
  const documentLeases = new Map();

  async function resolveStore(store, pdv) {
    const input = plain(store);
    const storeId = id(input._id || input.id || pdv?.empresaEmitenteFiscal || pdv?.empresa);
    if (!mongoose.isValidObjectId(storeId)) throw new NfseValidationError(['Empresa emitente da NFS-e não identificada.']);
    return await models.Store.findById(storeId).select('+certificadoArquivoCriptografado +certificadoSenhaCriptografada').lean() || input;
  }

  async function prepare({ sale, pdv, store, environment }) {
    const issues = [];
    if (!id(sale?.id) || !mongoose.isValidObjectId(id(pdv))) throw new NfseValidationError(['Venda ou PDV inválido para emitir NFS-e.']);
    const allItems = projectItems(sale);
    const serviceItems = allItems.filter(isService);
    if (!serviceItems.length) return { ready: true, issues: [], groups: [], serviceTotal: 0, itemCount: 0 };
    const freeServiceItems = serviceItems.filter(isComplimentaryService);
    const pricedServiceItems = serviceItems.filter((item) => !isComplimentaryService(item));
    const statedTotal = statedSaleTotal(sale);
    if (statedTotal !== null && statedTotal !== undefined && (!Number.isFinite(Number(statedTotal)) || cents(statedTotal) !== cents(sum(allItems, 'netTotal')))) issues.push('O total da venda difere da soma dos itens após descontos e acréscimos. Corrija os valores antes de emitir NFS-e.');
    if (cancelledSale(sale)) issues.push('A venda está cancelada.');
    if (!pricedServiceItems.length) return { ready: !issues.length, issues, groups: [], serviceTotal: 0, itemCount: serviceItems.length, freeServiceCount: freeServiceItems.length, warning: FREE_SERVICES_NOTICE, environment: environment || store?.nfse?.environment };
    const issuerStore = await resolveStore(store, pdv);
    const config = plain(issuerStore.nfse);
    const previousDocuments = await Model.find({ pdv: id(pdv), saleId: sale.id, status: { $ne: 'superseded' } }).select('environment').lean();
    let env = config.environment;
    try {
      env = resolveSaleNfseEnvironment({ sale, pdv, store: issuerStore, requestedEnvironment: environment,
        documentEnvironments: previousDocuments.map(document => document.environment) });
    } catch (error) { issues.push(error.message); }
    if (!config.enabled) issues.push('Habilite a emissão de NFS-e no cadastro da empresa.');
    if (!['homologacao', 'producao'].includes(env)) issues.push('Selecione o ambiente da NFS-e no cadastro da empresa.');
    if (!/^\d{1,5}$/.test(text(config.serieDps)) || Number(config.serieDps) < 1 || Number(config.serieDps) > 49999) issues.push('Informe uma série DPS entre 1 e 49999.');
    const issuer = { cnpj: digits(issuerStore.cnpj), municipality: digits(issuerStore.codigoIbgeMunicipio), im: text(issuerStore.inscricaoMunicipal), includeIm: config.incluirInscricaoMunicipal === true, opSimpNac: text(config.opSimpNac), regApTribSN: text(config.regApTribSN), regimeEspecialTributacao: text(config.regimeEspecialTributacao), name: text(issuerStore.razaoSocial || issuerStore.nome) };
    if (!cnpj.isValid(issuer.cnpj)) issues.push('Informe um CNPJ válido para a empresa emitente.');
    if (!/^\d{7}$/.test(issuer.municipality)) issues.push('Informe o código IBGE do município da empresa.');
    if (!/^[123]$/.test(issuer.opSimpNac)) issues.push('Informe a opção pelo Simples Nacional para NFS-e.');
    if (!/^[0-69]$/.test(issuer.regimeEspecialTributacao)) issues.push('Informe o regime especial de tributação para NFS-e.');
    if (issuer.opSimpNac === '3' && !/^[123]$/.test(issuer.regApTribSN)) issues.push('Informe o regime de apuração do Simples Nacional.');
    if (issuer.opSimpNac === '3' && issuer.regApTribSN === '1' && issuer.regimeEspecialTributacao !== '0') issues.push('ME/EPP com apuração pelo Simples requer regime especial Nenhum.');
    if (issuer.includeIm && !issuer.im) issues.push('Informe a inscrição municipal cadastrada no CNC ou desative seu envio.');
    let registered = {};
    const customerId = id(sale.customerId || sale.customer?._id || sale.receiptSnapshot?.cliente?.id || sale.receiptSnapshot?.customer?.id);
    if (mongoose.isValidObjectId(customerId)) registered = await models.User.findById(customerId).select('nomeCompleto razaoSocial cpf cnpj email emailFiscal').lean() || {};
    const unidentifiedCustomer = sale.nfseCustomerIdentification === 'not_informed';
    if (sale.nfseCustomerIdentification && !['identified', 'not_informed'].includes(sale.nfseCustomerIdentification)) issues.push('Modo de identificação do tomador da NFS-e inválido.');
    const customer = unidentifiedCustomer ? { identification: 'not_informed' } : normalizeCustomer(sale, registered);
    if (!unidentifiedCustomer) {
      if (!(cpf.isValid(customer.document) || cnpj.isValid(customer.document))) issues.push('Identifique o tomador com CPF ou CNPJ válido na venda.');
      if (customer.document === issuer.cnpj) issues.push('O tomador não pode ser o próprio prestador do serviço (regra nacional E0202).');
      if (customer.name.length < 2 || customer.name.length > 150) issues.push('Informe o nome ou razão social do tomador (2 a 150 caracteres).');
      if (customer.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email)) issues.push('Corrija o e-mail do tomador.');
      if (customer.address && (!/^\d{7}$/.test(customer.address.municipality) || !/^\d{8}$/.test(customer.address.zip) || !customer.address.street || !customer.address.number || !customer.address.district)) issues.push('Complete o endereço fiscal do tomador com IBGE, CEP, logradouro, número e bairro.');
    }
    const ids = [...new Set(pricedServiceItems.map((item) => item.serviceId).filter((value) => mongoose.isValidObjectId(value)))];
    const services = await models.Service.find({ _id: { $in: ids } }).lean();
    const serviceMap = new Map(services.map((item) => [id(item), item]));
    const rules = await models.FiscalDefaultRule.find({ empresa: id(issuerStore) }).lean();
    const ruleMap = new Map(rules.map((rule) => [text(rule.code), rule]));
    const groups = new Map();
    for (const item of pricedServiceItems) {
      const name = item.name || `Serviço ${item.index + 1}`;
      const service = serviceMap.get(item.serviceId);
      if (!service) { issues.push(`${name}: vincule o item a um serviço cadastrado; atendimentos agregados não possuem classificação fiscal.`); continue; }
      const fiscalMap = service.fiscalPorEmpresa instanceof Map ? Object.fromEntries(service.fiscalPorEmpresa) : service.fiscalPorEmpresa || {};
      const serviceFiscal = fiscalMap[id(issuerStore)] || {};
      const ruleRecord = ruleMap.get(text(serviceFiscal.fiscalRuleCode));
      if (!ruleRecord || ruleRecord.tipo !== 'servico') { issues.push(`${name}: selecione uma regra fiscal de serviço para a empresa emitente.`); continue; }
      let rule;
      try { rule = validateNfseFiscal(ruleRecord.fiscal?.nfse); } catch (error) { issues.push(`${name}: ${error.message}`); continue; }
      issues.push(...validateRuleForIssuer(rule, issuer, name));
      if (unidentifiedCustomer && (!UNIDENTIFIED_CUSTOMER_CODES.has(rule.codigoTributacaoNacional) || rule.tributacaoIss !== '1' || rule.tipoRetencaoIss !== '1' || (rule.ibsCbs?.enabled && (IBS_REQUIRES_CUSTOMER.has(rule.ibsCbs.cIndOp) || rule.ibsCbs.indDest !== '0')))) issues.push(`${name}: o serviço ou a tributação exige tomador identificado; selecione Identificado e informe CPF/CNPJ válido.`);
      const emissionDate = literalDate(now());
      if (rule.tributosVigenciaInicio && (emissionDate < rule.tributosVigenciaInicio || emissionDate > rule.tributosVigenciaFim)) issues.push(`${name}: a tabela de tributos aproximados não está vigente na data da emissão (${emissionDate}). Atualize a regra fiscal antes de emitir NFS-e.`);
      if (!Number.isFinite(item.quantity) || item.quantity <= 0 || !Number.isFinite(item.total) || item.total <= 0 || item.netTotal <= 0 || item.discount > item.total + item.addition) { issues.push(`${name}: quantidade, valor ou desconto inválido.`); continue; }
      const explicitServiceDate = item.source.serviceDate || item.source.dataPrestacao || item.source.appointmentDate || sale.serviceDate || sale.dataPrestacao;
      const fromAppointment = item.source.appointmentId || item.source.atendimentoId || sale.appointmentId || sale.appointmentIds?.length;
      if (fromAppointment && !explicitServiceDate) { issues.push(`${name}: data da prestação ausente no atendimento. Reimporte o atendimento com a data correta antes de emitir NFS-e.`); continue; }
      const competence = literalDate(explicitServiceDate || sale.createdAt);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(competence) || competence > literalDate(now())) { issues.push(`${name}: informe a data válida da prestação, sem data futura.`); continue; }
      const municipality = digits(item.source.municipioPrestacao || rule.municipioPrestacao || issuer.municipality);
      if (!/^\d{7}$/.test(municipality)) { issues.push(`${name}: município da prestação inválido.`); continue; }
      const description = text(serviceFiscal.descricao || rule.descricao || service.nome);
      if (!description) { issues.push(`${name}: informe a descrição fiscal do serviço.`); continue; }
      const key = hash({ rule, competence, municipality });
      if (!groups.has(key)) groups.set(key, { rule, competence, municipality, items: [], descriptions: [] });
      const group = groups.get(key);
      group.items.push({ index: item.index, serviceId: item.serviceId, quantity: item.quantity, gross: item.total, discount: item.discount, addition: item.addition, total: item.netTotal });
      group.descriptions.push(`${description} — quantidade ${item.quantity}; valor R$ ${item.netTotal.toFixed(2).replace('.', ',')}`);
    }
    const complimentaryServices = freeServiceItems.map((item) => ({ index: item.index, serviceId: item.serviceId, name: text(item.name || 'Serviço sem cobrança'), quantity: item.quantity, total: 0 }));
    const plan = [...groups.values()].map((group, groupIndex) => {
      group.description = group.descriptions.join('; ');
      delete group.descriptions;
      if (groupIndex === 0 && complimentaryServices.length) {
        group.complimentaryServices = complimentaryServices;
        group.description += `; Itens gratuitos da venda, sem compor o valor desta NFS-e: ${complimentaryServices.map((item) => `${item.name} — quantidade ${item.quantity}; R$ 0,00`).join('; ')}`;
      }
      if (group.rule.tributosFonte) group.description += `; Tributos aproximados: fonte ${group.rule.tributosFonte}${group.rule.tributosVersao ? `; versão ${group.rule.tributosVersao}` : ''}${group.rule.tributosCodigoReferencia ? `; referência ${group.rule.tributosCodigoReferencia}` : ''}`;
      if (group.description.length > 2000) issues.push('A descrição do agrupamento de serviços excede 2.000 caracteres. Divida a venda ou reduza as descrições fiscais.');
      group.gross = sum(group.items, 'gross'); group.discount = sum(group.items, 'discount'); group.addition = sum(group.items, 'addition'); group.total = sum(group.items, 'total');
      const groupKey = hash(group.items.map(({ index, serviceId }) => ({ index, serviceId })));
      const snapshot = { issuer, customer, group, environment: env, serie: text(config.serieDps), saleCode: text(sale.saleCode) };
      return { groupKey, sourceHash: hash(snapshot), snapshot, total: group.total };
    });
    let pair;
    try { pair = await certificateLoader(issuerStore); } catch (error) { issues.push(error.message); }
    return { ready: issues.length === 0, issues: [...new Set(issues)], groups: plan, serviceTotal: sum(serviceItems, 'netTotal'), itemCount: serviceItems.length, freeServiceCount: freeServiceItems.length, environment: env, store: issuerStore, pair };
  }

  async function previewSaleNfse(input) {
    const plan = await prepare(input);
    return { ready: plan.ready, issues: plan.issues, serviceTotal: plan.serviceTotal, itemCount: plan.itemCount, freeServiceCount: plan.freeServiceCount || 0, ...(plan.warning ? { warning: plan.warning } : {}), documentCount: plan.groups.length, environment: plan.environment, groups: plan.groups.map(({ total, snapshot }) => ({ total, description: snapshot.group.description, competence: snapshot.group.competence, serviceIds: snapshot.group.items.map((i) => i.serviceId), codigoTributacaoNacional: snapshot.group.rule.codigoTributacaoNacional })) };
  }

  async function listSaleNfse({ sale, pdv, store, environment }) {
    const query = { pdv: id(pdv), saleId: text(sale?.id || sale), status: { $ne: 'superseded' } };
    // O histórico pertence à venda. Trocar o emitente atual do PDV não pode ocultá-lo.
    if (environment) query.environment = environment;
    const found = await Model.find(query).select('+xmlContent').sort({ createdAt: 1 }).lean();
    const documents = found.map(publicDocument);
    const lease = await SaleLock.findById(`${id(pdv)}:${text(sale?.id || sale)}`).select('progress until').lean();
    const progress = lease?.until > now() ? publicProgress(lease.progress) : null;
    if (!documents.length && sale && typeof sale === 'object') {
      const services = projectItems(sale).filter(isService);
      if (!services.length && sourceItems(sale).length) return { documents, nfseStatus: 'not_applicable' };
      if (services.length && services.every(isComplimentaryService)) return { documents, nfseStatus: 'not_applicable', freeServiceCount: services.length, warning: FREE_SERVICES_NOTICE };
    }
    return { documents, nfseStatus: aggregateStatus(documents), ...(progress ? { progress } : {}) };
  }

  async function claim(document) {
    const token = crypto.randomUUID();
    const claimed = await Model.findOneAndUpdate({ _id: document._id, $or: [{ lockUntil: null }, { lockUntil: { $lt: now() } }] }, { $set: { lockToken: token, lockUntil: new Date(now().getTime() + LOCK_MS) } }, { new: true }).select(documentFields).lean();
    if (!claimed) return null;
    const lease = { lost: false, timer: null };
    lease.timer = setInterval(() => {
      Model.updateOne({ _id: claimed._id, lockToken: token, lockUntil: { $gt: now() } }, { $set: { lockUntil: new Date(now().getTime() + LOCK_MS) } })
        .then((result) => { if (!result.matchedCount) lease.lost = true; }).catch(() => { lease.lost = true; });
    }, dependencies.documentHeartbeatMs || 30000);
    lease.timer.unref();
    documentLeases.set(token, lease);
    return { ...claimed, lockToken: token };
  }
  async function release(document) {
    clearInterval(documentLeases.get(document.lockToken)?.timer);
    documentLeases.delete(document.lockToken);
    await Model.updateOne({ _id: document._id, lockToken: document.lockToken }, { $set: { lockUntil: null }, $unset: { lockToken: 1 } });
  }
  async function update(document, values) {
    const leaseError = () => Object.assign(new Error('A trava do documento expirou ou mudou de terminal. Consulte o resultado.'), { status: 409, statusCode: 409 });
    if (documentLeases.get(document.lockToken)?.lost) throw leaseError();
    const updated = await Model.findOneAndUpdate({ _id: document._id, lockToken: document.lockToken, lockUntil: { $gt: now() } }, { $set: { ...values, lockUntil: new Date(now().getTime() + LOCK_MS) } }, { new: true }).select(documentFields).lean();
    if (!updated) throw leaseError();
    return updated;
  }
  async function queryIssued(document, transport) {
    let lookup;
    try { lookup = await transport.queryDps(document.environment, document.dpsId); } catch (error) {
      // Um 404 de proxy/rota não comprova inexistência da DPS.
      if (error.statusCode === 404 && error.codes?.includes('E2404')) return null;
      throw error;
    }
    const key = text(lookup.chaveAcesso || lookup.ChaveAcesso);
    if (!/^\d{50}$/.test(key)) throw new Error('Consulta DPS sem chave de acesso. A situação permanece indefinida; não retransmitir.');
    if (lookup.idDps && lookup.idDps !== document.dpsId) throw new Error('Consulta retornou outro identificador de DPS; emissão bloqueada.');
    if (lookup.tipoAmbiente && Number(lookup.tipoAmbiente) !== (document.environment === 'producao' ? 1 : 2)) throw new Error('Consulta retornou outro ambiente; emissão bloqueada.');
    const response = await transport.queryNfse(document.environment, key);
    const result = parseAuthorizedXml(decompressXml(response.nfseXmlGZipB64), document);
    const cancellation = findCancellationEvent(await transport.events(document.environment, key), key, document.environment);
    return cancellation ? { ...result, status: 'cancelled', cancelledAt: cancellation.cancelledAt || now(), cancelEventXml: cancellation.xml } : result;
  }

  async function createDocument({ sale, pdv, plan, group, revision, progress }) {
    const number = await nextNumber({ scope: 'nfse_dps', reference: `${group.snapshot.issuer.cnpj}:${plan.environment}:${Number(group.snapshot.serie)}` });
    if (!Number.isSafeInteger(number) || number < 1 || number > 999999999999999) throw new NfseValidationError(['A sequência de DPS ultrapassou o limite de 15 dígitos. Configure outra série livre.']);
    const dpsId = buildDpsId({ municipality: group.snapshot.issuer.municipality, cnpj: group.snapshot.issuer.cnpj, serie: group.snapshot.serie, number });
    await progress.step('building_xml');
    const issuedAt = await transportFactory(plan.pair).emissionTime(plan.environment, dpsId);
    const unsignedXml = buildDpsXml({ snapshot: group.snapshot, number, issuedAt });
    await progress.step('building_xml', true);
    await progress.step('signing');
    const dpsXml = signXml(unsignedXml, plan.pair);
    await progress.step('signing', true);
    try {
      return plain(await Model.create({ pdv: id(pdv), store: id(plan.store), saleId: sale.id, saleCode: text(sale.saleCode), environment: plan.environment, groupKey: group.groupKey, revision, sourceHash: group.sourceHash, snapshot: group.snapshot, dpsId, dpsNumber: number, dpsSerie: group.snapshot.serie, dpsXml, total: group.total, progress: progress.snapshot() }));
    } catch (error) {
      if (error.code !== 11000) throw error;
      const existing = await Model.findOne({ pdv: id(pdv), saleId: sale.id, environment: plan.environment, groupKey: group.groupKey, revision }).select(documentFields).lean();
      if (!existing) throw error;
      if (existing.sourceHash !== group.sourceHash || id(existing.store) !== id(plan.store)) throw new NfseValidationError(['Outra solicitação iniciou a DPS desta venda com dados diferentes. Consulte o documento existente.']);
      return existing;
    }
  }

  async function processDocument(document, transport, progress) {
    if (['authorized', 'cancelled', 'superseded'].includes(document.status)) return document;
    const locked = await claim(document);
    if (!locked) return { ...document, status: 'processing', error: 'Emissão em andamento em outro terminal. Consulte novamente.' };
    let stage = 'query';
    try {
      if (['authorized', 'cancelled', 'superseded'].includes(locked.status)) return locked;
      // Recupera resultado até mesmo após falha do processo antes de salvar o POST.
      if (locked.attempts > 0 || locked.status === 'unknown' || locked.status === 'processing') {
        const recovered = await queryIssued(locked, transport);
        if (recovered) return await update(locked, { ...recovered, error: '', errorCodes: [] });
      }
      await update(locked, { status: 'processing', attempts: locked.attempts + 1, lastAttemptAt: now(), error: '' });
      await progress.step('transmitting');
      await update(locked, { progress: progress.snapshot() });
      stage = 'post';
      const response = await transport.emit(locked.environment, locked.dpsXml);
      await progress.step('transmitting', true);
      stage = 'response';
      let authorized;
      if (response.nfseXmlGZipB64) authorized = parseAuthorizedXml(decompressXml(response.nfseXmlGZipB64), locked);
      else authorized = await queryIssued(locked, transport);
      if (!authorized) throw new Error('Emissor Nacional não retornou a NFS-e autorizada; consulte antes de tentar novamente.');
      return await update(locked, { ...authorized, error: '', errorCodes: [], progress: progress.snapshot() });
    } catch (error) {
      // Só uma rejeição fiscal explícita confirma que não houve autorização.
      const rejected = stage === 'post' && error.statusCode === 400 && Array.isArray(error.codes) && error.codes.length > 0 && !error.uncertain;
      return await update(locked, { status: rejected ? 'rejected' : 'unknown', error: text(error.message).slice(0, 2500), errorCodes: error.codes || [], progress: progress.snapshot() });
    } finally { await release(locked); }
  }

  async function emitSaleNfse(input) {
    return withSaleFiscalLock(input, async (assertLease, progress) => {
      const canonicalSale = await reloadSale(input);
      if (!canonicalSale) throw Object.assign(new Error('Venda não encontrada para revalidar a emissão. Aguarde a sincronização.'), { status: 404 });
      const freshInput = { ...input, sale: plain(canonicalSale) };
      const plan = await prepare(freshInput);
      if (!plan.ready) throw new NfseValidationError(plan.issues);
      if (!plan.groups.length) {
        if (plan.freeServiceCount && await Model.exists({ pdv: id(freshInput.pdv), saleId: freshInput.sale.id, status: { $ne: 'superseded' } })) throw new NfseValidationError(['Já existe uma DPS para esta venda. Consulte o documento original antes de alterar os valores de serviço.']);
        return { documents: [], nfseStatus: 'not_applicable', freeServiceCount: plan.freeServiceCount || 0, ...(plan.warning ? { warning: plan.warning } : {}) };
      }
      // A primeira emissão espera a criação dos índices únicos antes de gravar/transmitir.
      await Model.init();
      return emitPlan(freshInput, plan, assertLease, progress);
    });
  }

  async function withSaleFiscalLock({ pdv, pdvId, sale, saleId }, operation) {
    const resolvedPdv = id(pdv || pdvId);
    const resolvedSale = text(sale?.id || saleId || sale);
    if (!mongoose.isValidObjectId(resolvedPdv) || !resolvedSale) throw new NfseValidationError(['Venda ou PDV inválido para a operação fiscal.']);
    await SaleLock.init();
    // O cancelamento comercial deve usar esta mesma trava, para ambos ambientes.
    const saleLockId = `${resolvedPdv}:${resolvedSale}`;
    const token = crypto.randomUUID();
    try {
      await SaleLock.findOneAndUpdate({ _id: saleLockId, until: { $lt: now() } }, { $set: { token, until: new Date(now().getTime() + LOCK_MS), progress: null } }, { upsert: true, new: true });
    } catch (error) {
      if (error.code !== 11000) throw error;
      throw Object.assign(new Error('Venda em processamento fiscal ou cancelamento. Aguarde e consulte novamente.'), { status: 409, statusCode: 409, code: 'NFSE_SALE_BUSY' });
    }
    let lostLease = false;
    let progressValue = null;
    const progress = {
      reset(documentIndex, documentCount, previous) {
        progressValue = { ...(publicProgress(previous) || {}), documentIndex, documentCount };
      },
      snapshot: () => publicProgress(progressValue),
      async step(stage, completed = false) {
        if (!PROGRESS_STAGES.includes(stage)) throw new Error('Etapa de emissão NFS-e inválida.');
        const at = now().toISOString();
        const steps = { ...(progressValue?.steps || {}) };
        steps[stage] = completed ? { ...steps[stage], completedAt: at } : { startedAt: at };
        progressValue = { ...progressValue, stage, updatedAt: at, steps };
        const result = await SaleLock.updateOne({ _id: saleLockId, token, until: { $gt: now() } }, { $set: { progress: publicProgress(progressValue) } });
        if (!result.matchedCount) {
          lostLease = true;
          throw Object.assign(new Error('A trava da emissão expirou. Consulte a venda antes de continuar.'), { status: 409, statusCode: 409 });
        }
      },
    };
    const heartbeat = setInterval(() => {
      SaleLock.updateOne({ _id: saleLockId, token }, { $set: { until: new Date(now().getTime() + LOCK_MS) } }).then((result) => { if (!result.matchedCount) lostLease = true; }).catch(() => { lostLease = true; });
    }, dependencies.saleHeartbeatMs || 30000);
    heartbeat.unref();
    try {
      return await operation(() => { if (lostLease) throw Object.assign(new Error('A trava da emissão expirou. Consulte a venda antes de continuar.'), { status: 409, statusCode: 409 }); }, progress);
    } catch (error) {
      if (progress.snapshot()) error.progress = progress.snapshot();
      throw error;
    } finally { clearInterval(heartbeat); await SaleLock.deleteOne({ _id: saleLockId, token }); }
  }

  async function emitPlan(input, plan, assertLease, progress) {
    const { sale, pdv } = input;
    const transport = transportFactory(plan.pair);
    let existing = await Model.find({ pdv: id(pdv), saleId: sale.id, environment: plan.environment, status: { $ne: 'superseded' } }).select(documentFields).sort({ revision: -1 }).lean();
    const groupKeys = new Set(plan.groups.map((g) => g.groupKey));
    if (existing.some((d) => !groupKeys.has(d.groupKey))) {
      if (existing.some((d) => d.status !== 'rejected')) throw new NfseValidationError(['A composição de serviços mudou após iniciar a emissão. Consulte os documentos existentes antes de alterar a venda.']);
      // Uma correção tributária pode separar ou juntar grupos. Só reconstruir
      // quando TODAS as DPS anteriores tiveram rejeição definitiva e consulta negativa.
      const locks = [];
      try {
        for (const document of existing) {
          assertLease();
          const locked = await claim(document);
          if (!locked || locked.status !== 'rejected') throw Object.assign(new Error('Documento em processamento; consulte antes de reagrupar.'), { status: 409 });
          locks.push(locked);
          const recovered = await queryIssued(locked, transport);
          if (recovered) { await update(locked, { ...recovered, error: '' }); throw new NfseValidationError(['Uma DPS anterior foi autorizada. Não é possível reagrupar esta venda automaticamente.']); }
        }
        for (const locked of locks) await update(locked, { status: 'superseded', error: 'Agrupamento fiscal corrigido após rejeição definitiva e consulta da DPS.' });
        existing = [];
      } finally { for (const locked of locks) await release(locked); }
    }
    const output = [];
    for (const group of plan.groups) {
      assertLease();
      let document = existing.find((d) => d.groupKey === group.groupKey);
      progress.reset(output.length + 1, plan.groups.length, document?.progress);
      if (document && id(document.store) !== id(plan.store)) throw new NfseValidationError(['Já existe uma DPS desta venda para outra empresa. Consulte a emissão original.']);
      const rejectedFutureTime = document?.status === 'rejected'
        && document.errorCodes?.length === 1 && document.errorCodes[0] === 'E0008';
      if (document && (document.sourceHash !== group.sourceHash || rejectedFutureTime)) {
        if (document.status !== 'rejected') throw new NfseValidationError(['Os dados da venda ou do cadastro fiscal foram alterados após iniciar a emissão. Consulte a DPS original; não será criada uma nota duplicada.']);
        const locked = await claim(document);
        if (!locked) { output.push(publicDocument({ ...document, status: 'processing' })); continue; }
        try {
          const recovered = await queryIssued(locked, transport);
          if (recovered) { output.push(publicDocument(await update(locked, { ...recovered, error: '' }))); continue; }
          document = await createDocument({ sale, pdv, plan, group, revision: locked.revision + 1, progress });
          await update(locked, { status: 'superseded', error: 'Rejeição corrigida em uma nova DPS; histórico preservado.' });
        } finally { await release(locked); }
      }
      if (!document) {
        const previous = await Model.findOne({ pdv: id(pdv), saleId: sale.id, environment: plan.environment, groupKey: group.groupKey }).sort({ revision: -1 }).lean();
        document = await createDocument({ sale, pdv, plan, group, revision: (previous?.revision || 0) + 1, progress });
      }
      output.push(publicDocument(await processDocument(document, transport, progress)));
    }
    return { documents: output, nfseStatus: aggregateStatus(output), ...(progress.snapshot() ? { progress: progress.snapshot() } : {}) };
  }

  async function consultDocument(documentId) {
    const document = await Model.findById(documentId).select(documentFields).lean();
    if (!document) throw Object.assign(new Error('NFS-e não encontrada.'), { status: 404 });
    const store = await resolveStore({ _id: document.store });
    const transport = transportFactory(await certificateLoader(store));
    const locked = await claim(document);
    if (!locked) return publicDocument({ ...document, status: 'processing' });
    try {
      const found = await queryIssued(locked, transport);
      if (found) {
        return publicDocument(await update(locked, { ...found, status: found.status === 'cancelled' || locked.status === 'cancelled' ? 'cancelled' : 'authorized', error: '' }));
      }
      return publicDocument(await update(locked, { error: 'DPS ainda não encontrada no Emissor Nacional.' }));
    } finally { await release(locked); }
  }

  async function cancelDocument({ documentId, reasonCode, reason }) {
    const document = await Model.findById(documentId).select(documentFields).lean();
    if (!document) throw Object.assign(new Error('NFS-e não encontrada.'), { status: 404 });
    if (document.status === 'cancelled') return publicDocument(document);
    if (document.status !== 'authorized') throw new NfseValidationError(['Somente uma NFS-e autorizada pode ser cancelada.']);
    const store = await resolveStore({ _id: document.store });
    const pair = await certificateLoader(store);
    const transport = transportFactory(pair);
    const locked = await claim(document);
    if (!locked) throw Object.assign(new Error('Documento em processamento. Consulte novamente.'), { status: 409 });
    try {
      if (locked.status === 'cancelled') return publicDocument(locked);
      if (locked.status !== 'authorized') throw new NfseValidationError(['O documento mudou de situação durante o cancelamento. Consulte novamente.']);
      // Reconciliar cancelamentos feitos no portal e timeouts do evento anterior.
      const priorCancellation = findCancellationEvent(await transport.events(locked.environment, locked.accessKey), locked.accessKey, locked.environment);
      if (priorCancellation) return publicDocument(await update(locked, { status: 'cancelled', cancelledAt: priorCancellation.cancelledAt || now(), cancelEventXml: priorCancellation.xml, error: '' }));
      const xml = locked.cancelRequestXml || signXml(buildCancellationXml({ accessKey: locked.accessKey, environment: locked.environment, cnpj: locked.snapshot.issuer.cnpj, reasonCode, reason, issuedAt: now() }), pair, 'infPedReg');
      await update(locked, { cancelRequestXml: xml, cancellationReason: locked.cancelRequestXml ? locked.cancellationReason : text(reason) });
      const response = await transport.cancel(locked.environment, locked.accessKey, xml);
      const cancellation = findCancellationEvent(response, locked.accessKey, locked.environment);
      if (!cancellation) throw new Error('Cancelamento sem evento confirmado. Consulte a situação antes de repetir.');
      return publicDocument(await update(locked, { status: 'cancelled', cancelledAt: cancellation.cancelledAt || now(), cancelEventXml: cancellation.xml, error: '' }));
    } catch (error) {
      await update(locked, { error: `Cancelamento não confirmado: ${text(error.message).slice(0, 2400)}` });
      throw error;
    } finally { await release(locked); }
  }

  return { previewSaleNfse, emitSaleNfse, listSaleNfse, consultDocument, cancelDocument, withSaleFiscalLock };
}

module.exports = { ...createNfseService(), createNfseService, NfseValidationError, publicDocument, aggregateStatus, _test: { projectItems, literalDate, normalizeCustomer, validateRuleForIssuer, isService, sourceItems, findCancellationEvent, reloadCanonicalSale } };
