const express = require('express');
const authorizeRoles = require('../middlewares/authorizeRoles');
const authMiddleware = require('../middlewares/authMiddleware');
const AccountReceivable = require('../models/AccountReceivable');

const router = express.Router();
const requireStaff = authorizeRoles('funcionario', 'admin', 'admin_master');

function toLower(value = '') {
  return String(value || '').toLowerCase();
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
