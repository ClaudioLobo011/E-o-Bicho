const express = require('express');
const mongoose = require('mongoose');
const InventoryMovementLog = require('../models/InventoryMovementLog');
const Store = require('../models/Store');
const Deposit = require('../models/Deposit');
const User = require('../models/User');
const Product = require('../models/Product');
const requireAuth = require('../middlewares/requireAuth');
const authorizeRoles = require('../middlewares/authorizeRoles');

const router = express.Router();
const allowedRoles = ['admin', 'admin_master', 'funcionario'];

const sanitizeString = (value) => (typeof value === 'string' ? value.trim() : '');

const parseDateInput = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const toObjectIdOrNull = (value) => {
  const normalized = sanitizeString(value);
  if (!normalized || !mongoose.Types.ObjectId.isValid(normalized)) return null;
  return new mongoose.Types.ObjectId(normalized);
};

const buildDateRangeFilter = (start, end) => {
  if (!start && !end) return null;
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

const escapeRegExp = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const mapName = (doc, fallback = '') =>
  sanitizeString(doc?.nomeFantasia || doc?.nome || doc?.nomeCompleto || doc?.apelido || doc?.email || fallback);

const mapMovement = (doc) => {
  const company = doc?.company && typeof doc.company === 'object'
    ? {
        id: String(doc.company?._id || ''),
        name: mapName(doc.company),
      }
    : null;
  const product = doc?.product && typeof doc.product === 'object'
    ? {
        id: String(doc.product?._id || ''),
        code: sanitizeString(doc.product?.cod || doc.productCode),
        name: sanitizeString(doc.product?.nome || doc.productName),
        barcode: sanitizeString(doc.product?.codbarras || ''),
      }
    : {
        id: sanitizeString(doc?.product || ''),
        code: sanitizeString(doc?.productCode || ''),
        name: sanitizeString(doc?.productName || ''),
        barcode: '',
      };
  const user = doc?.user && typeof doc.user === 'object'
    ? {
        id: String(doc.user?._id || ''),
        name: mapName(doc.user, sanitizeString(doc?.userName)),
        email: sanitizeString(doc.user?.email || doc?.userEmail),
      }
    : {
        id: sanitizeString(doc?.user || ''),
        name: sanitizeString(doc?.userName || ''),
        email: sanitizeString(doc?.userEmail || ''),
      };
  const deposit = doc?.deposit && typeof doc.deposit === 'object'
    ? { id: String(doc.deposit?._id || ''), name: mapName(doc.deposit) }
    : (doc?.deposit ? { id: String(doc.deposit), name: '' } : null);
  const fromDeposit = doc?.fromDeposit && typeof doc.fromDeposit === 'object'
    ? { id: String(doc.fromDeposit?._id || ''), name: mapName(doc.fromDeposit) }
    : (doc?.fromDeposit ? { id: String(doc.fromDeposit), name: '' } : null);
  const toDeposit = doc?.toDeposit && typeof doc.toDeposit === 'object'
    ? { id: String(doc.toDeposit?._id || ''), name: mapName(doc.toDeposit) }
    : (doc?.toDeposit ? { id: String(doc.toDeposit), name: '' } : null);

  return {
    id: String(doc?._id || ''),
    movementDate: doc?.movementDate || doc?.createdAt || null,
    createdAt: doc?.createdAt || null,
    operation: sanitizeString(doc?.operation || ''),
    previousStock: Number(doc?.previousStock || 0),
    quantityDelta: Number(doc?.quantityDelta || 0),
    currentStock: Number(doc?.currentStock || 0),
    unitCost: doc?.unitCost === null || doc?.unitCost === undefined ? null : Number(doc.unitCost),
    totalValueDelta:
      doc?.totalValueDelta === null || doc?.totalValueDelta === undefined ? null : Number(doc.totalValueDelta),
    valueDirection: sanitizeString(doc?.valueDirection || ''),
    sourceModule: sanitizeString(doc?.sourceModule || ''),
    sourceScreen: sanitizeString(doc?.sourceScreen || ''),
    sourceAction: sanitizeString(doc?.sourceAction || ''),
    sourceType: sanitizeString(doc?.sourceType || ''),
    referenceDocument: sanitizeString(doc?.referenceDocument || ''),
    notes: sanitizeString(doc?.notes || ''),
    company,
    product,
    user,
    deposit,
    fromDeposit,
    toDeposit,
    metadata: doc?.metadata && typeof doc.metadata === 'object' ? doc.metadata : null,
  };
};

router.get('/support', requireAuth, authorizeRoles(...allowedRoles), async (_req, res) => {
  try {
    const [companies, deposits, users, screens] = await Promise.all([
      Store.find({}, { nome: 1, nomeFantasia: 1 }).sort({ nomeFantasia: 1, nome: 1 }).lean(),
      Deposit.find({}, { nome: 1, empresa: 1 }).sort({ nome: 1 }).lean(),
      User.find({ role: { $in: ['admin', 'admin_master', 'funcionario'] } }, {
        nomeCompleto: 1,
        apelido: 1,
        email: 1,
      }).sort({ nomeCompleto: 1, apelido: 1, email: 1 }).lean(),
      InventoryMovementLog.distinct('sourceScreen', { sourceScreen: { $nin: ['', null] } }),
    ]);

    return res.json({
      companies: companies.map((company) => ({
        id: String(company._id),
        name: mapName(company),
      })),
      deposits: deposits.map((deposit) => ({
        id: String(deposit._id),
        name: sanitizeString(deposit.nome),
        companyId: deposit.empresa ? String(deposit.empresa) : '',
      })),
      users: users.map((user) => ({
        id: String(user._id),
        name: mapName(user),
        email: sanitizeString(user.email || ''),
      })),
      screens: (Array.isArray(screens) ? screens : [])
        .map((item) => sanitizeString(item))
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b, 'pt-BR')),
    });
  } catch (error) {
    console.error('Erro ao carregar dados de apoio do histórico de estoque:', error);
    return res.status(500).json({ message: 'Não foi possível carregar os dados de apoio.' });
  }
});

router.get('/', requireAuth, authorizeRoles(...allowedRoles), async (req, res) => {
  try {
    const startDate = parseDateInput(sanitizeString(req.query.startDate));
    const endDate = parseDateInput(sanitizeString(req.query.endDate));
    const operation = sanitizeString(req.query.operation).toLowerCase();
    const company = toObjectIdOrNull(req.query.company);
    const deposit = toObjectIdOrNull(req.query.deposit);
    const product = toObjectIdOrNull(req.query.product);
    const user = toObjectIdOrNull(req.query.user);
    const sourceScreen = sanitizeString(req.query.sourceScreen);
    const sourceType = sanitizeString(req.query.sourceType);
    const search = sanitizeString(req.query.search);

    if (sanitizeString(req.query.startDate) && !startDate) {
      return res.status(400).json({ message: 'Data inicial inválida.' });
    }
    if (sanitizeString(req.query.endDate) && !endDate) {
      return res.status(400).json({ message: 'Data final inválida.' });
    }
    if (startDate && endDate && startDate > endDate) {
      return res.status(400).json({ message: 'Período inválido.' });
    }
    if (operation && !['entrada', 'saida', 'ajuste'].includes(operation)) {
      return res.status(400).json({ message: 'Operação inválida.' });
    }
    if (sanitizeString(req.query.company) && !company) {
      return res.status(400).json({ message: 'Empresa inválida.' });
    }
    if (sanitizeString(req.query.deposit) && !deposit) {
      return res.status(400).json({ message: 'Depósito inválido.' });
    }
    if (sanitizeString(req.query.product) && !product) {
      return res.status(400).json({ message: 'Produto inválido.' });
    }
    if (sanitizeString(req.query.user) && !user) {
      return res.status(400).json({ message: 'Usuário inválido.' });
    }

    const filters = {};
    const dateRange = buildDateRangeFilter(startDate, endDate);
    if (dateRange) filters.movementDate = dateRange;
    if (operation) filters.operation = operation;
    if (company) filters.company = company;
    if (deposit) filters.deposit = deposit;
    if (product) filters.product = product;
    if (user) filters.user = user;
    if (sourceScreen) filters.sourceScreen = sourceScreen;
    if (sourceType) filters.sourceType = sourceType;
    if (search) {
      const regex = new RegExp(escapeRegExp(search), 'i');
      filters.$or = [
        { productCode: regex },
        { productName: regex },
        { sourceScreen: regex },
        { sourceType: regex },
        { referenceDocument: regex },
        { notes: regex },
        { userName: regex },
        { userEmail: regex },
      ];
    }

    const limitParsed = Number.parseInt(req.query.limit, 10);
    const limit = Number.isFinite(limitParsed) ? Math.min(Math.max(limitParsed, 1), 300) : 100;
    const pageParsed = Number.parseInt(req.query.page, 10);
    const page = Number.isFinite(pageParsed) && pageParsed > 0 ? pageParsed : 1;
    const skip = (page - 1) * limit;

    const matchFilters = filters.$or ? { ...filters, $or: [...filters.$or] } : { ...filters };

    const [rows, total, summaryAgg] = await Promise.all([
      InventoryMovementLog.find(filters)
        .sort({ movementDate: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('company', { nome: 1, nomeFantasia: 1 })
        .populate('deposit', { nome: 1 })
        .populate('fromDeposit', { nome: 1 })
        .populate('toDeposit', { nome: 1 })
        .populate('product', { nome: 1, cod: 1, codbarras: 1 })
        .populate('user', { nomeCompleto: 1, apelido: 1, email: 1 })
        .lean(),
      InventoryMovementLog.countDocuments(filters),
      InventoryMovementLog.aggregate([
        { $match: matchFilters },
        {
          $group: {
            _id: null,
            totalMovements: { $sum: 1 },
            quantityAdded: {
              $sum: {
                $cond: [{ $gt: ['$quantityDelta', 0] }, '$quantityDelta', 0],
              },
            },
            quantityRemoved: {
              $sum: {
                $cond: [{ $lt: ['$quantityDelta', 0] }, { $abs: '$quantityDelta' }, 0],
              },
            },
            netQuantity: { $sum: '$quantityDelta' },
            valueAdded: {
              $sum: {
                $cond: [{ $gt: ['$totalValueDelta', 0] }, '$totalValueDelta', 0],
              },
            },
            valueRemoved: {
              $sum: {
                $cond: [{ $lt: ['$totalValueDelta', 0] }, { $abs: '$totalValueDelta' }, 0],
              },
            },
            netValue: { $sum: { $ifNull: ['$totalValueDelta', 0] } },
          },
        },
      ]),
    ]);

    const summaryDoc = Array.isArray(summaryAgg) ? summaryAgg[0] : null;
    const summary = {
      totalMovements: Number(summaryDoc?.totalMovements || 0),
      quantityAdded: Number(summaryDoc?.quantityAdded || 0),
      quantityRemoved: Number(summaryDoc?.quantityRemoved || 0),
      netQuantity: Number(summaryDoc?.netQuantity || 0),
      valueAdded: Number(summaryDoc?.valueAdded || 0),
      valueRemoved: Number(summaryDoc?.valueRemoved || 0),
      netValue: Number(summaryDoc?.netValue || 0),
    };

    const mapped = Array.isArray(rows) ? rows.map(mapMovement) : [];

    return res.json({
      movements: mapped,
      summary,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (error) {
    console.error('Erro ao consultar histórico de movimentação de estoque:', error);
    return res.status(500).json({ message: 'Não foi possível consultar o histórico de movimentação de estoque.' });
  }
});

router.get('/products', requireAuth, authorizeRoles(...allowedRoles), async (req, res) => {
  try {
    const search = sanitizeString(req.query.search);
    const limitParsed = Number.parseInt(req.query.limit, 10);
    const limit = Number.isFinite(limitParsed) ? Math.min(Math.max(limitParsed, 1), 50) : 20;
    const filters = {};
    if (search) {
      const regex = new RegExp(escapeRegExp(search), 'i');
      filters.$or = [{ nome: regex }, { cod: regex }, { codbarras: regex }];
    }
    const products = await Product.find(filters, { nome: 1, cod: 1, codbarras: 1 })
      .sort({ nome: 1 })
      .limit(limit)
      .lean();
    return res.json({
      products: products.map((product) => ({
        id: String(product._id),
        name: sanitizeString(product.nome),
        code: sanitizeString(product.cod),
        barcode: sanitizeString(product.codbarras),
      })),
    });
  } catch (error) {
    console.error('Erro ao consultar produtos para o histórico de estoque:', error);
    return res.status(500).json({ message: 'Não foi possível carregar os produtos.' });
  }
});

module.exports = router;
