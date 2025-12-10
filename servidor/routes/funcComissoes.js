const express = require('express');
const authorizeRoles = require('../middlewares/authorizeRoles');
const authMiddleware = require('../middlewares/authMiddleware');
const AccountReceivable = require('../models/AccountReceivable');
const User = require('../models/User');
const UserGroup = require('../models/UserGroup');
const PdvState = require('../models/PdvState');

const router = express.Router();
const requireStaff = authorizeRoles('funcionario', 'admin', 'admin_master');

function toLower(value = '') {
  return String(value || '').toLowerCase();
}

function normalize(value = '') {
  return String(value || '').trim().toLowerCase();
}

function detectCategoria(receivable) {
  const docParts = [
    receivable?.document,
    receivable?.documentNumber,
    receivable?.notes,
    receivable?.accountingAccount?.name,
    receivable?.accountingAccount?.code,
  ]
    .map(toLower)
    .join(' ');

  if (docParts.includes('produt')) return 'produtos';
  if (docParts.includes('servi')) return 'servicos';
  return 'servicos';
}

function formatCurrency(value = 0) {
  const numeric = Number.isFinite(value) ? value : 0;
  return Math.round(numeric * 100) / 100;
}

function brDate(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

function deriveStatus(installments = []) {
  if (!Array.isArray(installments) || !installments.length) return 'pendente';
  const hasPaid = installments.some((item) => item?.status === 'received');
  const hasPending = installments.some((item) => !item?.status || item.status === 'pending');
  const hasCancelled = installments.some((item) => ['cancelled', 'uncollectible'].includes(item?.status));
  if (hasCancelled) return 'cancelado';
  if (hasPaid && hasPending) return 'aguardando';
  if (hasPaid) return 'pago';
  return 'pendente';
}

function matchSellerToUser(sale = {}, user = {}) {
  const seller = sale?.seller || {};
  const sellerHints = [
    seller.id,
    seller._id,
    seller.userId,
    seller.codigo,
    seller.codigoCliente,
    seller.email,
    seller.nome,
    seller.name,
    sale.sellerCode,
    sale.sellerName,
  ]
    .map(normalize)
    .filter(Boolean);

  const userHints = [
    user?._id,
    user?.id,
    user?.codigoCliente,
    user?.email,
    user?.nomeCompleto,
    user?.nomeContato,
  ]
    .map(normalize)
    .filter(Boolean);

  return sellerHints.some((hint) => userHints.includes(hint));
}

function numeric(value, fallback = 0) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : fallback;
  }

  if (typeof value === 'string') {
    const normalized = value.trim();
    if (!normalized) return fallback;

    const sanitized = normalized.includes(',')
      ? normalized.replace(/\./g, '').replace(',', '.')
      : normalized;

    const parsed = Number(sanitized);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function firstNumber(candidates = [], fallback = null) {
  for (const candidate of candidates) {
    const parsed = numeric(candidate, null);
    if (parsed !== null) return parsed;
  }

  return fallback;
}

function deriveItemQuantity(item = {}) {
  const candidates = [
    item.quantity,
    item.quantidade,
    item.qnt,
    item.qtd,
    item.qty,
  ];
  for (const candidate of candidates) {
    const parsed = numeric(candidate, null);
    if (parsed !== null) return parsed;
  }
  return 1;
}

function deriveItemUnitPrice(item = {}) {
  const candidates = [
    item.unitPrice,
    item.valor,
    item.price,
    item.preco,
    item.valorTotal,
    item.total,
  ];
  for (const candidate of candidates) {
    const parsed = numeric(candidate, null);
    if (parsed !== null) return parsed;
  }
  return 0;
}

function isProductItem(item = {}) {
  const type = normalize(
    item.type
      || item.tipo
      || item.itemType
      || item.categoria
      || item.category
      || item.grupo
      || item.group
  );

  if (type.includes('serv')) return false;
  if (type.includes('produt')) return true;

  const productHints = [item.product, item.productId, item.produtoId, item.idProduto]
    .map((value) => value || '')
    .join('');

  return Boolean(productHints);
}

function deriveProductTotal(sale = {}) {
  const items = Array.isArray(sale.items) ? sale.items : [];
  const productItems = items.filter(isProductItem);
  const baseItems = productItems.length ? productItems : items;

  if (baseItems.length) {
    const sum = baseItems.reduce((total, item) => {
      const qty = deriveItemQuantity(item);
      const price = deriveItemUnitPrice(item);
      return total + qty * price;
    }, 0);

    if (sum > 0) return sum;
  }

  const totals = sale?.receiptSnapshot?.totais || sale?.totais || {};
  const candidates = [
    sale.total,
    sale.totalLiquido,
    sale.totalBruto,
    sale.totalAmount,
    sale.valorTotal,
    sale.totalVenda,
    sale.totalGeral,
    totals?.totalLiquido,
    totals?.liquido,
    totals?.total,
    totals?.totalGeral,
    totals?.totalBruto,
    totals?.pago,
    totals?.valorTotal,
    totals?.totalVenda,
    totals?.totalPagar,
    totals?.bruto,
  ];

  for (const candidate of candidates) {
    const parsed = numeric(candidate, null);
    if (parsed !== null) return parsed;
  }

  return 0;
}

function deriveSaleTotal(sale = {}) {
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
    const parsed = numeric(candidate, null);
    if (parsed !== null) return parsed;
  }

  if (Array.isArray(sale.items) && sale.items.length > 0) {
    const sum = sale.items.reduce((acc, item) => {
      const qty = numeric(item?.quantity ?? item?.quantidade, 0);
      const price = numeric(item?.unitPrice ?? item?.valor, 0);
      return acc + qty * price;
    }, 0);
    if (sum > 0) return sum;
  }

  return 0;
}

function findSaleTotal(state = {}, sale = {}) {
  const receivables = Array.isArray(state.accountsReceivable) ? state.accountsReceivable : [];
  if (!receivables.length) return null;

  const saleId = normalize(sale.id);
  const saleCode = normalize(sale.saleCode || sale.saleCodeLabel);

  const matchableFields = (receivable = {}) => [
    receivable.id,
    receivable.saleId,
    receivable.saleCode,
    receivable.saleCodeLabel,
    receivable.document,
    receivable.documentNumber,
  ].map(normalize);

  const matches = receivables.filter((receivable) => {
    const fields = matchableFields(receivable);
    return (
      (saleCode && fields.includes(saleCode))
      || (saleId && fields.includes(saleId))
    );
  });

  if (!matches.length) return null;

  const total = matches.reduce(
    (sum, receivable) => sum + numeric(receivable.value, 0),
    0,
  );

  return formatCurrency(total);
}

function buildHistoricoEntry(receivable) {
  const installments = Array.isArray(receivable.installments) ? receivable.installments : [];
  const paidInstallments = installments.filter((item) => item?.status === 'received');
  const pendingInstallments = installments.filter((item) => item?.status !== 'received');
  const status = deriveStatus(installments);

  const paidValue = paidInstallments.reduce(
    (sum, item) => sum + formatCurrency(item?.paidValue || item?.value || 0),
    0,
  );
  const pendingValue = pendingInstallments.reduce(
    (sum, item) => sum + formatCurrency(item?.value || 0),
    0,
  );

  const paidDates = paidInstallments
    .map((item) => (item?.paidDate ? new Date(item.paidDate) : null))
    .filter((date) => date && !Number.isNaN(date.getTime()));
  const nextDue = pendingInstallments
    .map((item) => (item?.dueDate ? new Date(item.dueDate) : null))
    .filter((date) => date && !Number.isNaN(date.getTime()))
    .sort((a, b) => a - b)[0];

  const pagamento = status === 'pago'
    ? (paidDates.length ? `Pago em ${brDate(paidDates.sort((a, b) => b - a)[0])}` : 'Pago')
    : (nextDue ? `Previsto para ${brDate(nextDue)}` : 'Sem previsão');

  const categoria = detectCategoria(receivable);

  return {
    categoria,
    data: brDate(receivable?.dueDate || receivable?.issueDate || receivable?.createdAt),
    codigo: receivable?.code || receivable?._id?.toString().slice(-6) || '',
    descricao: receivable?.document || receivable?.notes || 'Recebível',
    cliente:
      receivable?.customer?.nomeCompleto
      || receivable?.customer?.nomeContato
      || receivable?.customer?.razaoSocial
      || receivable?.customerName
      || 'Cliente',
    origem: receivable?.accountingAccount?.name || receivable?.document || 'N/A',
    status,
    valor: formatCurrency(receivable?.totalValue || 0),
    pago: paidValue,
    pendente: pendingValue,
    pagamento,
  };
}

function aggregateResumo(historico = []) {
  const totalGerado = historico.reduce((sum, item) => sum + item.valor, 0);
  const pagas = historico.reduce((sum, item) => sum + (item.pago || item.valor - item.pendente), 0);
  const aReceber = historico.reduce((sum, item) => sum + item.pendente, 0);
  const media = historico.length ? totalGerado / historico.length : 0;
  const canceladas = historico.filter((item) => item.status === 'cancelado').length;
  const aprovadas = historico.filter((item) => item.status === 'pago').length;

  const tempos = historico
    .map((item) => {
      if (item.status !== 'pago' || !item.pagamento.includes('Pago em')) return null;
      const paidDate = item.pagamento.replace(/[^0-9/]/g, '').trim();
      const [day, month, year] = paidDate.split('/').map(Number);
      const paid = new Date(year, month - 1, day);
      const parts = (item.data || '').split('/').map(Number);
      if (parts.length === 3) {
        const issued = new Date(parts[2], parts[1] - 1, parts[0]);
        if (!Number.isNaN(issued.getTime()) && !Number.isNaN(paid.getTime())) {
          const diff = Math.max(0, paid - issued);
          return Math.round(diff / (1000 * 60 * 60 * 24));
        }
      }
      return null;
    })
    .filter((value) => typeof value === 'number');

  const tempoMedio = tempos.length
    ? Math.round(tempos.reduce((sum, value) => sum + value, 0) / tempos.length)
    : 0;

  return {
    totalGerado: formatCurrency(totalGerado),
    aReceber: formatCurrency(aReceber),
    pagas: formatCurrency(pagas),
    media: formatCurrency(media),
    resumoPeriodo: {
      vendasComComissao: historico.length,
      taxaAprovacao: historico.length ? Math.round((aprovadas / historico.length) * 100) : 0,
      tempoMedioLiberacao: tempoMedio,
      bonificacoes: 0,
      cancelamentos: canceladas,
    },
  };
}

router.get('/comissoes', authMiddleware, requireStaff, async (req, res) => {
  try {
    const userId = req.user?.id || req.user?._id;
    if (!userId) {
      return res.status(401).json({ message: 'Usuário não autenticado.' });
    }

    const user = await User.findById(userId)
      .populate({ path: 'userGroup', model: UserGroup, select: 'nome comissaoPercent' })
      .lean();

    if (!user) {
      return res.status(404).json({ message: 'Usuário não encontrado.' });
    }

    const comissaoPercentRaw = user.userGroup?.comissaoPercent;
    const comissaoPercent = numeric(
      typeof comissaoPercentRaw === 'string'
        ? comissaoPercentRaw.replace('%', '').trim()
        : comissaoPercentRaw,
      0,
    );

    const receivables = await AccountReceivable.find({ responsible: userId })
      .populate('customer', 'nomeCompleto nomeContato razaoSocial email')
      .populate('accountingAccount', 'name code')
      .sort({ createdAt: -1 })
      .lean();

    const payload = { servicos: [], produtos: [] };

    for (const receivable of receivables) {
      const historico = buildHistoricoEntry(receivable);
      payload[historico.categoria].push(historico);
    }

    if (comissaoPercent > 0) {
      const states = await PdvState.find({}, 'completedSales accountsReceivable').lean();
      const pdvEntries = [];

      for (const state of states) {
        const sales = Array.isArray(state.completedSales) ? state.completedSales : [];
        for (const sale of sales) {
          const isCancelled = normalize(sale.status) === 'cancelled' || normalize(sale.status) === 'cancelado';
          if (!matchSellerToUser(sale, user) || isCancelled) continue;

          const productTotal = deriveProductTotal(sale);
          const saleTotal = deriveSaleTotal(sale) ?? findSaleTotal(state, sale);
          const commissionBase = saleTotal ?? productTotal;
          const commissionValue = formatCurrency(commissionBase * (comissaoPercent / 100));
          const saleDate = sale.createdAt || sale.createdAtLabel || sale.fiscalEmittedAt;
          const hasSaleTotal = commissionBase !== null && commissionBase !== undefined;

          pdvEntries.push({
            categoria: 'produtos',
            data: brDate(saleDate || Date.now()),
            codigo: sale.saleCode || sale.saleCodeLabel || sale.id || '',
            descricao: sale.typeLabel || 'Venda PDV',
            cliente: sale.customerName || 'Cliente PDV',
            origem: 'PDV',
            status: 'pago',
            valor: commissionValue,
            pago: commissionValue,
            pendente: 0,
            pagamento: hasSaleTotal
              ? `Comissão ${comissaoPercent}% sobre venda de R$ ${formatCurrency(commissionBase)}`
              : `Comissão ${comissaoPercent}%`,
          });
        }
      }

      payload.produtos.push(...pdvEntries);
    }

    const buildProximos = (items) =>
      items
        .flatMap((item) => {
          if (!item.pendente) return [];
          return {
            titulo: `${item.data || 'Data'} • ${item.descricao}`.trim(),
            valor: item.pendente,
            status: item.status === 'pago' ? 'confirmado' : 'pendente',
            info: item.pagamento,
            data: item.data,
          };
        })
        .sort((a, b) => {
          const dateA = a.data ? new Date(a.data.split('/').reverse().join('-')) : null;
          const dateB = b.data ? new Date(b.data.split('/').reverse().join('-')) : null;
          if (dateA && dateB) return dateA - dateB;
          if (dateA) return -1;
          if (dateB) return 1;
          return 0;
        })
        .slice(0, 5);

    const result = {};
    ['servicos', 'produtos'].forEach((categoria) => {
      const historico = payload[categoria];
      const resumo = aggregateResumo(historico);
      result[categoria] = {
        resumo,
        historico,
        proximosPagamentos: buildProximos(historico),
      };
    });

    res.json(result);
  } catch (error) {
    console.error('[Comissões] Erro ao buscar comissões:', error);
    res.status(500).json({ message: 'Erro ao buscar comissões.' });
  }
});

module.exports = router;
