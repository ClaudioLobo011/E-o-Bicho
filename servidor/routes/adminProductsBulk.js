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

const normalizeImagePath = (value) => {
  if (!value) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'object') {
    if (typeof value.path === 'string') return value.path.trim();
    if (typeof value.url === 'string') return value.url.trim();
  }
  return '';
};

const isValidImagePath = (value) => {
  const normalized = normalizeImagePath(value);
  if (!normalized) return false;
  const lower = normalized.toLowerCase();
  if (lower === '/image/placeholder.png') return false;
  if (lower.endsWith('/placeholder.png')) return false;
  if (lower.includes('placeholder')) return false;
  return true;
};

const parseNumber = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const parseDecimalString = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  const normalized = String(value).trim();
  if (!normalized) return null;
  let sanitized = normalized.replace(/\s+/g, '');
  if (sanitized.includes(',') && sanitized.includes('.')) {
    sanitized = sanitized.replace(/\./g, '').replace(',', '.');
  } else if (sanitized.includes(',')) {
    sanitized = sanitized.replace(',', '.');
  }
  const parsed = Number(sanitized);
  return Number.isFinite(parsed) ? parsed : null;
};

const normalizeBooleanFilter = (value) => {
  const normalized = normalizeString(value);
  if (!normalized) return null;
  const ascii = normalized
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  if (['sim', 's', 'true', '1'].includes(ascii)) return true;
  if (['nao', 'n', 'false', '0'].includes(ascii)) return false;
  return null;
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

    const columnFilters = {
      sku: normalizeString(req.query.col_sku),
      nome: normalizeString(req.query.col_nome),
      unidade: normalizeString(req.query.col_unidade),
      fornecedor: normalizeString(req.query.col_fornecedor),
      situacao: normalizeString(req.query.col_situacao),
      custo: normalizeString(req.query.col_custo),
      markup: normalizeString(req.query.col_markup),
      venda: normalizeString(req.query.col_venda),
      stock: normalizeString(req.query.col_stock),
      imagem: normalizeString(req.query.col_imagem),
    };

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

    if (columnFilters.sku) {
      andConditions.push({ cod: { $regex: new RegExp(escapeRegex(columnFilters.sku), 'i') } });
    }

    if (columnFilters.nome) {
      andConditions.push({ nome: { $regex: new RegExp(escapeRegex(columnFilters.nome), 'i') } });
    }

    if (columnFilters.unidade) {
      andConditions.push({ unidade: { $regex: new RegExp(escapeRegex(columnFilters.unidade), 'i') } });
    }

    if (columnFilters.fornecedor) {
      andConditions.push({ 'fornecedores.fornecedor': { $regex: new RegExp(escapeRegex(columnFilters.fornecedor), 'i') } });
    }

    if (columnFilters.situacao) {
      const normalizedSituacao = columnFilters.situacao.toLowerCase();
      if (normalizedSituacao === 'ativo') {
        filters.inativo = { $ne: true };
      } else if (normalizedSituacao === 'inativo') {
        filters.inativo = true;
      }
    }

    const columnCost = parseDecimalString(columnFilters.custo);
    if (columnCost !== null) {
      andConditions.push({ custo: columnCost });
    }

    const columnSale = parseDecimalString(columnFilters.venda);
    if (columnSale !== null) {
      andConditions.push({ venda: columnSale });
    }

    const columnStock = parseDecimalString(columnFilters.stock);
    if (columnStock !== null) {
      andConditions.push({ stock: columnStock });
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

    const pipeline = [{ $match: query }];

    pipeline.push({
      $addFields: {
        markup: {
          $cond: [
            {
              $and: [
                { $ne: ['$custo', null] },
                { $ne: ['$venda', null] },
                { $gt: ['$custo', 0] },
              ],
            },
            {
              $multiply: [
                {
                  $divide: [
                    { $subtract: ['$venda', '$custo'] },
                    '$custo',
                  ],
                },
                100,
              ],
            },
            null,
          ],
        },
        temImagem: {
          $let: {
            vars: {
              principal: { $ifNull: ['$imagemPrincipal', ''] },
              imagens: { $ifNull: ['$imagens', []] },
              driveImgs: { $ifNull: ['$driveImages', []] },
            },
            in: {
              $or: [
                {
                  $and: [
                    { $ne: ['$$principal', null] },
                    { $ne: ['$$principal', ''] },
                    {
                      $not: [
                        {
                          $regexMatch: {
                            input: { $toString: '$$principal' },
                            regex: 'placeholder',
                            options: 'i',
                          },
                        },
                      ],
                    },
                  ],
                },
                {
                  $gt: [
                    {
                      $size: {
                        $filter: {
                          input: '$$imagens',
                          as: 'img',
                          cond: {
                            $and: [
                              { $ne: ['$$img', null] },
                              { $ne: ['$$img', ''] },
                              {
                                $not: [
                                  {
                                    $regexMatch: {
                                      input: { $toString: '$$img' },
                                      regex: 'placeholder',
                                      options: 'i',
                                    },
                                  },
                                ],
                              },
                            ],
                          },
                        },
                      },
                    },
                    0,
                  ],
                },
                {
                  $gt: [
                    {
                      $size: {
                        $filter: {
                          input: '$$driveImgs',
                          as: 'drive',
                          cond: {
                            $or: [
                              {
                                $and: [
                                  { $ne: ['$$drive.fileId', null] },
                                  { $ne: ['$$drive.fileId', ''] },
                                ],
                              },
                              {
                                $and: [
                                  { $ne: ['$$drive.path', null] },
                                  { $ne: ['$$drive.path', ''] },
                                  {
                                    $not: [
                                      {
                                        $regexMatch: {
                                          input: { $toString: '$$drive.path' },
                                          regex: 'placeholder',
                                          options: 'i',
                                        },
                                      },
                                    ],
                                  },
                                ],
                              },
                              {
                                $and: [
                                  { $ne: ['$$drive.url', null] },
                                  { $ne: ['$$drive.url', ''] },
                                  {
                                    $not: [
                                      {
                                        $regexMatch: {
                                          input: { $toString: '$$drive.url' },
                                          regex: 'placeholder',
                                          options: 'i',
                                        },
                                      },
                                    ],
                                  },
                                ],
                              },
                            ],
                          },
                        },
                      },
                    },
                    0,
                  ],
                },
              ],
            },
          },
        },
      },
    });

    const markupFilterRaw = columnFilters.markup;
    if (markupFilterRaw) {
      const markupAsNumber = parseDecimalString(markupFilterRaw);
      if (markupAsNumber !== null) {
        const roundedTarget = Number(markupAsNumber.toFixed(2));
        pipeline.push({
          $match: {
            $expr: {
              $eq: [
                { $round: ['$markup', 2] },
                roundedTarget,
              ],
            },
          },
        });
      } else {
        const markupRegex = escapeRegex(markupFilterRaw);
        pipeline.push({
          $match: {
            $expr: {
              $regexMatch: {
                input: {
                  $toString: {
                    $cond: [
                      { $ne: ['$markup', null] },
                      { $round: ['$markup', 2] },
                      '',
                    ],
                  },
                },
                regex: markupRegex,
                options: 'i',
              },
            },
          },
        });
      }
    }

    const imagemFilter = normalizeBooleanFilter(columnFilters.imagem);
    if (imagemFilter === true) {
      pipeline.push({ $match: { temImagem: true } });
    } else if (imagemFilter === false) {
      pipeline.push({ $match: { temImagem: { $ne: true } } });
    }

    if (idsOnly) {
      const idsAggregation = Product.aggregate([
        ...pipeline,
        { $project: { _id: 1 } },
      ]).option({ allowDiskUse: true });
      const ids = await idsAggregation;
      const mappedIds = ids.map((product) => product._id.toString());
      return res.json({ ids: mappedIds, total: mappedIds.length });
    }

    const paginationPipeline = [
      ...pipeline,
      { $sort: { nome: 1, _id: 1 } },
      {
        $facet: {
          data: [
            { $skip: (page - 1) * limit },
            { $limit: limit },
          ],
          totalCount: [{ $count: 'count' }],
        },
      },
    ];

    const aggregation = await Product.aggregate(paginationPipeline).option({ allowDiskUse: true });
    const aggregationResult = Array.isArray(aggregation) && aggregation.length ? aggregation[0] : { data: [], totalCount: [] };
    const products = Array.isArray(aggregationResult.data) ? aggregationResult.data : [];
    const total = Array.isArray(aggregationResult.totalCount) && aggregationResult.totalCount.length
      ? aggregationResult.totalCount[0].count || 0
      : 0;

    const mapped = products.map((product) => {
      const saleValue = parseNumber(product.venda);
      const costValue = parseNumber(product.custo);
      let markup = null;
      if (costValue !== null && costValue > 0 && saleValue !== null) {
        const computed = ((saleValue - costValue) / costValue) * 100;
        markup = Number.isFinite(computed) ? computed : null;
      }

      const imagensVinculadas = Array.isArray(product.imagens)
        ? product.imagens
            .map((imagem) => normalizeImagePath(imagem))
            .filter((imagem) => isValidImagePath(imagem))
        : [];
      const imagemPrincipal = normalizeImagePath(product.imagemPrincipal);
      const driveImages = Array.isArray(product.driveImages)
        ? product.driveImages.filter((entry) => {
            if (!entry) return false;
            if (typeof entry === 'string') {
              return isValidImagePath(entry);
            }
            if (typeof entry === 'object') {
              if (typeof entry.fileId === 'string' && entry.fileId.trim()) {
                return true;
              }
              if (typeof entry.path === 'string' && isValidImagePath(entry.path)) {
                return true;
              }
              if (typeof entry.url === 'string' && isValidImagePath(entry.url)) {
                return true;
              }
            }
            return false;
          })
        : [];

      const temImagem =
        imagensVinculadas.length > 0 ||
        (imagemPrincipal && isValidImagePath(imagemPrincipal)) ||
        driveImages.length > 0;

      return {
        id: product._id.toString(),
        cod: product.cod || '',
        nome: product.nome || '',
        unidade: product.unidade || '',
        venda: saleValue || 0,
        custo: costValue || 0,
        markup,
        stock: parseNumber(product.stock) || 0,
        fornecedor: Array.isArray(product.fornecedores) && product.fornecedores.length
          ? product.fornecedores[0]?.fornecedor || ''
          : '',
        inativo: Boolean(product.inativo),
        naoMostrarNoSite: Boolean(product.naoMostrarNoSite),
        temImagem,
      };
    });

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

  const result = { updated: 0, errors: [] };

  try {
    const products = await Product.find({ _id: { $in: validIds } });
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
        await product.save();
        result.updated += 1;
      } catch (error) {
        result.errors.push({ id: product._id.toString(), message: error.message || 'Falha ao atualizar o produto.' });
      }
    }

    res.json(result);
  } catch (error) {
    console.error('Erro ao aplicar alterações em massa de produtos:', error);
    res.status(500).json({ message: 'Erro ao aplicar alterações em massa.' });
  }
});

module.exports = router;
