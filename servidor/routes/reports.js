const express = require('express');
const mongoose = require('mongoose');
const PdvState = require('../models/PdvState');
const Store = require('../models/Store');
const Pdv = require('../models/Pdv');
const PaymentMethod = require('../models/PaymentMethod');
const User = require('../models/User');
const requireAuth = require('../middlewares/requireAuth');
const authorizeRoles = require('../middlewares/authorizeRoles');

const router = express.Router();

const parseDate = (value, endOfDay = false) => {
  if (!value) return null;

  let date;

  if (typeof value === 'string') {
    const trimmed = value.trim();

    const isIsoDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(trimmed);
    const isBrDateOnly = /^\d{2}\/\d{2}\/\d{4}$/.test(trimmed);

    if (isIsoDateOnly) {
      const [year, month, day] = trimmed.split('-').map(Number);
      date = new Date(year, month - 1, day);
    } else if (isBrDateOnly) {
      const [day, month, year] = trimmed.split('/').map(Number);
      date = new Date(year, month - 1, day);
    } else {
      date = new Date(trimmed);
    }
  } else {
    date = new Date(value);
  }

  if (Number.isNaN(date.getTime())) return null;
  if (endOfDay) {
    date.setHours(23, 59, 59, 999);
  } else {
    date.setHours(0, 0, 0, 0);
  }
  return date;
};

const toObjectId = (value) => {
  if (!value || !mongoose.Types.ObjectId.isValid(value)) return null;
  return new mongoose.Types.ObjectId(value);
};

const normalizeStoreId = (value) => {
  if (!value) return '';
  const raw = typeof value === 'object' && value._id ? value._id : value;
  const str = String(raw || '').trim();
  return mongoose.Types.ObjectId.isValid(str) ? str : '';
};

const resolveUserStoreAccess = async (userId) => {
  if (!userId) return { allowedStoreIds: [], allowAllStores: false };
  const user = await User.findById(userId).select('empresaPrincipal empresas role').lean();
  if (!user) return { allowedStoreIds: [], allowAllStores: false };

  const markedCompanies = Array.isArray(user.empresas)
    ? user.empresas
        .map((id) => normalizeStoreId(id))
        .filter(Boolean)
    : [];

  if (markedCompanies.length > 0) {
    return { allowedStoreIds: Array.from(new Set(markedCompanies)), allowAllStores: false };
  }

  const primary = normalizeStoreId(user.empresaPrincipal);
  const allowedStoreIds = primary ? [primary] : [];
  const allowAllStores = false;

  return { allowedStoreIds, allowAllStores };
};

const monthLabels = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

const formatMonthLabel = (date) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  const month = monthLabels[date.getMonth()] || '';
  return `${month} ${date.getFullYear()}`.trim();
};

const parseMonthParam = (value) => {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim();
  const match = /^(\d{4})-(\d{2})$/.exec(trimmed);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return null;
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0, 23, 59, 59, 999);
  return { start, end, key: `${year}-${String(month).padStart(2, '0')}`, label: formatMonthLabel(start) };
};

const resolvePeriod = ({ month, start, end }, fallbackDate) => {
  const monthPeriod = parseMonthParam(month);
  if (monthPeriod) return monthPeriod;

  const startDate = parseDate(start);
  const endDate = parseDate(end, true);

  if (startDate || endDate) {
    const safeStart = startDate || new Date(endDate);
    const safeEnd = endDate || new Date(startDate);
    return {
      start: safeStart,
      end: safeEnd,
      key: '',
      label: `${safeStart.toLocaleDateString('pt-BR')} - ${safeEnd.toLocaleDateString('pt-BR')}`,
    };
  }

  const fallback = fallbackDate instanceof Date ? fallbackDate : new Date();
  const fallbackMonth = parseMonthParam(`${fallback.getFullYear()}-${String(fallback.getMonth() + 1).padStart(2, '0')}`);
  return fallbackMonth;
};

const resolveStoreByCompanyCode = async (companyCode) => {
  if (!companyCode) return null;
  const raw = String(companyCode || '').trim();
  if (!raw) return null;

  if (mongoose.Types.ObjectId.isValid(raw)) {
    return Store.findById(raw).lean();
  }

  const digits = raw.replace(/\D/g, '');
  const namePattern = new RegExp(`^${escapeRegex(raw)}$`, 'i');
  const numericCode = digits ? Number(digits) : null;
  const numericRegex = digits ? new RegExp(`^0*${digits}$`) : null;

  const store = await Store.findOne({
    $or: [
      { codigo: raw },
      { codigo: numericCode },
      ...(numericRegex ? [{ codigo: numericRegex }] : []),
      { code: raw },
      { code: numericCode },
      ...(numericRegex ? [{ code: numericRegex }] : []),
      { cnpj: raw },
      { cnpj: digits },
      { nomeFantasia: namePattern },
      { nome: namePattern },
    ],
  }).lean();

  if (store) return store;

  const pdvQuery = { $or: [{ codigo: raw }, { codigo: digits }] };
  if (numericRegex) {
    pdvQuery.$or.push({ codigo: numericRegex });
  }

  const pdv = await Pdv.findOne(pdvQuery)
    .select('empresa')
    .lean();

  if (!pdv?.empresa) return null;

  return Store.findById(pdv.empresa).lean();
};

const parseNumber = (value) => {
  if (typeof value === 'number') return value;

  if (typeof value === 'string') {
    const cleaned = value
      .replace(/\s+/g, '')
      .replace(/[^0-9,.-]/g, '')
      .replace(/\.(?=\d{3}(\D|$))/g, '')
      .replace(',', '.');

    const asNumber = Number(cleaned);
    return Number.isFinite(asNumber) ? asNumber : null;
  }

  return null;
};

const collectSaleItems = (sale = {}) => {
  const candidates = [
    sale.items,
    sale.receiptSnapshot?.items,
    sale.receiptSnapshot?.itens,
    sale.receiptSnapshot?.products,
    sale.receiptSnapshot?.produtos,
    sale.receiptSnapshot?.cart?.items,
    sale.receiptSnapshot?.cart?.itens,
    sale.receiptSnapshot?.cart?.products,
    sale.receiptSnapshot?.cart?.produtos,
    sale.itemsSnapshot,
    sale.itemsSnapshot?.items,
    sale.itemsSnapshot?.itens,
    sale.fiscalItemsSnapshot,
    sale.fiscalItemsSnapshot?.items,
    sale.fiscalItemsSnapshot?.itens,
  ];

  for (const entry of candidates) {
    if (!Array.isArray(entry) || !entry.length) continue;
    const filtered = entry.filter((item) => item && typeof item === 'object');
    if (filtered.length) return filtered;
  }

  return [];
};

const deriveItemQuantity = (item = {}) => {
  const candidates = [
    item.quantity,
    item.quantidade,
    item.qty,
    item.qtd,
    item.amount,
    item.quantityLabel,
  ];
  for (const candidate of candidates) {
    const parsed = parseNumber(candidate);
    if (parsed !== null) return parsed;
  }
  return 1;
};

const deriveItemUnitPrice = (item = {}) => {
  const candidates = [
    item.unitPrice,
    item.valorUnitario,
    item.precoUnitario,
    item.valor,
    item.preco,
    item.price,
    item.unit_value,
    item.unit,
    item.unitLabel,
    item.precoLabel,
    item.valorLabel,
  ];
  for (const candidate of candidates) {
    const parsed = parseNumber(candidate);
    if (parsed !== null) return parsed;
  }
  return null;
};

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const deriveItemTotal = (item = {}) => {
  const candidates = [
    item.totalPrice,
    item.subtotal,
    item.total,
    item.totalValue,
    item.valorTotal,
    item.precoTotal,
    item.totalLabel,
  ];
  for (const candidate of candidates) {
    const parsed = parseNumber(candidate);
    if (parsed !== null) return parsed;
  }
  const quantity = deriveItemQuantity(item) || 0;
  const unitPrice = deriveItemUnitPrice(item);
  return unitPrice !== null ? quantity * unitPrice : 0;
};

const deriveItemUnitCost = (item = {}) => {
  const candidates = [
    item.precoCusto,
    item.preco_custo,
    item.precoCustoUnitario,
    item.preco_custo_unitario,
    item.precoCustoValue,
    item.cost,
    item.costPrice,
    item.unitCost,
    item.custo,
    item.custoCalculado,
    item.custoUnitario,
    item.custo_unitario,
    item.custoMedio,
    item.custoReferencia,
    item.custo_referencia,
    item.costValue,
    item.productSnapshot?.precoCusto,
    item.productSnapshot?.precoCustoUnitario,
    item.produtoSnapshot?.precoCusto,
    item.produtoSnapshot?.precoCustoUnitario,
    item.product?.precoCusto,
    item.produto?.precoCusto,
    item.product?.precoCustoUnitario,
    item.produto?.precoCustoUnitario,
    item.productSnapshot?.custo,
    item.productSnapshot?.custoCalculado,
    item.productSnapshot?.custoMedio,
    item.productSnapshot?.custoReferencia,
    item.productSnapshot?.preco_custo,
    item.productSnapshot?.preco_custo_unitario,
    item.produtoSnapshot?.custo,
    item.produtoSnapshot?.custoCalculado,
    item.produtoSnapshot?.custoMedio,
    item.produtoSnapshot?.custoReferencia,
    item.produtoSnapshot?.preco_custo,
    item.produtoSnapshot?.preco_custo_unitario,
    item.product?.custo,
    item.produto?.custo,
    item.product?.custoCalculado,
    item.produto?.custoCalculado,
    item.product?.custoMedio,
    item.produto?.custoMedio,
    item.product?.custoReferencia,
    item.produto?.custoReferencia,
    item.product?.preco_custo,
    item.produto?.preco_custo,
    item.product?.preco_custo_unitario,
    item.produto?.preco_custo_unitario,
  ];
  for (const candidate of candidates) {
    const parsed = parseNumber(candidate);
    if (parsed !== null) return parsed;
  }
  return null;
};

const deriveItemTotalCost = (item = {}) => {
  const candidates = [
    item.precoCustoTotal,
    item.totalPrecoCusto,
    item.precoCustoValorTotal,
    item.totalCost,
    item.custoTotal,
    item.totalCusto,
    item.custoTotalCalculado,
    item.totalCostValue,
    item.productSnapshot?.precoCustoTotal,
    item.produtoSnapshot?.precoCustoTotal,
    item.productSnapshot?.custoTotal,
    item.productSnapshot?.totalCusto,
    item.productSnapshot?.custoTotalCalculado,
    item.produtoSnapshot?.custoTotal,
    item.produtoSnapshot?.totalCusto,
    item.produtoSnapshot?.custoTotalCalculado,
    item.product?.custoTotal,
    item.produto?.custoTotal,
  ];
  for (const candidate of candidates) {
    const parsed = parseNumber(candidate);
    if (parsed !== null) return parsed;
  }
  return null;
};

const deriveSaleCost = (sale = {}) => {
  const items = collectSaleItems(sale);
  if (!items.length) return null;

  let foundItemCost = false;

  const totalFromItems = items.reduce((acc, item) => {
    const itemTotalCost = deriveItemTotalCost(item);
    if (itemTotalCost !== null) {
      foundItemCost = true;
      return acc + itemTotalCost;
    }

    const quantity = deriveItemQuantity(item) || 0;
    const unitCost = deriveItemUnitCost(item);
    if (unitCost !== null) {
      foundItemCost = true;
      return acc + quantity * unitCost;
    }

    return acc;
  }, 0);

  if (foundItemCost) return totalFromItems;

  const totals = sale?.receiptSnapshot?.totais || sale?.totais || {};
  const candidates = [
    sale.cost,
    sale.totalCost,
    sale.custo,
    sale.custoTotal,
    sale.precoCustoTotal,
    sale.totalPrecoCusto,
    totals.custo,
    totals.custoTotal,
    totals.totalCusto,
    totals.precoCusto,
    totals.precoCustoTotal,
    totals.totalPrecoCusto,
  ];

  for (const candidate of candidates) {
    const parsed = parseNumber(candidate);
    if (parsed !== null) return parsed;
  }

  return null;
};

const deriveSaleTotal = (sale = {}) => {
  const totals = sale?.receiptSnapshot?.totais || sale?.totais || {};
  const candidates = [
    totals?.totalLiquido,
    totals?.liquido,
    totals?.total,
    totals?.totalGeral,
    totals?.pago,
    totals?.valorTotal,
    totals?.totalVenda,
    totals?.bruto,
    totals?.totalBruto,
    sale.totalLiquido,
    sale.totalBruto,
    sale.totalProdutos,
    sale.total,
    sale.totalAmount,
    sale.valorTotal,
    sale.totalVenda,
    sale.totalGeral,
  ];

  let zeroCandidate = null;

  for (const candidate of candidates) {
    const parsed = parseNumber(candidate);
    if (parsed === null) continue;
    if (parsed !== 0) return parsed;
    if (zeroCandidate === null) zeroCandidate = 0;
  }

  const items = collectSaleItems(sale);
  if (items.length) {
    const sum = items.reduce((acc, item) => acc + deriveItemTotal(item), 0);
    if (sum !== 0) return sum;
  }

  return zeroCandidate ?? 0;
};

const deriveSaleGross = (sale = {}) => {
  const totals = sale?.receiptSnapshot?.totais || sale?.totais || {};
  const candidates = [
    sale.totalBruto,
    sale.totalProdutos,
    totals.totalBruto,
    totals.bruto,
    totals.totalProdutos,
    totals.subtotal,
    totals.totalItens,
  ];

  let zeroCandidate = null;

  for (const candidate of candidates) {
    const parsed = parseNumber(candidate);
    if (parsed === null) continue;
    if (parsed !== 0) return parsed;
    if (zeroCandidate === null) zeroCandidate = 0;
  }

  const items = collectSaleItems(sale);
  if (items.length) {
    const sum = items.reduce((acc, item) => acc + deriveItemTotal(item), 0);
    if (sum !== 0) return sum;
  }

  return zeroCandidate ?? deriveSaleTotal(sale);
};

const deriveSaleNet = (sale = {}) => {
  const totals = sale?.receiptSnapshot?.totais || sale?.totais || {};
  const candidates = [
    sale.totalLiquido,
    totals.totalLiquido,
    totals.liquido,
    totals.total,
    totals.totalGeral,
    totals.pago,
    sale.total,
    sale.totalAmount,
    sale.valorTotal,
  ];

  let zeroCandidate = null;

  for (const candidate of candidates) {
    const parsed = parseNumber(candidate);
    if (parsed === null) continue;
    if (parsed !== 0) return parsed;
    if (zeroCandidate === null) zeroCandidate = 0;
  }

  return zeroCandidate ?? deriveSaleTotal(sale);
};

const deriveSaleDiscount = (sale = {}) => {
  const totals = sale?.receiptSnapshot?.totais || sale?.totais || {};
  const candidates = [
    sale.discountValue,
    sale.desconto,
    totals.discountValue,
    totals.descontoValor,
    totals.desconto,
    totals.discount,
  ];

  for (const candidate of candidates) {
    const parsed = parseNumber(candidate);
    if (parsed !== null) return parsed;
  }

  return 0;
};

const deriveSaleAddition = (sale = {}) => {
  const totals = sale?.receiptSnapshot?.totais || sale?.totais || {};
  const candidates = [
    sale.additionValue,
    sale.acrescimo,
    totals.additionValue,
    totals.acrescimoValor,
    totals.addition,
    totals.acrescimo,
  ];

  for (const candidate of candidates) {
    const parsed = parseNumber(candidate);
    if (parsed !== null) return parsed;
  }

  return 0;
};

const deriveSaleFee = (sale = {}) => {
  const computedFee = sale?.__feeFromPaymentMethods;
  if (Number.isFinite(computedFee)) return computedFee;
  const totals = sale?.receiptSnapshot?.totais || sale?.totais || {};
  const candidates = [
    sale.fee,
    sale.feeValue,
    sale.taxa,
    totals.fee,
    totals.feeValue,
    totals.taxa,
    totals.taxaValor,
  ];

  for (const candidate of candidates) {
    const parsed = parseNumber(candidate);
    if (parsed !== null) return parsed;
  }

  return 0;
};

const normalizeSaleStatus = (sale = {}) => {
  return String(sale.status || '').trim().toLowerCase();
};

const isCancelledSale = (sale = {}) => {
  const status = normalizeSaleStatus(sale);
  return ['cancelled', 'canceled', 'cancelado', 'refunded', 'estornado'].includes(status);
};

const deriveCustomerName = (sale = {}) => {
  return (
    normalizeName(sale.customerName) ||
    normalizeName(sale?.receiptSnapshot?.customer?.name) ||
    normalizeName(sale?.receiptSnapshot?.cliente?.nome) ||
    normalizeName(sale?.receiptSnapshot?.cliente?.name) ||
    'Cliente nao informado'
  );
};

const deriveCustomerKey = (sale = {}) => {
  const document =
    normalizeName(sale.customerDocument) ||
    normalizeName(sale?.receiptSnapshot?.customer?.document) ||
    normalizeName(sale?.receiptSnapshot?.cliente?.documento);
  const name = deriveCustomerName(sale);
  return document || name || 'Cliente nao informado';
};

const parsePaymentAmount = (payment = {}) => {
  const candidates = [
    payment.amount,
    payment.valor,
    payment.value,
    payment.total,
    payment.amountValue,
  ];
  for (const candidate of candidates) {
    const parsed = parseNumber(candidate);
    if (parsed !== null) return parsed;
  }
  return null;
};

const stripInstallmentSuffix = (label) => {
  if (typeof label !== 'string') return '';
  return label.replace(/\s*\(?\d+\s*x\)?\s*$/i, '').trim();
};

const extractInstallmentsFromLabel = (label) => {
  if (label === undefined || label === null) return null;
  const text = String(label);
  const match = text.match(/(\d{1,2})\s*x\b/i);
  if (match) {
    const parsed = Number.parseInt(match[1], 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }
  const altMatch = text.match(/(\d{1,2})\s*parcel/i);
  if (altMatch) {
    const parsed = Number.parseInt(altMatch[1], 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
};

const normalizeInstallments = (value) => {
  const parsed = parseNumber(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.max(1, Math.round(parsed));
};

const collectPaymentEntries = (sale = {}) => {
  const entries = [];
  const snapshotPayments = sale?.receiptSnapshot?.pagamentos || sale?.receiptSnapshot?.payments || [];
  const snapshotItems = Array.isArray(snapshotPayments)
    ? snapshotPayments
    : Array.isArray(snapshotPayments?.items)
    ? snapshotPayments.items
    : [];
  if (Array.isArray(snapshotItems)) {
    snapshotItems.forEach((payment) => {
      if (!payment || typeof payment !== 'object') return;
      const label =
        normalizeName(payment.label) ||
        normalizeName(payment.nome) ||
        normalizeName(payment.tipo) ||
        normalizeName(payment.method);
      if (!label) return;
      const paymentId = normalizeName(payment.paymentId || payment.id || payment.code);
      const paymentMethodId = normalizeName(payment.paymentMethodId || payment.methodId);
      const installments =
        normalizeInstallments(payment.parcelas ?? payment.installments ?? payment.parcela) ||
        extractInstallmentsFromLabel(label);
      entries.push({
        label,
        baseLabel: stripInstallmentSuffix(label),
        amount: parsePaymentAmount(payment),
        paymentId,
        paymentMethodId,
        installments,
      });
    });
  }

  const cashContributions = Array.isArray(sale.cashContributions) ? sale.cashContributions : [];
  cashContributions.forEach((entry) => {
    if (!entry || typeof entry !== 'object') return;
    const label = normalizeName(entry.paymentLabel || entry.label || entry.paymentId);
    if (!label) return;
    entries.push({
      label,
      baseLabel: stripInstallmentSuffix(label),
      amount: parsePaymentAmount(entry),
      paymentId: normalizeName(entry.paymentId || entry.id),
      paymentMethodId: normalizeName(entry.paymentMethodId || entry.methodId),
      installments: null,
    });
  });

  if (!entries.length) {
    const paymentTags = Array.isArray(sale.paymentTags) ? sale.paymentTags : [];
    paymentTags.forEach((tag) => {
      const label = normalizeName(tag);
      if (label) {
        entries.push({
          label,
          baseLabel: stripInstallmentSuffix(label),
          amount: null,
          installments: extractInstallmentsFromLabel(label),
        });
      }
    });
  }

  return entries;
};

const resolvePrimaryPaymentLabel = (sale = {}) => {
  const entries = collectPaymentEntries(sale);
  if (!entries.length) return 'Nao informado';
  const uniqueLabels = Array.from(new Set(entries.map((entry) => entry.label)));
  return uniqueLabels.join(' / ');
};

const deriveSaleMarkup = (totalValue, costValue) => {
  if (!Number.isFinite(totalValue)) return null;
  if (!Number.isFinite(costValue) || costValue <= 0) return null;

  const profit = totalValue - costValue;
  return (profit / costValue) * 100;
};

const calculateTotalValue = (sales = []) => {
  return sales.reduce((acc, record) => {
    const sale = record?.completedSales || record?.sale || record;
    const totalValue = deriveSaleTotal(sale);

    if (!Number.isFinite(totalValue)) return acc;

    return acc + totalValue;
  }, 0);
};

const calculateAverageTicket = (sales = []) => {
  const totals = sales.reduce(
    (acc, record) => {
      const sale = record?.completedSales || record?.sale || record;
      const totalValue = deriveSaleTotal(sale);

      if (!Number.isFinite(totalValue)) return acc;

      return {
        total: acc.total + totalValue,
        count: acc.count + 1,
      };
    },
    { total: 0, count: 0 }
  );

  if (!totals.count) return null;

  return totals.total / totals.count;
};

const isCompletedSale = (record) => {
  const sale = record?.completedSales || record?.sale || record || {};
  const status = (sale.status || 'completed').toLowerCase();
  return status === 'completed';
};

const deriveFiscalTypeLabel = (sale = {}) => {
  const fiscalStatus = (sale.fiscalStatus || '').toLowerCase();
  const hasFiscalEmission =
    ['emitted', 'authorized', 'autorizado', 'approved', 'aprovado'].includes(fiscalStatus) ||
    (sale.fiscalXmlName && sale.fiscalXmlName.trim()) ||
    (sale.fiscalAccessKey && sale.fiscalAccessKey.trim());

  if (!hasFiscalEmission) return 'Matricial';

  const joinedHints = [
    sale.fiscalXmlName,
    sale.fiscalXmlUrl,
    sale.fiscalEnvironment,
    sale.fiscalAccessKey,
    sale.fiscalSerie,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  const xmlContent = (sale.fiscalXmlContent || '').toLowerCase();
  const contentHints = `${joinedHints} ${xmlContent}`;

  if (contentHints.includes('nfse')) return 'NFSe';
  if (contentHints.includes('nfce')) return 'NFCe';
  if (contentHints.includes('nfe')) return 'NFe';

  return 'NFe';
};

const normalizeName = (value) => {
  if (typeof value !== 'string') return '';
  return value.trim();
};

const normalizePaymentKey = (value) => {
  if (value === undefined || value === null) return '';
  const raw = String(value).trim().toLowerCase();
  if (!raw) return '';
  const withoutAccents = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return withoutAccents.replace(/\s+/g, ' ').trim();
};

const resolveEntryInstallments = (entry) => {
  if (!entry || typeof entry !== 'object') return null;
  return (
    normalizeInstallments(entry.installments ?? entry.parcelas ?? entry.parcela) ||
    extractInstallmentsFromLabel(entry.label || entry.baseLabel || '')
  );
};

const buildPaymentMethodIndex = (methods = []) => {
  const index = new Map();
  methods.forEach((method) => {
    const companyId = normalizeStoreId(method?.company);
    if (!companyId) return;
    const bucket = index.get(companyId) || { byKey: new Map() };
    const keyCandidates = [
      method?._id,
      method?.id,
      method?.code,
      method?.name,
      method?.nome,
      method?.label,
    ];
    keyCandidates.forEach((candidate) => {
      const key = normalizePaymentKey(candidate);
      if (key && !bucket.byKey.has(key)) {
        bucket.byKey.set(key, method);
      }
    });
    const baseLabel = stripInstallmentSuffix(String(method?.name || method?.label || method?.code || ''));
    const baseKey = normalizePaymentKey(baseLabel);
    if (baseKey && !bucket.byKey.has(baseKey)) {
      bucket.byKey.set(baseKey, method);
    }
    index.set(companyId, bucket);
  });
  return index;
};

const resolvePaymentMethodForEntry = (entry, companyId, paymentMethodIndex) => {
  if (!companyId || !paymentMethodIndex) return null;
  const bucket = paymentMethodIndex.get(companyId);
  if (!bucket) return null;
  const candidates = [
    entry?.paymentMethodId,
    entry?.paymentId,
    entry?.label,
    entry?.baseLabel,
    stripInstallmentSuffix(entry?.label || ''),
  ];
  for (const candidate of candidates) {
    const key = normalizePaymentKey(candidate);
    if (!key) continue;
    const method = bucket.byKey.get(key);
    if (method) return method;
  }
  return null;
};

const resolvePaymentMethodRate = (method, installments) => {
  if (!method) return null;
  const baseDiscount = parseNumber(method.discount);
  const discountValue = Number.isFinite(baseDiscount) ? baseDiscount : 0;
  if (String(method.type || '').toLowerCase() !== 'credito') {
    return discountValue;
  }
  const configs = Array.isArray(method.installmentConfigurations) ? method.installmentConfigurations : [];
  const normalizedInstallments = normalizeInstallments(installments);
  if (normalizedInstallments && configs.length) {
    const match = configs.find((config) => Number(config?.number) === normalizedInstallments);
    if (match) {
      const matchedDiscount = parseNumber(match.discount);
      return Number.isFinite(matchedDiscount) ? matchedDiscount : discountValue;
    }
  }
  return discountValue;
};

const buildPaymentEntriesWithFees = (sale, companyId, paymentMethodIndex) => {
  const entries = collectPaymentEntries(sale);
  if (!entries.length) return [];
  return entries.map((entry) => {
    const amount = Number.isFinite(entry.amount) ? entry.amount : null;
    const baseLabel = entry.baseLabel || stripInstallmentSuffix(entry.label || '');
    const resolvedEntry = {
      ...entry,
      baseLabel,
      installments: resolveEntryInstallments(entry),
    };
    const method = resolvePaymentMethodForEntry(resolvedEntry, companyId, paymentMethodIndex);
    const rate = resolvePaymentMethodRate(method, resolvedEntry.installments);
    const fee = amount !== null && rate !== null ? amount * (rate / 100) : null;
    return {
      ...resolvedEntry,
      amount,
      method,
      rate,
      fee,
      methodLabel: method?.name || method?.label || baseLabel || entry.label,
    };
  });
};

const applyPaymentMethodFees = (records = [], paymentMethodIndex) => {
  records.forEach((record) => {
    const companyId = normalizeStoreId(record?.empresa || record?.store?._id);
    const sale = normalizeSaleRecord(record);
    if (!sale) return;
    const entries = buildPaymentEntriesWithFees(sale, companyId, paymentMethodIndex);
    if (entries.length) {
      sale.__paymentEntries = entries;
      const hasMethodRates = entries.some(
        (entry) => entry.rate !== null && Number.isFinite(entry.amount)
      );
      if (hasMethodRates) {
        const totalFee = entries.reduce(
          (sum, entry) => sum + (Number.isFinite(entry.fee) ? entry.fee : 0),
          0
        );
        sale.__feeFromPaymentMethods = totalFee;
      }
    }
  });
};

const collectCompanyIdsFromRecords = (records = []) => {
  const ids = new Set();
  records.forEach((record) => {
    const companyId = normalizeStoreId(record?.empresa || record?.store?._id);
    if (companyId) ids.add(companyId);
  });
  return Array.from(ids);
};

const pickFirstName = (...values) => {
  for (const value of values) {
    const normalized = normalizeName(value);
    if (normalized) return normalized;
  }
  return '';
};

const deriveSellerName = (sale = {}) => {
  const seller = sale?.seller || {};
  const meta = sale?.receiptSnapshot?.meta || {};
  return pickFirstName(
    sale.sellerName,
    sale.vendedorNome,
    seller.nome,
    seller.name,
    seller.fullName,
    meta.vendedor,
    meta.vendedorNome,
    meta.nomeVendedor,
    meta.sellerName
  );
};

const deriveOperatorName = (sale = {}) => {
  const meta = sale?.receiptSnapshot?.meta || {};
  return pickFirstName(
    sale.operatorName,
    sale.operator,
    meta.operador,
    meta.operadorNome,
    meta.nomeOperador,
    meta.usuario,
    meta.userName,
    meta.atendente
  );
};

const calculateMarginPercentage = (sales = []) => {
  const totals = sales.reduce(
    (acc, record) => {
      const sale = record?.completedSales || record?.sale || record;
      const totalValue = deriveSaleTotal(sale);
      const costValue = deriveSaleCost(sale);

      if (!Number.isFinite(totalValue) || !Number.isFinite(costValue)) return acc;

      return {
        total: acc.total + totalValue,
        cost: acc.cost + costValue,
      };
    },
    { total: 0, cost: 0 }
  );

  if (totals.total <= 0 || totals.cost <= 0) return null;

  const profit = totals.total - totals.cost;
  return (profit / totals.total) * 100;
};

const fetchSalesForPeriod = async (baseMatch, saleMatch, startDate, endDate) => {
  const periodMatch = { ...saleMatch };

  if (startDate || endDate) {
    const createdAt = { ...(saleMatch?.['completedSales.createdAt'] || {}) };
    if (startDate) createdAt.$gte = startDate;
    if (endDate) createdAt.$lte = endDate;
    periodMatch['completedSales.createdAt'] = createdAt;
  }

  const pipeline = [
    { $match: baseMatch },
    { $project: { completedSales: 1, empresa: 1 } },
    { $unwind: '$completedSales' },
    { $match: periodMatch },
  ];

  return PdvState.aggregate(pipeline);
};

const normalizeSaleRecord = (record) => record?.completedSales || record?.sale || record || {};

const calculateTrend = (current, previous) => {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
  return (current - previous) / previous;
};

const collectSalesSummary = (sales = []) => {
  const summary = {
    gross: 0,
    net: 0,
    discounts: 0,
    additions: 0,
    fees: 0,
    refunds: 0,
    costs: 0,
    orders: 0,
    pendingCount: 0,
    cancelledCount: 0,
    completedCount: 0,
  };

  const completedSales = [];

  sales.forEach((sale) => {
    const normalized = normalizeSaleRecord(sale);
    if (!normalized) return;
    const status = normalizeSaleStatus(normalized);

    if (status === 'pending') {
      summary.pendingCount += 1;
    }

    if (isCancelledSale(normalized)) {
      summary.cancelledCount += 1;
      summary.refunds += deriveSaleNet(normalized);
    }

    if (!isCompletedSale(normalized)) return;

    const gross = deriveSaleGross(normalized);
    const net = deriveSaleNet(normalized);
    const discount = deriveSaleDiscount(normalized);
    const addition = deriveSaleAddition(normalized);
    const fee = deriveSaleFee(normalized);
    const cost = deriveSaleCost(normalized);

    summary.gross += Number.isFinite(gross) ? gross : 0;
    summary.net += Number.isFinite(net) ? net : 0;
    summary.discounts += Number.isFinite(discount) ? discount : 0;
    summary.additions += Number.isFinite(addition) ? addition : 0;
    summary.fees += Number.isFinite(fee) ? fee : 0;
    summary.costs += Number.isFinite(cost) ? cost : 0;
    summary.orders += 1;
    summary.completedCount += 1;

    completedSales.push(normalized);
  });

  const avgTicket = summary.orders ? summary.net / summary.orders : 0;

  return { summary: { ...summary, avgTicket }, completedSales };
};

const buildChannelBreakdown = (sales = [], grossTotal) => {
  const channelMap = new Map();
  sales.forEach((sale) => {
    const label = normalizeName(sale.typeLabel) || normalizeName(sale.type) || 'Venda';
    const gross = deriveSaleGross(sale);
    if (!Number.isFinite(gross)) return;
    const entry = channelMap.get(label) || { label, gross: 0, orders: 0 };
    entry.gross += gross;
    entry.orders += 1;
    channelMap.set(label, entry);
  });

  const list = Array.from(channelMap.values()).map((entry) => ({
    ...entry,
    share: grossTotal > 0 ? entry.gross / grossTotal : 0,
  }));

  return list.sort((a, b) => b.gross - a.gross);
};

const buildTopCustomers = (sales = []) => {
  const customerMap = new Map();

  sales.forEach((sale) => {
    const key = deriveCustomerKey(sale);
    const name = deriveCustomerName(sale);
    const total = deriveSaleNet(sale);
    const entry = customerMap.get(key) || {
      name,
      orders: 0,
      total: 0,
      last: null,
      channel: normalizeName(sale.typeLabel) || normalizeName(sale.type) || 'Venda',
    };
    entry.orders += 1;
    entry.total += Number.isFinite(total) ? total : 0;
    const createdAt = sale.createdAt ? new Date(sale.createdAt) : null;
    if (createdAt && (!entry.last || createdAt > entry.last)) {
      entry.last = createdAt;
      entry.channel = normalizeName(sale.typeLabel) || normalizeName(sale.type) || entry.channel;
    }
    customerMap.set(key, entry);
  });

  return Array.from(customerMap.values())
    .sort((a, b) => b.total - a.total)
    .slice(0, 8)
    .map((entry) => ({
      name: entry.name,
      orders: entry.orders,
      total: entry.total,
      ticket: entry.orders ? entry.total / entry.orders : 0,
      last: entry.last ? entry.last.toISOString() : null,
      channel: entry.channel,
    }));
};

const deriveItemName = (item = {}) => {
  return (
    normalizeName(item.name) ||
    normalizeName(item.nome) ||
    normalizeName(item.descricao) ||
    normalizeName(item.product?.name) ||
    normalizeName(item.produto?.nome) ||
    normalizeName(item.productSnapshot?.name) ||
    normalizeName(item.produtoSnapshot?.nome) ||
    'Produto'
  );
};

const deriveItemCategory = (item = {}) => {
  return (
    normalizeName(item.category) ||
    normalizeName(item.categoria) ||
    normalizeName(item.product?.categoria) ||
    normalizeName(item.produto?.categoria) ||
    normalizeName(item.productSnapshot?.categoria) ||
    normalizeName(item.produtoSnapshot?.categoria) ||
    'Geral'
  );
};

const buildTopProducts = (sales = []) => {
  const productMap = new Map();

  sales.forEach((sale) => {
    const items = collectSaleItems(sale);
    if (!items.length) return;

    const saleGross = items.reduce((acc, item) => acc + deriveItemTotal(item), 0);
    const saleDiscount = deriveSaleDiscount(sale);
    const discountRate = saleGross > 0 ? Math.min(saleDiscount / saleGross, 1) : 0;

    items.forEach((item) => {
      const name = deriveItemName(item);
      const category = deriveItemCategory(item);
      const qty = deriveItemQuantity(item) || 0;
      const gross = deriveItemTotal(item) || 0;
      const discount = gross * discountRate;
      const net = gross - discount;

      const key = `${name}__${category}`;
      const entry = productMap.get(key) || {
        name,
        category,
        qty: 0,
        gross: 0,
        discount: 0,
        net: 0,
      };

      entry.qty += qty;
      entry.gross += gross;
      entry.discount += discount;
      entry.net += net;
      productMap.set(key, entry);
    });
  });

  return Array.from(productMap.values())
    .sort((a, b) => b.net - a.net)
    .slice(0, 8);
};

const buildPaymentMethods = (sales = []) => {
  const methodMap = new Map();

  const buildInstallmentLabel = (label, installments) => {
    const base = stripInstallmentSuffix(label || '');
    const normalizedInstallments = normalizeInstallments(installments);
    if (!base) return label || '';
    if (!normalizedInstallments) return base;
    return `${base} ${normalizedInstallments}x`;
  };

  sales.forEach((sale) => {
    const entries = Array.isArray(sale?.__paymentEntries) ? sale.__paymentEntries : collectPaymentEntries(sale);
    const net = deriveSaleNet(sale);
    const fee = deriveSaleFee(sale);

    let allocations = [];
    const amountEntries = entries.filter((entry) => Number.isFinite(entry.amount) && entry.amount > 0);
    const hasMethodRates = entries.some((entry) => entry.rate !== null);

    if (amountEntries.length && hasMethodRates) {
      allocations = amountEntries.map((entry) => ({
        label: buildInstallmentLabel(entry.methodLabel || entry.baseLabel || entry.label, entry.installments),
        amount: entry.amount,
        fee: Number.isFinite(entry.fee) ? entry.fee : 0,
      }));
    } else if (amountEntries.length) {
      const totalAmount = amountEntries.reduce((acc, entry) => acc + entry.amount, 0);
      allocations = amountEntries.map((entry) => ({
        label: buildInstallmentLabel(entry.label, entry.installments),
        amount: totalAmount > 0 ? entry.amount : net,
        fee: totalAmount > 0 ? (fee * entry.amount) / totalAmount : 0,
      }));
    } else if (entries.length) {
      const label = buildInstallmentLabel(entries[0].label, entries[0].installments);
      allocations = [{ label, amount: net, fee: fee }];
    } else {
      allocations = [{ label: 'Nao informado', amount: net, fee: fee }];
    }

    allocations.forEach((allocation) => {
      const entry = methodMap.get(allocation.label) || {
        label: allocation.label,
        orders: 0,
        gross: 0,
        feeRate: 0,
        fee: 0,
        net: 0,
      };
      entry.orders += 1;
      entry.gross += Number.isFinite(allocation.amount) ? allocation.amount : 0;
      entry.fee += Number.isFinite(allocation.fee) ? allocation.fee : 0;
      entry.net = entry.gross - entry.fee;
      entry.feeRate = entry.gross > 0 ? entry.fee / entry.gross : 0;
      methodMap.set(allocation.label, entry);
    });
  });

  return Array.from(methodMap.values()).sort((a, b) => b.gross - a.gross);
};

const buildSalesTable = (sales = []) => {
  return sales
    .map((sale) => {
      const normalized = normalizeSaleRecord(sale);
      const gross = deriveSaleGross(normalized);
      const net = deriveSaleNet(normalized);
      const discount = deriveSaleDiscount(normalized);
      const fee = deriveSaleFee(normalized);
      return {
        date: normalized.createdAt,
        order: normalized.saleCodeLabel || normalized.saleCode || 'Sem codigo',
        customer: deriveCustomerName(normalized),
        channel: normalizeName(normalized.typeLabel) || normalizeName(normalized.type) || 'Venda',
        payment: resolvePrimaryPaymentLabel(normalized),
        gross: Number.isFinite(gross) ? gross : 0,
        discount: Number.isFinite(discount) ? discount : 0,
        fee: Number.isFinite(fee) ? fee : 0,
        net: Number.isFinite(net) ? net : 0,
        status: normalizeSaleStatus(normalized) || 'completed',
      };
    })
    .sort((a, b) => {
      const dateA = a.date ? new Date(a.date).getTime() : 0;
      const dateB = b.date ? new Date(b.date).getTime() : 0;
      return dateB - dateA;
    });
};

router.get(
  '/pdv-sales',
  requireAuth,
  authorizeRoles('admin', 'admin_master', 'funcionario'),
  async (req, res) => {
    try {
      const { start, end, storeId, pdvId, status, channel } = req.query;
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const pageSize = Math.min(200, Math.max(1, parseInt(req.query.pageSize, 10) || 25));

      const baseMatch = {};
      const saleMatch = {};

      const startDate = parseDate(start);
      const endDate = parseDate(end, true);

      if (startDate || endDate) {
        saleMatch['completedSales.createdAt'] = {};
        if (startDate) saleMatch['completedSales.createdAt'].$gte = startDate;
        if (endDate) saleMatch['completedSales.createdAt'].$lte = endDate;
      }

      const { allowedStoreIds, allowAllStores } = await resolveUserStoreAccess(req.user?.id);
      const allowedStoreObjectIds = allowAllStores
        ? []
        : allowedStoreIds.map((id) => new mongoose.Types.ObjectId(id));

      const storeObjectId = toObjectId(storeId);
      if (storeObjectId) {
        if (!allowAllStores) {
          const allowedSet = new Set(allowedStoreIds);
          if (!allowedSet.has(String(storeObjectId))) {
            return res.status(403).json({ message: 'Empresa nao permitida para o usuario.' });
          }
        }
        baseMatch.empresa = storeObjectId;
      } else if (!allowAllStores) {
        if (!allowedStoreObjectIds.length) {
          return res.json({
            sales: [],
            pagination: {
              total: 0,
              page,
              pageSize,
              totalPages: 1,
            },
            metrics: {
              totalValue: 0,
              averageTicket: 0,
              completedCount: 0,
              totalChange: null,
              averageTicketChange: null,
              completedChange: 0,
              marginAverage: null,
              marginChange: null,
            },
          });
        }
        baseMatch.empresa = { $in: allowedStoreObjectIds };
      }

      const pdvObjectId = toObjectId(pdvId);
      if (pdvObjectId) {
        baseMatch.pdv = pdvObjectId;
      }

      if (status) {
        saleMatch['completedSales.status'] = status;
      }

      if (channel) {
        saleMatch['completedSales.type'] = channel;
      }

      const skip = (page - 1) * pageSize;

      const pipeline = [
        { $match: baseMatch },
        {
          $lookup: {
            from: 'pdvs',
            localField: 'pdv',
            foreignField: '_id',
            as: 'pdvInfo',
          },
        },
        { $unwind: '$pdvInfo' },
        {
          $lookup: {
            from: 'stores',
            localField: 'empresa',
            foreignField: '_id',
            as: 'storeInfo',
          },
        },
        { $unwind: { path: '$storeInfo', preserveNullAndEmptyArrays: true } },
        {
          $project: {
            completedSales: 1,
            pdv: {
              _id: '$pdvInfo._id',
              nome: '$pdvInfo.nome',
              codigo: '$pdvInfo.codigo',
            },
            store: {
              _id: '$storeInfo._id',
              nome: '$storeInfo.nome',
              fantasia: '$storeInfo.fantasia',
              apelido: '$storeInfo.apelido',
            },
          },
        },
        { $unwind: '$completedSales' },
        { $match: saleMatch },
        { $sort: { 'completedSales.createdAt': -1 } },
        {
          $facet: {
            totalCount: [{ $count: 'count' }],
            data: [{ $skip: skip }, { $limit: pageSize }],
          },
        },
      ];

      const result = await PdvState.aggregate(pipeline);
      const totalCount = result?.[0]?.totalCount?.[0]?.count || 0;
      const records = result?.[0]?.data || [];

      const sales = records.map((record) => {
        const sale = record.completedSales || {};
        const storeName = record.store?.fantasia || record.store?.apelido || record.store?.nome;
        const totalValue = deriveSaleTotal(sale);
        const costValue = deriveSaleCost(sale);
        const fiscalTypeLabel = deriveFiscalTypeLabel(sale);
        const sellerName = deriveSellerName(sale) || deriveOperatorName(sale);
        const sellerCode =
          sale.sellerCode ||
          sale.vendedorCodigo ||
          sale.seller?.codigo ||
          sale.seller?.codigoCliente ||
          sale.seller?.id ||
          '';
        return {
          id: sale.id,
          saleCode: sale.saleCode || sale.saleCodeLabel || 'Sem código',
          createdAt: sale.createdAt,
          createdAtLabel: sale.createdAtLabel || '',
          seller: sale.seller && typeof sale.seller === 'object' ? sale.seller : null,
          sellerName,
          sellerCode,
          store: {
            id: record.store?._id,
            name: storeName || 'Loja não informada',
          },
          pdv: {
            id: record.pdv?._id,
            name: record.pdv?.nome || record.pdv?.codigo || 'PDV',
          },
          channel: sale.type || 'venda',
          channelLabel: sale.typeLabel || 'Venda',
          totalValue,
          costValue,
          markup: deriveSaleMarkup(totalValue, costValue),
          status: sale.status || 'completed',
          fiscalTypeLabel,
        };
      });

      const today = new Date();
      const currentMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);
      const currentMonthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59, 999);
      const previousMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const previousMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0, 23, 59, 59, 999);

      const saleMatchForMargin = { ...saleMatch };
      delete saleMatchForMargin['completedSales.createdAt'];

      const [filteredSales, currentMonthSales, previousMonthSales] = await Promise.all([
        fetchSalesForPeriod(baseMatch, saleMatch, startDate, endDate),
        fetchSalesForPeriod(baseMatch, saleMatchForMargin, currentMonthStart, currentMonthEnd),
        fetchSalesForPeriod(baseMatch, saleMatchForMargin, previousMonthStart, previousMonthEnd),
      ]);

      const completedSalesTotal = calculateTotalValue(filteredSales);
      const averageTicket = calculateAverageTicket(filteredSales) || 0;

      const filteredMargin = calculateMarginPercentage(filteredSales);
      const currentMargin = calculateMarginPercentage(currentMonthSales);
      const previousMargin = calculateMarginPercentage(previousMonthSales);
      const currentTotal = calculateTotalValue(currentMonthSales);
      const previousTotal = calculateTotalValue(previousMonthSales);
      const currentAverageTicket = calculateAverageTicket(currentMonthSales);
      const previousAverageTicket = calculateAverageTicket(previousMonthSales);
      const completedCount = filteredSales.filter(isCompletedSale).length;
      const currentCompletedCount = currentMonthSales.filter(isCompletedSale).length;
      const previousCompletedCount = previousMonthSales.filter(isCompletedSale).length;
      const marginChange =
        Number.isFinite(currentMargin) && Number.isFinite(previousMargin)
          ? currentMargin - previousMargin
          : null;
      const totalChange =
        Number.isFinite(currentTotal) && Number.isFinite(previousTotal) ? currentTotal - previousTotal : null;
      const averageTicketChange =
        Number.isFinite(currentAverageTicket) && Number.isFinite(previousAverageTicket)
          ? currentAverageTicket - previousAverageTicket
          : null;
      const completedChange = currentCompletedCount - previousCompletedCount;

      res.json({
        sales,
        pagination: {
          total: totalCount,
          page,
          pageSize,
          totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
        },
        metrics: {
          totalValue: completedSalesTotal,
          averageTicket,
          completedCount,
          totalChange,
          averageTicketChange,
          completedChange,
          marginAverage: filteredMargin,
          marginChange,
        },
      });
    } catch (error) {
      console.error('Erro ao listar vendas de PDVs:', error);
      res.status(500).json({ message: 'Erro ao listar vendas de PDVs.' });
    }
  }
);

router.get(
  '/billing',
  requireAuth,
  authorizeRoles('admin', 'admin_master', 'funcionario'),
  async (req, res) => {
    try {
      const { viewMonth, viewStart, viewEnd, compareMonth, compareStart, compareEnd, storeId, companyCode } = req.query;

      const viewPeriod = resolvePeriod(
        { month: viewMonth, start: viewStart, end: viewEnd },
        new Date()
      );

      const fallbackCompareDate = viewPeriod?.start
        ? new Date(viewPeriod.start.getFullYear(), viewPeriod.start.getMonth() - 1, 1)
        : new Date();

      const comparePeriod = resolvePeriod(
        { month: compareMonth, start: compareStart, end: compareEnd },
        fallbackCompareDate
      );

      const { allowedStoreIds, allowAllStores } = await resolveUserStoreAccess(req.user?.id);
      const allowedStoreObjectIds = allowAllStores
        ? []
        : allowedStoreIds.map((id) => new mongoose.Types.ObjectId(id));

      let storeObjectId = toObjectId(storeId);

      if (!storeObjectId && companyCode) {
        const store = await resolveStoreByCompanyCode(companyCode);
        storeObjectId = store?._id ? new mongoose.Types.ObjectId(store._id) : null;
        if (!storeObjectId) {
          return res.status(404).json({ message: 'Empresa nao encontrada.' });
        }
      }

      const baseMatch = {};
      if (storeObjectId) {
        if (!allowAllStores) {
          const allowedSet = new Set(allowedStoreIds);
          if (!allowedSet.has(String(storeObjectId))) {
            return res.status(403).json({ message: 'Empresa nao permitida para o usuario.' });
          }
        }
        baseMatch.empresa = storeObjectId;
      } else if (!allowAllStores) {
        if (!allowedStoreObjectIds.length) {
          return res.json({
            period: {
              view: viewPeriod,
              compare: comparePeriod,
            },
            summary: {
              gross: 0,
              net: 0,
              discounts: 0,
              additions: 0,
              fees: 0,
              refunds: 0,
              costs: 0,
              orders: 0,
              avgTicket: 0,
              pendingCount: 0,
              cancelledCount: 0,
            },
            trends: {},
            goal: { target: 0, projection: 0 },
            customers: { active: 0, new: 0, returning: 0 },
            itemsSold: 0,
            channels: [],
            health: [],
            topCustomers: [],
            topProducts: [],
            paymentMethods: [],
            taxes: [],
            notes: [],
            alerts: [],
            nextSteps: [],
            sales: [],
          });
        }
        baseMatch.empresa = { $in: allowedStoreObjectIds };
      }

      const saleMatch = {};

      const [viewSalesRaw, compareSalesRaw] = await Promise.all([
        fetchSalesForPeriod(baseMatch, saleMatch, viewPeriod?.start, viewPeriod?.end),
        fetchSalesForPeriod(baseMatch, saleMatch, comparePeriod?.start, comparePeriod?.end),
      ]);

      const paymentMethodCompanyIds = storeObjectId
        ? [String(storeObjectId)]
        : allowAllStores
        ? collectCompanyIdsFromRecords([...viewSalesRaw, ...compareSalesRaw])
        : allowedStoreIds;
      const paymentMethodsCatalog = paymentMethodCompanyIds.length
        ? await PaymentMethod.find({ company: { $in: paymentMethodCompanyIds } }).lean()
        : [];
      const paymentMethodIndex = buildPaymentMethodIndex(paymentMethodsCatalog);
      applyPaymentMethodFees(viewSalesRaw, paymentMethodIndex);
      applyPaymentMethodFees(compareSalesRaw, paymentMethodIndex);

      const viewSales = viewSalesRaw.map(normalizeSaleRecord);
      const compareSales = compareSalesRaw.map(normalizeSaleRecord);

      const { summary: viewSummary, completedSales: viewCompletedSales } = collectSalesSummary(viewSales);
      const { summary: compareSummary, completedSales: compareCompletedSales } = collectSalesSummary(compareSales);

      const profit = viewSummary.net - viewSummary.costs;
      const compareProfit = compareSummary.net - compareSummary.costs;

      const trends = {
        gross: calculateTrend(viewSummary.gross, compareSummary.gross),
        net: calculateTrend(viewSummary.net, compareSummary.net),
        discounts: calculateTrend(viewSummary.discounts, compareSummary.discounts),
        fees: calculateTrend(viewSummary.fees, compareSummary.fees),
        refunds: calculateTrend(viewSummary.refunds, compareSummary.refunds),
        orders: calculateTrend(viewSummary.orders, compareSummary.orders),
        ticket: calculateTrend(viewSummary.avgTicket, compareSummary.avgTicket),
        profit: calculateTrend(profit, compareProfit),
      };

      const compareCustomersSet = new Set(compareCompletedSales.map((sale) => deriveCustomerKey(sale)));
      const viewCustomersSet = new Set(viewCompletedSales.map((sale) => deriveCustomerKey(sale)));
      const newCustomers = Array.from(viewCustomersSet).filter((key) => !compareCustomersSet.has(key));

      const itemsSold = viewCompletedSales.reduce((acc, sale) => {
        const items = collectSaleItems(sale);
        return acc + items.reduce((sum, item) => sum + (deriveItemQuantity(item) || 0), 0);
      }, 0);

      const channels = buildChannelBreakdown(viewCompletedSales, viewSummary.gross);
      const topCustomers = buildTopCustomers(viewCompletedSales);
      const topProducts = buildTopProducts(viewCompletedSales);
      const paymentMethods = buildPaymentMethods(viewCompletedSales);
      const salesTable = buildSalesTable(viewSales);

      const totalDays =
        viewPeriod?.start && viewPeriod?.end
          ? Math.max(1, Math.round((viewPeriod.end - viewPeriod.start) / (1000 * 60 * 60 * 24)) + 1)
          : 1;
      const today = new Date();
      const elapsedDays =
        viewPeriod?.start && viewPeriod?.end
          ? Math.max(
              1,
              Math.min(
                totalDays,
                Math.round((Math.min(today, viewPeriod.end) - viewPeriod.start) / (1000 * 60 * 60 * 24)) + 1
              )
            )
          : totalDays;

      const projection = viewSummary.gross > 0 ? (viewSummary.gross / elapsedDays) * totalDays : 0;
      const target = compareSummary.gross > 0 ? compareSummary.gross * 1.05 : projection || viewSummary.gross;

      const cancellationRate = viewSales.length ? (viewSummary.cancelledCount / viewSales.length) * 100 : 0;
      const recurringRate = viewCustomersSet.size
        ? ((viewCustomersSet.size - newCustomers.length) / viewCustomersSet.size) * 100
        : 0;
      const marginRate = viewSummary.gross ? (profit / viewSummary.gross) * 100 : 0;

      const health = [
        {
          label: 'Taxa de cancelamento',
          value: cancellationRate,
          suffix: '%',
          note: cancellationRate > 3 ? 'Alerta' : 'Nivel saudavel',
        },
        {
          label: 'Clientes recorrentes',
          value: recurringRate,
          suffix: '%',
          note: recurringRate > 40 ? 'Boa retencao' : 'Reforcar retorno',
        },
        {
          label: 'Margem estimada',
          value: marginRate,
          suffix: '%',
          note: marginRate > 25 ? 'Margem ok' : 'Abaixo da meta',
        },
      ];

      const taxes = [
        { label: 'Descontos concedidos', value: viewSummary.discounts, note: 'Politica comercial' },
        { label: 'Taxas de pagamento', value: viewSummary.fees, note: 'Meios de pagamento' },
        { label: 'Estornos e cancelamentos', value: viewSummary.refunds, note: 'Ajustes do periodo' },
      ].filter((entry) => Number.isFinite(entry.value) && entry.value > 0);

      const alerts = [];
      if (viewSummary.pendingCount > 0) {
        alerts.push({
          label: 'Pagamentos pendentes',
          value: viewSummary.pendingCount,
          hint: 'Acompanhar conciliacao.',
        });
      }
      if (viewSummary.cancelledCount > 0) {
        alerts.push({
          label: 'Cancelamentos registrados',
          value: viewSummary.cancelledCount,
          hint: 'Rever causas de cancelamento.',
        });
      }
      if (marginRate > 0 && marginRate < 20) {
        alerts.push({
          label: 'Margem abaixo do esperado',
          value: `${marginRate.toFixed(1)}%`,
          hint: 'Reavaliar custos e precos.',
        });
      }

      const nextSteps = [];
      if (viewSummary.discounts > viewSummary.gross * 0.05) {
        nextSteps.push('Revisar politica de descontos e campanhas.');
      }
      if (marginRate < 25) {
        nextSteps.push('Ajustar mix de produtos e precos para elevar a margem.');
      }
      if (!nextSteps.length) {
        nextSteps.push('Manter acompanhamento semanal dos indicadores.');
      }

      const notes = [
        `Periodo analisado: ${viewPeriod?.label || '-'}.`,
        viewSummary.orders ? `Total de pedidos concluidos: ${viewSummary.orders}.` : 'Sem vendas concluidas.',
      ];

      return res.json({
        period: {
          view: viewPeriod,
          compare: comparePeriod,
        },
        summary: {
          gross: viewSummary.gross,
          net: viewSummary.net,
          discounts: viewSummary.discounts,
          additions: viewSummary.additions,
          fees: viewSummary.fees,
          refunds: viewSummary.refunds,
          costs: viewSummary.costs,
          orders: viewSummary.orders,
          avgTicket: viewSummary.avgTicket,
          pendingCount: viewSummary.pendingCount,
          cancelledCount: viewSummary.cancelledCount,
        },
        trends,
        goal: {
          target,
          projection,
        },
        customers: {
          active: viewCustomersSet.size,
          new: newCustomers.length,
          returning: viewCustomersSet.size - newCustomers.length,
        },
        itemsSold,
        channels,
        health,
        topCustomers,
        topProducts,
        paymentMethods,
        taxes,
        notes,
        alerts,
        nextSteps,
        sales: salesTable,
      });
    } catch (error) {
      console.error('Erro ao carregar faturamento:', error);
      return res.status(500).json({ message: 'Erro ao carregar faturamento.' });
    }
  }
);

module.exports = router;
