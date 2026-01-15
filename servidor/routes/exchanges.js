const express = require('express');
const mongoose = require('mongoose');
const Exchange = require('../models/Exchange');
const Deposit = require('../models/Deposit');
const Pdv = require('../models/Pdv');
const Product = require('../models/Product');
const requireAuth = require('../middlewares/requireAuth');
const authorizeRoles = require('../middlewares/authorizeRoles');
const { adjustProductStockForDeposit, toObjectIdOrNull } = require('../utils/inventoryStock');

const router = express.Router();

const allowedRoles = ['admin', 'admin_master', 'funcionario'];

const sanitizeString = (value) => (typeof value === 'string' ? value.trim() : '');
const normalizeCodeValue = (value) => String(value ?? '').replace(/\s+/g, '');
const escapeRegExp = (value) =>
  typeof value === 'string' ? value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : '';

const parseDecimal = (value) => {
  if (value === undefined || value === null || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const normalized = String(value).trim().replace(/\./g, '').replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

const parseDateInput = (value) => {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) {
      const year = Number(match[1]);
      const month = Number(match[2]) - 1;
      const day = Number(match[3]);
      const parsed = new Date(year, month, day, 12, 0, 0, 0);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const toObjectId = (value) =>
  mongoose.Types.ObjectId.isValid(value) ? new mongoose.Types.ObjectId(value) : null;

const buildLookupCandidates = (value) => {
  const raw = sanitizeString(value);
  const normalized = normalizeCodeValue(value);
  const candidates = new Set();
  if (raw) candidates.add(raw);
  if (normalized) candidates.add(normalized);
  return Array.from(candidates);
};

const findProductByCodeOrBarcode = async (code) => {
  const candidates = buildLookupCandidates(code);
  if (!candidates.length) return null;
  const query = {
    $or: [
      { cod: { $in: candidates } },
      { codigoInterno: { $in: candidates } },
      { codigo: { $in: candidates } },
      { codInterno: { $in: candidates } },
      { codigoReferencia: { $in: candidates } },
      { referencia: { $in: candidates } },
      { sku: { $in: candidates } },
      { codbarras: { $in: candidates } },
      { codigoBarras: { $in: candidates } },
      { codigoDeBarras: { $in: candidates } },
      { barras: { $in: candidates } },
      { ean: { $in: candidates } },
      { codigosComplementares: { $in: candidates } },
    ],
  };
  return Product.findOne(query).select('nome cod codbarras unidade').lean();
};

const findDepositByLabel = async (companyId, label) => {
  const normalized = sanitizeString(label);
  const companyObjectId = toObjectIdOrNull(companyId);
  if (!companyObjectId || !normalized) return null;
  const regex = new RegExp(`^${escapeRegExp(normalized)}$`, 'i');
  return Deposit.findOne({
    empresa: companyObjectId,
    $or: [{ nome: regex }, { codigo: regex }],
  }).lean();
};

const buildExchangeItem = (item) => {
  if (!item || typeof item !== 'object') return null;
  const code = sanitizeString(item.code);
  const description = sanitizeString(item.description);
  const productId = toObjectId(item.productId || item.product || item.produto);
  const quantity = parseDecimal(item.quantity);
  const unitValue = parseDecimal(item.unitValue);
  const totalValue =
    item.totalValue !== undefined && item.totalValue !== null
      ? parseDecimal(item.totalValue)
      : quantity * unitValue;
  const discountValue = parseDecimal(item.discountValue);
  const depositId = toObjectId(item.depositId || item.deposit || item.deposito);
  const depositLabel = sanitizeString(item.depositLabel);
  if (!code && !description) return null;
  return {
    code,
    description,
    productId,
    quantity,
    unitValue,
    totalValue,
    discountValue,
    depositId,
    depositLabel,
  };
};

const getNextExchangeNumber = async () => {
  const lastExchange = await Exchange.findOne({}, { number: 1 }).sort({ number: -1 }).lean();
  const lastNumber = Number(lastExchange?.number) || 0;
  return lastNumber + 1;
};

const saveExchangeWithNextNumber = async (payload) => {
  let attempt = 0;
  while (attempt < 3) {
    attempt += 1;
    const number = await getNextExchangeNumber();
    const exchange = new Exchange({ ...payload, number, code: String(number) });
    try {
      return await exchange.save();
    } catch (error) {
      if (error?.code === 11000) {
        continue;
      }
      throw error;
    }
  }
  throw new Error('Nao foi possivel gerar o codigo da troca.');
};

router.post('/', requireAuth, authorizeRoles(...allowedRoles), async (req, res) => {
  try {
    const body = req.body || {};
    const companyId =
      body.companyId || body.empresaId || body.storeId || body.company || body.empresa;
    const pdvId = body.pdvId || body.pdv || body.pdv_id;
    const dateValue = parseDateInput(body.date || body.data) || new Date();
    const seller = body.seller || {};
    const customer = body.customer || {};
    const returnedItemsSource = Array.isArray(body.returnedItems) ? body.returnedItems : [];
    const takenItemsSource = Array.isArray(body.takenItems) ? body.takenItems : [];
    const returnedItems = returnedItemsSource.map(buildExchangeItem).filter(Boolean);
    const takenItems = takenItemsSource.map(buildExchangeItem).filter(Boolean);
    const returnedTotal = returnedItems.reduce(
      (sum, item) => sum + parseDecimal(item.totalValue),
      0
    );
    const takenTotal = takenItems.reduce((sum, item) => sum + parseDecimal(item.totalValue), 0);
    const differenceValue =
      body.differenceValue !== undefined && body.differenceValue !== null
        ? parseDecimal(body.differenceValue)
        : returnedTotal - takenTotal;

    const payload = {
      date: dateValue,
      type: sanitizeString(body.type || body.tipo) || 'troca',
      company: toObjectId(companyId),
      pdv: toObjectId(pdvId),
      seller: {
        code: sanitizeString(seller.code || body.sellerCode || body.vendedorCodigo),
        name: sanitizeString(seller.name || body.sellerName || body.vendedorNome),
        id: sanitizeString(seller.id || body.sellerId || body.vendedorId),
      },
      customer: {
        code: sanitizeString(customer.code || body.customerCode || body.clienteCodigo),
        name: sanitizeString(customer.name || body.customerName || body.clienteNome),
        document: sanitizeString(
          customer.document || body.customerDocument || body.clienteDocumento
        ),
        id: sanitizeString(customer.id || body.customerId || body.clienteId),
      },
      notes: sanitizeString(body.notes || body.observacoes),
      returnedItems,
      takenItems,
      totals: {
        returned: returnedTotal,
        taken: takenTotal,
      },
      differenceValue,
      createdBy: {
        id: sanitizeString(req.user?.id),
        email: sanitizeString(req.user?.email),
        role: sanitizeString(req.user?.role),
      },
    };

    const exchange = await saveExchangeWithNextNumber(payload);
    return res.status(201).json({
      exchange: {
        id: exchange._id,
        code: exchange.code,
        number: exchange.number,
      },
    });
  } catch (error) {
    console.error('Erro ao registrar troca:', error);
    return res.status(500).json({ message: 'Erro ao salvar troca.' });
  }
});

router.get('/by-code/:code', requireAuth, authorizeRoles(...allowedRoles), async (req, res) => {
  try {
    const raw = sanitizeString(req.params.code);
    if (!raw) {
      return res.status(400).json({ message: 'Codigo da troca e obrigatorio.' });
    }
    const numeric = Number(raw);
    const query = Number.isFinite(numeric)
      ? { $or: [{ code: raw }, { number: numeric }] }
      : { code: raw };
    const exchange = await Exchange.findOne(query).lean();
    if (!exchange) {
      return res.status(404).json({ message: 'Troca nao encontrada.' });
    }
    return res.json({
      exchange: {
        id: exchange._id,
        code: exchange.code,
        number: exchange.number,
        date: exchange.date,
        type: exchange.type,
        seller: exchange.seller,
        customer: exchange.customer,
        notes: exchange.notes,
        returnedItems: (exchange.returnedItems || []).map((item) => ({
          code: item.code,
          description: item.description,
          productId: item.productId ? String(item.productId) : '',
          quantity: item.quantity,
          unitValue: item.unitValue,
          totalValue: item.totalValue,
          discountValue: item.discountValue,
          depositId: item.depositId ? String(item.depositId) : '',
          depositLabel: item.depositLabel,
        })),
        takenItems: (exchange.takenItems || []).map((item) => ({
          code: item.code,
          description: item.description,
          productId: item.productId ? String(item.productId) : '',
          quantity: item.quantity,
          unitValue: item.unitValue,
          totalValue: item.totalValue,
          discountValue: item.discountValue,
          depositId: item.depositId ? String(item.depositId) : '',
          depositLabel: item.depositLabel,
        })),
        totals: exchange.totals || { returned: 0, taken: 0 },
        differenceValue: exchange.differenceValue || 0,
      },
    });
  } catch (error) {
    console.error('Erro ao buscar troca:', error);
    return res.status(500).json({ message: 'Erro ao carregar troca.' });
  }
});

router.put('/:id', requireAuth, authorizeRoles(...allowedRoles), async (req, res) => {
  try {
    const exchangeId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(exchangeId)) {
      return res.status(400).json({ message: 'Identificador da troca invalido.' });
    }
    const existing = await Exchange.findById(exchangeId);
    if (!existing) {
      return res.status(404).json({ message: 'Troca nao encontrada.' });
    }
    const body = req.body || {};
    const companyId =
      body.companyId || body.empresaId || body.storeId || body.company || body.empresa;
    const pdvId = body.pdvId || body.pdv || body.pdv_id;
    const dateValue = parseDateInput(body.date || body.data) || existing.date || new Date();
    const seller = body.seller || {};
    const customer = body.customer || {};
    const returnedItemsSource = Array.isArray(body.returnedItems) ? body.returnedItems : [];
    const takenItemsSource = Array.isArray(body.takenItems) ? body.takenItems : [];
    const returnedItems = returnedItemsSource.map(buildExchangeItem).filter(Boolean);
    const takenItems = takenItemsSource.map(buildExchangeItem).filter(Boolean);
    const returnedTotal = returnedItems.reduce(
      (sum, item) => sum + parseDecimal(item.totalValue),
      0
    );
    const takenTotal = takenItems.reduce((sum, item) => sum + parseDecimal(item.totalValue), 0);
    const differenceValue =
      body.differenceValue !== undefined && body.differenceValue !== null
        ? parseDecimal(body.differenceValue)
        : returnedTotal - takenTotal;

    existing.date = dateValue;
    existing.type = sanitizeString(body.type || body.tipo) || existing.type || 'troca';
    existing.company = toObjectId(companyId);
    existing.pdv = toObjectId(pdvId);
    existing.seller = {
      code: sanitizeString(seller.code || body.sellerCode || body.vendedorCodigo),
      name: sanitizeString(seller.name || body.sellerName || body.vendedorNome),
      id: sanitizeString(seller.id || body.sellerId || body.vendedorId),
    };
    existing.customer = {
      code: sanitizeString(customer.code || body.customerCode || body.clienteCodigo),
      name: sanitizeString(customer.name || body.customerName || body.clienteNome),
      document: sanitizeString(
        customer.document || body.customerDocument || body.clienteDocumento
      ),
      id: sanitizeString(customer.id || body.customerId || body.clienteId),
    };
    existing.notes = sanitizeString(body.notes || body.observacoes);
    existing.returnedItems = returnedItems;
    existing.takenItems = takenItems;
    existing.totals = { returned: returnedTotal, taken: takenTotal };
    existing.differenceValue = differenceValue;

    const saved = await existing.save();
    return res.json({
      exchange: {
        id: saved._id,
        code: saved.code,
        number: saved.number,
      },
    });
  } catch (error) {
    console.error('Erro ao atualizar troca:', error);
    return res.status(500).json({ message: 'Erro ao atualizar troca.' });
  }
});

const createFinalizeError = (message, details = {}) => {
  const error = new Error(message);
  error.statusCode = 400;
  error.details = details;
  return error;
};

const resolveExchangeMovementItem = async ({ item, companyId, defaultDepositId }) => {
  const quantity = parseDecimal(item.quantity);
  if (!(quantity > 0)) return null;
  let productId = toObjectIdOrNull(item.productId || item.product);
  let product = null;
  if (!productId) {
    product = await findProductByCodeOrBarcode(item.code);
    productId = toObjectIdOrNull(product?._id);
  }
  if (!productId) {
    throw createFinalizeError('Produto nao encontrado para a troca.', {
      code: item.code,
      description: item.description,
    });
  }

  let depositId = toObjectIdOrNull(item.depositId);
  if (!depositId && item.depositLabel && companyId) {
    const deposit = await findDepositByLabel(companyId, item.depositLabel);
    depositId = toObjectIdOrNull(deposit?._id);
  }
  if (!depositId && defaultDepositId) {
    depositId = toObjectIdOrNull(defaultDepositId);
  }
  if (!depositId) {
    throw createFinalizeError('Deposito nao encontrado para o item da troca.', {
      code: item.code,
      description: item.description,
      depositLabel: item.depositLabel,
    });
  }
  return {
    productId,
    depositId,
    quantity,
  };
};

router.post('/:id/finalize', requireAuth, authorizeRoles(...allowedRoles), async (req, res) => {
  try {
    const exchangeId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(exchangeId)) {
      return res.status(400).json({ message: 'Identificador da troca invalido.' });
    }
    const exchange = await Exchange.findById(exchangeId);
    if (!exchange) {
      return res.status(404).json({ message: 'Troca nao encontrada.' });
    }
    if (exchange.inventoryProcessed) {
      return res.status(409).json({ message: 'Esta troca ja foi finalizada.' });
    }

    const body = req.body || {};
    const pdvId = toObjectIdOrNull(body.pdvId || exchange.pdv);
    const pdv = pdvId ? await Pdv.findById(pdvId).lean() : null;
    const companyId = toObjectIdOrNull(body.companyId || exchange.company || pdv?.empresa);
    const defaultDepositId = toObjectIdOrNull(
      body.defaultDepositId || pdv?.configuracoesEstoque?.depositoPadrao
    );

    const returnedItemsSource = Array.isArray(body.returnedItems)
      ? body.returnedItems
      : exchange.returnedItems || [];
    const takenItemsSource = Array.isArray(body.takenItems)
      ? body.takenItems
      : exchange.takenItems || [];
    const returnedItems = returnedItemsSource.map(buildExchangeItem).filter(Boolean);
    const takenItems = takenItemsSource.map(buildExchangeItem).filter(Boolean);
    const returnedTotal = returnedItems.reduce(
      (sum, item) => sum + parseDecimal(item.totalValue),
      0
    );
    const takenTotal = takenItems.reduce((sum, item) => sum + parseDecimal(item.totalValue), 0);
    const differenceValue =
      body.differenceValue !== undefined && body.differenceValue !== null
        ? parseDecimal(body.differenceValue)
        : returnedTotal - takenTotal;

    if (!returnedItems.length && !takenItems.length) {
      return res.status(400).json({ message: 'Inclua ao menos um item para finalizar a troca.' });
    }

    const movements = [];
    for (const item of returnedItems) {
      const resolved = await resolveExchangeMovementItem({
        item,
        companyId,
        defaultDepositId,
      });
      if (!resolved) continue;
      movements.push({ ...resolved, delta: resolved.quantity });
    }
    for (const item of takenItems) {
      const resolved = await resolveExchangeMovementItem({
        item,
        companyId,
        defaultDepositId,
      });
      if (!resolved) continue;
      movements.push({ ...resolved, delta: -resolved.quantity });
    }

    if (!movements.length) {
      return res.status(400).json({ message: 'Nenhuma movimentacao de estoque foi gerada.' });
    }

    for (const movement of movements) {
      await adjustProductStockForDeposit({
        productId: movement.productId,
        depositId: movement.depositId,
        quantity: movement.delta,
      });
    }

    exchange.returnedItems = returnedItems;
    exchange.takenItems = takenItems;
    exchange.totals = { returned: returnedTotal, taken: takenTotal };
    exchange.differenceValue = differenceValue;
    exchange.inventoryProcessed = true;
    exchange.inventoryProcessedAt = new Date();
    exchange.finalizedAt = exchange.inventoryProcessedAt;
    exchange.finalizedBy = {
      id: sanitizeString(req.user?.id),
      email: sanitizeString(req.user?.email),
      role: sanitizeString(req.user?.role),
    };

    await exchange.save();

    return res.json({
      exchange: {
        id: exchange._id,
        code: exchange.code,
        number: exchange.number,
        differenceValue: exchange.differenceValue || 0,
        finalizedAt: exchange.finalizedAt,
      },
    });
  } catch (error) {
    const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
    const message =
      error?.message && typeof error.message === 'string'
        ? error.message
        : 'Erro ao finalizar troca.';
    console.error('Erro ao finalizar troca:', error);
    return res.status(statusCode).json({ message, details: error?.details });
  }
});

router.delete('/:id', requireAuth, authorizeRoles(...allowedRoles), async (req, res) => {
  try {
    const exchangeId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(exchangeId)) {
      return res.status(400).json({ message: 'Identificador da troca invalido.' });
    }
    const exchange = await Exchange.findById(exchangeId);
    if (!exchange) {
      return res.status(404).json({ message: 'Troca nao encontrada.' });
    }
    await exchange.deleteOne();
    return res.json({ ok: true });
  } catch (error) {
    console.error('Erro ao excluir troca:', error);
    return res.status(500).json({ message: 'Erro ao excluir troca.' });
  }
});

module.exports = router;
