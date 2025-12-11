const express = require('express');
const mongoose = require('mongoose');
const authMiddleware = require('../middlewares/authMiddleware');
const authorizeRoles = require('../middlewares/authorizeRoles');
const UserGroup = require('../models/UserGroup');
const Store = require('../models/Store');
const PdvState = require('../models/PdvState');
const Service = require('../models/Service');
const Product = require('../models/Product');
const Appointment = require('../models/Appointment');
const CommissionClosing = require('../models/CommissionClosing');
const User = require('../models/User');

const router = express.Router();
const requireAdmin = authorizeRoles('admin', 'admin_master');

const DEFAULT_WINDOW_DAYS = 30;

const emptyView = () => ({
  totalPeriodo: 0,
  totalPendente: 0,
  totalVendas: 0,
  totalServicos: 0,
  pendenteVendas: 0,
  pendenteServicos: 0,
});

const parseNumber = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (value === null || value === undefined) return 0;
  const normalized = String(value)
    .trim()
    .replace(/\s+/g, '')
    .replace(/\.(?=\d{3}(?:\D|$))/g, '')
    .replace(',', '.')
    .replace(/[^\d.-]/g, '')
    .replace(/(?!^)-/g, '');
  if (!normalized || normalized === '-' || normalized === '.') return 0;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeDigits = (value) => {
  if (value === null || value === undefined) return '';
  const str = String(value);
  const digits = str.replace(/\D/g, '');
  return digits;
};

const normalizeStatus = (status) => {
  const value = (status || '').toString().toLowerCase();
  if (['completed', 'concluido', 'concluida', 'pago', 'paid'].includes(value)) return 'pago';
  if (['pending', 'pendente'].includes(value)) return 'pendente';
  if (['cancelado', 'cancelada', 'canceled', 'cancelled'].includes(value)) return 'cancelado';
  if (['aguardando', 'awaiting', 'em_andamento', 'processing'].includes(value)) return 'aguardando';
  return value || 'aguardando';
};

const normalizeName = (value = '') =>
  String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

const toStartOfDay = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  date.setHours(0, 0, 0, 0);
  return date;
};

const toEndOfDay = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  date.setHours(23, 59, 59, 999);
  return date;
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
  const candidates = [item.quantity, item.quantidade, item.qty, item.qtd, item.amount, item.quantityLabel];
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
    sale.total,
    sale.totalAmount,
    sale.valorTotal,
    sale.totalVenda,
    sale.totalGeral,
    totals?.liquido,
    totals?.total,
    totals?.totalGeral,
    totals?.pago,
    totals?.valorTotal,
    totals?.totalVenda,
    totals?.bruto,
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

const belongsToSeller = (sale = {}, { sellerIds, sellerCodes, operatorName }) => {
  const seller = sale?.seller || {};
  const idCandidates = [
    seller._id,
    seller.id,
    seller._id?.toString?.(),
    seller.id?.toString?.(),
    sale.sellerId,
  ].map((v) => (v ? String(v) : ''));

  for (const candidate of idCandidates) {
    if (candidate && sellerIds.has(candidate)) return true;
  }

  const codeCandidates = [sale.sellerCode, seller.codigo, seller.codigoCliente, seller.id, seller._id]
    .map(normalizeDigits)
    .filter(Boolean);

  const hasSellerInfo = idCandidates.some(Boolean) || codeCandidates.some(Boolean);

  for (const code of codeCandidates) {
    if (sellerCodes.has(code)) return true;
  }

  if (!hasSellerInfo) {
    const operator = normalizeName(sale.receiptSnapshot?.meta?.operador || sale.sellerName || '');
    if (operator && operatorName && operator === operatorName) {
      return true;
    }
  }

  return false;
};

const SERVICE_STATUS_VALUES = new Set(['agendado', 'em_espera', 'em_atendimento', 'finalizado']);
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
const pickCustomerName = (customer = {}) => {
  if (!customer || typeof customer !== 'object') return 'Cliente nao informado';
  const name =
    customer.nomeCompleto || customer.nomeContato || customer.razaoSocial || customer.nomeFantasia || customer.email;
  return name || 'Cliente nao informado';
};
const pickAppointmentCode = (appt = {}) => {
  if (appt.codigoVenda) return String(appt.codigoVenda);
  if (appt.saleCode) return String(appt.saleCode);
  if (appt.codigo) return String(appt.codigo);
  if (appt._id) return String(appt._id);
  return '--';
};

const collectServicoItems = (appointment = {}) => {
  if (!appointment || typeof appointment !== 'object') return [];
  const items = Array.isArray(appointment.itens) ? appointment.itens : [];
  return items.filter((item) => item && typeof item === 'object');
};

const collectServicoNomes = (appointment = {}, scopedItems = []) => {
  const names = [];
  const source = scopedItems.length ? scopedItems : collectServicoItems(appointment);
  source.forEach((item) => {
    const name = item?.servico?.nome || item?.nome || '';
    if (name) names.push(name);
  });
  if (!names.length && appointment.servico?.nome) {
    names.push(appointment.servico.nome);
  }
  return names;
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
    appointment.profissional && String(appointment.profissional?._id || appointment.profissional) === normalizedId;

  if (assigned.length) return { items: assigned, matchedByTopLevel: topMatches };
  if (topMatches) return { items, matchedByTopLevel: true };
  return { items: [], matchedByTopLevel: false };
};

const mapAppointmentToServicoRecord = (appointment = {}, { userId } = {}) => {
  const normalizedUserId = userId ? String(userId) : '';
  const { items, matchedByTopLevel } = resolveServicoItemsForUser(appointment, normalizedUserId);
  if (!items.length && !matchedByTopLevel) return null;

  const getItemPercent = (item) => {
    const raw =
      item?.servico?.grupo?.comissaoPercent ??
      item?.servico?.comissaoPercent ??
      item?.grupo?.comissaoPercent ??
      item?.comissaoPercent ??
      appointment?.servico?.grupo?.comissaoPercent ??
      0;
    const parsed = parseNumber(raw);
    return parsed !== null ? parsed : 0;
  };

  const valorServico = items.length
    ? items.reduce((sum, item) => sum + (parseNumber(item.valor) || 0), 0)
    : parseNumber(appointment.valor) || 0;

  const comissaoServico = items.length
    ? items.reduce((sum, item) => {
        const base = parseNumber(item.valor) || 0;
        const percent = getItemPercent(item);
        return sum + base * (percent / 100);
      }, 0)
    : valorServico * ((parseNumber(appointment?.servico?.grupo?.comissaoPercent) || 0) / 100);
  const isFinalizado = items.length
    ? items.every((it) => isServicoFinalizado(it.status))
    : isServicoFinalizado(appointment.status);
  const isPago = !!(appointment.pago || appointment.codigoVenda);
  const aReceber = (isFinalizado && !isPago) || (isPago && !isFinalizado);
  const servicoNomes = collectServicoNomes(appointment, items);
  const createdAt = appointment.scheduledAt || appointment.createdAt || appointment._createdAt;

  return {
    _createdAt: createdAt ? new Date(createdAt) : null,
    data: createdAt ? new Date(createdAt) : null,
    codigo: pickAppointmentCode(appointment),
    descricao: servicoNomes.join(', '),
    cliente: pickCustomerName(appointment.cliente),
    origem: 'Agenda de Servicos',
    status: isFinalizado ? 'finalizado' : normalizeServiceStatus(appointment.status || 'agendado'),
    comissaoServico,
    comissaoTotal: comissaoServico,
    valorVenda: valorServico,
    pagamento: isPago ? 'Pago' : 'Pendente',
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

const computeTotals = async ({ user, startDate, endDate, comissaoPercent = 0, comissaoServicoPercent = 0, storeId = null }) => {
  const view = emptyView();
  if (!user) return view;

  const sellerIds = new Set([String(user._id)]);
  const sellerCodes = new Set();
  if (user.codigoCliente) sellerCodes.add(normalizeDigits(user.codigoCliente));
  const normalizedUserName = normalizeName(
    user.nomeCompleto || user.nomeContato || user.razaoSocial || user.email || '',
  );

  const dateMatch = {};
  if (startDate) dateMatch.$gte = startDate;
  if (endDate) dateMatch.$lte = endDate;

  const pipeline = [{ $match: { 'completedSales.0': { $exists: true } } }, { $project: { completedSales: 1 } }, { $unwind: '$completedSales' }];
  if (Object.keys(dateMatch).length) {
    pipeline.push({ $match: { 'completedSales.createdAt': dateMatch } });
  }

  const aggregated = await PdvState.aggregate(pipeline).allowDiskUse(true);
  const sales = aggregated
    .map((entry) => ({
      ...(entry.completedSales || {}),
      _pdvStateId: entry._id,
    }))
    .filter((sale) => belongsToSeller(sale, { sellerIds, sellerCodes, operatorName: normalizedUserName }));

  const itemIdSet = new Set();
  sales.forEach((sale) => {
    collectSaleItems(sale).forEach((item) => {
      const oid = extractItemObjectId(item);
      if (oid) itemIdSet.add(oid);
    });
  });

  const ids = Array.from(itemIdSet);
  const [servicesDocs, products] = await Promise.all([
    ids.length ? Service.find({ _id: { $in: ids } }).select('_id nome valor').lean() : [],
    ids.length ? Product.find({ _id: { $in: ids } }).select('_id nome venda').lean() : [],
  ]);

  const ServiceIdSet = new Set(servicesDocs.map((svc) => String(svc._id)));
  const productIdSet = new Set(products.map((prod) => String(prod._id)));

  const historicoBase = sales.map((sale) => {
    const items = collectSaleItems(sale);
    let valorProdutos = 0;
    let valorServicos = 0;

    items.forEach((item) => {
      const total = deriveItemTotal(item);
      const oid = extractItemObjectId(item);
      if (oid && ServiceIdSet.has(oid)) {
        valorServicos += total;
      } else if (oid && productIdSet.has(oid)) {
        valorProdutos += total;
      } else if (item.productSnapshot || item.product || item.produto) {
        valorProdutos += total;
      } else {
        valorServicos += total;
      }
    });

    const vendaBase = valorProdutos;
    const servicoBase = valorServicos;
    const comissaoVenda = vendaBase * (parseNumber(comissaoPercent) / 100);
    const comissaoServico = servicoBase * (parseNumber(comissaoServicoPercent) / 100);
    const comissaoTotal = comissaoVenda + comissaoServico;
    const createdAt = sale.createdAt ? new Date(sale.createdAt) : null;
    const status = normalizeStatus(sale.status);

    return {
      _createdAt: createdAt,
      status,
      comissaoTotal,
      valorProdutos,
      valorServicos,
    };
  });

  const vendasTotal = historicoBase.reduce((sum, item) => sum + (parseNumber(item.comissaoTotal) || 0), 0);
  const pendenteVendas = historicoBase
    .filter((item) => normalizeStatus(item.status) !== 'pago')
    .reduce((sum, item) => sum + (parseNumber(item.comissaoTotal) || 0), 0);

  const serviceQuery = {};
  if (Object.keys(dateMatch).length) serviceQuery.scheduledAt = dateMatch;
  serviceQuery.$or = [
    { profissional: user._id },
    { 'itens.profissional': user._id },
  ];
  if (storeId && mongoose.Types.ObjectId.isValid(String(storeId))) {
    serviceQuery.store = storeId;
  }

  const appointments = await Appointment.find(serviceQuery)
    .select('scheduledAt createdAt itens valor pago codigoVenda status profissional cliente servico store')
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
    .lean();

  const servicoRecords = buildServicosRecords(appointments, { userId: user._id });
  const servicosTotal = servicoRecords.reduce((sum, r) => sum + (parseNumber(r.comissaoTotal) || 0), 0);
  const pendenteServicos = servicoRecords
    .filter((r) => r.aReceber)
    .reduce((sum, r) => sum + (parseNumber(r.comissaoTotal) || 0), 0);

  view.totalVendas = vendasTotal;
  view.totalServicos = servicosTotal;
  view.pendenteVendas = pendenteVendas;
  view.pendenteServicos = pendenteServicos;
  view.totalPeriodo = vendasTotal + servicosTotal;
  view.totalPendente = pendenteVendas + pendenteServicos;

  return view;
};

router.get('/admin/comissoes/fechamentos/stores', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const user = await User.findById(req.user?.id || req.user?._id).select('empresaPrincipal empresas').lean();
    const storeIds = new Set();
    if (user?.empresaPrincipal) storeIds.add(String(user.empresaPrincipal));
    if (Array.isArray(user?.empresas)) {
      user.empresas.forEach((id) => {
        if (id) storeIds.add(String(id));
      });
    }

    const stores = storeIds.size
      ? await Store.find({ _id: { $in: Array.from(storeIds) } }).select('_id nome').lean()
      : [];

    return res.json(stores);
  } catch (error) {
    console.error('[adminComissoesFechamentos] stores', error);
    return res.status(500).json({ message: 'Erro ao carregar empresas' });
  }
});

router.get('/admin/comissoes/fechamentos', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const filter = {};
    if (req.query?.store && mongoose.Types.ObjectId.isValid(req.query.store)) {
      filter.store = req.query.store;
    }
    if (req.query?.status) filter.status = req.query.status;

    const list = await CommissionClosing.find(filter)
      .populate('profissional', 'nomeCompleto nomeContato razaoSocial')
      .populate('store', 'nome')
      .sort({ createdAt: -1 })
      .lean();

    const mapped = list.map((item) => ({
      ...item,
      profissionalNome:
        item.profissional?.nomeCompleto || item.profissional?.nomeContato || item.profissional?.razaoSocial || '—',
      storeNome: item.store?.nome || '—',
      tipo: 'Vendas/Serviços',
      previsto: item.totalPeriodo || 0,
      pago: item.totalPago || 0,
      pendente: item.totalPendente || 0,
    }));

    return res.json(mapped);
  } catch (error) {
    console.error('[adminComissoesFechamentos] list', error);
    return res.status(500).json({ message: 'Erro ao listar fechamentos' });
  }
});

router.post('/admin/comissoes/fechamentos', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const { profissionalId, storeId, inicio, fim, previsaoPagamento, meioPagamento } = req.body || {};
    if (!profissionalId || !mongoose.Types.ObjectId.isValid(profissionalId)) {
      return res.status(400).json({ message: 'Funcionário inválido.' });
    }
    const user = await User.findById(profissionalId)
      .select('nomeCompleto nomeContato razaoSocial codigoCliente userGroup')
      .lean();
    if (!user) return res.status(404).json({ message: 'Funcionário não encontrado.' });

    let userGroup = null;
    if (user.userGroup) {
      userGroup = await UserGroup.findById(user.userGroup).select('comissaoPercent comissaoServicoPercent').lean();
    }

    const startDate =
      toStartOfDay(inicio) ||
      toStartOfDay(new Date(Date.now() - DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000));
    const endDate = fim ? toEndOfDay(fim) : null;

    const totals = await computeTotals({
      user,
      startDate,
      endDate,
      comissaoPercent: userGroup?.comissaoPercent ?? 0,
      comissaoServicoPercent: userGroup?.comissaoServicoPercent ?? 0,
      storeId,
    });

    const payload = {
      profissional: profissionalId,
      store: mongoose.Types.ObjectId.isValid(storeId) ? storeId : null,
      periodoInicio: startDate,
      periodoFim: endDate || startDate,
      totalPeriodo: totals.totalPeriodo,
      totalPendente: totals.totalPendente,
      totalVendas: totals.totalVendas,
      totalServicos: totals.totalServicos,
      pendenteVendas: totals.pendenteVendas,
      pendenteServicos: totals.pendenteServicos,
      totalPago: 0,
      previsaoPagamento: previsaoPagamento ? new Date(previsaoPagamento) : null,
      meioPagamento: meioPagamento || '',
      status: 'pendente',
      createdBy: req.user?._id,
    };

    const created = await CommissionClosing.create(payload);
    const full = await CommissionClosing.findById(created._id)
      .populate('profissional', 'nomeCompleto nomeContato razaoSocial')
      .populate('store', 'nome')
      .lean();

    return res.status(201).json({
      ...full,
      profissionalNome:
        full.profissional?.nomeCompleto || full.profissional?.nomeContato || full.profissional?.razaoSocial || '—',
      storeNome: full.store?.nome || '—',
      tipo: 'Vendas/Serviços',
      previsto: full.totalPeriodo || 0,
      pago: full.totalPago || 0,
      pendente: full.totalPendente || 0,
    });
  } catch (error) {
    console.error('[adminComissoesFechamentos] create', error);
    return res.status(500).json({ message: 'Erro ao criar fechamento' });
  }
});

router.get('/admin/comissoes/fechamentos/pendentes', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const storeId = req.query?.store && mongoose.Types.ObjectId.isValid(req.query.store) ? req.query.store : null;
    const dias = Math.min(
      180,
      Math.max(
        7,
        parseInt(req.query?.dias, 10) ||
          parseInt(req.query?.days, 10) ||
          DEFAULT_WINDOW_DAYS
      )
    );
    const startDate =
      toStartOfDay(req.query?.start) ||
      toStartOfDay(new Date(Date.now() - dias * 24 * 60 * 60 * 1000));
    const endDate = req.query?.end ? toEndOfDay(req.query.end) : null;

    const staffFilter = {};
    if (storeId) {
      staffFilter.$or = [{ empresaPrincipal: storeId }, { empresas: storeId }];
    }

    const staff = await User.find(staffFilter)
      .select('nomeCompleto nomeContato razaoSocial codigoCliente userGroup')
      .lean();

    if (!staff.length) return res.json([]);

    const result = [];
    for (const user of staff) {
      let userGroup = null;
      if (user.userGroup) {
        userGroup = await UserGroup.findById(user.userGroup)
          .select('comissaoPercent comissaoServicoPercent')
          .lean();
      }
      const totals = await computeTotals({
        user,
        startDate,
        endDate,
        comissaoPercent: userGroup?.comissaoPercent ?? 0,
        comissaoServicoPercent: userGroup?.comissaoServicoPercent ?? 0,
        storeId,
      });

      const totalPendente = totals.totalPendente || 0;
      if (totalPendente <= 0) continue;

      result.push({
        profissionalId: String(user._id),
        profissionalNome:
          user.nomeCompleto || user.nomeContato || user.razaoSocial || '—',
        totalPendente,
        pendenteVendas: totals.pendenteVendas || 0,
        pendenteServicos: totals.pendenteServicos || 0,
        totalPeriodo: totals.totalPeriodo || 0,
        periodoInicio: startDate,
        periodoFim: endDate,
        storeId,
      });
    }

    return res.json(result);
  } catch (error) {
    console.error('[adminComissoesFechamentos] pendentes', error);
    return res.status(500).json({ message: 'Erro ao listar pendências' });
  }
});

module.exports = router;
