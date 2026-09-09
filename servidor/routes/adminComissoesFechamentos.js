const express = require('express');
const mongoose = require('mongoose');

const router = express.Router();

const requireAuth = require('../middlewares/requireAuth');
const authorizeRoles = require('../middlewares/authorizeRoles');
const CommissionClosing = require('../models/CommissionClosing');
const CommissionConfig = require('../models/CommissionConfig');
const PdvState = require('../models/PdvState');
const User = require('../models/User');
const UserGroup = require('../models/UserGroup');
const Product = require('../models/Product');
const Service = require('../models/Service');
const Appointment = require('../models/Appointment');
const Store = require('../models/Store');
const AccountingAccount = require('../models/AccountingAccount');
const BankAccount = require('../models/BankAccount');
const AccountPayable = require('../models/AccountPayable');
const CommissionItemLock = require('../models/CommissionItemLock');
const ProfessionalCommissionConfig = require('../models/ProfessionalCommissionConfig');
const { hasAdminMasterGlobalAccess } = require('../utils/adminMasterMode');

const ADMIN_ROLES = ['admin', 'admin_master'];
const DEFAULT_WINDOW_DAYS = 90;
const SERVICE_STATUS_VALUES = new Set(['agendado', 'em_espera', 'em_atendimento', 'finalizado']);
const DEFAULT_COMISSAO_PERCENT = 1;
const DEFAULT_COMISSAO_SERVICO_PERCENT = 0.5;
const SAO_PAULO_TIME_ZONE = 'America/Sao_Paulo';
const CALENDAR_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})/;
const CLOCK_TIME_PATTERN = /^(\d{2}):(\d{2})(?::(\d{2}))?$/;
const DEFAULT_SUMMARY_CONCURRENCY = Math.max(
  1,
  Number(process.env.COMMISSIONS_SUMMARY_CONCURRENCY || 2) || 2,
);
const MAX_CLOSING_ITEMS = 10000;

const emptyTotals = () => ({
  totalPeriodo: 0,
  totalPendente: 0,
  totalVendas: 0,
  totalServicos: 0,
  pendenteVendas: 0,
  pendenteServicos: 0,
  totalPago: 0,
});

const runWithConcurrency = async (items = [], task, concurrency = DEFAULT_SUMMARY_CONCURRENCY) => {
  const safeConcurrency = Math.max(1, Number(concurrency) || 1);
  const results = new Array(items.length);
  let currentIndex = 0;

  const worker = async () => {
    while (currentIndex < items.length) {
      const index = currentIndex;
      currentIndex += 1;
      // eslint-disable-next-line no-await-in-loop
      results[index] = await task(items[index], index);
    }
  };

  await Promise.all(Array.from({ length: Math.min(safeConcurrency, items.length) }, () => worker()));
  return results;
};

const toCacheDateKey = (value) => {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return '';
  return value.toISOString();
};

const buildSummaryCacheKey = ({ storeId = null, startDate = null, endDate = null } = {}) =>
  `${storeId || 'all'}|${toCacheDateKey(startDate)}|${toCacheDateKey(endDate)}`;

const ensureSummaryRuntimeContext = (runtimeContext = null) => {
  if (!runtimeContext || typeof runtimeContext !== 'object') return null;
  if (!runtimeContext.salesPoolByKey) runtimeContext.salesPoolByKey = new Map();
  if (!runtimeContext.appointmentsPoolByKey) runtimeContext.appointmentsPoolByKey = new Map();
  if (!runtimeContext.professionalCommissionByUserId) {
    runtimeContext.professionalCommissionByUserId = new Map();
  }
  if (!runtimeContext.serviceMetaById) runtimeContext.serviceMetaById = new Map();
  if (!runtimeContext.productIds) runtimeContext.productIds = new Set();
  if (!runtimeContext.unresolvedItemIds) runtimeContext.unresolvedItemIds = new Set();
  return runtimeContext;
};

const buildProfessionalStorePairKey = (profissional, store) =>
  `${normalizeObjectId(profissional)}|${normalizeObjectId(store)}`;

const defaultCommissionCalculationOptions = () => ({
  includeServices: true,
  includePdvSales: true,
});

const normalizeCommissionCalculationOptions = (config = null) => ({
  includeServices: config?.includeServices !== false,
  includePdvSales: config?.includePdvSales !== false,
});

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || ''));

const normalizeObjectId = (value) => {
  if (!value) return '';
  const raw = typeof value === 'object' && value !== null ? value._id || value.id : value;
  return raw ? String(raw) : '';
};

const buildProfessionalCommissionContext = (config = null) => {
  const serviceRuleMap = new Map();
  const groupRuleMap = new Map();

  (Array.isArray(config?.serviceRules) ? config.serviceRules : []).forEach((rule) => {
    const serviceId = normalizeObjectId(rule?.service);
    const percent = parseNumber(rule?.percent);
    if (!serviceId || percent === null) return;
    serviceRuleMap.set(serviceId, percent);
  });

  (Array.isArray(config?.groupRules) ? config.groupRules : []).forEach((rule) => {
    const groupId = normalizeObjectId(rule?.group);
    const percent = parseNumber(rule?.percent);
    if (!groupId || percent === null) return;
    groupRuleMap.set(groupId, percent);
  });

  return { serviceRuleMap, groupRuleMap };
};

const firstNumericValue = (...values) => {
  for (const value of values) {
    const parsed = parseNumber(value);
    if (parsed !== null) return parsed;
  }
  return null;
};

const resolveServiceCommissionPercent = ({
  professionalCommission = null,
  serviceId = '',
  groupId = '',
  servicePercent = null,
  groupPercent = null,
  itemPercent = null,
  fallbackPercent = 0,
} = {}) => {
  const normalizedServiceId = normalizeObjectId(serviceId);
  const normalizedGroupId = normalizeObjectId(groupId);

  if (normalizedServiceId && professionalCommission?.serviceRuleMap?.has(normalizedServiceId)) {
    return professionalCommission.serviceRuleMap.get(normalizedServiceId);
  }
  if (normalizedGroupId && professionalCommission?.groupRuleMap?.has(normalizedGroupId)) {
    return professionalCommission.groupRuleMap.get(normalizedGroupId);
  }

  return firstNumericValue(servicePercent, groupPercent, itemPercent, fallbackPercent) ?? 0;
};

const normalizeCalendarDateKey = (value) => {
  if (!value) return '';

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? '' : getCalendarDateKeyInSaoPaulo(value);
  }

  const match = String(value).trim().match(CALENDAR_DATE_PATTERN);
  if (!match) return '';
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const validation = new Date(Date.UTC(year, month - 1, day));
  if (
    validation.getUTCFullYear() !== year ||
    validation.getUTCMonth() !== month - 1 ||
    validation.getUTCDate() !== day
  ) {
    return '';
  }
  return `${match[1]}-${match[2]}-${match[3]}`;
};

const getCalendarDateKeyInSaoPaulo = (value = new Date()) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: SAO_PAULO_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  return `${byType.get('year')}-${byType.get('month')}-${byType.get('day')}`;
};

const calendarDateToInstant = (value, { endOfDay = false } = {}) => {
  const dateKey = normalizeCalendarDateKey(value);
  if (!dateKey) return null;
  const clock = endOfDay ? '23:59:59.999' : '00:00:00.000';
  const date = new Date(`${dateKey}T${clock}-03:00`);
  return Number.isNaN(date.getTime()) ? null : date;
};

const toStartOfDay = (value) => calendarDateToInstant(value);
const toEndOfDay = (value) => calendarDateToInstant(value, { endOfDay: true });

const addCalendarDays = (value, days = 0) => {
  const dateKey = normalizeCalendarDateKey(value);
  if (!dateKey) return '';
  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + Number(days || 0)));
  return date.toISOString().slice(0, 10);
};

const normalizeAppointmentTimeKey = (value) => {
  const match = String(value || '').trim().match(CLOCK_TIME_PATTERN);
  if (!match) return '';
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] || 0);
  if (hour > 23 || minute > 59 || second > 59) return '';
  return `${match[1]}:${match[2]}:${String(second).padStart(2, '0')}`;
};

const getAppointmentItemSchedule = (item = {}) => {
  const dateKey = normalizeCalendarDateKey(item?.data);
  if (!dateKey) return null;
  const timeKey = normalizeAppointmentTimeKey(item?.hora);
  return {
    dateKey,
    timeKey,
    sortKey: `${dateKey}T${timeKey || '00:00:00'}`,
  };
};

const isCalendarDateInRange = (dateKey, startDateKey = '', endDateKey = '') => {
  const normalized = normalizeCalendarDateKey(dateKey);
  if (!normalized) return false;
  if (startDateKey && normalized < startDateKey) return false;
  if (endDateKey && normalized > endDateKey) return false;
  return true;
};

const formatCalendarDate = (value) => {
  const dateKey = normalizeCalendarDateKey(value);
  if (!dateKey) return '--';
  const [year, month, day] = dateKey.split('-');
  return `${day}/${month}/${year}`;
};

const getClosingPeriodStartKey = (closing = {}) =>
  normalizeCalendarDateKey(closing?.periodoInicioData) ||
  (closing?.periodoInicio ? getCalendarDateKeyInSaoPaulo(closing.periodoInicio) : '');

const getClosingPeriodEndKey = (closing = {}) =>
  normalizeCalendarDateKey(closing?.periodoFimData) ||
  (closing?.periodoFim ? getCalendarDateKeyInSaoPaulo(closing.periodoFim) : '');

const parsePaymentSchedule = ({ value = null, date = '', time = '' } = {}) => {
  const dateKey = normalizeCalendarDateKey(date) || normalizeCalendarDateKey(value);
  if (!dateKey) return null;
  const embeddedTime = String(value || '').match(/T(\d{2}:\d{2}(?::\d{2})?)/)?.[1] || '';
  const timeKey = normalizeAppointmentTimeKey(time || embeddedTime);
  const instant = new Date(`${dateKey}T${timeKey || '23:59:59'}-03:00`);
  if (Number.isNaN(instant.getTime())) return null;
  return {
    dateKey,
    timeKey: timeKey ? timeKey.slice(0, 5) : '',
    instant,
  };
};

const getClockTimeInSaoPaulo = (value = new Date()) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: SAO_PAULO_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  return `${byType.get('hour')}:${byType.get('minute')}:${byType.get('second')}`;
};

const getActorId = (req) => req.user?.id || req.user?._id || null;

const addClosingAudit = (closing, { action, user, reason = '', metadata = null, at = new Date() }) => {
  if (!closing) return;
  if (!Array.isArray(closing.auditTrail)) closing.auditTrail = [];
  closing.auditTrail.push({
    action,
    at,
    date: getCalendarDateKeyInSaoPaulo(at),
    time: getClockTimeInSaoPaulo(at).slice(0, 5),
    user: user || null,
    reason: String(reason || '').trim(),
    metadata,
  });
};

const resolveUserStoreAccess = async (req, userId) => {
  if (!userId) return { allowedStoreIds: [], allowAllStores: false };
  const user = await User.findById(userId).select('empresaPrincipal empresas role').lean();
  if (!user) return { allowedStoreIds: [], allowAllStores: false };
  if (hasAdminMasterGlobalAccess(req, user)) {
    return { allowedStoreIds: [], allowAllStores: true };
  }

  const allowedSet = new Set();
  if (user.empresaPrincipal && isValidObjectId(user.empresaPrincipal)) {
    allowedSet.add(String(user.empresaPrincipal));
  }
  if (Array.isArray(user.empresas)) {
    user.empresas.forEach((id) => {
      if (isValidObjectId(id)) allowedSet.add(String(id));
    });
  }

  const allowedStoreIds = Array.from(allowedSet);
  const allowAllStores = false;

  return { allowedStoreIds, allowAllStores };
};

const generatePayableCode = () => `COM-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

const syncPayableForClosing = async ({ closing, createIfMissing = true }) => {
  if (!closing || !closing.store || !closing.profissional) return null;
  const totalValue = Number(closing.totalPeriodo || 0);
  if (!Number.isFinite(totalValue) || totalValue <= 0) {
    throw new Error('Fechamento sem valor positivo não pode gerar conta a pagar.');
  }
  const dueDate = closing.previsaoPagamento || closing.periodoFim || new Date();
  let payable = closing.payable ? await AccountPayable.findById(closing.payable) : null;
  if (!payable && !createIfMissing) return null;

  const config = await CommissionConfig.findOne({ store: closing.store }).lean();
  const accountingAccount = config?.accountingAccount || payable?.accountingAccount || null;
  const bankAccount = config?.bankAccount || payable?.bankAccount || null;
  if (!accountingAccount || !bankAccount) {
    throw new Error('Configure conta contábil e conta corrente na engrenagem antes de fechar comissões.');
  }

  const [accountingExists, bankExists] = await Promise.all([
    AccountingAccount.exists({
      _id: accountingAccount,
      paymentNature: 'contas_pagar',
      companies: closing.store,
    }),
    BankAccount.exists({ _id: bankAccount, company: closing.store }),
  ]);
  if (!accountingExists) throw new Error('Conta contábil configurada é inválida para a empresa.');
  if (!bankExists) throw new Error('Conta corrente configurada é inválida para a empresa.');

  const installmentStatus =
    closing.status === 'pago' ? 'paid' : closing.status === 'cancelado' ? 'cancelled' : 'pending';
  const periodLabel = `${getClosingPeriodStartKey(closing)} a ${getClosingPeriodEndKey(closing)}`;

  if (!payable) {
    let code = generatePayableCode();
    let exists = await AccountPayable.exists({ code });
    while (exists) {
      code = generatePayableCode();
      // eslint-disable-next-line no-await-in-loop
      exists = await AccountPayable.exists({ code });
    }
    payable = new AccountPayable({
      code,
      company: closing.store,
      partyType: 'User',
      party: closing.profissional,
      installmentsCount: 1,
      issueDate: new Date(),
      dueDate,
      totalValue,
      bankAccount,
      accountingAccount,
      notes: `Fechamento de comissão ${closing._id || ''} (${periodLabel})`,
      installments: [
        {
          number: 1,
          issueDate: new Date(),
          dueDate,
          value: totalValue,
          bankAccount,
          accountingAccount,
          status: installmentStatus,
        },
      ],
    });
  } else {
    payable.company = closing.store;
    payable.partyType = 'User';
    payable.party = closing.profissional;
    payable.dueDate = dueDate;
    payable.totalValue = totalValue;
    payable.bankAccount = bankAccount;
    payable.accountingAccount = accountingAccount;
    payable.notes = `Fechamento de comissão ${closing._id || ''} (${periodLabel})`;
    // Atualiza/gera parcela única
    if (!Array.isArray(payable.installments) || payable.installments.length === 0) {
      payable.installments = [
        {
          number: 1,
          issueDate: new Date(),
          dueDate,
          value: totalValue,
          bankAccount,
          accountingAccount,
          status: installmentStatus,
        },
      ];
    } else {
      const inst = payable.installments[0];
      inst.dueDate = dueDate;
      inst.value = totalValue;
      inst.bankAccount = bankAccount;
      inst.accountingAccount = accountingAccount;
      inst.status = installmentStatus;
      payable.installments = [inst];
    }
  }

  await payable.save();
  return payable;
};

const parseNumber = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value === null || value === undefined) return null;
  const normalized = String(value)
    .trim()
    .replace(/\s+/g, '')
    .replace(/\.(?=\d{3}(?:\D|$))/g, '')
    .replace(',', '.')
    .replace(/[^\d.-]/g, '')
    .replace(/(?!^)-/g, '');
  if (!normalized || normalized === '-' || normalized === '.') return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

const normalizeDigits = (value) => {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\D/g, '');
};

const normalizeName = (value = '') => {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
};

const normalizeStatus = (status) => {
  const value = (status || '').toString().toLowerCase();
  if (['completed', 'concluido', 'concluida', 'pago', 'paid'].includes(value)) return 'pago';
  if (['pending', 'pendente'].includes(value)) return 'pendente';
  if (['cancelado', 'cancelada', 'canceled', 'cancelled'].includes(value)) return 'cancelado';
  if (['aguardando', 'awaiting', 'em_andamento', 'processing'].includes(value)) return 'aguardando';
  return value || 'aguardando';
};

const normalizeServiceStatus = (status, fallback = 'agendado') => {
  if (!status) return fallback;
  const normalized = String(status)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[-\s]+/g, '_');
  return SERVICE_STATUS_VALUES.has(normalized) ? normalized : fallback;
};

const isServicoFinalizado = (status) => normalizeServiceStatus(status) === 'finalizado';

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
  const qty = deriveItemQuantity(item) || 0;
  const unit = deriveItemUnitPrice(item);
  return unit !== null ? qty * unit : 0;
};

const deriveSaleTotal = (sale = {}) => {
  const totals = sale?.receiptSnapshot?.totais || sale?.totais || {};
  const candidates = [
    totals?.liquido,
    totals?.total,
    totals?.totalGeral,
    totals?.pago,
    totals?.valorTotal,
    totals?.totalVenda,
    totals?.bruto,
    sale.total,
    sale.totalAmount,
    sale.valorTotal,
    sale.totalVenda,
    sale.totalGeral,
  ];
  for (const candidate of candidates) {
    const parsed = parseNumber(candidate);
    if (parsed !== null) return parsed;
  }

  const items = collectSaleItems(sale);
  if (!items.length) return 0;
  return items.reduce((acc, item) => acc + deriveItemTotal(item), 0);
};

const extractItemObjectId = (item = {}) => {
  const candidates = [
    item.productId,
    item.product_id,
    item.produtoId,
    item.produto_id,
    item.serviceId,
    item.service_id,
    item.servico,
    item.servicoId,
    item.servico_id,
    item.id,
    item._id,
    item.product?._id,
    item.produto?._id,
    item.productSnapshot?._id,
    item.produtoSnapshot?._id,
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const str = String(candidate);
    if (mongoose.Types.ObjectId.isValid(str)) return str;
  }

  return null;
};

const belongsToSeller = (sale = {}, { sellerIds, sellerCodes, operatorName, userEmail }) => {
  const seller = sale?.seller || {};
  const sellerEmails = new Set(
    [
      sale.sellerEmail,
      sale.receiptSnapshot?.meta?.operadorEmail,
      sale.receiptSnapshot?.meta?.emailOperador,
      seller.email,
    ]
      .filter(Boolean)
      .map((e) => String(e).toLowerCase().trim()),
  );

  const idCandidates = [
    seller._id,
    seller.id,
    seller._id?.toString?.(),
    seller.id?.toString?.(),
    sale.sellerId,
    typeof sale.seller === 'string' ? sale.seller : null,
    sale.receiptSnapshot?.meta?.operadorId,
    sale.receiptSnapshot?.meta?.userId,
  ].map((v) => (v ? String(v) : ''));

  for (const candidate of idCandidates) {
    if (candidate && sellerIds.has(candidate)) return true;
  }

  const codeCandidates = [
    sale.sellerCode,
    seller.codigo,
    seller.codigoCliente,
    seller.id,
    seller._id,
    sale.receiptSnapshot?.meta?.operadorId,
    sale.receiptSnapshot?.meta?.operadorCodigo,
    sale.receiptSnapshot?.meta?.codigoOperador,
    sale.receiptSnapshot?.meta?.userId,
    typeof sale.seller === 'string' ? sale.seller : null,
    sale.receiptSnapshot?.meta?.cpfOperador,
    sale.receiptSnapshot?.meta?.cnpjOperador,
    sale.receiptSnapshot?.meta?.documentoOperador,
  ]
    .map(normalizeDigits)
    .filter(Boolean);

  for (const code of codeCandidates) {
    if (sellerCodes.has(code)) return true;
  }

  const nameCandidates = [
    sale.receiptSnapshot?.meta?.operador,
    sale.receiptSnapshot?.meta?.vendedor,
    sale.receiptSnapshot?.meta?.atendente,
    sale.receiptSnapshot?.meta?.usuario,
    sale.receiptSnapshot?.meta?.userName,
    sale.sellerName,
    seller.nome,
    seller.name,
    seller.fullName,
    seller.username,
    sale.receiptSnapshot?.meta?.operadorNome,
    sale.receiptSnapshot?.meta?.nomeOperador,
    sale.receiptSnapshot?.meta?.userName,
  ]
    .map((v) => normalizeName(v))
    .filter(Boolean);

  const operator = normalizeName(
    sale.receiptSnapshot?.meta?.operador || sale.sellerName || seller.nome || seller.name || '',
  );

  if (operator && operatorName) {
    if (operator === operatorName) return true;
    if (operator.includes(operatorName) || operatorName.includes(operator)) return true;
  }

  if (operatorName) {
    for (const candidate of nameCandidates) {
      if (candidate === operatorName) return true;
      if (candidate && (candidate.includes(operatorName) || operatorName.includes(candidate))) {
        return true;
      }
    }
  }

  if (sellerEmails.size && userEmail) {
    if (sellerEmails.has(userEmail.toLowerCase())) return true;
  }

  return false;
};

const collectServicoItems = (appointment = {}) => {
  if (!appointment || typeof appointment !== 'object') return [];
  const items = Array.isArray(appointment.itens) ? appointment.itens : [];
  return items.filter((item) => item && typeof item === 'object');
};

const resolveServicoItemsForUser = (appointment = {}, userId = '') => {
  const normalizedId = userId ? String(userId) : '';
  if (!normalizedId) return { items: [], matchedByTopLevel: false };

  const items = collectServicoItems(appointment);
  const assigned = items.filter((item) => {
    const pid = item?.profissional?._id || item?.profissional;
    return pid && String(pid) === normalizedId;
  });

  const topMatches =
    appointment.profissional &&
    String(appointment.profissional?._id || appointment.profissional) === normalizedId;

  if (assigned.length) return { items: assigned, matchedByTopLevel: topMatches };
  if (topMatches) return { items, matchedByTopLevel: true };
  return { items: [], matchedByTopLevel: false };
};

const mapAppointmentToServicoRecords = (
  appointment = {},
  {
    userId,
    defaultPercent = 0,
    professionalCommission = null,
    startDateKey = '',
    endDateKey = '',
  } = {},
) => {
  const normalizedUserId = userId ? String(userId) : '';
  const { items, matchedByTopLevel } = resolveServicoItemsForUser(appointment, normalizedUserId);
  if (!items.length && !matchedByTopLevel) return [];

  // O código de venda identifica a origem, mas não comprova quitação. A comissão
  // de serviço só nasce quando o próprio agendamento está marcado como pago.
  const isPago = appointment.pago === true;
  // O pagamento pertence ao agendamento, mas a elegibilidade e o período pertencem a cada serviço.
  if (!isPago) return [];

  const fallbackPercent = Number.isFinite(defaultPercent) ? defaultPercent : 0;
  const getItemPercent = (item) =>
    resolveServiceCommissionPercent({
      professionalCommission,
      serviceId: item?.servico?._id || item?.servico || appointment?.servico?._id || appointment?.servico,
      groupId:
        item?.servico?.grupo?._id ||
        item?.servico?.grupo ||
        item?.grupo?._id ||
        item?.grupo ||
        appointment?.servico?.grupo?._id ||
        appointment?.servico?.grupo,
      servicePercent: item?.servico?.comissaoPercent ?? appointment?.servico?.comissaoPercent,
      groupPercent:
        item?.servico?.grupo?.comissaoPercent ??
        item?.grupo?.comissaoPercent ??
        appointment?.servico?.grupo?.comissaoPercent,
      itemPercent: item?.comissaoPercent,
      fallbackPercent,
    });

  return items
    .filter((item) => isServicoFinalizado(item?.status))
    .map((item, itemIndex) => ({ item, itemIndex, schedule: getAppointmentItemSchedule(item) }))
    .filter(({ schedule }) => (
      schedule && isCalendarDateInRange(schedule.dateKey, startDateKey, endDateKey)
    ))
    .map(({ item, itemIndex, schedule }) => {
      const valorServico = parseNumber(item?.valor) || 0;
      const percent = getItemPercent(item);
      const appliedPercent = percent !== null ? percent : fallbackPercent;
      const comissaoServico = valorServico * (appliedPercent / 100);
      const appointmentId = normalizeObjectId(appointment?._id);
      const itemId = normalizeObjectId(item?._id) || String(itemIndex);
      const serviceName =
        item?.servico?.nome ||
        appointment?.servico?.nome ||
        item?.nome ||
        appointment?.nome ||
        'Serviço';
      return {
        key: `appointment:${appointmentId || 'legacy'}:item:${itemId}:${schedule.sortKey}`,
        source: 'appointment_service',
        sourceDocumentId: appointmentId,
        sourceItemId: itemId,
        date: schedule.dateKey,
        time: schedule.timeKey ? schedule.timeKey.slice(0, 5) : '',
        petName:
          appointment?.pet?.nome || appointment?.pet?.name || appointment?.petNome || appointment?.nomePet || 'Pet',
        description: serviceName,
        saleCode: String(appointment?.codigoVenda || '').trim(),
        value: valorServico,
        percent: appliedPercent,
        commission: comissaoServico,
        _scheduleDate: schedule.dateKey,
        _scheduleTime: schedule.timeKey,
        _scheduleSortKey: schedule.sortKey,
        comissaoServico,
        comissaoTotal: comissaoServico,
        valorVenda: valorServico,
        status: 'finalizado',
        isFinalizado: true,
        pago: true,
        aReceber: false,
      };
    });
};

const assertClosingStoreAccess = async (req, closing) => {
  const closingStore = normalizeObjectId(closing?.store);
  const { allowedStoreIds, allowAllStores } = await resolveUserStoreAccess(req, getActorId(req));
  if (allowAllStores) return;
  const allowed = new Set(allowedStoreIds.map(String));
  if (!closingStore || !allowed.has(closingStore)) {
    const error = new Error('Empresa nao permitida para o usuario.');
    error.statusCode = 403;
    throw error;
  }
};

const buildServicosRecords = (appointments = [], opts = {}) => {
  const records = [];
  appointments.forEach((appt) => {
    records.push(...mapAppointmentToServicoRecords(appt, opts));
  });
  return records;
};

const summarizeServiceRecords = (records = []) => {
  const totals = {
    totalServicos: 0,
    pendenteServicos: 0,
    totalPagoServicos: 0,
  };

  records.forEach((item) => {
    const valor = parseNumber(item.comissaoTotal) || 0;
    totals.totalServicos += valor;
    // Para repasse, tratamos todos como pendentes até quitar manualmente
    totals.pendenteServicos += valor;
  });

  return totals;
};

const summarizeSaleRecords = (records = []) => {
  const totals = {
    totalVendas: 0,
    totalPagoVendas: 0,
  };

  records.forEach((item) => {
    const status = normalizeStatus(item.status);
    // Comissão de venda só nasce depois que a venda foi concluída/paga.
    if (status !== 'pago') return;

    const comissaoTotal = (parseNumber(item.comissaoVenda) || 0) + (parseNumber(item.comissaoServico) || 0);
    totals.totalVendas += comissaoTotal;
    // Para repasse, consideramos tudo pendente até quitação manual
  });

  return totals;
};

const buildSaleRecord = (
  sale = {},
  {
    comissaoPercent = 0,
    comissaoServicoPercent = 0,
    serviceIdSet = new Set(),
    productIdSet = new Set(),
    serviceMetaMap = new Map(),
    professionalCommission = null,
    excludeServiceItems = false,
  },
) => {
  const items = collectSaleItems(sale);
  let valorProdutos = 0;
  let valorServicos = 0;
  let comissaoProdutos = 0;
  let comissaoServicos = 0;
  let hasItemProdPercent = false;
  let hasItemSvcPercent = false;
  const detailRows = [];
  const saleDate = getSaleDate(sale);
  const dateKey = saleDate ? getCalendarDateKeyInSaoPaulo(saleDate) : '';
  const saleId = String(sale?._saleId || sale?.id || sale?._id || '').trim();
  const saleCode = String(sale?.saleCode || sale?.saleCodeLabel || saleId || '').trim();

  const resolvePercent = (item = {}) => {
    const candidate =
      item.comissaoPercent ??
      item.comissao ??
      item.comissaoVenda ??
      item.comissaoVendaPercent ??
      item.commission ??
      item.commissionPercent ??
      item.percentualComissao ??
      item.percentualComissaoVenda;
    if (candidate === undefined || candidate === null || candidate === '') return null;
    const parsed = parseNumber(candidate);
    return Number.isFinite(parsed) ? parsed : null;
  };

  items.forEach((item, itemIndex) => {
    const total = deriveItemTotal(item);
    const oid = extractItemObjectId(item);
    const isServicoId = oid && serviceIdSet.has(oid);
    const isProdutoId = oid && productIdSet.has(oid);
    const isProdutoSnapshot = item.productSnapshot || item.product || item.produto;
    const isServico = isServicoId || (!isProdutoId && !isProdutoSnapshot && item.servico);

    if (isServico) {
      if (excludeServiceItems) return;
      valorServicos += total;
      const serviceMeta = oid ? serviceMetaMap.get(oid) : null;
      const percent = resolveServiceCommissionPercent({
        professionalCommission,
        serviceId: serviceMeta?.serviceId || oid,
        groupId:
          serviceMeta?.groupId ||
          item?.servico?.grupo?._id ||
          item?.servico?.grupo ||
          item?.grupo?._id ||
          item?.grupo,
        servicePercent: serviceMeta?.servicePercent ?? item?.servico?.comissaoPercent,
        groupPercent:
          serviceMeta?.groupPercent ??
          item?.servico?.grupo?.comissaoPercent ??
          item?.grupo?.comissaoPercent,
        itemPercent: resolvePercent(item),
        fallbackPercent: comissaoServicoPercent,
      });
      const applied = percent !== null ? percent : comissaoServicoPercent;
      if (percent !== null) hasItemSvcPercent = true;
      const itemCommission = total * (applied / 100);
      comissaoServicos += itemCommission;
      detailRows.push({
        key: `pdv:${saleId || 'legacy'}:item:${itemIndex}:service`,
        source: 'pdv_product',
        sourceDocumentId: saleId,
        sourceItemId: String(itemIndex),
        date: dateKey,
        time: saleDate
          ? new Intl.DateTimeFormat('pt-BR', {
              timeZone: SAO_PAULO_TIME_ZONE,
              hour: '2-digit',
              minute: '2-digit',
              hour12: false,
            }).format(saleDate)
          : '',
        petName: '',
        description: String(item?.name || item?.nome || item?.descricao || 'Serviço PDV'),
        saleCode,
        value: total,
        percent: applied,
        commission: itemCommission,
        status: normalizeStatus(sale.status),
        paid: normalizeStatus(sale.status) === 'pago',
      });
    } else {
      valorProdutos += total;
      const percent = resolvePercent(item);
      const applied = percent !== null ? percent : comissaoPercent;
      if (percent !== null) hasItemProdPercent = true;
      const itemCommission = total * (applied / 100);
      comissaoProdutos += itemCommission;
      detailRows.push({
        key: `pdv:${saleId || 'legacy'}:item:${itemIndex}:product`,
        source: 'pdv_product',
        sourceDocumentId: saleId,
        sourceItemId: String(itemIndex),
        date: dateKey,
        time: saleDate
          ? new Intl.DateTimeFormat('pt-BR', {
              timeZone: SAO_PAULO_TIME_ZONE,
              hour: '2-digit',
              minute: '2-digit',
              hour12: false,
            }).format(saleDate)
          : '',
        petName: '',
        description: String(
          item?.name || item?.nome || item?.descricao || item?.productSnapshot?.nome || 'Produto',
        ),
        saleCode,
        value: total,
        percent: applied,
        commission: itemCommission,
        status: normalizeStatus(sale.status),
        paid: normalizeStatus(sale.status) === 'pago',
      });
    }
  });

  let vendaBase = valorProdutos;
  let servicoBase = valorServicos;

  // Fallback: se itens não trouxeram valores, usa total da venda como base de produto.
  if (vendaBase + servicoBase === 0) {
    const totalVenda = deriveSaleTotal(sale);
    vendaBase = totalVenda;
    if (totalVenda > 0) {
      detailRows.push({
        key: `pdv:${saleId || 'legacy'}:sale`,
        source: 'pdv_product',
        sourceDocumentId: saleId,
        sourceItemId: '',
        date: dateKey,
        time: saleDate
          ? new Intl.DateTimeFormat('pt-BR', {
              timeZone: SAO_PAULO_TIME_ZONE,
              hour: '2-digit',
              minute: '2-digit',
              hour12: false,
            }).format(saleDate)
          : '',
        petName: '',
        description: 'Venda PDV',
        saleCode,
        value: totalVenda,
        percent: comissaoPercent,
        commission: totalVenda * (comissaoPercent / 100),
        status: normalizeStatus(sale.status),
        paid: normalizeStatus(sale.status) === 'pago',
      });
    }
  }

  const comissaoVenda = hasItemProdPercent ? comissaoProdutos : vendaBase * (comissaoPercent / 100);
  const comissaoServico = hasItemSvcPercent ? comissaoServicos : servicoBase * (comissaoServicoPercent / 100);
  const comissaoTotal = comissaoVenda + comissaoServico;

  const createdAt = sale.createdAt ? new Date(sale.createdAt) : null;
  const status = normalizeStatus(sale.status);
  const valorVenda = deriveSaleTotal(sale) || vendaBase + servicoBase;

  return {
    _createdAt: createdAt,
    status,
    pago: status === 'pago',
    comissaoVenda,
    comissaoServico,
    comissaoTotal,
    valorVenda,
    valorProdutos,
    valorServicos,
    rows: detailRows,
  };
};

const getSalesPool = async ({ storeId = null, startDate = null, endDate = null, runtimeContext = null }) => {
  const ctx = ensureSummaryRuntimeContext(runtimeContext);
  const cacheKey = buildSummaryCacheKey({ storeId, startDate, endDate });
  if (ctx?.salesPoolByKey?.has(cacheKey)) {
    return ctx.salesPoolByKey.get(cacheKey);
  }

  const pipeline = [];
  if (storeId && isValidObjectId(storeId)) {
    pipeline.push({ $match: { empresa: new mongoose.Types.ObjectId(String(storeId)) } });
  }

  pipeline.push(
    { $match: { 'completedSales.0': { $exists: true } } },
    { $unwind: '$completedSales' },
  );

  const createdAtMatch = {};
  if (startDate) createdAtMatch.$gte = startDate;
  if (endDate) createdAtMatch.$lte = endDate;
  if (Object.keys(createdAtMatch).length) {
    pipeline.push({
      $match: {
        $or: [
          { 'completedSales.createdAt': createdAtMatch },
          { 'completedSales.createdAt': { $exists: false } },
          { 'completedSales.createdAt': null },
        ],
      },
    });
  }

  pipeline.push(
    {
      $project: {
        _saleId: { $ifNull: ['$completedSales.id', '$completedSales._id'] },
        _pdvStateId: '$_id',
        _storeId: '$empresa',
        seller: '$completedSales.seller',
        sellerId: '$completedSales.sellerId',
        sellerCode: '$completedSales.sellerCode',
        sellerName: '$completedSales.sellerName',
        sellerEmail: '$completedSales.sellerEmail',
        saleCode: '$completedSales.saleCode',
        saleCodeLabel: '$completedSales.saleCodeLabel',
        status: '$completedSales.status',
        createdAt: '$completedSales.createdAt',
        createdAtLabel: '$completedSales.createdAtLabel',
        total: '$completedSales.total',
        totalAmount: '$completedSales.totalAmount',
        valorTotal: '$completedSales.valorTotal',
        totalVenda: '$completedSales.totalVenda',
        totalGeral: '$completedSales.totalGeral',
        items: '$completedSales.items',
        itemsSnapshot: '$completedSales.itemsSnapshot',
        fiscalItemsSnapshot: '$completedSales.fiscalItemsSnapshot',
        receiptSnapshot: {
          meta: '$completedSales.receiptSnapshot.meta',
          createdAt: '$completedSales.receiptSnapshot.createdAt',
          createdAtLabel: '$completedSales.receiptSnapshot.createdAtLabel',
          data: '$completedSales.receiptSnapshot.data',
          dataVenda: '$completedSales.receiptSnapshot.dataVenda',
          emitidoEm: '$completedSales.receiptSnapshot.emitidoEm',
          emittedAt: '$completedSales.receiptSnapshot.emittedAt',
          totais: '$completedSales.receiptSnapshot.totais',
          items: '$completedSales.receiptSnapshot.items',
          itens: '$completedSales.receiptSnapshot.itens',
          products: '$completedSales.receiptSnapshot.products',
          produtos: '$completedSales.receiptSnapshot.produtos',
          cart: {
            items: '$completedSales.receiptSnapshot.cart.items',
            itens: '$completedSales.receiptSnapshot.cart.itens',
            products: '$completedSales.receiptSnapshot.cart.products',
            produtos: '$completedSales.receiptSnapshot.cart.produtos',
          },
        },
      },
    },
  );

  const aggregated = await PdvState.aggregate(pipeline).allowDiskUse(true);
  const pool = aggregated;

  if (ctx) ctx.salesPoolByKey.set(cacheKey, pool);
  return pool;
};

const fetchSalesForUser = async ({
  user,
  startDate = null,
  endDate = null,
  storeId = null,
  debug = false,
  runtimeContext = null,
}) => {
  const sellerIds = new Set();
  const sellerCodes = new Set();

  if (user?._id) sellerIds.add(String(user._id));
  if (user?.codigoCliente) sellerCodes.add(normalizeDigits(user.codigoCliente));
  if (user?.cpf) sellerCodes.add(normalizeDigits(user.cpf));
  const operatorName = normalizeName(
    user?.nomeCompleto || user?.nomeContato || user?.razaoSocial || user?.email || '',
  );
  const userEmail = (user?.email || '').toString().toLowerCase().trim();

  const salesPool = await getSalesPool({ storeId, startDate, endDate, runtimeContext });

  const matched = [];
  const unmatched = [];

  salesPool.forEach((sale) => {
    const belongs = belongsToSeller(sale, { sellerIds, sellerCodes, operatorName, userEmail });
    if (!belongs) {
      if (debug && unmatched.length < 25) {
        unmatched.push({
          saleCode: sale.saleCode || sale.saleCodeLabel || sale.id || '',
          sellerId: sale.sellerId || sale.seller?._id || sale.seller?.id || sale.seller || '',
          sellerCode: sale.sellerCode || sale.seller?.codigo || sale.seller?.codigoCliente || '',
          sellerName: sale.sellerName || sale.seller?.nome || sale.seller?.name || '',
          meta: sale.receiptSnapshot?.meta || null,
        });
      }
      return;
    }

    if (startDate || endDate) {
      const saleDate = getSaleDate(sale);
      // Sem data comprovável a venda não pode ser atribuída a um período financeiro.
      if (!saleDate) return;
      if (startDate && saleDate < startDate) return;
      if (endDate && saleDate > endDate) return;
    }
    matched.push(sale);
  });

  return {
    sales: matched,
    aggregatedTotal: salesPool.length,
    matched: matched.length,
    unmatched,
  };
};

const fetchServicoRecords = async ({
  user,
  startDateKey = '',
  endDateKey = '',
  storeId = null,
  defaultPercent = 0,
  professionalCommission = null,
  runtimeContext = null,
}) => {
  if (!user?._id) return [];

  const profissionalId = isValidObjectId(user._id)
    ? new mongoose.Types.ObjectId(String(user._id))
    : null;

  const normalizedStartDateKey = normalizeCalendarDateKey(startDateKey);
  const normalizedEndDateKey = normalizeCalendarDateKey(endDateKey);
  const serviceDateMatch = {};
  if (normalizedStartDateKey) serviceDateMatch.$gte = normalizedStartDateKey;
  if (normalizedEndDateKey) serviceDateMatch.$lte = normalizedEndDateKey;

  const serviceQuery = {};
  if (Object.keys(serviceDateMatch).length) {
    // Campo literal preenchido no item da agenda; não usar scheduledAt/createdAt para o relatório.
    serviceQuery['itens.data'] = serviceDateMatch;
  }
  if (profissionalId) {
    serviceQuery.$and = (serviceQuery.$and || []).concat({
      $or: [
        { profissional: profissionalId },
        { 'itens.profissional': profissionalId },
      ],
    });
  }
  if (storeId && isValidObjectId(storeId)) {
    serviceQuery.store = new mongoose.Types.ObjectId(String(storeId));
  }

  const appointments = profissionalId
    ? await Appointment.find(serviceQuery)
        .select(
          'itens valor pago codigoVenda status profissional servico store pet',
        )
        .populate('pet', 'nome')
        .populate({
          path: 'itens.servico',
          select: 'nome grupo comissaoPercent',
          populate: { path: 'grupo', select: 'nome comissaoPercent' },
        })
        .populate({
          path: 'servico',
          select: 'nome grupo comissaoPercent',
          populate: { path: 'grupo', select: 'nome comissaoPercent' },
        })
        .lean()
    : [];

  return buildServicosRecords(appointments, {
    userId: user._id,
    comissaoServicoPercent: defaultPercent,
    defaultPercent,
    professionalCommission,
    startDateKey: normalizedStartDateKey,
    endDateKey: normalizedEndDateKey,
  });
};

const fetchServiceEligibilityAudit = async ({
  user,
  startDateKey = '',
  endDateKey = '',
  storeId = null,
}) => {
  const profissionalId = normalizeObjectId(user?._id || user);
  if (!profissionalId || !isValidObjectId(profissionalId)) {
    return { eligible: 0, excludedUnpaid: 0, excludedNotFinalized: 0, exclusions: [] };
  }
  const query = {
    'itens.data': { $gte: startDateKey, $lte: endDateKey },
    $or: [
      { profissional: new mongoose.Types.ObjectId(profissionalId) },
      { 'itens.profissional': new mongoose.Types.ObjectId(profissionalId) },
    ],
  };
  if (storeId && isValidObjectId(storeId)) query.store = new mongoose.Types.ObjectId(String(storeId));

  const appointments = await Appointment.find(query)
    .select('_id itens pago codigoVenda profissional servico pet')
    .populate('pet', 'nome')
    .populate('itens.servico', 'nome')
    .populate('servico', 'nome')
    .lean();
  const audit = { eligible: 0, excludedUnpaid: 0, excludedNotFinalized: 0, exclusions: [] };
  appointments.forEach((appointment) => {
    const { items } = resolveServicoItemsForUser(appointment, profissionalId);
    const paid = appointment.pago === true;
    items.forEach((item) => {
      const schedule = getAppointmentItemSchedule(item);
      if (!schedule || !isCalendarDateInRange(schedule.dateKey, startDateKey, endDateKey)) return;
      let reason = '';
      if (!isServicoFinalizado(item?.status)) {
        reason = 'Serviço ainda não finalizado';
        audit.excludedNotFinalized += 1;
      } else if (!paid) {
        reason = 'Agendamento ainda não pago';
        audit.excludedUnpaid += 1;
      } else {
        audit.eligible += 1;
        return;
      }
      audit.exclusions.push({
        source: 'appointment_service',
        sourceDocumentId: normalizeObjectId(appointment._id),
        sourceItemId: normalizeObjectId(item?._id),
        date: schedule.dateKey,
        time: schedule.timeKey.slice(0, 5),
        petName: appointment?.pet?.nome || 'Pet',
        description: item?.servico?.nome || appointment?.servico?.nome || item?.nome || 'Serviço',
        saleCode: String(appointment.codigoVenda || '').trim(),
        value: roundCurrency(item?.valor),
        status: String(item?.status || ''),
        reason,
      });
    });
  });
  audit.exclusions.sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`));
  return audit;
};

const buildServiceCommissionRows = ({
  appointments = [],
  user = null,
  defaultPercent = 0,
  professionalCommission = null,
  startDateKey = '',
  endDateKey = '',
}) => {
  const normalizedUserId = normalizeObjectId(user?._id || user);
  if (!normalizedUserId) return [];

  const rows = [];
  const fallbackPercent = Number.isFinite(defaultPercent) ? defaultPercent : 0;

  appointments.forEach((appointment) => {
    const petNome =
      appointment?.pet?.nome ||
      appointment?.pet?.name ||
      appointment?.petNome ||
      appointment?.nomePet ||
      'Pet';
    const { items, matchedByTopLevel } = resolveServicoItemsForUser(appointment, normalizedUserId);
    const isPago = appointment?.pago === true;
    if (!isPago) return;

    if (items.length) {
      items.forEach((item) => {
        if (!isServicoFinalizado(item?.status)) return;
        const schedule = getAppointmentItemSchedule(item);
        if (!schedule || !isCalendarDateInRange(schedule.dateKey, startDateKey, endDateKey)) return;
        const valor = parseNumber(item?.valor) || 0;
        const percentual = resolveServiceCommissionPercent({
          professionalCommission,
          serviceId: item?.servico?._id || item?.servico || appointment?.servico?._id || appointment?.servico,
          groupId:
            item?.servico?.grupo?._id ||
            item?.servico?.grupo ||
            item?.grupo?._id ||
            item?.grupo ||
            appointment?.servico?.grupo?._id ||
            appointment?.servico?.grupo,
          servicePercent: item?.servico?.comissaoPercent ?? appointment?.servico?.comissaoPercent,
          groupPercent:
            item?.servico?.grupo?.comissaoPercent ??
            item?.grupo?.comissaoPercent ??
            appointment?.servico?.grupo?.comissaoPercent,
          itemPercent: item?.comissaoPercent,
          fallbackPercent,
        });
        const appliedPercent = percentual !== null ? percentual : fallbackPercent;
        const comissao = valor * (appliedPercent / 100);
        rows.push({
          petNome,
          servicoNome:
            item?.servico?.nome ||
            appointment?.servico?.nome ||
            item?.nome ||
            appointment?.nome ||
            'Serviço',
          data: `${formatCalendarDate(schedule.dateKey)}${schedule.timeKey ? ` ${schedule.timeKey.slice(0, 5)}` : ''}`,
          dataRaw: schedule.sortKey,
          valor,
          percentual: appliedPercent,
          comissao,
        });
      });
      return;
    }

    if (matchedByTopLevel) {
      // Registros sem itens não possuem a data/hora literal do formulário e não entram no relatório.
      return;
    }
  });

  rows.sort((a, b) => {
    return String(a?.dataRaw || '').localeCompare(String(b?.dataRaw || ''));
  });

  return rows.map(({ dataRaw, ...rest }) => rest);
};

const computeCommissionSummaryForUser = async ({
  user,
  startDate = null,
  endDate = null,
  startDateKey = '',
  endDateKey = '',
  storeId = null,
  debug = false,
  runtimeContext = null,
  calculationOptions = null,
}) => {
  if (!user) return { totals: emptyTotals(), debug: { sales: 0, services: 0 } };
  const ctx = ensureSummaryRuntimeContext(runtimeContext);
  const options = calculationOptions || defaultCommissionCalculationOptions();
  const includeServices = options.includeServices !== false;
  const includePdvSales = options.includePdvSales !== false;
  const normalizedStartDateKey =
    normalizeCalendarDateKey(startDateKey) || normalizeCalendarDateKey(startDate);
  const normalizedEndDateKey =
    normalizeCalendarDateKey(endDateKey) || normalizeCalendarDateKey(endDate);

  let group = null;
  if (user.userGroup && typeof user.userGroup === 'object') {
    group = user.userGroup;
  } else if (user.userGroup && isValidObjectId(user.userGroup)) {
    group = await UserGroup.findById(user.userGroup)
      .select('comissaoPercent comissaoServicoPercent')
      .lean();
  }

  const comissaoPercent = Number(group?.comissaoPercent ?? DEFAULT_COMISSAO_PERCENT);
  const comissaoServicoPercent = Number(group?.comissaoServicoPercent ?? DEFAULT_COMISSAO_SERVICO_PERCENT);
  let professionalCommissionConfig = null;
  const userIdKey = user?._id ? String(user._id) : '';
  if (ctx?.professionalCommissionByUserId?.has(userIdKey)) {
    professionalCommissionConfig = ctx.professionalCommissionByUserId.get(userIdKey);
  } else {
    professionalCommissionConfig = await ProfessionalCommissionConfig.findOne({ user: user._id })
      .select('groupRules serviceRules')
      .lean();
    if (ctx && userIdKey) {
      ctx.professionalCommissionByUserId.set(userIdKey, professionalCommissionConfig || null);
    }
  }
  const professionalCommission = buildProfessionalCommissionContext(professionalCommissionConfig);

  const salesResult = includePdvSales
    ? await fetchSalesForUser({
        user,
        startDate,
        endDate,
        storeId,
        debug,
        runtimeContext: ctx,
      })
    : { sales: [], aggregatedTotal: 0, matched: 0, unmatched: [] };
  const { sales, aggregatedTotal, matched, unmatched } = salesResult;

  const itemIdSet = new Set();
  sales.forEach((sale) => {
    collectSaleItems(sale).forEach((item) => {
      const oid = extractItemObjectId(item);
      if (oid) itemIdSet.add(oid);
    });
  });

  const ids = Array.from(itemIdSet);
  if (ctx && ids.length) {
    const missingIds = ids.filter(
      (id) =>
        !ctx.serviceMetaById.has(id) &&
        !ctx.productIds.has(id) &&
        !ctx.unresolvedItemIds.has(id),
    );
    if (missingIds.length) {
      const [servicesMissing, productsMissing] = await Promise.all([
        Service.find({ _id: { $in: missingIds } })
          .select('_id grupo comissaoPercent')
          .populate('grupo', 'comissaoPercent')
          .lean(),
        Product.find({ _id: { $in: missingIds } }).select('_id').lean(),
      ]);

      const foundServiceIds = new Set();
      const foundProductIds = new Set();

      servicesMissing.forEach((service) => {
        const sid = String(service._id);
        foundServiceIds.add(sid);
        ctx.serviceMetaById.set(sid, {
          serviceId: sid,
          groupId: normalizeObjectId(service.grupo),
          servicePercent: parseNumber(service.comissaoPercent),
          groupPercent: parseNumber(service?.grupo?.comissaoPercent),
        });
      });

      productsMissing.forEach((product) => {
        const pid = String(product._id);
        foundProductIds.add(pid);
        ctx.productIds.add(pid);
      });

      missingIds.forEach((id) => {
        if (!foundServiceIds.has(id) && !foundProductIds.has(id)) {
          ctx.unresolvedItemIds.add(id);
        }
      });
    }
  }

  const serviceIdSet = new Set();
  const productIdSet = new Set();
  const serviceMetaMap = new Map();

  ids.forEach((id) => {
    const meta = ctx?.serviceMetaById?.get(id);
    if (meta) {
      serviceIdSet.add(id);
      serviceMetaMap.set(id, meta);
      return;
    }
    if (ctx?.productIds?.has(id)) {
      productIdSet.add(id);
    }
  });

  if (!ctx && ids.length) {
    const [services, products] = await Promise.all([
      Service.find({ _id: { $in: ids } })
        .select('_id grupo comissaoPercent')
        .populate('grupo', 'comissaoPercent')
        .lean(),
      Product.find({ _id: { $in: ids } }).select('_id').lean(),
    ]);
    services.forEach((service) => {
      const sid = String(service._id);
      serviceIdSet.add(sid);
      serviceMetaMap.set(sid, {
        serviceId: sid,
        groupId: normalizeObjectId(service.grupo),
        servicePercent: parseNumber(service.comissaoPercent),
        groupPercent: parseNumber(service?.grupo?.comissaoPercent),
      });
    });
    products.forEach((product) => {
      productIdSet.add(String(product._id));
    });
  }

  const saleRecords = sales.map((sale) =>
    buildSaleRecord(sale, {
      comissaoPercent,
      comissaoServicoPercent,
      serviceIdSet,
      productIdSet,
      serviceMetaMap,
      professionalCommission,
      excludeServiceItems: includeServices,
    }),
  );

  const saleTotals = summarizeSaleRecords(saleRecords);

  const servicoRecords = includeServices
    ? await fetchServicoRecords({
        user,
        startDateKey: normalizedStartDateKey,
        endDateKey: normalizedEndDateKey,
        storeId,
        defaultPercent: comissaoServicoPercent,
        professionalCommission,
        runtimeContext: ctx,
      })
    : [];
  const servicoTotals = summarizeServiceRecords(servicoRecords);

  const totalVendas = saleTotals.totalVendas;
  const pendenteVendas = Math.max(totalVendas - saleTotals.totalPagoVendas, 0);
  const totalServicos = servicoTotals.totalServicos;
  const pendenteServicos = Math.max(totalServicos - servicoTotals.totalPagoServicos, 0);
  const totalPeriodo = totalVendas + totalServicos;
  const totalPendente = pendenteVendas + pendenteServicos;
  const totalPago = 0; // pago ao profissional só quando marcado manualmente

  return {
    totals: {
      totalPeriodo,
      totalPendente,
      totalVendas,
      totalServicos,
      pendenteVendas,
      pendenteServicos,
      totalPago,
    },
    debug: {
      sales: sales.length,
      services: servicoRecords.length,
      salesAggregated: aggregatedTotal,
      salesMatched: matched,
      salesUnmatched: unmatched,
      includeServices,
      includePdvSales,
    },
    items: [
      ...saleRecords
        .filter((record) => normalizeStatus(record.status) === 'pago')
        .flatMap((record) => (Array.isArray(record.rows) ? record.rows : [])),
      ...servicoRecords,
    ]
      .filter((item) => Number(item?.commission || 0) > 0)
      .sort((a, b) => `${a?.date || ''}T${a?.time || ''}`.localeCompare(`${b?.date || ''}T${b?.time || ''}`)),
  };
};

const pickUserName = (user = {}) =>
  user.nomeCompleto || user.nomeContato || user.razaoSocial || user.nome || user.email || 'Sem nome';

const roundCurrency = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

const buildTotalsFromItems = (items = []) => {
  const totals = emptyTotals();
  items.forEach((item) => {
    const commission = roundCurrency(item?.commission);
    if (commission <= 0) return;
    if (item?.source === 'appointment_service') totals.totalServicos += commission;
    else totals.totalVendas += commission;
  });
  totals.totalVendas = roundCurrency(totals.totalVendas);
  totals.totalServicos = roundCurrency(totals.totalServicos);
  totals.pendenteVendas = totals.totalVendas;
  totals.pendenteServicos = totals.totalServicos;
  totals.totalPeriodo = roundCurrency(totals.totalVendas + totals.totalServicos);
  totals.totalPendente = totals.totalPeriodo;
  return totals;
};

const sanitizeSnapshotItem = (item = {}) => ({
  key: String(item.key || '').trim(),
  source: item.source === 'appointment_service' ? 'appointment_service' : 'pdv_product',
  sourceDocumentId: String(item.sourceDocumentId || '').trim(),
  sourceItemId: String(item.sourceItemId || '').trim(),
  date: normalizeCalendarDateKey(item.date),
  time: normalizeAppointmentTimeKey(item.time).slice(0, 5),
  petName: String(item.petName || '').trim(),
  description: String(item.description || '').trim(),
  saleCode: String(item.saleCode || '').trim(),
  value: roundCurrency(item.value),
  percent: Number(item.percent || 0),
  commission: roundCurrency(item.commission),
  status: String(item.status || '').trim(),
  paid: item.paid === true,
});

const buildCommissionItemLockKey = ({ profissional, store, itemKey }) =>
  `${normalizeObjectId(store) || 'all'}|${normalizeObjectId(profissional)}|${String(itemKey || '').trim()}`;

const filterUnallocatedItems = async ({ items = [], profissional, store }) => {
  const sanitized = items
    .map(sanitizeSnapshotItem)
    .filter((item) => item.key && item.date && item.commission > 0)
    .slice(0, MAX_CLOSING_ITEMS);
  if (!sanitized.length) return { items: [], allocatedKeys: [] };
  const lockKeys = sanitized.map((item) =>
    buildCommissionItemLockKey({ profissional, store, itemKey: item.key }),
  );
  const existing = await CommissionItemLock.find({ key: { $in: lockKeys } }).select('key').lean();
  const allocated = new Set(existing.map((entry) => String(entry.key)));
  return {
    items: sanitized.filter(
      (item) => !allocated.has(buildCommissionItemLockKey({ profissional, store, itemKey: item.key })),
    ),
    allocatedKeys: lockKeys.filter((key) => allocated.has(key)),
  };
};

const calculateAvailableCommissionSummary = async ({
  user,
  startDate,
  endDate,
  startDateKey,
  endDateKey,
  storeId,
  debug = false,
  runtimeContext = null,
  calculationOptions = null,
}) => {
  const computed = await computeCommissionSummaryForUser({
    user,
    startDate,
    endDate,
    startDateKey,
    endDateKey,
    storeId,
    debug,
    runtimeContext,
    calculationOptions,
  });
  const availability = await filterUnallocatedItems({
    items: computed?.items || [],
    profissional: user?._id,
    store: storeId,
  });
  return {
    ...computed,
    grossTotals: computed?.totals || emptyTotals(),
    totals: buildTotalsFromItems(availability.items),
    items: availability.items,
    alreadyClosedItems: availability.allocatedKeys.length,
  };
};

const commissionTypeFromTotals = (totals = {}) => {
  const hasSales = Number(totals.totalVendas || 0) > 0;
  const hasServices = Number(totals.totalServicos || 0) > 0;
  if (hasSales && hasServices) return 'Misto';
  if (hasServices) return 'Serviços';
  if (hasSales) return 'Vendas';
  return 'Sem comissão';
};

const serializeClosingRecord = (closing = {}, { selectedStart = '', selectedEnd = '' } = {}) => {
  const startKey = getClosingPeriodStartKey(closing);
  const endKey = getClosingPeriodEndKey(closing);
  const profissionalId = normalizeObjectId(closing.profissional);
  const storeId = normalizeObjectId(closing.store);
  const snapshotItems = Array.isArray(closing.snapshotItems) ? closing.snapshotItems : [];
  const dueDateKey =
    normalizeCalendarDateKey(closing.previsaoPagamentoData) ||
    (closing.previsaoPagamento ? getCalendarDateKeyInSaoPaulo(closing.previsaoPagamento) : '');
  const totals = {
    totalPeriodo: Number(closing.totalPeriodo || 0),
    totalPendente: Number(closing.totalPendente || 0),
    totalVendas: Number(closing.totalVendas || 0),
    totalServicos: Number(closing.totalServicos || 0),
    pendenteVendas: Number(closing.pendenteVendas || 0),
    pendenteServicos: Number(closing.pendenteServicos || 0),
    totalPago: Number(closing.totalPago || 0),
  };
  const crossesSelection = Boolean(
    selectedStart && selectedEnd && startKey && endKey && (startKey < selectedStart || endKey > selectedEnd),
  );
  return {
    id: closing._id,
    profissional: closing.profissional?._id || closing.profissional,
    profissionalNome: pickUserName(closing.profissional),
    codigoProfissional: closing.profissional?.codigoCliente || '',
    store: closing.store?._id || closing.store || null,
    storeNome:
      closing.store?.nome || closing.store?.nomeFantasia || closing.store?.razaoSocial || '',
    periodoInicio: startKey,
    periodoFim: endKey,
    periodo: formatPeriod(startKey, endKey),
    previsto: totals.totalPeriodo,
    pago: totals.totalPago,
    pendente: totals.totalPendente,
    ...totals,
    tipo: commissionTypeFromTotals(totals),
    status: closing.status || 'pendente',
    kind: closing.kind || 'regular',
    previsaoPagamento: closing.previsaoPagamento || null,
    previsaoPagamentoData:
      dueDateKey,
    previsaoPagamentoHora:
      normalizeAppointmentTimeKey(closing.previsaoPagamentoHora).slice(0, 5),
    meioPagamento: closing.meioPagamento || '',
    paidAt: closing.paidAt || null,
    paidDate: normalizeCalendarDateKey(closing.paidDate),
    paidTime: normalizeAppointmentTimeKey(closing.paidTime).slice(0, 5),
    cancelledAt: closing.cancelledAt || null,
    cancellationReason: closing.cancellationReason || '',
    payable: closing.payable || null,
    snapshotVersion: Number(closing.snapshotVersion || 0),
    snapshotItemCount: snapshotItems.length,
    crossesSelection,
    legacyPeriod: !normalizeCalendarDateKey(closing.periodoInicioData) || !normalizeCalendarDateKey(closing.periodoFimData),
    overdue:
      closing.status === 'agendado' &&
      Boolean(dueDateKey && dueDateKey < getCalendarDateKeyInSaoPaulo()),
    createdAt: closing.createdAt || null,
    updatedAt: closing.updatedAt || null,
    auditTrail: Array.isArray(closing.auditTrail) ? closing.auditTrail : [],
    _professionalKey: profissionalId,
    _storeKey: storeId,
  };
};

const loadProfessionalsForStore = async (storeId = null) => {
  const roleFilter = {
    role: { $in: ['funcionario', 'franqueado', 'franqueador', 'admin', 'admin_master'] },
  };
  if (!storeId || !isValidObjectId(storeId)) {
    return User.find(roleFilter)
      .select('nomeCompleto nomeContato razaoSocial nome email userGroup codigoCliente empresas empresaPrincipal empresaContratual')
      .populate('userGroup', 'comissaoPercent comissaoServicoPercent')
      .sort({ nomeCompleto: 1, nomeContato: 1, razaoSocial: 1 })
      .lean();
  }

  const objectStoreId = new mongoose.Types.ObjectId(String(storeId));
  const [appointmentTopIds, appointmentItemIds, closingIds] = await Promise.all([
    Appointment.distinct('profissional', { store: objectStoreId }),
    Appointment.distinct('itens.profissional', { store: objectStoreId }),
    CommissionClosing.distinct('profissional', { store: objectStoreId }),
  ]);
  const historicalIds = [...appointmentTopIds, ...appointmentItemIds, ...closingIds]
    .map(normalizeObjectId)
    .filter(isValidObjectId)
    .map((id) => new mongoose.Types.ObjectId(id));

  return User.find({
    ...roleFilter,
    $or: [
      { empresas: objectStoreId },
      { empresaPrincipal: objectStoreId },
      { empresaContratual: objectStoreId },
      ...(historicalIds.length ? [{ _id: { $in: historicalIds } }] : []),
    ],
  })
    .select('nomeCompleto nomeContato razaoSocial nome email userGroup codigoCliente empresas empresaPrincipal empresaContratual')
    .populate('userGroup', 'comissaoPercent comissaoServicoPercent')
    .sort({ nomeCompleto: 1, nomeContato: 1, razaoSocial: 1 })
    .lean();
};

const formatPeriod = (inicio, fim) => {
  return `${formatCalendarDate(inicio)} a ${formatCalendarDate(fim)}`;
};

const getSaleDate = (sale = {}) => {
  const candidates = [
    sale.createdAt,
    sale.createdAtLabel,
    sale.receiptSnapshot?.createdAt,
    sale.receiptSnapshot?.createdAtLabel,
    sale.receiptSnapshot?.meta?.createdAt,
    sale.receiptSnapshot?.meta?.criadoEm,
    sale.receiptSnapshot?.meta?.data,
    sale.receiptSnapshot?.data,
    sale.receiptSnapshot?.dataVenda,
    sale.receiptSnapshot?.emitidoEm,
    sale.receiptSnapshot?.emittedAt,
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const date = candidate instanceof Date ? candidate : new Date(candidate);
    if (!Number.isNaN(date.getTime())) return date;
  }

  return null;
};

router.get(
  '/admin/comissoes/fechamentos/stores',
  requireAuth,
  authorizeRoles(...ADMIN_ROLES),
  async (req, res) => {
    try {
      const { allowedStoreIds, allowAllStores } = await resolveUserStoreAccess(req, req.user?.id);
      if (!allowAllStores && !allowedStoreIds.length) {
        return res.json([]);
      }

      const query = allowedStoreIds.length ? { _id: { $in: allowedStoreIds } } : {};

      const stores = await Store.find(query)
        .select('nome nomeFantasia razaoSocial _id')
        .sort({ nome: 1 })
        .lean();
      const payload = stores.map((store) => ({
        _id: store._id,
        nome: store.nome || store.nomeFantasia || store.razaoSocial || 'Empresa',
      }));
      return res.json(payload);
    } catch (error) {
      console.error('[adminComissoesFechamentos] stores', error);
      return res.status(500).json({ message: 'Nao foi possivel carregar lojas.' });
    }
  },
);

// Configuração de contas contábeis por empresa (usado no modal de engrenagem)
router.get(
  '/admin/comissoes/config/data',
  requireAuth,
  authorizeRoles(...ADMIN_ROLES),
  async (req, res) => {
    try {
      const requestedStoreId =
        req.query?.store && isValidObjectId(req.query.store) ? String(req.query.store) : null;
      const { allowedStoreIds, allowAllStores } = await resolveUserStoreAccess(req, req.user?.id);
      const allowedStoreSet = new Set(allowedStoreIds);
      if (!allowAllStores && (!requestedStoreId || !allowedStoreSet.has(requestedStoreId))) {
        return res.status(403).json({ message: 'Empresa nao permitida para o usuario.' });
      }
      const storeId = requestedStoreId || (allowAllStores ? null : allowedStoreIds[0]);
      if (!storeId) return res.status(400).json({ message: 'Informe a empresa.' });

      const [accounts, bankAccounts, config] = await Promise.all([
        AccountingAccount.find({
          paymentNature: 'contas_pagar',
          companies: storeId,
        })
          .select('name code _id')
          .sort({ code: 1 })
          .lean(),
        BankAccount.find({ company: storeId })
          .select('alias bankName bankCode agency accountNumber accountDigit _id')
          .sort({ alias: 1, bankName: 1 })
          .lean(),
        CommissionConfig.findOne({ store: storeId }).lean(),
      ]);

      return res.json({
        config: {
          accountingAccount: config?.accountingAccount ? String(config.accountingAccount) : null,
          bankAccount: config?.bankAccount ? String(config.bankAccount) : null,
          includeServices: config?.includeServices !== false,
          includePdvSales: config?.includePdvSales !== false,
          updatedAt: config?.updatedAt || config?.createdAt || null,
        },
        accounts: accounts.map((a) => ({
          _id: a._id,
          name: a.name,
          code: a.code,
        })),
        bankAccounts: bankAccounts.map((b) => ({
          _id: b._id,
          alias: b.alias,
          bankName: b.bankName,
          bankCode: b.bankCode,
          agency: b.agency,
          accountNumber: b.accountNumber,
          accountDigit: b.accountDigit,
        })),
      });
    } catch (error) {
      console.error('[adminComissoesFechamentos] config/data', error);
      return res.status(500).json({ message: 'Nao foi possivel carregar configuracao.' });
    }
  },
);

router.post(
  '/admin/comissoes/config',
  requireAuth,
  authorizeRoles(...ADMIN_ROLES),
  async (req, res) => {
    try {
      const { storeId, accountingAccount, bankAccount, includeServices, includePdvSales } = req.body || {};
      if (!storeId || !isValidObjectId(storeId)) {
        return res.status(400).json({ message: 'Informe a empresa.' });
      }
      const { allowedStoreIds, allowAllStores } = await resolveUserStoreAccess(req, req.user?.id);
      const allowedStoreSet = new Set(allowedStoreIds);
      if (!allowAllStores && !allowedStoreSet.has(String(storeId))) {
        return res.status(403).json({ message: 'Empresa nao permitida para o usuario.' });
      }

      let accountingAccountId = null;
      if (accountingAccount) {
        if (!isValidObjectId(accountingAccount)) {
          return res.status(400).json({ message: 'Conta contabil invalida.' });
        }
        const exists = await AccountingAccount.findOne({
          _id: accountingAccount,
          paymentNature: 'contas_pagar',
          companies: storeId,
        }).lean();
        if (!exists) {
          return res.status(404).json({ message: 'Conta contabil nao encontrada para a empresa.' });
        }
        accountingAccountId = accountingAccount;
      }

      let bankAccountId = null;
      if (bankAccount) {
        if (!isValidObjectId(bankAccount)) {
          return res.status(400).json({ message: 'Conta corrente invalida.' });
        }
        const existsBank = await BankAccount.findOne({ _id: bankAccount, company: storeId }).lean();
        if (!existsBank) {
          return res.status(404).json({ message: 'Conta corrente nao encontrada para a empresa.' });
        }
        bankAccountId = bankAccount;
      }

      const includeServicesNormalized = includeServices !== false;
      const includePdvSalesNormalized = includePdvSales !== false;

      const config = await CommissionConfig.findOneAndUpdate(
        { store: storeId },
        {
          store: storeId,
          accountingAccount: accountingAccountId,
          bankAccount: bankAccountId,
          includeServices: includeServicesNormalized,
          includePdvSales: includePdvSalesNormalized,
          updatedBy: req.user?.id || null,
          $setOnInsert: { createdBy: req.user?.id || null },
        },
        { upsert: true, new: true },
      ).lean();

      return res.json({
        accountingAccount: config.accountingAccount ? String(config.accountingAccount) : null,
        bankAccount: config.bankAccount ? String(config.bankAccount) : null,
        includeServices: config.includeServices !== false,
        includePdvSales: config.includePdvSales !== false,
        updatedAt: config.updatedAt || config.createdAt || null,
      });
    } catch (error) {
      console.error('[adminComissoesFechamentos] save config', error);
      return res.status(500).json({ message: 'Nao foi possivel salvar configuracao.' });
    }
  },
);

router.get(
  '/admin/comissoes/fechamentos/professionals',
  requireAuth,
  authorizeRoles(...ADMIN_ROLES),
  async (req, res) => {
    try {
      const requestedStoreId = req.query?.store && isValidObjectId(req.query.store)
        ? String(req.query.store)
        : null;
      const { allowedStoreIds, allowAllStores } = await resolveUserStoreAccess(req, getActorId(req));
      const allowed = new Set(allowedStoreIds.map(String));
      if (!allowAllStores && requestedStoreId && !allowed.has(requestedStoreId)) {
        return res.status(403).json({ message: 'Empresa nao permitida para o usuario.' });
      }
      const storeId = requestedStoreId || (!allowAllStores ? allowedStoreIds[0] || null : null);
      const professionals = await loadProfessionalsForStore(storeId);
      return res.json(
        professionals.map((professional) => ({
          id: professional._id,
          nome: pickUserName(professional),
          codigo: professional.codigoCliente || '',
        })),
      );
    } catch (error) {
      console.error('[adminComissoesFechamentos] professionals', error);
      return res.status(500).json({ message: 'Nao foi possivel carregar profissionais.' });
    }
  },
);

router.get(
  '/admin/comissoes/fechamentos/report',
  requireAuth,
  authorizeRoles(...ADMIN_ROLES),
  async (req, res) => {
    try {
      const requestedStoreId = req.query?.store && isValidObjectId(req.query.store)
        ? String(req.query.store)
        : null;
      const { allowedStoreIds, allowAllStores } = await resolveUserStoreAccess(req, getActorId(req));
      const allowed = new Set(allowedStoreIds.map(String));
      if (!allowAllStores && !allowed.size) {
        return res.json({ items: [], history: [], summary: emptyTotals(), anomalies: {} });
      }
      if (requestedStoreId && !allowAllStores && !allowed.has(requestedStoreId)) {
        return res.status(403).json({ message: 'Empresa nao permitida para o usuario.' });
      }
      const storeId = requestedStoreId || (!allowAllStores ? allowedStoreIds[0] || null : null);
      if (!storeId) {
        return res.status(400).json({ message: 'Selecione uma empresa para gerar o relatorio.' });
      }

      const startDateKey = normalizeCalendarDateKey(req.query?.start);
      const endDateKey = normalizeCalendarDateKey(req.query?.end);
      if (!startDateKey || !endDateKey || startDateKey > endDateKey) {
        return res.status(400).json({ message: 'Periodo invalido.' });
      }
      const start = toStartOfDay(startDateKey);
      const end = toEndOfDay(endDateKey);

      const [professionals, config, allClosingDocs] = await Promise.all([
        loadProfessionalsForStore(storeId),
        CommissionConfig.findOne({ store: storeId }).lean(),
        CommissionClosing.find({ store: storeId })
          .sort({ createdAt: -1 })
          .populate('profissional', 'nomeCompleto nomeContato razaoSocial nome codigoCliente')
          .populate('store', 'nome nomeFantasia razaoSocial')
          .lean(),
      ]);
      const closingDocs = allClosingDocs.filter((closing) => {
        const closingStart = getClosingPeriodStartKey(closing);
        const closingEnd = getClosingPeriodEndKey(closing);
        return Boolean(closingStart && closingEnd && closingStart <= endDateKey && closingEnd >= startDateKey);
      });
      const calculationOptions = normalizeCommissionCalculationOptions(config);
      const closingRecords = closingDocs.map((closing) =>
        serializeClosingRecord(closing, { selectedStart: startDateKey, selectedEnd: endDateKey }),
      );
      const activeClosingDocs = closingDocs.filter((closing) => closing.status !== 'cancelado');
      const activeClosingRecords = closingRecords.filter((closing) => closing.status !== 'cancelado');
      const closingsByProfessional = new Map();
      activeClosingDocs.forEach((closing) => {
        const key = normalizeObjectId(closing.profissional);
        const list = closingsByProfessional.get(key) || [];
        list.push(closing);
        closingsByProfessional.set(key, list);
      });

      const runtimeContext = {};
      const computed = await runWithConcurrency(professionals, async (professional) => {
        const result = await calculateAvailableCommissionSummary({
          user: professional,
          startDate: start,
          endDate: end,
          startDateKey,
          endDateKey,
          storeId,
          runtimeContext,
          calculationOptions,
        });
        return { professional, result };
      });

      const rows = [];
      computed.forEach(({ professional, result }) => {
        const professionalId = String(professional._id);
        const related = closingsByProfessional.get(professionalId) || [];
        const legacyRelated = related.filter(
          (closing) =>
            !normalizeCalendarDateKey(closing.periodoInicioData) ||
            !normalizeCalendarDateKey(closing.periodoFimData) ||
            Number(closing.snapshotVersion || 0) < 1 ||
            !Array.isArray(closing.snapshotItems),
        );
        const exactLegacy = legacyRelated.filter(
          (closing) =>
            getClosingPeriodStartKey(closing) === startDateKey &&
            getClosingPeriodEndKey(closing) === endDateKey,
        );
        const unsafeLegacyOverlap = legacyRelated.filter((closing) => !exactLegacy.includes(closing));
        const snapshotted = related.filter(
          (closing) => Number(closing.snapshotVersion || 0) >= 1 && Array.isArray(closing.snapshotItems),
        );
        const selectedSnapshotItems = snapshotted.flatMap((closing) =>
          closing.snapshotItems
            .filter((item) => isCalendarDateInRange(item.date, startDateKey, endDateKey))
            .map((item) => ({ closing, item: sanitizeSnapshotItem(item) })),
        );

        const availableTotals = exactLegacy.length ? emptyTotals() : result?.totals || emptyTotals();
        let totalVendas = Number(availableTotals.totalVendas || 0);
        let totalServicos = Number(availableTotals.totalServicos || 0);
        let paidForServicePeriod = 0;
        let pendingClosed = 0;

        selectedSnapshotItems.forEach(({ closing, item }) => {
          const value = roundCurrency(item.commission);
          if (item.source === 'appointment_service') totalServicos += value;
          else totalVendas += value;
          if (closing.status === 'pago') paidForServicePeriod += value;
          else pendingClosed += value;
        });

        if (exactLegacy.length) {
          exactLegacy.forEach((closing) => {
            totalVendas += Number(closing.totalVendas || 0);
            totalServicos += Number(closing.totalServicos || 0);
            if (closing.status === 'pago') {
              paidForServicePeriod += Number(closing.totalPago || closing.totalPeriodo || 0);
            } else {
              pendingClosed += Number(closing.totalPendente || closing.totalPeriodo || 0);
            }
          });
        }

        totalVendas = roundCurrency(totalVendas);
        totalServicos = roundCurrency(totalServicos);
        const totalPeriodo = roundCurrency(totalVendas + totalServicos);
        const availablePending = Number(availableTotals.totalPendente || 0);
        const needsReconciliation = unsafeLegacyOverlap.length > 0;
        const totalPendente = needsReconciliation
          ? 0
          : roundCurrency(availablePending + pendingClosed);
        const activeRelated = related.filter((closing) => closing.status !== 'cancelado');
        const singleExact = activeRelated.length === 1 &&
          getClosingPeriodStartKey(activeRelated[0]) === startDateKey &&
          getClosingPeriodEndKey(activeRelated[0]) === endDateKey;
        let status = 'em_aberto';
        if (needsReconciliation) status = 'reconciliacao';
        else if (availablePending > 0) status = 'em_aberto';
        else if (activeRelated.some((closing) => closing.status === 'agendado')) status = 'agendado';
        else if (activeRelated.some((closing) => closing.status === 'pendente')) status = 'pendente';
        else if (activeRelated.length && totalPendente <= 0) status = 'pago';

        if (!totalPeriodo && !activeRelated.length && !needsReconciliation) return;
        const latestClosing = activeRelated[0] || null;
        rows.push({
          id: singleExact ? latestClosing._id : `report-${professionalId}-${startDateKey}-${endDateKey}`,
          profissional: professional._id,
          profissionalNome: pickUserName(professional),
          codigoProfissional: professional.codigoCliente || '',
          store: storeId,
          periodoInicio: startDateKey,
          periodoFim: endDateKey,
          periodo: formatPeriod(startDateKey, endDateKey),
          tipo: commissionTypeFromTotals({ totalVendas, totalServicos }),
          previsto: totalPeriodo,
          totalPeriodo,
          pago: roundCurrency(paidForServicePeriod),
          totalPago: roundCurrency(paidForServicePeriod),
          pendente: totalPendente,
          totalPendente,
          totalVendas,
          totalServicos,
          pendenteVendas: Number(availableTotals.pendenteVendas || 0),
          pendenteServicos: Number(availableTotals.pendenteServicos || 0),
          status,
          synthetic: !singleExact,
          canClose: !needsReconciliation && availablePending > 0,
          canPay: singleExact && ['pendente', 'agendado'].includes(latestClosing.status),
          canCancel: singleExact,
          closingId: singleExact ? latestClosing._id : null,
          closingIds: activeRelated.map((closing) => closing._id),
          adjustment: snapshotted.length > 0 && availablePending > 0,
          alreadyClosedItems: Number(result?.alreadyClosedItems || 0),
          availableItemCount: Array.isArray(result?.items) ? result.items.length : 0,
          snapshotItemCount: selectedSnapshotItems.length,
          needsReconciliation,
          reconciliationReason: needsReconciliation
            ? 'Há fechamento legado sobreposto sem itens congelados. Revise antes de pagar ou criar outro fechamento.'
            : '',
          previsaoPagamento: latestClosing?.previsaoPagamento || null,
          previsaoPagamentoData: latestClosing
            ? normalizeCalendarDateKey(latestClosing.previsaoPagamentoData) ||
              (latestClosing.previsaoPagamento
                ? getCalendarDateKeyInSaoPaulo(latestClosing.previsaoPagamento)
                : '')
            : '',
          previsaoPagamentoHora: latestClosing
            ? normalizeAppointmentTimeKey(latestClosing.previsaoPagamentoHora).slice(0, 5)
            : '',
          meioPagamento: latestClosing?.meioPagamento || '',
          paidDate: latestClosing ? normalizeCalendarDateKey(latestClosing.paidDate) : '',
          paidTime: latestClosing ? normalizeAppointmentTimeKey(latestClosing.paidTime).slice(0, 5) : '',
          overdue: activeRelated.some((closing) => {
            const dueKey = normalizeCalendarDateKey(closing.previsaoPagamentoData) ||
              (closing.previsaoPagamento ? getCalendarDateKeyInSaoPaulo(closing.previsaoPagamento) : '');
            return closing.status === 'agendado' && dueKey && dueKey < getCalendarDateKeyInSaoPaulo();
          }),
        });
      });

      rows.sort((a, b) => a.profissionalNome.localeCompare(b.profissionalNome, 'pt-BR'));

      const paidInPeriod = await CommissionClosing.find({
        store: storeId,
        status: 'pago',
        paidDate: { $gte: startDateKey, $lte: endDateKey },
      })
        .select('totalPago totalPeriodo paidDate paidTime')
        .lean();
      const lastPayment = await CommissionClosing.findOne({
        store: storeId,
        status: 'pago',
        paidDate: { $regex: /^\d{4}-\d{2}-\d{2}$/ },
      })
        .sort({ paidDate: -1, paidTime: -1, paidAt: -1 })
        .select('paidDate paidTime totalPago totalPeriodo')
        .lean();

      const payableIds = activeClosingDocs.map((closing) => closing.payable).filter(Boolean);
      const payables = payableIds.length
        ? await AccountPayable.find({ _id: { $in: payableIds } }).select('_id installments').lean()
        : [];
      const payableById = new Map(payables.map((payable) => [String(payable._id), payable]));
      const payableMismatch = activeClosingDocs.filter((closing) => {
        if (!closing.payable) return closing.status !== 'pendente';
        const payable = payableById.get(String(closing.payable));
        if (!payable) return true;
        const expected = closing.status === 'pago' ? 'paid' : 'pending';
        return !Array.isArray(payable.installments) || payable.installments.some((item) => item.status !== expected);
      }).length;
      const crossBoundary = activeClosingRecords.filter((closing) => closing.crossesSelection).length;
      const legacyPeriods = activeClosingRecords.filter((closing) => closing.legacyPeriod).length;
      const missingPaidDate = activeClosingDocs.filter(
        (closing) => closing.status === 'pago' && !normalizeCalendarDateKey(closing.paidDate),
      ).length;
      const paymentsMade = roundCurrency(
        paidInPeriod.reduce(
          (sum, closing) => sum + Number(closing.totalPago || closing.totalPeriodo || 0),
          0,
        ),
      );
      const expected = roundCurrency(rows.reduce((sum, row) => sum + Number(row.totalPeriodo || 0), 0));
      const paidForServicePeriod = roundCurrency(rows.reduce((sum, row) => sum + Number(row.totalPago || 0), 0));
      const outstanding = roundCurrency(rows.reduce((sum, row) => sum + Number(row.totalPendente || 0), 0));
      const reconciliationValue = roundCurrency(
        rows.filter((row) => row.needsReconciliation).reduce((sum, row) => sum + Number(row.totalPeriodo || 0), 0),
      );

      return res.json({
        period: { start: startDateKey, end: endDateKey },
        store: storeId,
        items: rows,
        history: closingRecords.map(({ _professionalKey, _storeKey, ...record }) => record),
        summary: {
          totalExpected: expected,
          paidForServicePeriod,
          paymentsMade,
          outstanding,
          reconciliationValue,
          lastPaymentDate: normalizeCalendarDateKey(lastPayment?.paidDate),
          lastPaymentTime: normalizeAppointmentTimeKey(lastPayment?.paidTime).slice(0, 5),
        },
        anomalies: {
          missingConfiguration: !config?.accountingAccount || !config?.bankAccount,
          legacyPeriods,
          crossBoundary,
          missingPaidDate,
          payableMismatch,
          reconciliationRows: rows.filter((row) => row.needsReconciliation).length,
          overdue: rows.filter((row) => row.overdue).length,
        },
      });
    } catch (error) {
      console.error('[adminComissoesFechamentos] report', error);
      return res.status(500).json({ message: 'Nao foi possivel gerar o relatorio de comissoes.' });
    }
  },
);

router.get(
  '/admin/comissoes/fechamentos',
  requireAuth,
  authorizeRoles(...ADMIN_ROLES),
  async (req, res) => {
    try {
      const requestedStoreId =
        req.query?.store && isValidObjectId(req.query.store) ? String(req.query.store) : null;
      const { allowedStoreIds, allowAllStores } = await resolveUserStoreAccess(req, req.user?.id);
      const allowedStoreSet = new Set(allowedStoreIds);

      if (!allowAllStores && !allowedStoreSet.size) {
        return res.json([]);
      }

      if (requestedStoreId && !allowAllStores && !allowedStoreSet.has(requestedStoreId)) {
        return res.status(403).json({ message: 'Empresa nao permitida para o usuario.' });
      }

      const storeId =
        requestedStoreId ||
        (!allowAllStores && allowedStoreIds.length ? allowedStoreIds[0] : null);
      const startDateKey =
        normalizeCalendarDateKey(req.query?.start) ||
        getCalendarDateKeyInSaoPaulo(new Date(Date.now() - DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000));
      const endDateKey =
        normalizeCalendarDateKey(req.query?.end) || getCalendarDateKeyInSaoPaulo();
      if (startDateKey > endDateKey) {
        return res.status(400).json({ message: 'Periodo invalido.' });
      }
      const startLocal = toStartOfDay(startDateKey);
      const endLocal = toEndOfDay(endDateKey);
      const debug = req.query?.debug === '1';

      const filter = {};
      if (storeId) filter.store = storeId;
      else if (!allowAllStores && allowedStoreIds.length) filter.store = { $in: allowedStoreIds };
      const allClosings = await CommissionClosing.find(filter)
        .sort({ createdAt: -1 })
        .populate('profissional', 'nomeCompleto nomeContato razaoSocial nome codigoCliente')
        .populate('store', 'nome nomeFantasia razaoSocial')
        .lean();
      const closings = allClosings.filter((closing) => {
        const closingStart = getClosingPeriodStartKey(closing);
        const closingEnd = getClosingPeriodEndKey(closing);
        return Boolean(closingStart && closingEnd && closingStart <= endDateKey && closingEnd >= startDateKey);
      });

      const existingKey = new Set(
        closings.map((closing) => buildProfessionalStorePairKey(closing.profissional, closing.store)),
      );
      const latestClosingEndByPair = new Map();
      closings.forEach((closing) => {
        const pairKey = buildProfessionalStorePairKey(closing.profissional, closing.store);
        const current = latestClosingEndByPair.get(pairKey);
        const closingEndKey = getClosingPeriodEndKey(closing);
        if (!closingEndKey) return;
        if (!current || closingEndKey > current) latestClosingEndByPair.set(pairKey, closingEndKey);
      });

      const payload = closings.map((closing) => {
        const profissionalNome = pickUserName(closing.profissional);
        const periodoInicioData = getClosingPeriodStartKey(closing);
        const periodoFimData = getClosingPeriodEndKey(closing);
        const previsaoPagamentoData =
          normalizeCalendarDateKey(closing.previsaoPagamentoData) ||
          normalizeCalendarDateKey(closing.previsaoPagamento);
        const storeNome =
          closing.store?.nome || closing.store?.nomeFantasia || closing.store?.razaoSocial || '';
        const ultimoPagamento =
          closing.status === 'pago' ? normalizeCalendarDateKey(closing.paidDate) : '';

        return {
          id: closing._id,
          profissional: closing.profissional?._id || closing.profissional,
          profissionalNome,
          store: closing.store?._id || closing.store || null,
          storeNome,
          periodoInicio: periodoInicioData,
          periodoFim: periodoFimData,
          periodo: formatPeriod(periodoInicioData, periodoFimData),
          previsto: closing.totalPeriodo,
          pago: closing.totalPago,
          pendente: closing.totalPendente,
          totalPeriodo: closing.totalPeriodo,
          totalPendente: closing.totalPendente,
          totalVendas: closing.totalVendas,
          totalServicos: closing.totalServicos,
          pendenteVendas: closing.pendenteVendas,
          pendenteServicos: closing.pendenteServicos,
          status: closing.status || 'pendente',
          previsaoPagamento: closing.previsaoPagamento,
          previsaoPagamentoData,
          previsaoPagamentoHora: normalizeAppointmentTimeKey(closing.previsaoPagamentoHora).slice(0, 5),
          meioPagamento: closing.meioPagamento || '',
          ultimoPagamento: ultimoPagamento ? formatCalendarDate(ultimoPagamento) : '--',
          createdAt: closing.createdAt,
        };
      });

      // Nenhum fechamento registrado: calcular dinamicamente por profissional no período.
      const profissionais = await User.find({ role: { $in: ['funcionario', 'franqueado', 'franqueador', 'admin', 'admin_master'] } })
        .select('nomeCompleto nomeContato razaoSocial nome email userGroup codigoCliente')
        .populate('userGroup', 'comissaoPercent comissaoServicoPercent')
        .lean();

      const storeList = storeId
        ? [storeId]
        : allowAllStores
          ? (await Store.find({}).select('_id nome nomeFantasia razaoSocial').lean()).map((s) =>
              String(s._id),
            )
          : allowedStoreIds;

      const storeNamesById = new Map();
      if (storeList.length) {
        const storeDocs = await Store.find({ _id: { $in: storeList } })
          .select('_id nome nomeFantasia razaoSocial')
          .lean();
        storeDocs.forEach((doc) => {
          storeNamesById.set(
            String(doc._id),
            doc.nome || doc.nomeFantasia || doc.razaoSocial || '',
          );
        });
      }
      const configDocs = storeList.length
        ? await CommissionConfig.find({ store: { $in: storeList } })
            .select('store includeServices includePdvSales')
            .lean()
        : [];
      const calculationOptionsByStore = new Map(
        configDocs.map((cfg) => [String(cfg.store), normalizeCommissionCalculationOptions(cfg)]),
      );
      // Reaproveita as chaves já existentes (fechamentos do banco)
      // e também evita adicionar duplicado entre sintéticos.
      const syntheticKeys = new Set(
        payload.map(
          (c) =>
            `${String(c.profissional)}|${String(c.store || '')}|${normalizeCalendarDateKey(
              c.periodoInicio,
            )}|${normalizeCalendarDateKey(c.periodoFim)}`,
        ),
      );
      const runtimeContext = {};

      const pendingPairs = [];
      for (const profissional of profissionais) {
        for (const storeKey of storeList) {
          const pairKey = buildProfessionalStorePairKey(profissional._id, storeKey || null);
          const options =
            calculationOptionsByStore.get(String(storeKey)) || defaultCommissionCalculationOptions();
          if (!options.includeServices && !options.includePdvSales) continue;
          let calcStartKey = startDateKey;
          const latestClosingEnd = latestClosingEndByPair.get(pairKey);
          const nextStartKey = latestClosingEnd ? addCalendarDays(latestClosingEnd, 1) : '';
          if (nextStartKey && nextStartKey > calcStartKey) calcStartKey = nextStartKey;
          if (!calcStartKey || calcStartKey > endDateKey) continue;

          const calcStart = toStartOfDay(calcStartKey);
          const calcEnd = endLocal;
          const dedupKey = `${pairKey}|${calcStartKey}|${endDateKey}`;
          if (syntheticKeys.has(dedupKey)) continue;
          pendingPairs.push({
            profissional,
            storeKey,
            dedupKey,
            calcStart,
            calcEnd,
            calcStartKey,
            calcEndKey: endDateKey,
            hasPriorClosing: existingKey.has(pairKey),
            options,
          });
        }
      }

      const computedPairs = await runWithConcurrency(
        pendingPairs,
        async ({
          profissional,
          storeKey,
          dedupKey,
          calcStart,
          calcEnd,
          calcStartKey,
          calcEndKey,
          hasPriorClosing,
          options,
        }) => {
          const summary = await computeCommissionSummaryForUser({
            user: profissional,
            startDate: calcStart,
            endDate: calcEnd,
            startDateKey: calcStartKey,
            endDateKey: calcEndKey,
            storeId: storeKey,
            debug,
            runtimeContext,
            calculationOptions: options,
          });
          return {
            profissional,
            storeKey,
            dedupKey,
            summary,
            calcStart,
            calcEnd,
            calcStartKey,
            calcEndKey,
            hasPriorClosing,
            options,
          };
        },
      );

      computedPairs.forEach(
        ({
          profissional,
          storeKey,
          dedupKey,
          summary,
          calcStart,
          calcEnd,
          calcStartKey,
          calcEndKey,
          hasPriorClosing,
        }) => {
          const totals = summary?.totals || emptyTotals();
          // Mantém card "zerado" quando já existe fechamento anterior, para facilitar o próximo fechamento.
          if (!totals.totalPeriodo && !totals.totalPendente && !hasPriorClosing) return;
          payload.push({
            id: `dyn-${profissional._id}-${storeKey || 'all'}-${calcStart.getTime()}-${calcEnd.getTime()}`,
            profissional: profissional._id,
            profissionalNome: pickUserName(profissional),
            store: storeKey || null,
            storeNome: storeNamesById.get(storeKey) || '',
            periodoInicio: calcStartKey,
            periodoFim: calcEndKey,
            periodo: formatPeriod(calcStartKey, calcEndKey),
            previsto: totals.totalPeriodo,
            pago: 0,
            pendente: totals.totalPendente,
            totalPeriodo: totals.totalPeriodo,
            totalPendente: totals.totalPendente,
            totalVendas: totals.totalVendas,
            totalServicos: totals.totalServicos,
            pendenteVendas: totals.pendenteVendas,
            pendenteServicos: totals.pendenteServicos,
            status: 'em_aberto',
            previsaoPagamento: null,
            meioPagamento: '',
            ultimoPagamento: '--',
            synthetic: true,
            debug: debug ? summary?.debug : undefined,
          });
          syntheticKeys.add(dedupKey);
        },
      );

      if (debug) {
        return res.json({
          items: payload,
          debug: {
            period: { start: startLocal, end: endLocal },
            storeId,
            count: payload.length,
            professionals: profissionais.length,
            unmatchedSales: payload
              .map((p) => p.debug?.salesUnmatched || [])
              .flat()
              .slice(0, 50),
          },
        });
      }

      return res.json(payload);
    } catch (error) {
      console.error('[adminComissoesFechamentos] list', error);
      return res.status(500).json({ message: 'Nao foi possivel carregar fechamentos.' });
    }
  },
);

router.get(
  '/admin/comissoes/fechamentos/preview',
  requireAuth,
  authorizeRoles(...ADMIN_ROLES),
  async (req, res) => {
    try {
      const profissionalId = req.query?.profissionalId;
      if (!profissionalId || !isValidObjectId(profissionalId)) {
        return res.status(400).json({ message: 'Profissional invalido.' });
      }

      const startDateKey = normalizeCalendarDateKey(req.query?.start);
      const endDateKey = normalizeCalendarDateKey(req.query?.end);
      const startDateLocal = toStartOfDay(startDateKey);
      const endDateLocal = toEndOfDay(endDateKey);
      if (!startDateKey || !endDateKey || !startDateLocal || !endDateLocal || startDateKey > endDateKey) {
        return res.status(400).json({ message: 'Periodo invalido.' });
      }

      const requestedStoreId =
        req.query?.store && isValidObjectId(req.query.store) ? String(req.query.store) : null;
      const { allowedStoreIds, allowAllStores } = await resolveUserStoreAccess(req, req.user?.id);
      const allowedStoreSet = new Set(allowedStoreIds.map(String));

      if (!allowAllStores && !allowedStoreSet.size) {
        return res.status(403).json({ message: 'Nenhuma empresa permitida para o usuario.' });
      }
      if (requestedStoreId && !allowAllStores && !allowedStoreSet.has(requestedStoreId)) {
        return res.status(403).json({ message: 'Empresa nao permitida para o usuario.' });
      }

      const safeStoreId =
        requestedStoreId || (!allowAllStores && allowedStoreIds.length ? allowedStoreIds[0] : null);

      const profissional = await User.findById(profissionalId)
        .select('nomeCompleto nomeContato razaoSocial nome email userGroup codigoCliente')
        .populate('userGroup', 'comissaoPercent comissaoServicoPercent')
        .lean();
      if (!profissional) {
        return res.status(404).json({ message: 'Profissional nao encontrado.' });
      }

      const storeConfig = safeStoreId
        ? await CommissionConfig.findOne({ store: safeStoreId })
            .select('includeServices includePdvSales')
            .lean()
        : null;
      const calculationOptions = normalizeCommissionCalculationOptions(storeConfig);
      if (!calculationOptions.includeServices && !calculationOptions.includePdvSales) {
        return res.json({
          profissional: profissional._id,
          profissionalNome: pickUserName(profissional),
          store: safeStoreId,
          periodoInicio: startDateKey,
          periodoFim: endDateKey,
          totals: emptyTotals(),
        });
      }

      const summary = await calculateAvailableCommissionSummary({
        user: profissional,
        startDate: startDateLocal,
        endDate: endDateLocal,
        startDateKey,
        endDateKey,
        storeId: safeStoreId,
        calculationOptions,
      });
      const eligibility = req.query?.details === '1'
        ? await fetchServiceEligibilityAudit({
            user: profissional,
            startDateKey,
            endDateKey,
            storeId: safeStoreId,
          })
        : undefined;

      return res.json({
        profissional: profissional._id,
        profissionalNome: pickUserName(profissional),
        store: safeStoreId,
        periodoInicio: startDateKey,
        periodoFim: endDateKey,
        totals: summary?.totals || emptyTotals(),
        grossTotals: summary?.grossTotals || emptyTotals(),
        alreadyClosedItems: Number(summary?.alreadyClosedItems || 0),
        items: req.query?.details === '1' ? summary?.items || [] : undefined,
        eligibility,
      });
    } catch (error) {
      console.error('[adminComissoesFechamentos] preview', error);
      return res.status(500).json({ message: 'Nao foi possivel calcular preview.' });
    }
  },
);

router.get(
  '/admin/comissoes/fechamentos/pendentes',
  requireAuth,
  authorizeRoles(...ADMIN_ROLES),
  async (req, res) => {
    try {
      const requestedStoreId = req.query?.store && isValidObjectId(req.query.store)
        ? String(req.query.store)
        : null;
      const { allowedStoreIds, allowAllStores } = await resolveUserStoreAccess(req, req.user?.id);
      const allowedStoreSet = new Set(allowedStoreIds);

      if (!allowAllStores && !allowedStoreSet.size) {
        return res.json([]);
      }

      if (requestedStoreId && !allowAllStores && !allowedStoreSet.has(requestedStoreId)) {
        return res.status(403).json({ message: 'Empresa nao permitida para o usuario.' });
      }

      const storeId =
        requestedStoreId ||
        (!allowAllStores && allowedStoreIds.length ? allowedStoreIds[0] : null);

      const startDateKey =
        normalizeCalendarDateKey(req.query?.start) ||
        getCalendarDateKeyInSaoPaulo(new Date(Date.now() - DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000));
      const endDateKey =
        normalizeCalendarDateKey(req.query?.end) || getCalendarDateKeyInSaoPaulo();
      if (startDateKey > endDateKey) {
        return res.status(400).json({ message: 'Periodo invalido.' });
      }
      const start = toStartOfDay(startDateKey);
      const end = toEndOfDay(endDateKey);

      const profissionais = await loadProfessionalsForStore(storeId);
      const runtimeContext = {};
      const storeConfig = storeId
        ? await CommissionConfig.findOne({ store: storeId })
            .select('includeServices includePdvSales')
            .lean()
        : null;
      const calculationOptions = normalizeCommissionCalculationOptions(storeConfig);
      if (!calculationOptions.includeServices && !calculationOptions.includePdvSales) {
        return res.json([]);
      }

      const summaries = await runWithConcurrency(
        profissionais,
        async (profissional) => {
          const summary = await calculateAvailableCommissionSummary({
            user: profissional,
            startDate: start,
            endDate: end,
            startDateKey,
            endDateKey,
            storeId,
            runtimeContext,
            calculationOptions,
          });
          return {
            profissional,
            totals: summary?.totals || emptyTotals(),
            alreadyClosedItems: Number(summary?.alreadyClosedItems || 0),
          };
        },
      );

      const result = [];
      summaries.forEach(({ profissional, totals, alreadyClosedItems }) => {
        if (!totals.totalPendente) return;

        result.push({
          profissional: profissional._id,
          profissionalNome: pickUserName(profissional),
          totalPendente: totals.totalPendente,
          pendenteServicos: totals.pendenteServicos,
          pendenteVendas: totals.pendenteVendas,
          totalServicos: totals.totalServicos,
          totalVendas: totals.totalVendas,
          totalPago: totals.totalPago,
          alreadyClosedItems,
        });
      });

      return res.json(result);
    } catch (error) {
      console.error('[adminComissoesFechamentos] pendentes', error);
      return res.status(500).json({ message: 'Nao foi possivel calcular pendencias.' });
    }
  },
);

router.get(
  '/admin/comissoes/fechamentos/:id/details',
  requireAuth,
  authorizeRoles(...ADMIN_ROLES),
  async (req, res) => {
    try {
      const { id } = req.params;
      if (!isValidObjectId(id)) return res.status(400).json({ message: 'Fechamento invalido.' });
      const closing = await CommissionClosing.findById(id)
        .populate('profissional', 'nomeCompleto nomeContato razaoSocial nome email userGroup codigoCliente')
        .populate('store', 'nome nomeFantasia razaoSocial _id')
        .lean();
      if (!closing) return res.status(404).json({ message: 'Fechamento nao encontrado.' });
      await assertClosingStoreAccess(req, closing);
      const startDateKey = getClosingPeriodStartKey(closing);
      const endDateKey = getClosingPeriodEndKey(closing);
      if (!startDateKey || !endDateKey || startDateKey > endDateKey) {
        return res.status(422).json({ message: 'Periodo literal do fechamento nao esta valido.' });
      }

      let items = [];
      let exclusions = [];
      let immutable = Number(closing.snapshotVersion || 0) >= 1;
      if (immutable) {
        items = (Array.isArray(closing.snapshotItems) ? closing.snapshotItems : []).map(sanitizeSnapshotItem);
        exclusions = Array.isArray(closing.snapshotExclusions) ? closing.snapshotExclusions : [];
      } else {
        const professional = await User.findById(normalizeObjectId(closing.profissional))
          .select('nomeCompleto nomeContato razaoSocial nome email userGroup codigoCliente')
          .populate('userGroup', 'comissaoPercent comissaoServicoPercent')
          .lean();
        if (!professional) return res.status(404).json({ message: 'Profissional nao encontrado.' });
        const storeId = normalizeObjectId(closing.store);
        const config = storeId
          ? await CommissionConfig.findOne({ store: storeId }).select('includeServices includePdvSales').lean()
          : null;
        const [summary, eligibility] = await Promise.all([
          computeCommissionSummaryForUser({
            user: professional,
            startDate: toStartOfDay(startDateKey),
            endDate: toEndOfDay(endDateKey),
            startDateKey,
            endDateKey,
            storeId,
            calculationOptions: normalizeCommissionCalculationOptions(config),
          }),
          fetchServiceEligibilityAudit({
            user: professional,
            startDateKey,
            endDateKey,
            storeId,
          }),
        ]);
        items = (summary?.items || []).map(sanitizeSnapshotItem);
        exclusions = eligibility.exclusions || [];
      }

      const snapshotTotals = buildTotalsFromItems(items);
      return res.json({
        closing: (() => {
          const record = serializeClosingRecord(closing);
          delete record._professionalKey;
          delete record._storeKey;
          return record;
        })(),
        immutable,
        warning: immutable
          ? ''
          : 'Fechamento legado: detalhes recalculados com os dados atuais e ainda nao congelados.',
        items,
        exclusions,
        totals: {
          itemCount: items.length,
          excludedCount: exclusions.length,
          value: roundCurrency(items.reduce((sum, item) => sum + Number(item.value || 0), 0)),
          commission: snapshotTotals.totalPeriodo,
          services: snapshotTotals.totalServicos,
          sales: snapshotTotals.totalVendas,
        },
      });
    } catch (error) {
      console.error('[adminComissoesFechamentos] details', error);
      return res.status(error.statusCode || 500).json({ message: error.message || 'Nao foi possivel carregar detalhes.' });
    }
  },
);

router.get(
  '/admin/comissoes/fechamentos/:id/resumo-servicos',
  requireAuth,
  authorizeRoles(...ADMIN_ROLES),
  async (req, res) => {
    try {
      const { id } = req.params;
      if (!isValidObjectId(id)) {
        return res.status(400).json({ message: 'Fechamento invalido.' });
      }

      const closing = await CommissionClosing.findById(id)
        .populate('profissional', 'nomeCompleto nomeContato razaoSocial nome email userGroup codigoCliente')
        .populate('store', 'nome nomeFantasia razaoSocial _id')
        .lean();
      if (!closing) {
        return res.status(404).json({ message: 'Fechamento nao encontrado.' });
      }
      if ((closing.status || '').toString().toLowerCase() !== 'pago') {
        return res.status(400).json({ message: 'Resumo disponivel apenas para fechamentos pagos.' });
      }

      const requestedStoreId = normalizeObjectId(closing.store?._id || closing.store);
      const { allowedStoreIds, allowAllStores } = await resolveUserStoreAccess(req, req.user?.id);
      const allowedStoreSet = new Set(allowedStoreIds.map(String));
      if (!allowAllStores && (!requestedStoreId || !allowedStoreSet.has(requestedStoreId))) {
        return res.status(403).json({ message: 'Empresa nao permitida para o usuario.' });
      }

      const profissionalId = normalizeObjectId(closing.profissional?._id || closing.profissional);
      const profissional = await User.findById(profissionalId)
        .select('nomeCompleto nomeContato razaoSocial nome email userGroup codigoCliente')
        .populate('userGroup', 'comissaoPercent comissaoServicoPercent')
        .lean();
      if (!profissional) {
        return res.status(404).json({ message: 'Profissional nao encontrado.' });
      }

      const professionalCommissionConfig = await ProfessionalCommissionConfig.findOne({ user: profissional._id })
        .select('groupRules serviceRules')
        .lean();
      const professionalCommission = buildProfessionalCommissionContext(professionalCommissionConfig);
      const defaultPercent = Number(
        profissional?.userGroup?.comissaoServicoPercent ?? DEFAULT_COMISSAO_SERVICO_PERCENT,
      );

      const startDateKey = getClosingPeriodStartKey(closing);
      const endDateKey = getClosingPeriodEndKey(closing);
      if (!startDateKey || !endDateKey || startDateKey > endDateKey) {
        return res.status(400).json({ message: 'Periodo do fechamento invalido.' });
      }

      if (Number(closing.snapshotVersion || 0) >= 1 && Array.isArray(closing.snapshotItems)) {
        const snapshotRows = closing.snapshotItems
          .map(sanitizeSnapshotItem)
          .sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`))
          .map((item) => ({
            petNome: item.petName || (item.source === 'pdv_product' ? 'Venda PDV' : 'Pet'),
            servicoNome: item.description || '--',
            data: `${formatCalendarDate(item.date)}${item.time ? ` ${item.time}` : ''}`,
            valor: item.value,
            percentual: item.percent,
            comissao: item.commission,
            origem: item.source,
            codigoVenda: item.saleCode,
          }));
        const snapshotTotals = snapshotRows.reduce(
          (acc, row) => {
            acc.valor += Number(row.valor || 0);
            acc.comissao += Number(row.comissao || 0);
            return acc;
          },
          { valor: 0, comissao: 0 },
        );
        return res.json({
          fechamentoId: closing._id,
          profissional: profissional._id,
          profissionalNome: pickUserName(profissional),
          store: requestedStoreId || null,
          storeNome: closing.store?.nome || closing.store?.nomeFantasia || closing.store?.razaoSocial || '',
          periodoInicio: startDateKey,
          periodoFim: endDateKey,
          periodo: formatPeriod(startDateKey, endDateKey),
          immutable: true,
          rows: snapshotRows,
          totals: {
            itens: snapshotRows.length,
            valor: roundCurrency(snapshotTotals.valor),
            comissao: roundCurrency(snapshotTotals.comissao),
          },
        });
      }

      const serviceQuery = {
        'itens.data': { $gte: startDateKey, $lte: endDateKey },
        $and: [
          {
            $or: [
              { profissional: new mongoose.Types.ObjectId(profissionalId) },
              { 'itens.profissional': new mongoose.Types.ObjectId(profissionalId) },
            ],
          },
        ],
      };
      if (requestedStoreId && isValidObjectId(requestedStoreId)) {
        serviceQuery.store = new mongoose.Types.ObjectId(requestedStoreId);
      }

      const appointments = await Appointment.find(serviceQuery)
        .select(
          'itens valor pago codigoVenda status profissional servico store pet',
        )
        .populate('pet', 'nome')
        .populate({
          path: 'itens.servico',
          select: 'nome grupo comissaoPercent',
          populate: { path: 'grupo', select: 'nome comissaoPercent' },
        })
        .populate({
          path: 'servico',
          select: 'nome grupo comissaoPercent',
          populate: { path: 'grupo', select: 'nome comissaoPercent' },
        })
        .lean();

      const rows = buildServiceCommissionRows({
        appointments,
        user: profissional,
        defaultPercent,
        professionalCommission,
        startDateKey,
        endDateKey,
      });

      const totals = rows.reduce(
        (acc, row) => {
          acc.valor += Number(row.valor || 0);
          acc.comissao += Number(row.comissao || 0);
          return acc;
        },
        { valor: 0, comissao: 0 },
      );

      return res.json({
        fechamentoId: closing._id,
        profissional: profissional._id,
        profissionalNome: pickUserName(profissional),
        store: requestedStoreId || null,
        storeNome: closing.store?.nome || closing.store?.nomeFantasia || closing.store?.razaoSocial || '',
        periodoInicio: startDateKey,
        periodoFim: endDateKey,
        periodo: formatPeriod(startDateKey, endDateKey),
        rows,
        totals: {
          itens: rows.length,
          valor: totals.valor,
          comissao: totals.comissao,
        },
        immutable: false,
        warning: 'Fechamento legado recalculado com os dados atuais.',
      });
    } catch (error) {
      console.error('[adminComissoesFechamentos] resumo-servicos', error);
      return res.status(500).json({ message: 'Nao foi possivel gerar resumo de servicos.' });
    }
  },
);

router.post(
  '/admin/comissoes/fechamentos',
  requireAuth,
  authorizeRoles(...ADMIN_ROLES),
  async (req, res) => {
    try {
      const {
        profissionalId,
        inicio,
        fim,
        previsaoPagamento,
        previsaoPagamentoData,
        previsaoPagamentoHora,
        meioPagamento,
        storeId,
      } = req.body || {};
      if (!profissionalId || !isValidObjectId(profissionalId)) {
        return res.status(400).json({ message: 'Profissional obrigatorio.' });
      }
      const requestedStoreId = storeId && isValidObjectId(storeId) ? String(storeId) : null;
      const { allowedStoreIds, allowAllStores } = await resolveUserStoreAccess(req, req.user?.id);
      const allowedStoreSet = new Set(allowedStoreIds);
      if (!allowAllStores && !allowedStoreSet.size) {
        return res.status(403).json({ message: 'Nenhuma empresa permitida para o usuario.' });
      }
      if (requestedStoreId && !allowAllStores && !allowedStoreSet.has(requestedStoreId)) {
        return res.status(403).json({ message: 'Empresa nao permitida para o usuario.' });
      }
      const safeStoreId =
        requestedStoreId ||
        (!allowAllStores && allowedStoreIds.length ? allowedStoreIds[0] : null);
      if (!safeStoreId) {
        return res.status(400).json({ message: 'Selecione uma empresa para criar o fechamento.' });
      }
      const storeConfig = safeStoreId
        ? await CommissionConfig.findOne({ store: safeStoreId })
            .select('includeServices includePdvSales')
            .lean()
        : null;
      const calculationOptions = normalizeCommissionCalculationOptions(storeConfig);
      const startDateKey = normalizeCalendarDateKey(inicio);
      const endDateKey = normalizeCalendarDateKey(fim);
      const startDateLocal = toStartOfDay(startDateKey);
      const endDateLocal = toEndOfDay(endDateKey);
      if (!startDateKey || !endDateKey || !startDateLocal || !endDateLocal || startDateKey > endDateKey) {
        return res.status(400).json({ message: 'Periodo invalido.' });
      }
      const hasPaymentSchedule = Boolean(previsaoPagamento || previsaoPagamentoData);
      const paymentSchedule = parsePaymentSchedule({
        value: previsaoPagamento,
        date: previsaoPagamentoData,
        time: previsaoPagamentoHora,
      });
      if (hasPaymentSchedule && !paymentSchedule) {
        return res.status(400).json({ message: 'Previsao de pagamento invalida.' });
      }

      const profissional = await User.findById(profissionalId)
        .select('nomeCompleto nomeContato razaoSocial nome email userGroup codigoCliente')
        .populate('userGroup', 'comissaoPercent comissaoServicoPercent')
        .lean();
      if (!profissional) {
        return res.status(404).json({ message: 'Profissional nao encontrado.' });
      }

      const overlapFilter = {
        profissional: profissional._id,
        store: safeStoreId,
        status: { $ne: 'cancelado' },
      };
      const potentialOverlaps = await CommissionClosing.find(overlapFilter)
        .select('_id snapshotVersion snapshotItems periodoInicio periodoFim periodoInicioData periodoFimData')
        .lean();
      const overlapping = potentialOverlaps.filter((closing) => {
        const closingStart = getClosingPeriodStartKey(closing);
        const closingEnd = getClosingPeriodEndKey(closing);
        return Boolean(closingStart && closingEnd && closingStart <= endDateKey && closingEnd >= startDateKey);
      });
      const legacyOverlap = overlapping.find(
        (closing) => Number(closing.snapshotVersion || 0) < 1 || !Array.isArray(closing.snapshotItems),
      );
      if (legacyOverlap) {
        return res.status(409).json({
          message:
            'Existe um fechamento legado sobreposto sem itens congelados. Faça a reconciliação antes de criar outro fechamento.',
          existingId: legacyOverlap._id,
          code: 'LEGACY_OVERLAP_REQUIRES_RECONCILIATION',
        });
      }

      const summary = await calculateAvailableCommissionSummary({
        user: profissional,
        startDate: startDateLocal,
        endDate: endDateLocal,
        startDateKey,
        endDateKey,
        storeId: safeStoreId,
        calculationOptions,
      });
      const eligibility = await fetchServiceEligibilityAudit({
        user: profissional,
        startDateKey,
        endDateKey,
        storeId: safeStoreId,
      });

      const totals = summary.totals || emptyTotals();
      const snapshotItems = Array.isArray(summary.items) ? summary.items.map(sanitizeSnapshotItem) : [];
      if (!snapshotItems.length || Number(totals.totalPeriodo || 0) <= 0) {
        return res.status(422).json({
          message: 'Nao existem novos itens finalizados e pagos com comissao positiva neste periodo.',
          code: 'NO_PAYABLE_COMMISSION_ITEMS',
          alreadyClosedItems: Number(summary.alreadyClosedItems || 0),
        });
      }
      const actorId = getActorId(req) || profissional._id;
      const createdAt = new Date();
      const payload = {
        profissional: profissional._id,
        store: safeStoreId,
        periodoInicio: startDateLocal,
        periodoFim: endDateLocal,
        periodoInicioData: startDateKey,
        periodoFimData: endDateKey,
        totalPeriodo: totals.totalPeriodo,
        totalPendente: totals.totalPendente,
        totalVendas: totals.totalVendas,
        totalServicos: totals.totalServicos,
        pendenteVendas: totals.pendenteVendas,
        pendenteServicos: totals.pendenteServicos,
        totalPago: 0,
        previsaoPagamento: paymentSchedule?.instant || null,
        previsaoPagamentoData: paymentSchedule?.dateKey || '',
        previsaoPagamentoHora: paymentSchedule?.timeKey || '',
        meioPagamento: (meioPagamento || '').toString().trim(),
        status: paymentSchedule ? 'agendado' : 'pendente',
        kind: overlapping.length ? 'adjustment' : 'regular',
        snapshotVersion: 1,
        snapshotCreatedAt: createdAt,
        snapshotItems,
        snapshotExclusions: eligibility.exclusions,
        auditTrail: [
          {
            action: paymentSchedule ? 'scheduled' : 'created',
            at: createdAt,
            date: getCalendarDateKeyInSaoPaulo(createdAt),
            time: getClockTimeInSaoPaulo(createdAt).slice(0, 5),
            user: actorId,
            metadata: {
              itemCount: snapshotItems.length,
              kind: overlapping.length ? 'adjustment' : 'regular',
            },
          },
        ],
        createdBy: actorId,
      };

      const created = await CommissionClosing.create(payload);
      let payableCreated = null;
      try {
        await CommissionItemLock.insertMany(
          snapshotItems.map((item) => ({
            key: buildCommissionItemLockKey({
              profissional: profissional._id,
              store: safeStoreId,
              itemKey: item.key,
            }),
            closing: created._id,
            profissional: profissional._id,
            store: safeStoreId,
            source: item.source,
            date: item.date,
          })),
          { ordered: true },
        );

        const payable = await syncPayableForClosing({ closing: created });
        if (payable) {
          payableCreated = payable;
          created.payable = payable._id;
          await created.save();
        }
      } catch (syncErr) {
        await Promise.allSettled([
          CommissionItemLock.deleteMany({ closing: created._id }),
          CommissionClosing.deleteOne({ _id: created._id }),
          payableCreated ? AccountPayable.deleteOne({ _id: payableCreated._id }) : Promise.resolve(),
        ]);
        if (syncErr?.code === 11000) {
          return res.status(409).json({
            message: 'Um ou mais itens ja pertencem a outro fechamento. Atualize o relatorio e tente novamente.',
            code: 'COMMISSION_ITEMS_ALREADY_CLOSED',
          });
        }
        console.error('[adminComissoesFechamentos] create rollback', syncErr);
        return res.status(422).json({
          message: syncErr.message || 'Nao foi possivel criar a conta a pagar do fechamento.',
          code: 'PAYABLE_SYNC_FAILED',
        });
      }

      const response = serializeClosingRecord({
        ...created.toObject(),
        profissional,
      });
      delete response._professionalKey;
      delete response._storeKey;
      return res.status(201).json({
        ...response,
        debug: req.query?.debug === '1' ? summary.debug : undefined,
      });
    } catch (error) {
      console.error('[adminComissoesFechamentos] create', error);
      return res.status(500).json({ message: 'Nao foi possivel criar fechamento.' });
    }
  },
);

router.put(
  '/admin/comissoes/fechamentos/:id',
  requireAuth,
  authorizeRoles(...ADMIN_ROLES),
  async (req, res) => {
    try {
      const { id } = req.params;
      if (!isValidObjectId(id)) {
        return res.status(400).json({ message: 'Fechamento invalido.' });
      }

      if (
        Object.prototype.hasOwnProperty.call(req.body || {}, 'status') ||
        Object.prototype.hasOwnProperty.call(req.body || {}, 'totalPago')
      ) {
        return res.status(400).json({
          message: 'Use a confirmacao de pagamento ou cancelamento para alterar o status financeiro.',
        });
      }
      const allowedFields = ['previsaoPagamento', 'previsaoPagamentoData', 'previsaoPagamentoHora', 'meioPagamento'];
      const update = {};
      allowedFields.forEach((field) => {
        if (Object.prototype.hasOwnProperty.call(req.body || {}, field)) {
          update[field] = req.body[field];
        }
      });

      const hasPaymentScheduleUpdate = [
        'previsaoPagamento',
        'previsaoPagamentoData',
        'previsaoPagamentoHora',
      ].some((field) => Object.prototype.hasOwnProperty.call(req.body || {}, field));
      if (hasPaymentScheduleUpdate) {
        const paymentSchedule = parsePaymentSchedule({
          value: update.previsaoPagamento,
          date: update.previsaoPagamentoData,
          time: update.previsaoPagamentoHora,
        });
        const shouldClear = !update.previsaoPagamento && !update.previsaoPagamentoData;
        if (!paymentSchedule && !shouldClear) {
          return res.status(400).json({ message: 'Previsao invalida.' });
        }
        update.previsaoPagamento = paymentSchedule?.instant || null;
        update.previsaoPagamentoData = paymentSchedule?.dateKey || '';
        update.previsaoPagamentoHora = paymentSchedule?.timeKey || '';
      }

      if (update.meioPagamento !== undefined) {
        update.meioPagamento = (update.meioPagamento || '').toString().trim();
      }

      const closing = await CommissionClosing.findById(id);
      if (!closing) return res.status(404).json({ message: 'Fechamento nao encontrado.' });
      await assertClosingStoreAccess(req, closing);
      if (['pago', 'cancelado'].includes(closing.status)) {
        return res.status(409).json({ message: 'Fechamento pago ou cancelado nao pode ser reagendado.' });
      }

      const previous = closing.toObject();
      Object.assign(closing, update);
      closing.status = closing.previsaoPagamentoData ? 'agendado' : 'pendente';
      addClosingAudit(closing, {
        action: 'scheduled',
        user: getActorId(req),
        metadata: {
          previsaoPagamentoData: closing.previsaoPagamentoData || '',
          previsaoPagamentoHora: closing.previsaoPagamentoHora || '',
          meioPagamento: closing.meioPagamento || '',
        },
      });
      await closing.save();

      try {
        const payable = await syncPayableForClosing({ closing });
        if (payable && !closing.payable) {
          closing.payable = payable._id;
          await closing.save();
        }
      } catch (err) {
        await CommissionClosing.replaceOne({ _id: closing._id }, previous);
        return res.status(422).json({ message: err.message || 'Nao foi possivel sincronizar contas a pagar.' });
      }

      return res.json({
        id: closing._id,
        status: closing.status,
        totalPago: closing.totalPago,
        totalPendente: closing.totalPendente,
        previsaoPagamento: closing.previsaoPagamento,
        previsaoPagamentoData: closing.previsaoPagamentoData || '',
        previsaoPagamentoHora: closing.previsaoPagamentoHora || '',
        meioPagamento: closing.meioPagamento,
        payable: closing.payable || null,
      });
    } catch (error) {
      console.error('[adminComissoesFechamentos] update', error);
      return res.status(error.statusCode || 500).json({ message: error.message || 'Nao foi possivel atualizar fechamento.' });
    }
  },
);

router.post(
  '/admin/comissoes/fechamentos/:id/pay',
  requireAuth,
  authorizeRoles(...ADMIN_ROLES),
  async (req, res) => {
    try {
      const { id } = req.params;
      if (!isValidObjectId(id)) {
        return res.status(400).json({ message: 'Fechamento invalido.' });
      }
      const closing = await CommissionClosing.findById(id);
      if (!closing) return res.status(404).json({ message: 'Fechamento nao encontrado.' });
      await assertClosingStoreAccess(req, closing);
      if (req.body?.confirm !== true) {
        return res.status(400).json({ message: 'Confirme explicitamente o pagamento.' });
      }
      if (!['pendente', 'agendado'].includes(closing.status)) {
        return res.status(409).json({ message: 'Somente fechamentos pendentes ou agendados podem ser pagos.' });
      }
      const paymentDate = normalizeCalendarDateKey(req.body?.paymentDate);
      const paymentTime = normalizeAppointmentTimeKey(req.body?.paymentTime).slice(0, 5);
      const paymentMethod = String(req.body?.paymentMethod || closing.meioPagamento || '').trim();
      if (!paymentDate || !paymentTime) {
        return res.status(400).json({ message: 'Informe a data e a hora reais do pagamento.' });
      }
      if (!paymentMethod) {
        return res.status(400).json({ message: 'Informe o meio de pagamento.' });
      }
      const total = roundCurrency(closing.totalPeriodo);
      if (total <= 0) {
        return res.status(422).json({ message: 'Fechamento sem valor positivo nao pode ser pago.' });
      }
      if (Object.prototype.hasOwnProperty.call(req.body || {}, 'amount')) {
        const requestedAmount = roundCurrency(parseNumber(req.body.amount));
        if (requestedAmount !== total) {
          return res.status(400).json({
            message: 'O valor confirmado deve ser exatamente o total do fechamento.',
            expectedAmount: total,
          });
        }
      }
      const paidSchedule = parsePaymentSchedule({ date: paymentDate, time: paymentTime });
      const previous = closing.toObject();
      closing.status = 'pago';
      closing.totalPago = total;
      closing.totalPendente = 0;
      closing.pendenteVendas = 0;
      closing.pendenteServicos = 0;
      closing.meioPagamento = paymentMethod;
      closing.paidAt = paidSchedule.instant;
      closing.paidDate = paidSchedule.dateKey;
      closing.paidTime = paidSchedule.timeKey;
      closing.paidBy = getActorId(req);
      addClosingAudit(closing, {
        action: 'paid',
        user: getActorId(req),
        at: paidSchedule.instant,
        metadata: { amount: total, paymentMethod },
      });
      await closing.save();
      try {
        const payable = await syncPayableForClosing({ closing });
        if (payable && !closing.payable) {
          closing.payable = payable._id;
          await closing.save();
        }
      } catch (syncError) {
        await CommissionClosing.replaceOne({ _id: closing._id }, previous);
        return res.status(422).json({
          message: syncError.message || 'Pagamento nao registrado porque contas a pagar nao foi sincronizado.',
        });
      }
      return res.json({
        id: closing._id,
        status: closing.status,
        totalPago: closing.totalPago,
        totalPendente: closing.totalPendente,
        paidAt: closing.paidAt,
        paidDate: closing.paidDate,
        paidTime: closing.paidTime,
        meioPagamento: closing.meioPagamento,
        payable: closing.payable || null,
      });
    } catch (error) {
      console.error('[adminComissoesFechamentos] pay', error);
      return res.status(error.statusCode || 500).json({ message: error.message || 'Nao foi possivel registrar pagamento.' });
    }
  },
);

router.post(
  '/admin/comissoes/fechamentos/:id/cancel',
  requireAuth,
  authorizeRoles(...ADMIN_ROLES),
  async (req, res) => {
    try {
      const { id } = req.params;
      if (!isValidObjectId(id)) return res.status(400).json({ message: 'Fechamento invalido.' });
      const closing = await CommissionClosing.findById(id);
      if (!closing) return res.status(404).json({ message: 'Fechamento nao encontrado.' });
      await assertClosingStoreAccess(req, closing);
      if (req.body?.confirm !== true) {
        return res.status(400).json({ message: 'Confirme explicitamente o cancelamento.' });
      }
      if (closing.status === 'cancelado') {
        return res.status(409).json({ message: 'Fechamento ja cancelado.' });
      }
      if (closing.status === 'pago' && req.body?.confirmPaidReversal !== true) {
        return res.status(400).json({
          message: 'Confirme a reversao financeira do fechamento pago.',
          requiresPaidReversal: true,
        });
      }
      const reason = String(req.body?.reason || '').trim();
      if (reason.length < 5) {
        return res.status(400).json({ message: 'Informe um motivo de cancelamento com pelo menos 5 caracteres.' });
      }
      const previous = closing.toObject();
      const cancelledAt = new Date();
      closing.status = 'cancelado';
      closing.totalPendente = 0;
      closing.pendenteVendas = 0;
      closing.pendenteServicos = 0;
      closing.cancelledAt = cancelledAt;
      closing.cancelledDate = getCalendarDateKeyInSaoPaulo(cancelledAt);
      closing.cancelledTime = getClockTimeInSaoPaulo(cancelledAt).slice(0, 5);
      closing.cancelledBy = getActorId(req);
      closing.cancellationReason = reason;
      addClosingAudit(closing, {
        action: 'cancelled',
        user: getActorId(req),
        reason,
        at: cancelledAt,
        metadata: { reversedPaidClosing: previous.status === 'pago' },
      });
      await closing.save();
      try {
        await syncPayableForClosing({ closing, createIfMissing: false });
        await CommissionItemLock.deleteMany({ closing: closing._id });
      } catch (syncError) {
        await CommissionClosing.replaceOne({ _id: closing._id }, previous);
        return res.status(422).json({
          message: syncError.message || 'Cancelamento nao aplicado porque contas a pagar nao foi sincronizado.',
        });
      }
      return res.json({
        id: closing._id,
        status: closing.status,
        cancellationReason: closing.cancellationReason,
        cancelledAt: closing.cancelledAt,
      });
    } catch (error) {
      console.error('[adminComissoesFechamentos] cancel', error);
      return res.status(error.statusCode || 500).json({ message: error.message || 'Nao foi possivel cancelar fechamento.' });
    }
  },
);

router.delete('/admin/comissoes/fechamentos/:id', requireAuth, authorizeRoles(...ADMIN_ROLES), (req, res) =>
  res.status(405).json({
    message: 'Exclusao fisica desativada. Use o cancelamento auditavel do fechamento.',
  }),
);

module.exports = router;


