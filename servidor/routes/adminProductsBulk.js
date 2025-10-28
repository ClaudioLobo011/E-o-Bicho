const express = require('express');
const mongoose = require('mongoose');
const Product = require('../models/Product');
const requireAuth = require('../middlewares/requireAuth');
const authorizeRoles = require('../middlewares/authorizeRoles');

const router = express.Router();

const FISCAL_STATUS_VALUES = new Set(['pendente', 'parcial', 'aprovado']);

const escapeRegex = (value = '') => {
  if (typeof value !== 'string') return '';
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

const normalizeString = (value) => {
  if (value === null || value === undefined) return '';
  return String(value).trim();
};

const normalizeDigits = (value) => normalizeString(value).replace(/\D+/g, '');

const parseNumber = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const ensureObjectId = (value) => {
  const normalized = normalizeString(value);
  if (!normalized) return null;
  return mongoose.Types.ObjectId.isValid(normalized) ? new mongoose.Types.ObjectId(normalized) : null;
};

const hasEnabledField = (updates = {}, key) => {
  const entry = updates[key];
  return entry && typeof entry === 'object' && entry.enabled === true;
};

const getFieldValue = (updates = {}, key) => {
  const entry = updates[key];
  return entry && typeof entry === 'object' ? entry.value : undefined;
};

router.get('/', requireAuth, authorizeRoles('funcionario', 'admin', 'admin_master'), async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 200);
    const idsOnly = String(req.query.idsOnly || '').toLowerCase() === 'true';

    const {
      sku,
      nome,
      barcode,
      unidade,
      referencia,
      tipoProduto,
      marca,
      categoria,
      fornecedor,
      situacao,
      estoqueMin,
      estoqueMax,
    } = req.query;

    const filters = {};
    const andConditions = [];

    if (sku) {
      filters.cod = { $regex: new RegExp(escapeRegex(sku), 'i') };
    }

    if (nome) {
      filters.nome = { $regex: new RegExp(escapeRegex(nome), 'i') };
    }

    if (barcode) {
      const safeBarcode = escapeRegex(barcode);
      andConditions.push({
        $or: [
          { codbarras: { $regex: new RegExp(safeBarcode, 'i') } },
          { codigosComplementares: { $regex: new RegExp(safeBarcode, 'i') } },
        ],
      });
    }

    if (unidade) {
      filters.unidade = unidade;
    }

    if (referencia) {
      filters.referencia = { $regex: new RegExp(escapeRegex(referencia), 'i') };
    }

    if (tipoProduto) {
      filters.tipoProduto = tipoProduto;
    }

    if (marca) {
      filters.marca = { $regex: new RegExp(escapeRegex(marca), 'i') };
    }

    if (categoria) {
      const categoryId = ensureObjectId(categoria);
      if (categoryId) {
        filters.categorias = { $in: [categoryId] };
      }
    }

    if (fornecedor) {
      andConditions.push({ 'fornecedores.fornecedor': { $regex: new RegExp(escapeRegex(fornecedor), 'i') } });
    }

    if (situacao === 'ativo') {
      filters.inativo = { $ne: true };
    } else if (situacao === 'inativo') {
      filters.inativo = true;
    }

    const minStock = parseNumber(estoqueMin);
    const maxStock = parseNumber(estoqueMax);
    if (minStock !== null) {
      filters.stock = { ...(filters.stock || {}), $gte: minStock };
    }
    if (maxStock !== null) {
      filters.stock = { ...(filters.stock || {}), $lte: maxStock };
    }

    const query = { ...filters };
    if (andConditions.length) {
      query.$and = andConditions;
    }

    if (idsOnly) {
      const ids = await Product.find(query).select('_id').lean();
      const mappedIds = ids.map((product) => product._id.toString());
      return res.json({ ids: mappedIds, total: mappedIds.length });
    }

    const [products, total] = await Promise.all([
      Product.find(query)
        .sort({ nome: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Product.countDocuments(query),
    ]);

    const mapped = products.map((product) => ({
      id: product._id.toString(),
      cod: product.cod || '',
      nome: product.nome || '',
      unidade: product.unidade || '',
      venda: parseNumber(product.venda) || 0,
      custo: parseNumber(product.custo) || 0,
      stock: parseNumber(product.stock) || 0,
      fornecedor: Array.isArray(product.fornecedores) && product.fornecedores.length
        ? product.fornecedores[0]?.fornecedor || ''
        : '',
      inativo: Boolean(product.inativo),
      naoMostrarNoSite: Boolean(product.naoMostrarNoSite),
    }));

    res.json({
      products: mapped,
      pagination: {
        page,
        limit,
        total,
        pages: Math.max(Math.ceil(total / limit), 1),
      },
    });
  } catch (error) {
    console.error('Erro ao filtrar produtos para alteração em massa:', error);
    res.status(500).json({ message: 'Erro ao buscar produtos.' });
  }
});

function applySupplierUpdate(product, payload = {}) {
  const supplierName = normalizeString(payload['supplier-name']);
  if (!supplierName) {
    throw new Error('Informe o nome do fornecedor para substituir.');
  }

  const supplierEntry = {
    fornecedor: supplierName,
    documentoFornecedor: normalizeDigits(payload['supplier-document']),
    nomeProdutoFornecedor: normalizeString(payload['supplier-product-name']),
    codigoProduto: normalizeString(payload['supplier-product-code']),
    unidadeEntrada: normalizeString(payload['supplier-entry-unit']),
    tipoCalculo: normalizeString(payload['supplier-calc-type']),
    valorCalculo: null,
  };

  const calcValue = parseNumber(payload['supplier-calc-value']);
  if (calcValue !== null) {
    supplierEntry.valorCalculo = calcValue;
  }

  if (!Array.isArray(product.fornecedores) || product.fornecedores.length === 0) {
    product.fornecedores = [supplierEntry];
    return;
  }

  product.fornecedores = product.fornecedores.slice();
  product.fornecedores[0] = {
    ...product.fornecedores[0],
    ...supplierEntry,
  };
}

function applyUpdatesToProduct(product, updates, user) {
  const costField = updates.custo;
  if (hasEnabledField(updates, 'custo')) {
    const value = parseNumber(costField.value);
    if (value === null || value < 0) {
      throw new Error('Informe um valor numérico válido para o preço de custo.');
    }
    product.custo = value;
  }

  const saleField = updates.venda;
  let saleFromMarkup = null;
  if (hasEnabledField(updates, 'markup')) {
    const markupValue = parseNumber(updates.markup.value);
    if (markupValue === null) {
      throw new Error('Informe um valor numérico válido para o markup.');
    }
    const effectiveCost = hasEnabledField(updates, 'custo') ? product.custo : parseNumber(product.custo) || 0;
    saleFromMarkup = effectiveCost * (1 + markupValue / 100);
    if (!Number.isFinite(saleFromMarkup)) {
      throw new Error('Não foi possível calcular o preço de venda a partir do markup informado.');
    }
    product.venda = saleFromMarkup;
  }

  if (hasEnabledField(updates, 'venda')) {
    const saleValue = parseNumber(saleField.value);
    if (saleValue === null || saleValue < 0) {
      throw new Error('Informe um valor numérico válido para o preço de venda.');
    }
    product.venda = saleValue;
  }

  if (hasEnabledField(updates, 'marca')) {
    product.marca = normalizeString(getFieldValue(updates, 'marca'));
  }

  if (hasEnabledField(updates, 'especificacoes.apresentacao')) {
    product.especificacoes = product.especificacoes && typeof product.especificacoes === 'object'
      ? product.especificacoes
      : {};
    product.especificacoes.apresentacao = normalizeString(getFieldValue(updates, 'especificacoes.apresentacao'));
  }

  if (hasEnabledField(updates, 'inativo')) {
    product.inativo = Boolean(getFieldValue(updates, 'inativo'));
  }

  if (hasEnabledField(updates, 'peso')) {
    const pesoValue = parseNumber(getFieldValue(updates, 'peso'));
    if (pesoValue !== null && pesoValue < 0) {
      throw new Error('O peso não pode ser negativo.');
    }
    product.peso = pesoValue;
  }

  if (hasEnabledField(updates, 'iat')) {
    product.iat = normalizeString(getFieldValue(updates, 'iat'));
  }

  if (hasEnabledField(updates, 'tipoProduto')) {
    product.tipoProduto = normalizeString(getFieldValue(updates, 'tipoProduto'));
  }

  if (hasEnabledField(updates, 'stock')) {
    const stockValue = parseNumber(getFieldValue(updates, 'stock'));
    if (stockValue === null || stockValue < 0) {
      throw new Error('Informe um valor válido para o saldo em estoque.');
    }
    product.stock = stockValue;
  }

  if (hasEnabledField(updates, 'categorias')) {
    const rawCategories = Array.isArray(getFieldValue(updates, 'categorias'))
      ? getFieldValue(updates, 'categorias')
      : [];
    const categoryIds = rawCategories
      .map(ensureObjectId)
      .filter(Boolean);
    product.categorias = categoryIds;
  }

  if (hasEnabledField(updates, 'especificacoes.idade') || hasEnabledField(updates, 'especificacoes.pet') || hasEnabledField(updates, 'especificacoes.porteRaca')) {
    product.especificacoes = product.especificacoes && typeof product.especificacoes === 'object'
      ? { ...product.especificacoes }
      : { idade: [], pet: [], porteRaca: [] };

    if (hasEnabledField(updates, 'especificacoes.idade')) {
      const values = Array.isArray(getFieldValue(updates, 'especificacoes.idade'))
        ? getFieldValue(updates, 'especificacoes.idade')
        : [];
      product.especificacoes.idade = values.map((value) => normalizeString(value)).filter(Boolean);
    }

    if (hasEnabledField(updates, 'especificacoes.pet')) {
      const values = Array.isArray(getFieldValue(updates, 'especificacoes.pet'))
        ? getFieldValue(updates, 'especificacoes.pet')
        : [];
      product.especificacoes.pet = values.map((value) => normalizeString(value)).filter(Boolean);
    }

    if (hasEnabledField(updates, 'especificacoes.porteRaca')) {
      const values = Array.isArray(getFieldValue(updates, 'especificacoes.porteRaca'))
        ? getFieldValue(updates, 'especificacoes.porteRaca')
        : [];
      product.especificacoes.porteRaca = values.map((value) => normalizeString(value)).filter(Boolean);
    }
  }

  if (hasEnabledField(updates, 'descricao')) {
    const rawDescription = getFieldValue(updates, 'descricao');
    product.descricao = typeof rawDescription === 'string' ? rawDescription : '';
  }

  if (hasEnabledField(updates, 'naoMostrarNoSite')) {
    product.naoMostrarNoSite = Boolean(getFieldValue(updates, 'naoMostrarNoSite'));
  }

  if (hasEnabledField(updates, 'ncm')) {
    product.ncm = normalizeString(getFieldValue(updates, 'ncm'));
  }

  let fiscalTouched = false;
  product.fiscal = product.fiscal && typeof product.fiscal === 'object' ? { ...product.fiscal } : {};

  if (hasEnabledField(updates, 'fiscal.cest')) {
    product.fiscal.cest = normalizeString(getFieldValue(updates, 'fiscal.cest'));
    fiscalTouched = true;
  }

  if (hasEnabledField(updates, 'fiscal.origem')) {
    product.fiscal.origem = normalizeString(getFieldValue(updates, 'fiscal.origem')) || '0';
    fiscalTouched = true;
  }

  if (hasEnabledField(updates, 'fiscal.csosn')) {
    product.fiscal.csosn = normalizeString(getFieldValue(updates, 'fiscal.csosn'));
    fiscalTouched = true;
  }

  if (hasEnabledField(updates, 'fiscal.cst')) {
    product.fiscal.cst = normalizeString(getFieldValue(updates, 'fiscal.cst'));
    fiscalTouched = true;
  }

  if (hasEnabledField(updates, 'fiscal.status.nfe')) {
    const value = normalizeString(getFieldValue(updates, 'fiscal.status.nfe')).toLowerCase();
    if (!FISCAL_STATUS_VALUES.has(value)) {
      throw new Error('Status NF-e inválido.');
    }
    product.fiscal.status = product.fiscal.status && typeof product.fiscal.status === 'object'
      ? { ...product.fiscal.status }
      : {};
    product.fiscal.status.nfe = value;
    fiscalTouched = true;
  }

  if (hasEnabledField(updates, 'fiscal.status.nfce')) {
    const value = normalizeString(getFieldValue(updates, 'fiscal.status.nfce')).toLowerCase();
    if (!FISCAL_STATUS_VALUES.has(value)) {
      throw new Error('Status NFC-e inválido.');
    }
    product.fiscal.status = product.fiscal.status && typeof product.fiscal.status === 'object'
      ? { ...product.fiscal.status }
      : {};
    product.fiscal.status.nfce = value;
    fiscalTouched = true;
  }

  if (hasEnabledField(updates, 'fornecedor')) {
    applySupplierUpdate(product, getFieldValue(updates, 'fornecedor'));
  }

  if (fiscalTouched) {
    product.fiscal.atualizadoEm = new Date();
    product.fiscal.atualizadoPor = normalizeString(user?.email);
  }
}

router.put('/', requireAuth, authorizeRoles('admin', 'admin_master'), async (req, res) => {
  const { productIds, updates } = req.body || {};

  if (!Array.isArray(productIds) || productIds.length === 0) {
    return res.status(400).json({ message: 'Nenhum produto selecionado para atualização.' });
  }

  if (!updates || typeof updates !== 'object') {
    return res.status(400).json({ message: 'Nenhuma alteração informada.' });
  }

  const uniqueIds = Array.from(new Set(productIds));
  const validIds = uniqueIds
    .map((id) => ensureObjectId(id))
    .filter(Boolean);

  if (!validIds.length) {
    return res.status(400).json({ message: 'Os identificadores dos produtos são inválidos.' });
  }

  const session = await mongoose.startSession();
  const result = { updated: 0, errors: [] };

  try {
    await session.withTransaction(async () => {
      const products = await Product.find({ _id: { $in: validIds } }).session(session);
      const foundIds = new Set(products.map((product) => product._id.toString()));
      validIds.forEach((objectId) => {
        const stringId = objectId.toString();
        if (!foundIds.has(stringId)) {
          result.errors.push({ id: stringId, message: 'Produto não encontrado.' });
        }
      });
      for (const product of products) {
        try {
          applyUpdatesToProduct(product, updates, req.user || {});
          await product.save({ session });
          result.updated += 1;
        } catch (error) {
          result.errors.push({ id: product._id.toString(), message: error.message || 'Falha ao atualizar o produto.' });
        }
      }
    });

    res.json(result);
  } catch (error) {
    console.error('Erro ao aplicar alterações em massa de produtos:', error);
    res.status(500).json({ message: 'Erro ao aplicar alterações em massa.' });
  } finally {
    session.endSession();
  }
});

module.exports = router;
