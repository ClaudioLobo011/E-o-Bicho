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
} = require('../utils/inventoryStock');

const router = express.Router();

const allowedRoles = ['admin', 'admin_master', 'funcionario'];

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

    const regex = new RegExp(escapeRegExp(term), 'i');
    const numericTerm = term.replace(/\D/g, '');
    const query = {
      $or: [
        { cod: regex },
        { codbarras: regex },
        { nome: regex },
      ],
    };

    if (numericTerm) {
      query.$or.push({ codbarras: new RegExp(escapeRegExp(numericTerm), 'i') });
    }

    const products = await Product.find(query, {
      cod: 1,
      codbarras: 1,
      nome: 1,
      unidade: 1,
      custo: 1,
    })
      .limit(20)
      .sort({ nome: 1 })
      .lean();

    res.json({ products });
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
    }).lean();

    if (products.length !== productIds.length) {
      return res.status(400).json({ message: 'Não foi possível localizar todos os produtos informados.' });
    }

    const productMap = new Map(products.map((product) => [String(product._id), product]));

    const creatorId = toObjectIdOrNull(req.user?.id);
    if (!creatorId) {
      return res.status(401).json({ message: 'Sessão expirada. Faça login novamente.' });
    }

    session = await mongoose.startSession();

    let adjustmentRecord = null;
    await session.withTransaction(async () => {
      const preparedItems = [];
      const factor = normalizedOperation === 'saida' ? -1 : 1;
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
        await adjustProductStockForDeposit({
          productId: rawItem.productId,
          depositId: deposit,
          quantity: delta,
          session,
          cascadeFractional: true,
        });

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

