require('dotenv').config();

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const Pdv = require('../models/Pdv');
const PdvState = require('../models/PdvState');
const PdvCaixaSession = require('../models/PdvCaixaSession');

const args = process.argv.slice(2);

const getArgValue = (flag) => {
  const index = args.findIndex((entry) => entry === flag);
  if (index === -1) return '';
  return args[index + 1] || '';
};

const hasFlag = (flag) => args.includes(flag);

const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.DATABASE_URL;
if (!mongoUri) {
  console.error('[recover-pdv-state-from-session] Defina MONGODB_URI (ou MONGO_URI/DATABASE_URL) no .env');
  process.exit(1);
}

const pdvRef = getArgValue('--pdv') || getArgValue('--codigo') || 'PDV-003';
const applyChanges = hasFlag('--apply');

const roundMoney = (value) => Math.round((Number(value) || 0) * 100) / 100;

const safeNumber = (value, fallback = 0) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const normalized = value.replace(/[^\d,.-]/g, '').replace(/\.(?=.*\.)/g, '').replace(',', '.');
    const parsed = Number(normalized);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
};

const safeDate = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
};

const normalizeString = (value) => (typeof value === 'string' ? value.trim() : '');

const extractSaleCodeFromLabel = (label = '') => {
  const match = String(label).match(/(PDV\d{3}-\d{6})/i);
  return match ? match[1].toUpperCase() : '';
};

const extractMethodFromLabel = (label = '') => {
  const normalized = String(label).trim();
  if (!normalized) return '';
  const saleMatch = normalized.match(/•\s*(.+)$/);
  if (saleMatch) return saleMatch[1].trim();
  const currencyMatch = normalized.match(/^(.*?)\s+R\$/i);
  if (currencyMatch) return currencyMatch[1].trim();
  return normalized;
};

const ensureArray = (value) => (Array.isArray(value) ? value : []);

const normalizePaymentType = (label = '') => {
  const lower = normalizeString(label).toLowerCase();
  if (lower.includes('credi')) return 'crediario';
  if (lower.includes('crédito') || lower.includes('credito')) return 'credito';
  if (lower.includes('débito') || lower.includes('debito')) return 'debito';
  if (lower.includes('pix')) return 'pix';
  if (lower.includes('dinheiro')) return 'dinheiro';
  return 'avista';
};

const hydrateSaleFromReceipt = (sale) => {
  if (!sale || typeof sale !== 'object') return sale;
  const clone = { ...sale };
  const totais = clone.receiptSnapshot?.totais || {};
  const pagamentos = ensureArray(clone.receiptSnapshot?.pagamentos?.items);

  const bruto = safeNumber(totais.bruto, 0);
  const liquido =
    safeNumber(totais.liquido, 0) ||
    safeNumber(clone.receiptSnapshot?.pagamentos?.total, 0) ||
    safeNumber(totais.pago, 0);
  const pago = safeNumber(clone.receiptSnapshot?.pagamentos?.total, 0) || liquido;

  if (!(safeNumber(clone.totalBruto, 0) > 0) && bruto > 0) {
    clone.totalBruto = roundMoney(bruto);
  }
  if (!(safeNumber(clone.totalLiquido, 0) > 0) && liquido > 0) {
    clone.totalLiquido = roundMoney(liquido);
  }
  if (!(safeNumber(clone.total, 0) > 0) && pago > 0) {
    clone.total = roundMoney(pago);
  }

  if (!ensureArray(clone.cashContributions).length && pagamentos.length) {
    clone.cashContributions = pagamentos.map((entry) => ({
      paymentId: normalizeString(entry.id || entry.paymentId || entry.label),
      paymentLabel: normalizeString(entry.label || entry.paymentLabel),
      amount: roundMoney(safeNumber(entry.valor ?? entry.amount ?? entry.total, 0)),
    }));
  }

  if (!ensureArray(clone.paymentTags).length && pagamentos.length) {
    clone.paymentTags = pagamentos
      .map((entry) => normalizeString(entry.label || entry.paymentLabel))
      .filter(Boolean);
  }

  return clone;
};

const buildPaymentSnapshot = (label, amount) => ({
  id: normalizeString(label),
  label: normalizeString(label),
  type: normalizePaymentType(label),
  aliases: [],
  valor: roundMoney(amount),
  parcelas: 1,
});

const saveFocusedBackup = ({ pdv, state, session }) => {
  const backupDir = path.resolve(__dirname, '..', 'BancoLocalViewer', 'recovery');
  fs.mkdirSync(backupDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const payload = {
    exportedAt: new Date().toISOString(),
    pdv: {
      _id: String(pdv._id),
      codigo: pdv.codigo,
      nome: pdv.nome,
    },
    state,
    session,
  };
  const filePath = path.join(backupDir, `pdv-state-${pdv.codigo}-${timestamp}.json`);
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
  return filePath;
};

const main = async () => {
  await mongoose.connect(mongoUri);

  const pdv =
    (await Pdv.findOne({ codigo: pdvRef })) ||
    (await Pdv.findOne({ nome: pdvRef })) ||
    (mongoose.Types.ObjectId.isValid(pdvRef) ? await Pdv.findById(pdvRef) : null);

  if (!pdv) {
    throw new Error(`PDV não encontrado para referência "${pdvRef}"`);
  }

  const [state, latestSession] = await Promise.all([
    PdvState.findOne({ pdv: pdv._id }),
    PdvCaixaSession.findOne({ pdv: pdv._id }).sort({ aberturaData: -1, updatedAt: -1 }),
  ]);

  if (!state) {
    throw new Error(`PdvState não encontrado para ${pdv.codigo}`);
  }
  if (!latestSession) {
    throw new Error(`Nenhuma sessão de caixa encontrada para ${pdv.codigo}`);
  }

  const backupFile = saveFocusedBackup({
    pdv,
    state: state.toObject({ depopulate: true }),
    session: latestSession.toObject({ depopulate: true }),
  });

  const cycleStart = safeDate(latestSession.aberturaData || state.caixaInfo?.aberturaData);
  const hydratedSales = ensureArray(latestSession.completedSalesSnapshot).map(hydrateSaleFromReceipt);
  const cycleSalesAll = hydratedSales.filter((sale) => {
    if (!sale || typeof sale !== 'object') return false;
    const createdAt = safeDate(sale.createdAt);
    if (!createdAt) return false;
    if (cycleStart && createdAt.getTime() < cycleStart.getTime()) return false;
    return true;
  });
  const cycleSales = cycleSalesAll.filter(
    (sale) => normalizeString(sale.status).toLowerCase() !== 'cancelled'
  );

  const saleByCode = new Map(
    cycleSalesAll.map((sale) => [normalizeString(sale.saleCode).toUpperCase(), sale]).filter(([key]) => key)
  );

  let abertura = 0;
  let recebido = 0;
  let recebimentosCliente = 0;
  let otherDelta = 0;
  const paymentTotals = new Map();

  const addPaymentTotal = (label, amount) => {
    const normalizedLabel = normalizeString(label) || 'Pagamento';
    const current = safeNumber(paymentTotals.get(normalizedLabel), 0);
    paymentTotals.set(normalizedLabel, roundMoney(current + amount));
  };

  ensureArray(latestSession.historySnapshot).forEach((entry) => {
    const delta = safeNumber(entry?.delta ?? entry?.amount, 0);
    if (!(delta || entry?.id === 'abertura')) return;

    if (entry.id === 'abertura') {
      abertura = roundMoney(abertura + delta);
      addPaymentTotal(extractMethodFromLabel(entry.paymentLabel) || 'Dinheiro', delta);
      return;
    }

    if (entry.id === 'venda' || entry.id === 'cancelamento-venda') {
      const saleCode = extractSaleCodeFromLabel(entry.label || entry.paymentLabel);
      const sale = saleByCode.get(saleCode);
      const multiplier = entry.id === 'cancelamento-venda' ? -1 : 1;
      if (entry.id === 'venda') {
        recebido = roundMoney(recebido + Math.abs(delta));
      } else {
        recebido = roundMoney(recebido - Math.abs(delta));
      }

      const contributions = ensureArray(sale?.cashContributions);
      if (contributions.length) {
        contributions.forEach((item) => {
          const amount = safeNumber(item.amount ?? item.valor ?? item.total, 0) * multiplier;
          if (!amount) return;
          addPaymentTotal(item.paymentLabel || item.label || item.paymentId, amount);
        });
      } else {
        addPaymentTotal(extractMethodFromLabel(entry.paymentLabel), delta);
      }
      return;
    }

    if (String(entry.id || '').includes('recebimento-cliente')) {
      recebimentosCliente = roundMoney(recebimentosCliente + delta);
      addPaymentTotal(extractMethodFromLabel(entry.paymentLabel), delta);
      return;
    }

    otherDelta = roundMoney(otherDelta + delta);
    if (entry.paymentLabel) {
      addPaymentTotal(extractMethodFromLabel(entry.paymentLabel), delta);
    }
  });

  const pagamentos = Array.from(paymentTotals.entries())
    .map(([label, amount]) => buildPaymentSnapshot(label, amount))
    .filter((entry) => Math.abs(safeNumber(entry.valor, 0)) > 0.00001);

  const fechamentoPrevisto = roundMoney(
    pagamentos.reduce((sum, payment) => sum + safeNumber(payment.valor, 0), 0)
  );
  const nextSummary = {
    abertura: roundMoney(abertura),
    recebido: roundMoney(recebido),
    recebimentosCliente: roundMoney(recebimentosCliente),
    saldo: roundMoney(abertura + recebido + recebimentosCliente + otherDelta),
  };

  const nextCaixaInfo = {
    ...(state.caixaInfo?.toObject ? state.caixaInfo.toObject() : state.caixaInfo || {}),
    ...(latestSession.caixaInfoSnapshot || {}),
    aberturaData: cycleStart || latestSession.aberturaData || state.caixaInfo?.aberturaData || null,
    fechamentoData:
      latestSession.fechamentoData ||
      latestSession.caixaInfoSnapshot?.fechamentoData ||
      state.caixaInfo?.fechamentoData ||
      null,
    fechamentoPrevisto,
    previstoPagamentos: pagamentos,
  };

  const payload = {
    pdv: {
      _id: String(pdv._id),
      codigo: pdv.codigo,
      nome: pdv.nome,
    },
    backupFile,
    cycleStart: cycleStart ? cycleStart.toISOString() : null,
    currentState: {
      summary: state.summary,
      pagamentosCount: ensureArray(state.pagamentos).length,
      historyCount: ensureArray(state.history).length,
      completedSalesCount: ensureArray(state.completedSales).length,
    },
    recovered: {
      summary: nextSummary,
      pagamentos,
      historyCount: ensureArray(latestSession.historySnapshot).length,
      completedSalesCount: hydratedSales.length,
      salesInCurrentCycle: cycleSales.length,
    },
    applyChanges,
  };

  if (applyChanges) {
    state.summary = nextSummary;
    state.pagamentos = pagamentos;
    state.history = ensureArray(latestSession.historySnapshot);
    state.completedSales = hydratedSales;
    state.caixaInfo = nextCaixaInfo;
    state.caixaAberto = Boolean(latestSession.caixaAberto ?? latestSession.status === 'aberto');
    state.lastMovement = ensureArray(latestSession.historySnapshot)[0] || null;
    await state.save();

    latestSession.summary = nextSummary;
    latestSession.pagamentosSnapshot = pagamentos;
    latestSession.completedSalesSnapshot = hydratedSales;
    latestSession.caixaInfoSnapshot = nextCaixaInfo;
    latestSession.stateUpdatedAt = new Date();
    await latestSession.save();
  }

  console.log(JSON.stringify(payload, null, 2));
};

main()
  .catch((error) => {
    console.error('[recover-pdv-state-from-session] Falha:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await mongoose.disconnect();
    } catch (error) {
      // no-op
    }
  });
