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

const ADMIN_ROLES = ['admin', 'admin_master'];
const DEFAULT_WINDOW_DAYS = 90;
const SERVICE_STATUS_VALUES = new Set(['agendado', 'em_espera', 'em_atendimento', 'finalizado']);
const DEFAULT_COMISSAO_PERCENT = 1;
const DEFAULT_COMISSAO_SERVICO_PERCENT = 0.5;

const emptyTotals = () => ({
  totalPeriodo: 0,
  totalPendente: 0,
  totalVendas: 0,
  totalServicos: 0,
  pendenteVendas: 0,
  pendenteServicos: 0,
  totalPago: 0,
});

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || ''));

const parseDateUtcMidnight = (value) => {
  if (!value) return null;
  if (typeof value === 'string') {
    const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) {
      const y = Number(m[1]);
      const mo = Number(m[2]) - 1;
      const d = Number(m[3]);
      const dt = new Date(y, mo, d, 0, 0, 0, 0);
      return Number.isNaN(dt.getTime()) ? null : dt;
    }
  }
  const dt = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isNaN(dt.getTime()) ? null : dt;
};

// Datas para calculo (mantem o fuso local)
const toStartOfDay = (value) => {
  const date = parseDateUtcMidnight(value);
  if (!date) return null;
  date.setHours(0, 0, 0, 0);
  return date;
};

const toEndOfDay = (value) => {
  const date = parseDateUtcMidnight(value);
  if (!date) return null;
  date.setHours(23, 59, 59, 999);
  return date;
};

const resolveUserStoreAccess = async (userId) => {
  if (!userId) return { allowedStoreIds: [], allowAllStores: false };
  const user = await User.findById(userId).select('empresaPrincipal empresas role').lean();
  if (!user) return { allowedStoreIds: [], allowAllStores: false };

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
  const allowAllStores = user.role === 'admin_master' && allowedStoreIds.length === 0;

  return { allowedStoreIds, allowAllStores };
};

const generatePayableCode = () => `COM-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

const syncPayableForClosing = async ({ closing, totals }) => {
  if (!closing || !closing.store || !closing.profissional) return null;
  const totalPendente = Number(totals?.totalPendente || closing.totalPendente || 0);
  if (totalPendente <= 0) return null;

  const config = await CommissionConfig.findOne({ store: closing.store }).lean();
  if (!config || !config.accountingAccount || !config.bankAccount) {
    throw new Error('Configure conta contábil e conta corrente na engrenagem antes de fechar comissões.');
  }

  const [accountingExists, bankExists] = await Promise.all([
    AccountingAccount.exists({
      _id: config.accountingAccount,
      paymentNature: 'contas_pagar',
      companies: closing.store,
    }),
    BankAccount.exists({ _id: config.bankAccount, company: closing.store }),
  ]);
  if (!accountingExists) throw new Error('Conta contábil configurada é inválida para a empresa.');
  if (!bankExists) throw new Error('Conta corrente configurada é inválida para a empresa.');

  const dueDate = closing.previsaoPagamento || closing.periodoFim || new Date();
  let payable = closing.payable ? await AccountPayable.findById(closing.payable) : null;

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
      totalValue: totalPendente,
      bankAccount: config.bankAccount,
      accountingAccount: config.accountingAccount,
      notes: `Fechamento de comissão ${closing._id || ''} (${closing.periodoInicio || ''} a ${closing.periodoFim || ''})`,
      installments: [
        {
          number: 1,
          issueDate: new Date(),
          dueDate,
          value: totalPendente,
          bankAccount: config.bankAccount,
          accountingAccount: config.accountingAccount,
          status: 'pending',
        },
      ],
    });
  } else {
    payable.company = closing.store;
    payable.partyType = 'User';
    payable.party = closing.profissional;
    payable.dueDate = dueDate;
    payable.totalValue = totalPendente;
    payable.bankAccount = config.bankAccount;
    payable.accountingAccount = config.accountingAccount;
    // Atualiza/gera parcela única
    if (!Array.isArray(payable.installments) || payable.installments.length === 0) {
      payable.installments = [
        {
          number: 1,
          issueDate: new Date(),
          dueDate,
          value: totalPendente,
          bankAccount: config.bankAccount,
          accountingAccount: config.accountingAccount,
          status: closing.status === 'pago' ? 'paid' : 'pending',
        },
      ];
    } else {
      const inst = payable.installments[0];
      inst.dueDate = dueDate;
      inst.value = totalPendente;
      inst.bankAccount = config.bankAccount;
      inst.accountingAccount = config.accountingAccount;
      inst.status = closing.status === 'pago' ? 'paid' : inst.status || 'pending';
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

const mapAppointmentToServicoRecord = (appointment = {}, { userId, defaultPercent = 0 } = {}) => {
  const normalizedUserId = userId ? String(userId) : '';
  const { items, matchedByTopLevel } = resolveServicoItemsForUser(appointment, normalizedUserId);
  if (!items.length && !matchedByTopLevel) return null;

  const fallbackPercent = Number.isFinite(defaultPercent) ? defaultPercent : 0;
  const getItemPercent = (item) => {
    const raw =
      item?.servico?.grupo?.comissaoPercent ??
      item?.servico?.comissaoPercent ??
      item?.grupo?.comissaoPercent ??
      item?.comissaoPercent ??
      appointment?.servico?.grupo?.comissaoPercent ??
      0;
    const parsed = parseNumber(raw);
    return parsed !== null ? parsed : null;
  };

  const valorServico = items.length
    ? items.reduce((sum, item) => sum + (parseNumber(item.valor) || 0), 0)
    : parseNumber(appointment.valor) || 0;

  const comissaoServico = items.length
    ? items.reduce((sum, item) => {
        const base = parseNumber(item.valor) || 0;
        const percent = getItemPercent(item);
        const applied = percent !== null ? percent : fallbackPercent;
        return sum + base * (applied / 100);
      }, 0)
    : valorServico *
      (((parseNumber(appointment?.servico?.grupo?.comissaoPercent) || fallbackPercent) / 100));
  const isFinalizado = items.length
    ? items.every((it) => isServicoFinalizado(it.status))
    : isServicoFinalizado(appointment.status);
  const isPago = !!(appointment.pago || appointment.codigoVenda);
  const aReceber = (isFinalizado && !isPago) || (isPago && !isFinalizado);

  return {
    _createdAt: appointment.scheduledAt ? new Date(appointment.scheduledAt) : null,
    comissaoServico,
    comissaoTotal: comissaoServico,
    valorVenda: valorServico,
    status: isFinalizado ? 'finalizado' : normalizeServiceStatus(appointment.status || 'agendado'),
    isFinalizado,
    pago: isPago,
    aReceber,
  };
};

const buildServicosRecords = (appointments = [], opts = {}) => {
  const records = [];
  appointments.forEach((appt) => {
    const mapped = mapAppointmentToServicoRecord(appt, opts);
    if (mapped) records.push(mapped);
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
    if (status === 'cancelado') return;

    const comissaoTotal = (parseNumber(item.comissaoVenda) || 0) + (parseNumber(item.comissaoServico) || 0);
    totals.totalVendas += comissaoTotal;
    // Para repasse, consideramos tudo pendente até quitação manual
  });

  return totals;
};

const buildSaleRecord = (
  sale = {},
  { comissaoPercent = 0, comissaoServicoPercent = 0, serviceIdSet = new Set(), productIdSet = new Set() },
) => {
  const items = collectSaleItems(sale);
  let valorProdutos = 0;
  let valorServicos = 0;
  let comissaoProdutos = 0;
  let comissaoServicos = 0;
  let hasItemProdPercent = false;
  let hasItemSvcPercent = false;

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

  items.forEach((item) => {
    const total = deriveItemTotal(item);
    const oid = extractItemObjectId(item);
    const isServicoId = oid && serviceIdSet.has(oid);
    const isProdutoId = oid && productIdSet.has(oid);
    const isProdutoSnapshot = item.productSnapshot || item.product || item.produto;
    const isServico = isServicoId || (!isProdutoId && !isProdutoSnapshot && item.servico);

    if (isServico) {
      valorServicos += total;
      const percent = resolvePercent(item);
      const applied = percent !== null ? percent : comissaoServicoPercent;
      if (percent !== null) hasItemSvcPercent = true;
      comissaoServicos += total * (applied / 100);
    } else {
      valorProdutos += total;
      const percent = resolvePercent(item);
      const applied = percent !== null ? percent : comissaoPercent;
      if (percent !== null) hasItemProdPercent = true;
      comissaoProdutos += total * (applied / 100);
    }
  });

  let vendaBase = valorProdutos;
  let servicoBase = valorServicos;

  // Fallback: se itens não trouxeram valores, usa total da venda como base de produto.
  if (vendaBase + servicoBase === 0) {
    const totalVenda = deriveSaleTotal(sale);
    vendaBase = totalVenda;
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
  };
};

const fetchSalesForUser = async ({ user, startDate = null, endDate = null, storeId = null, debug = false }) => {
  const sellerIds = new Set();
  const sellerCodes = new Set();

  if (user?._id) sellerIds.add(String(user._id));
  if (user?.codigoCliente) sellerCodes.add(normalizeDigits(user.codigoCliente));
  if (user?.cpf) sellerCodes.add(normalizeDigits(user.cpf));
  const operatorName = normalizeName(
    user?.nomeCompleto || user?.nomeContato || user?.razaoSocial || user?.email || '',
  );
  const userEmail = (user?.email || '').toString().toLowerCase().trim();

  const pipeline = [];
  if (storeId && isValidObjectId(storeId)) {
    pipeline.push({ $match: { empresa: new mongoose.Types.ObjectId(String(storeId)) } });
  }

  pipeline.push(
    { $match: { 'completedSales.0': { $exists: true } } },
    { $project: { completedSales: 1, empresa: 1 } },
    { $unwind: '$completedSales' },
  );

  const aggregated = await PdvState.aggregate(pipeline).allowDiskUse(true);

  const matched = [];
  const unmatched = [];

  aggregated.forEach((entry) => {
    const sale = {
      ...(entry.completedSales || {}),
      _pdvStateId: entry._id,
      _storeId: entry.empresa,
    };
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
      if (saleDate) {
        if (startDate && saleDate < startDate) return;
        if (endDate && saleDate > endDate) return;
      }
    }
    matched.push(sale);
  });

  return {
    sales: matched,
    aggregatedTotal: aggregated.length,
    matched: matched.length,
    unmatched,
  };
};

const fetchServicoRecords = async ({
  user,
  startDate = null,
  endDate = null,
  storeId = null,
  defaultPercent = 0,
}) => {
  if (!user?._id) return [];

  const profissionalId = isValidObjectId(user._id)
    ? new mongoose.Types.ObjectId(String(user._id))
    : null;

  const serviceDateMatch = {};
  if (startDate) serviceDateMatch.$gte = startDate;
  if (endDate) serviceDateMatch.$lte = endDate;

  const serviceQuery = {};
  if (Object.keys(serviceDateMatch).length) {
    serviceQuery.$or = [
      { scheduledAt: serviceDateMatch },
      { createdAt: serviceDateMatch },
    ];
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
          'scheduledAt createdAt itens valor pago codigoVenda status profissional cliente servico store',
        )
        .populate('cliente', 'nomeCompleto nomeContato razaoSocial nomeFantasia email')
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
  });
};

const computeCommissionSummaryForUser = async ({ user, startDate = null, endDate = null, storeId = null, debug = false }) => {
  if (!user) return { totals: emptyTotals(), debug: { sales: 0, services: 0 } };

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

  const { sales, aggregatedTotal, matched, unmatched } = await fetchSalesForUser({
    user,
    startDate,
    endDate,
    storeId,
    debug,
  });

  const itemIdSet = new Set();
  sales.forEach((sale) => {
    collectSaleItems(sale).forEach((item) => {
      const oid = extractItemObjectId(item);
      if (oid) itemIdSet.add(oid);
    });
  });

  const ids = Array.from(itemIdSet);
  const [services, products] = await Promise.all([
    ids.length ? Service.find({ _id: { $in: ids } }).select('_id').lean() : [],
    ids.length ? Product.find({ _id: { $in: ids } }).select('_id').lean() : [],
  ]);

  const serviceIdSet = new Set(services.map((svc) => String(svc._id)));
  const productIdSet = new Set(products.map((prod) => String(prod._id)));

  const saleRecords = sales.map((sale) =>
    buildSaleRecord(sale, {
      comissaoPercent,
      comissaoServicoPercent,
      serviceIdSet,
      productIdSet,
    }),
  );

  const saleTotals = summarizeSaleRecords(saleRecords);

  const servicoRecords = await fetchServicoRecords({
    user,
    startDate,
    endDate,
    storeId,
    defaultPercent: comissaoServicoPercent,
  });
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
    debug: { sales: sales.length, services: servicoRecords.length, salesAggregated: aggregatedTotal, salesMatched: matched, salesUnmatched: unmatched },
  };
};

const pickUserName = (user = {}) =>
  user.nomeCompleto || user.nomeContato || user.razaoSocial || user.nome || user.email || 'Sem nome';

const formatPeriod = (inicio, fim) => {
  const start = inicio instanceof Date ? inicio : inicio ? new Date(inicio) : null;
  const end = fim instanceof Date ? fim : fim ? new Date(fim) : null;
  const startStr = start && !Number.isNaN(start.getTime()) ? start.toLocaleDateString('pt-BR') : '--';
  const endStr = end && !Number.isNaN(end.getTime()) ? end.toLocaleDateString('pt-BR') : '--';
  return `${startStr} a ${endStr}`;
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
      const { allowedStoreIds, allowAllStores } = await resolveUserStoreAccess(req.user?.id);
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
      const { allowedStoreIds, allowAllStores } = await resolveUserStoreAccess(req.user?.id);
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
        config: config
          ? {
              accountingAccount: config.accountingAccount ? String(config.accountingAccount) : null,
              bankAccount: config.bankAccount ? String(config.bankAccount) : null,
              updatedAt: config.updatedAt || config.createdAt || null,
            }
          : null,
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
      const { storeId, accountingAccount, bankAccount } = req.body || {};
      if (!storeId || !isValidObjectId(storeId)) {
        return res.status(400).json({ message: 'Informe a empresa.' });
      }
      const { allowedStoreIds, allowAllStores } = await resolveUserStoreAccess(req.user?.id);
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

      const config = await CommissionConfig.findOneAndUpdate(
        { store: storeId },
        {
          store: storeId,
          accountingAccount: accountingAccountId,
          bankAccount: bankAccountId,
          updatedBy: req.user?.id || null,
          $setOnInsert: { createdBy: req.user?.id || null },
        },
        { upsert: true, new: true },
      ).lean();

      return res.json({
        accountingAccount: config.accountingAccount ? String(config.accountingAccount) : null,
        bankAccount: config.bankAccount ? String(config.bankAccount) : null,
        updatedAt: config.updatedAt || config.createdAt || null,
      });
    } catch (error) {
      console.error('[adminComissoesFechamentos] save config', error);
      return res.status(500).json({ message: 'Nao foi possivel salvar configuracao.' });
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
      const { allowedStoreIds, allowAllStores } = await resolveUserStoreAccess(req.user?.id);
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
      const startLocal =
        toStartOfDay(req.query?.start) ||
        toStartOfDay(new Date(Date.now() - DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000));
      const endLocal = req.query?.end ? toEndOfDay(req.query.end) : toEndOfDay(new Date());
      const debug = req.query?.debug === '1';

      const filter = {};
      if (storeId) filter.store = storeId;
      else if (!allowAllStores && allowedStoreIds.length) filter.store = { $in: allowedStoreIds };
      if (startLocal || endLocal) {
        filter.$and = [
          { periodoInicio: { $lte: endLocal } },
          { periodoFim: { $gte: startLocal } },
        ];
      }

      const closings = await CommissionClosing.find(filter)
        .sort({ createdAt: -1 })
        .populate('profissional', 'nomeCompleto nomeContato razaoSocial nome codigoCliente')
        .populate('store', 'nome nomeFantasia razaoSocial')
        .lean();

      const existingKey = new Set(
        closings.map((closing) => `${String(closing.profissional)}|${String(closing.store || '')}`),
      );

      const payload = closings.map((closing) => {
        const profissionalNome = pickUserName(closing.profissional);
        const storeNome =
          closing.store?.nome || closing.store?.nomeFantasia || closing.store?.razaoSocial || '';
        const ultimoPagamento =
          closing.status === 'pago'
            ? (closing.updatedAt || closing.previsaoPagamento || closing.periodoFim || closing.createdAt)
            : null;

        return {
          id: closing._id,
          profissional: closing.profissional?._id || closing.profissional,
          profissionalNome,
          store: closing.store?._id || closing.store || null,
          storeNome,
          periodoInicio: closing.periodoInicio,
          periodoFim: closing.periodoFim,
          periodo: formatPeriod(closing.periodoInicio, closing.periodoFim),
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
          meioPagamento: closing.meioPagamento || '',
          ultimoPagamento: ultimoPagamento
            ? new Date(ultimoPagamento).toLocaleDateString('pt-BR')
            : '--',
          createdAt: closing.createdAt,
        };
      });

      // Nenhum fechamento registrado: calcular dinamicamente por profissional no período.
      const profissionais = await User.find({ role: { $in: ['funcionario', 'admin', 'admin_master'] } })
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

      // Reaproveita as chaves já existentes (fechamentos do banco)
      // e também evita adicionar duplicado entre sintéticos.
      const syntheticKeys = new Set(
        payload.map((c) => `${String(c.profissional)}|${String(c.store || '')}`),
      );

      for (const profissional of profissionais) {
        for (const storeKey of storeList) {
          // eslint-disable-next-line no-await-in-loop
          const summary = await computeCommissionSummaryForUser({
            user: profissional,
            startDate: startLocal,
            endDate: endLocal,
            storeId: storeKey,
            debug,
          });
          const totals = summary.totals || emptyTotals();
          // Exibir todos, mesmo com pendente 0 (para aparecer na lista de pendências)
          const dedupKey = `${String(profissional._id)}|${storeKey || ''}`;
          if (existingKey.has(dedupKey)) continue;
          if (syntheticKeys.has(dedupKey)) continue;
          if (!totals.totalPeriodo && !totals.totalPendente) continue;
          payload.push({
            id: `dyn-${profissional._id}-${storeKey || 'all'}`,
            profissional: profissional._id,
            profissionalNome: pickUserName(profissional),
            store: storeKey || null,
            storeNome: storeNamesById.get(storeKey) || '',
            periodoInicio: startLocal,
            periodoFim: endLocal,
            periodo: formatPeriod(startLocal, endLocal),
            previsto: totals.totalPeriodo,
            pago: 0,
            pendente: totals.totalPendente,
            totalPeriodo: totals.totalPeriodo,
            totalPendente: totals.totalPendente,
            totalVendas: totals.totalVendas,
            totalServicos: totals.totalServicos,
            pendenteVendas: totals.pendenteVendas,
            pendenteServicos: totals.pendenteServicos,
             status: totals.totalPendente ? 'pendente' : 'pago',
             previsaoPagamento: null,
             meioPagamento: '',
             ultimoPagamento: '--',
             synthetic: true,
             debug: debug ? summary.debug : undefined,
          });
          syntheticKeys.add(dedupKey);
        }
      }

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
  '/admin/comissoes/fechamentos/pendentes',
  requireAuth,
  authorizeRoles(...ADMIN_ROLES),
  async (req, res) => {
    try {
      const requestedStoreId = req.query?.store && isValidObjectId(req.query.store)
        ? String(req.query.store)
        : null;
      const { allowedStoreIds, allowAllStores } = await resolveUserStoreAccess(req.user?.id);
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

      const start = toStartOfDay(req.query?.start) ||
        toStartOfDay(new Date(Date.now() - DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000));
      const end = req.query?.end ? toEndOfDay(req.query.end) : toEndOfDay(new Date());

      const profissionais = await User.find({ role: { $in: ['funcionario', 'admin', 'admin_master'] } })
        .select('nomeCompleto nomeContato razaoSocial nome email userGroup codigoCliente')
        .populate('userGroup', 'comissaoPercent comissaoServicoPercent')
        .lean();

      const result = [];
      for (const profissional of profissionais) {
        // eslint-disable-next-line no-await-in-loop
        const summary = await computeCommissionSummaryForUser({
          user: profissional,
          startDate: start,
          endDate: end,
          storeId,
        });

        const totals = summary.totals || emptyTotals();
        // Desconta fechamentos pagos do perÇðodo/loja
        const closingFilter = {
          profissional: profissional._id,
          status: 'pago',
        };
        if (storeId) closingFilter.store = storeId;
        closingFilter.$and = [
          { periodoInicio: { $lte: end } },
          { periodoFim: { $gte: start } },
        ];

        // eslint-disable-next-line no-await-in-loop
        const paidClosings = await CommissionClosing.find(closingFilter)
          .select('totalPago totalPeriodo')
          .lean();
        const paidSum = paidClosings.reduce(
          (acc, c) => acc + (Number(c.totalPago) || Number(c.totalPeriodo) || 0),
          0,
        );

        let totalPendente = totals.totalPendente;
        let pendenteVendas = totals.pendenteVendas;
        let pendenteServicos = totals.pendenteServicos;

        if (paidSum > 0) {
          const base = Math.max(totalPendente, pendenteVendas + pendenteServicos);
          const remaining = Math.max(base - paidSum, 0);
          if (pendenteVendas + pendenteServicos > 0) {
            const ratio = pendenteVendas / (pendenteVendas + pendenteServicos);
            pendenteVendas = Math.max(remaining * ratio, 0);
            pendenteServicos = Math.max(remaining - pendenteVendas, 0);
          } else {
            pendenteVendas = remaining;
            pendenteServicos = 0;
          }
          totalPendente = remaining;
        }

        if (!totalPendente) continue;

        result.push({
          profissional: profissional._id,
          profissionalNome: pickUserName(profissional),
          totalPendente,
          pendenteServicos,
          pendenteVendas,
          totalServicos: totals.totalServicos,
          totalVendas: totals.totalVendas,
          totalPago: totals.totalPago,
        });
      }

      return res.json(result);
    } catch (error) {
      console.error('[adminComissoesFechamentos] pendentes', error);
      return res.status(500).json({ message: 'Nao foi possivel calcular pendencias.' });
    }
  },
);

router.post(
  '/admin/comissoes/fechamentos',
  requireAuth,
  authorizeRoles(...ADMIN_ROLES),
  async (req, res) => {
    try {
      const { profissionalId, inicio, fim, previsaoPagamento, meioPagamento, storeId } = req.body || {};
      if (!profissionalId || !isValidObjectId(profissionalId)) {
        return res.status(400).json({ message: 'Profissional obrigatorio.' });
      }
      const requestedStoreId = storeId && isValidObjectId(storeId) ? String(storeId) : null;
      const { allowedStoreIds, allowAllStores } = await resolveUserStoreAccess(req.user?.id);
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
      const startDateLocal = toStartOfDay(inicio);
      const endDateLocal = toEndOfDay(fim);
      if (!startDateLocal || !endDateLocal) {
        return res.status(400).json({ message: 'Periodo invalido.' });
      }

      const profissional = await User.findById(profissionalId)
        .select('nomeCompleto nomeContato razaoSocial nome email userGroup codigoCliente')
        .populate('userGroup', 'comissaoPercent comissaoServicoPercent')
        .lean();
      if (!profissional) {
        return res.status(404).json({ message: 'Profissional nao encontrado.' });
      }

      // evita duplicar fechamento no mesmo periodo/loja/profissional
      const overlapFilter = {
        profissional: profissional._id,
        store: safeStoreId,
        $or: [
          {
            periodoInicio: { $lte: endDateLocal },
            periodoFim: { $gte: startDateLocal },
          },
        ],
      };

      const existing = await CommissionClosing.findOne(overlapFilter).lean();
      if (existing) {
        return res.status(409).json({
          message: 'Ja existe um fechamento para este profissional e periodo.',
          existingId: existing._id,
        });
      }

        const summary = await computeCommissionSummaryForUser({
          user: profissional,
          startDate: startDateLocal,
          endDate: endDateLocal,
          storeId: safeStoreId,
        });

        const totals = summary.totals || emptyTotals();
        const payload = {
          profissional: profissional._id,
          store: safeStoreId,
          periodoInicio: startDateLocal,
          periodoFim: endDateLocal,
          totalPeriodo: totals.totalPeriodo,
          totalPendente: totals.totalPendente,
          totalVendas: totals.totalVendas,
        totalServicos: totals.totalServicos,
        pendenteVendas: totals.pendenteVendas,
        pendenteServicos: totals.pendenteServicos,
        totalPago: 0,
        previsaoPagamento: previsaoPagamento ? toEndOfDay(previsaoPagamento) : null,
        meioPagamento: (meioPagamento || '').toString().trim(),
        status: previsaoPagamento ? 'agendado' : 'pendente',
        createdBy: req.user?.id || req.user?._id || profissional._id,
      };

      const created = await CommissionClosing.create(payload);
      try {
        const payable = await syncPayableForClosing({ closing: created, totals });
        if (payable) {
          created.payable = payable._id;
          await created.save();
        }
      } catch (syncErr) {
        console.error('[adminComissoesFechamentos] payable sync error', syncErr);
        return res.status(201).json({
          id: created._id,
          profissional: created.profissional,
          periodoInicio: created.periodoInicio,
          periodoFim: created.periodoFim,
          totalPeriodo: created.totalPeriodo,
          totalPendente: created.totalPendente,
          totalVendas: created.totalVendas,
          totalServicos: created.totalServicos,
          pendenteVendas: created.pendenteVendas,
          pendenteServicos: created.pendenteServicos,
          totalPago: created.totalPago,
          status: created.status,
          previsaoPagamento: created.previsaoPagamento,
          meioPagamento: created.meioPagamento,
          store: created.store,
          profissionalNome: pickUserName(profissional),
          periodo: formatPeriod(created.periodoInicio, created.periodoFim),
          payable: created.payable || null,
          warning:
            syncErr.message ||
            'Não foi possível gerar contas a pagar. Configure conta contábil e conta corrente na engrenagem.',
          debug: req.query?.debug === '1' ? summary.debug : undefined,
        });
      }

      return res.status(201).json({
        id: created._id,
        profissional: created.profissional,
        periodoInicio: created.periodoInicio,
        periodoFim: created.periodoFim,
        totalPeriodo: created.totalPeriodo,
        totalPendente: created.totalPendente,
        totalVendas: created.totalVendas,
        totalServicos: created.totalServicos,
        pendenteVendas: created.pendenteVendas,
        pendenteServicos: created.pendenteServicos,
        totalPago: created.totalPago,
        status: created.status,
        previsaoPagamento: created.previsaoPagamento,
        meioPagamento: created.meioPagamento,
        store: created.store,
        profissionalNome: pickUserName(profissional),
        periodo: formatPeriod(created.periodoInicio, created.periodoFim),
        payable: created.payable || null,
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

      const allowedFields = ['status', 'totalPago', 'previsaoPagamento', 'meioPagamento'];
      const update = {};
      allowedFields.forEach((field) => {
        if (Object.prototype.hasOwnProperty.call(req.body || {}, field)) {
          update[field] = req.body[field];
        }
      });

      if (update.totalPago !== undefined) {
        const parsed = parseNumber(update.totalPago);
        update.totalPago = parsed !== null ? parsed : 0;
      }

      if (update.previsaoPagamento) {
        const parsedDate = toEndOfDay(update.previsaoPagamento);
        if (!parsedDate) return res.status(400).json({ message: 'Previsao invalida.' });
        update.previsaoPagamento = parsedDate;
      }

      if (update.meioPagamento !== undefined) {
        update.meioPagamento = (update.meioPagamento || '').toString().trim();
      }

      if (update.status) {
        const normalized = String(update.status).toLowerCase();
        if (!['pendente', 'agendado', 'pago'].includes(normalized)) {
          return res.status(400).json({ message: 'Status invalido.' });
        }
        update.status = normalized;
      }

      const closing = await CommissionClosing.findById(id);
      if (!closing) return res.status(404).json({ message: 'Fechamento nao encontrado.' });

      // recalcula pendente com base no totalPago enviado
      if (typeof update.totalPago === 'number') {
        const total = closing.totalPeriodo || 0;
        const pago = update.totalPago;
        update.totalPendente = Math.max(total - pago, 0);
      }

      Object.assign(closing, update);
      await closing.save();

      try {
        const totals = { totalPendente: closing.totalPendente };
        const payable = await syncPayableForClosing({ closing, totals });
        if (payable && !closing.payable) {
          closing.payable = payable._id;
          await closing.save();
        }
      } catch (err) {
        console.error('[adminComissoesFechamentos] payable sync on update', err);
      }

      return res.json({
        id: closing._id,
        status: closing.status,
        totalPago: closing.totalPago,
        totalPendente: closing.totalPendente,
        previsaoPagamento: closing.previsaoPagamento,
        meioPagamento: closing.meioPagamento,
        payable: closing.payable || null,
      });
    } catch (error) {
      console.error('[adminComissoesFechamentos] update', error);
      return res.status(500).json({ message: 'Nao foi possivel atualizar fechamento.' });
    }
  },
);

router.delete(
  '/admin/comissoes/fechamentos/:id',
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

      const { allowedStoreIds, allowAllStores } = await resolveUserStoreAccess(req.user?.id);
      const allowedStoreSet = new Set(allowedStoreIds.map((v) => String(v)));
      if (!allowAllStores && allowedStoreSet.size) {
        const closingStore = closing.store ? String(closing.store) : null;
        if (!closingStore || !allowedStoreSet.has(closingStore)) {
          return res.status(403).json({ message: 'Empresa nao permitida para o usuario.' });
        }
      }

      let deletedPayable = null;
      if (closing.payable) {
        await AccountPayable.deleteOne({ _id: closing.payable });
        deletedPayable = closing.payable;
      }

      await CommissionClosing.deleteOne({ _id: id });

      return res.json({
        deletedId: id,
        deletedPayable,
      });
    } catch (error) {
      console.error('[adminComissoesFechamentos] delete', error);
      return res.status(500).json({ message: 'Nao foi possivel reabrir fechamento.' });
    }
  },
);

module.exports = router;
