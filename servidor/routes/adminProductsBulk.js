const express = require('express');
const mongoose = require('mongoose');
const XLSX = require('xlsx');
const Product = require('../models/Product');
const Store = require('../models/Store');
const FiscalDefaultRule = require('../models/FiscalDefaultRule');
const { normalizeFiscalData } = require('../services/fiscalRuleEngine');
const requireAuth = require('../middlewares/requireAuth');
const authorizeRoles = require('../middlewares/authorizeRoles');
const { logInventoryMovement } = require('../utils/inventoryMovementLogger');

const router = express.Router();

const DEFAULT_COLLATION = { locale: 'pt', strength: 1 };

const FISCAL_STATUS_VALUES = new Set(['pendente', 'parcial', 'aprovado']);

const escapeRegex = (value = '') => {
  if (typeof value !== 'string') return '';
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

const buildWildcardRegex = (value = '') => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const pattern = trimmed
    .split('*')
    .map((segment) => escapeRegex(segment))
    .join('.*');
  return new RegExp(pattern, 'i');
};

const normalizeString = (value) => {
  if (value === null || value === undefined) return '';
  return String(value).trim();
};

const normalizeForSearch = (value = '') => {
  if (typeof value !== 'string') return '';
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[ç]/gi, 'c')
    .toLowerCase()
    .trim();
};

const normalizeDigits = (value) => normalizeString(value).replace(/\D+/g, '');

const toPlainObject = (value) => {
  if (!value) return {};
  if (typeof value.toObject === 'function') return value.toObject();
  if (value instanceof Map) {
    const out = {};
    value.forEach((v, k) => { out[String(k)] = v; });
    return out;
  }
  if (typeof value === 'object') return { ...value };
  return {};
};

const stripFiscalMeta = (fiscal) => {
  const source = fiscal && typeof fiscal === 'object' ? fiscal : {};
  const cloned = JSON.parse(JSON.stringify(source));
  delete cloned.atualizadoEm;
  delete cloned.atualizadoPor;
  return cloned;
};

const normalizeFiscalPerStoreForResponse = (value) => {
  const plain = toPlainObject(value);
  const result = {};
  Object.entries(plain).forEach(([storeId, fiscal]) => {
    const key = normalizeString(storeId);
    if (!key) return;
    result[key] = stripFiscalMeta(fiscal);
  });
  return result;
};
const isLikelyObjectId = (value = '') => /^[a-f\d]{24}$/i.test(normalizeString(value));

const stableStringify = (value) => {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) {
    return '[' + value.map((item) => stableStringify(item)).join(',') + ']';
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return '{' + keys.map((key) => JSON.stringify(key) + ':' + stableStringify(value[key])).join(',') + '}';
  }
  return JSON.stringify(value);
};

const buildFiscalSignature = (fiscal) => stableStringify(stripFiscalMeta(normalizeFiscalData(fiscal || {})));

const collectFiscalStoreIdsFromProducts = (products = []) => {
  const ids = new Set();
  products.forEach((product) => {
    const fiscalByStore = toPlainObject(product?.fiscalPorEmpresa);
    Object.keys(fiscalByStore || {}).forEach((storeId) => {
      const normalizedStoreId = normalizeString(storeId);
      if (normalizedStoreId) ids.add(normalizedStoreId);
    });
  });
  return Array.from(ids);
};

const buildFiscalRuleLookupByStore = async (products = []) => {
  const storeIds = collectFiscalStoreIdsFromProducts(products);
  const lookupByStore = new Map();
  if (!storeIds.length) return lookupByStore;

  const storeObjectIds = storeIds
    .map((value) => ensureObjectId(value))
    .filter(Boolean);
  if (!storeObjectIds.length) return lookupByStore;

  const rules = await FiscalDefaultRule.find({ empresa: { $in: storeObjectIds } })
    .select({ empresa: 1, code: 1, name: 1, fiscal: 1 })
    .lean();

  rules.forEach((rule) => {
    const storeId = extractId(rule?.empresa);
    if (!storeId) return;
    if (!lookupByStore.has(storeId)) {
      lookupByStore.set(storeId, new Map());
    }
    const code = Number(rule?.code);
    const name = normalizeString(rule?.name);
    const label = Number.isFinite(code) && code > 0
      ? `${code} - ${name || 'Regra sem nome'}`
      : (name || 'Regra sem nome');
    const signature = buildFiscalSignature(rule?.fiscal || {});
    lookupByStore.get(storeId).set(signature, label);
  });

  return lookupByStore;
};

const resolveFiscalRuleLabelsByStore = (fiscalByStore = {}, lookupByStore = new Map()) => {
  const resolved = {};
  Object.entries(fiscalByStore || {}).forEach(([storeId, fiscal]) => {
    const normalizedStoreId = normalizeString(storeId);
    if (!normalizedStoreId) return;
    if (!fiscal || typeof fiscal !== 'object') {
      resolved[normalizedStoreId] = '-';
      return;
    }

    const storeLookup = lookupByStore.get(normalizedStoreId);
    if (!(storeLookup instanceof Map)) {
      resolved[normalizedStoreId] = 'Regra configurada';
      return;
    }
    const signature = buildFiscalSignature(fiscal);
    resolved[normalizedStoreId] = storeLookup.get(signature) || 'Regra customizada';
  });
  return resolved;
};
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
  if (lower === '/image/placeholder.svg') return false;
  if (lower.endsWith('/placeholder.svg')) return false;
  if (lower.includes('placeholder')) return false;
  return true;
};

const parseNumber = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const parsePositiveInt = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
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

const extractId = (doc) => {
  if (!doc) return '';
  const raw = doc._id !== undefined ? doc._id : doc.id;
  if (!raw) return '';
  if (typeof raw === 'string') return raw;
  if (raw instanceof mongoose.Types.ObjectId) return raw.toString();
  if (typeof raw.toString === 'function') return raw.toString();
  return String(raw);
};

const extractBarcodeValue = (entry) => {
  if (entry === null || entry === undefined) return '';
  if (typeof entry === 'string' || typeof entry === 'number') {
    return normalizeString(entry);
  }
  if (typeof entry === 'object') {
    const candidate =
      entry.codigo ??
      entry.codbarras ??
      entry.barcode ??
      entry.gtin ??
      entry.value;
    return normalizeString(candidate);
  }
  return '';
};
const collectProductBarcodes = (product = {}) => {
  const unique = new Set();
  const add = (value) => {
    const normalized = normalizeString(value);
    if (normalized) unique.add(normalized);
  };
  add(product.codbarras);
  if (Array.isArray(product.codigosComplementares)) {
    product.codigosComplementares.forEach((entry) => {
      add(extractBarcodeValue(entry));
    });
  }
  return Array.from(unique);
};

const mapProductForResponse = (productDoc, fiscalRuleLookupByStore = new Map()) => {
  const product = productDoc && typeof productDoc === 'object' ? productDoc : {};

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

  const codbarrasDisplay = collectProductBarcodes(product).join(' | ');
  const promotionActive = Boolean(product?.promocao?.ativa);
  const promotionPercent = parseNumber(product?.promocao?.porcentagem);
  let promotionalPrice = null;
  if (promotionActive && saleValue !== null && promotionPercent !== null && promotionPercent > 0) {
    const calculated = saleValue * (1 - (promotionPercent / 100));
    promotionalPrice = Number.isFinite(calculated) ? calculated : null;
  }

  
  const fiscalPorEmpresa = normalizeFiscalPerStoreForResponse(product.fiscalPorEmpresa);
  const fiscalRegraPorEmpresa = resolveFiscalRuleLabelsByStore(fiscalPorEmpresa, fiscalRuleLookupByStore);

  return {
    id: extractId(product),
    cod: product.cod || '',
    codbarras: codbarrasDisplay || '',
    nome: product.nome || '',
    marca: normalizeString(product.marca),
    apresentacao: normalizeString(product?.especificacoes?.apresentacao),
    peso: parseNumber(product.peso),
    iat: normalizeString(product.iat),
    tipoProduto: normalizeString(product.tipoProduto),
    categorias: Array.isArray(product.categorias) ? product.categorias.map((c) => { const name = normalizeString(c && typeof c === 'object' && !(c instanceof mongoose.Types.ObjectId) ? (c.nome || c.name) : ''); if (name) return name; const fallback = normalizeString(c); return isLikelyObjectId(fallback) ? '' : fallback; }).filter(Boolean).join(' | ') : '',
    idade: Array.isArray(product?.especificacoes?.idade) ? product.especificacoes.idade.map((v) => normalizeString(v)).filter(Boolean).join(' | ') : '',
    especie: Array.isArray(product?.especificacoes?.pet) ? product.especificacoes.pet.map((v) => normalizeString(v)).filter(Boolean).join(' | ') : '',
    porte: Array.isArray(product?.especificacoes?.porteRaca) ? product.especificacoes.porteRaca.map((v) => normalizeString(v)).filter(Boolean).join(' | ') : '',
    castrado: normalizeString(product?.especificacoes?.castracao),
    unidade: product.unidade || '',
    venda: saleValue || 0,
    custo: costValue || 0,
    markup,
    promocao: promotionalPrice,
    stock: parseNumber(product.stock) || 0,
    fornecedor:
      Array.isArray(product.fornecedores) && product.fornecedores.length
        ? product.fornecedores[0]?.fornecedor || ''
        : '',
    inativo: Boolean(product.inativo),
    naoMostrarNoSite: Boolean(product.naoMostrarNoSite),
    temImagem,
    fiscalPorEmpresa,
    fiscalRegraPorEmpresa,
  };
};

const SORTABLE_COLUMNS = {
  sku: { sortField: 'cod' },
  barcode: { sortField: 'codbarras' },
  nome: { sortField: 'nome' },
  marca: { sortField: 'marca' },
  apresentacao: { sortField: 'especificacoes.apresentacao' },
  peso: { sortField: 'peso' },
  iat: { sortField: 'iat' },
  tipoProduto: { sortField: 'tipoProduto' },
  categorias: { sortField: 'categorias' },
  idade: { sortField: 'especificacoes.idade' },
  especie: { sortField: 'especificacoes.pet' },
  porte: { sortField: 'especificacoes.porteRaca' },
  castrado: { sortField: 'especificacoes.castracao' },
  unidade: { sortField: 'unidade' },
  fornecedor: { sortField: 'fornecedores.0.fornecedor' },
  situacao: { sortField: 'inativo' },
  custo: { sortField: 'custo' },
  markup: { sortField: 'markup', requiresAggregation: true },
  venda: { sortField: 'venda' },
  stock: { sortField: 'stock' },
  imagem: { sortField: 'temImagem', requiresAggregation: true },
};

const resolveSortConfig = (key = '') => {
  if (!key) return null;
  const normalized = key.trim().toLowerCase();
  if (!normalized) return null;
  const config = SORTABLE_COLUMNS[normalized];
  if (!config) return null;
  return { key: normalized, ...config };
};

const buildSortStage = (config, direction) => {
  const sortDirection = direction === -1 ? -1 : 1;
  const stage = {};

  if (config && config.sortField) {
    stage[config.sortField] = sortDirection;
  } else {
    stage.nome = 1;
  }

  if (!stage.nome && (!config || config.sortField !== 'nome')) {
    stage.nome = 1;
  }

  stage._id = 1;

  return stage;
};

const buildAggregationProjection = () => ({
  _id: 1,
  nome: 1,
  cod: 1,
  codbarras: 1,
  marca: 1,
  categorias: 1,
  especificacoes: {
    apresentacao: '$especificacoes.apresentacao',
    idade: '$especificacoes.idade',
    pet: '$especificacoes.pet',
    porteRaca: '$especificacoes.porteRaca',
    castracao: '$especificacoes.castracao',
  },
  peso: 1,
  iat: 1,
  tipoProduto: 1,
  unidade: 1,
  inativo: 1,
  custo: 1,
  markup: 1,
  venda: 1,
  stock: 1,
  temImagem: 1,
  fiscalPorEmpresa: 1,
  fornecedores: {
    $map: {
      input: {
        $slice: [
          {
            $cond: [
              { $isArray: '$fornecedores' },
              '$fornecedores',
              [],
            ],
          },
          1,
        ],
      },
      as: 'supplier',
      in: {
        fornecedor: '$$supplier.fornecedor',
      },
    },
  },
});

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
      ifood,
      estoqueMin,
      estoqueMax,
    } = req.query;

    const columnFilters = {
      sku: normalizeString(req.query.col_sku),
      barcode: normalizeString(req.query.col_barcode),
      nome: normalizeString(req.query.col_nome),
      marca: normalizeString(req.query.col_marca),
      apresentacao: normalizeString(req.query.col_apresentacao),
      peso: normalizeString(req.query.col_peso),
      iat: normalizeString(req.query.col_iat),
      tipoProduto: normalizeString(req.query.col_tipo_produto),
      categorias: normalizeString(req.query.col_categorias),
      idade: normalizeString(req.query.col_idade),
      especie: normalizeString(req.query.col_especie),
      porte: normalizeString(req.query.col_porte),
      castrado: normalizeString(req.query.col_castrado),
      unidade: normalizeString(req.query.col_unidade),
      fornecedor: normalizeString(req.query.col_fornecedor),
      situacao: normalizeString(req.query.col_situacao),
      custo: normalizeString(req.query.col_custo),
      markup: normalizeString(req.query.col_markup),
      venda: normalizeString(req.query.col_venda),
      stock: normalizeString(req.query.col_stock),
      imagem: normalizeString(req.query.col_imagem),
    };

    const sortKeyRaw = normalizeString(req.query.sortKey);
    const sortDirectionRaw = normalizeString(req.query.sortDirection).toLowerCase();
    const sortConfig = resolveSortConfig(sortKeyRaw);
    const sortDirection = sortDirectionRaw === 'desc' ? -1 : 1;
    const requiresComputedSort = Boolean(sortConfig?.requiresAggregation);
    const hasExplicitSort = Boolean(sortConfig);
    const sortStage = buildSortStage(sortConfig, sortDirection);

    const filters = {};
    const andConditions = [];

    if (sku) {
      filters.cod = { $regex: new RegExp(escapeRegex(sku), 'i') };
    }

    if (nome) {
      const nomeRegex = buildWildcardRegex(nome) || new RegExp(escapeRegex(nome), 'i');
      const normalizedNome = normalizeForSearch(nome);
      const normalizedNomeRegex = normalizedNome
        ? buildWildcardRegex(normalizedNome) || new RegExp(escapeRegex(normalizedNome), 'i')
        : null;

      const nomeConditions = [];
      if (nomeRegex) {
        nomeConditions.push({ nome: { $regex: nomeRegex } });
      }
      if (normalizedNomeRegex) {
        nomeConditions.push({ searchableString: { $regex: normalizedNomeRegex } });
      }

      if (nomeConditions.length === 1) {
        const [singleCondition] = nomeConditions;
        const [[field, matcher]] = Object.entries(singleCondition);
        filters[field] = matcher;
      } else if (nomeConditions.length > 1) {
        andConditions.push({ $or: nomeConditions });
      }
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

    if (ifood === 'ativo') {
      filters.enviarParaIfood = true;
    } else if (ifood === 'inativo') {
      filters.enviarParaIfood = { $ne: true };
    }

    if (columnFilters.sku) {
      andConditions.push({ cod: { $regex: new RegExp(escapeRegex(columnFilters.sku), 'i') } });
    }

    if (columnFilters.barcode) {
      const barcodeRegex = new RegExp(escapeRegex(columnFilters.barcode), 'i');
      andConditions.push({
        $or: [
          { codbarras: { $regex: barcodeRegex } },
          { codigosComplementares: { $regex: barcodeRegex } },
        ],
      });
    }

    if (columnFilters.nome) {
      const columnNomeRegex =
        buildWildcardRegex(columnFilters.nome) || new RegExp(escapeRegex(columnFilters.nome), 'i');
      const columnNormalizedNome = normalizeForSearch(columnFilters.nome);
      const columnNormalizedRegex = columnNormalizedNome
        ? buildWildcardRegex(columnNormalizedNome) || new RegExp(escapeRegex(columnNormalizedNome), 'i')
        : null;

      const columnConditions = [];
      if (columnNomeRegex) {
        columnConditions.push({ nome: { $regex: columnNomeRegex } });
      }
      if (columnNormalizedRegex) {
        columnConditions.push({ searchableString: { $regex: columnNormalizedRegex } });
      }

      if (columnConditions.length === 1) {
        andConditions.push(columnConditions[0]);
      } else if (columnConditions.length > 1) {
        andConditions.push({ $or: columnConditions });
      }
    }

    if (columnFilters.marca) {
      andConditions.push({ marca: { $regex: new RegExp(escapeRegex(columnFilters.marca), 'i') } });
    }

    if (columnFilters.apresentacao) {
      andConditions.push({ 'especificacoes.apresentacao': { $regex: new RegExp(escapeRegex(columnFilters.apresentacao), 'i') } });
    }

    const columnWeight = parseDecimalString(columnFilters.peso);
    if (columnWeight !== null) {
      andConditions.push({ peso: columnWeight });
    }

    if (columnFilters.iat) {
      andConditions.push({ iat: { $regex: new RegExp(escapeRegex(columnFilters.iat), 'i') } });
    }

    if (columnFilters.tipoProduto) {
      andConditions.push({ tipoProduto: { $regex: new RegExp(escapeRegex(columnFilters.tipoProduto), 'i') } });
    }

    if (columnFilters.categorias) {
      andConditions.push({ categorias: { $elemMatch: { $regex: new RegExp(escapeRegex(columnFilters.categorias), 'i') } } });
    }

    if (columnFilters.idade) {
      andConditions.push({ 'especificacoes.idade': { $regex: new RegExp(escapeRegex(columnFilters.idade), 'i') } });
    }

    if (columnFilters.especie) {
      andConditions.push({ 'especificacoes.pet': { $regex: new RegExp(escapeRegex(columnFilters.especie), 'i') } });
    }

    if (columnFilters.porte) {
      andConditions.push({ 'especificacoes.porteRaca': { $regex: new RegExp(escapeRegex(columnFilters.porte), 'i') } });
    }

    if (columnFilters.castrado) {
      andConditions.push({ 'especificacoes.castracao': { $regex: new RegExp(escapeRegex(columnFilters.castrado), 'i') } });
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

    const markupFilterRaw = columnFilters.markup;
    const imagemFilter = normalizeBooleanFilter(columnFilters.imagem);
    const requiresComputedFilters = Boolean(markupFilterRaw) || imagemFilter !== null;

    if (idsOnly && !requiresComputedFilters && !requiresComputedSort && !hasExplicitSort) {
      const idsDocs = await Product.find(query)
        .collation(DEFAULT_COLLATION)
        .select({ _id: 1 })
        .lean();
      const mappedIds = idsDocs.map((product) => extractId(product)).filter(Boolean);
      return res.json({ ids: mappedIds, total: mappedIds.length });
    }

    const canUseSimpleQuery = !requiresComputedFilters && !requiresComputedSort && !idsOnly;

    if (canUseSimpleQuery) {
      const [productsDocs, total] = await Promise.all([
        Product.find(query)
          .collation(DEFAULT_COLLATION)
          .sort(sortStage)
          .skip((page - 1) * limit)
          .limit(limit)
          .allowDiskUse(true)
          .populate({ path: 'categorias', select: 'nome' })
          .lean(),
        Product.countDocuments(query).collation(DEFAULT_COLLATION),
      ]);

      const fiscalRuleLookupByStore = await buildFiscalRuleLookupByStore(productsDocs);
      const mappedProducts = productsDocs.map((product) => mapProductForResponse(product, fiscalRuleLookupByStore));

      return res.json({
        products: mappedProducts,
        pagination: {
          page,
          limit,
          total,
          pages: total > 0 ? Math.ceil(total / limit) : 1,
        },
      });
    }

    const pipeline = [{ $match: query }];

    if (requiresComputedFilters || requiresComputedSort) {
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
    }

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

    if (imagemFilter === true) {
      pipeline.push({ $match: { temImagem: true } });
    } else if (imagemFilter === false) {
      pipeline.push({ $match: { temImagem: { $ne: true } } });
    }

    pipeline.push({ $project: buildAggregationProjection() });

    if (idsOnly) {
      const idsAggregation = Product.aggregate([
        ...pipeline,
        { $sort: { ...sortStage } },
        { $project: { _id: 1 } },
      ])
        .collation(DEFAULT_COLLATION)
        .allowDiskUse(true);
      const idsAggregationResult = await idsAggregation.exec();
      const mappedIds = idsAggregationResult.map((product) => extractId(product)).filter(Boolean);
      return res.json({ ids: mappedIds, total: mappedIds.length });
    }

    const paginationPipeline = [
      ...pipeline,
      { $sort: { ...sortStage } },
      {
        $facet: {
          ids: [
            { $skip: (page - 1) * limit },
            { $limit: limit },
            { $project: { _id: 1 } },
          ],
          totalCount: [{ $count: 'count' }],
        },
      },
    ];

    const aggregationCursor = Product.aggregate(paginationPipeline)
      .collation(DEFAULT_COLLATION)
      .allowDiskUse(true);
    const aggregation = await aggregationCursor.exec();
    const aggregationResult =
      Array.isArray(aggregation) && aggregation.length ? aggregation[0] : { ids: [], totalCount: [] };
    const idEntries = Array.isArray(aggregationResult.ids) ? aggregationResult.ids : [];
    const ids = idEntries.map((entry) => extractId(entry)).filter(Boolean);
    const idsForQuery = ids
      .map((id) => (mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : id))
      .filter(Boolean);
    const productsDocs = ids.length
      ? await Product.find({ _id: { $in: idsForQuery } })
          .collation(DEFAULT_COLLATION)
          .populate({ path: 'categorias', select: 'nome' })
          .lean()
      : [];
    const docsById = new Map(productsDocs.map((doc) => [extractId(doc), doc]));
    const orderedProducts = ids.map((id) => docsById.get(id)).filter(Boolean);
    const total = Array.isArray(aggregationResult.totalCount) && aggregationResult.totalCount.length
      ? aggregationResult.totalCount[0].count || 0
      : 0;

    const mapped = orderedProducts.map((product) => mapProductForResponse(product));

    res.json({
      products: mapped,
      pagination: {
        page,
        limit,
        total,
        pages: total > 0 ? Math.ceil(total / limit) : 1,
      },
    });
  } catch (error) {
    console.error('Erro ao filtrar produtos para alteração em massa:', error);
    res.status(500).json({ message: 'Erro ao buscar produtos.' });
  }
});

router.get(
  '/export/excel',
  requireAuth,
  authorizeRoles('funcionario', 'admin', 'admin_master'),
  async (req, res) => {
    try {
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
        barcode: normalizeString(req.query.col_barcode),
        nome: normalizeString(req.query.col_nome),
        marca: normalizeString(req.query.col_marca),
        apresentacao: normalizeString(req.query.col_apresentacao),
        peso: normalizeString(req.query.col_peso),
        iat: normalizeString(req.query.col_iat),
        tipoProduto: normalizeString(req.query.col_tipo_produto),
        categorias: normalizeString(req.query.col_categorias),
        idade: normalizeString(req.query.col_idade),
        especie: normalizeString(req.query.col_especie),
        porte: normalizeString(req.query.col_porte),
        castrado: normalizeString(req.query.col_castrado),
        unidade: normalizeString(req.query.col_unidade),
        fornecedor: normalizeString(req.query.col_fornecedor),
        situacao: normalizeString(req.query.col_situacao),
        custo: normalizeString(req.query.col_custo),
        markup: normalizeString(req.query.col_markup),
        venda: normalizeString(req.query.col_venda),
        stock: normalizeString(req.query.col_stock),
        imagem: normalizeString(req.query.col_imagem),
      };

      const sortKeyRaw = normalizeString(req.query.sortKey);
      const sortDirectionRaw = normalizeString(req.query.sortDirection).toLowerCase();
      const sortConfig = resolveSortConfig(sortKeyRaw);
      const sortDirection = sortDirectionRaw === 'desc' ? -1 : 1;
      const requiresComputedSort = Boolean(sortConfig?.requiresAggregation);
      const sortStage = buildSortStage(sortConfig, sortDirection);

      const filters = {};
      const andConditions = [];

      if (sku) {
        filters.cod = { $regex: new RegExp(escapeRegex(sku), 'i') };
      }

      if (nome) {
        const nomeRegex = buildWildcardRegex(nome) || new RegExp(escapeRegex(nome), 'i');
        const normalizedNome = normalizeForSearch(nome);
        const normalizedNomeRegex = normalizedNome
          ? buildWildcardRegex(normalizedNome) || new RegExp(escapeRegex(normalizedNome), 'i')
          : null;

        const nomeConditions = [];
        if (nomeRegex) {
          nomeConditions.push({ nome: { $regex: nomeRegex } });
        }
        if (normalizedNomeRegex) {
          nomeConditions.push({ searchableString: { $regex: normalizedNomeRegex } });
        }

        if (nomeConditions.length === 1) {
          const [singleCondition] = nomeConditions;
          const [[field, matcher]] = Object.entries(singleCondition);
          filters[field] = matcher;
        } else if (nomeConditions.length > 1) {
          andConditions.push({ $or: nomeConditions });
        }
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

      if (columnFilters.barcode) {
        const barcodeRegex = new RegExp(escapeRegex(columnFilters.barcode), 'i');
        andConditions.push({
          $or: [
            { codbarras: { $regex: barcodeRegex } },
            { codigosComplementares: { $regex: barcodeRegex } },
          ],
        });
      }

      if (columnFilters.nome) {
        const columnNomeRegex =
          buildWildcardRegex(columnFilters.nome) || new RegExp(escapeRegex(columnFilters.nome), 'i');
        const columnNormalizedNome = normalizeForSearch(columnFilters.nome);
        const columnNormalizedRegex = columnNormalizedNome
          ? buildWildcardRegex(columnNormalizedNome) || new RegExp(escapeRegex(columnNormalizedNome), 'i')
          : null;

        const columnConditions = [];
        if (columnNomeRegex) {
          columnConditions.push({ nome: { $regex: columnNomeRegex } });
        }
        if (columnNormalizedRegex) {
          columnConditions.push({ searchableString: { $regex: columnNormalizedRegex } });
        }

        if (columnConditions.length === 1) {
          andConditions.push(columnConditions[0]);
        } else if (columnConditions.length > 1) {
          andConditions.push({ $or: columnConditions });
        }
      }

      if (columnFilters.marca) {
        andConditions.push({ marca: { $regex: new RegExp(escapeRegex(columnFilters.marca), 'i') } });
      }

      if (columnFilters.apresentacao) {
        andConditions.push({ 'especificacoes.apresentacao': { $regex: new RegExp(escapeRegex(columnFilters.apresentacao), 'i') } });
      }

      const columnWeight = parseDecimalString(columnFilters.peso);
      if (columnWeight !== null) {
        andConditions.push({ peso: columnWeight });
      }

      if (columnFilters.iat) {
        andConditions.push({ iat: { $regex: new RegExp(escapeRegex(columnFilters.iat), 'i') } });
      }

      if (columnFilters.tipoProduto) {
        andConditions.push({ tipoProduto: { $regex: new RegExp(escapeRegex(columnFilters.tipoProduto), 'i') } });
      }

      if (columnFilters.categorias) {
        andConditions.push({ categorias: { $elemMatch: { $regex: new RegExp(escapeRegex(columnFilters.categorias), 'i') } } });
      }

      if (columnFilters.idade) {
        andConditions.push({ 'especificacoes.idade': { $regex: new RegExp(escapeRegex(columnFilters.idade), 'i') } });
      }

      if (columnFilters.especie) {
        andConditions.push({ 'especificacoes.pet': { $regex: new RegExp(escapeRegex(columnFilters.especie), 'i') } });
      }

      if (columnFilters.porte) {
        andConditions.push({ 'especificacoes.porteRaca': { $regex: new RegExp(escapeRegex(columnFilters.porte), 'i') } });
      }

      if (columnFilters.castrado) {
        andConditions.push({ 'especificacoes.castracao': { $regex: new RegExp(escapeRegex(columnFilters.castrado), 'i') } });
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

      const markupFilterRaw = columnFilters.markup;
      const imagemFilter = normalizeBooleanFilter(columnFilters.imagem);
      const requiresComputedFilters = Boolean(markupFilterRaw) || imagemFilter !== null;
      const idsOnly = false;

      const canUseSimpleQuery = !requiresComputedFilters && !requiresComputedSort && !idsOnly;

      let orderedProducts = [];

      if (canUseSimpleQuery) {
        orderedProducts = await Product.find(query)
          .collation(DEFAULT_COLLATION)
          .sort(sortStage)
          .allowDiskUse(true)
          .populate({ path: 'categorias', select: 'nome' })
          .lean();
      } else {
        const pipeline = [{ $match: query }];

        if (requiresComputedFilters || requiresComputedSort) {
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
        }

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

        if (imagemFilter === true) {
          pipeline.push({ $match: { temImagem: true } });
        } else if (imagemFilter === false) {
          pipeline.push({ $match: { temImagem: { $ne: true } } });
        }

        pipeline.push({ $project: buildAggregationProjection() });

        const aggregation = await Product.aggregate([
          ...pipeline,
          { $sort: { ...sortStage } },
          { $project: { _id: 1 } },
        ])
          .collation(DEFAULT_COLLATION)
          .allowDiskUse(true)
          .exec();

        const ids = Array.isArray(aggregation)
          ? aggregation.map((entry) => extractId(entry)).filter(Boolean)
          : [];

        if (ids.length) {
          const idsForQuery = ids
            .map((id) => (mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : id))
            .filter(Boolean);
          const productsDocs = await Product.find({ _id: { $in: idsForQuery } })
            .collation(DEFAULT_COLLATION)
            .populate({ path: 'categorias', select: 'nome' })
            .lean();
          const docsById = new Map(productsDocs.map((doc) => [extractId(doc), doc]));
          orderedProducts = ids.map((id) => docsById.get(id)).filter(Boolean);
        } else {
          orderedProducts = [];
        }
      }

      const fiscalRuleLookupByStore = await buildFiscalRuleLookupByStore(orderedProducts);
      const mappedProducts = orderedProducts.map((product) => mapProductForResponse(product, fiscalRuleLookupByStore));

      const worksheetHeader = [
        'ID',
        'SKU',
        'Descrição',
        'Unidade',
        'Tem imagem',
        'Preço de custo (R$)',
        'Markup (%)',
        'Preço de venda (R$)',
        'Estoque',
        'Fornecedor principal',
        'Situação',
      ];

      const toNumber = (value) => {
        const numeric = Number(value);
        return Number.isFinite(numeric) ? numeric : null;
      };

      const rows = mappedProducts.map((product) => ({
        ID: product.id,
        SKU: product.cod || '',
        'Descrição': product.nome || '',
        Unidade: product.unidade || '',
        'Tem imagem': product.temImagem ? 'Sim' : 'Não',
        'Preço de custo (R$)': toNumber(product.custo),
        'Markup (%)': product.markup === null || product.markup === undefined ? null : toNumber(product.markup),
        'Preço de venda (R$)': toNumber(product.venda),
        Estoque: toNumber(product.stock),
        'Fornecedor principal': product.fornecedor || '',
        'Situação': product.inativo ? 'Inativo' : 'Ativo',
      }));

      const worksheet = XLSX.utils.aoa_to_sheet([worksheetHeader]);
      if (rows.length) {
        XLSX.utils.sheet_add_json(worksheet, rows, {
          origin: 'A2',
          skipHeader: true,
          header: worksheetHeader,
        });
      }

      worksheet['!cols'] = [
        { wch: 24 },
        { wch: 18 },
        { wch: 45 },
        { wch: 12 },
        { wch: 12 },
        { wch: 20 },
        { wch: 15 },
        { wch: 20 },
        { wch: 12 },
        { wch: 32 },
        { wch: 14 },
      ];

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Produtos');

      const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

      res.setHeader(
        'Content-Disposition',
        `attachment; filename="produtos-relacao-${timestamp}.xlsx"`,
      );
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );

      res.send(buffer);
    } catch (error) {
      console.error('Erro ao exportar produtos em massa:', error);
      res.status(500).json({ message: 'Erro ao exportar a planilha de produtos.' });
    }
  },
);

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

function applyUpdatesToProduct(product, updates, user, options = {}) {
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

  if (hasEnabledField(updates, 'especificacoes.idade') || hasEnabledField(updates, 'especificacoes.pet') || hasEnabledField(updates, 'especificacoes.porteRaca') || hasEnabledField(updates, 'especificacoes.castracao')) {
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

    if (hasEnabledField(updates, 'especificacoes.castracao')) {
      product.especificacoes.castracao = normalizeString(getFieldValue(updates, 'especificacoes.castracao'));
    }
  }

  if (hasEnabledField(updates, 'descricao')) {
    const rawDescription = getFieldValue(updates, 'descricao');
    product.descricao = typeof rawDescription === 'string' ? rawDescription : '';
  }

  if (hasEnabledField(updates, 'naoMostrarNoSite')) {
    product.naoMostrarNoSite = Boolean(getFieldValue(updates, 'naoMostrarNoSite'));
  }

  if (hasEnabledField(updates, 'enviarParaIfood')) {
    product.enviarParaIfood = Boolean(getFieldValue(updates, 'enviarParaIfood'));
  }

  if (hasEnabledField(updates, 'ncm')) {
    product.ncm = normalizeString(getFieldValue(updates, 'ncm'));
  }

  const fiscalRuleAssignment = options?.fiscalRuleAssignment || null;
  if (fiscalRuleAssignment?.storeId && fiscalRuleAssignment?.fiscal) {
    const normalizedStoreId = normalizeString(fiscalRuleAssignment.storeId);
    if (normalizedStoreId) {
      const normalizedFiscal = normalizeFiscalData(fiscalRuleAssignment.fiscal || {});
      normalizedFiscal.atualizadoEm = new Date();
      normalizedFiscal.atualizadoPor = normalizeString(user?.email || user?.id || '');

      const currentFiscalPerStore = product.fiscalPorEmpresa;
      let fiscalByStore = {};

      if (currentFiscalPerStore && typeof currentFiscalPerStore.toObject === 'function') {
        fiscalByStore = currentFiscalPerStore.toObject();
      } else if (currentFiscalPerStore instanceof Map) {
        currentFiscalPerStore.forEach((value, key) => {
          fiscalByStore[String(key)] = value;
        });
      } else if (currentFiscalPerStore && typeof currentFiscalPerStore === 'object') {
        fiscalByStore = { ...currentFiscalPerStore };
      }

      fiscalByStore[normalizedStoreId] = normalizedFiscal;
      product.fiscalPorEmpresa = fiscalByStore;
      product.markModified('fiscalPorEmpresa');
    }
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
    return res.status(400).json({ message: 'Os identificadores dos produtos sao invalidos.' });
  }

  const fiscalStoreEnabled = hasEnabledField(updates, 'fiscal.storeId');
  const fiscalRuleEnabled = hasEnabledField(updates, 'fiscal.ruleCode');
  const updateOptions = {};

  if (fiscalStoreEnabled || fiscalRuleEnabled) {
    const fiscalStoreId = normalizeString(getFieldValue(updates, 'fiscal.storeId'));
    const fiscalRuleCode = parsePositiveInt(getFieldValue(updates, 'fiscal.ruleCode'));

    if (!fiscalStoreId) {
      return res.status(400).json({ message: 'Informe a empresa para aplicar a regra fiscal.' });
    }

    if (!fiscalRuleCode) {
      return res.status(400).json({ message: 'Informe o tipo de regra fiscal.' });
    }

    const fiscalStoreObjectId = ensureObjectId(fiscalStoreId);
    if (!fiscalStoreObjectId) {
      return res.status(400).json({ message: 'Empresa invalida para aplicacao da regra fiscal.' });
    }

    const storeExists = await Store.exists({ _id: fiscalStoreObjectId });
    if (!storeExists) {
      return res.status(404).json({ message: 'Empresa nao encontrada para aplicacao da regra fiscal.' });
    }

    const selectedRule = await FiscalDefaultRule.findOne({ empresa: fiscalStoreObjectId, code: fiscalRuleCode }).lean();
    if (!selectedRule) {
      return res.status(404).json({ message: 'Regra fiscal nao encontrada para a empresa selecionada.' });
    }

    updateOptions.fiscalRuleAssignment = {
      storeId: fiscalStoreId,
      code: fiscalRuleCode,
      fiscal: normalizeFiscalData(selectedRule.fiscal || {}),
    };
  }

  const result = { updated: 0, errors: [] };

  const enabledUpdateKeys = Object.keys(updates || {}).filter((key) => hasEnabledField(updates, key));
  const isOnlyFiscalRuleAssignment =
    enabledUpdateKeys.length === 2 &&
    enabledUpdateKeys.includes('fiscal.storeId') &&
    enabledUpdateKeys.includes('fiscal.ruleCode') &&
    updateOptions?.fiscalRuleAssignment?.storeId &&
    updateOptions?.fiscalRuleAssignment?.fiscal;

  try {
    if (isOnlyFiscalRuleAssignment) {
      const assignmentStoreId = normalizeString(updateOptions.fiscalRuleAssignment.storeId);
      const fiscalPayload = normalizeFiscalData(updateOptions.fiscalRuleAssignment.fiscal || {});
      fiscalPayload.atualizadoEm = new Date();
      fiscalPayload.atualizadoPor = normalizeString(req.user?.email || req.user?.id || '');

      const setPath = `fiscalPorEmpresa.${assignmentStoreId}`;
      const updateResult = await Product.updateMany(
        { _id: { $in: validIds } },
        { $set: { [setPath]: fiscalPayload } },
      );

      const matchedCount = Number(updateResult?.matchedCount ?? updateResult?.n ?? 0);
      const modifiedCount = Number(updateResult?.modifiedCount ?? updateResult?.nModified ?? 0);

      if (matchedCount < validIds.length) {
        const matchedProducts = await Product.find({ _id: { $in: validIds } })
          .select({ _id: 1 })
          .lean();
        const foundIds = new Set(matchedProducts.map((product) => String(product._id)));
        validIds.forEach((objectId) => {
          const stringId = objectId.toString();
          if (!foundIds.has(stringId)) {
            result.errors.push({ id: stringId, message: 'Produto n�o encontrado.' });
          }
        });
      }

      result.updated = modifiedCount;
      return res.json({
        ...result,
        matched: matchedCount,
      });
    }

    const products = await Product.find({ _id: { $in: validIds } }).collation(DEFAULT_COLLATION);
    const foundIds = new Set(products.map((product) => product._id.toString()));

    validIds.forEach((objectId) => {
      const stringId = objectId.toString();
      if (!foundIds.has(stringId)) {
        result.errors.push({ id: stringId, message: 'Produto não encontrado.' });
      }
    });

    for (const product of products) {
      try {
        const previousStock = Number(product?.stock) || 0;
        applyUpdatesToProduct(product, updates, req.user || {}, updateOptions);
        await product.save();
        if (hasEnabledField(updates, 'stock')) {
          const currentStock = Number(product?.stock) || 0;
          const quantityDelta = Math.round((currentStock - previousStock) * 1_000_000) / 1_000_000;
          if (Math.abs(quantityDelta) > 0.0000005) {
            await logInventoryMovement({
              movementDate: new Date(),
              productId: product._id,
              productCode: product.cod || '',
              productName: product.nome || '',
              operation: quantityDelta > 0 ? 'entrada' : 'saida',
              previousStock,
              quantityDelta,
              currentStock,
              unitCost: Number.isFinite(Number(product?.custo)) ? Number(product.custo) : null,
              sourceModule: 'compras.estoque',
              sourceScreen: 'Relação para Alterar Produtos',
              sourceAction: 'edicao_massa_produto',
              sourceType: 'bulk_product_stock_edit',
              referenceDocument: String(product._id),
              userId: req.user?.id,
              userName: normalizeString(req.user?.nomeCompleto || req.user?.apelido || req.user?.name || ''),
              userEmail: normalizeString(req.user?.email || ''),
              metadata: {
                route: 'PUT /api/admin/products/bulk',
              },
            });
          }
        }
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













