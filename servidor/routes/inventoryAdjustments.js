const express = require('express');
const mongoose = require('mongoose');
const InventoryAdjustment = require('../models/InventoryAdjustment');
const Store = require('../models/Store');
const Deposit = require('../models/Deposit');
const User = require('../models/User');
const Product = require('../models/Product');
const requireAuth = require('../middlewares/requireAuth');
const authorizeRoles = require('../middlewares/authorizeRoles');
const {
  adjustProductStockForDeposit,
  resolveProductObjectId,
  toObjectIdOrNull,
  resolveFractionalChildRatio,
} = require('../utils/inventoryStock');
const { recalculateFractionalStockForProduct } = require('../utils/fractionalInventory');

const router = express.Router();

const allowedRoles = ['admin', 'admin_master', 'funcionario'];
const PRODUCT_SALE_PRICE_KEYS = ['venda', 'precoVenda', 'preco', 'valorVenda', 'valor'];

const sanitizeString = (value) => (typeof value === 'string' ? value.trim() : '');

const parseDateInput = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
};

const escapeRegExp = (value) => {
  if (typeof value !== 'string') return '';
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

const parseNumber = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  const normalized = String(value).trim();
  if (!normalized) return null;
  const replaced = normalized.includes(',')
    ? normalized.replace(/\./g, '').replace(',', '.')
    : normalized;
  const parsed = Number(replaced);
  return Number.isFinite(parsed) ? parsed : null;
};

const toISODateString = (value) => {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const toISOStringOrNull = (value) => {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toISOString();
};

const buildDateRangeFilter = (start, end) => {
  if (!start && !end) {
    return null;
  }

  const range = {};

  if (start) {
    const startDate = new Date(start);
    startDate.setUTCHours(0, 0, 0, 0);
    range.$gte = startDate;
  }

  if (end) {
    const endDate = new Date(end);
    endDate.setUTCHours(23, 59, 59, 999);
    range.$lte = endDate;
  }

  return range;
};

const mapPerson = (doc) => {
  if (!doc || typeof doc !== 'object') {
    return null;
  }

  const identifier = doc._id ? String(doc._id) : '';
  const name = sanitizeString(doc.nomeCompleto) || sanitizeString(doc.apelido) || sanitizeString(doc.email);
  return {
    id: identifier,
    name: name || '',
    email: sanitizeString(doc.email),
  };
};

const mapCompany = (doc) => {
  if (!doc || typeof doc !== 'object') {
    return null;
  }

  return {
    id: doc._id ? String(doc._id) : '',
    name: sanitizeString(doc.nomeFantasia) || sanitizeString(doc.nome) || '',
  };
};

const mapDeposit = (doc) => {
  if (!doc || typeof doc !== 'object') {
    return null;
  }

  return {
    id: doc._id ? String(doc._id) : '',
    name: sanitizeString(doc.nome) || '',
  };
};

const mapItem = (item) => {
  if (!item || typeof item !== 'object') {
    return null;
  }

  const quantity = Number(item.quantity);
  const unitValue = item.unitValue === null || item.unitValue === undefined ? null : Number(item.unitValue);

  return {
    productId: item.product ? String(item.product) : '',
    sku: sanitizeString(item.sku),
    barcode: sanitizeString(item.barcode),
    name: sanitizeString(item.name),
    quantity: Number.isFinite(quantity) ? quantity : 0,
    unitValue: Number.isFinite(unitValue) ? unitValue : null,
    notes: sanitizeString(item.notes),
  };
};

router.get('/', requireAuth, authorizeRoles(...allowedRoles), async (req, res) => {
  try {
    const startDateRaw = sanitizeString(req.query.startDate);
    const endDateRaw = sanitizeString(req.query.endDate);
    const operationRaw = sanitizeString(req.query.operation).toLowerCase();
    const companyRaw = sanitizeString(req.query.company);
    const depositRaw = sanitizeString(req.query.deposit);
    const responsibleRaw = sanitizeString(req.query.responsible);
    const searchRaw = sanitizeString(req.query.search);

    const startDate = startDateRaw ? parseDateInput(startDateRaw) : null;
    if (startDateRaw && !startDate) {
      return res.status(400).json({ message: 'Informe uma data inicial válida.' });
    }

    const endDate = endDateRaw ? parseDateInput(endDateRaw) : null;
    if (endDateRaw && !endDate) {
      return res.status(400).json({ message: 'Informe uma data final válida.' });
    }

    if (startDate && endDate && startDate > endDate) {
      return res.status(400).json({ message: 'O período informado é inválido. A data inicial deve ser anterior à data final.' });
    }

    const filters = {};

    const dateRange = buildDateRangeFilter(startDate, endDate);
    if (dateRange) {
      filters.movementDate = dateRange;
    }

    if (operationRaw) {
      if (!['entrada', 'saida'].includes(operationRaw)) {
        return res.status(400).json({ message: 'Tipo de movimentação inválido informado.' });
      }
      filters.operation = operationRaw;
    }

    if (companyRaw) {
      const companyId = toObjectIdOrNull(companyRaw);
      if (!companyId) {
        return res.status(400).json({ message: 'Empresa informada é inválida.' });
      }
      filters.company = companyId;
    }

    if (depositRaw) {
      const depositId = toObjectIdOrNull(depositRaw);
      if (!depositId) {
        return res.status(400).json({ message: 'Depósito informado é inválido.' });
      }
      filters.deposit = depositId;
    }

    if (responsibleRaw) {
      const responsibleId = toObjectIdOrNull(responsibleRaw);
      if (!responsibleId) {
        return res.status(400).json({ message: 'Responsável informado é inválido.' });
      }
      filters.responsible = responsibleId;
    }

    if (searchRaw) {
      const regex = new RegExp(escapeRegExp(searchRaw), 'i');
      filters.$or = [
        { reason: regex },
        { referenceDocument: regex },
        { notes: regex },
        { 'items.name': regex },
        { 'items.sku': regex },
        { 'items.barcode': regex },
      ];
    }

    const limitParsed = Number.parseInt(req.query.limit, 10);
    const limit = Number.isFinite(limitParsed) ? Math.min(Math.max(limitParsed, 1), 200) : 50;
    const pageParsed = Number.parseInt(req.query.page, 10);
    const page = Number.isFinite(pageParsed) && pageParsed > 0 ? pageParsed : 1;
    const skip = (page - 1) * limit;

    const matchFilters = filters.$or ? { ...filters, $or: [...filters.$or] } : { ...filters };

    const [adjustments, aggregateSummary] = await Promise.all([
      InventoryAdjustment.find(filters, {
        operation: 1,
        reason: 1,
        company: 1,
        deposit: 1,
        movementDate: 1,
        referenceDocument: 1,
        notes: 1,
        responsible: 1,
        createdBy: 1,
        createdAt: 1,
        updatedAt: 1,
        totalQuantity: 1,
        totalValue: 1,
        items: 1,
      })
        .sort({ movementDate: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('company', { nome: 1, nomeFantasia: 1 })
        .populate('deposit', { nome: 1 })
        .populate('responsible', { nomeCompleto: 1, apelido: 1, email: 1 })
        .populate('createdBy', { nomeCompleto: 1, apelido: 1, email: 1 })
        .lean(),
      InventoryAdjustment.aggregate([
        { $match: matchFilters },
        {
          $group: {
            _id: null,
            totalAdjustments: { $sum: 1 },
            totalEntradas: {
              $sum: {
                $cond: [{ $eq: ['$operation', 'entrada'] }, 1, 0],
              },
            },
            totalSaidas: {
              $sum: {
                $cond: [{ $eq: ['$operation', 'saida'] }, 1, 0],
              },
            },
            netQuantity: { $sum: { $ifNull: ['$totalQuantity', 0] } },
            netValue: { $sum: { $ifNull: ['$totalValue', 0] } },
            quantityEntradas: {
              $sum: {
                $cond: [
                  { $eq: ['$operation', 'entrada'] },
                  { $ifNull: ['$totalQuantity', 0] },
                  0,
                ],
              },
            },
            quantitySaidas: {
              $sum: {
                $cond: [
                  { $eq: ['$operation', 'saida'] },
                  { $abs: { $ifNull: ['$totalQuantity', 0] } },
                  0,
                ],
              },
            },
            valueEntradas: {
              $sum: {
                $cond: [
                  { $eq: ['$operation', 'entrada'] },
                  { $ifNull: ['$totalValue', 0] },
                  0,
                ],
              },
            },
            valueSaidas: {
              $sum: {
                $cond: [
                  { $eq: ['$operation', 'saida'] },
                  { $abs: { $ifNull: ['$totalValue', 0] } },
                  0,
                ],
              },
            },
          },
        },
      ]),
    ]);

    const summaryDoc = Array.isArray(aggregateSummary) ? aggregateSummary[0] : null;

    const summary = {
      totalAdjustments: summaryDoc?.totalAdjustments || 0,
      totalEntradas: summaryDoc?.totalEntradas || 0,
      totalSaidas: summaryDoc?.totalSaidas || 0,
      netQuantity: summaryDoc?.netQuantity || 0,
      netValue: summaryDoc?.netValue || 0,
      quantityEntradas: summaryDoc?.quantityEntradas || 0,
      quantitySaidas: summaryDoc?.quantitySaidas || 0,
      valueEntradas: summaryDoc?.valueEntradas || 0,
      valueSaidas: summaryDoc?.valueSaidas || 0,
    };

    const total = summary.totalAdjustments || 0;
    const totalPages = Math.max(Math.ceil(total / limit), 1);

    const normalizedAdjustments = adjustments.map((adjustment) => {
      if (!adjustment || typeof adjustment !== 'object') {
        return adjustment;
      }

      const totalQuantity = Number(adjustment.totalQuantity);
      const totalValue = Number(adjustment.totalValue);

      return {
        id: adjustment._id ? String(adjustment._id) : '',
        operation: adjustment.operation,
        reason: sanitizeString(adjustment.reason),
        movementDate: toISODateString(adjustment.movementDate),
        movementDateTime: toISOStringOrNull(adjustment.movementDate),
        referenceDocument: sanitizeString(adjustment.referenceDocument),
        notes: sanitizeString(adjustment.notes),
        totalQuantity: Number.isFinite(totalQuantity) ? totalQuantity : 0,
        totalValue: Number.isFinite(totalValue) ? totalValue : 0,
        company: mapCompany(adjustment.company),
        deposit: mapDeposit(adjustment.deposit),
        responsible: mapPerson(adjustment.responsible),
        createdBy: mapPerson(adjustment.createdBy),
        createdAt: toISOStringOrNull(adjustment.createdAt),
        updatedAt: toISOStringOrNull(adjustment.updatedAt),
        items: Array.isArray(adjustment.items)
          ? adjustment.items.map((item) => mapItem(item)).filter(Boolean)
          : [],
      };
    });

    res.json({
      adjustments: normalizedAdjustments,
      summary,
      pagination: {
        page,
        limit,
        total,
        totalPages,
      },
    });
  } catch (error) {
    console.error('Erro ao listar movimentações de estoque:', error);
    res.status(500).json({ message: 'Não foi possível carregar as movimentações de estoque.' });
  }
});

router.get('/form-data', requireAuth, authorizeRoles(...allowedRoles), async (req, res) => {
  try {
    const [stores, deposits, responsaveis] = await Promise.all([
      Store.find({}, { nome: 1, nomeFantasia: 1, cnpj: 1 })
        .sort({ nome: 1, nomeFantasia: 1 })
        .lean(),
      Deposit.find({}, { nome: 1, empresa: 1 })
        .sort({ nome: 1 })
        .lean(),
      User.find({ role: { $in: allowedRoles } }, { nomeCompleto: 1, apelido: 1, email: 1, role: 1 })
        .sort({ nomeCompleto: 1, apelido: 1, email: 1 })
        .lean(),
    ]);

    res.json({ stores, deposits, responsaveis });
  } catch (error) {
    console.error('Erro ao carregar dados para movimentação de estoque:', error);
    res.status(500).json({ message: 'Não foi possível carregar os dados iniciais.' });
  }
});

router.get('/search-products', requireAuth, authorizeRoles(...allowedRoles), async (req, res) => {
  try {
    const term = sanitizeString(req.query.term);
    if (!term) {
      return res.json({ products: [] });
    }

    const includeInactive = String(req.query.includeInactive || '').toLowerCase() === 'true';

    const regex = new RegExp(escapeRegExp(term), 'i');
    const numericTerm = term.replace(/\D/g, '');
    const query = {
      $or: [
        { cod: regex },
        { codbarras: regex },
        { nome: regex },
      ],
    };

    if (!includeInactive) {
      query.inativo = { $ne: true };
    }

    if (numericTerm) {
      query.$or.push({ codbarras: new RegExp(escapeRegExp(numericTerm), 'i') });
    }

    const products = await Product.find(query, {
      cod: 1,
      codbarras: 1,
      nome: 1,
      unidade: 1,
      custo: 1,
      venda: 1,
      precoVenda: 1,
      preco: 1,
      valorVenda: 1,
      valor: 1,
    })
      .limit(20)
      .sort({ nome: 1 })
      .lean();

    const normalizedProducts = products.map((product) => {
      if (!product || typeof product !== 'object') {
        return product;
      }

      const normalized = { ...product };
      const costNumber = parseNumber(normalized.custo);
      if (costNumber !== null) {
        normalized.custo = costNumber;
      }

      let saleNumber = null;
      for (const key of PRODUCT_SALE_PRICE_KEYS) {
        if (!key) continue;
        const parsed = parseNumber(normalized[key]);
        if (parsed !== null) {
          saleNumber = parsed;
          break;
        }
      }

      if (saleNumber !== null) {
        normalized.venda = saleNumber;
      } else if (typeof normalized.venda === 'undefined') {
        normalized.venda = null;
      }

      return normalized;
    });

    res.json({ products: normalizedProducts });
  } catch (error) {
    console.error('Erro ao buscar produtos para movimentação de estoque:', error);
    res.status(500).json({ message: 'Não foi possível buscar produtos no momento.' });
  }
});

router.get('/products/:id', requireAuth, authorizeRoles(...allowedRoles), async (req, res) => {
  try {
    const { id } = req.params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Produto inválido informado.' });
    }

    const product = await Product.findById(id, {
      cod: 1,
      codbarras: 1,
      nome: 1,
      unidade: 1,
      custo: 1,
      estoques: 1,
    }).lean();

    if (!product) {
      return res.status(404).json({ message: 'Produto não encontrado.' });
    }

    const stocks = Array.isArray(product.estoques)
      ? product.estoques.map((stock) => ({
          depositId: stock?.deposito ? String(stock.deposito) : '',
          quantity: Number(stock?.quantidade) || 0,
          unit: stock?.unidade || '',
        }))
      : [];

    res.json({
      product: {
        _id: product._id,
        cod: product.cod,
        codbarras: product.codbarras,
        nome: product.nome,
        unidade: product.unidade,
        custo: product.custo,
      },
      stocks,
    });
  } catch (error) {
    console.error('Erro ao carregar detalhes do produto para movimentação de estoque:', error);
    res.status(500).json({ message: 'Não foi possível carregar os detalhes do produto.' });
  }
});

router.post('/', requireAuth, authorizeRoles(...allowedRoles), async (req, res) => {
  let session = null;

  try {
    const {
      operation,
      reason,
      company,
      deposit,
      movementDate,
      referenceDocument,
      notes,
      responsible,
      items,
    } = req.body || {};

    const normalizedOperation = sanitizeString(operation).toLowerCase();
    if (!['entrada', 'saida'].includes(normalizedOperation)) {
      return res.status(400).json({ message: 'Informe se a movimentação é de entrada ou saída.' });
    }

    const sanitizedReason = sanitizeString(reason);
    if (!sanitizedReason) {
      return res.status(400).json({ message: 'Informe o motivo da movimentação de estoque.' });
    }

    const parsedDate = parseDateInput(movementDate);
    if (!parsedDate) {
      return res.status(400).json({ message: 'Informe uma data válida para a movimentação.' });
    }

    const requiredIds = [company, deposit, responsible];
    if (requiredIds.some((value) => !value || !mongoose.Types.ObjectId.isValid(value))) {
      return res.status(400).json({ message: 'Empresa, depósito ou responsável inválidos.' });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: 'Inclua ao menos um item na movimentação.' });
    }

    const companyDoc = await Store.findById(company).lean();
    if (!companyDoc) {
      return res.status(400).json({ message: 'Empresa selecionada não encontrada.' });
    }

    const depositDoc = await Deposit.findById(deposit).lean();
    if (!depositDoc) {
      return res.status(400).json({ message: 'Depósito selecionado não encontrado.' });
    }

    if (String(depositDoc.empresa) !== String(companyDoc._id)) {
      return res.status(400).json({ message: 'O depósito informado não pertence à empresa selecionada.' });
    }

    const responsibleDoc = await User.findById(responsible).lean();
    if (!responsibleDoc || !allowedRoles.includes(responsibleDoc.role)) {
      return res.status(400).json({ message: 'Responsável informado é inválido.' });
    }

    const preparedItemsInput = [];
    const productIds = [];

    for (const rawItem of items) {
      const productId = resolveProductObjectId(rawItem?.productId || rawItem?.product);
      if (!productId) {
        return res.status(400).json({ message: 'Um ou mais itens possuem produto inválido.' });
      }

      const quantity = Number(rawItem?.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        return res.status(400).json({ message: 'Informe quantidades válidas para todos os itens.' });
      }

      const normalizedUnitValue = parseNumber(rawItem?.unitValue);
      const itemNotes = sanitizeString(rawItem?.notes);

      preparedItemsInput.push({
        productId: productId.toString(),
        quantity,
        unitValue: normalizedUnitValue !== null ? Math.round(normalizedUnitValue * 100) / 100 : null,
        notes: itemNotes,
      });
      productIds.push(productId);
    }

    const products = await Product.find({ _id: { $in: productIds } }, {
      cod: 1,
      codbarras: 1,
      nome: 1,
      custo: 1,
      fracionado: 1,
    }).lean();

    if (products.length !== productIds.length) {
      return res.status(400).json({ message: 'Não foi possível localizar todos os produtos informados.' });
    }

    const productMap = new Map(products.map((product) => [String(product._id), product]));

    const creatorId = toObjectIdOrNull(req.user?.id);
    if (!creatorId) {
      return res.status(401).json({ message: 'Sessão expirada. Faça login novamente.' });
    }

    const factor = normalizedOperation === 'saida' ? -1 : 1;
    const adjustmentMap = new Map();
    const fractionalParents = new Set();

    const normalizeProductId = (value) => {
      if (!value) return null;
      if (value instanceof mongoose.Types.ObjectId) {
        return value.toString();
      }
      if (typeof value === 'object' && value._id) {
        return normalizeProductId(value._id);
      }
      if (typeof value === 'string') {
        return mongoose.Types.ObjectId.isValid(value) ? value : null;
      }
      return null;
    };

    const recordAdjustment = (productId, delta) => {
      if (!Number.isFinite(delta) || delta === 0) {
        return;
      }
      const current = adjustmentMap.get(productId) || 0;
      const next = current + delta;
      const normalized = Math.round(next * 1_000_000) / 1_000_000;
      if (normalized === 0) {
        adjustmentMap.delete(productId);
      } else {
        adjustmentMap.set(productId, normalized);
      }
    };

    const ensureProductLoaded = async (productId) => {
      if (productMap.has(productId)) {
        return productMap.get(productId);
      }

      try {
        const doc = await Product.findById(productId, {
          cod: 1,
          codbarras: 1,
          nome: 1,
          custo: 1,
          fracionado: 1,
        }).lean();

        if (doc) {
          productMap.set(productId, doc);
          return doc;
        }

        console.warn('Produto vinculado ao fracionamento não foi encontrado.', { productId });
      } catch (loadError) {
        console.warn('Falha ao carregar produto vinculado ao fracionamento.', { productId }, loadError);
      }

      return null;
    };

    const accumulateAdjustments = async (productId, delta, visited = new Set()) => {
      if (!Number.isFinite(delta) || delta === 0) {
        return;
      }

      const normalizedId = normalizeProductId(productId);
      if (!normalizedId) {
        return;
      }

      if (visited.has(normalizedId)) {
        return;
      }

      visited.add(normalizedId);
      recordAdjustment(normalizedId, delta);

      const product = await ensureProductLoaded(normalizedId);
      if (!product) {
        return;
      }

      const fractionalConfig = product?.fracionado || {};
      const fractionalItems = Array.isArray(fractionalConfig?.itens) ? fractionalConfig.itens : [];

      if (!fractionalConfig?.ativo || fractionalItems.length === 0) {
        return;
      }

      fractionalParents.add(normalizedId);

      for (const item of fractionalItems) {
        const childId = normalizeProductId(item?.produto);
        if (!childId) {
          continue;
        }

        const ratio = resolveFractionalChildRatio(item?.quantidadeOrigem, item?.quantidadeFracionada);
        if (!Number.isFinite(ratio) || ratio <= 0) {
          continue;
        }

        const childDelta = delta * ratio;
        if (!Number.isFinite(childDelta) || childDelta === 0) {
          continue;
        }

        const branchVisited = new Set(visited);
        await accumulateAdjustments(childId, childDelta, branchVisited);
      }
    };

    for (const rawItem of preparedItemsInput) {
      await accumulateAdjustments(rawItem.productId, rawItem.quantity * factor, new Set());
    }

    session = await mongoose.startSession();

    let adjustmentRecord = null;
    await session.withTransaction(async () => {
      const preparedItems = [];
      let totalQuantity = 0;
      let totalValue = 0;

      for (const rawItem of preparedItemsInput) {
        const product = productMap.get(rawItem.productId);
        if (!product) {
          const error = new Error('Produto informado não foi encontrado.');
          error.statusCode = 400;
          throw error;
        }

        const unitValue = rawItem.unitValue !== null && rawItem.unitValue !== undefined
          ? rawItem.unitValue
          : (Number.isFinite(product?.custo) ? Math.round(Number(product.custo) * 100) / 100 : null);

        const delta = rawItem.quantity * factor;

        preparedItems.push({
          product: product._id,
          sku: sanitizeString(product.cod),
          barcode: sanitizeString(product.codbarras),
          name: sanitizeString(product.nome),
          quantity: rawItem.quantity,
          unitValue,
          notes: rawItem.notes || '',
        });

        totalQuantity += delta;
        if (unitValue !== null && Number.isFinite(unitValue)) {
          totalValue += unitValue * rawItem.quantity * factor;
        }
      }

      for (const [productId, delta] of adjustmentMap.entries()) {
        await adjustProductStockForDeposit({
          productId,
          depositId: deposit,
          quantity: delta,
          session,
          cascadeFractional: false,
        });
      }

      for (const parentId of fractionalParents) {
        await recalculateFractionalStockForProduct(parentId, { session });
      }

      adjustmentRecord = await InventoryAdjustment.create([
        {
          operation: normalizedOperation,
          reason: sanitizedReason,
          company,
          deposit,
          movementDate: parsedDate,
          referenceDocument: sanitizeString(referenceDocument),
          notes: sanitizeString(notes),
          responsible,
          createdBy: creatorId,
          items: preparedItems,
          totalQuantity: Math.round(totalQuantity * 1_000_000) / 1_000_000,
          totalValue: Math.round(totalValue * 100) / 100,
        },
      ], { session });
    });

    const [adjustment] = Array.isArray(adjustmentRecord) ? adjustmentRecord : [];

    res.status(201).json({
      message: 'Movimentação de estoque registrada com sucesso.',
      adjustment: adjustment
        ? {
            id: String(adjustment._id),
            operation: adjustment.operation,
            reason: adjustment.reason,
            movementDate: toISODateString(adjustment.movementDate),
            totalQuantity: adjustment.totalQuantity,
            totalValue: adjustment.totalValue,
          }
        : null,
    });
  } catch (error) {
    if (error?.statusCode === 400) {
      return res.status(400).json({ message: error.message || 'Dados inválidos informados.', details: error.details });
    }
    if (error?.statusCode === 404) {
      return res.status(404).json({ message: error.message || 'Registro não encontrado.' });
    }
    console.error('Erro ao registrar movimentação de estoque manual:', error);
    res.status(500).json({ message: 'Não foi possível registrar a movimentação de estoque.' });
  } finally {
    if (session) {
      await session.endSession();
    }
  }
});

module.exports = router;

