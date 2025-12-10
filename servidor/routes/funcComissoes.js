const express = require('express');
const authorizeRoles = require('../middlewares/authorizeRoles');
const authMiddleware = require('../middlewares/authMiddleware');
const AccountReceivable = require('../models/AccountReceivable');
const User = require('../models/User');
const UserGroup = require('../models/UserGroup');
const PdvState = require('../models/PdvState');

const router = express.Router();
const requireStaff = authorizeRoles('funcionario', 'admin', 'admin_master');

const currencyFormatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

function sanitizeMoney(value, fallback = 0) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : fallback;
  }

  if (typeof value === 'string') {
    const cleaned = value
      .replace(/[^0-9,.-]+/g, '')
      .replace(/\.(?=\d{3}(?:\D|$))/g, '')
      .replace(',', '.');
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatMoney(value = 0) {
  return currencyFormatter.format(sanitizeMoney(value, 0));
}

function formatDateBR(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('pt-BR').format(date);
}

function normalize(value = '') {
  return String(value || '').trim().toLowerCase();
}

function detectReceivableCategory(receivable) {
  const text = [
    receivable?.document,
    receivable?.documentNumber,
    receivable?.notes,
    receivable?.accountingAccount?.name,
    receivable?.accountingAccount?.code,
  ]
    .map((part) => normalize(part))
    .join(' ');

  if (text.includes('produt')) return 'produtos';
  if (text.includes('servi')) return 'servicos';
  return 'servicos';
}

function deriveInstallmentStatus(installments = []) {
  if (!Array.isArray(installments) || installments.length === 0) return 'pendente';
  const paid = installments.some((item) => normalize(item?.status) === 'received');
  const cancelled = installments.some((item) => ['cancelled', 'uncollectible'].includes(normalize(item?.status)));
  const pending = installments.some((item) => !item?.status || normalize(item?.status) === 'pending');

  if (cancelled) return 'cancelado';
  if (paid && pending) return 'aguardando';
  if (paid) return 'pago';
  return 'pendente';
}

function buildServiceEntry(receivable) {
  const installments = Array.isArray(receivable?.installments) ? receivable.installments : [];
  const paidInstallments = installments.filter((item) => normalize(item?.status) === 'received');
  const pendingInstallments = installments.filter((item) => normalize(item?.status) !== 'received');

  const status = deriveInstallmentStatus(installments);
  const totalValue = sanitizeMoney(
    receivable?.totalValue
      ?? receivable?.valorTotal
      ?? receivable?.valor
      ?? receivable?.total
      ?? receivable?.amount
      ?? 0,
    0,
  );

  const paidValue = paidInstallments.reduce(
    (sum, item) => sum + sanitizeMoney(item?.paidValue ?? item?.value ?? item?.valor ?? 0, 0),
    0,
  );
  const pendingValue = pendingInstallments.reduce(
    (sum, item) => sum + sanitizeMoney(item?.value ?? item?.valor ?? 0, 0),
    0,
  );

  const paidDates = paidInstallments
    .map((item) => (item?.paidDate ? new Date(item.paidDate) : null))
    .filter((date) => date && !Number.isNaN(date.getTime()))
    .sort((a, b) => b - a);
  const nextDue = pendingInstallments
    .map((item) => (item?.dueDate ? new Date(item.dueDate) : null))
    .filter((date) => date && !Number.isNaN(date.getTime()))
    .sort((a, b) => a - b)[0];

  const pagamento = status === 'pago'
    ? (paidDates.length ? `Pago em ${formatDateBR(paidDates[0])}` : 'Pago')
    : (nextDue ? `Previsto para ${formatDateBR(nextDue)}` : 'Sem previsão');

  const categoria = detectReceivableCategory(receivable);

  return {
    categoria,
    data: formatDateBR(receivable?.dueDate || receivable?.issueDate || receivable?.createdAt),
    codigo: receivable?.code || receivable?._id?.toString().slice(-6) || '--',
    descricao: receivable?.document || receivable?.notes || 'Recebível',
    cliente:
      receivable?.customer?.nomeCompleto
      || receivable?.customer?.nomeContato
      || receivable?.customer?.razaoSocial
      || receivable?.customerName
      || 'Cliente',
    origem: receivable?.accountingAccount?.name || receivable?.document || 'N/A',
    status,
    valor: totalValue,
    valorVenda: totalValue,
    pago: paidValue,
    pendente: pendingValue,
    pagamento,
  };
}

function matchSellerToUser(sale = {}, user = {}) {
  const seller = sale?.seller || {};
  const saleHints = [
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
    .map((value) => normalize(value))
    .filter(Boolean);

  const userHints = [
    user?._id,
    user?.id,
    user?.codigoCliente,
    user?.email,
    user?.nomeCompleto,
    user?.nomeContato,
  ]
    .map((value) => normalize(value))
    .filter(Boolean);

  return saleHints.some((hint) => userHints.includes(hint));
}

function itemIsProduct(item = {}) {
  const type = normalize(
    item.type
      || item.tipo
      || item.itemType
      || item.categoria
      || item.category
      || item.grupo
      || item.group,
  );

  if (type.includes('serv')) return false;
  if (type.includes('produt')) return true;

  const productHints = [item.product, item.productId, item.produtoId, item.idProduto]
    .map((value) => value || '')
    .join('');

  return Boolean(productHints);
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
    const parsed = sanitizeMoney(candidate, null);
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
    const parsed = sanitizeMoney(candidate, null);
    if (parsed !== null) return parsed;
  }

  return 0;
}

function deriveSaleTotalFromItems(sale = {}) {
  const items = Array.isArray(sale.itemsSnapshot?.items) ? sale.itemsSnapshot.items
    : Array.isArray(sale.itemsSnapshot?.itens) ? sale.itemsSnapshot.itens
      : Array.isArray(sale.items) ? sale.items
        : [];

  if (!items.length) return null;

  const productItems = items.filter(itemIsProduct);
  const baseItems = productItems.length ? productItems : items;

  const sum = baseItems.reduce((total, item) => {
    const qty = deriveItemQuantity(item);
    const price = deriveItemUnitPrice(item);
    return total + qty * price;
  }, 0);

  return sum > 0 ? sum : null;
}

function collectSaleTotals(sale = {}) {
  const totals = sale?.receiptSnapshot?.totais || sale?.totais || sale?.itemsSnapshot?.totais || {};
  const candidates = [
    sale.total,
    sale.totalLiquido,
    sale.totalBruto,
    sale.totalSale,
    sale.totalAmount,
    sale.valorTotal,
    sale.totalVenda,
    sale.totalGeral,
    sale.receiptSnapshot?.total,
    sale.receiptSnapshot?.totalLiquido,
    sale.receiptSnapshot?.valorTotal,
    sale.receiptSnapshot?.totalBruto,
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
    const parsed = sanitizeMoney(candidate, null);
    if (parsed !== null && parsed > 0) return parsed;
  }

  return null;
}

function resolveSaleTotal(sale = {}, state = {}) {
  const directTotals = collectSaleTotals(sale);
  if (directTotals) return directTotals;

  const receivables = Array.isArray(sale.receivables) ? sale.receivables : [];
  if (receivables.length) {
    const receivableSum = receivables.reduce(
      (acc, item) => acc + sanitizeMoney(item?.value ?? item?.valor ?? item?.formattedValue ?? 0, 0),
      0,
    );
    if (receivableSum > 0) return receivableSum;
  }

  const accountsReceivable = Array.isArray(state.accountsReceivable) ? state.accountsReceivable : [];
  const saleId = normalize(sale.id);
  const saleCode = normalize(sale.saleCode || sale.saleCodeLabel);

  if (accountsReceivable.length && (saleId || saleCode)) {
    const matches = accountsReceivable.filter((receivable) => {
      const fields = [
        receivable.id,
        receivable.saleId,
        receivable.saleCode,
        receivable.saleCodeLabel,
        receivable.document,
        receivable.documentNumber,
      ].map((value) => normalize(value));

      return (saleCode && fields.includes(saleCode)) || (saleId && fields.includes(saleId));
    });

    if (matches.length) {
      const total = matches.reduce((sum, receivable) => sum + sanitizeMoney(receivable.value, 0), 0);
      if (total > 0) return total;
    }
  }

  const itemsTotal = deriveSaleTotalFromItems(sale);
  if (itemsTotal) return itemsTotal;

  return 0;
}

function buildProductEntries(states = [], user = {}, comissaoPercent = 0) {
  const entries = [];

  for (const state of states) {
    const sales = Array.isArray(state.completedSales) ? state.completedSales : [];

    for (const sale of sales) {
      const status = normalize(sale.status);
      const cancelled = ['cancelado', 'cancelled'].includes(status);
      if (cancelled || !matchSellerToUser(sale, user)) continue;

      const saleTotal = resolveSaleTotal(sale, state);
      const commissionValue = sanitizeMoney(saleTotal * (comissaoPercent / 100), 0);

      const saleDate = sale.createdAt || sale.createdAtLabel || sale.fiscalEmittedAt || state.createdAt;
      const paymentLabel = saleTotal > 0
        ? `Comissão ${comissaoPercent}% sobre venda de ${formatMoney(saleTotal)}`
        : `Comissão ${comissaoPercent}%`;

      entries.push({
        categoria: 'produtos',
        data: formatDateBR(saleDate || Date.now()),
        codigo: sale.saleCode || sale.saleCodeLabel || sale.id || '--',
        descricao: sale.typeLabel || 'Venda PDV',
        cliente: sale.customerName || 'Cliente PDV',
        origem: 'PDV',
        status: commissionValue > 0 ? 'pago' : 'aguardando',
        valor: commissionValue,
        valorVenda: saleTotal,
        pago: commissionValue,
        pendente: 0,
        pagamento: paymentLabel,
      });
    }
  }

  return entries;
}

function buildResumo(historico = []) {
  const totalGerado = historico.reduce((sum, item) => sum + sanitizeMoney(item.valor, 0), 0);
  const pagas = historico.reduce(
    (sum, item) => sum + sanitizeMoney(item.pago ?? (item.valor - item.pendente), 0),
    0,
  );
  const aReceber = historico.reduce((sum, item) => sum + sanitizeMoney(item.pendente, 0), 0);
  const media = historico.length ? totalGerado / historico.length : 0;

  const canceladas = historico.filter((item) => normalize(item.status) === 'cancelado').length;
  const aprovadas = historico.filter((item) => normalize(item.status) === 'pago').length;

  const tempos = historico
    .map((item) => {
      if (normalize(item.status) !== 'pago' || !item.pagamento?.includes('Pago em')) return null;
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
    totalGerado,
    aReceber,
    pagas,
    media,
    resumoPeriodo: {
      vendasComComissao: historico.length,
      taxaAprovacao: historico.length ? Math.round((aprovadas / historico.length) * 100) : 0,
      tempoMedioLiberacao: tempoMedio,
      bonificacoes: 0,
      cancelamentos: canceladas,
    },
  };
}

function buildProximosPagamentos(historico = []) {
  return historico
    .flatMap((item) => {
      if (!item.pendente) return [];
      return {
        titulo: `${item.data || 'Data'} • ${item.descricao}`.trim(),
        valor: item.pendente,
        status: normalize(item.status) === 'pago' ? 'confirmado' : 'pendente',
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
}

router.get('/comissoes', authMiddleware, requireStaff, async (req, res) => {
  try {
    const userId = req.user?.id || req.user?._id;
    if (!userId) return res.status(401).json({ message: 'Usuário não autenticado.' });

    const [user, receivables, pdvStates] = await Promise.all([
      User.findById(userId)
        .populate({ path: 'userGroup', model: UserGroup, select: 'nome comissaoPercent' })
        .lean(),
      AccountReceivable.find({ responsible: userId })
        .populate('customer', 'nomeCompleto nomeContato razaoSocial email')
        .populate('accountingAccount', 'name code')
        .sort({ createdAt: -1 })
        .lean(),
      PdvState.find({}, 'completedSales accountsReceivable createdAt').lean(),
    ]);

    if (!user) return res.status(404).json({ message: 'Usuário não encontrado.' });

    const comissaoPercentRaw = user.userGroup?.comissaoPercent;
    const comissaoPercent = sanitizeMoney(
      typeof comissaoPercentRaw === 'string'
        ? comissaoPercentRaw.replace('%', '').trim()
        : comissaoPercentRaw,
      0,
    );

    const servicosHistorico = receivables.map((item) => buildServiceEntry(item));
    const produtosHistorico = comissaoPercent > 0
      ? buildProductEntries(pdvStates, user, comissaoPercent)
      : [];

    const result = {};
    [['servicos', servicosHistorico], ['produtos', produtosHistorico]].forEach(([categoria, historico]) => {
      const resumo = buildResumo(historico);
      result[categoria] = {
        resumo,
        historico,
        proximosPagamentos: buildProximosPagamentos(historico),
      };
    });

    res.json(result);
  } catch (error) {
    console.error('[Comissões] Erro ao buscar comissões:', error);
    res.status(500).json({ message: 'Erro ao buscar comissões.' });
  }
});

module.exports = router;
