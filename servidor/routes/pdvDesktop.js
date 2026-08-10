const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const requireAuth = require('../middlewares/requireAuth');
const authorizeRoles = require('../middlewares/authorizeRoles');
const Pdv = require('../models/Pdv');
const PdvState = require('../models/PdvState');
const PdvStateSale = require('../models/PdvStateSale');
const PaymentMethod = require('../models/PaymentMethod');
const Product = require('../models/Product');
const User = require('../models/User');
const Pet = require('../models/Pet');
const UserAddress = require('../models/UserAddress');
const PdvDesktopHost = require('../models/PdvDesktopHost');
const PdvDesktopEvent = require('../models/PdvDesktopEvent');
const PdvCodeRange = require('../models/PdvCodeRange');
const PdvConversionBackup = require('../models/PdvConversionBackup');
const AccountReceivable = require('../models/AccountReceivable');
const Appointment = require('../models/Appointment');
const Exchange = require('../models/Exchange');
const Transfer = require('../models/Transfer');
const FiscalDefaultRule = require('../models/FiscalDefaultRule');
const Store = require('../models/Store');
const Deposit = require('../models/Deposit');
require('../models/Service');
const pdvDomain = require('./pdvs');
const { adjustProductStockForDeposit, toObjectIdOrNull } = require('../utils/inventoryStock');
const { decryptBuffer, decryptText } = require('../utils/certificates');

const router = express.Router();
const adminOnly = [requireAuth, authorizeRoles('admin', 'admin_master')];
const hash = (value) => crypto.createHash('sha256').update(String(value || '')).digest('hex');
const clean = (value) => String(value || '').trim();
const desktopEventActor = (source, host) => ({
  id: clean(source?.operator?.id) || String(host._id),
  name: clean(source?.operator?.name) || host.name || 'PDV Desktop',
  email: clean(source?.operator?.email),
  role: clean(source?.operator?.role) || 'desktop',
});
const userName = (user) => clean(user?.nomeCompleto || user?.nomeContato || user?.razaoSocial || user?.email);
const DESKTOP_STAFF_ROLES = new Set(['funcionario', 'franqueado', 'franqueador', 'admin', 'admin_master']);

function desktopOperatorIdentifierQuery(identifier) {
  const raw = clean(identifier);
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  const variants = [{ email: raw.toLowerCase() }];
  if (digits.length === 11) variants.push({ cpf: raw }, { cpf: digits }, { cpf: `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}` });
  if (digits.length === 14) variants.push({ cnpj: raw }, { cnpj: digits }, { cnpj: `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}` });
  return { $or: variants };
}

function desktopOperatorCanAccessCompany(user, companyId) {
  if (['admin', 'admin_master', 'franqueador'].includes(String(user?.role || '').toLowerCase())) return true;
  const companies = [user?.empresaPrincipal, user?.empresaContratual, ...(Array.isArray(user?.empresas) ? user.empresas : [])]
    .filter(Boolean).map(String);
  return companies.includes(String(companyId));
}
function desktopOperatorIsActive(user) {
  const situation = clean(user?.situacao).toLowerCase();
  return DESKTOP_STAFF_ROLES.has(String(user?.role || '').toLowerCase())
    && !user?.dataDemissao
    && !['inativo', 'bloqueado', 'demitido', 'desligado'].includes(situation);
}

const normalizeDigits = (value) => clean(value).replace(/\D/g, '');
const normalizeSearchText = (value) => clean(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const desktopSaleCustomerMatches = (sale, customer) => {
  const customerId = clean(customer?._id);
  const saleCustomerId = clean(sale?.customerId || sale?.customer?.id || sale?.customer?._id || sale?.snapshotCustomer?.id || sale?.snapshotCustomer?._id);
  if (customerId && saleCustomerId === customerId) return true;
  const document = normalizeDigits(customer?.cpf || customer?.cnpj);
  const saleDocument = normalizeDigits(sale?.customerDocument || sale?.customer?.document || sale?.snapshotCustomer?.documento);
  if (document && saleDocument === document) return true;
  const name = normalizeSearchText(userName(customer));
  const saleName = normalizeSearchText(sale?.customerName || sale?.customer?.name || sale?.customer?.nome || sale?.snapshotCustomer?.nome);
  return Boolean(name && saleName && (name === saleName || name.includes(saleName) || saleName.includes(name)));
};
const desktopSaleDate = (sale) => new Date(sale?.createdAt || sale?.updatedAt || sale?.date || 0).getTime() || 0;
const dedupeDesktopSales = (sales) => {
  const unique = new Map();
  for (const sale of sales) {
    const id = clean(sale?.id || sale?._id);
    const code = clean(sale?.saleCode || sale?.saleCodeLabel).toUpperCase();
    const key = id ? `id:${id}` : code ? `code:${code}` : '';
    if (key && !unique.has(key)) unique.set(key, sale);
  }
  return [...unique.values()].sort((left, right) => desktopSaleDate(right) - desktopSaleDate(left));
};

const addressLookupCache = new Map();
const expandStreetAbbreviation = (value) => {
  const input = clean(value).replace(/\s+/g, ' ');
  const replacements = [
    [/^r\.?\s+/i, 'Rua '], [/^av\.?\s+/i, 'Avenida '], [/^al\.?\s+/i, 'Alameda '],
    [/^estr\.?\s+/i, 'Estrada '], [/^est\.?\s+/i, 'Estrada '], [/^rod\.?\s+/i, 'Rodovia '],
    [/^tv\.?\s+/i, 'Travessa '], [/^trav\.?\s+/i, 'Travessa '], [/^pç\.?\s+/i, 'Praça '],
    [/^pc\.?\s+/i, 'Praça '], [/^lgo\.?\s+/i, 'Largo '], [/^vl\.?\s+/i, 'Vila '],
  ];
  for (const [pattern, replacement] of replacements) if (pattern.test(input)) return input.replace(pattern, replacement);
  return input;
};
const addressDistanceKm = (origin, target) => {
  if (![origin?.lat, origin?.lon, target?.lat, target?.lon].every(Number.isFinite)) return Number.POSITIVE_INFINITY;
  const radians = (value) => value * Math.PI / 180;
  const dLat = radians(target.lat - origin.lat); const dLon = radians(target.lon - origin.lon);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(radians(origin.lat)) * Math.cos(radians(target.lat)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};
const fetchAddressJson = async (url, headers = {}) => {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`Consulta de endereço falhou (${response.status}).`);
  return response.json();
};

function encodeCursor(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function decodeCursor(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'));
    const updatedAt = new Date(parsed.updatedAt);
    if (!mongoose.Types.ObjectId.isValid(parsed.id) || Number.isNaN(updatedAt.getTime())) return null;
    return { id: new mongoose.Types.ObjectId(parsed.id), updatedAt };
  } catch {
    return null;
  }
}

function productForDesktop(product, pdv, empresaId, fiscalRules = new Map()) {
  const depositId = clean(pdv?.configuracoesEstoque?.depositoPadrao?._id || pdv?.configuracoesEstoque?.depositoPadrao);
  const depositStock = Array.isArray(product.estoques)
    ? product.estoques.find((item) => clean(item?.deposito?._id || item?.deposito) === depositId)
    : null;
  const companyFiscal = product.fiscalPorEmpresa?.[empresaId] || product.fiscalPorEmpresa?.get?.(empresaId) || null;
  const currentFiscal = companyFiscal || product.fiscal || {};
  const ruleCode = clean(currentFiscal.fiscalRuleCode || currentFiscal.regraFiscalCodigo || currentFiscal.ruleCode);
  const resolvedFiscal = ruleCode && fiscalRules.has(String(Number(ruleCode)))
    ? { ...fiscalRules.get(String(Number(ruleCode))), fiscalRuleCode: ruleCode }
    : currentFiscal;
  return {
    id: String(product._id),
    cod: product.cod,
    codbarras: product.codbarras,
    codigosComplementares: product.codigosComplementares || [],
    nome: product.nome,
    descricao: product.descricao || '',
    venda: Number(product.venda || 0),
    unidade: product.unidade || '',
    stock: Number(depositStock?.quantidade ?? product.stock ?? 0),
    inativo: Boolean(product.inativo),
    precoClube: product.precoClube ?? null,
    promocao: product.promocao || {},
    promocaoCondicional: product.promocaoCondicional || {},
    fracionado: product.fracionado || {},
    ncm: product.ncm || '',
    fiscal: resolvedFiscal,
    updatedAt: product.updatedAt || null,
  };
}

function appointmentForDesktop(appointment) {
  const customer = appointment?.cliente && typeof appointment.cliente === 'object' ? appointment.cliente : null;
  const pet = appointment?.pet && typeof appointment.pet === 'object' ? appointment.pet : null;
  const professional = appointment?.profissional && typeof appointment.profissional === 'object' ? appointment.profissional : null;
  const services = (Array.isArray(appointment?.itens) ? appointment.itens : []).map((item, index) => {
    const service = item?.servico && typeof item.servico === 'object' ? item.servico : null;
    const itemProfessional = item?.profissional && typeof item.profissional === 'object' ? item.profissional : null;
    return {
      id: clean(service?._id || item?.servico || `${appointment._id}:service:${index}`),
      serviceId: clean(service?._id || item?.servico),
      name: service?.nome || `Serviço ${index + 1}`,
      quantity: 1,
      unitPrice: Number(item?.valor ?? service?.valor ?? 0),
      professionalId: clean(itemProfessional?._id || item?.profissional),
      professionalName: userName(itemProfessional),
      time: item?.hora || '',
      date: item?.data || '',
      status: item?.status || appointment.status || 'agendado',
      notes: item?.observacao || '',
    };
  });
  return {
    id: String(appointment._id),
    storeId: clean(appointment.store),
    customerId: clean(customer?._id || appointment.cliente),
    customerName: userName(customer),
    customerDocument: customer?.cpf || customer?.cnpj || '',
    customerPhone: customer?.celular || customer?.telefone || '',
    petId: clean(pet?._id || appointment.pet),
    petName: pet?.nome || '',
    professionalId: clean(professional?._id || appointment.profissional),
    professionalName: userName(professional),
    services,
    scheduledAt: appointment.scheduledAt,
    total: Number(appointment.valor || services.reduce((sum, item) => sum + Number(item.unitPrice || 0), 0)),
    status: appointment.status || 'agendado',
    paid: Boolean(appointment.pago),
    saleCode: appointment.codigoVenda || '',
    notes: appointment.observacoes || '',
    updatedAt: appointment.updatedAt || appointment.createdAt,
  };
}

function snapshotChecksum(snapshot, stateSnapshot) {
  return hash(JSON.stringify({ snapshot, stateSnapshot }));
}

function desktopReceivableReference(pdvId, localId) {
  return `desktop:${clean(pdvId)}:${clean(localId)}`;
}

async function syncDesktopSaleReceivables(source, pdv, host) {
  const entries = Array.isArray(source?.receivables) ? source.receivables : [];
  if (!entries.length) return;
  const bankAccount = pdv?.configuracoesFinanceiro?.contaCorrente?._id || pdv?.configuracoesFinanceiro?.contaCorrente;
  const accountingAccount = pdv?.configuracoesFinanceiro?.contaContabilReceber?._id || pdv?.configuracoesFinanceiro?.contaContabilReceber;
  if (!mongoose.Types.ObjectId.isValid(bankAccount) || !mongoose.Types.ObjectId.isValid(accountingAccount)) return;
  for (const entry of entries) {
    const localId = clean(entry?.id);
    const customerId = clean(entry?.customerId || source.customerId);
    const paymentMethodId = clean(entry?.paymentMethodId);
    const dueDate = new Date(entry?.dueDate || source.createdAt || Date.now());
    const amount = Number(entry?.originalAmount || entry?.amount || 0);
    if (!localId || !mongoose.Types.ObjectId.isValid(customerId) || !(amount > 0) || Number.isNaN(dueDate.getTime())) continue;
    const originReference = desktopReceivableReference(pdv._id, localId);
    const issueDate = new Date(source.createdAt || Date.now());
    await AccountReceivable.updateOne(
      { originReference },
      {
        $setOnInsert: {
          code: `PDVD-${hash(originReference).slice(0, 16).toUpperCase()}`,
          company: host.empresa,
          customer: customerId,
          customerName: entry.customerName || source.customerName || '',
          installmentsCount: 1,
          issueDate,
          dueDate,
          totalValue: amount,
          bankAccount,
          accountingAccount,
          paymentMethod: mongoose.Types.ObjectId.isValid(paymentMethodId) ? paymentMethodId : undefined,
          documentNumber: `${source.saleCode || source.id || 'PDV'}-${Number(entry.installmentNumber || 1)}`,
          notes: `Parcela gerada pelo PDV Executável na venda ${source.saleCode || source.id || ''}.`,
          locked: true,
          lockReason: 'Lançamento gerado automaticamente pelo PDV Executável.',
          origin: 'pdv-desktop-sale',
          originReference,
          metadata: { pdvId: String(pdv._id), saleId: source.id, saleCode: source.saleCode, localReceivableId: localId, desktopPaymentEventIds: [] },
          installments: [{
            number: 1, issueDate, dueDate, value: amount, originalValue: amount, paidValue: 0,
            bankAccount, accountingAccount,
            paymentMethod: mongoose.Types.ObjectId.isValid(paymentMethodId) ? paymentMethodId : undefined,
            status: 'pending',
          }],
        },
      },
      { upsert: true }
    );
  }
}

async function syncDesktopReceivablePayment(source, pdv, eventId) {
  const originReference = desktopReceivableReference(pdv._id, source?.receivableId);
  const receivable = await AccountReceivable.findOne({ originReference });
  if (!receivable) return;
  const processed = Array.isArray(receivable.metadata?.desktopPaymentEventIds) ? receivable.metadata.desktopPaymentEventIds : [];
  if (processed.includes(eventId)) return;
  const amount = Number(source.amount || 0);
  if (!(amount > 0)) return;
  const installments = Array.isArray(receivable.installments) ? receivable.installments : [];
  const target = [...installments].reverse().find((entry) => clean(entry?.status).toLowerCase() !== 'received');
  if (!target) return;
  const outstanding = Number(target.originalValue || target.value || 0);
  if (amount - outstanding > 0.000001) throw new Error('Recebimento do PDV supera o saldo da parcela na nuvem.');
  const paidAt = new Date(source.paidAt || Date.now());
  const remaining = Math.max(0, Math.round((outstanding - amount) * 100) / 100);
  target.value = amount;
  target.paidValue = amount;
  target.paidDate = paidAt;
  target.paymentMethod = mongoose.Types.ObjectId.isValid(source.paymentMethodId) ? source.paymentMethodId : undefined;
  target.paymentNotes = source.notes || '';
  target.status = 'received';
  if (remaining > 0.000001) {
    const nextNumber = installments.reduce((max, entry) => Math.max(max, Number(entry.number || 0)), 0) + 1;
    installments.push({
      number: nextNumber, issueDate: paidAt, dueDate: target.dueDate, value: remaining, originalValue: remaining,
      paidValue: 0, bankAccount: target.bankAccount || receivable.bankAccount,
      accountingAccount: target.accountingAccount || receivable.accountingAccount,
      paymentMethod: mongoose.Types.ObjectId.isValid(source.paymentMethodId) ? source.paymentMethodId : undefined,
      originInstallmentNumber: Number(source.installmentNumber || 1), status: 'pending',
    });
  }
  receivable.installmentsCount = installments.length;
  receivable.totalValue = installments.reduce((sum, entry) => sum + Number(entry.value || 0), 0);
  receivable.dueDate = installments.reduce((latest, entry) => {
    const due = new Date(entry.dueDate); return !latest || due > latest ? due : latest;
  }, null) || receivable.dueDate;
  receivable.metadata = { ...(receivable.metadata || {}), desktopPaymentEventIds: [...processed, eventId].slice(-200) };
  receivable.markModified('installments'); receivable.markModified('metadata');
  await receivable.save();
}

function desktopExchangeItems(entries = []) {
  return (Array.isArray(entries) ? entries : []).map((item) => ({
    code: clean(item?.code),
    description: clean(item?.name || item?.description),
    productId: toObjectIdOrNull(item?.productId),
    quantity: Number(item?.quantity || 0),
    unitValue: Number(item?.unitPrice || 0),
    totalValue: Number(item?.total || 0),
    discountValue: Number(item?.discount || 0),
    sourceSaleId: clean(item?.sourceSaleId),
    sourceSaleCode: clean(item?.sourceSaleCode),
  })).filter((item) => item.productId && item.quantity > 0);
}

async function createDesktopExchange(source, pdv, host, eventId) {
  const existing = await Exchange.findOne({ pdv: pdv._id, desktopExchangeId: clean(source.id || source.exchangeId) });
  if (existing) return existing;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const last = await Exchange.findOne({}, { number: 1 }).sort({ number: -1 }).lean();
    const number = Number(last?.number || 0) + 1;
    try {
      return await Exchange.create({
        number,
        code: clean(source.exchangeCode || source.code) || String(number),
        date: new Date(source.createdAt || Date.now()),
        type: 'troca',
        company: host.empresa,
        pdv: pdv._id,
        desktopExchangeId: clean(source.id || source.exchangeId),
        desktopCode: clean(source.exchangeCode || source.code),
        desktopEventIds: [eventId],
        seller: { id: clean(source.sellerId), code: clean(source.sellerCode), name: clean(source.sellerName) },
        customer: { id: clean(source.customerId), name: clean(source.customerName), document: clean(source.customerDocument) },
        notes: clean(source.notes),
        returnedItems: desktopExchangeItems(source.returnedItems),
        takenItems: desktopExchangeItems(source.takenItems),
        totals: { returned: Number(source.returnedTotal || 0), taken: Number(source.takenTotal || 0) },
        differenceValue: Number(source.differenceValue || 0),
        sourceSales: source.sourceSaleId || source.sourceSaleCode ? [{ saleId: clean(source.sourceSaleId), saleCode: clean(source.sourceSaleCode) }] : [],
        createdBy: desktopEventActor(source, host),
      });
    } catch (error) {
      if (error?.code !== 11000) throw error;
    }
  }
  throw new Error('Não foi possível gerar o código da troca na nuvem.');
}

async function materializeDesktopExchangeEvent(event, pdv, host) {
  const source = event.payload && typeof event.payload === 'object' ? event.payload : {};
  const exchange = await createDesktopExchange(source, pdv, host, event.eventId);
  const processedIds = Array.isArray(exchange.desktopEventIds) ? exchange.desktopEventIds.map(clean) : [];
  if (event.type === 'exchange.registered' || processedIds.includes(event.eventId) && exchange.inventoryProcessed) return;
  if (event.type !== 'exchange.finalized') return;
  if (!exchange.inventoryProcessed) {
    const defaultDepositId = toObjectIdOrNull(pdv?.configuracoesEstoque?.depositoPadrao);
    if (!defaultDepositId) throw new Error('Configure o depósito padrão para sincronizar a troca.');
    const movements = [];
    desktopExchangeItems(source.returnedItems).forEach((item) => movements.push({ productId: item.productId, quantity: item.quantity }));
    if (clean(source.inventoryMode).toLowerCase() !== 'return_only') {
      desktopExchangeItems(source.takenItems).forEach((item) => movements.push({ productId: item.productId, quantity: -item.quantity }));
    }
    for (const movement of movements) {
      await adjustProductStockForDeposit({ productId: movement.productId, depositId: defaultDepositId, quantity: movement.quantity });
    }
    if (clean(source.outcome) === 'credit' && mongoose.Types.ObjectId.isValid(source.customerId) && Number(source.refundAmount || 0) > 0) {
      await User.updateOne({ _id: source.customerId }, { $inc: { valorPendente: Number(source.refundAmount) } });
    }
    exchange.inventoryProcessed = true;
    exchange.inventoryProcessedAt = new Date(source.finalizedAt || Date.now());
    exchange.finalizedAt = exchange.inventoryProcessedAt;
  }
  exchange.desktopOutcome = clean(source.outcome);
  exchange.generatedSaleId = clean(source.generatedSaleId);
  exchange.generatedSaleCode = clean(source.generatedSaleCode);
  exchange.desktopEventIds = Array.from(new Set([...processedIds, event.eventId])).slice(-200);
  exchange.finalizedBy = desktopEventActor(source, host);
  await exchange.save();
}

async function materializeDesktopTransferEvent(event, pdv, host) {
  const source = event.payload && typeof event.payload === 'object' ? event.payload : {};
  const desktopTransferId = clean(source.id || source.transferId);
  if (!desktopTransferId) throw new Error('A transferência local não possui identificador.');
  const existing = await Transfer.findOne({ desktopPdv: pdv._id, desktopTransferId });
  if (existing) {
    if (!existing.desktopEventIds.includes(event.eventId)) {
      existing.desktopEventIds = [...existing.desktopEventIds, event.eventId].slice(-200);
      await existing.save();
    }
    return existing;
  }
  const companyId = String(host.empresa);
  const originCompanyId = clean(source.originCompanyId);
  const destinationCompanyId = clean(source.destinationCompanyId);
  if (originCompanyId !== companyId || destinationCompanyId !== companyId) throw new Error('O PDV só pode solicitar transferências entre depósitos da própria empresa.');
  const [originDeposit, destinationDeposit, responsible] = await Promise.all([
    Deposit.findOne({ _id: source.originDepositId, empresa: host.empresa }).lean(),
    Deposit.findOne({ _id: source.destinationDepositId, empresa: host.empresa }).lean(),
    User.findOne({ _id: source.responsibleId, $or: [{ empresaPrincipal: host.empresa }, { empresaContratual: host.empresa }, { empresas: host.empresa }] }).lean(),
  ]);
  if (!originDeposit || !destinationDeposit || String(originDeposit._id) === String(destinationDeposit._id)) throw new Error('Depósitos de origem e destino inválidos.');
  if (!responsible) throw new Error('Responsável não autorizado para esta empresa.');
  const sourceItems = Array.isArray(source.items) ? source.items : [];
  if (!sourceItems.length) throw new Error('Inclua ao menos um produto na transferência.');
  const productIds = sourceItems.map((item) => clean(item.productId || item.id)).filter(mongoose.Types.ObjectId.isValid);
  const products = await Product.find({ _id: { $in: productIds } }).select('_id cod codbarras nome unidade custo venda').lean();
  const productMap = new Map(products.map((product) => [String(product._id), product]));
  const items = sourceItems.map((item) => {
    const product = productMap.get(clean(item.productId || item.id));
    const quantity = Number(item.quantity ?? item.quantidade ?? 0);
    if (!product || !(quantity > 0)) throw new Error('Há um produto ou quantidade inválida na transferência.');
    return { product: product._id, sku: product.cod || '', barcode: product.codbarras || '', description: product.nome || '', quantity, unit: item.unit || product.unidade || 'UN', unitCost: Number(product.custo || 0), unitSale: Number(product.venda || 0), totalSale: Number(product.venda || 0) * quantity };
  });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const last = await Transfer.findOne({}, { number: 1 }).sort({ number: -1 }).lean();
    try {
      return await Transfer.create({
        number: Number(last?.number || 0) + 1,
        requestDate: new Date(source.requestDate || source.createdAt || Date.now()), status: 'solicitada',
        originCompany: host.empresa, originDeposit: originDeposit._id,
        destinationCompany: host.empresa, destinationDeposit: destinationDeposit._id,
        responsible: responsible._id, referenceDocument: clean(source.referenceDocument), observations: clean(source.observations), items,
        desktopTransferId, desktopEventIds: [event.eventId], desktopHost: host._id, desktopPdv: pdv._id,
      });
    } catch (error) {
      if (error?.code !== 11000) throw error;
      const replay = await Transfer.findOne({ desktopPdv: pdv._id, desktopTransferId });
      if (replay) return replay;
    }
  }
  throw new Error('Não foi possível gerar o número da transferência na nuvem.');
}

async function materializeDesktopEvent(event, pdv, host) {
  const supportedTypes = [
    'cash.opened',
    'cash.entry',
    'cash.exit',
    'cash.shipment',
    'cash.closed',
    'sale.completed',
    'sale.cancelled',
    'receivable.received',
    'budget.saved',
    'budget.finalized',
    'delivery.registered',
    'delivery.status.updated',
    'delivery.courier.updated',
    'delivery.finalized',
    'exchange.registered',
    'exchange.finalized',
    'transfer.requested',
    'customer.created',
  ];
  if (!supportedTypes.includes(event.type)) return false;
  if (event.type === 'customer.created') {
    const source = event.payload && typeof event.payload === 'object' ? event.payload : {};
    const customerId = clean(source.customerId || source.id);
    if (!mongoose.Types.ObjectId.isValid(customerId)) throw new Error('Identificador local do cliente inválido.');
    let customer = await User.findById(customerId);
    if (!customer) {
      const document = clean(source.document).replace(/\D/g, '');
      const phone = clean(source.phone).replace(/\D/g, '');
      if (!clean(source.name) || !phone) throw new Error('Nome e telefone são obrigatórios para cadastrar o cliente.');
      const duplicate = await User.findOne({ $or: [
        { celular: phone },
        ...(document.length === 11 ? [{ cpf: document }] : []),
        ...(document.length === 14 ? [{ cnpj: document }] : []),
      ] }).lean();
      if (duplicate) throw new Error('Já existe um cliente com este telefone ou documento.');
      const last = await User.findOne({ codigoCliente: { $type: 'number' } }).sort({ codigoCliente: -1 }).select('codigoCliente').lean();
      const password = await bcrypt.hash(crypto.randomBytes(18).toString('base64url'), 10);
      customer = await User.create({
        _id: customerId,
        tipoConta: document.length === 14 ? 'pessoa_juridica' : 'pessoa_fisica',
        email: clean(source.email) || `cadastro.desktop+${customerId}@eobicho.local`,
        senha: password,
        celular: phone,
        telefone: clean(source.secondaryPhone),
        codigoCliente: Number(last?.codigoCliente || 0) + 1,
        nomeCompleto: document.length === 14 ? undefined : clean(source.name),
        razaoSocial: document.length === 14 ? clean(source.name) : undefined,
        cpf: document.length === 11 ? document : undefined,
        cnpj: document.length === 14 ? document : undefined,
        genero: clean(source.gender),
        dataNascimento: source.birthDate || undefined,
        role: 'cliente',
        empresaPrincipal: host.empresa,
        empresas: [host.empresa],
      });
    }
    const address = source.address && typeof source.address === 'object' ? source.address : {};
    if (clean(address.zipCode || address.cep) || clean(address.street || address.logradouro)) {
      await UserAddress.findOneAndUpdate(
        { user: customer._id, isDefault: true },
        { $set: { apelido: clean(address.label) || 'Principal', cep: clean(address.zipCode || address.cep), logradouro: clean(address.street || address.logradouro), numero: clean(address.number || address.numero), complemento: clean(address.complement || address.complemento), bairro: clean(address.district || address.bairro), cidade: clean(address.city || address.cidade), uf: clean(address.state || address.uf).toUpperCase(), isDefault: true } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    }
    return true;
  }
  if (event.type === 'exchange.registered' || event.type === 'exchange.finalized') {
    await materializeDesktopExchangeEvent(event, pdv, host);
    return true;
  }
  if (event.type === 'transfer.requested') {
    await materializeDesktopTransferEvent(event, pdv, host);
    return true;
  }
  const source = event.payload && typeof event.payload === 'object' ? event.payload : {};
  let action;
  let payload;
  const hydratePayments = async (entries = []) => {
    const methodIds = entries.map((entry) => entry?.paymentMethodId).filter(mongoose.Types.ObjectId.isValid);
    const methods = methodIds.length
      ? await PaymentMethod.find({ _id: { $in: methodIds }, company: host.empresa }).lean()
      : [];
    const methodMap = new Map(methods.map((method) => [String(method._id), method]));
    return entries.map((entry) => {
      const method = methodMap.get(String(entry?.paymentMethodId));
      return {
        id: String(entry?.paymentMethodId || ''),
        label: method?.name || entry?.label || 'Pagamento',
        type: method?.type || entry?.type || 'avista',
        valor: Number(entry?.amount ?? entry?.valor ?? 0),
        parcelas: Number(entry?.installments || 1),
      };
    });
  };
  const hydrateSaleItems = async (entries = []) => {
    const productIds = entries.map((entry) => entry?.productId || entry?.id).filter(mongoose.Types.ObjectId.isValid);
    const codes = entries.map((entry) => clean(entry?.code || entry?.cod)).filter(Boolean);
    const barcodes = entries.map((entry) => clean(entry?.barcode || entry?.codbarras)).filter(Boolean);
    const names = entries.map((entry) => clean(entry?.name || entry?.nome)).filter(Boolean);
    const conditions = [];
    if (productIds.length) conditions.push({ _id: { $in: productIds } });
    if (codes.length) conditions.push({ cod: { $in: codes } });
    if (barcodes.length) conditions.push({ codbarras: { $in: barcodes } });
    if (names.length) conditions.push({ nome: { $in: names } });
    const products = conditions.length
      ? await Product.find({ $or: conditions }).select('_id cod codbarras nome custo').lean()
      : [];
    const byId = new Map(products.map((product) => [String(product._id), product]));
    const byCode = new Map(products.filter((product) => product.cod).map((product) => [clean(product.cod), product]));
    const byBarcode = new Map(products.filter((product) => product.codbarras).map((product) => [clean(product.codbarras), product]));
    const byName = new Map(products.filter((product) => product.nome).map((product) => [clean(product.nome), product]));
    return entries.map((item) => {
      const product = byId.get(String(item?.productId || item?.id || ''))
        || byCode.get(clean(item?.code || item?.cod))
        || byBarcode.get(clean(item?.barcode || item?.codbarras))
        || byName.get(clean(item?.name || item?.nome));
      const productId = product?._id || item.productId || item.id;
      return {
        ...item,
        id: productId,
        productId,
        nome: item.name || item.nome || product?.nome || '',
        quantidade: Number(item.quantity ?? item.quantidade ?? 0),
        preco: Number(item.unitPrice ?? item.preco ?? 0),
        ...(Number(product?.custo) > 0 ? { custo: Number(product.custo), unitCost: Number(product.custo) } : {}),
      };
    });
  };
  if (event.type === 'cash.opened') {
    action = 'pdv.caixa.open';
    const sourceOpeningPayments = Array.isArray(source.openingPayments) && source.openingPayments.length
      ? source.openingPayments
      : [{ paymentMethodId: source.paymentMethodId || 'dinheiro', amount: Number(source.openingAmount || 0), label: 'Dinheiro' }];
    const openingPayments = await hydratePayments(sourceOpeningPayments);
    payload = {
      payments: openingPayments,
      createdAt: source.openedAt || event.occurredAt,
    };
  } else if (['cash.entry', 'cash.exit', 'cash.shipment'].includes(event.type)) {
    const actionByType = {
      'cash.entry': 'pdv.caixa.entry',
      'cash.exit': 'pdv.caixa.exit',
      'cash.shipment': 'pdv.caixa.shipment',
    };
    action = actionByType[event.type];
    const payments = await hydratePayments([{
      paymentMethodId: source.paymentMethodId,
      amount: source.amount,
      label: source.paymentLabel,
    }]);
    payload = {
      amount: Number(source.amount || 0),
      paymentId: String(source.paymentMethodId || ''),
      payments,
      reason: source.reason || '',
      timestamp: source.createdAt || event.occurredAt,
    };
  } else if (event.type === 'cash.closed') {
    action = 'pdv.caixa.close';
    payload = {
      payments: await hydratePayments(source.countedPayments || []),
      reason: source.reason || '',
      timestamp: source.closedAt || event.occurredAt,
    };
  } else if (event.type === 'budget.saved') {
    action = 'pdv.budget.save';
    payload = {
      id: source.id || source.budgetId,
      code: source.budgetCode || source.code,
      createdAt: source.createdAt || event.occurredAt,
      updatedAt: source.updatedAt || event.occurredAt,
      validUntil: source.validUntil || null,
      validityDays: Number(source.validityDays || 15),
      status: source.status === 'finalized' ? 'finalizado' : 'aberto',
      customer: source.customerId ? {
        id: source.customerId,
        nome: source.customerName || '',
        documento: source.customerDocument || '',
      } : null,
      customerName: source.customerName || 'Consumidor final',
      pet: source.petId ? { id: source.petId, nome: source.petName || '' } : null,
      seller: source.sellerId ? {
        id: source.sellerId,
        codigo: source.sellerCode || '',
        nome: source.sellerName || '',
      } : null,
      items: await hydrateSaleItems(source.items || []),
      total: Number(source.netTotal ?? source.total ?? 0),
      discount: Number(source.discountTotal || 0),
      addition: Number(source.additionTotal || 0),
    };
  } else if (event.type === 'budget.finalized') {
    action = 'pdv.budget.finalize';
    payload = {
      budgetId: source.budgetId || source.id,
      saleId: source.saleId || source.finalizedSaleId || '',
      finalizedAt: source.finalizedAt || event.occurredAt,
    };
  } else if (event.type === 'sale.cancelled') {
    action = 'pdv.sale.cancel';
    payload = {
      saleId: source.saleId || source.id || '',
      saleCode: source.saleCode || '',
      reason: source.reason || source.cancellationReason || '',
      cancellationAt: source.cancellationAt || event.occurredAt,
    };
  } else if (event.type === 'receivable.received') {
    action = 'pdv.caixa.client_receipt';
    const payments = await hydratePayments([{
      paymentMethodId: source.paymentMethodId,
      amount: source.amount,
      label: source.paymentLabel,
    }]);
    payload = {
      payments,
      total: Number(source.amount || 0),
      customerName: source.customerName || '',
      reason: source.notes || `Recebimento da venda ${source.saleCode || ''}`,
      timestamp: source.paidAt || event.occurredAt,
    };
  } else if (event.type === 'delivery.status.updated') {
    action = 'pdv.delivery.update_status';
    payload = {
      orderId: source.orderId || source.deliveryOrderId || source.id,
      status: source.status,
      updatedAt: source.updatedAt || event.occurredAt,
    };
  } else if (event.type === 'delivery.courier.updated') {
    action = 'pdv.delivery.update_courier';
    payload = {
      orderId: source.orderId || source.deliveryOrderId || source.id,
      courier: source.courier || { id: source.courierId || '', label: source.courierName || '' },
      updatedAt: source.updatedAt || event.occurredAt,
    };
  } else if (event.type === 'delivery.registered') {
    action = 'pdv.delivery.register';
    payload = {
      orderId: source.orderId || source.deliveryOrderId || source.id,
      saleId: source.saleRecordId || source.saleId || '',
      saleRecordId: source.saleRecordId || source.saleId || '',
      saleCode: source.saleCode,
      createdAt: source.createdAt || event.occurredAt,
      customer: source.customer || (source.customerId ? { id: source.customerId, nome: source.customerName || '', documento: source.customerDocument || '' } : null),
      customerName: source.customerName || '',
      customerDocument: source.customerDocument || '',
      items: await hydrateSaleItems(source.items || []),
      payments: await hydratePayments(source.payments || []),
      totalBruto: Number(source.grossTotal ?? source.totalBruto ?? 0),
      totalLiquido: Number(source.netTotal ?? source.totalLiquido ?? 0),
      discountValue: Number(source.discountTotal || 0),
      additionValue: Number(source.additionTotal || 0),
      address: source.address || null,
      courier: source.courier || { id: source.courierId || '', label: source.courierName || '' },
      status: 'registrado',
    };
  } else if (event.type === 'delivery.finalized') {
    action = 'pdv.delivery.finalize';
    const payments = await hydratePayments(source.payments || []);
    payload = {
      orderId: source.orderId || source.deliveryOrderId,
      saleId: source.id,
      saleRecordId: source.saleRecordId || '',
      saleCode: source.saleCode,
      createdAt: source.createdAt || event.occurredAt,
      customer: source.customer || (source.customerId ? { id: source.customerId, nome: source.customerName || '', documento: source.customerDocument || '' } : null),
      customerName: source.customerName || '',
      customerDocument: source.customerDocument || '',
      items: await hydrateSaleItems(source.items || []),
      payments,
      totalBruto: Number(source.grossTotal ?? source.totalBruto ?? 0),
      totalLiquido: Number(source.netTotal ?? source.totalLiquido ?? 0),
      discountValue: Number(source.discountTotal || 0) + Number(source.itemDiscountTotal || 0),
      additionValue: Number(source.additionTotal || 0) + Number(source.itemAdditionTotal || 0),
      receivables: source.receivables || [],
      address: source.address || null,
      courier: source.courier || { id: source.courierId || '', label: source.courierName || '' },
      status: 'finalizado',
    };
  } else {
    action = 'pdv.sale.finalize';
    const payments = await hydratePayments(source.payments || []);
    payload = {
      saleId: source.id,
      saleCode: source.saleCode,
      createdAt: source.createdAt || event.occurredAt,
      customerId: source.customerId || '',
      customerName: source.customerName || '',
      customerDocument: source.customerDocument || '',
      petId: source.petId || '',
      petName: source.petName || '',
      appointmentId: clean(source.appointmentId || ''),
      appointmentIds: Array.from(new Set((Array.isArray(source.appointmentIds) ? source.appointmentIds : [source.appointmentId]).map(clean).filter(Boolean))),
      sellerId: source.sellerId || '',
      sellerCode: source.sellerCode || '',
      sellerName: source.sellerName || '',
      items: await hydrateSaleItems(source.items || []),
      payments,
      totalBruto: Number(source.grossTotal ?? source.totalBruto ?? 0),
      totalLiquido: Number(source.netTotal ?? source.totalLiquido ?? 0),
      discountValue: Number(source.discountTotal || 0) + Number(source.itemDiscountTotal || 0),
      additionValue: Number(source.additionTotal || 0) + Number(source.itemAdditionTotal || 0),
      promotionDiscountTotal: Number(source.promotionDiscountTotal || 0),
      itemDiscountTotal: Number(source.itemDiscountTotal || 0),
      itemAdditionTotal: Number(source.itemAdditionTotal || 0),
      receivables: (Array.isArray(source.receivables) ? source.receivables : []).map((entry) => ({
        id: entry.id,
        saleId: source.id,
        saleCode: source.saleCode,
        parcelNumber: Number(entry.installmentNumber || 1),
        installmentNumber: Number(entry.installmentNumber || 1),
        value: Number(entry.originalAmount || 0),
        originalValue: Number(entry.originalAmount || 0),
        dueDate: entry.dueDate,
        paymentMethodId: entry.paymentMethodId || '',
        crediarioMethodId: entry.paymentMethodId || '',
        clienteId: entry.customerId || source.customerId || '',
        clienteNome: entry.customerName || source.customerName || '',
        status: 'open',
        origin: 'desktop-sale',
        locked: true,
      })),
    };
  }
  await pdvDomain.enqueuePdvStateWrite(String(pdv._id), () => pdvDomain.runPdvCommand({
    action,
    payload,
    pdvId: String(pdv._id),
    pdvDoc: pdv,
    idempotencyKey: event.eventId,
    correlationId: event.eventId,
    user: desktopEventActor(source, host),
  }), { action, requestId: event.eventId, idempotencyKey: event.eventId });
  if (['sale.completed', 'delivery.finalized'].includes(event.type)) {
    await syncDesktopSaleReceivables(source, pdv, host);
    const appointmentIds = Array.from(new Set(
      (Array.isArray(source.appointmentIds) ? source.appointmentIds : [source.appointmentId])
        .map(clean).filter(mongoose.Types.ObjectId.isValid)
    ));
    if (appointmentIds.length) {
      await Appointment.updateMany(
        { _id: { $in: appointmentIds }, store: host.empresa },
        { $set: { pago: true, codigoVenda: source.saleCode || '', status: 'finalizado' } }
      );
    }
  }
  if (event.type === 'sale.cancelled') {
    const appointmentIds = Array.from(new Set(
      (Array.isArray(source.appointmentIds) ? source.appointmentIds : [source.appointmentId])
        .map(clean).filter(mongoose.Types.ObjectId.isValid)
    ));
    if (appointmentIds.length) {
      await Appointment.updateMany(
        { _id: { $in: appointmentIds }, store: host.empresa, codigoVenda: source.saleCode || '' },
        { $set: { pago: false, codigoVenda: '', status: 'em_atendimento' } }
      );
    }
  }
  if (event.type === 'receivable.received' && source.saleId && source.receivableId) {
    const state = await PdvState.findOne({ pdv: pdv._id }).lean();
    const sale = (state?.completedSales || []).find((entry) => clean(entry?.id || entry?._id) === clean(source.saleId));
    if (sale) {
      const receivables = (Array.isArray(sale.receivables) ? sale.receivables : []).map((entry) => {
        if (clean(entry?.id) !== clean(source.receivableId)) return entry;
        const original = Number(entry.originalValue ?? entry.value ?? 0);
        const remaining = Math.max(0, Number(source.remainingAmount || 0));
        return {
          ...entry,
          originalValue: original,
          value: remaining,
          paidValue: Math.max(0, original - remaining),
          status: source.status === 'paid' ? 'finalized' : 'partial',
          paidDate: source.paidAt || event.occurredAt,
        };
      });
      await pdvDomain.enqueuePdvStateWrite(String(pdv._id), () => pdvDomain.runPdvCommand({
        action: 'pdv.sale.sync_receivables',
        payload: { saleId: source.saleId, receivables },
        pdvId: String(pdv._id), pdvDoc: pdv,
        idempotencyKey: `${event.eventId}:receivable`, correlationId: event.eventId,
        user: desktopEventActor(source, host),
      }), { action: 'pdv.sale.sync_receivables', requestId: event.eventId, idempotencyKey: `${event.eventId}:receivable` });
    }
    await syncDesktopReceivablePayment(source, pdv, event.eventId);
  }
  if (['sale.completed', 'sale.cancelled', 'receivable.received', 'budget.saved', 'budget.finalized', 'delivery.registered', 'delivery.status.updated', 'delivery.courier.updated', 'delivery.finalized'].includes(event.type)) {
    const updatedState = await PdvState.findOne({ pdv: pdv._id });
    if (updatedState) {
      await pdvDomain.syncPdvStateNormalizedMirror({ pdvDoc: pdv, updatedState });
    }
  }
  return true;
}

async function authenticateHost(req, res, next) {
  try {
    const token = clean(req.get('x-desktop-token') || req.get('authorization')).replace(/^Bearer\s+/i, '');
    if (!token) return res.status(401).json({ message: 'Token do servidor local não informado.' });
    const host = await PdvDesktopHost.findOne({ tokenHash: hash(token), status: 'active' });
    if (!host) return res.status(401).json({ message: 'Servidor local não autorizado.' });
    req.desktopHost = host;
    return next();
  } catch (error) {
    return next(error);
  }
}

function getWebRoomCount(req, pdvId) {
  const io = req.app?.get?.('socketio');
  return Number(io?.sockets?.adapter?.rooms?.get(`pdv:${pdvId}`)?.size || 0);
}

async function buildChecklist(req, pdv) {
  const [state, activeHost, paymentCount, pendingEvents, conflictingSeries] = await Promise.all([
    PdvState.findOne({ pdv: pdv._id }).lean(),
    PdvDesktopHost.findOne({ pdv: pdv._id, status: 'active' }).lean(),
    PaymentMethod.countDocuments({ company: pdv.empresa }),
    PdvDesktopEvent.countDocuments({ pdv: pdv._id, status: { $in: ['accepted', 'failed'] } }),
    pdv.serieNfce
      ? Pdv.countDocuments({
          _id: { $ne: pdv._id },
          empresa: pdv.empresa,
          ativo: true,
          serieNfce: pdv.serieNfce,
        })
      : Promise.resolve(0),
  ]);
  const fiscalMode = pdv.configuracoesFiscal?.tipoEmissaoPadrao === 'fiscal';
  const checks = [
    { key: 'cash_closed', ok: !state?.caixaAberto, message: 'O caixa precisa estar fechado.' },
    { key: 'no_web_session', ok: getWebRoomCount(req, String(pdv._id)) === 0, message: 'Existe uma sessão Web conectada ao PDV.' },
    { key: 'no_pending_events', ok: pendingEvents === 0, message: 'Existem alterações pendentes.' },
    { key: 'sequences_ready', ok: Number(state?.saleCodeSequence || 1) > 0 && Number(state?.budgetSequence || 1) > 0, message: 'As sequências não foram identificadas.' },
    { key: 'exclusive_fiscal_series', ok: !fiscalMode || (Boolean(clean(pdv.serieNfce)) && conflictingSeries === 0), message: 'A série NFC-e precisa ser exclusiva.' },
    { key: 'inventory_configured', ok: Boolean(pdv.configuracoesEstoque?.depositoPadrao), message: 'Configure o depósito padrão.' },
    { key: 'financial_configured', ok: Boolean(pdv.configuracoesFinanceiro?.contaCorrente) && Boolean(pdv.configuracoesFinanceiro?.contaContabilReceber), message: 'Configure a conta corrente e a conta contábil de recebimento.' },
    { key: 'payment_methods', ok: paymentCount > 0, message: 'Cadastre ao menos um meio de pagamento.' },
    { key: 'host_paired', ok: Boolean(activeHost), message: 'Pareie a máquina principal.' },
    { key: 'local_db_ready', ok: Boolean(activeHost?.localDbReady && activeHost?.initialSyncCompletedAt), message: 'Conclua o banco e a sincronização inicial.' },
  ];
  return { ok: checks.every((item) => item.ok), checks, state, activeHost };
}

router.get('/pdvs/available', ...adminOnly, async (req, res) => {
  const query = { ativo: true, tipoUso: 'executavel' };
  if (mongoose.Types.ObjectId.isValid(req.query?.empresa)) query.empresa = req.query.empresa;
  const pdvs = await Pdv.find(query).sort({ nome: 1 }).lean();
  return res.json({ pdvs });
});

router.post('/pdvs/:id/pairing-code', ...adminOnly, async (req, res) => {
  const pdv = await Pdv.findById(req.params.id);
  if (!pdv) return res.status(404).json({ message: 'PDV não encontrado.' });
  const pairingCode = crypto.randomBytes(4).toString('hex').toUpperCase();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
  const host = await PdvDesktopHost.findOneAndUpdate(
    { pdv: pdv._id, status: { $ne: 'revoked' } },
    {
      $set: { empresa: pdv.empresa, pairingCodeHash: hash(pairingCode), pairingExpiresAt: expiresAt },
      $setOnInsert: { pdv: pdv._id, status: 'pending' },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  if (!(pdv.tipoUso === 'executavel' && pdv.desktop?.status === 'ativo')) {
    pdv.desktop.status = 'configurando';
  }
  pdv.desktop.hostId = host._id;
  await pdv.save();
  return res.json({ pairingCode, expiresAt, pdv: { id: pdv._id, codigo: pdv.codigo, nome: pdv.nome } });
});

router.post('/pair', async (req, res) => {
  const pairingCode = clean(req.body?.pairingCode).toUpperCase();
  const machineId = clean(req.body?.machineId);
  const name = clean(req.body?.name);
  if (!pairingCode || !machineId) return res.status(400).json({ message: 'Informe código e identificador da máquina.' });
  const host = await PdvDesktopHost.findOne({ pairingCodeHash: hash(pairingCode), pairingExpiresAt: { $gt: new Date() }, status: { $in: ['pending', 'active'] } });
  if (!host) return res.status(404).json({ message: 'Código de pareamento inválido ou expirado.' });
  const token = crypto.randomBytes(32).toString('hex');
  host.machineId = machineId;
  host.name = name || machineId;
  host.status = 'active';
  host.tokenHash = hash(token);
  host.pairingCodeHash = '';
  host.pairingExpiresAt = null;
  host.lastHeartbeatAt = new Date();
  await host.save();
  const pairedPdv = await Pdv.findById(host.pdv).select('tipoUso desktop.status').lean();
  const operationalStatus = pairedPdv?.tipoUso === 'executavel' && pairedPdv?.desktop?.status === 'ativo'
    ? 'ativo'
    : 'configurando';
  await Pdv.updateOne({ _id: host.pdv }, {
    $set: {
      'desktop.hostId': host._id,
      'desktop.hostName': host.name,
      'desktop.hostMachineId': host.machineId,
      'desktop.lastHeartbeatAt': host.lastHeartbeatAt,
      'desktop.status': operationalStatus,
    },
  });
  return res.json({ token, hostId: host._id, pdvId: host.pdv });
});

router.post('/heartbeat', authenticateHost, async (req, res) => {
  const host = req.desktopHost;
  host.lastHeartbeatAt = new Date();
  host.localDbReady = Boolean(req.body?.localDbReady);
  host.appVersion = clean(req.body?.appVersion);
  host.pendingEvents = Math.max(0, Number(req.body?.pendingEvents || 0));
  host.pendingFiscal = Math.max(0, Number(req.body?.pendingFiscal || 0));
  if (req.body?.initialSyncCompleted && !host.initialSyncCompletedAt) host.initialSyncCompletedAt = new Date();
  await host.save();
  await Pdv.updateOne({ _id: host.pdv }, { $set: {
    'desktop.lastHeartbeatAt': host.lastHeartbeatAt,
    'desktop.localDbReady': host.localDbReady,
    'desktop.initialSyncCompletedAt': host.initialSyncCompletedAt,
    'desktop.pendingEvents': host.pendingEvents,
    'desktop.pendingFiscal': host.pendingFiscal,
  } });
  return res.json({ ok: true, serverTime: new Date().toISOString() });
});

router.post('/operator-login', authenticateHost, async (req, res) => {
  const identifier = clean(req.body?.identifier);
  const password = String(req.body?.password || '');
  const query = desktopOperatorIdentifierQuery(identifier);
  if (!query || !password) return res.status(400).json({ message: 'Informe usuário e senha.' });

  const user = await User.findOne(query).select('_id email senha role grupos nomeCompleto nomeContato razaoSocial cpf cnpj empresaPrincipal empresaContratual empresas situacao dataDemissao').lean();
  if (!user || !(await bcrypt.compare(password, user.senha))) return res.status(400).json({ message: 'Usuário ou senha inválidos.' });
  if (!desktopOperatorIsActive(user)) return res.status(403).json({ message: 'Funcionário bloqueado, desligado ou sem acesso ao PDV.' });
  if (!desktopOperatorCanAccessCompany(user, req.desktopHost.empresa)) return res.status(403).json({ message: 'Este funcionário não possui acesso à empresa deste PDV.' });

  return res.json({
    operator: {
      id: String(user._id),
      name: userName(user),
      email: clean(user.email).toLowerCase(),
      role: clean(user.role),
      groups: Array.isArray(user.grupos) ? user.grupos.map(clean).filter(Boolean) : [],
      identifiers: [identifier, user.email, user.cpf, user.cnpj].map(clean).filter(Boolean),
    },
  });
});

router.post('/operator-statuses', authenticateHost, async (req, res) => {
  const ids = [...new Set((Array.isArray(req.body?.ids) ? req.body.ids : []).map(clean).filter((id) => mongoose.Types.ObjectId.isValid(id)))].slice(0, 500);
  if (!ids.length) return res.json({ statuses: [] });
  const users = await User.find({ _id: { $in: ids } }).select('_id role empresaPrincipal empresaContratual empresas situacao dataDemissao').lean();
  const byId = new Map(users.map((user) => [String(user._id), user]));
  return res.json({ statuses: ids.map((id) => {
    const user = byId.get(id);
    return { id, active: Boolean(user && desktopOperatorIsActive(user) && desktopOperatorCanAccessCompany(user, req.desktopHost.empresa)) };
  }) });
});

router.get('/bootstrap', authenticateHost, async (req, res) => {
  const host = req.desktopHost;
  const [pdv, state, paymentMethods] = await Promise.all([
    Pdv.findById(host.pdv).populate('empresa').lean(),
    PdvState.findOne({ pdv: host.pdv }).lean(),
    PaymentMethod.find({ company: host.empresa }).sort({ name: 1 }).lean(),
  ]);
  if (!pdv || !['web', 'executavel'].includes(pdv.tipoUso) || pdv.desktop?.status === 'suspenso') {
    return res.status(409).json({ message: 'PDV não está disponível para preparação do Executável.' });
  }
  return res.json({ version: 1, generatedAt: new Date().toISOString(), pdv, state: state || null, paymentMethods, updateFeedUrl: clean(process.env.PDV_DESKTOP_UPDATE_URL) });
});

router.get('/catalog/products', authenticateHost, async (req, res) => {
  const host = req.desktopHost;
  const pdv = await Pdv.findById(host.pdv).select('empresa configuracoesEstoque desktop tipoUso').lean();
  if (!pdv || pdv.desktop?.status === 'suspenso') return res.status(409).json({ message: 'PDV não disponível.' });
  const limit = Math.min(Math.max(Number(req.query?.limit || 500), 50), 1000);
  const cursor = decodeCursor(req.query?.cursor);
  if (req.query?.cursor && !cursor) return res.status(400).json({ message: 'Cursor de produtos inválido.' });
  const query = cursor
    ? { $or: [{ updatedAt: { $gt: cursor.updatedAt } }, { updatedAt: cursor.updatedAt, _id: { $gt: cursor.id } }] }
    : {};
  const [documents, rules] = await Promise.all([Product.find(query)
    .select('_id cod codbarras codigosComplementares nome descricao venda unidade stock estoques inativo precoClube promocao promocaoCondicional fracionado ncm fiscal fiscalPorEmpresa updatedAt')
    .sort({ updatedAt: 1, _id: 1 })
    .limit(limit + 1)
    .lean(), FiscalDefaultRule.find({ empresa: pdv.empresa }).select('code fiscal').lean()]);
  const hasMore = documents.length > limit;
  const page = hasMore ? documents.slice(0, limit) : documents;
  const last = page[page.length - 1];
  const empresaId = String(pdv.empresa);
  const fiscalRules = new Map(rules.map((rule) => [String(rule.code), rule.fiscal || {}]));
  return res.json({
    products: page.map((product) => productForDesktop(product, pdv, empresaId, fiscalRules)),
    nextCursor: hasMore && last ? encodeCursor({ id: String(last._id), updatedAt: last.updatedAt }) : null,
    syncCursor: last
      ? encodeCursor({ id: String(last._id), updatedAt: last.updatedAt })
      : (req.query?.cursor || null),
  });
});

router.get('/directory/snapshot', authenticateHost, async (req, res) => {
  const host = req.desktopHost;
  const users = await User.find({
    $or: [
      { empresaPrincipal: host.empresa },
      { empresaContratual: host.empresa },
      { empresas: host.empresa },
    ],
  })
    .select('_id codigoCliente nomeCompleto nomeContato razaoSocial email cpf cnpj inscricaoEstadual celular telefone celularSecundario telefoneSecundario tipoConta genero dataNascimento criadoEm observacao observacoes role grupos empresas empresaPrincipal empresaContratual limiteCredito valorPendente')
    .limit(50000)
    .lean();
  const userIds = users.map((user) => user._id);
  const [pets, addresses, stores, deposits] = await Promise.all([
    Pet.find({ owner: { $in: userIds }, obito: { $ne: true } })
      .select('_id owner codigoPet codAntigoPet nome tipo raca porte sexo dataNascimento microchip pelagemCor rga peso castrado updatedAt')
      .lean(),
    UserAddress.find({ user: { $in: userIds } })
      .select('_id user apelido cep logradouro numero complemento bairro cidade uf isDefault updatedAt')
      .sort({ isDefault: -1, updatedAt: -1, _id: -1 })
      .lean(),
    Store.find({ _id: host.empresa }).select('_id codigo nome nomeFantasia uf').lean(),
    Deposit.find({ empresa: host.empresa }).select('_id codigo nome empresa').sort({ nome: 1 }).lean(),
  ]);
  const addressByUser = new Map();
  const companyState = clean(stores[0]?.uf).toUpperCase();
  addresses.forEach((address) => {
    const userId = String(address.user || '');
    if (!userId || addressByUser.has(userId)) return;
    addressByUser.set(userId, {
      id: String(address._id),
      label: address.apelido || '',
      zipCode: address.cep || '',
      street: address.logradouro || '',
      number: address.numero || '',
      complement: address.complemento || '',
      district: address.bairro || '',
      city: address.cidade || '',
      state: address.uf || companyState || '',
    });
  });
  const nameOf = (user) => clean(user.nomeCompleto || user.nomeContato || user.razaoSocial || user.email);
  const customers = users.map((user) => ({
    id: String(user._id),
    code: user.codigoCliente ? String(user.codigoCliente) : '',
    name: nameOf(user),
    document: user.cpf || user.cnpj || user.inscricaoEstadual || '',
    email: user.email || '',
    phone: user.celular || user.telefone || '',
    secondaryPhone: user.celularSecundario || user.telefoneSecundario || '',
    phones: [user.telefone, user.telefoneSecundario, user.celular, user.celularSecundario].map(clean).filter(Boolean),
    telephone: user.telefone || '',
    secondaryTelephone: user.telefoneSecundario || '',
    mobile: user.celular || '',
    secondaryMobile: user.celularSecundario || '',
    accountType: user.tipoConta || '',
    gender: user.genero || '',
    birthDate: user.dataNascimento || null,
    customerSince: user.criadoEm || null,
    notes: user.observacao || user.observacoes || '',
    creditLimit: Number(user.limiteCredito || 0),
    pendingAmount: Number(user.valorPendente || 0),
    address: addressByUser.get(String(user._id)) || null,
  }));
  const companyId = String(host.empresa || '');
  const sellers = users.filter((user) => {
    if (!Array.isArray(user.grupos) || !user.grupos.includes('vendedor')) return false;
    const companies = [user.empresaPrincipal, user.empresaContratual, ...(Array.isArray(user.empresas) ? user.empresas : [])]
      .filter(Boolean).map(String);
    return companies.includes(companyId);
  }).map((user) => ({
    id: String(user._id),
    code: user.codigoCliente ? String(user.codigoCliente) : '',
    name: nameOf(user),
    document: user.cpf || user.cnpj || '',
  }));
  const couriers = users.filter((user) => {
    if (!Array.isArray(user.grupos) || !user.grupos.some((group) => ['entregador', 'gerente'].includes(group))) return false;
    const companies = [user.empresaPrincipal, user.empresaContratual, ...(Array.isArray(user.empresas) ? user.empresas : [])]
      .filter(Boolean).map(String);
    return companies.includes(companyId);
  }).map((user) => ({
    id: String(user._id),
    code: user.codigoCliente ? String(user.codigoCliente) : '',
    name: nameOf(user),
    document: user.cpf || user.cnpj || '',
  }));
  return res.json({
    version: 1,
    generatedAt: new Date().toISOString(),
    customers,
    pets: pets.map((pet) => ({
      id: String(pet._id), ownerId: String(pet.owner), code: pet.codigoPet ? String(pet.codigoPet) : '', legacyCode: pet.codAntigoPet || '',
      name: pet.nome || '', species: pet.tipo || '', breed: pet.raca || '', size: pet.porte || '', sex: pet.sexo || '', birthDate: pet.dataNascimento || null,
      microchip: pet.microchip || '', color: pet.pelagemCor || '', rga: pet.rga || '', weight: pet.peso || '', neutered: Boolean(pet.castrado),
    })),
    sellers,
    couriers,
    stores: stores.map((store) => ({ id: String(store._id), code: store.codigo || '', name: store.nomeFantasia || store.nome || '' })),
    deposits: deposits.map((deposit) => ({ id: String(deposit._id), code: deposit.codigo || '', name: deposit.nome || '', companyId: String(deposit.empresa) })),
    responsibles: users.map((user) => ({ id: String(user._id), code: user.codigoCliente ? String(user.codigoCliente) : '', name: nameOf(user) })).filter((entry) => entry.name),
  });
});

router.get('/customers/:customerId/sales-history', authenticateHost, async (req, res) => {
  const customerId = clean(req.params.customerId);
  if (!mongoose.Types.ObjectId.isValid(customerId)) {
    return res.status(400).json({ message: 'Identificador de cliente inválido.' });
  }
  const customer = await User.findOne({
    _id: customerId,
    $or: [
      { empresaPrincipal: req.desktopHost.empresa },
      { empresaContratual: req.desktopHost.empresa },
      { empresas: req.desktopHost.empresa },
    ],
  }).select('_id nomeCompleto nomeContato razaoSocial cpf cnpj').lean();
  if (!customer) return res.status(404).json({ message: 'Cliente não encontrado nesta empresa.' });

  const [normalized, states] = await Promise.all([
    PdvStateSale.find({
      empresa: req.desktopHost.empresa,
      $or: [
        { 'payload.customerId': customerId },
        { 'payload.customer.id': customerId },
        { 'payload.customer._id': customerId },
        { 'payload.snapshotCustomer.id': customerId },
        { 'payload.snapshotCustomer._id': customerId },
      ],
    }).sort({ createdAtFromEntity: -1, _id: -1 }).select('payload').lean(),
    PdvState.find({ empresa: req.desktopHost.empresa }).select('completedSales').lean(),
  ]);
  const normalizedSales = normalized.map((entry) => entry.payload).filter((sale) => desktopSaleCustomerMatches(sale, customer));
  const legacySales = states.flatMap((state) => Array.isArray(state.completedSales) ? state.completedSales : [])
    .filter((sale) => desktopSaleCustomerMatches(sale, customer));
  const sales = dedupeDesktopSales([...normalizedSales, ...legacySales]);
  return res.json({ sales, total: sales.length, allPdvs: true, allPeriods: true, generatedAt: new Date().toISOString() });
});

router.get('/address/cep', authenticateHost, async (req, res) => {
  const cep = clean(req.query.cep).replace(/\D/g, '');
  if (cep.length !== 8) return res.status(400).json({ message: 'Informe um CEP com 8 dígitos.' });
  try {
    const data = await fetchAddressJson(`https://viacep.com.br/ws/${encodeURIComponent(cep)}/json/`);
    if (data?.erro) return res.status(404).json({ message: 'CEP não encontrado.' });
    return res.json({ cep, logradouro: data.logradouro || '', bairro: data.bairro || '', cidade: data.localidade || '', uf: clean(data.uf).toUpperCase(), ibge: data.ibge || '' });
  } catch (error) { return res.status(502).json({ message: error.message || 'Não foi possível consultar o CEP.' }); }
});

router.get('/address/search', authenticateHost, async (req, res) => {
  const rawQuery = clean(req.query.q);
  if (rawQuery.length < 3) return res.json({ addresses: [] });
  const store = await Store.findById(req.desktopHost.empresa).select('municipio uf cep logradouro latitude longitude').lean();
  const expanded = expandStreetAbbreviation(rawQuery);
  const cacheKey = `${clean(store?._id)}|${normalizeSearchText(expanded)}`;
  const cached = addressLookupCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return res.json({ addresses: cached.addresses });
  const candidates = []; const city = clean(store?.municipio); const state = clean(store?.uf).toUpperCase();
  if (city && state) {
    try {
      const results = await fetchAddressJson(`https://viacep.com.br/ws/${encodeURIComponent(state)}/${encodeURIComponent(city)}/${encodeURIComponent(expanded)}/json/`);
      (Array.isArray(results) ? results : []).slice(0, 30).forEach((item) => candidates.push({
        cep: clean(item.cep).replace(/\D/g, ''), logradouro: item.logradouro || expanded, bairro: item.bairro || '', cidade: item.localidade || city,
        uf: clean(item.uf || state).toUpperCase(), ibge: item.ibge || '', lat: null, lon: null, source: 'ViaCEP', localRank: 0,
      }));
    } catch (_) {}
  }
  try {
    const parameters = new URLSearchParams({ format: 'jsonv2', addressdetails: '1', countrycodes: 'br', limit: '15', q: `${expanded}, Brasil` });
    if (Number.isFinite(Number(store?.latitude)) && Number.isFinite(Number(store?.longitude))) {
      const lat = Number(store.latitude); const lon = Number(store.longitude);
      parameters.set('viewbox', `${lon - 1},${lat + 1},${lon + 1},${lat - 1}`); parameters.set('bounded', '0');
    }
    const results = await fetchAddressJson(`https://nominatim.openstreetmap.org/search?${parameters}`, { 'User-Agent': 'EoBichoPDV/1.0 (address-search)' });
    (Array.isArray(results) ? results : []).forEach((item) => {
      const address = item.address || {}; const resultCity = address.city || address.town || address.municipality || address.village || '';
      const resultState = clean(address['ISO3166-2-lvl4'] || '').split('-').pop() || address.state_code || '';
      candidates.push({ cep: clean(address.postcode).replace(/\D/g, ''), logradouro: address.road || address.pedestrian || address.residential || item.name || expanded,
        bairro: address.suburb || address.neighbourhood || address.city_district || '', cidade: resultCity, uf: clean(resultState).toUpperCase(), ibge: '',
        lat: Number(item.lat), lon: Number(item.lon), source: 'OpenStreetMap', localRank: normalizeSearchText(resultCity) === normalizeSearchText(city) ? 0 : clean(resultState).toUpperCase() === state ? 1 : 2 });
    });
  } catch (_) {}
  const osmCandidates = candidates.filter((item) => item.source === 'OpenStreetMap' && Number.isFinite(item.lat) && Number.isFinite(item.lon));
  candidates.filter((item) => item.source === 'ViaCEP').forEach((item) => {
    const match = osmCandidates.find((candidate) => normalizeSearchText(candidate.logradouro) === normalizeSearchText(item.logradouro)
      && normalizeSearchText(candidate.cidade) === normalizeSearchText(item.cidade));
    if (match) { item.lat = match.lat; item.lon = match.lon; }
  });
  const origin = { lat: Number(store?.latitude), lon: Number(store?.longitude) }; const unique = new Map();
  candidates.forEach((item) => { const key = `${item.cep}|${normalizeSearchText(item.logradouro)}|${normalizeSearchText(item.cidade)}|${item.uf}`; if (!unique.has(key)) unique.set(key, { ...item, distanceKm: addressDistanceKm(origin, item), sourceRank: item.source === 'ViaCEP' ? 0 : 1 }); });
  const addresses = [...unique.values()].sort((a, b) => a.localRank - b.localRank || a.distanceKm - b.distanceKm || a.sourceRank - b.sourceRank || a.logradouro.localeCompare(b.logradouro, 'pt-BR')).slice(0, 15);
  addressLookupCache.set(cacheKey, { addresses, expiresAt: Date.now() + 10 * 60 * 1000 });
  return res.json({ addresses });
});

router.get('/appointments', authenticateHost, async (req, res) => {
  const start = new Date(req.query.start || Date.now() - 30 * 86400000);
  const end = new Date(req.query.end || Date.now() + 180 * 86400000);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    return res.status(400).json({ message: 'Período da agenda inválido.' });
  }
  if (end.getTime() - start.getTime() > 370 * 86400000) {
    return res.status(400).json({ message: 'Consulte no máximo 370 dias da agenda por sincronização.' });
  }
  const filter = { store: req.desktopHost.empresa, scheduledAt: { $gte: start, $lt: end } };
  const status = clean(req.query.status).toLowerCase();
  if (status && status !== 'all') filter.status = status;
  if (String(req.query.includePaid || '1') === '0') {
    filter.pago = { $ne: true };
    filter.codigoVenda = { $in: ['', null] };
  }
  const limit = Math.min(Math.max(Number(req.query.limit || 1000), 1), 1000);
  const appointments = await Appointment.find(filter)
    .sort({ scheduledAt: 1, _id: 1 })
    .limit(limit)
    .populate('cliente', 'nomeCompleto nomeContato razaoSocial email cpf cnpj celular telefone')
    .populate('pet', 'nome codigoPet')
    .populate('profissional', 'nomeCompleto nomeContato razaoSocial email')
    .populate('itens.servico', 'nome valor duracaoMinutos')
    .populate('itens.profissional', 'nomeCompleto nomeContato razaoSocial email')
    .lean();
  return res.json({ appointments: appointments.map(appointmentForDesktop), generatedAt: new Date().toISOString(), start, end });
});

router.get('/deliveries', authenticateHost, async (req, res) => {
  const state = await PdvState.findOne({ pdv: req.desktopHost.pdv }).select('deliveryOrders').lean();
  const deliveries = Array.isArray(state?.deliveryOrders) ? state.deliveryOrders : [];
  return res.json({ deliveries, generatedAt: new Date().toISOString() });
});

router.get('/transfers', authenticateHost, async (req, res) => {
  const transfers = await Transfer.find({ $or: [{ originCompany: req.desktopHost.empresa }, { destinationCompany: req.desktopHost.empresa }] })
    .sort({ requestDate: -1, _id: -1 }).limit(500)
    .populate('originCompany', 'nome nomeFantasia').populate('destinationCompany', 'nome nomeFantasia')
    .populate('originDeposit', 'nome codigo').populate('destinationDeposit', 'nome codigo')
    .populate('responsible', 'nomeCompleto nomeContato razaoSocial email').lean();
  return res.json({
    transfers: transfers.map((entry) => ({
      id: String(entry._id), desktopTransferId: entry.desktopTransferId || '', number: Number(entry.number), requestDate: entry.requestDate,
      status: entry.status, pdvId: clean(entry.desktopPdv),
      originCompanyId: clean(entry.originCompany?._id || entry.originCompany), originCompanyName: entry.originCompany?.nomeFantasia || entry.originCompany?.nome || '',
      originDepositId: clean(entry.originDeposit?._id || entry.originDeposit), originDepositName: entry.originDeposit?.nome || '',
      destinationCompanyId: clean(entry.destinationCompany?._id || entry.destinationCompany), destinationCompanyName: entry.destinationCompany?.nomeFantasia || entry.destinationCompany?.nome || '',
      destinationDepositId: clean(entry.destinationDeposit?._id || entry.destinationDeposit), destinationDepositName: entry.destinationDeposit?.nome || '',
      responsibleId: clean(entry.responsible?._id || entry.responsible), responsibleName: userName(entry.responsible),
      referenceDocument: entry.referenceDocument || '', observations: entry.observations || '',
      items: (entry.items || []).map((item) => ({ productId: clean(item.product), code: item.sku || '', barcode: item.barcode || '', name: item.description || '', quantity: Number(item.quantity || 0), unit: item.unit || 'UN' })),
      createdAt: entry.createdAt, updatedAt: entry.updatedAt,
    })), generatedAt: new Date().toISOString(),
  });
});

router.get('/reconciliation', authenticateHost, async (req, res) => {
  const summary = await PdvDesktopEvent.aggregate([
    { $match: { pdv: req.desktopHost.pdv, status: 'processed' } },
    { $group: { _id: '$type', count: { $sum: 1 }, lastProcessedAt: { $max: '$updatedAt' } } },
    { $sort: { _id: 1 } },
  ]);
  const byType = new Map(summary.map((entry) => [entry._id, Number(entry.count || 0)]));
  const completed = byType.get('sale.completed') || 0;
  const cancelled = byType.get('sale.cancelled') || 0;
  return res.json({
    completedSales: Math.max(0, completed - cancelled),
    completedEvents: completed,
    cancelledEvents: cancelled,
    events: summary.map((entry) => ({ type: entry._id, count: Number(entry.count || 0), lastProcessedAt: entry.lastProcessedAt || null })),
    generatedAt: new Date().toISOString(),
  });
});

router.post('/sales/:saleId/fiscal', authenticateHost, async (req, res) => {
  req.params.id = String(req.desktopHost.pdv);
  return pdvDomain.emitSaleFiscalHandler(req, res);
});

router.get('/fiscal/config', authenticateHost, async (req, res) => {
  const pdv = await Pdv.findById(req.desktopHost.pdv).lean();
  // O modo matricial emite NFC-e manualmente e precisa do mesmo pacote fiscal local.
  if (pdv?.configuracoesFiscal?.tipoEmissaoPadrao === 'matricial') pdv.configuracoesFiscal.tipoEmissaoPadrao = 'fiscal';
  if (!pdv || pdv.tipoUso !== 'executavel' || pdv.configuracoesFiscal?.tipoEmissaoPadrao !== 'fiscal') return res.status(409).json({ message: 'Este PDV não está configurado para emissão fiscal local.' });
  const store = await Store.findById(req.desktopHost.empresa).select('+certificadoArquivoCriptografado +certificadoSenhaCriptografada +cscTokenProducaoCriptografado +cscTokenHomologacaoCriptografado').lean();
  if (!store?.certificadoArquivoCriptografado || !store?.certificadoSenhaCriptografada) return res.status(409).json({ message: 'Certificado A1 não configurado para operação offline.' });
  const environment = pdv.ambientePadrao === 'producao' ? 'producao' : 'homologacao';
  const encryptedCsc = environment === 'producao' ? store.cscTokenProducaoCriptografado : store.cscTokenHomologacaoCriptografado;
  const cscId = environment === 'producao' ? store.cscIdProducao : store.cscIdHomologacao;
  if (!encryptedCsc || !cscId) return res.status(409).json({ message: 'CSC não configurado para o ambiente fiscal do PDV.' });
  return res.json({
    version: 1, environment, series: Number(pdv.serieNfce), generatedAt: new Date().toISOString(),
    certificateBase64: decryptBuffer(store.certificadoArquivoCriptografado).toString('base64'),
    certificatePassword: decryptText(store.certificadoSenhaCriptografada), cscId: String(cscId), cscToken: decryptText(encryptedCsc),
    store: {
      id: String(store._id), codigo: store.codigo || '', nome: store.nome || '', nomeFantasia: store.nomeFantasia || '', razaoSocial: store.razaoSocial || '',
      cnpj: store.cnpj || '', inscricaoEstadual: store.inscricaoEstadual || '', regimeTributario: store.regimeTributario || '',
      uf: store.uf || '', codigoUf: store.codigoUf || '', codigoIbgeMunicipio: store.codigoIbgeMunicipio || '', municipio: store.municipio || '',
      logradouro: store.logradouro || store.endereco || '', endereco: store.endereco || '', numero: store.numero || '', complemento: store.complemento || '', bairro: store.bairro || '', cep: store.cep || '',
    },
  });
});

router.post('/ranges/:kind/reserve', authenticateHost, async (req, res) => {
  const kind = clean(req.params.kind);
  if (!['sale', 'budget', 'nfce'].includes(kind)) return res.status(400).json({ message: 'Tipo de sequência inválido.' });
  const host = req.desktopHost;
  const pdv = await Pdv.findById(host.pdv).lean();
  if (!pdv || pdv.tipoUso !== 'executavel' || pdv.desktop?.status !== 'ativo') {
    return res.status(409).json({ message: 'PDV Executável não está ativo.' });
  }
  const size = Math.min(Math.max(Number(req.body?.size || pdv.desktop?.codeRangeSize || 10000), 100), 100000);
  if (kind === 'nfce') {
    const initial = Number.isInteger(pdv.numeroNfceInicial) && pdv.numeroNfceInicial > 0 ? pdv.numeroNfceInicial : 1;
    await Pdv.updateOne({ _id: pdv._id, numeroNfceAtual: null }, { $set: { numeroNfceAtual: initial - 1 } });
    const updatedPdv = await Pdv.findOneAndUpdate({ _id: pdv._id }, { $inc: { numeroNfceAtual: size } }, { new: true }).lean();
    const end = Number(updatedPdv.numeroNfceAtual); const start = end - size + 1;
    const range = await PdvCodeRange.create({ pdv: pdv._id, host: host._id, kind, start, end, next: start });
    return res.status(201).json({ rangeId: range._id, kind, start, end });
  }
  const field = kind === 'sale' ? 'saleCodeSequence' : 'budgetSequence';
  try {
    await PdvState.updateOne(
      { pdv: pdv._id },
      { $setOnInsert: { empresa: pdv.empresa, saleCodeSequence: 1, budgetSequence: 1 } },
      { upsert: true, setDefaultsOnInsert: true }
    );
  } catch (error) {
    if (error?.code !== 11000) throw error;
  }
  const updated = await PdvState.findOneAndUpdate(
    { pdv: pdv._id },
    { $inc: { [field]: size } },
    { new: true }
  ).lean();
  const end = Math.max(size, Number(updated?.[field] || size + 1) - 1);
  const start = end - size + 1;
  const range = await PdvCodeRange.create({ pdv: pdv._id, host: host._id, kind, start, end, next: start });
  return res.status(201).json({ rangeId: range._id, kind, start: range.start, end: range.end });
});

router.post('/events/batch', authenticateHost, async (req, res) => {
  const host = req.desktopHost;
  const pdv = await Pdv.findById(host.pdv);
  if (!pdv || pdv.tipoUso !== 'executavel' || pdv.desktop?.status !== 'ativo') {
    return res.status(409).json({ message: 'PDV Executável não está ativo para receber eventos.' });
  }
  const events = Array.isArray(req.body?.events) ? req.body.events.slice(0, 200) : [];
  if (!events.length) return res.status(400).json({ message: 'Informe ao menos um evento.' });
  const results = [];
  for (const event of events) {
    const eventId = clean(event?.eventId);
    const type = clean(event?.type);
    const occurredAt = new Date(event?.occurredAt || Date.now());
    if (!eventId || !type || Number.isNaN(occurredAt.getTime())) {
      results.push({ eventId, accepted: false, error: 'Evento inválido.' });
      continue;
    }
    try {
      let record;
      let replayed = false;
      try {
        record = await PdvDesktopEvent.findOne({ pdv: host.pdv, eventId });
        if (record) {
          replayed = true;
        } else {
          record = await PdvDesktopEvent.create({ pdv: host.pdv, empresa: host.empresa, host: host._id, eventId, type, occurredAt, payload: event?.payload || {} });
        }
      } catch (createError) {
        if (createError?.code !== 11000) throw createError;
        record = await PdvDesktopEvent.findOne({ pdv: host.pdv, eventId });
        replayed = true;
      }
      if (!record) throw new Error('Evento não foi localizado após o reenvio.');
      if (record.status !== 'processed') {
        const processed = await materializeDesktopEvent(record, pdv, host);
        if (processed) {
          record.status = 'processed';
          record.error = '';
          await record.save();
        }
      }
      results.push({ eventId, accepted: true, replayed, status: record.status });
    } catch (error) {
      await PdvDesktopEvent.updateOne({ pdv: host.pdv, eventId }, { $set: { status: 'failed', error: error?.message || 'Falha ao processar evento.' } }).catch(() => {});
      results.push({ eventId, accepted: false, error: error?.message || 'Falha ao registrar evento.' });
    }
  }
  return res.json({ results });
});

router.get('/pdvs/:id/conversion-check', ...adminOnly, async (req, res) => {
  const pdv = await Pdv.findById(req.params.id).lean();
  if (!pdv) return res.status(404).json({ message: 'PDV não encontrado.' });
  const checklist = await buildChecklist(req, pdv);
  return res.json({ ok: checklist.ok, checks: checklist.checks });
});

router.post('/pdvs/:id/convert', ...adminOnly, async (req, res) => {
  const pdv = await Pdv.findById(req.params.id);
  if (!pdv) return res.status(404).json({ message: 'PDV não encontrado.' });
  if (pdv.tipoUso === 'executavel' && pdv.desktop?.status === 'ativo') {
    return res.json({ ok: true, pdv, replayed: true });
  }
  const checklist = await buildChecklist(req, pdv.toObject());
  if (!checklist.ok) return res.status(409).json({ message: 'O PDV ainda não pode ser convertido.', checks: checklist.checks });
  const snapshot = pdv.toObject();
  const stateSnapshot = checklist.state || null;
  await PdvConversionBackup.create({ pdv: pdv._id, empresa: pdv.empresa, reason: 'convert', snapshot, stateSnapshot, createdBy: req.user?.email || req.user?.id || '', checksum: snapshotChecksum(snapshot, stateSnapshot) });
  const isNewDesktopActivation = pdv.tipoUso === 'executavel';
  pdv.tipoUso = 'executavel';
  pdv.modoTerminais = ['exclusivo', 'espelhado'].includes(req.body?.modoTerminais) ? req.body.modoTerminais : 'exclusivo';
  pdv.configuracoesFiscal.tipoEmissaoPadrao = req.body?.tipoEmissao === 'matricial' ? 'matricial' : 'fiscal';
  pdv.desktop.status = 'ativo';
  pdv.desktop.conversionAt = new Date();
  pdv.desktop.conversionBy = req.user?.email || req.user?.id || '';
  pdv.desktop.hostId = checklist.activeHost._id;
  await pdv.save();
  return res.json({ ok: true, pdv, activated: isNewDesktopActivation });
});

router.post('/pdvs/:id/copy-settings', ...adminOnly, async (req, res) => {
  const source = await Pdv.findById(req.params.id).lean();
  if (!source) return res.status(404).json({ message: 'PDV de origem não encontrado.' });
  const codigo = clean(req.body?.codigo);
  const nome = clean(req.body?.nome);
  if (!codigo || !nome) return res.status(400).json({ message: 'Informe o código e o nome do novo PDV.' });
  const duplicate = await Pdv.exists({ codigo });
  if (duplicate) return res.status(409).json({ message: 'Já existe um PDV com este código.' });
  const copy = await Pdv.create({
    codigo,
    nome,
    apelido: clean(req.body?.apelido) || nome,
    ativo: true,
    tipoUso: 'executavel',
    modoTerminais: source.modoTerminais || 'exclusivo',
    empresa: source.empresa,
    serieNfe: '',
    serieNfce: '',
    numeroNfeInicial: null,
    numeroNfceInicial: null,
    numeroNfeAtual: null,
    numeroNfceAtual: null,
    ambientesHabilitados: source.ambientesHabilitados,
    ambientePadrao: source.ambientePadrao,
    sincronizacaoAutomatica: source.sincronizacaoAutomatica,
    permitirModoOffline: true,
    mostrarParaFuncionarios: source.mostrarParaFuncionarios,
    limiteOffline: source.limiteOffline,
    observacoes: `Configurações copiadas do PDV ${source.codigo}.`,
    configuracoesImpressao: source.configuracoesImpressao,
    configuracoesVenda: source.configuracoesVenda,
    configuracoesFiscal: source.configuracoesFiscal,
    configuracoesEstoque: source.configuracoesEstoque,
    configuracoesFinanceiro: source.configuracoesFinanceiro,
    criadoPor: req.user?.email || req.user?.id || '',
    atualizadoPor: req.user?.email || req.user?.id || '',
    desktop: { status: 'configurando' },
  });
  return res.status(201).json({ ok: true, pdv: copy });
});

router.post('/pdvs/:id/revert', ...adminOnly, async (req, res) => {
  const pdv = await Pdv.findById(req.params.id);
  if (!pdv) return res.status(404).json({ message: 'PDV não encontrado.' });
  const [state, host, cloudPending] = await Promise.all([
    PdvState.findOne({ pdv: pdv._id }).lean(),
    PdvDesktopHost.findOne({ pdv: pdv._id, status: 'active' }),
    PdvDesktopEvent.countDocuments({ pdv: pdv._id, status: { $in: ['accepted', 'failed'] } }),
  ]);
  if (state?.caixaAberto || Number(host?.pendingEvents || 0) > 0 || Number(host?.pendingFiscal || 0) > 0 || cloudPending > 0) {
    return res.status(409).json({ message: 'Feche o caixa e zere as filas antes de reverter.' });
  }
  const snapshot = pdv.toObject();
  await PdvConversionBackup.create({ pdv: pdv._id, empresa: pdv.empresa, reason: 'revert', snapshot, stateSnapshot: state || null, createdBy: req.user?.email || req.user?.id || '', checksum: snapshotChecksum(snapshot, state || null) });
  if (host) { host.status = 'revoked'; host.tokenHash = ''; await host.save(); }
  await PdvCodeRange.updateMany({ pdv: pdv._id, status: 'active' }, { $set: { status: 'revoked' } });
  pdv.tipoUso = 'web';
  pdv.desktop.status = 'web';
  pdv.desktop.hostId = null;
  await pdv.save();
  return res.json({ ok: true, pdv });
});

module.exports = router;
