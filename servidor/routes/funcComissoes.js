const express = require('express');
const mongoose = require('mongoose');

const authMiddleware = require('../middlewares/authMiddleware');
const authorizeRoles = require('../middlewares/authorizeRoles');
const PdvState = require('../models/PdvState');
const User = require('../models/User');
const Product = require('../models/Product');
const Service = require('../models/Service');
const Appointment = require('../models/Appointment');
const UserGroup = require('../models/UserGroup');

const router = express.Router();
const requireStaff = authorizeRoles('funcionario', 'admin', 'admin_master');

const DEFAULT_WINDOW_DAYS = 90;

const emptyResumo = () => ({
  totalGerado: 0,
  totalPrevisto: 0,
  aReceber: 0,
  pagas: 0,
  media: 0,
  resumoPeriodo: {
    vendasComComissao: 0,
    taxaAprovacao: 0,
    tempoMedioLiberacao: null,
    bonificacoes: 0,
    cancelamentos: 0,
  },
});

const emptyView = () => ({
  resumo: emptyResumo(),
  proximosPagamentos: [],
  historico: [],
});

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

const normalizeName = (value = '') => {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
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
    customer.nomeCompleto ||
    customer.nomeContato ||
    customer.razaoSocial ||
    customer.nomeFantasia ||
    customer.email;
  return name || 'Cliente nao informado';
};

const pickAppointmentCode = (appt = {}) => {
  if (appt.codigoVenda) return String(appt.codigoVenda);
  if (appt.saleCode) return String(appt.saleCode);
  if (appt.codigo) return String(appt.codigo);
  if (appt._id) return String(appt._id);
  return '--';
};

const formatDate = (value) => {
  if (!value) return '--';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  return date.toLocaleDateString('pt-BR');
};

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

const normalizePaymentLabel = (sale = {}) => {
  const labels = new Set();

  const receivables = Array.isArray(sale.receivables) ? sale.receivables : [];
  receivables.forEach((entry) => {
    if (entry?.paymentMethodLabel) labels.add(String(entry.paymentMethodLabel));
    else if (entry?.paymentMethodId) labels.add(String(entry.paymentMethodId));
    else if (entry?.paymentLabel) labels.add(String(entry.paymentLabel));
  });

  const paymentTags = Array.isArray(sale.paymentTags) ? sale.paymentTags : [];
  paymentTags.forEach((tag) => labels.add(String(tag)));

  const snapshotPayments = sale.receiptSnapshot?.pagamentos || sale.receiptSnapshot?.payments || [];
  if (Array.isArray(snapshotPayments)) {
    snapshotPayments.forEach((payment) => {
      if (payment?.label) labels.add(String(payment.label));
      else if (payment?.nome) labels.add(String(payment.nome));
      else if (payment?.tipo) labels.add(String(payment.tipo));
    });
  }

  return labels.size ? Array.from(labels).slice(0, 3).join(', ') : 'N/D';
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

  const codeCandidates = [
    sale.sellerCode,
    seller.codigo,
    seller.codigoCliente,
    seller.id,
    seller._id,
  ]
    .map(normalizeDigits)
    .filter(Boolean);

  const hasSellerInfo = idCandidates.some(Boolean) || codeCandidates.some(Boolean);

  for (const code of codeCandidates) {
    if (sellerCodes.has(code)) return true;
  }

  // Somente se nÃ£o houver seller definido, cair para operador
  if (!hasSellerInfo) {
    const operator = normalizeName(sale.receiptSnapshot?.meta?.operador || sale.sellerName || '');
    if (operator && operatorName && operator === operatorName) {
      return true;
    }
  }

  return false;
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
    appointment.profissional &&
    String(appointment.profissional?._id || appointment.profissional) === normalizedId;

  if (assigned.length) return { items: assigned, matchedByTopLevel: topMatches };
  if (topMatches) return { items, matchedByTopLevel: true };
  return { items: [], matchedByTopLevel: false };
};

const mapAppointmentToServicoRecord = (
  appointment = {},
  { userId } = {},
) => {
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
    data: formatDate(createdAt),
    codigo: pickAppointmentCode(appointment),
    descricao: servicoNomes.join(', '),
    cliente: pickCustomerName(appointment.cliente),
    origem: 'Agenda de Servicos',
    status: isFinalizado ? 'finalizado' : normalizeServiceStatus(appointment.status || 'agendado'),
    comissaoVenda: 0,
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

const buildServicosResumo = (records = []) => {
  const resumo = emptyResumo();
  if (!records.length) return resumo;

  const totalPrevisto = records.reduce((sum, r) => sum + (parseNumber(r.comissaoTotal) || 0), 0);
  const pagos = records.filter((r) => r.isFinalizado && r.pago);
  const aReceber = pagos.reduce((sum, r) => sum + (parseNumber(r.comissaoTotal) || 0), 0);

  const ultimaPaga = pagos
    .slice()
    .sort((a, b) => {
      const da = a._createdAt ? new Date(a._createdAt).getTime() : 0;
      const db = b._createdAt ? new Date(b._createdAt).getTime() : 0;
      return db - da;
    })
    .map((r) => parseNumber(r.comissaoTotal) || 0)[0] || 0;

  let diasLiberacaoSoma = 0;
  let diasLiberacaoCount = 0;
  pagos.forEach((r) => {
    if (
      r.isFinalizado &&
      r.pago &&
      r._createdAt instanceof Date &&
      !Number.isNaN(r._createdAt.getTime())
    ) {
      const diff = Date.now() - r._createdAt.getTime();
      diasLiberacaoSoma += diff / (1000 * 60 * 60 * 24);
      diasLiberacaoCount += 1;
    }
  });

  resumo.totalPrevisto = totalPrevisto;
  resumo.totalGerado = totalPrevisto;
  resumo.aReceber = aReceber;
  resumo.pagas = ultimaPaga;
  resumo.media = records.length ? totalPrevisto / records.length : 0;
  resumo.resumoPeriodo.vendasComComissao = records.length;
  const pagasCount = pagos.length;
  resumo.resumoPeriodo.taxaAprovacao = records.length
    ? Math.round((pagasCount / records.length) * 100)
    : 0;
  resumo.resumoPeriodo.tempoMedioLiberacao =
    diasLiberacaoCount > 0 ? Math.round(diasLiberacaoSoma / diasLiberacaoCount) : null;

  return resumo;
};

const buildServicosProximos = (records = []) => {
  const pendentes = records
    .filter((r) => r.aReceber)
    .sort((a, b) => {
      const da = a._createdAt ? new Date(a._createdAt).getTime() : 0;
      const db = b._createdAt ? new Date(b._createdAt).getTime() : 0;
      return da - db;
    })
    .slice(0, 5);

  return pendentes.map((item) => ({
    titulo: item.descricao || 'Atendimento',
    valor: parseNumber(item.comissaoTotal) || 0,
    status: 'pendente',
    info: item.pagamento || 'Aguardando liberacao',
  }));
};

const buildServicosViewPayload = (records = []) => {
  const historico = (records || [])
    .slice()
    .sort((a, b) => {
      const da = a._createdAt ? new Date(a._createdAt).getTime() : 0;
      const db = b._createdAt ? new Date(b._createdAt).getTime() : 0;
      return db - da;
    })
    .map((item) => {
      const { _createdAt, ...rest } = item;
      return rest;
    });

  return {
    resumo: buildServicosResumo(records),
    proximosPagamentos: buildServicosProximos(records),
    historico,
  };
};

const buildResumo = (records = [], opts = {}) => {
  const { mode = 'default' } = opts;
  const resumo = emptyResumo();
  if (!records.length) return resumo;

  const entries = mode === 'produtos'
    ? records.filter((item) => normalizeStatus(item.status) !== 'cancelado')
    : records;

  let total = 0;
  let aReceber = 0;
  let pagas = 0;
  let cancelamentos = 0;
  let aprovados = 0;
  let diasLiberacaoSoma = 0;
  let diasLiberacaoCount = 0;

  entries.forEach((item) => {
    const valor = parseNumber(item.comissaoTotal) || 0;
    const status = normalizeStatus(item.status);

    if (status === 'cancelado') {
      cancelamentos += 1;
      return;
    }

    total += valor;

    if (mode === 'produtos') {
      if (status === 'pago') {
        aReceber += valor; // vendas pagas (cliente), aguardando repasse
        pagas += valor; // mantemos pagas como pago por compatibilidade
        aprovados += 1;
        if (item._createdAt instanceof Date && !Number.isNaN(item._createdAt.getTime())) {
          const diff = Date.now() - item._createdAt.getTime();
          diasLiberacaoSoma += diff / (1000 * 60 * 60 * 24);
          diasLiberacaoCount += 1;
        }
      }
    } else {
      if (status === 'pago') {
        pagas += valor;
        aprovados += 1;
        if (item._createdAt instanceof Date && !Number.isNaN(item._createdAt.getTime())) {
          const diff = Date.now() - item._createdAt.getTime();
          diasLiberacaoSoma += diff / (1000 * 60 * 60 * 24);
          diasLiberacaoCount += 1;
        }
      } else if (status === 'cancelado') {
        cancelamentos += 1;
      } else {
        aReceber += valor;
      }
    }
  });

  resumo.totalPrevisto = total;
  resumo.totalGerado = total;
  resumo.aReceber = aReceber;
  resumo.pagas = pagas;
  resumo.media = entries.length ? total / entries.length : 0;
  resumo.resumoPeriodo.vendasComComissao = entries.length;
  resumo.resumoPeriodo.taxaAprovacao = entries.length
    ? Math.round((aprovados / entries.length) * 100)
    : 0;
  resumo.resumoPeriodo.tempoMedioLiberacao =
    diasLiberacaoCount > 0 ? Math.round(diasLiberacaoSoma / diasLiberacaoCount) : null;
  resumo.resumoPeriodo.cancelamentos = cancelamentos;

  return resumo;
};

const buildProximos = (records = []) => {
  const pendentes = records
    .filter((item) => {
      const status = normalizeStatus(item.status);
      return status !== 'pago' && status !== 'cancelado';
    })
    .sort((a, b) => {
      const da = a._createdAt ? a._createdAt.getTime() : 0;
      const db = b._createdAt ? b._createdAt.getTime() : 0;
      return da - db;
    })
    .slice(0, 5);

  return pendentes.map((item) => ({
    titulo: item.codigo ? `Venda ${item.codigo}` : 'Venda',
    valor: parseNumber(item.comissaoTotal) || 0,
    status: 'pendente',
    info: item.pagamento || 'Aguardando liberaÇõÇœo',
  }));
};

const buildViewPayload = (records = [], opts = {}) => {
  const historico = records
    .sort((a, b) => {
      const da = a._createdAt ? a._createdAt.getTime() : 0;
      const db = b._createdAt ? b._createdAt.getTime() : 0;
      return db - da;
    })
    .map((item) => {
      const { _createdAt, valorProdutos, valorServicos, ...rest } = item;
      return rest;
    });

  return {
    resumo: buildResumo(records, opts),
    proximosPagamentos: buildProximos(records),
    historico,
  };
};

router.get('/comissoes', authMiddleware, requireStaff, async (req, res) => {
  try {
    const user = await User.findById(req.user?.id || req.user?._id)
      .select('nomeCompleto nomeContato razaoSocial codigoCliente userGroup')
      .lean();

    if (!user) {
      return res.status(404).json({ message: 'UsuÇ­rio nÇœo encontrado' });
    }

    let userGroup = null;
    if (user.userGroup) {
      userGroup = await UserGroup.findById(user.userGroup)
        .select('comissaoPercent comissaoServicoPercent')
        .lean();
    }

    const comissaoPercent = Number(userGroup?.comissaoPercent ?? 0);
    const comissaoServicoPercent = Number(userGroup?.comissaoServicoPercent ?? 0);

    const sellerIds = new Set([String(user._id)]);
    const sellerCodes = new Set();
    if (user.codigoCliente) sellerCodes.add(normalizeDigits(user.codigoCliente));

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

    const dateMatch = {};
    if (startDate) dateMatch.$gte = startDate;
    if (endDate) dateMatch.$lte = endDate;

    const pipeline = [
      { $match: { 'completedSales.0': { $exists: true } } },
      { $project: { completedSales: 1 } },
      { $unwind: '$completedSales' },
    ];

    if (Object.keys(dateMatch).length) {
      pipeline.push({ $match: { 'completedSales.createdAt': dateMatch } });
    }

    const aggregated = await PdvState.aggregate(pipeline).allowDiskUse(true);

    const normalizedUserName = normalizeName(
      user.nomeCompleto || user.nomeContato || user.razaoSocial || user.email || ''
    );

    const sales = aggregated
      .map((entry) => ({
        ...(entry.completedSales || {}),
        _pdvStateId: entry._id,
      }))
      .filter((sale) => belongsToSeller(sale, { sellerIds, sellerCodes, operatorName: normalizedUserName }));

    console.log(
      '[funcComissoes]',
      { userId: String(user._id), dias, salesTotal: aggregated.length, salesMatched: sales.length },
    );

    const itemIdSet = new Set();
    sales.forEach((sale) => {
      collectSaleItems(sale).forEach((item) => {
        const oid = extractItemObjectId(item);
        if (oid) itemIdSet.add(oid);
      });
    });

    const ids = Array.from(itemIdSet);
    const [Services, products] = await Promise.all([
      ids.length ? Service.find({ _id: { $in: ids } }).select('_id nome valor').lean() : [],
      ids.length ? Product.find({ _id: { $in: ids } }).select('_id nome venda').lean() : [],
    ]);

    const ServiceIdSet = new Set(Services.map((svc) => String(svc._id)));
    const productIdSet = new Set(products.map((prod) => String(prod._id)));

    const historicoBase = sales.map((sale) => {
      const items = collectSaleItems(sale);
      let valorProdutos = 0;
      let valorServicos = 0;
      const itemNames = [];

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

        const name =
          item.nome ||
          item.descricao ||
          item.name ||
          item.productSnapshot?.nome ||
          item.productSnapshot?.descricao ||
          item.product?.nome ||
          item.produto?.nome ||
          '';
        if (name) itemNames.push(name);
      });

      const vendaBase = valorProdutos;
      const servicoBase = valorServicos;
      const comissaoVenda = vendaBase * (comissaoPercent / 100);
      const comissaoServico = servicoBase * (comissaoServicoPercent / 100);
      const comissaoTotal = comissaoVenda + comissaoServico;

      const createdAt = sale.createdAt ? new Date(sale.createdAt) : null;
      const status = normalizeStatus(sale.status);
      const paymentLabel = normalizePaymentLabel(sale);
      const origemLabel = valorProdutos > 0 && valorServicos > 0
        ? 'Produtos + Servicos'
        : valorServicos > 0
        ? 'Servicos'
        : 'Produtos';

      const descricao = itemNames.length ? itemNames.slice(0, 3).join(', ') : sale.typeLabel || 'Venda';
      const valorVenda = deriveSaleTotal(sale) || vendaBase + servicoBase;

      return {
        _createdAt: createdAt,
        codigo: sale.saleCode || sale.saleCodeLabel || sale.id || '',
        data: formatDate(createdAt),
        descricao,
        cliente: sale.customerName || 'Cliente nao informado',
        origem: origemLabel,
        status,
        comissaoVenda,
        comissaoServico,
        comissaoTotal,
        valorVenda,
        pagamento: paymentLabel,
        valorProdutos,
        valorServicos,
      };
    });

    // Para a tela atual (Vendas), exibimos uma linha por venda com os dois tipos de comissão.
    const produtosView = buildViewPayload(historicoBase, { mode: 'produtos' });

    const serviceDateMatch = {};
    if (startDate) serviceDateMatch.$gte = startDate;
    if (endDate) serviceDateMatch.$lte = endDate;

    const profissionalId =
      mongoose.Types.ObjectId.isValid(String(user._id))
        ? new mongoose.Types.ObjectId(String(user._id))
        : null;

    const serviceQuery = {};
    if (Object.keys(serviceDateMatch).length) serviceQuery.scheduledAt = serviceDateMatch;
    if (profissionalId) {
      serviceQuery.$or = [
        { profissional: profissionalId },
        { 'itens.profissional': profissionalId },
      ];
    }

    const appointments = profissionalId
      ? await Appointment.find(serviceQuery)
          .select(
            'scheduledAt createdAt itens valor pago codigoVenda status profissional cliente servico',
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

    const servicoRecords = buildServicosRecords(appointments, {
      userId: user._id,
      comissaoServicoPercent,
    });

    const servicosView = buildServicosViewPayload(servicoRecords);

    const response = {
      servicos: servicosView,
      produtos: produtosView,
    };

    if (req.query?.debug === '1') {
      response.debug = {
        aggregated: aggregated.length,
        matched: sales.length,
        servicoCount: historicoBase.filter((it) => (it.valorServicos || 0) > 0).length,
        produtoCount: historicoBase.filter((it) => (it.valorProdutos || 0) > 0).length,
        produtosViewCount: produtosView.historico.length,
        servicosViewCount: servicosView.historico.length,
        servicosFetchCount: appointments.length,
      };
    }

    return res.json(response);
  } catch (error) {
    console.error('[funcComissoes] Falha ao calcular comissÇœes', error);
    return res.status(500).json({ message: 'NÇœo foi possÇðvel calcular as comissÇæes.' });
  }
});

module.exports = router;












