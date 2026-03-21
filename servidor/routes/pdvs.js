const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});
const Pdv = require('../models/Pdv');
const Store = require('../models/Store');
const Deposit = require('../models/Deposit');
const PdvState = require('../models/PdvState');
const PdvCaixaSession = require('../models/PdvCaixaSession');
const Product = require('../models/Product');
const {
  recalculateFractionalStockForProduct,
  refreshParentFractionalStocks,
} = require('../utils/fractionalInventory');
const { logInventoryMovement } = require('../utils/inventoryMovementLogger');
const BankAccount = require('../models/BankAccount');
const AccountingAccount = require('../models/AccountingAccount');
const requireAuth = require('../middlewares/requireAuth');
const authorizeRoles = require('../middlewares/authorizeRoles');
const { uploadBufferToR2, isR2Configured } = require('../utils/cloudflareR2');
const { emitPdvSaleFiscal } = require('../services/nfceEmitter');
const { buildFiscalR2Key } = require('../utils/fiscalDrivePath');
const { buildFiscalXmlFileName } = require('../utils/fiscalXmlFileName');
const {
  ensureScopedSequenceAtLeast,
  nextScopedSequence,
  getScopedSequence,
  pdvSaleSequenceKey,
  pdvBudgetSequenceKey,
} = require('../utils/sequences');
const pdvStateWriteQueues = new Map();

const ambientesPermitidos = ['homologacao', 'producao'];
const ambientesSet = new Set(ambientesPermitidos);
const opcoesImpressao = ['sim', 'nao', 'perguntar'];
const opcoesImpressaoSet = new Set(opcoesImpressao);
const perfisDesconto = ['funcionario', 'gerente', 'admin'];
const perfisDescontoSet = new Set(perfisDesconto);
const tiposEmissao = ['matricial', 'fiscal', 'ambos'];
const tiposEmissaoSet = new Set(tiposEmissao);
const tiposImpressora = ['bematech', 'elgin'];
const tiposImpressoraSet = new Set(tiposImpressora);
const SALE_CODE_PADDING = 6;
const BUDGET_CODE_PADDING = 6;
const BUDGET_CODE_PREFIX = 'ORC';
const roleRank = {
  cliente: 0,
  funcionario: 1,
  franqueado: 2,
  franqueador: 3,
  admin: 4,
  admin_master: 5,
};

let qrCodeModulePromise;

const loadQrCodeModule = () => {
  if (!qrCodeModulePromise) {
    qrCodeModulePromise = import('qrcode')
      .then((mod) => mod?.default || mod)
      .catch((error) => {
        console.error('NÃ£o foi possÃ­vel carregar a dependÃªncia "qrcode".', error);
        return null;
      });
  }
  return qrCodeModulePromise;
};

const normalizeString = (value) => {
  if (value === undefined || value === null) return '';
  return String(value).trim();
};

const isBelowFranqueado = (role) => {
  const normalizedRole = normalizeString(role).toLowerCase();
  const rank = Number.isFinite(roleRank[normalizedRole]) ? roleRank[normalizedRole] : -1;
  return rank < roleRank.franqueado;
};

const generateQrCodeDataUrl = async (payload) => {
  const normalized = normalizeString(payload);
  if (!normalized) return '';

  const qrCode = await loadQrCodeModule();
  if (!qrCode || typeof qrCode.toDataURL !== 'function') {
    console.error('DependÃªncia "qrcode" indisponÃ­vel para gerar imagem.');
    return '';
  }

  try {
    return await qrCode.toDataURL(normalized, { margin: 1 });
  } catch (error) {
    console.error('Erro ao gerar QR Code da NFC-e.', error);
    return '';
  }
};

const parseBoolean = (value) => {
  if (typeof value === 'boolean') return value;
  if (value === undefined || value === null) return false;
  const normalized = String(value).trim().toLowerCase();
  return ['1', 'true', 'on', 'yes', 'sim'].includes(normalized);
};

const parseNumber = (value) => {
  if (value === undefined || value === null || value === '') return null;

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === 'string') {
    const normalized = value.trim();
    if (!normalized) return null;

    const usesComma = normalized.includes(',');
    const sanitized = usesComma
      ? normalized.replace(/\./g, '').replace(',', '.')
      : normalized;

    const parsed = Number(sanitized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const extractNumericValue = (code) => {
  const normalized = normalizeString(code);
  if (!normalized) return 0;
  const matches = normalized.match(/\d+/g);
  if (!matches) {
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return matches.reduce((max, part) => {
    const parsed = Number(part);
    return Number.isFinite(parsed) && parsed > max ? parsed : max;
  }, 0);
};

const generateNextCode = async () => {
  const pdvs = await Pdv.find({}, 'codigo').lean();
  const highest = pdvs.reduce((max, pdv) => {
    const current = extractNumericValue(pdv?.codigo);
    return current > max ? current : max;
  }, 0);
  return `PDV-${String(highest + 1).padStart(3, '0')}`;
};

const normalizeAmbientes = (value) => {
  let items = [];
  if (Array.isArray(value)) {
    items = value;
  } else if (typeof value === 'string') {
    items = value.split(',');
  }

  const filtered = items
    .map((item) => normalizeString(item).toLowerCase())
    .filter((item) => ambientesSet.has(item));

  return Array.from(new Set(filtered));
};

const storeSupportsEnvironment = (store, env) => {
  if (!store) return false;
  if (env === 'producao') {
    return Boolean(store.cscIdProducao && store.cscTokenProducaoArmazenado);
  }
  if (env === 'homologacao') {
    return Boolean(store.cscIdHomologacao && store.cscTokenHomologacaoArmazenado);
  }
  return false;
};

const createValidationError = (message) => {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
};

const parseFiscalNumber = (value, { label, allowZero = false }) => {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const normalized = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));

  if (!Number.isFinite(normalized)) {
    const message = allowZero
      ? `Informe um nÃºmero atual vÃ¡lido para ${label}.`
      : `Informe um nÃºmero inicial vÃ¡lido para ${label}.`;
    throw createValidationError(message);
  }

  const integer = Math.trunc(normalized);
  const min = allowZero ? 0 : 1;
  if (integer < min) {
    const message = allowZero
      ? `O nÃºmero atual de ${label} deve ser maior ou igual a ${min}.`
      : `O nÃºmero inicial de ${label} deve ser maior ou igual a ${min}.`;
    throw createValidationError(message);
  }

  return integer;
};

const parseSempreImprimir = (value) => {
  const normalized = normalizeString(value).toLowerCase();
  if (!normalized) return 'perguntar';
  if (!opcoesImpressaoSet.has(normalized)) {
    throw createValidationError('Selecione uma opÃ§Ã£o vÃ¡lida para "Sempre imprimir".');
  }
  return normalized;
};

const parseCopias = (value, { allowNull = true } = {}) => {
  if (value === undefined || value === null || value === '') {
    return allowNull ? null : 1;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw createValidationError('Informe um nÃºmero vÃ¡lido de vias para a impressora selecionada.');
  }
  const inteiro = Math.trunc(parsed);
  if (inteiro < 1 || inteiro > 10) {
    throw createValidationError('O nÃºmero de vias deve estar entre 1 e 10.');
  }
  return inteiro;
};

const parsePaperWidth = (value) => {
  const normalized = normalizeString(value).toLowerCase();
  if (!normalized) return null;
  if (normalized === '80' || normalized === '80mm') return '80mm';
  if (normalized === '58' || normalized === '58mm') return '58mm';
  throw createValidationError('Selecione uma largura valida para a impressora.');
};

const parsePrinterType = (value) => {
  const normalized = normalizeString(value).toLowerCase();
  if (!normalized) return 'bematech';
  if (!tiposImpressoraSet.has(normalized)) {
    throw createValidationError('Selecione um tipo de impressora valido.');
  }
  return normalized;
};

const buildPrinterPayload = (payload) => {
  if (!payload) return null;

  const nomesRaw = Array.isArray(payload.nomesImpressoras)
    ? payload.nomesImpressoras
    : Array.isArray(payload.nomes)
    ? payload.nomes
    : Array.isArray(payload.aliases)
    ? payload.aliases
    : [];
  const nomesImpressoras = Array.from(
    new Set(
      nomesRaw
        .map((entry) => normalizeString(entry))
        .filter(Boolean)
    )
  );
  const nomePrincipal = normalizeString(payload.nome || payload.printer || payload.nomeImpressora);
  if (nomePrincipal) {
    nomesImpressoras.unshift(nomePrincipal);
  }
  const nomesNormalizados = Array.from(new Set(nomesImpressoras.filter(Boolean)));
  const nome = nomesNormalizados[0] || '';
  const vias = parseCopias(payload.vias ?? payload.copias ?? payload.copiasImpressao ?? '', {
    allowNull: !nome,
  });

  if (!nome) {
    return null;
  }

  const larguraPapel =
    parsePaperWidth(payload.larguraPapel ?? payload.largura ?? payload.paperWidth) || '80mm';
  const tipoImpressora = parsePrinterType(
    payload.tipoImpressora ?? payload.tipo ?? payload.printerType
  );

  return {
    nome,
    nomesImpressoras: nomesNormalizados,
    vias: vias ?? 1,
    larguraPapel,
    tipoImpressora,
  };
};

const normalizePerfisDesconto = (value) => {
  let itens = [];
  if (Array.isArray(value)) {
    itens = value;
  } else if (typeof value === 'string') {
    itens = value.split(',');
  }

  const filtrados = itens
    .map((item) => normalizeString(item).toLowerCase())
    .filter((item) => perfisDescontoSet.has(item));

  return Array.from(new Set(filtrados));
};

const parseTipoEmissao = (value) => {
  const normalized = normalizeString(value).toLowerCase();
  if (!normalized) return 'fiscal';
  if (!tiposEmissaoSet.has(normalized)) {
    throw createValidationError('Selecione um tipo de emissÃ£o padrÃ£o vÃ¡lido.');
  }
  return normalized;
};

const safeNumber = (value, fallback = 0) => {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const safeDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const sameInstant = (left, right) => {
  const leftDate = safeDate(left);
  const rightDate = safeDate(right);
  if (!leftDate && !rightDate) return true;
  if (!leftDate || !rightDate) return false;
  return leftDate.getTime() === rightDate.getTime();
};

const resolveCaixaAbertoValue = (body = {}, existingState = {}) => {
  if (body.caixaAberto !== undefined && body.caixaAberto !== null) {
    return Boolean(body.caixaAberto);
  }
  if (body.caixa?.aberto !== undefined && body.caixa?.aberto !== null) {
    return Boolean(body.caixa.aberto);
  }
  const statusCaixa = normalizeString(body.statusCaixa).toLowerCase();
  if (statusCaixa === 'aberto') return true;
  if (statusCaixa === 'fechado') return false;
  return Boolean(existingState.caixaAberto);
};

const hasExplicitCaixaClosure = (updatePayload = {}) => {
  const fechamentoData = safeDate(updatePayload?.caixaInfo?.fechamentoData);
  if (fechamentoData) return true;
  const movements = [
    ...(Array.isArray(updatePayload?.history) ? updatePayload.history : []),
    updatePayload?.lastMovement,
  ].filter(Boolean);
  return movements.some((entry) => {
    const id = normalizeString(entry?.id).toLowerCase();
    const label = normalizeString(entry?.label).toLowerCase();
    return id === 'fechamento' || label.includes('fechamento');
  });
};

const hasOwn = (obj, key) => Boolean(obj) && Object.prototype.hasOwnProperty.call(obj, key);

const resolveOptionalDateField = (primarySource = {}, keys = [], fallbackValue = null) => {
  for (const key of keys) {
    if (!hasOwn(primarySource, key)) continue;
    const value = primarySource[key];
    if (value === null || value === '') {
      return null;
    }
    const parsed = safeDate(value);
    return parsed || null;
  }
  const fallbackDate = safeDate(fallbackValue);
  return fallbackDate || null;
};

const toObjectIdOrNull = (value) => {
  if (!value) return null;
  if (value instanceof mongoose.Types.ObjectId) {
    return value;
  }
  const normalized = normalizeString(value);
  if (!normalized || !mongoose.Types.ObjectId.isValid(normalized)) {
    return null;
  }
  return new mongoose.Types.ObjectId(normalized);
};

const extractProductIdFromSnapshot = (item) => {
  if (!item || typeof item !== 'object') return null;
  const candidates = [
    item.id,
    item._id,
    item.productId,
    item.product_id,
    item.produtoId,
    item.produto_id,
    item.product?.id,
    item.product?.productId,
    item.productSnapshot?._id,
    item.productSnapshot?.id,
    item.productSnapshot?.productId,
  ];
  for (const candidate of candidates) {
    const objectId = toObjectIdOrNull(candidate);
    if (objectId) {
      return objectId;
    }
  }
  return null;
};

const extractProductIdFromItem = (item) => {
  if (!item || typeof item !== 'object') return null;
  const candidates = [
    item.id,
    item._id,
    item.productId,
    item.product_id,
    item.produtoId,
    item.produto_id,
    item.product?._id,
    item.product?.id,
    item.product?.productId,
    item.produto?._id,
    item.produto?.id,
    item.produto?.productId,
    item.productSnapshot?._id,
    item.productSnapshot?.id,
    item.productSnapshot?.productId,
    item.produtoSnapshot?._id,
    item.produtoSnapshot?.id,
    item.produtoSnapshot?.productId,
  ];
  for (const candidate of candidates) {
    const objectId = toObjectIdOrNull(candidate);
    if (objectId) {
      return objectId;
    }
  }
  return null;
};

const collectSaleProductQuantities = (sale) => {
  const quantities = new Map();
  if (!sale || typeof sale !== 'object') {
    return quantities;
  }
  const itemCandidates = [
    sale.items,
    sale.fiscalItemsSnapshot,
    sale.itemsSnapshot,
    sale.itemsSnapshot?.items,
    sale.itemsSnapshot?.itens,
    sale.receiptSnapshot?.items,
    sale.receiptSnapshot?.itens,
    sale.receiptSnapshot?.products,
    sale.receiptSnapshot?.produtos,
    sale.receiptSnapshot?.cart?.items,
    sale.receiptSnapshot?.cart?.itens,
    sale.receiptSnapshot?.cart?.products,
    sale.receiptSnapshot?.cart?.produtos,
  ];
  const source = itemCandidates.find((list) => Array.isArray(list) && list.length) || [];
  for (const item of source) {
    const productId = extractProductIdFromItem(item) || extractProductIdFromSnapshot(item);
    if (!productId) continue;
    const rawQuantity =
      item?.quantity ??
      item?.quantidade ??
      item?.qtd ??
      item?.amount ??
      item?.totalQuantity ??
      0;
    let numericQuantity = 0;
    if (typeof rawQuantity === 'string') {
      const parsed = Number(rawQuantity.replace(',', '.'));
      numericQuantity = Number.isFinite(parsed) ? Math.abs(parsed) : 0;
    } else {
      numericQuantity = Math.abs(safeNumber(rawQuantity, 0));
    }
    if (numericQuantity <= 0) continue;
    const key = productId.toString();
    const current = quantities.get(key) || 0;
    quantities.set(key, current + numericQuantity);
  }
  return quantities;
};

const collectProductIdsFromSales = (sales = []) => {
  const ids = new Set();
  const candidates = [
    (sale) => sale.items,
    (sale) => sale.receiptSnapshot?.items,
    (sale) => sale.receiptSnapshot?.itens,
    (sale) => sale.receiptSnapshot?.products,
    (sale) => sale.receiptSnapshot?.produtos,
    (sale) => sale.receiptSnapshot?.cart?.items,
    (sale) => sale.receiptSnapshot?.cart?.itens,
    (sale) => sale.receiptSnapshot?.cart?.products,
    (sale) => sale.receiptSnapshot?.cart?.produtos,
    (sale) => sale.itemsSnapshot,
    (sale) => sale.itemsSnapshot?.items,
    (sale) => sale.itemsSnapshot?.itens,
    (sale) => sale.fiscalItemsSnapshot,
  ];

  for (const sale of sales) {
    for (const getter of candidates) {
      const list = getter(sale);
      if (!Array.isArray(list)) continue;
      for (const item of list) {
        const id = extractProductIdFromItem(item);
        if (id) {
          ids.add(id.toString());
        }
      }
    }
  }

  return Array.from(ids);
};

const ensureSalesHaveCostData = (sales = [], productMap = new Map()) => {
  const parseNumber = (value) => {
    if (value === undefined || value === null) return NaN;
    return typeof value === 'string' ? Number(value.replace(',', '.')) : Number(value);
  };

  const isPositive = (value) => {
    const parsed = parseNumber(value);
    return Number.isFinite(parsed) && parsed > 0;
  };

  const isDifferentCost = (current, expected) => {
    const parsedCurrent = parseNumber(current);
    const parsedExpected = parseNumber(expected);
    if (!Number.isFinite(parsedExpected)) return false;
    if (!Number.isFinite(parsedCurrent) || parsedCurrent <= 0) return true;
    return Math.abs(parsedCurrent - parsedExpected) > 0.0001;
  };

  const resolveQuantity = (item) => {
    const candidates = [item?.quantity, item?.quantidade, item?.qty, item?.qtd, item?.amount];
    for (const candidate of candidates) {
      const parsed = typeof candidate === 'string' ? Number(candidate.replace(',', '.')) : Number(candidate);
      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
      }
    }
    return 1;
  };

  const setUnitCost = (item, cost) => {
    const unitCostCandidates = [
      item.cost,
      item.costPrice,
      item.unitCost,
      item.precoCusto,
      item.custo,
      item.custoCalculado,
      item.custoUnitario,
      item.custoMedio,
      item.custoReferencia,
      item.precoCustoUnitario,
      item.costValue,
      item.precoCustoValue,
    ];

    const shouldUpdate = unitCostCandidates.every((candidate) => isDifferentCost(candidate, cost));
    if (!shouldUpdate) return;

    item.custo = cost;
    item.precoCusto = cost;
    item.unitCost = cost;
    item.cost = cost;

    if (item.productSnapshot && typeof item.productSnapshot === 'object') {
      item.productSnapshot.custo = cost;
      item.productSnapshot.custoCalculado = cost;
      item.productSnapshot.precoCusto = cost;
    }

    if (item.produtoSnapshot && typeof item.produtoSnapshot === 'object') {
      item.produtoSnapshot.custo = cost;
      item.produtoSnapshot.custoCalculado = cost;
      item.produtoSnapshot.precoCusto = cost;
    }
  };

  const setTotalCost = (item, cost) => {
    const totalCostCandidates = [
      item.totalCost,
      item.custoTotal,
      item.totalCusto,
      item.custoTotalCalculado,
      item.totalCostValue,
      item.precoCustoTotal,
      item.totalPrecoCusto,
      item.precoCustoValorTotal,
    ];

    const quantity = resolveQuantity(item);
    const totalCost = quantity * cost;
    const shouldUpdate = totalCostCandidates.every((candidate) => isDifferentCost(candidate, totalCost));
    if (!shouldUpdate) return;

    item.custoTotal = totalCost;
    item.totalCost = totalCost;
    item.precoCustoTotal = totalCost;

    if (item.productSnapshot && typeof item.productSnapshot === 'object') {
      item.productSnapshot.custoTotal = totalCost;
      item.productSnapshot.precoCustoTotal = totalCost;
    }

    if (item.produtoSnapshot && typeof item.produtoSnapshot === 'object') {
      item.produtoSnapshot.custoTotal = totalCost;
      item.produtoSnapshot.precoCustoTotal = totalCost;
    }
  };

  const itemCollections = [
    (sale) => sale.items,
    (sale) => sale.receiptSnapshot?.items,
    (sale) => sale.receiptSnapshot?.itens,
    (sale) => sale.receiptSnapshot?.products,
    (sale) => sale.receiptSnapshot?.produtos,
    (sale) => sale.receiptSnapshot?.cart?.items,
    (sale) => sale.receiptSnapshot?.cart?.itens,
    (sale) => sale.receiptSnapshot?.cart?.products,
    (sale) => sale.receiptSnapshot?.cart?.produtos,
    (sale) => sale.itemsSnapshot,
    (sale) => sale.itemsSnapshot?.items,
    (sale) => sale.itemsSnapshot?.itens,
    (sale) => sale.fiscalItemsSnapshot,
  ];

  const resolvePrimaryItems = (sale) => {
    for (const getter of itemCollections) {
      const list = getter(sale);
      if (Array.isArray(list) && list.length) {
        return list;
      }
    }
    return [];
  };

  const setSaleTotalCost = (sale, totalCost) => {
    if (!(totalCost > 0)) return;

    const shouldUpdateSaleField = (value) => isDifferentCost(value, totalCost);

    const saleCostFields = [
      'cost',
      'totalCost',
      'custo',
      'custoTotal',
      'precoCustoTotal',
      'totalPrecoCusto',
    ];

    saleCostFields.forEach((field) => {
      if (shouldUpdateSaleField(sale?.[field])) {
        sale[field] = totalCost;
      }
    });

    const updateTotals = (totals) => {
      if (!totals || typeof totals !== 'object') return;
      const totalFields = ['custo', 'custoTotal', 'totalCusto', 'precoCusto', 'precoCustoTotal', 'totalPrecoCusto'];
      totalFields.forEach((field) => {
        if (shouldUpdateSaleField(totals?.[field])) {
          totals[field] = totalCost;
        }
      });
    };

    updateTotals(sale.totais);
    updateTotals(sale.receiptSnapshot?.totais);
  };

  for (const sale of sales) {
    for (const getter of itemCollections) {
      const list = getter(sale);
      if (!Array.isArray(list)) continue;
      for (const item of list) {
        const productId = extractProductIdFromItem(item);
        if (!productId) continue;

        const product = productMap.get(productId.toString());
        if (!product) continue;

        const unitCostCandidates = [
          product.precoCusto,
          product.precoCustoUnitario,
          product.custo,
          product.custoMedio,
          product.custoCalculado,
        ];

        const baseCost = unitCostCandidates.find(isPositive);
        if (!isPositive(baseCost)) continue;

        setUnitCost(item, baseCost);
        setTotalCost(item, baseCost);
      }
    }

    const primaryItems = resolvePrimaryItems(sale);
    if (primaryItems.length) {
      const saleTotalCost = primaryItems.reduce((acc, item) => {
        const candidates = [
          item.cost,
          item.costPrice,
          item.unitCost,
          item.precoCusto,
          item.custo,
          item.custoCalculado,
          item.custoUnitario,
          item.custoMedio,
          item.custoReferencia,
          item.precoCustoUnitario,
          item.costValue,
          item.precoCustoValue,
          item.productSnapshot?.custo,
          item.productSnapshot?.custoCalculado,
          item.productSnapshot?.precoCusto,
          item.productSnapshot?.precoCustoUnitario,
          item.produtoSnapshot?.custo,
          item.produtoSnapshot?.custoCalculado,
          item.produtoSnapshot?.precoCusto,
          item.produtoSnapshot?.precoCustoUnitario,
        ];

        const unitCost = candidates.map(parseNumber).find((value) => Number.isFinite(value) && value > 0);
        if (!Number.isFinite(unitCost)) {
          return acc;
        }

        const quantity = resolveQuantity(item);
        return acc + quantity * unitCost;
      }, 0);

      setSaleTotalCost(sale, saleTotalCost);
    }
  }

  return sales;
};

const resolveProductObjectId = (value) => {
  if (!value) return null;
  if (value instanceof mongoose.Types.ObjectId) {
    return value;
  }
  if (typeof value === 'object' && value._id) {
    return resolveProductObjectId(value._id);
  }
  return toObjectIdOrNull(value);
};

const resolveFractionalChildRatio = (baseQuantity, fractionQuantity) => {
  const normalizedBase = Number(baseQuantity);
  const normalizedFraction = Number(fractionQuantity);

  if (!Number.isFinite(normalizedBase) || normalizedBase <= 0) return 0;
  if (!Number.isFinite(normalizedFraction) || normalizedFraction <= 0) return 0;

  const directRatio = normalizedFraction / normalizedBase;
  if (Number.isFinite(directRatio) && directRatio >= 1) {
    return directRatio;
  }

  const invertedRatio = normalizedBase / normalizedFraction;
  if (Number.isFinite(invertedRatio) && invertedRatio >= 1) {
    return invertedRatio;
  }

  return 0;
};

const updateProductStockForDeposit = async ({
  productId,
  depositId,
  quantity,
  cascadeFractional = true,
  visited,
  movementContext,
}) => {
  const numericQuantity = Number(quantity);
  if (!Number.isFinite(numericQuantity) || numericQuantity === 0) {
    return { updated: false, operations: [] };
  }

  const productObjectId = resolveProductObjectId(productId);
  const depositObjectId = toObjectIdOrNull(depositId);
  if (!productObjectId || !depositObjectId) {
    return { updated: false, operations: [] };
  }

  const product = await Product.findById(productObjectId);
  if (!product) {
    console.warn('Produto nÃ£o encontrado para movimentaÃ§Ã£o de estoque no PDV.', {
      productId: productObjectId.toString(),
    });
    return { updated: false, operations: [] };
  }

  const visitSet = visited instanceof Set ? visited : new Set();
  const visitKey = product._id.toString();
  const alreadyVisited = visitSet.has(visitKey);
  if (!alreadyVisited) {
    visitSet.add(visitKey);
  }

  if (!Array.isArray(product.estoques)) {
    product.estoques = [];
  }

  const depositKey = depositObjectId.toString();

  let entry = product.estoques.find(
    (stockEntry) => stockEntry?.deposito && stockEntry.deposito.toString() === depositKey
  );

  let previousQuantity = 0;
  if (entry) {
    let current = 0;
    if (typeof entry.quantidade === 'string') {
      const parsed = Number(entry.quantidade.replace(',', '.'));
      current = Number.isFinite(parsed) ? parsed : 0;
    } else {
      current = safeNumber(entry.quantidade, 0);
    }
    previousQuantity = current;
    entry.quantidade = current - numericQuantity;
  } else {
    entry = {
      deposito: depositObjectId,
      quantidade: -numericQuantity,
      unidade: product.unidade || 'UN',
    };
    product.estoques.push(entry);
  }

  const currentQuantity = safeNumber(entry.quantidade, 0);
  const quantityDelta = currentQuantity - previousQuantity;

  product.markModified('estoques');

  try {
    await product.save();
  } catch (error) {
    console.error('Erro ao salvar movimentaÃ§Ã£o de estoque do produto no PDV.', {
      productId: product._id.toString(),
      depositId: depositObjectId.toString(),
    }, error);
    throw error;
  }

  await logInventoryMovement({
    movementDate: movementContext?.movementDate || new Date(),
    companyId: movementContext?.companyId,
    productId: product._id,
    productCode: product?.cod || '',
    productName: product?.nome || '',
    depositId: depositObjectId,
    fromDepositId: movementContext?.fromDepositId,
    toDepositId: movementContext?.toDepositId,
    operation: movementContext?.operation,
    previousStock: previousQuantity,
    quantityDelta,
    currentStock: currentQuantity,
    unitCost: Number.isFinite(Number(product?.custo)) ? Number(product.custo) : null,
    totalValueDelta: Number.isFinite(Number(product?.custo)) ? quantityDelta * Number(product.custo) : null,
    sourceModule: movementContext?.sourceModule || 'pdv',
    sourceScreen: movementContext?.sourceScreen || 'PDV',
    sourceAction: movementContext?.sourceAction || '',
    sourceType: movementContext?.sourceType || '',
    referenceDocument: movementContext?.referenceDocument || '',
    notes: movementContext?.notes || '',
    userId: movementContext?.userId,
    userName: movementContext?.userName || '',
    userEmail: movementContext?.userEmail || '',
    metadata: movementContext?.metadata || null,
  });

  const operations = [{ product: product._id, quantity: numericQuantity }];

  const shouldCascade = cascadeFractional && !alreadyVisited;
  const fractionalConfig = product.fracionado || {};
  const fractionalItems = Array.isArray(fractionalConfig.itens) ? fractionalConfig.itens : [];

  if (shouldCascade && fractionalConfig.ativo && fractionalItems.length) {
    for (const item of fractionalItems) {
      const baseQuantity = Number(item?.quantidadeOrigem);
      const fractionQuantity = Number(item?.quantidadeFracionada);
      if (!Number.isFinite(baseQuantity) || baseQuantity <= 0) continue;
      if (!Number.isFinite(fractionQuantity) || fractionQuantity <= 0) continue;

      const childObjectId = resolveProductObjectId(item?.produto);
      if (!childObjectId) continue;

      const ratio = resolveFractionalChildRatio(baseQuantity, fractionQuantity);
      const childQuantity = numericQuantity * ratio;
      if (!Number.isFinite(childQuantity) || childQuantity === 0) continue;

      try {
        const childResult = await updateProductStockForDeposit({
          productId: childObjectId,
          depositId: depositObjectId,
          quantity: childQuantity,
          cascadeFractional: true,
          visited: visitSet,
          movementContext,
        });
        if (childResult?.operations?.length) {
          operations.push(...childResult.operations);
        }
      } catch (error) {
        console.error('Erro ao ajustar estoque de produto filho fracionado no PDV.', {
          parentProductId: product._id.toString(),
          childProductId: childObjectId.toString(),
        }, error);
      }
    }

    try {
      await recalculateFractionalStockForProduct(product._id);
    } catch (error) {
      console.error('Erro ao recalcular estoque fracionado do produto pai no PDV.', {
        productId: product._id.toString(),
      }, error);
    }
  }

  try {
    await refreshParentFractionalStocks(product._id);
  } catch (error) {
    console.error('Erro ao atualizar produtos pais fracionados vinculados no PDV.', {
      productId: product._id.toString(),
    }, error);
  }

  return { updated: true, operations };
};

const applyInventoryMovementsToSales = async ({ sales, depositId, existingMovements = [], movementContext = {} }) => {
  const result = {
    sales: Array.isArray(sales) ? sales : [],
    movements: [],
    revertedSales: [],
  };
  if (!Array.isArray(result.sales) || !depositId) {
    return result;
  }

  const depositObjectId = toObjectIdOrNull(depositId);
  if (!depositObjectId) {
    return result;
  }

  const movementMap = new Map();
  if (Array.isArray(existingMovements)) {
    for (const movement of existingMovements) {
      if (!movement || typeof movement !== 'object' || !movement.saleId) continue;
      const key = movement.saleId;
      const list = movementMap.get(key) || [];
      list.push(movement);
      movementMap.set(key, list);
    }
  }

  for (const sale of result.sales) {
    if (!sale || typeof sale !== 'object') continue;
    const saleId = sale.id || sale._id || '';
    const saleStatus = normalizeString(sale.status).toLowerCase();
    if (saleStatus === 'cancelled') {
      const relatedMovements = movementMap.get(saleId) || [];
      if (relatedMovements.length) {
        for (const movement of relatedMovements) {
          const movementDeposit = movement?.deposit ? toObjectIdOrNull(movement.deposit) : depositObjectId;
          if (!movementDeposit) continue;
          const items = Array.isArray(movement.items) ? movement.items : [];
          for (const item of items) {
            const productId = item?.product ? toObjectIdOrNull(item.product) : null;
            const quantity = Number(item?.quantity) || 0;
            if (!productId || !(quantity > 0)) continue;
            await updateProductStockForDeposit({
              productId,
              depositId: movementDeposit,
              quantity: -quantity,
              cascadeFractional: false,
              movementContext: {
                ...movementContext,
                movementDate: new Date(),
                operation: 'entrada',
                fromDepositId: movementDeposit,
                sourceModule: 'pdv',
                sourceScreen: 'PDV',
                sourceAction: 'cancelamento_venda',
                sourceType: 'pdv_sale_cancellation_reversal',
                referenceDocument: sale?.saleCode || saleId,
                metadata: {
                  ...(movementContext?.metadata || {}),
                  saleId,
                },
              },
            });
          }
        }
        result.revertedSales.push(saleId);
      }
      sale.inventoryProcessed = false;
      sale.inventoryProcessedAt = null;
      continue;
    }

    if (Boolean(sale.inventoryProcessed)) continue;

    const productQuantities = collectSaleProductQuantities(sale);
    if (!productQuantities.size) {
      sale.inventoryProcessed = true;
      sale.inventoryProcessedAt = sale.inventoryProcessedAt
        ? safeDate(sale.inventoryProcessedAt)
        : new Date();
      continue;
    }

    const movementItems = [];
    for (const [productKey, quantity] of productQuantities.entries()) {
      const productObjectId = toObjectIdOrNull(productKey);
      const numericQuantity = Number(quantity) || 0;
      if (!productObjectId || numericQuantity <= 0) continue;
      const adjustment = await updateProductStockForDeposit({
        productId: productObjectId,
        depositId: depositObjectId,
        quantity: numericQuantity,
        cascadeFractional: true,
        movementContext: {
          ...movementContext,
          movementDate: new Date(),
          operation: 'saida',
          fromDepositId: depositObjectId,
          sourceModule: 'pdv',
          sourceScreen: 'PDV',
          sourceAction: 'finalizar_venda',
          sourceType: 'pdv_sale',
          referenceDocument: sale?.saleCode || saleId,
          metadata: {
            ...(movementContext?.metadata || {}),
            saleId,
          },
        },
      });
      const appliedOperations = Array.isArray(adjustment?.operations)
        ? adjustment.operations
        : [];
      for (const operation of appliedOperations) {
        const opProductId = operation?.product ? toObjectIdOrNull(operation.product) : null;
        const opQuantity = Number(operation?.quantity) || 0;
        if (!opProductId || opQuantity === 0) continue;
        movementItems.push({ product: opProductId, quantity: opQuantity });
      }
    }

    if (movementItems.length) {
      const processedAt = new Date();
      sale.inventoryProcessed = true;
      sale.inventoryProcessedAt = processedAt;
      result.movements.push({
        saleId: sale.id,
        deposit: depositObjectId,
        processedAt,
        items: movementItems,
      });
    } else {
      sale.inventoryProcessed = true;
      sale.inventoryProcessedAt = new Date();
    }
  }

  return result;
};

const mergeInventoryProcessingStatus = (sales, existingSales) => {
  if (!Array.isArray(sales)) return [];
  const existingMap = new Map();
  if (Array.isArray(existingSales)) {
    for (const sale of existingSales) {
      if (sale && typeof sale === 'object' && sale.id) {
        existingMap.set(sale.id, sale);
      }
    }
  }

  return sales.map((sale) => {
    if (!sale || typeof sale !== 'object' || !sale.id) {
      return sale;
    }
    const previous = existingMap.get(sale.id);
    if (previous) {
      const previousProcessed = Boolean(previous.inventoryProcessed);
      const currentProcessed = Boolean(sale.inventoryProcessed);
      const saleStatus = normalizeString(sale.status).toLowerCase();
      if (saleStatus === 'cancelled') {
        sale.inventoryProcessed = currentProcessed;
        if (sale.inventoryProcessed) {
          const currentDate = safeDate(sale.inventoryProcessedAt);
          const previousDate = safeDate(previous.inventoryProcessedAt);
          sale.inventoryProcessedAt = currentDate || previousDate || null;
        } else {
          sale.inventoryProcessedAt = null;
        }
      } else {
        sale.inventoryProcessed = previousProcessed || currentProcessed;
        if (sale.inventoryProcessed) {
          const previousDate = safeDate(previous.inventoryProcessedAt);
          const currentDate = safeDate(sale.inventoryProcessedAt);
          sale.inventoryProcessedAt = previousDate || currentDate || null;
        } else {
          sale.inventoryProcessedAt = null;
        }
      }
    } else {
      sale.inventoryProcessed = Boolean(sale.inventoryProcessed);
      sale.inventoryProcessedAt = sale.inventoryProcessed
        ? safeDate(sale.inventoryProcessedAt) || new Date()
        : null;
    }
    return sale;
  });
};

const escapeXml = (value) => {
  if (value === undefined || value === null) {
    return '';
  }
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
};

const sanitizeFileName = (value, fallback = 'documento.xml') => {
  const base = value === undefined || value === null ? '' : String(value);
  const normalized = base
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .trim();
  const trimmed = normalized || fallback;
  return trimmed.length > 120 ? trimmed.slice(0, 120) : trimmed;
};

const formatDateTimeLabel = (date) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const normalizePaymentSnapshotPayload = (snapshot) => {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const idSource =
    snapshot.id ||
    snapshot._id ||
    snapshot.code ||
    snapshot.codigo ||
    snapshot.label ||
    snapshot.nome ||
    snapshot.name;
  const id = normalizeString(idSource);
  const labelSource =
    snapshot.label ||
    snapshot.nome ||
    snapshot.name ||
    snapshot.descricao ||
    snapshot.description ||
    id ||
    'Meio de pagamento';
  const label = normalizeString(labelSource) || 'Meio de pagamento';
  const type = normalizeString(snapshot.type || snapshot.tipo).toLowerCase();
  const aliases = Array.isArray(snapshot.aliases)
    ? snapshot.aliases.map((alias) => normalizeString(alias)).filter(Boolean)
    : [];
  const valor = safeNumber(snapshot.valor ?? snapshot.value ?? snapshot.total ?? 0, 0);
  const parcelasRaw = snapshot.parcelas ?? snapshot.installments ?? 1;
  const parcelas = Math.max(1, Number.parseInt(parcelasRaw, 10) || 1);
  return {
    id: id || label,
    label,
    type: type || 'avista',
    aliases,
    valor,
    parcelas,
  };
};

const normalizeHistoryEntryPayload = (entry) => {
  if (!entry || typeof entry !== 'object') return null;
  const id = normalizeString(entry.id || entry._id);
  const label = normalizeString(entry.label || entry.descricao || entry.tipo) || 'MovimentaÃ§Ã£o';
  const amount = safeNumber(entry.amount ?? entry.valor ?? entry.delta ?? 0, 0);
  const delta = safeNumber(entry.delta ?? entry.valor ?? amount, 0);
  const motivo = normalizeString(entry.motivo || entry.observacao);
  const paymentLabel = normalizeString(entry.paymentLabel || entry.meioPagamento || entry.formaPagamento);
  const paymentId = normalizeString(entry.paymentId || entry.formaPagamentoId || entry.payment || entry.paymentMethodId);
  const userId = normalizeString(entry.userId || entry.usuarioId || entry.responsavelId || entry.user?._id || entry.user?.id);
  const userName = normalizeString(
    entry.userName ||
    entry.nomeUsuario ||
    entry.usuario ||
    entry.responsavel ||
    entry.user?.nome ||
    entry.user?.name
  );
  const userLogin = normalizeString(entry.userLogin || entry.login || entry.user?.login || entry.user?.email);
  const timestamp = safeDate(entry.timestamp || entry.data || entry.createdAt || entry.atualizadoEm) || new Date();
  return {
    id: id || undefined,
    label,
    amount,
    delta,
    motivo,
    paymentLabel,
    paymentId,
    userId,
    userName,
    userLogin,
    responsavel: userName || userLogin || '',
    timestamp,
  };
};

const normalizeSaleRecordPayload = (record) => {
  if (!record || typeof record !== 'object') return null;
  const id = normalizeString(record.id || record._id) || `sale-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const type = normalizeString(record.type) || 'venda';
  const typeLabel = normalizeString(record.typeLabel) || (type === 'delivery' ? 'Delivery' : 'Venda');
  const saleCode = normalizeString(record.saleCode);
  const saleCodeLabel = normalizeString(record.saleCodeLabel) || saleCode || 'Sem cÃ³digo';
  const customerName =
    normalizeString(record.customerName) || normalizeString(record.cliente) || 'Cliente nÃ£o informado';
  const customerDocument = normalizeString(record.customerDocument);
  const sellerSource = record.seller || record.vendedor || null;
  const sellerName =
    normalizeString(record.sellerName || record.vendedorNome) ||
    normalizeString(sellerSource?.nome || sellerSource?.name);
  const sellerCode =
    normalizeString(
      record.sellerCode ||
        record.vendedorCodigo ||
        sellerSource?.codigo ||
        sellerSource?.codigoCliente ||
        sellerSource?.id
    ) || '';
  const paymentTagsFromRecord = Array.isArray(record.paymentTags)
    ? record.paymentTags.map((tag) => normalizeString(tag)).filter(Boolean)
    : [];
  const paymentTags =
    paymentTagsFromRecord.length > 0
      ? paymentTagsFromRecord
      : buildPaymentTagsFromPayments(record.payments);
  const items = Array.isArray(record.items)
    ? record.items.map((item) => (item && typeof item === 'object' ? { ...item } : item))
    : [];
  const discountValue = safeNumber(record.discountValue ?? record.desconto ?? 0, 0);
  const discountLabel = normalizeString(record.discountLabel);
  const additionValue = safeNumber(record.additionValue ?? record.acrescimo ?? 0, 0);
  const totalBruto = safeNumber(
    record.totalBruto ??
      record.totalProdutos ??
      record.receiptSnapshot?.totais?.totalBruto ??
      record.receiptSnapshot?.totais?.bruto ??
      record.receiptSnapshot?.totais?.totalProdutos ??
      0,
    0
  );
  const totalLiquido = safeNumber(
    record.totalLiquido ??
      record.total ??
      record.totalVenda ??
      record.totalGeral ??
      record.valorTotal ??
      record.totalAmount ??
      record.receiptSnapshot?.totais?.totalLiquido ??
      record.receiptSnapshot?.totais?.liquido ??
      record.receiptSnapshot?.totais?.total ??
      record.receiptSnapshot?.totais?.totalVenda ??
      record.receiptSnapshot?.totais?.totalGeral ??
      record.receiptSnapshot?.totais?.pago ??
      0,
    0
  );
  const total = totalLiquido || safeNumber(record.total ?? record.totalAmount ?? record.valorTotal ?? 0, 0);
  const createdAt = safeDate(record.createdAt) || new Date();
  const createdAtLabel = normalizeString(record.createdAtLabel);
  const fiscalStatus = normalizeString(record.fiscalStatus);
  const fiscalEmittedAt = safeDate(record.fiscalEmittedAt);
  const fiscalEmittedAtLabel = normalizeString(record.fiscalEmittedAtLabel);
  const fiscalDriveFileId = normalizeString(record.fiscalDriveFileId);
  const fiscalXmlUrl = normalizeString(record.fiscalXmlUrl);
  const fiscalXmlName = normalizeString(record.fiscalXmlName);
  const fiscalXmlContent = normalizeString(record.fiscalXmlContent);
  const fiscalQrCodeData = normalizeString(record.fiscalQrCodeData);
  const fiscalQrCodeImage = normalizeString(record.fiscalQrCodeImage);
  const fiscalEnvironment = normalizeString(record.fiscalEnvironment);
  const fiscalSerie = normalizeString(record.fiscalSerie);
  const fiscalAccessKey = normalizeString(record.fiscalAccessKey);
  const fiscalDigestValue = normalizeString(record.fiscalDigestValue);
  const fiscalSignature = normalizeString(record.fiscalSignature);
  const fiscalProtocol = normalizeString(record.fiscalProtocol);
  const fiscalItemsSnapshot = Array.isArray(record.fiscalItemsSnapshot || record.fiscalItems)
    ? (record.fiscalItemsSnapshot || record.fiscalItems).map((item) =>
        item && typeof item === 'object' ? { ...item } : item
      )
    : [];
  const fiscalNumberParsed =
    record.fiscalNumber === undefined || record.fiscalNumber === null
      ? null
      : Number(record.fiscalNumber);
  const fiscalNumber = Number.isFinite(fiscalNumberParsed)
    ? Math.trunc(fiscalNumberParsed)
    : null;
  const status = normalizeString(record.status) || 'completed';
  const cancellationReason = normalizeString(record.cancellationReason);
  const cancellationAt = safeDate(record.cancellationAt);
  const cancellationAtLabel = normalizeString(record.cancellationAtLabel);
  const inventoryProcessed = Boolean(record.inventoryProcessed);
  const inventoryProcessedAt = inventoryProcessed ? safeDate(record.inventoryProcessedAt) : null;
  const cashContributionsSource = Array.isArray(record.cashContributions)
    ? record.cashContributions
    : Array.isArray(record.caixaContributions)
    ? record.caixaContributions
    : Array.isArray(record.receiptSnapshot?.pagamentos?.items)
    ? record.receiptSnapshot.pagamentos.items
    : [];
  const cashContributions = cashContributionsSource
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const paymentId = normalizeString(entry.paymentId || entry.id || entry.label);
      const paymentLabel = normalizeString(entry.paymentLabel || entry.label) || '';
      const amount = safeNumber(entry.amount ?? entry.valor ?? entry.total ?? 0, 0);
      if (!(amount > 0)) {
        return null;
      }
      return {
        paymentId,
        paymentLabel,
        amount,
      };
    })
    .filter(Boolean);
  const receivables = Array.isArray(record.receivables)
    ? record.receivables
        .map((entry) => normalizeReceivableRecordPayload(entry))
        .filter(Boolean)
    : [];
  return {
    id,
    type,
    typeLabel,
    saleCode,
    saleCodeLabel,
    customerName,
    customerDocument,
    seller: sellerSource && typeof sellerSource === 'object' ? { ...sellerSource } : null,
    sellerName: sellerName || '',
    sellerCode,
    paymentTags,
    items,
    discountValue,
    discountLabel,
    additionValue,
    total,
    totalLiquido,
    totalBruto,
    createdAt,
    createdAtLabel,
    receiptSnapshot: record.receiptSnapshot || null,
    fiscalStatus,
    fiscalEmittedAt,
    fiscalEmittedAtLabel,
    fiscalDriveFileId,
    fiscalXmlUrl,
    fiscalXmlName,
    fiscalXmlContent,
    fiscalQrCodeData,
    fiscalQrCodeImage,
    fiscalEnvironment,
    fiscalSerie,
    fiscalAccessKey,
    fiscalDigestValue,
    fiscalSignature,
    fiscalProtocol,
    fiscalItemsSnapshot,
    fiscalNumber,
    expanded: Boolean(record.expanded),
    status,
    cancellationReason,
    cancellationAt,
    cancellationAtLabel,
    inventoryProcessed,
    inventoryProcessedAt,
    cashContributions,
    receivables,
  };
};

const normalizeBudgetRecordPayload = (budget, { useDefaults = false } = {}) => {
  if (!budget || typeof budget !== 'object') return null;

  let id = normalizeString(
    budget.id || budget._id || budget.code || budget.codigo || budget.numero || budget.identificador
  );

  if (!id && useDefaults) {
    id = `orc-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  }

  if (!id) {
    return null;
  }

  const codeSource =
    budget.code || budget.codigo || budget.numero || budget.identificador || budget.label || id;
  const code = normalizeString(codeSource) || id;

  const createdAt =
    safeDate(
      budget.createdAt || budget.criadoEm || budget.criadoAt || budget.created_at || budget.created_at_em
    ) || (useDefaults ? new Date() : null);
  const updatedAt =
    safeDate(budget.updatedAt || budget.atualizadoEm || budget.updated_at || budget.atualizadoAt) ||
    (useDefaults ? new Date() : null);

  const validitySource =
    budget.validityDays ??
    budget.validadeDias ??
    budget.validade ??
    budget.validadeEmDias ??
    budget.validade_orcamento;
  const parsedValidity =
    validitySource === null || validitySource === undefined || validitySource === ''
      ? null
      : Number.parseInt(validitySource, 10);
  const validityDays = Number.isFinite(parsedValidity) ? parsedValidity : null;

  let validUntil = safeDate(
    budget.validUntil ||
      budget.validadeAte ||
      budget.validadeFim ||
      budget.expiraEm ||
      budget.dataValidade ||
      budget.validade
  );

  if (!validUntil && validityDays && createdAt instanceof Date && !Number.isNaN(createdAt.getTime())) {
    validUntil = new Date(createdAt.getTime() + validityDays * 24 * 60 * 60 * 1000);
  }

  const total = safeNumber(budget.total ?? budget.valorTotal ?? budget.valor ?? 0, 0);
  const discount = safeNumber(budget.discount ?? budget.desconto ?? 0, 0);
  const addition = safeNumber(budget.addition ?? budget.acrescimo ?? 0, 0);

  const customer =
    budget.customer && typeof budget.customer === 'object'
      ? { ...budget.customer }
      : budget.cliente && typeof budget.cliente === 'object'
      ? { ...budget.cliente }
      : null;

  const pet =
    budget.pet && typeof budget.pet === 'object'
      ? { ...budget.pet }
      : budget.petCliente && typeof budget.petCliente === 'object'
      ? { ...budget.petCliente }
      : null;

  const itemsSource = Array.isArray(budget.items) ? budget.items : Array.isArray(budget.itens) ? budget.itens : [];
  const items = itemsSource.map((item) => (item && typeof item === 'object' ? { ...item } : item));

  const paymentsSource = Array.isArray(budget.payments)
    ? budget.payments
    : Array.isArray(budget.pagamentos)
    ? budget.pagamentos
    : [];
  const payments = paymentsSource.map((payment) => (payment && typeof payment === 'object' ? { ...payment } : payment));
  const sellerSource =
    budget.seller && typeof budget.seller === 'object'
      ? { ...budget.seller }
      : budget.vendedor && typeof budget.vendedor === 'object'
      ? { ...budget.vendedor }
      : null;
  const sellerName =
    normalizeString(budget.sellerName || budget.vendedorNome) ||
    normalizeString(sellerSource?.nome || sellerSource?.name);
  const sellerCode =
    normalizeString(
      budget.sellerCode || budget.vendedorCodigo || sellerSource?.codigo || sellerSource?.codigoCliente || sellerSource?.id
    ) || '';
  const seller =
    sellerSource ||
    (sellerName || sellerCode
      ? {
          ...(sellerCode ? { codigo: sellerCode } : {}),
          ...(sellerName ? { nome: sellerName } : {}),
        }
      : null);

  const paymentLabel =
    normalizeString(budget.paymentLabel || budget.meioPagamento || budget.formaPagamento || budget.condicaoPagamento) || '';
  const status = normalizeString(budget.status || budget.situacao) || (useDefaults ? 'aberto' : '');
  const importedAt = safeDate(budget.importedAt || budget.importadoEm || budget.imported_at) || null;
  const finalizedAt = safeDate(
    budget.finalizedAt || budget.finalizadoEm || budget.finalized_at || budget.finalizacaoEm
  ) || null;
  const finalizedSaleId = normalizeString(
    budget.finalizedSaleId || budget.finalizedSale || budget.vendaFinalizadaId
  );

  return {
    id,
    code,
    createdAt,
    updatedAt,
    validityDays,
    validUntil: validUntil || null,
    total,
    discount,
    addition,
    customer,
    pet,
    seller,
    sellerName: sellerName || '',
    sellerCode,
    items,
    payments,
    paymentLabel,
    status: status || 'aberto',
    importedAt,
    finalizedAt,
    finalizedSaleId,
  };
};

const normalizePrintPreference = (value, fallback = 'PM') => {
  const normalized = normalizeString(value).toUpperCase();
  if (!normalized) return fallback;
  const allowed = new Set(['M', 'F', 'PM', 'PF', 'FM', 'FF', 'NONE']);
  return allowed.has(normalized) ? normalized : fallback;
};

const normalizeDeliveryOrderPayload = (order) => {
  if (!order || typeof order !== 'object') return null;
  return { ...order };
};

const buildStateUpdatePayload = ({ body = {}, existingState = {}, empresaId }) => {
  const caixaAberto = resolveCaixaAbertoValue(body, existingState);
  const summarySource = body.summary || body.caixa?.resumo || {};
  const caixaSource = body.caixaInfo || body.caixa || {};
  const pagamentosSource = Array.isArray(body.pagamentos) ? body.pagamentos : body.caixa?.pagamentos;
  const historicoSource = Array.isArray(body.history) ? body.history : body.caixa?.historico;
  const vendasSource = Array.isArray(body.completedSales) ? body.completedSales : body.caixa?.vendas;
  const previstoSource = caixaSource.previstoPagamentos || caixaSource.pagamentosPrevistos;
  const apuradoSource = caixaSource.apuradoPagamentos || caixaSource.pagamentosApurados;
  const lastMovementSource = body.lastMovement || body.caixa?.ultimoLancamento;
  const accountsReceivableSource =
    Array.isArray(body.accountsReceivable)
      ? body.accountsReceivable
      : Array.isArray(body.caixa?.accountsReceivable)
      ? body.caixa.accountsReceivable
      : existingState.accountsReceivable || [];
  const saleCodeIdentifier =
    normalizeString(body.saleCodeIdentifier || body.saleCode?.identifier || caixaSource.saleCodeIdentifier) ||
    existingState.saleCodeIdentifier ||
    '';
  const saleCodeSequenceRaw =
    body.saleCodeSequence ?? body.saleCode?.sequence ?? caixaSource.saleCodeSequence ?? existingState.saleCodeSequence;
  const saleCodeSequence = Number.parseInt(saleCodeSequenceRaw, 10);
  const printPreferencesSource =
    (body.printPreferences && typeof body.printPreferences === 'object' && body.printPreferences) ||
    existingState.printPreferences ||
    {};
  const budgetsSource =
    Array.isArray(body.budgets)
      ? body.budgets
      : Array.isArray(body.orcamentos)
      ? body.orcamentos
      : existingState.budgets || [];
  const deliveryOrdersSource =
    Array.isArray(body.deliveryOrders)
      ? body.deliveryOrders
      : Array.isArray(body.caixa?.deliveryOrders)
      ? body.caixa.deliveryOrders
      : existingState.deliveryOrders || [];
  const budgetSequenceRaw =
    body.budgetSequence ??
    body.orcamentoSequencia ??
    body.budgetsSequence ??
    existingState.budgetSequence ??
    1;
  const parsedBudgetSequence = Number.parseInt(budgetSequenceRaw, 10);
  const budgetSequence = Number.isFinite(parsedBudgetSequence) && parsedBudgetSequence > 0
    ? parsedBudgetSequence
    : existingState.budgetSequence || 1;

  return {
    empresa: empresaId,
    caixaAberto,
    summary: {
      abertura: safeNumber(
        summarySource.abertura ?? summarySource.valorAbertura ?? body.abertura ?? existingState.summary?.abertura ?? 0,
        0
      ),
      recebido: safeNumber(summarySource.recebido ?? existingState.summary?.recebido ?? 0, 0),
      recebimentosCliente: safeNumber(
        summarySource.recebimentosCliente ?? existingState.summary?.recebimentosCliente ?? 0,
        0
      ),
      saldo: safeNumber(summarySource.saldo ?? existingState.summary?.saldo ?? 0, 0),
    },
    caixaInfo: {
      aberturaData: resolveOptionalDateField(
        caixaSource,
        ['aberturaData', 'dataAbertura', 'abertura'],
        existingState.caixaInfo?.aberturaData
      ),
      fechamentoData: resolveOptionalDateField(
        caixaSource,
        ['fechamentoData', 'dataFechamento', 'fechamento'],
        existingState.caixaInfo?.fechamentoData
      ),
      fechamentoPrevisto: safeNumber(caixaSource.fechamentoPrevisto ?? caixaSource.valorPrevisto ?? existingState.caixaInfo?.fechamentoPrevisto ?? 0, 0),
      fechamentoApurado: safeNumber(caixaSource.fechamentoApurado ?? caixaSource.valorApurado ?? existingState.caixaInfo?.fechamentoApurado ?? 0, 0),
      previstoPagamentos: (Array.isArray(previstoSource) ? previstoSource : [])
        .map(normalizePaymentSnapshotPayload)
        .filter(Boolean),
      apuradoPagamentos: (Array.isArray(apuradoSource) ? apuradoSource : [])
        .map(normalizePaymentSnapshotPayload)
        .filter(Boolean),
    },
    pagamentos: (Array.isArray(pagamentosSource) ? pagamentosSource : [])
      .map(normalizePaymentSnapshotPayload)
      .filter(Boolean),
    history: (Array.isArray(historicoSource) ? historicoSource : [])
      .map(normalizeHistoryEntryPayload)
      .filter(Boolean),
    completedSales: (Array.isArray(vendasSource) ? vendasSource : [])
      .map(normalizeSaleRecordPayload)
      .filter(Boolean),
    budgets: (Array.isArray(budgetsSource) ? budgetsSource : [])
      .map((budget) => normalizeBudgetRecordPayload(budget, { useDefaults: true }))
      .filter(Boolean),
    deliveryOrders: (Array.isArray(deliveryOrdersSource) ? deliveryOrdersSource : [])
      .map(normalizeDeliveryOrderPayload)
      .filter(Boolean),
    accountsReceivable: (Array.isArray(accountsReceivableSource) ? accountsReceivableSource : [])
      .map(normalizeReceivableRecordPayload)
      .filter(Boolean),
    lastMovement: normalizeHistoryEntryPayload(lastMovementSource) || null,
    saleCodeIdentifier,
    saleCodeSequence: Number.isFinite(saleCodeSequence) && saleCodeSequence > 0
      ? saleCodeSequence
      : existingState.saleCodeSequence || 1,
    budgetSequence,
    printPreferences: {
      fechamento: normalizePrintPreference(printPreferencesSource.fechamento || 'PM'),
      venda: normalizePrintPreference(printPreferencesSource.venda || 'PM'),
    },
  };
};

const serializeStateForResponse = (stateDoc) => {
  if (!stateDoc) {
    return {
      caixa: {
        aberto: false,
        status: 'fechado',
        valorAbertura: 0,
        valorPrevisto: 0,
        valorApurado: 0,
        resumo: { abertura: 0, recebido: 0, saldo: 0 },
        pagamentos: [],
        historico: [],
        previstoPagamentos: [],
        apuradoPagamentos: [],
        aberturaData: null,
        fechamentoData: null,
        fechamentoPrevisto: 0,
        fechamentoApurado: 0,
        ultimoLancamento: null,
        saleCodeIdentifier: '',
        saleCodeSequence: 1,
        deliveryOrders: [],
      },
      pagamentos: [],
      summary: { abertura: 0, recebido: 0, recebimentosCliente: 0, saldo: 0 },
      caixaInfo: {
        aberturaData: null,
        fechamentoData: null,
        fechamentoPrevisto: 0,
        fechamentoApurado: 0,
        previstoPagamentos: [],
        apuradoPagamentos: [],
      },
      history: [],
      completedSales: [],
      budgets: [],
      deliveryOrders: [],
      orcamentos: [],
      lastMovement: null,
      saleCodeIdentifier: '',
      saleCodeSequence: 1,
      budgetSequence: 1,
      orcamentoSequencia: 1,
      printPreferences: { fechamento: 'PM', venda: 'PM' },
      updatedAt: null,
    };
  }

  const plain = stateDoc.toObject ? stateDoc.toObject() : stateDoc;
  const summary = plain.summary || {};
  const caixaInfo = plain.caixaInfo || {};
  const pagamentos = Array.isArray(plain.pagamentos) ? plain.pagamentos : [];
  const history = Array.isArray(plain.history) ? plain.history : [];
  const completedSales = Array.isArray(plain.completedSales) ? plain.completedSales : [];
  const budgetsSource = Array.isArray(plain.budgets) ? plain.budgets : [];
  const deliveryOrders = Array.isArray(plain.deliveryOrders) ? plain.deliveryOrders : [];
  const accountsReceivable = Array.isArray(plain.accountsReceivable) ? plain.accountsReceivable : [];
  const budgets = budgetsSource
    .map((budget) => normalizeBudgetRecordPayload(budget, { useDefaults: false }))
    .filter(Boolean);
  const rawBudgetSequence = Number.parseInt(plain.budgetSequence, 10);
  const budgetSequence = Number.isFinite(rawBudgetSequence) && rawBudgetSequence > 0 ? rawBudgetSequence : 1;

  return {
    caixa: {
      aberto: Boolean(plain.caixaAberto),
      status: plain.caixaAberto ? 'aberto' : 'fechado',
      valorAbertura: summary.abertura || 0,
      valorPrevisto: caixaInfo.fechamentoPrevisto || 0,
      valorApurado: caixaInfo.fechamentoApurado || 0,
      resumo: {
        abertura: summary.abertura || 0,
        recebido: summary.recebido || 0,
        recebimentosCliente: summary.recebimentosCliente || 0,
        saldo: summary.saldo || 0,
      },
      pagamentos,
      historico: history,
      previstoPagamentos: caixaInfo.previstoPagamentos || [],
      apuradoPagamentos: caixaInfo.apuradoPagamentos || [],
      aberturaData: caixaInfo.aberturaData || null,
      fechamentoData: caixaInfo.fechamentoData || null,
      fechamentoPrevisto: caixaInfo.fechamentoPrevisto || 0,
      fechamentoApurado: caixaInfo.fechamentoApurado || 0,
      ultimoLancamento: plain.lastMovement || null,
      saleCodeIdentifier: plain.saleCodeIdentifier || '',
      saleCodeSequence: plain.saleCodeSequence || 1,
      deliveryOrders,
    },
    pagamentos,
    summary: {
      abertura: summary.abertura || 0,
      recebido: summary.recebido || 0,
      recebimentosCliente: summary.recebimentosCliente || 0,
      saldo: summary.saldo || 0,
    },
    caixaInfo: {
      aberturaData: caixaInfo.aberturaData || null,
      fechamentoData: caixaInfo.fechamentoData || null,
      fechamentoPrevisto: caixaInfo.fechamentoPrevisto || 0,
      fechamentoApurado: caixaInfo.fechamentoApurado || 0,
      previstoPagamentos: caixaInfo.previstoPagamentos || [],
      apuradoPagamentos: caixaInfo.apuradoPagamentos || [],
    },
    history,
    completedSales,
    budgets,
    deliveryOrders,
    accountsReceivable,
    orcamentos: budgets,
    lastMovement: plain.lastMovement || null,
    saleCodeIdentifier: plain.saleCodeIdentifier || '',
    saleCodeSequence: plain.saleCodeSequence || 1,
    budgetSequence,
    orcamentoSequencia: budgetSequence,
    printPreferences: plain.printPreferences || { fechamento: 'PM', venda: 'PM' },
    updatedAt: plain.updatedAt || null,
  };
};

const buildPdvPayload = ({ body, store }) => {
  const nome = normalizeString(body.nome);
  const apelido = normalizeString(body.apelido);
  const serieNfe = normalizeString(body.serieNfe || body.serieNFE);
  const serieNfce = normalizeString(body.serieNfce || body.serieNFCE);
  const numeroNfeInicial = parseFiscalNumber(body.numeroNfeInicial ?? body.numeroInicialNfe, {
    label: 'NF-e',
  });
  const numeroNfceInicial = parseFiscalNumber(body.numeroNfceInicial ?? body.numeroInicialNfce, {
    label: 'NFC-e',
  });
  const numeroNfeAtual = parseFiscalNumber(body.numeroNfeAtual, {
    label: 'NF-e',
    allowZero: true,
  });
  const numeroNfceAtual = parseFiscalNumber(body.numeroNfceAtual, {
    label: 'NFC-e',
    allowZero: true,
  });
  const observacoes = normalizeString(body.observacoes);
  const ambientesHabilitados = normalizeAmbientes(body.ambientesHabilitados);
  const ambientePadrao = normalizeString(body.ambientePadrao).toLowerCase();
  const ativo = parseBoolean(body.ativo !== undefined ? body.ativo : true);
  const sincronizacaoAutomatica = parseBoolean(body.sincronizacaoAutomatica !== undefined ? body.sincronizacaoAutomatica : true);
  const permitirModoOffline = parseBoolean(body.permitirModoOffline);
  const mostrarParaFuncionarios = parseBoolean(
    body.mostrarParaFuncionarios !== undefined ? body.mostrarParaFuncionarios : true
  );
  let limiteOffline = permitirModoOffline ? parseNumber(body.limiteOffline) : null;
  if (limiteOffline === null && permitirModoOffline) {
    limiteOffline = 0;
  }

  if (limiteOffline !== null && limiteOffline < 0) {
    throw new Error('O limite de emissÃµes offline deve ser maior ou igual a zero.');
  }

  if (!ambientesHabilitados.length) {
    throw new Error('Informe ao menos um ambiente fiscal habilitado.');
  }

  if (!ambientePadrao) {
    throw new Error('Informe o ambiente padrÃ£o de emissÃ£o.');
  }

  if (!ambientesHabilitados.includes(ambientePadrao)) {
    throw new Error('O ambiente padrÃ£o precisa estar entre os ambientes habilitados.');
  }

  for (const env of ambientesHabilitados) {
    if (!storeSupportsEnvironment(store, env)) {
      if (env === 'producao') {
        throw new Error('A empresa selecionada nÃ£o possui CSC configurado para ProduÃ§Ã£o.');
      }
      if (env === 'homologacao') {
        throw new Error('A empresa selecionada nÃ£o possui CSC configurado para HomologaÃ§Ã£o.');
      }
      throw new Error('Ambiente fiscal indisponÃ­vel para a empresa selecionada.');
    }
  }

  if (numeroNfeInicial !== null && numeroNfeAtual !== null && numeroNfeAtual < numeroNfeInicial - 1) {
    throw createValidationError(
      'O nÃºmero atual da NF-e nÃ£o pode ser inferior ao nÃºmero inicial menos um.'
    );
  }

  if (numeroNfceInicial !== null && numeroNfceAtual !== null && numeroNfceAtual < numeroNfceInicial - 1) {
    throw createValidationError(
      'O nÃºmero atual da NFC-e nÃ£o pode ser inferior ao nÃºmero inicial menos um.'
    );
  }

  return {
    nome,
    apelido,
    ativo,
    serieNfe,
    serieNfce,
    numeroNfeInicial,
    numeroNfeAtual,
    numeroNfceInicial,
    numeroNfceAtual,
    ambientesHabilitados,
    ambientePadrao,
    sincronizacaoAutomatica,
    permitirModoOffline,
    mostrarParaFuncionarios,
    limiteOffline,
    observacoes,
  };
};

const parseDateOrNull = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const normalizeCodeToken = (value, fallback = 'PDV') => {
  const raw = String(value || '');
  const normalized = typeof raw.normalize === 'function' ? raw.normalize('NFD') : raw;
  const token = normalized
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase()
    .slice(0, 12);
  return token || fallback;
};

const parseTrailingSequence = (value) => {
  const normalized = normalizeString(value);
  if (!normalized) return 0;
  const match = normalized.match(/(\d+)\s*$/);
  if (!match) return 0;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

const enqueuePdvStateWrite = async (pdvId, task) => {
  const queueKey = normalizeString(pdvId);
  const previous = pdvStateWriteQueues.get(queueKey) || Promise.resolve();
  const current = previous
    .catch(() => {})
    .then(task)
    .finally(() => {
      if (pdvStateWriteQueues.get(queueKey) === current) {
        pdvStateWriteQueues.delete(queueKey);
      }
    });
  pdvStateWriteQueues.set(queueKey, current);
  return current;
};

const LIGHTWEIGHT_STATE_PROJECTION = [
  '_id',
  'pdv',
  'empresa',
  'caixaAberto',
  'summary',
  'caixaInfo',
  'pagamentos',
  'history',
  'lastMovement',
  'saleCodeIdentifier',
  'saleCodeSequence',
  'budgetSequence',
  'printPreferences',
  'recentStateMutationKeys',
  'updatedAt',
].join(' ');

const buildSaleCodeValue = (identifier, sequence) =>
  `${normalizeCodeToken(identifier)}-${String(Math.max(1, Number.parseInt(sequence, 10) || 1)).padStart(
    SALE_CODE_PADDING,
    '0'
  )}`;

const buildBudgetCodeValue = (sequence) =>
  `${BUDGET_CODE_PREFIX}-${String(Math.max(1, Number.parseInt(sequence, 10) || 1)).padStart(
    BUDGET_CODE_PADDING,
    '0'
  )}`;

const resolveSaleCodeIdentifierForPdv = (pdvDoc) =>
  normalizeCodeToken(
    pdvDoc?.codigo || pdvDoc?.apelido || pdvDoc?.nome || pdvDoc?._id || 'PDV',
    'PDV'
  );

const resolveRecordMergeKey = (record, kind = 'generic') => {
  if (!record || typeof record !== 'object') return '';
  const id = normalizeString(record.id || record._id);
  const createdAt = normalizeString(record.createdAt);
  if ((kind === 'sale' || kind === 'budget') && id) {
    return `id:${id}:${createdAt}`;
  }
  if (kind === 'history') {
    const timestamp = normalizeString(record.timestamp);
    const label = normalizeString(record.label);
    const amount = safeNumber(record.amount ?? record.delta ?? 0, 0);
    if (id) return `id:${id}:${timestamp}`;
    if (timestamp || label) return `history:${timestamp}:${label}:${amount}`;
  }
  if (kind === 'receivable') {
    if (id) return `receivable:${id}`;
    const saleId = normalizeString(record.saleId);
    const parcelNumber = Number.parseInt(record.parcelNumber ?? record.parcela ?? 0, 10) || 0;
    if (saleId || parcelNumber) return `receivable:${saleId}:${parcelNumber}`;
  }
  if (id) return `id:${id}`;
  if (kind === 'sale') {
    const code = normalizeString(record.saleCode || record.saleCodeLabel).toUpperCase();
    if (code) return `code:${code}`;
  }
  if (kind === 'budget') {
    const code = normalizeString(record.code).toUpperCase();
    if (code) return `code:${code}`;
  }
  if (kind === 'delivery') {
    if (id) return `delivery:${id}`;
    const saleRecordId = normalizeString(record.saleRecordId);
    if (saleRecordId) return `sale:${saleRecordId}`;
    const saleCode = normalizeString(record.saleCode).toUpperCase();
    if (saleCode) return `code:${saleCode}`;
  }
  return '';
};

const sortRecordsByDateDesc = (records, kind = 'generic') => {
  const resolveDate = (record) => {
    if (!record || typeof record !== 'object') return 0;
    const dateSource =
      kind === 'history'
        ? record.timestamp || record.createdAt || record.updatedAt
        : kind === 'budget'
        ? record.updatedAt || record.createdAt
        : record.createdAt || record.updatedAt;
    const date = dateSource ? new Date(dateSource) : null;
    if (!date || Number.isNaN(date.getTime())) return 0;
    return date.getTime();
  };
  return [...records].sort((a, b) => resolveDate(b) - resolveDate(a));
};

const normalizeReceivableRecordPayload = (entry) => {
  if (!entry || typeof entry !== 'object') return null;
  const parcelNumber = Number.parseInt(entry.parcelNumber ?? entry.parcela ?? entry.numeroParcela, 10);
  const dueDate = safeDate(entry.dueDate ?? entry.vencimento ?? null);
  return {
    id:
      normalizeString(entry.id || entry._id) ||
      `${normalizeString(entry.saleId)}:${Number.isFinite(parcelNumber) && parcelNumber >= 1 ? parcelNumber : 1}`,
    parcelNumber: Number.isFinite(parcelNumber) && parcelNumber >= 1 ? parcelNumber : 1,
    value: safeNumber(entry.value ?? entry.valor ?? entry.amount ?? 0, 0),
    formattedValue: normalizeString(entry.formattedValue),
    dueDate: dueDate || null,
    dueDateLabel: normalizeString(entry.dueDateLabel),
    paymentMethodId: normalizeString(entry.paymentMethodId),
    paymentMethodLabel: normalizeString(entry.paymentMethodLabel),
    contaCorrente:
      entry.contaCorrente && typeof entry.contaCorrente === 'object' ? { ...entry.contaCorrente } : null,
    contaContabil:
      entry.contaContabil && typeof entry.contaContabil === 'object' ? { ...entry.contaContabil } : null,
    saleCode: normalizeString(entry.saleCode),
    crediarioMethodId: normalizeString(entry.crediarioMethodId),
    clienteId: normalizeString(entry.clienteId),
    clienteNome: normalizeString(entry.clienteNome),
    saleId: normalizeString(entry.saleId),
  };
};

const clonePaymentSnapshots = (payments = []) =>
  (Array.isArray(payments) ? payments : [])
    .map((entry) => normalizePaymentSnapshotPayload(entry))
    .filter(Boolean)
    .map((entry) => ({ ...entry }));

const filterHistoryForCurrentCycle = (historyEntries, cycleStart) => {
  if (!Array.isArray(historyEntries)) return [];
  const startDate = safeDate(cycleStart);
  if (!startDate) {
    return historyEntries;
  }
  return historyEntries.filter((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    const timestamp = safeDate(entry.timestamp);
    return Boolean(timestamp) && timestamp.getTime() >= startDate.getTime();
  });
};

const reconcileCashStateFromSales = ({ existingState, updatePayload }) => {
  const sales = Array.isArray(updatePayload?.completedSales) ? updatePayload.completedSales : [];
  const isStartingNewCaixaCycle =
    !Boolean(existingState?.caixaAberto) && Boolean(updatePayload?.caixaAberto);
  if (!Boolean(updatePayload?.caixaAberto) || isStartingNewCaixaCycle) {
    return;
  }
  if (!sales.length && !Array.isArray(existingState?.completedSales)) {
    return;
  }

  const cycleStart = safeDate(
    updatePayload?.caixaInfo?.aberturaData || existingState?.caixaInfo?.aberturaData || null
  );
  const paymentMap = new Map();
  let receivedTotal = 0;
  sales.forEach((sale) => {
    if (!sale || typeof sale !== 'object') return;
    if (normalizeString(sale.status).toLowerCase() === 'cancelled') return;
    if (cycleStart) {
      const saleCreatedAt = safeDate(sale.createdAt);
      if (!saleCreatedAt || saleCreatedAt.getTime() < cycleStart.getTime()) {
        return;
      }
    }
    receivedTotal += safeNumber(sale.totalLiquido ?? sale.total ?? sale.totalBruto ?? 0, 0);
    (Array.isArray(sale.cashContributions) ? sale.cashContributions : []).forEach((entry) => {
      if (!entry || typeof entry !== 'object') return;
      const amount = safeNumber(entry.amount ?? entry.valor ?? entry.total ?? 0, 0);
      if (!(amount > 0)) return;
      const paymentId = normalizeString(entry.paymentId || entry.id);
      const paymentLabel = normalizeString(entry.paymentLabel || entry.label) || 'Pagamento';
      const paymentType = normalizeString(entry.paymentType || entry.type).toLowerCase() || 'avista';
      const key = paymentId || `${paymentLabel}:${paymentType}`;
      if (!paymentMap.has(key)) {
        paymentMap.set(key, {
          id: paymentId || paymentLabel,
          label: paymentLabel,
          type: paymentType,
          aliases: [],
          valor: 0,
          parcelas: 1,
        });
      }
      paymentMap.get(key).valor += amount;
    });
  });

  const mergedPayments = Array.from(paymentMap.values())
    .map((entry) => normalizePaymentSnapshotPayload(entry))
    .filter(Boolean);
  const abertura = safeNumber(updatePayload?.summary?.abertura ?? existingState?.summary?.abertura ?? 0, 0);
  const recebimentosCliente = safeNumber(
    updatePayload?.summary?.recebimentosCliente ?? existingState?.summary?.recebimentosCliente ?? 0,
    0
  );
  const fechamentoPrevisto = mergedPayments.reduce(
    (sum, payment) => sum + safeNumber(payment?.valor ?? 0, 0),
    0
  );

  updatePayload.pagamentos = mergedPayments;
  updatePayload.summary = {
    ...updatePayload.summary,
    abertura,
    recebido: receivedTotal,
    recebimentosCliente,
    saldo: abertura + receivedTotal + recebimentosCliente,
  };
  updatePayload.caixaInfo = {
    ...updatePayload.caixaInfo,
    previstoPagamentos: clonePaymentSnapshots(mergedPayments),
    fechamentoPrevisto,
    apuradoPagamentos: updatePayload.caixaAberto
      ? clonePaymentSnapshots(updatePayload.caixaInfo?.apuradoPagamentos || existingState?.caixaInfo?.apuradoPagamentos || [])
      : clonePaymentSnapshots(mergedPayments),
    fechamentoApurado: updatePayload.caixaAberto
      ? safeNumber(updatePayload.caixaInfo?.fechamentoApurado ?? existingState?.caixaInfo?.fechamentoApurado ?? 0, 0)
      : fechamentoPrevisto,
  };
};

const mergeRecordsByKey = (existingRecords, incomingRecords, kind = 'generic') => {
  const resolveDeliveryStamp = (record) => {
    if (!record || typeof record !== 'object') return 0;
    const raw = record.updatedAt || record.statusUpdatedAt || record.createdAt || '';
    const parsed = raw ? new Date(raw) : null;
    if (!parsed || Number.isNaN(parsed.getTime())) return 0;
    return parsed.getTime();
  };

  const resolveDeliveryCourier = (record) => {
    if (!record || typeof record !== 'object') {
      return { id: '', label: '', hasValue: false };
    }
    const courierRaw = record.courier;
    const courierObj = courierRaw && typeof courierRaw === 'object' ? courierRaw : {};
    const courierId = normalizeString(
      courierObj.id ||
        courierObj._id ||
        record.courierId ||
        record.entregadorId ||
        record.deliveryCourierId ||
        ''
    );
    const courierLabel = normalizeString(
      courierObj.label ||
        courierObj.nome ||
        courierObj.name ||
        (typeof courierRaw === 'string' ? courierRaw : '') ||
        record.courierLabel ||
        record.entregador ||
        record.deliveryCourierLabel ||
        ''
    );
    return {
      id: courierId,
      label: courierLabel,
      hasValue: Boolean(courierId || courierLabel),
    };
  };

  const applyDeliveryCourier = (record, courier) => {
    const next = { ...(record && typeof record === 'object' ? record : {}) };
    const hasValue = Boolean(courier?.id || courier?.label);
    next.courier = hasValue ? { id: courier.id || '', label: courier.label || '' } : null;
    next.courierId = courier?.id || '';
    next.courierLabel = courier?.label || '';
    next.entregadorId = courier?.id || '';
    next.entregador = courier?.label || '';
    next.deliveryCourierId = courier?.id || '';
    next.deliveryCourierLabel = courier?.label || '';
    return next;
  };

  const mergeDeliveryRecordConflict = (existingRecord, incomingRecord) => {
    const existing = existingRecord && typeof existingRecord === 'object' ? existingRecord : {};
    const incoming = incomingRecord && typeof incomingRecord === 'object' ? incomingRecord : {};
    const existingStamp = resolveDeliveryStamp(existing);
    const incomingStamp = resolveDeliveryStamp(incoming);
    const incomingIsNewerOrEqual = incomingStamp >= existingStamp;
    const base = incomingIsNewerOrEqual ? existing : incoming;
    const overlay = incomingIsNewerOrEqual ? incoming : existing;
    const merged = { ...base, ...overlay };
    const baseCourier = resolveDeliveryCourier(base);
    const overlayCourier = resolveDeliveryCourier(overlay);
    // Evita apagar entregador por payload parcial/stale sem courier.
    // Remoção explícita deve ocorrer via comando dedicado de update_courier.
    const shouldApplyOverlayCourier = overlayCourier.hasValue || !baseCourier.hasValue;
    return applyDeliveryCourier(merged, shouldApplyOverlayCourier ? overlayCourier : baseCourier);
  };

  const merged = [];
  const keyIndex = new Map();
  const append = (record, source) => {
    if (!record || typeof record !== 'object') return;
    const key = resolveRecordMergeKey(record, kind);
    if (!key) {
      merged.push(record);
      return;
    }
    const foundIndex = keyIndex.get(key);
    if (foundIndex === undefined) {
      keyIndex.set(key, merged.length);
      merged.push(record);
      return;
    }
    if (source === 'incoming') {
      if (kind === 'delivery') {
        merged[foundIndex] = mergeDeliveryRecordConflict(merged[foundIndex], record);
      } else {
        merged[foundIndex] = record;
      }
    }
  };

  (Array.isArray(existingRecords) ? existingRecords : []).forEach((record) => append(record, 'existing'));
  (Array.isArray(incomingRecords) ? incomingRecords : []).forEach((record) => append(record, 'incoming'));

  return sortRecordsByDateDesc(merged, kind);
};

const dedupeSalesById = (sales) => {
  if (!Array.isArray(sales)) return [];
  const byId = new Map();
  const withoutId = [];
  for (const sale of sales) {
    if (!sale || typeof sale !== 'object') continue;
    const saleId = normalizeString(sale.id || sale._id);
    if (!saleId) {
      withoutId.push(sale);
      continue;
    }
    const previous = byId.get(saleId);
    if (!previous) {
      byId.set(saleId, sale);
      continue;
    }
    const previousUpdatedAt = safeDate(previous.updatedAt || previous.createdAt);
    const currentUpdatedAt = safeDate(sale.updatedAt || sale.createdAt);
    if (
      currentUpdatedAt &&
      (!previousUpdatedAt || currentUpdatedAt.getTime() >= previousUpdatedAt.getTime())
    ) {
      byId.set(saleId, sale);
    }
  }
  return sortRecordsByDateDesc([...byId.values(), ...withoutId], 'sale');
};

const ensureUniquePdvCodes = async ({ pdvId, pdvDoc, sales, budgets, existingSales, existingBudgets }) => {
  const resolvedPdvId = normalizeString(pdvId || pdvDoc?._id);
  if (!resolvedPdvId) {
    return { sales, budgets, nextSaleSequence: 1, nextBudgetSequence: 1 };
  }

  const saleIdentifier = resolveSaleCodeIdentifierForPdv(pdvDoc);
  const saleCounterKey = pdvSaleSequenceKey(resolvedPdvId);
  const budgetCounterKey = pdvBudgetSequenceKey(resolvedPdvId);

  const salesList = Array.isArray(sales) ? sales : [];
  const budgetsList = Array.isArray(budgets) ? budgets : [];
  const existingSaleIdSet = new Set(
    (Array.isArray(existingSales) ? existingSales : [])
      .map((sale) => normalizeString(sale?.id || sale?._id))
      .filter(Boolean)
  );
  const existingBudgetIdSet = new Set(
    (Array.isArray(existingBudgets) ? existingBudgets : [])
      .map((budget) => normalizeString(budget?.id || budget?._id))
      .filter(Boolean)
  );

  let maxSaleSequence = 0;
  salesList.forEach((sale) => {
    const currentCode = normalizeString(sale?.saleCode || sale?.saleCodeLabel);
    if (!currentCode.toUpperCase().startsWith(`${saleIdentifier}-`)) return;
    maxSaleSequence = Math.max(maxSaleSequence, parseTrailingSequence(currentCode));
  });
  await ensureScopedSequenceAtLeast({
    scope: saleCounterKey.scope,
    reference: saleCounterKey.reference,
    value: maxSaleSequence,
  });

  const usedSaleCodes = new Set();
  const orderedSales = [...salesList].sort((a, b) => {
    const aDate = a?.createdAt ? new Date(a.createdAt).getTime() : 0;
    const bDate = b?.createdAt ? new Date(b.createdAt).getTime() : 0;
    if (aDate !== bDate) return aDate - bDate;
    const aId = normalizeString(a?.id || a?._id);
    const bId = normalizeString(b?.id || b?._id);
    return aId.localeCompare(bId);
  });
  for (const sale of orderedSales) {
    if (!sale || typeof sale !== 'object') continue;
    const saleId = normalizeString(sale.id || sale._id);
    const isNewSale = saleId ? !existingSaleIdSet.has(saleId) : true;
    let code = normalizeString(sale.saleCode || sale.saleCodeLabel).toUpperCase();
    const hasValidProvidedCode =
      Boolean(code) &&
      code.startsWith(`${saleIdentifier}-`) &&
      parseTrailingSequence(code) > 0 &&
      !usedSaleCodes.has(code);
    if (!hasValidProvidedCode) {
      let nextSeq = await nextScopedSequence({
        scope: saleCounterKey.scope,
        reference: saleCounterKey.reference,
      });
      code = buildSaleCodeValue(saleIdentifier, nextSeq).toUpperCase();
      while (usedSaleCodes.has(code)) {
        nextSeq = await nextScopedSequence({
          scope: saleCounterKey.scope,
          reference: saleCounterKey.reference,
        });
        code = buildSaleCodeValue(saleIdentifier, nextSeq).toUpperCase();
      }
      sale.saleCode = code;
      sale.saleCodeLabel = code;
      if (sale.receiptSnapshot && typeof sale.receiptSnapshot === 'object') {
        sale.receiptSnapshot.meta = sale.receiptSnapshot.meta || {};
        sale.receiptSnapshot.meta.saleCode = code;
      }
      if (Array.isArray(sale.receivables)) {
        sale.receivables = sale.receivables.map((entry) =>
          entry && typeof entry === 'object' ? { ...entry, saleCode: code } : entry
        );
      }
    } else {
      sale.saleCode = code;
      sale.saleCodeLabel = code;
      if (isNewSale) {
        await ensureScopedSequenceAtLeast({
          scope: saleCounterKey.scope,
          reference: saleCounterKey.reference,
          value: parseTrailingSequence(code),
        });
      }
    }
    usedSaleCodes.add(code);
  }

  let maxBudgetSequence = 0;
  budgetsList.forEach((budget) => {
    const code = normalizeString(budget?.code).toUpperCase();
    if (!code.startsWith(`${BUDGET_CODE_PREFIX}-`)) return;
    maxBudgetSequence = Math.max(maxBudgetSequence, parseTrailingSequence(code));
  });
  await ensureScopedSequenceAtLeast({
    scope: budgetCounterKey.scope,
    reference: budgetCounterKey.reference,
    value: maxBudgetSequence,
  });

  const usedBudgetCodes = new Set();
  const orderedBudgets = [...budgetsList].sort((a, b) => {
    const aDate = a?.createdAt ? new Date(a.createdAt).getTime() : 0;
    const bDate = b?.createdAt ? new Date(b.createdAt).getTime() : 0;
    if (aDate !== bDate) return aDate - bDate;
    const aId = normalizeString(a?.id || a?._id);
    const bId = normalizeString(b?.id || b?._id);
    return aId.localeCompare(bId);
  });
  for (const budget of orderedBudgets) {
    if (!budget || typeof budget !== 'object') continue;
    const budgetId = normalizeString(budget.id || budget._id);
    const isNewBudget = budgetId ? !existingBudgetIdSet.has(budgetId) : true;
    let code = normalizeString(budget.code).toUpperCase();
    const hasValidProvidedCode =
      Boolean(code) &&
      code.startsWith(`${BUDGET_CODE_PREFIX}-`) &&
      parseTrailingSequence(code) > 0 &&
      !usedBudgetCodes.has(code);
    if (!hasValidProvidedCode) {
      let nextSeq = await nextScopedSequence({
        scope: budgetCounterKey.scope,
        reference: budgetCounterKey.reference,
      });
      code = buildBudgetCodeValue(nextSeq).toUpperCase();
      while (usedBudgetCodes.has(code)) {
        nextSeq = await nextScopedSequence({
          scope: budgetCounterKey.scope,
          reference: budgetCounterKey.reference,
        });
        code = buildBudgetCodeValue(nextSeq).toUpperCase();
      }
      budget.code = code;
    } else {
      budget.code = code;
      if (isNewBudget) {
        await ensureScopedSequenceAtLeast({
          scope: budgetCounterKey.scope,
          reference: budgetCounterKey.reference,
          value: parseTrailingSequence(code),
        });
      }
    }
    usedBudgetCodes.add(code);
  }

  const currentSaleSequence = await getScopedSequence({
    scope: saleCounterKey.scope,
    reference: saleCounterKey.reference,
  });
  const currentBudgetSequence = await getScopedSequence({
    scope: budgetCounterKey.scope,
    reference: budgetCounterKey.reference,
  });

  return {
    sales: salesList,
    budgets: budgetsList,
    nextSaleSequence: Math.max(1, currentSaleSequence + 1),
    nextBudgetSequence: Math.max(1, currentBudgetSequence + 1),
  };
};

const syncPdvCaixaSessionHistory = async ({ pdvDoc, existingState, updatedState }) => {
  if (!pdvDoc || !updatedState) return;

  const pdvId = String(updatedState.pdv || pdvDoc._id || '');
  if (!mongoose.Types.ObjectId.isValid(pdvId)) return;

  const prevOpen = Boolean(existingState?.caixaAberto);
  const nextOpen = Boolean(updatedState?.caixaAberto);
  const caixaInfo = updatedState?.caixaInfo || {};
  const aberturaData = parseDateOrNull(caixaInfo?.aberturaData);
  const fechamentoData = parseDateOrNull(caixaInfo?.fechamentoData);

  const baseSet = {
    empresa: updatedState.empresa || pdvDoc.empresa || null,
    pdvNome: pdvDoc.apelido || pdvDoc.nome || '',
    pdvCodigo: pdvDoc.codigo || '',
    status: nextOpen ? 'aberto' : 'fechado',
    caixaAberto: nextOpen,
    aberturaData: aberturaData || null,
    fechamentoData: fechamentoData || null,
    fechamentoPrevisto: Number(caixaInfo?.fechamentoPrevisto || 0),
    fechamentoApurado: Number(caixaInfo?.fechamentoApurado || 0),
    summary: updatedState.summary || {},
    historySnapshot: Array.isArray(updatedState.history) ? updatedState.history : [],
    completedSalesSnapshot: Array.isArray(updatedState.completedSales) ? updatedState.completedSales : [],
    pagamentosSnapshot: Array.isArray(updatedState.pagamentos) ? updatedState.pagamentos : [],
    caixaInfoSnapshot: caixaInfo,
    stateUpdatedAt: updatedState.updatedAt || new Date(),
  };

  if (aberturaData) {
    await PdvCaixaSession.findOneAndUpdate(
      { pdv: pdvId, aberturaData },
      { $set: baseSet, $setOnInsert: { pdv: pdvId } },
      { upsert: true, new: true }
    );
  }

  if (!nextOpen) {
    const openSession = await PdvCaixaSession.findOne({ pdv: pdvId, status: 'aberto' })
      .sort({ aberturaData: -1, updatedAt: -1 });

    if (openSession) {
      openSession.status = 'fechado';
      openSession.caixaAberto = false;
      if (aberturaData && !openSession.aberturaData) {
        openSession.aberturaData = aberturaData;
      }
      if (fechamentoData) {
        openSession.fechamentoData = fechamentoData;
      }
      openSession.fechamentoPrevisto = Number(caixaInfo?.fechamentoPrevisto || 0);
      openSession.fechamentoApurado = Number(caixaInfo?.fechamentoApurado || 0);
      openSession.summary = updatedState.summary || {};
      openSession.caixaInfoSnapshot = caixaInfo;
      openSession.stateUpdatedAt = updatedState.updatedAt || new Date();
      openSession.empresa = updatedState.empresa || pdvDoc.empresa || openSession.empresa;
      openSession.pdvNome = pdvDoc.apelido || pdvDoc.nome || openSession.pdvNome || '';
      openSession.pdvCodigo = pdvDoc.codigo || openSession.pdvCodigo || '';
      await openSession.save();
    } else if (aberturaData || fechamentoData || prevOpen) {
      await PdvCaixaSession.findOneAndUpdate(
        { pdv: pdvId, aberturaData: aberturaData || fechamentoData || new Date(0) },
        { $set: baseSet, $setOnInsert: { pdv: pdvId } },
        { upsert: true, new: true }
      );
    }
  }
};

router.get('/', requireAuth, authorizeRoles('admin'), async (req, res) => {
  try {
    const { empresa } = req.query;
    const query = {};
    if (empresa) {
      query.empresa = empresa;
    }
    if (isBelowFranqueado(req.user?.role)) {
      query.mostrarParaFuncionarios = { $ne: false };
    }
    const pdvs = await Pdv.find(query)
      .sort({ nome: 1 })
      .populate('empresa')
      .lean();
    res.json({ pdvs });
  } catch (error) {
    console.error('Erro ao listar PDVs:', error);
    res.status(500).json({ message: 'Erro ao listar PDVs.' });
  }
});

router.get('/next-code', requireAuth, authorizeRoles('admin'), async (req, res) => {
  try {
    const codigo = await generateNextCode();
    res.json({ codigo });
  } catch (error) {
    console.error('Erro ao gerar prÃ³ximo cÃ³digo de PDV:', error);
    res.status(500).json({ message: 'Erro ao gerar prÃ³ximo cÃ³digo.' });
  }
});

router.get('/:id/caixas', requireAuth, authorizeRoles('admin'), async (req, res) => {
  try {
    const pdvId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(pdvId)) {
      return res.status(400).json({ message: 'PDV invÃ¡lido.' });
    }

    const startDate = parseDateOrNull(req.query.start);
    const endDate = parseDateOrNull(req.query.end);
    const match = { pdv: pdvId };
    if (startDate || endDate) {
      const and = [];
      if (endDate) {
        and.push({
          $or: [
            { aberturaData: { $lte: endDate } },
            { fechamentoData: { $lte: endDate } },
          ],
        });
      }
      if (startDate) {
        and.push({
          $or: [
            { fechamentoData: { $gte: startDate } },
            { fechamentoData: null, aberturaData: { $gte: startDate } },
            { fechamentoData: null, aberturaData: { $lte: startDate } },
          ],
        });
      }
      if (and.length) {
        match.$and = and;
      }
    }

    const sessions = await PdvCaixaSession.find(match)
      .sort({ aberturaData: -1, stateUpdatedAt: -1, updatedAt: -1 })
      .lean();

    res.json({
      caixas: sessions.map((item) => ({
        id: item._id,
        pdv: item.pdv,
        empresa: item.empresa,
        status: item.status || (item.caixaAberto ? 'aberto' : 'fechado'),
        aberto: Boolean(item.caixaAberto),
        aberturaData: item.aberturaData || null,
        fechamentoData: item.fechamentoData || null,
        fechamentoPrevisto: Number(item.fechamentoPrevisto || 0),
        fechamentoApurado: Number(item.fechamentoApurado || 0),
        summary: item.summary || {},
        history: Array.isArray(item.historySnapshot) ? item.historySnapshot : [],
        completedSales: Array.isArray(item.completedSalesSnapshot) ? item.completedSalesSnapshot : [],
        pagamentos: Array.isArray(item.pagamentosSnapshot) ? item.pagamentosSnapshot : [],
        caixaInfo: item.caixaInfoSnapshot || {},
        pdvNome: item.pdvNome || '',
        pdvCodigo: item.pdvCodigo || '',
        atualizadoEm: item.stateUpdatedAt || item.updatedAt || null,
      })),
    });
  } catch (error) {
    console.error('Erro ao listar caixas do PDV:', error);
    res.status(500).json({ message: 'Erro ao listar caixas do PDV.' });
  }
});

router.get('/:id', requireAuth, authorizeRoles('admin'), async (req, res) => {
  try {
    const pdv = await Pdv.findById(req.params.id)
      .populate('empresa')
      .populate('configuracoesEstoque.depositoPadrao')
      .populate('configuracoesFinanceiro.contaCorrente')
      .populate('configuracoesFinanceiro.contaContabilReceber')
      .populate('configuracoesFinanceiro.contaContabilPagar')
      .lean();

    if (!pdv) {
      return res.status(404).json({ message: 'PDV nÃ£o encontrado.' });
    }

    if (isBelowFranqueado(req.user?.role) && pdv.mostrarParaFuncionarios === false) {
      return res.status(404).json({ message: 'PDV nao encontrado.' });
    }

    const state = await PdvState.findOne({ pdv: pdv._id });
    const serializedState = serializeStateForResponse(state);

    const response = {
      ...pdv,
      caixa: {
        ...(pdv.caixa || {}),
        ...serializedState.caixa,
      },
      pagamentos: serializedState.pagamentos,
      summary: serializedState.summary,
      caixaInfo: serializedState.caixaInfo,
      history: serializedState.history,
      completedSales: serializedState.completedSales,
      budgets: serializedState.budgets,
      deliveryOrders: serializedState.deliveryOrders,
      accountsReceivable: serializedState.accountsReceivable,
      orcamentos: serializedState.budgets,
      lastMovement: serializedState.lastMovement,
      saleCodeIdentifier: serializedState.saleCodeIdentifier,
      saleCodeSequence: serializedState.saleCodeSequence,
      budgetSequence: serializedState.budgetSequence,
      orcamentoSequencia: serializedState.budgetSequence,
      printPreferences: serializedState.printPreferences,
      caixaAtualizadoEm: serializedState.updatedAt,
    };

    res.json(response);
  } catch (error) {
    console.error('Erro ao obter PDV:', error);
    res.status(500).json({ message: 'Erro ao obter PDV.' });
  }
});

router.post('/', requireAuth, authorizeRoles('admin', 'admin_master'), async (req, res) => {
  try {
    const empresaId = normalizeString(req.body.empresa || req.body.empresaId);
    const nome = normalizeString(req.body.nome);

    if (!nome) {
      return res.status(400).json({ message: 'O nome do PDV Ã© obrigatÃ³rio.' });
    }
    if (!empresaId) {
      return res.status(400).json({ message: 'Selecione a empresa responsÃ¡vel pelo PDV.' });
    }

    const store = await Store.findById(empresaId).lean();
    if (!store) {
      return res.status(400).json({ message: 'Empresa informada nÃ£o foi encontrada.' });
    }

    let codigo = normalizeString(req.body.codigo);
    if (!codigo) {
      codigo = await generateNextCode();
    }

    const codigoDuplicado = await Pdv.exists({ codigo });
    if (codigoDuplicado) {
      return res.status(409).json({ message: 'JÃ¡ existe um PDV com este cÃ³digo.' });
    }

    let payload;
    try {
      payload = buildPdvPayload({ body: req.body, store });
    } catch (validationError) {
      return res.status(400).json({ message: validationError.message });
    }

    const criadoPor = req.user?.email || req.user?.id || 'Sistema';

    const pdv = await Pdv.create({
      ...payload,
      codigo,
      empresa: empresaId,
      criadoPor,
      atualizadoPor: criadoPor,
    });

    const populated = await pdv.populate('empresa');
    res.status(201).json(populated);
  } catch (error) {
    console.error('Erro ao criar PDV:', error);
    res.status(500).json({ message: 'Erro ao criar PDV.' });
  }
});

router.put('/:id', requireAuth, authorizeRoles('admin', 'admin_master'), async (req, res) => {
  try {
    const pdvId = req.params.id;
    const empresaId = normalizeString(req.body.empresa || req.body.empresaId);
    const nome = normalizeString(req.body.nome);

    if (!nome) {
      return res.status(400).json({ message: 'O nome do PDV Ã© obrigatÃ³rio.' });
    }
    if (!empresaId) {
      return res.status(400).json({ message: 'Selecione a empresa responsÃ¡vel pelo PDV.' });
    }

    const store = await Store.findById(empresaId).lean();
    if (!store) {
      return res.status(400).json({ message: 'Empresa informada nÃ£o foi encontrada.' });
    }

    let payload;
    try {
      payload = buildPdvPayload({ body: req.body, store });
    } catch (validationError) {
      return res.status(400).json({ message: validationError.message });
    }

    const codigo = normalizeString(req.body.codigo);
    if (!codigo) {
      return res.status(400).json({ message: 'O cÃ³digo do PDV Ã© obrigatÃ³rio.' });
    }

    const duplicado = await Pdv.findOne({ codigo, _id: { $ne: pdvId } });
    if (duplicado) {
      return res.status(409).json({ message: 'JÃ¡ existe outro PDV com este cÃ³digo.' });
    }

    const atualizadoPor = req.user?.email || req.user?.id || 'Sistema';

    const updated = await Pdv.findByIdAndUpdate(
      pdvId,
      {
        ...payload,
        codigo,
        empresa: empresaId,
        atualizadoPor,
      },
      { new: true, runValidators: true }
    ).populate('empresa');

    if (!updated) {
      return res.status(404).json({ message: 'PDV nÃ£o encontrado.' });
    }

    res.json(updated);
  } catch (error) {
    console.error('Erro ao atualizar PDV:', error);
    res.status(500).json({ message: 'Erro ao atualizar PDV.' });
  }
});

router.post('/:id/sales/:saleId/fiscal', requireAuth, async (req, res) => {
  let sale = null;
  let emissionDate = null;
  let saleCodeForName = '';
  let state = null;

  try {
    const pdvId = req.params.id;
    const saleId = normalizeString(req.params.saleId);

    if (!mongoose.Types.ObjectId.isValid(pdvId)) {
      return res.status(400).json({ message: 'Identificador de PDV invÃ¡lido.' });
    }

    if (!saleId) {
      return res.status(400).json({ message: 'Identificador da venda Ã© obrigatÃ³rio.' });
    }

    if (!isR2Configured()) {
      return res
        .status(500)
        .json({ message: 'Armazenamento externo nÃ£o estÃ¡ configurado (Cloudflare R2).' });
    }

    const pdv = await Pdv.findById(pdvId).populate('empresa');

    if (!pdv) {
      return res.status(404).json({ message: 'PDV nÃ£o encontrado.' });
    }

    const empresaId = pdv.empresa?._id || pdv.empresa;
    if (!empresaId) {
      return res.status(400).json({ message: 'Empresa vinculada ao PDV nÃ£o foi encontrada.' });
    }

    const empresa = await Store.findById(empresaId).select(
      '+certificadoArquivoCriptografado +certificadoSenhaCriptografada +cscTokenProducaoCriptografado +cscTokenHomologacaoCriptografado'
    );

    if (!empresa) {
      return res.status(400).json({ message: 'Empresa vinculada ao PDV nÃ£o foi encontrada.' });
    }

    if (!empresa.certificadoArquivoCriptografado || !empresa.certificadoSenhaCriptografada) {
      return res.status(400).json({ message: 'A empresa nÃ£o possui certificado digital configurado.' });
    }

    const requestedEnvironment = normalizeString(
      req.body?.environment || req.body?.ambiente || pdv.ambientePadrao
    ).toLowerCase();

    let ambiente = ambientesSet.has(requestedEnvironment)
      ? requestedEnvironment
      : pdv.ambientePadrao || 'homologacao';

    if (!ambientesSet.has(ambiente)) {
      ambiente = 'homologacao';
    }

    const habilitados = Array.isArray(pdv.ambientesHabilitados)
      ? pdv.ambientesHabilitados.map((item) => normalizeString(item).toLowerCase())
      : [];

    if (!habilitados.includes(ambiente)) {
      return res
        .status(400)
        .json({ message: 'O ambiente selecionado nÃ£o estÃ¡ habilitado para este PDV.' });
    }

    if (!storeSupportsEnvironment(empresa, ambiente)) {
      const ambienteLabel = ambiente === 'producao' ? 'ProduÃ§Ã£o' : 'HomologaÃ§Ã£o';
      return res
        .status(400)
        .json({ message: `A empresa nÃ£o possui CSC configurado para ${ambienteLabel}.` });
    }

    state = await PdvState.findOne({ pdv: pdvId });

    if (!state) {
      return res
        .status(404)
        .json({ message: 'Nenhuma venda registrada foi encontrada para este PDV.' });
    }

    sale = Array.isArray(state.completedSales)
      ? state.completedSales.find((entry) => entry && entry.id === saleId)
      : null;

    if (!sale) {
      return res.status(404).json({ message: 'Venda informada nÃ£o foi encontrada.' });
    }

    if (sale.status === 'cancelled') {
      return res
        .status(400)
        .json({ message: 'NÃ£o Ã© possÃ­vel emitir nota fiscal para uma venda cancelada.' });
    }

    if (sale.fiscalStatus === 'emitted' && (sale.fiscalDriveFileId || sale.fiscalXmlUrl)) {
      return res.status(409).json({ message: 'Esta venda jÃ¡ possui XML emitido.' });
    }

    const snapshotFromRequest = req.body?.snapshot;
    if (!sale.receiptSnapshot && snapshotFromRequest) {
      sale.receiptSnapshot = snapshotFromRequest;
    }

    if (!sale.saleCode && req.body?.saleCode) {
      sale.saleCode = normalizeString(req.body.saleCode);
      sale.saleCodeLabel = sale.saleCode || 'Sem cÃ³digo';
    }

    if (!sale.receiptSnapshot) {
      return res
        .status(400)
        .json({ message: 'Snapshot da venda indisponÃ­vel para emissÃ£o fiscal.' });
    }

    const serieNfce = normalizeString(pdv.serieNfce || pdv.serieNfe);

    if (!serieNfce) {
      return res
        .status(400)
        .json({ message: 'Configure a sÃ©rie fiscal do PDV antes de emitir a nota.' });
    }

    const numeroInicialNfce = Number.isInteger(pdv.numeroNfceInicial)
      ? pdv.numeroNfceInicial
      : null;
    const numeroInicialNfe = Number.isInteger(pdv.numeroNfeInicial) ? pdv.numeroNfeInicial : null;
    const numeroInicial = numeroInicialNfce || numeroInicialNfe || null;

    if (!numeroInicial || numeroInicial < 1) {
      return res
        .status(400)
        .json({ message: 'Configure o nÃºmero inicial de emissÃ£o para o PDV.' });
    }

    const numeroAtualNfce = Number.isInteger(pdv.numeroNfceAtual) ? pdv.numeroNfceAtual : null;
    const numeroAtualNfe = Number.isInteger(pdv.numeroNfeAtual) ? pdv.numeroNfeAtual : null;
    const ultimoNumeroEmitido = numeroAtualNfce ?? numeroAtualNfe;
    const baseSequencia =
      ultimoNumeroEmitido !== null && ultimoNumeroEmitido >= numeroInicial - 1
        ? ultimoNumeroEmitido
        : numeroInicial - 1;
    const proximoNumeroFiscal = baseSequencia + 1;

    emissionDate = new Date();
    const storeForXml =
      empresa && typeof empresa.toObject === 'function'
        ? empresa.toObject()
        : empresa || {};
    const emissionResult = await emitPdvSaleFiscal({
      sale,
      pdv,
      store: storeForXml,
      emissionDate,
      environment: ambiente,
      serie: serieNfce,
      numero: proximoNumeroFiscal,
    });

    const transmission = emissionResult.transmission || null;

    const qrCodeImage = await generateQrCodeDataUrl(emissionResult.qrCodePayload);

    saleCodeForName = sale.saleCode || saleId;
    const fileName = buildFiscalXmlFileName({
      accessKey: emissionResult.accessKey || sale.fiscalAccessKey,
      saleCode: saleCodeForName,
      emissionDate,
    });

    const r2Key = buildFiscalR2Key({
      store: storeForXml,
      pdv,
      emissionDate,
      accessKey: emissionResult.accessKey || fileName,
    });

    const uploadResult = await uploadBufferToR2(Buffer.from(emissionResult.xml, 'utf8'), {
      key: r2Key,
      contentType: 'application/xml',
    });

    sale.fiscalStatus = 'emitted';
    sale.fiscalEmittedAt = emissionDate;
    sale.fiscalEmittedAtLabel = formatDateTimeLabel(emissionDate);
    sale.fiscalDriveFileId = uploadResult?.key || r2Key || '';
    sale.fiscalXmlUrl = uploadResult?.url || '';
    sale.fiscalXmlName = fileName;
    sale.fiscalEnvironment = ambiente;
    sale.fiscalSerie = serieNfce;
    sale.fiscalNumber = proximoNumeroFiscal;
    sale.fiscalXmlContent = emissionResult.xml;
    sale.fiscalQrCodeData = emissionResult.qrCodePayload || '';
    sale.fiscalQrCodeImage = qrCodeImage || '';
    sale.fiscalAccessKey = emissionResult.accessKey || '';
    sale.fiscalDigestValue = emissionResult.digestValue || '';
    sale.fiscalSignature = emissionResult.signatureValue || '';
    if (transmission) {
      sale.fiscalProtocol = transmission.protocol || sale.fiscalProtocol || '';
      sale.fiscalReceiptNumber = transmission.receipt || sale.fiscalReceiptNumber || '';
      sale.fiscalSefazStatus = transmission.status || sale.fiscalSefazStatus || '';
      sale.fiscalSefazMessage = transmission.message || sale.fiscalSefazMessage || '';

      if (transmission.processedAt) {
        const processedAt = new Date(transmission.processedAt);
        if (!Number.isNaN(processedAt.getTime())) {
          sale.fiscalSefazProcessedAt = processedAt;
          sale.fiscalSefazProcessedAtLabel = formatDateTimeLabel(processedAt);
        } else {
          sale.fiscalSefazProcessedAt = null;
          sale.fiscalSefazProcessedAtLabel = '';
        }
      } else {
        sale.fiscalSefazProcessedAt = null;
        sale.fiscalSefazProcessedAtLabel = '';
      }
    } else {
      sale.fiscalProtocol = sale.fiscalProtocol || '';
      sale.fiscalReceiptNumber = sale.fiscalReceiptNumber || '';
      sale.fiscalSefazStatus = sale.fiscalSefazStatus || '';
      sale.fiscalSefazMessage = sale.fiscalSefazMessage || '';
      sale.fiscalSefazProcessedAt = sale.fiscalSefazProcessedAt || null;
      sale.fiscalSefazProcessedAtLabel = sale.fiscalSefazProcessedAtLabel || '';
    }

    state.markModified('completedSales');
    await state.save();

    const numeroField = numeroInicialNfce ? 'numeroNfceAtual' : 'numeroNfeAtual';
    await Pdv.updateOne({ _id: pdvId }, { $set: { [numeroField]: proximoNumeroFiscal } });

    res.json({
      id: sale.id,
      fiscalStatus: sale.fiscalStatus,
      fiscalEmittedAt: sale.fiscalEmittedAt,
      fiscalEmittedAtLabel: sale.fiscalEmittedAtLabel,
      fiscalDriveFileId: sale.fiscalDriveFileId,
      fiscalXmlUrl: sale.fiscalXmlUrl,
      fiscalXmlName: sale.fiscalXmlName,
      fiscalEnvironment: sale.fiscalEnvironment,
      fiscalSerie: sale.fiscalSerie,
      fiscalNumber: sale.fiscalNumber,
      fiscalXmlContent: sale.fiscalXmlContent,
      fiscalQrCodeData: sale.fiscalQrCodeData,
      fiscalQrCodeImage: sale.fiscalQrCodeImage,
      fiscalAccessKey: sale.fiscalAccessKey,
      fiscalDigestValue: sale.fiscalDigestValue,
      fiscalSignature: sale.fiscalSignature,
      fiscalProtocol: sale.fiscalProtocol,
      fiscalReceiptNumber: sale.fiscalReceiptNumber,
      fiscalSefazStatus: sale.fiscalSefazStatus,
      fiscalSefazMessage: sale.fiscalSefazMessage,
      fiscalSefazProcessedAt: sale.fiscalSefazProcessedAt,
      fiscalSefazProcessedAtLabel: sale.fiscalSefazProcessedAtLabel,
    });
  } catch (error) {
    console.error('Erro ao emitir nota fiscal do PDV:', error);

    if (state && sale) {
      const fallbackStatus = sale.fiscalStatus === 'emitted' ? 'emitted' : 'pending';
      const shouldResetEmissionData = fallbackStatus !== 'emitted';
      let changed = false;

      if (sale.fiscalStatus !== fallbackStatus) {
        sale.fiscalStatus = fallbackStatus;
        changed = true;
      }

      if (shouldResetEmissionData) {
        const previousSnapshot = {
          emittedAt: sale.fiscalEmittedAt,
          emittedAtLabel: sale.fiscalEmittedAtLabel,
          driveFileId: sale.fiscalDriveFileId,
          xmlUrl: sale.fiscalXmlUrl,
          xmlName: sale.fiscalXmlName,
          xmlContent: sale.fiscalXmlContent,
          qrCodeData: sale.fiscalQrCodeData,
          qrCodeImage: sale.fiscalQrCodeImage,
          accessKey: sale.fiscalAccessKey,
          digest: sale.fiscalDigestValue,
          signature: sale.fiscalSignature,
          protocol: sale.fiscalProtocol,
          receiptNumber: sale.fiscalReceiptNumber,
          sefazStatus: sale.fiscalSefazStatus,
          sefazMessage: sale.fiscalSefazMessage,
          sefazProcessedAt: sale.fiscalSefazProcessedAt,
          sefazProcessedAtLabel: sale.fiscalSefazProcessedAtLabel,
        };

        sale.fiscalEmittedAt = null;
        sale.fiscalEmittedAtLabel = '';
        sale.fiscalDriveFileId = '';
        sale.fiscalXmlUrl = '';
        sale.fiscalXmlName = '';
        sale.fiscalXmlContent = '';
        sale.fiscalQrCodeData = '';
        sale.fiscalQrCodeImage = '';
        sale.fiscalAccessKey = '';
        sale.fiscalDigestValue = '';
        sale.fiscalSignature = '';
        sale.fiscalProtocol = '';
        sale.fiscalReceiptNumber = '';
        sale.fiscalSefazStatus = '';
        sale.fiscalSefazMessage = '';
        sale.fiscalSefazProcessedAt = null;
        sale.fiscalSefazProcessedAtLabel = '';

        changed =
          changed ||
          Boolean(
            previousSnapshot.emittedAt ||
              previousSnapshot.emittedAtLabel ||
              previousSnapshot.driveFileId ||
              previousSnapshot.xmlUrl ||
              previousSnapshot.xmlName ||
              previousSnapshot.xmlContent ||
              previousSnapshot.qrCodeData ||
              previousSnapshot.qrCodeImage ||
              previousSnapshot.accessKey ||
              previousSnapshot.digest ||
              previousSnapshot.signature ||
              previousSnapshot.protocol ||
              previousSnapshot.receiptNumber ||
              previousSnapshot.sefazStatus ||
              previousSnapshot.sefazMessage ||
              previousSnapshot.sefazProcessedAt ||
              previousSnapshot.sefazProcessedAtLabel
          );
      }

      if (changed) {
        try {
          state.markModified('completedSales');
          await state.save();
        } catch (persistError) {
          console.error('Falha ao restaurar status fiscal apÃ³s rejeiÃ§Ã£o:', persistError);
        }
      }
    }

    const message =
      error?.message && typeof error.message === 'string'
        ? error.message
        : 'Erro ao emitir nota fiscal.';
    if (error?.xmlContent) {
      const referenceDate =
        emissionDate instanceof Date && !Number.isNaN(emissionDate.getTime())
          ? emissionDate
          : new Date();
      const baseNameSource =
        error.xmlFileBaseName || saleCodeForName || `NFCe-${referenceDate.getTime()}`;
      const baseName = sanitizeFileName(baseNameSource);
      const fileName = baseName.toLowerCase().endsWith('.xml') ? baseName : `${baseName}.xml`;
      res.set('Content-Type', 'application/xml; charset=utf-8');
      res.set('Content-Disposition', `attachment; filename="${fileName}"`);
      if (message) {
        res.set('X-Error-Message', encodeURIComponent(message));
      }
      return res.status(500).send(error.xmlContent);
    }
    res.status(500).json({ message });
  }
});

router.put('/:id/configuracoes', requireAuth, authorizeRoles('admin', 'admin_master'), async (req, res) => {
  try {
    const pdvId = req.params.id;
    const pdv = await Pdv.findById(pdvId);

    if (!pdv) {
      return res.status(404).json({ message: 'PDV nÃ£o encontrado.' });
    }

    const impressaoPayload = req.body?.impressao || {};
    const vendaPayload = req.body?.venda || {};
    const fiscalPayload = req.body?.fiscal || {};
    const estoquePayload = req.body?.estoque || {};
    const financeiroPayload = req.body?.financeiro || {};

    const sempreImprimir = parseSempreImprimir(impressaoPayload.sempreImprimir);
    const impressoraVenda = buildPrinterPayload(impressaoPayload.impressoraVenda);
    const impressoraOrcamento = buildPrinterPayload(impressaoPayload.impressoraOrcamento);
    const impressoraContas = buildPrinterPayload(impressaoPayload.impressoraContasReceber);
    const impressoraCaixa = buildPrinterPayload(impressaoPayload.impressoraCaixa);

    const perfis = normalizePerfisDesconto(vendaPayload.permitirDesconto);
    const tipoEmissaoPadrao = parseTipoEmissao(fiscalPayload.tipoEmissaoPadrao);

    let depositoPadraoId = null;
    if (estoquePayload.depositoPadrao) {
      depositoPadraoId = normalizeString(estoquePayload.depositoPadrao);
      if (depositoPadraoId) {
        if (!mongoose.Types.ObjectId.isValid(depositoPadraoId)) {
          throw createValidationError('DepÃ³sito selecionado Ã© invÃ¡lido.');
        }
        const deposito = await Deposit.findOne({ _id: depositoPadraoId, empresa: pdv.empresa });
        if (!deposito) {
          throw createValidationError('DepÃ³sito selecionado nÃ£o pertence Ã  mesma empresa do PDV.');
        }
      }
    }

    let contaCorrenteId = null;
    const contaCorrenteRaw = normalizeString(financeiroPayload.contaCorrente);
    if (contaCorrenteRaw) {
      if (!mongoose.Types.ObjectId.isValid(contaCorrenteRaw)) {
        throw createValidationError('Conta corrente selecionada Ã© invÃ¡lida.');
      }
      const contaCorrente = await BankAccount.findOne({
        _id: contaCorrenteRaw,
        company: pdv.empresa,
      });
      if (!contaCorrente) {
        throw createValidationError('Conta corrente selecionada nÃ£o pertence Ã  mesma empresa do PDV.');
      }
      contaCorrenteId = contaCorrente._id;
    }

    let contaContabilReceberId = null;
    const contaContabilReceberRaw = normalizeString(financeiroPayload.contaContabilReceber);
    if (contaContabilReceberRaw) {
      if (!mongoose.Types.ObjectId.isValid(contaContabilReceberRaw)) {
        throw createValidationError('Conta contÃ¡bil de receber selecionada Ã© invÃ¡lida.');
      }
      const contaReceber = await AccountingAccount.findOne({
        _id: contaContabilReceberRaw,
        companies: pdv.empresa,
        paymentNature: 'contas_receber',
      });
      if (!contaReceber) {
        throw createValidationError(
          'Conta contÃ¡bil de receber selecionada nÃ£o pertence Ã  empresa ou nÃ£o estÃ¡ classificada como contas a receber.'
        );
      }
      contaContabilReceberId = contaReceber._id;
    }

    let contaContabilPagarId = null;
    const contaContabilPagarRaw = normalizeString(financeiroPayload.contaContabilPagar);
    if (contaContabilPagarRaw) {
      if (!mongoose.Types.ObjectId.isValid(contaContabilPagarRaw)) {
        throw createValidationError('Conta contÃ¡bil de pagar selecionada Ã© invÃ¡lida.');
      }
      const contaPagar = await AccountingAccount.findOne({
        _id: contaContabilPagarRaw,
        companies: pdv.empresa,
        paymentNature: 'contas_pagar',
      });
      if (!contaPagar) {
        throw createValidationError(
          'Conta contÃ¡bil de pagar selecionada nÃ£o pertence Ã  empresa ou nÃ£o estÃ¡ classificada como contas a pagar.'
        );
      }
      contaContabilPagarId = contaPagar._id;
    }

    pdv.configuracoesImpressao = {
      sempreImprimir,
      impressoraVenda: impressoraVenda || undefined,
      impressoraOrcamento: impressoraOrcamento || undefined,
      impressoraContasReceber: impressoraContas || undefined,
      impressoraCaixa: impressoraCaixa || undefined,
    };

    pdv.configuracoesVenda = {
      permitirDesconto: perfis,
    };

    pdv.configuracoesFiscal = {
      tipoEmissaoPadrao,
    };

    pdv.configuracoesEstoque = {
      depositoPadrao: depositoPadraoId || null,
    };

    pdv.configuracoesFinanceiro = {
      contaCorrente: contaCorrenteId || null,
      contaContabilReceber: contaContabilReceberId || null,
      contaContabilPagar: contaContabilPagarId || null,
    };

    pdv.atualizadoPor = req.user?.email || req.user?.id || 'Sistema';

    await pdv.save();

    await pdv.populate([
      { path: 'empresa' },
      { path: 'configuracoesEstoque.depositoPadrao' },
      { path: 'configuracoesFinanceiro.contaCorrente' },
      { path: 'configuracoesFinanceiro.contaContabilReceber' },
      { path: 'configuracoesFinanceiro.contaContabilPagar' },
    ]);

    res.json(pdv);
  } catch (error) {
    const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
    const message =
      error?.message && typeof error.message === 'string'
        ? error.message
        : 'Erro ao salvar configuraÃ§Ãµes do PDV.';
    console.error('Erro ao salvar configuraÃ§Ãµes do PDV:', error);
    res.status(statusCode).json({ message });
  }
});

const PDV_COMMANDS = Object.freeze({
  REFRESH_STATE: 'pdv.refresh_state',
  CAIXA_OPEN: 'pdv.caixa.open',
  CAIXA_ENTRY: 'pdv.caixa.entry',
  CAIXA_EXIT: 'pdv.caixa.exit',
  CAIXA_SHIPMENT: 'pdv.caixa.shipment',
  CAIXA_CLOSE: 'pdv.caixa.close',
  CAIXA_CLIENT_RECEIPT: 'pdv.caixa.client_receipt',
  SALE_FINALIZE: 'pdv.sale.finalize',
  SALE_SYNC_RECEIVABLES: 'pdv.sale.sync_receivables',
  SALE_RESET_FISCAL_STATUS: 'pdv.sale.reset_fiscal_status',
  BUDGET_SAVE: 'pdv.budget.save',
  BUDGET_FINALIZE: 'pdv.budget.finalize',
  BUDGET_MARK_IMPORTED: 'pdv.budget.mark_imported',
  BUDGET_DELETE: 'pdv.budget.delete',
  SETTINGS_PRINT_PREFERENCES: 'pdv.settings.print_preferences',
  DELIVERY_REGISTER: 'pdv.delivery.register',
  DELIVERY_UPDATE_STATUS: 'pdv.delivery.update_status',
  DELIVERY_UPDATE_COURIER: 'pdv.delivery.update_courier',
  DELIVERY_FINALIZE: 'pdv.delivery.finalize',
  SALE_CANCEL: 'pdv.sale.cancel',
});

const buildPdvCommandMeta = (req) => {
  const idempotencyKey = normalizeString(req.get('x-idempotency-key'));
  return {
    commandId: new mongoose.Types.ObjectId().toString(),
    executedAt: new Date().toISOString(),
    idempotencyKey: idempotencyKey || '',
  };
};

const buildReceivableFingerprint = (entry = {}) => {
  const dueDate = safeDate(entry?.dueDate);
  const dueIso = dueDate ? dueDate.toISOString() : '';
  return [
    normalizeString(entry?.id || ''),
    normalizeString(entry?.saleId || ''),
    String(Number.parseInt(entry?.parcelNumber ?? 0, 10) || 0),
    String(safeNumber(entry?.value ?? 0, 0).toFixed(4)),
    dueIso,
    normalizeString(entry?.paymentMethodId || ''),
    normalizeString(entry?.paymentMethodLabel || ''),
    normalizeString(entry?.saleCode || ''),
  ].join('|');
};

const areReceivablesEquivalent = (left = [], right = []) => {
  const leftList = (Array.isArray(left) ? left : [])
    .map((entry) => normalizeReceivableRecordPayload(entry))
    .filter(Boolean)
    .map((entry) => buildReceivableFingerprint(entry))
    .sort();
  const rightList = (Array.isArray(right) ? right : [])
    .map((entry) => normalizeReceivableRecordPayload(entry))
    .filter(Boolean)
    .map((entry) => buildReceivableFingerprint(entry))
    .sort();
  if (leftList.length !== rightList.length) return false;
  for (let index = 0; index < leftList.length; index += 1) {
    if (leftList[index] !== rightList[index]) return false;
  }
  return true;
};

const parsePdvCommandRequest = (body = {}) => {
  const action = normalizeString(body?.action);
  const payload = body && typeof body === 'object' ? body.payload || {} : {};
  return { action, payload };
};

const normalizeCommandPayments = (payments = []) =>
  (Array.isArray(payments) ? payments : [])
    .map((entry) => normalizePaymentSnapshotPayload(entry))
    .filter(Boolean);

const buildPaymentTagsFromPayments = (payments = []) =>
  Array.from(
    new Set(
      (Array.isArray(payments) ? payments : [])
        .map((payment) => {
          const label = normalizeString(payment?.label || payment?.name || 'Pagamento');
          if (!label) return '';
          const installmentsRaw = Number.parseInt(payment?.parcelas ?? payment?.installments ?? 1, 10);
          const installments =
            Number.isFinite(installmentsRaw) && installmentsRaw > 1 ? installmentsRaw : 1;
          return installments > 1 ? `${label} (${installments}x)` : label;
        })
        .filter(Boolean)
    )
  );

const getCommandHistoryUserMeta = (user = {}) => {
  return {
    userId: normalizeString(user?.id),
    userName: normalizeString(user?.nomeCompleto || user?.apelido || user?.name || ''),
    userLogin: normalizeString(user?.email || ''),
  };
};

const getNextRecentMutationKeys = (existing = [], idempotencyKey = '') => {
  if (!idempotencyKey) return Array.isArray(existing) ? existing : [];
  const keys = new Set(Array.isArray(existing) ? existing : []);
  keys.add(idempotencyKey);
  return Array.from(keys).slice(-100);
};

const cloneCommandPayments = (payments = []) =>
  (Array.isArray(payments) ? payments : []).map((entry) => ({ ...entry }));

const resolveCommandTargetPayment = (payments = [], paymentId = '') => {
  const normalizedId = normalizeString(paymentId);
  const list = Array.isArray(payments) ? payments : [];
  if (!list.length) return null;

  if (!normalizedId) return list[0] || null;

  const matches = (payment = {}) => {
    const candidates = [
      payment?.id,
      payment?.paymentId,
      payment?.code,
      payment?._id,
      payment?.raw?._id,
      payment?.raw?.id,
      payment?.raw?.code,
      payment?.label,
      payment?.name,
      payment?.nome,
    ];
    return candidates.some((candidate) => normalizeString(candidate) === normalizedId);
  };

  return list.find(matches) || null;
};

const buildCaixaMovementHistoryEntry = ({
  movementId,
  movementLabel,
  amount,
  reason,
  paymentLabel,
  timestamp,
  userMeta = {},
}) => ({
  id: movementId,
  label: movementLabel,
  amount: Math.abs(safeNumber(amount, 0)),
  delta:
    movementId === 'saida' || movementId === 'envio'
      ? -Math.abs(safeNumber(amount, 0))
      : Math.abs(safeNumber(amount, 0)),
  motivo: normalizeString(reason),
  paymentLabel: normalizeString(paymentLabel),
  userId: userMeta.userId || '',
  userName: userMeta.userName || '',
  userLogin: userMeta.userLogin || '',
  responsavel: userMeta.userName || userMeta.userLogin || '',
  timestamp,
});

const buildSaleContributionsFromPayments = (payments = []) =>
  (Array.isArray(payments) ? payments : [])
    .map((payment) => {
      const amount = safeNumber(payment?.valor ?? 0, 0);
      if (!(amount > 0)) return null;
      return {
        paymentId: normalizeString(payment?.id || ''),
        paymentLabel: normalizeString(payment?.label || payment?.id || 'Pagamento'),
        amount,
      };
    })
    .filter(Boolean);

const buildSaleHistoryEntry = ({
  saleCode,
  totalLiquido,
  paymentLabel,
  createdAt,
  userMeta = {},
}) =>
  normalizeHistoryEntryPayload({
    id: 'venda',
    label: saleCode ? `Venda ${saleCode} finalizada` : 'Venda finalizada',
    amount: Math.abs(safeNumber(totalLiquido, 0)),
    delta: Math.abs(safeNumber(totalLiquido, 0)),
    motivo: '',
    paymentLabel,
    userId: userMeta.userId || '',
    userName: userMeta.userName || '',
  userLogin: userMeta.userLogin || '',
  timestamp: createdAt,
});

const buildDeliveryOrderId = () => `delivery-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

const findPaymentSnapshotByContribution = (payments = [], contribution = {}) => {
  const paymentId = normalizeString(contribution?.paymentId || '');
  const paymentLabel = normalizeString(contribution?.paymentLabel || '');
  if (paymentId) {
    const byId = payments.find((payment) => normalizeString(payment?.id) === paymentId);
    if (byId) return byId;
  }
  if (paymentLabel) {
    const byLabel = payments.find((payment) => normalizeString(payment?.label) === paymentLabel);
    if (byLabel) return byLabel;
  }
  return null;
};

const buildPaymentCatalogForClosing = (state = {}) => {
  const catalog = new Map();
  const addPayment = (payment = {}) => {
    if (!payment || typeof payment !== 'object') return;
    const normalized = normalizePaymentSnapshotPayload(payment);
    if (!normalized) return;
    const idKey = normalizeString(normalized.id).toLowerCase();
    const labelKey = normalizeString(normalized.label).toLowerCase();
    const key = idKey || labelKey;
    if (!key) return;
    if (!catalog.has(key)) {
      catalog.set(key, {
        ...normalized,
        valor: 0,
      });
      return;
    }
    const current = catalog.get(key);
    if (!normalizeString(current.id) && idKey) current.id = idKey;
    if (!normalizeString(current.label) && normalized.label) current.label = normalized.label;
    if (!normalizeString(current.type) && normalized.type) current.type = normalized.type;
  };

  (Array.isArray(state?.pagamentos) ? state.pagamentos : []).forEach(addPayment);
  (Array.isArray(state?.caixaInfo?.previstoPagamentos) ? state.caixaInfo.previstoPagamentos : []).forEach(addPayment);
  (Array.isArray(state?.caixaInfo?.apuradoPagamentos) ? state.caixaInfo.apuradoPagamentos : []).forEach(addPayment);

  return catalog;
};

const parseOpeningPaymentsFromHistory = (state = {}, paymentCatalog = new Map()) => {
  const history = Array.isArray(state?.history) ? state.history : [];
  const openingEntry = history.find((entry) => normalizeString(entry?.id).toLowerCase() === 'abertura');
  if (!openingEntry) return [];
  const raw = normalizeString(openingEntry?.paymentLabel);
  if (!raw) return [];

  return raw
    .split('|')
    .map((chunk) => normalizeString(chunk))
    .map((chunk) => {
      if (!chunk) return null;
      const match = chunk.match(/^(.*?):\s*([0-9.,-]+)$/);
      if (!match) return null;
      const label = normalizeString(match[1]);
      const rawAmount = normalizeString(match[2]);
      const amount = (() => {
        if (!rawAmount) return 0;
        if (rawAmount.includes(',')) {
          return Math.max(0, safeNumber(rawAmount.replace(/\./g, '').replace(',', '.'), 0));
        }
        return Math.max(0, safeNumber(rawAmount, 0));
      })();
      if (!label || !(amount > 0)) return null;
      const idFromCatalog =
        Array.from(paymentCatalog.values()).find(
          (entry) => normalizeString(entry?.label).toLowerCase() === label.toLowerCase()
        ) || null;
      return {
        id: normalizeString(idFromCatalog?.id) || label,
        label: normalizeString(idFromCatalog?.label) || label,
        type: normalizeString(idFromCatalog?.type) || 'avista',
        valor: amount,
      };
    })
    .filter(Boolean);
};

const buildExpectedClosePaymentsByMethod = (state = {}) => {
  const paymentCatalog = buildPaymentCatalogForClosing(state);
  const amountsByKey = new Map();
  const ensurePaymentInCatalog = (payment = {}) => {
    const normalized = normalizePaymentSnapshotPayload(payment);
    if (!normalized) return null;
    const idKey = normalizeString(normalized.id).toLowerCase();
    const labelKey = normalizeString(normalized.label).toLowerCase();
    const key = idKey || labelKey;
    if (!key) return null;
    if (!paymentCatalog.has(key)) {
      paymentCatalog.set(key, { ...normalized, valor: 0 });
    }
    return key;
  };
  const applyAmount = (payment = {}, delta = 0) => {
    const key = ensurePaymentInCatalog(payment);
    if (!key) return;
    const next = safeNumber(amountsByKey.get(key), 0) + safeNumber(delta, 0);
    amountsByKey.set(key, next);
  };

  const cycleStart = safeDate(state?.caixaInfo?.aberturaData || null);
  parseOpeningPaymentsFromHistory(state, paymentCatalog).forEach((payment) => {
    applyAmount(payment, safeNumber(payment.valor, 0));
  });

  const sales = Array.isArray(state?.completedSales) ? state.completedSales : [];
  sales.forEach((sale) => {
    if (!sale || typeof sale !== 'object') return;
    if (normalizeString(sale.status).toLowerCase() === 'cancelled') return;
    if (cycleStart) {
      const saleDate = safeDate(sale.createdAt || sale.updatedAt || null);
      if (!saleDate || saleDate.getTime() < cycleStart.getTime()) return;
    }
    (Array.isArray(sale.cashContributions) ? sale.cashContributions : []).forEach((entry) => {
      if (!entry || typeof entry !== 'object') return;
      const amount = Math.max(0, safeNumber(entry.amount ?? entry.valor ?? entry.total, 0));
      if (!(amount > 0)) return;
      applyAmount(
        {
          id: normalizeString(entry.paymentId || entry.id),
          label: normalizeString(entry.paymentLabel || entry.label) || 'Pagamento',
          type: normalizeString(entry.paymentType || entry.type) || 'avista',
          valor: amount,
        },
        amount
      );
    });
  });

  const history = Array.isArray(state?.history) ? state.history : [];
  history.forEach((entry) => {
    if (!entry || typeof entry !== 'object') return;
    const movementId = normalizeString(entry.id).toLowerCase();
    if (!['entrada', 'saida', 'envio'].includes(movementId)) return;
    const timestamp = safeDate(entry.timestamp || null);
    if (cycleStart && (!timestamp || timestamp.getTime() < cycleStart.getTime())) return;
    const label = normalizeString(entry.paymentLabel || '');
    if (!label) return;
    const amount = Math.max(0, safeNumber(entry.amount ?? entry.delta, 0));
    if (!(amount > 0)) return;
    const signal = movementId === 'entrada' ? 1 : -1;
    applyAmount(
      {
        id: label,
        label,
        type: 'avista',
      },
      signal * amount
    );
  });

  const expected = Array.from(paymentCatalog.entries()).map(([key, payment]) => {
    const value = Math.max(0, safeNumber(amountsByKey.get(key), 0));
    return normalizePaymentSnapshotPayload({
      ...payment,
      valor: value,
    });
  });

  return expected.filter(Boolean);
};

const isCashPaymentSnapshot = (payment = {}) => {
  const tokens = [
    normalizeString(payment?.id).toLowerCase(),
    normalizeString(payment?.label).toLowerCase(),
    normalizeString(payment?.type).toLowerCase(),
    ...(Array.isArray(payment?.aliases)
      ? payment.aliases.map((alias) => normalizeString(alias).toLowerCase())
      : []),
  ].filter(Boolean);
  return tokens.some((token) =>
    token.includes('dinheiro') ||
    token.includes('cash') ||
    token.includes('especie') ||
    token.includes('moeda')
  );
};

const buildNextOpeningPaymentsFromClose = (payments = []) =>
  normalizeCommandPayments(payments).map((payment) => ({
    ...payment,
    valor: isCashPaymentSnapshot(payment) ? Math.max(0, safeNumber(payment.valor, 0)) : 0,
  }));

const PDV_PERF_LOGS_ENABLED = normalizeString(process.env.PDV_PERF_LOGS || '1') !== '0';
const PDV_SALE_FINALIZE_LEGACY_WRITE =
  normalizeString(process.env.PDV_SALE_FINALIZE_LEGACY_WRITE || '0') === '1';
const PDV_SALE_FINALIZE_PROCESS_ALL_SALES =
  normalizeString(process.env.PDV_SALE_FINALIZE_PROCESS_ALL_SALES || '0') === '1';

const createPdvPerfTracer = ({ scope = 'pdv', pdvId = '', action = '', requestId = '' } = {}) => {
  const startedAt = Date.now();
  let lastMark = startedAt;
  const prefix = `[PDV PERF] [${scope}] pdv=${pdvId || '-'} action=${action || '-'} req=${requestId || '-'}`;
  const mark = (step, extra) => {
    if (!PDV_PERF_LOGS_ENABLED) return;
    const now = Date.now();
    const stepMs = now - lastMark;
    const totalMs = now - startedAt;
    lastMark = now;
    if (extra && typeof extra === 'object') {
      console.info(`${prefix} step=${step} stepMs=${stepMs} totalMs=${totalMs}`, extra);
      return;
    }
    console.info(`${prefix} step=${step} stepMs=${stepMs} totalMs=${totalMs}`);
  };
  const flush = (status = 'ok', extra) => {
    if (!PDV_PERF_LOGS_ENABLED) return;
    const now = Date.now();
    const totalMs = now - startedAt;
    if (extra && typeof extra === 'object') {
      console.info(`${prefix} done=${status} totalMs=${totalMs}`, extra);
      return;
    }
    console.info(`${prefix} done=${status} totalMs=${totalMs}`);
  };
  return { mark, flush };
};

const runPdvCommand = async ({ action, payload, pdvId, pdvDoc, idempotencyKey, user }) => {
  const shouldTraceCommand = action === PDV_COMMANDS.SALE_FINALIZE;
  const perf = createPdvPerfTracer({
    scope: 'runPdvCommand',
    pdvId,
    action,
    requestId: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
  });
  if (shouldTraceCommand) perf.mark('start');
  if (action === PDV_COMMANDS.REFRESH_STATE) {
    const state = await PdvState.findOne({ pdv: pdvId });
    return {
      state: serializeStateForResponse(state),
      shouldEmit: false,
    };
  }

  if (action === PDV_COMMANDS.CAIXA_OPEN) {
    const existingState = await PdvState.findOne({ pdv: pdvId });
    if (
      idempotencyKey &&
      Array.isArray(existingState?.recentStateMutationKeys) &&
      existingState.recentStateMutationKeys.includes(idempotencyKey)
    ) {
      return {
        state: serializeStateForResponse(existingState),
        shouldEmit: false,
      };
    }

    if (Boolean(existingState?.caixaAberto)) {
      const error = new Error('O caixa já está aberto neste PDV.');
      error.statusCode = 409;
      throw error;
    }

    const now = new Date();
    const openingDate = safeDate(payload?.openedAt) || now;
    const normalizedPayments = normalizeCommandPayments(payload?.payments || []);
    if (!normalizedPayments.length) {
      const error = new Error('Informe os meios de pagamento da abertura do caixa.');
      error.statusCode = 400;
      throw error;
    }

    const openingTotal = normalizedPayments.reduce(
      (sum, payment) => sum + safeNumber(payment?.valor ?? 0, 0),
      0
    );
    const userMeta = getCommandHistoryUserMeta(user || {});
    const openingReason = normalizeString(payload?.reason || payload?.motivo);
    const paymentLabel = normalizedPayments
      .map((payment) => `${payment.label || 'Pagamento'}: ${safeNumber(payment.valor, 0).toFixed(2)}`)
      .join(' | ');

    const historyEntry = {
      id: 'abertura',
      label: 'Abertura de Caixa',
      amount: openingTotal,
      delta: Math.abs(openingTotal),
      motivo: openingReason,
      paymentLabel,
      userId: userMeta.userId || '',
      userName: userMeta.userName || '',
      userLogin: userMeta.userLogin || '',
      responsavel: userMeta.userName || userMeta.userLogin || '',
      timestamp: openingDate,
    };

    const saleCodeIdentifier =
      normalizeString(existingState?.saleCodeIdentifier) || resolveSaleCodeIdentifierForPdv(pdvDoc);

    const nextMutationKeys = getNextRecentMutationKeys(
      existingState?.recentStateMutationKeys || [],
      idempotencyKey
    );

    const updatedState = await PdvState.findOneAndUpdate(
      { pdv: pdvId },
      {
        pdv: pdvId,
        empresa: pdvDoc?.empresa,
        caixaAberto: true,
        summary: {
          abertura: openingTotal,
          recebido: 0,
          recebimentosCliente: 0,
          saldo: openingTotal,
        },
        caixaInfo: {
          aberturaData: openingDate,
          fechamentoData: null,
          fechamentoPrevisto: 0,
          fechamentoApurado: 0,
          previstoPagamentos: normalizedPayments.map((payment) => ({
            ...payment,
            valor: 0,
          })),
          apuradoPagamentos: [],
        },
        pagamentos: normalizedPayments,
        history: [historyEntry],
        lastMovement: historyEntry,
        saleCodeIdentifier,
        saleCodeSequence: Math.max(1, Number.parseInt(existingState?.saleCodeSequence, 10) || 1),
        budgetSequence: Math.max(1, Number.parseInt(existingState?.budgetSequence, 10) || 1),
        printPreferences: {
          fechamento: normalizePrintPreference(existingState?.printPreferences?.fechamento || 'PM'),
          venda: normalizePrintPreference(existingState?.printPreferences?.venda || 'PM'),
        },
        recentStateMutationKeys: nextMutationKeys,
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    await syncPdvCaixaSessionHistory({
      pdvDoc,
      existingState,
      updatedState,
    });

    return {
      state: serializeStateForResponse(updatedState),
      shouldEmit: true,
    };
  }

  if (
    action === PDV_COMMANDS.CAIXA_ENTRY ||
    action === PDV_COMMANDS.CAIXA_EXIT ||
    action === PDV_COMMANDS.CAIXA_SHIPMENT ||
    action === PDV_COMMANDS.CAIXA_CLOSE
  ) {
    const existingState = await PdvState.findOne({ pdv: pdvId });
    if (
      idempotencyKey &&
      Array.isArray(existingState?.recentStateMutationKeys) &&
      existingState.recentStateMutationKeys.includes(idempotencyKey)
    ) {
      return {
        state: serializeStateForResponse(existingState),
        shouldEmit: false,
      };
    }
    if (!existingState || !existingState.caixaAberto) {
      const error = new Error('Abra o caixa antes de registrar movimentações.');
      error.statusCode = 409;
      throw error;
    }

    const now = new Date();
    const timestamp = safeDate(payload?.timestamp || payload?.at) || now;
    const reason = normalizeString(payload?.reason || payload?.motivo);
    const userMeta = getCommandHistoryUserMeta(user || {});
    const recentMutationKeys = getNextRecentMutationKeys(
      existingState?.recentStateMutationKeys || [],
      idempotencyKey
    );
    const currentPayments = cloneCommandPayments(
      normalizeCommandPayments(existingState?.pagamentos || [])
    );
    const currentPrevisto = cloneCommandPayments(
      normalizeCommandPayments(existingState?.caixaInfo?.previstoPagamentos || [])
    );
    const payloadPayments = cloneCommandPayments(normalizeCommandPayments(payload?.payments || []));
    if (!currentPayments.length && payloadPayments.length) {
      currentPayments.push(...cloneCommandPayments(payloadPayments));
    }
    if (!currentPrevisto.length && payloadPayments.length) {
      currentPrevisto.push(
        ...cloneCommandPayments(payloadPayments).map((payment) => ({
          ...payment,
          valor: safeNumber(payment?.valor ?? 0, 0),
        }))
      );
    }
    const currentSummary = existingState?.summary || {};
    const nextSummary = {
      abertura: safeNumber(currentSummary?.abertura, 0),
      recebido: safeNumber(currentSummary?.recebido, 0),
      recebimentosCliente: safeNumber(currentSummary?.recebimentosCliente, 0),
      saldo: safeNumber(currentSummary?.saldo, 0),
    };
    const nextHistory = Array.isArray(existingState?.history)
      ? existingState.history.map((entry) => ({ ...entry }))
      : [];
    const lastMovement = existingState?.lastMovement ? { ...existingState.lastMovement } : null;

    if (action === PDV_COMMANDS.CAIXA_CLOSE) {
      const apuradoPayments = normalizeCommandPayments(payload?.payments || currentPayments);
      if (!apuradoPayments.length) {
        const error = new Error('Informe os meios de pagamento apurados para o fechamento.');
        error.statusCode = 400;
        throw error;
      }
      const previstoPayments = buildExpectedClosePaymentsByMethod(existingState);
      const fechamentoPrevisto = previstoPayments.reduce(
        (sum, payment) => sum + safeNumber(payment?.valor ?? 0, 0),
        0
      );
      const fechamentoApurado = apuradoPayments.reduce(
        (sum, payment) => sum + safeNumber(payment?.valor ?? 0, 0),
        0
      );
      const nextOpeningPayments = buildNextOpeningPaymentsFromClose(apuradoPayments);

      const updatedState = await PdvState.findOneAndUpdate(
        { pdv: pdvId },
        {
          $set: {
            caixaAberto: false,
            pagamentos: nextOpeningPayments,
            history: nextHistory,
            lastMovement: lastMovement || null,
            summary: {
              ...nextSummary,
              saldo:
                safeNumber(nextSummary.abertura, 0) +
                safeNumber(nextSummary.recebido, 0) +
                safeNumber(nextSummary.recebimentosCliente, 0),
            },
            caixaInfo: {
              aberturaData: existingState?.caixaInfo?.aberturaData || null,
              fechamentoData: timestamp,
              fechamentoPrevisto,
              fechamentoApurado,
              previstoPagamentos: previstoPayments,
              apuradoPagamentos: apuradoPayments,
            },
            recentStateMutationKeys: recentMutationKeys,
          },
        },
        { new: true, upsert: false }
      );

      await syncPdvCaixaSessionHistory({
        pdvDoc,
        existingState,
        updatedState,
      });

      return {
        state: serializeStateForResponse(updatedState),
        shouldEmit: true,
      };
    }

    const amount = safeNumber(payload?.amount ?? payload?.valor, 0);
    if (!(amount > 0)) {
      const error = new Error('Informe um valor válido para a movimentação.');
      error.statusCode = 400;
      throw error;
    }

    let targetPayment = resolveCommandTargetPayment(currentPayments, payload?.paymentId);
    if (!targetPayment && payloadPayments.length) {
      const payloadTargetPayment = resolveCommandTargetPayment(payloadPayments, payload?.paymentId);
      if (payloadTargetPayment) {
        const alreadyInCurrent = resolveCommandTargetPayment(currentPayments, payloadTargetPayment.id);
        if (!alreadyInCurrent) {
          currentPayments.push({ ...payloadTargetPayment });
        }
        const alreadyInPrevisto = resolveCommandTargetPayment(currentPrevisto, payloadTargetPayment.id);
        if (!alreadyInPrevisto) {
          currentPrevisto.push({ ...payloadTargetPayment, valor: safeNumber(payloadTargetPayment?.valor ?? 0, 0) });
        }
        targetPayment =
          resolveCommandTargetPayment(currentPayments, payloadTargetPayment.id) ||
          resolveCommandTargetPayment(currentPayments, payloadTargetPayment.label);
      }
    }
    if (!targetPayment) {
      const error = new Error('Selecione um meio de pagamento válido para a movimentação.');
      error.statusCode = 400;
      throw error;
    }

    const targetPrevisto =
      resolveCommandTargetPayment(currentPrevisto, payload?.paymentId) ||
      resolveCommandTargetPayment(currentPrevisto, targetPayment?.id) ||
      null;

    let movementId = 'entrada';
    let movementLabel = 'Entrada';
    let delta = Math.abs(amount);
    if (action === PDV_COMMANDS.CAIXA_EXIT) {
      movementId = 'saida';
      movementLabel = 'Saída';
      delta = -Math.abs(amount);
    } else if (action === PDV_COMMANDS.CAIXA_SHIPMENT) {
      movementId = 'envio';
      movementLabel = 'Envio';
      delta = -Math.abs(amount);
    }

    const currentValue = safeNumber(targetPayment?.valor ?? 0, 0);
    const nextValue = Math.max(0, currentValue + delta);
    targetPayment.valor = nextValue;
    if (targetPrevisto) {
      const nextPrevistoValue = Math.max(0, safeNumber(targetPrevisto?.valor ?? 0, 0) + delta);
      targetPrevisto.valor = nextPrevistoValue;
    }

    const movementEntry = buildCaixaMovementHistoryEntry({
      movementId,
      movementLabel,
      amount,
      reason,
      paymentLabel: normalizeString(targetPayment?.label || ''),
      timestamp,
      userMeta,
    });
    nextHistory.unshift(movementEntry);

    const updatedState = await PdvState.findOneAndUpdate(
      { pdv: pdvId },
      {
        $set: {
          pagamentos: currentPayments,
          history: nextHistory,
          lastMovement: movementEntry,
          summary: {
            ...nextSummary,
            saldo:
              safeNumber(nextSummary.abertura, 0) +
              safeNumber(nextSummary.recebido, 0) +
              safeNumber(nextSummary.recebimentosCliente, 0),
          },
          caixaInfo: {
            ...(existingState?.caixaInfo || {}),
            previstoPagamentos: currentPrevisto,
            fechamentoPrevisto: currentPrevisto.reduce(
              (sum, payment) => sum + safeNumber(payment?.valor ?? 0, 0),
              0
            ),
          },
          recentStateMutationKeys: recentMutationKeys,
        },
      },
      { new: true, upsert: false }
    );

    await syncPdvCaixaSessionHistory({
      pdvDoc,
      existingState,
      updatedState,
    });

    return {
      state: serializeStateForResponse(updatedState),
      shouldEmit: true,
    };
  }

  if (action === PDV_COMMANDS.CAIXA_CLIENT_RECEIPT) {
    const existingStateDoc = await PdvState.findOne({ pdv: pdvId });
    if (
      idempotencyKey &&
      Array.isArray(existingStateDoc?.recentStateMutationKeys) &&
      existingStateDoc.recentStateMutationKeys.includes(idempotencyKey)
    ) {
      return {
        state: serializeStateForResponse(existingStateDoc),
        shouldEmit: false,
      };
    }
    if (!existingStateDoc || !existingStateDoc.caixaAberto) {
      const error = new Error('Abra o caixa para registrar recebimentos de cliente.');
      error.statusCode = 409;
      throw error;
    }
    const existingState =
      existingStateDoc && typeof existingStateDoc.toObject === 'function'
        ? existingStateDoc.toObject()
        : existingStateDoc;
    const payments = normalizeCommandPayments(payload?.payments || []);
    if (!payments.length) {
      const error = new Error('Informe os meios de pagamento do recebimento de cliente.');
      error.statusCode = 400;
      throw error;
    }
    const totalFromPayments = payments.reduce(
      (sum, payment) => sum + Math.max(0, safeNumber(payment?.valor ?? 0, 0)),
      0
    );
    const total = safeNumber(payload?.total ?? payload?.amount, totalFromPayments);
    if (!(total > 0)) {
      const error = new Error('Informe um valor válido para o recebimento de cliente.');
      error.statusCode = 400;
      throw error;
    }

    const nextPagamentos = clonePaymentSnapshots(existingState?.pagamentos || []);
    const nextPrevisto = clonePaymentSnapshots(existingState?.caixaInfo?.previstoPagamentos || []);
    const nextApurado = clonePaymentSnapshots(existingState?.caixaInfo?.apuradoPagamentos || []);
    payments.forEach((paymentEntry) => {
      const amount = Math.max(0, safeNumber(paymentEntry?.valor ?? 0, 0));
      if (!(amount > 0)) return;
      const targetPayment =
        resolveCommandTargetPayment(nextPagamentos, paymentEntry?.id) ||
        resolveCommandTargetPayment(nextPagamentos, paymentEntry?.label);
      if (targetPayment) {
        targetPayment.valor = safeNumber(targetPayment.valor, 0) + amount;
      }
      const targetPrevisto =
        resolveCommandTargetPayment(nextPrevisto, paymentEntry?.id) ||
        resolveCommandTargetPayment(nextPrevisto, paymentEntry?.label);
      if (targetPrevisto) {
        targetPrevisto.valor = safeNumber(targetPrevisto.valor, 0) + amount;
      }
    });

    const nextSummary = {
      abertura: safeNumber(existingState?.summary?.abertura, 0),
      recebido: safeNumber(existingState?.summary?.recebido, 0),
      recebimentosCliente:
        safeNumber(existingState?.summary?.recebimentosCliente, 0) + Math.max(0, total),
      saldo: 0,
    };
    nextSummary.saldo =
      safeNumber(nextSummary.abertura, 0) +
      safeNumber(nextSummary.recebido, 0) +
      safeNumber(nextSummary.recebimentosCliente, 0);

    const customerName = normalizeString(payload?.customerName || payload?.customer || '');
    const paymentLabel = payments
      .map((payment) => `${payment.label || 'Pagamento'}: ${safeNumber(payment.valor, 0).toFixed(2)}`)
      .join(' | ');
    const now = safeDate(payload?.timestamp || payload?.createdAt) || new Date();
    const userMeta = getCommandHistoryUserMeta(user || {});
    const historyEntry = normalizeHistoryEntryPayload({
      id: 'recebimento-cliente',
      label: 'Recebimentos de Cliente',
      amount: Math.abs(safeNumber(total, 0)),
      delta: Math.abs(safeNumber(total, 0)),
      motivo: normalizeString(payload?.reason || payload?.motivo || ''),
      paymentLabel: [customerName, paymentLabel].filter(Boolean).join(' • '),
      userId: userMeta.userId || '',
      userName: userMeta.userName || '',
      userLogin: userMeta.userLogin || '',
      responsavel: userMeta.userName || userMeta.userLogin || '',
      timestamp: now,
    });
    const nextHistory = mergeRecordsByKey(
      existingState?.history || [],
      historyEntry ? [historyEntry] : [],
      'history'
    );

    const updatedState = await PdvState.findOneAndUpdate(
      { pdv: pdvId },
      {
        $set: {
          pagamentos: nextPagamentos,
          summary: nextSummary,
          history: nextHistory,
          lastMovement: nextHistory[0] || null,
          caixaInfo: {
            ...(existingState?.caixaInfo || {}),
            previstoPagamentos: nextPrevisto,
            apuradoPagamentos: nextApurado,
            fechamentoPrevisto: nextPrevisto.reduce(
              (sum, payment) => sum + safeNumber(payment?.valor ?? 0, 0),
              0
            ),
          },
          recentStateMutationKeys: getNextRecentMutationKeys(
            existingState?.recentStateMutationKeys || [],
            idempotencyKey
          ),
        },
      },
      { new: true, upsert: false }
    );

    await syncPdvCaixaSessionHistory({
      pdvDoc,
      existingState,
      updatedState,
    });

    return {
      state: serializeStateForResponse(updatedState),
      shouldEmit: true,
    };
  }

  if (action === PDV_COMMANDS.SALE_FINALIZE) {
    try {
      if (!idempotencyKey) {
        const error = new Error('Informe o cabeçalho X-Idempotency-Key para finalizar a venda.');
        error.statusCode = 400;
        throw error;
      }
      const existingStateDoc = await PdvState.findOne({ pdv: pdvId });
    if (
      idempotencyKey &&
      Array.isArray(existingStateDoc?.recentStateMutationKeys) &&
      existingStateDoc.recentStateMutationKeys.includes(idempotencyKey)
    ) {
      return {
        state: serializeStateForResponse(existingStateDoc),
        shouldEmit: false,
      };
    }
    if (!existingStateDoc || !existingStateDoc.caixaAberto) {
      const error = new Error('Abra o caixa para finalizar a venda.');
      error.statusCode = 409;
      throw error;
    }

    const existingState =
      existingStateDoc && typeof existingStateDoc.toObject === 'function'
        ? existingStateDoc.toObject()
        : existingStateDoc;
    perf.mark('sale_finalize.state_loaded');
    const createdAt = safeDate(payload?.createdAt) || new Date();
    const items = Array.isArray(payload?.items)
      ? payload.items
          .map((item) => (item && typeof item === 'object' ? { ...item } : null))
          .filter(Boolean)
      : [];
    perf.mark('sale_finalize.payload_normalized', {
      items: items.length,
      payments: Array.isArray(payload?.payments) ? payload.payments.length : 0,
    });
    if (!items.length) {
      const error = new Error('Adicione itens para finalizar a venda.');
      error.statusCode = 400;
      throw error;
    }

    const payments = normalizeCommandPayments(payload?.payments || []);
    const totalBruto = safeNumber(payload?.totalBruto ?? payload?.total ?? payload?.totalLiquido ?? 0, 0);
    const discountValue = safeNumber(payload?.discountValue ?? payload?.discount ?? 0, 0);
    const additionValue = safeNumber(payload?.additionValue ?? payload?.addition ?? 0, 0);
    const totalLiquido =
      safeNumber(payload?.totalLiquido, NaN) ||
      Math.max(0, totalBruto - discountValue + additionValue);

    if (!(totalLiquido > 0)) {
      const error = new Error('Informe o valor total da venda.');
      error.statusCode = 400;
      throw error;
    }

    const providedSaleId = normalizeString(payload?.saleId || payload?.id);
    const providedSaleCode = normalizeString(payload?.saleCode || payload?.saleCodeLabel || '').toUpperCase();
    const existingSales = Array.isArray(existingState?.completedSales)
      ? existingState.completedSales.map((sale) => ({ ...sale }))
      : [];
    if (
      providedSaleId &&
      existingSales.some((sale) => normalizeString(sale?.id || sale?._id) === providedSaleId)
    ) {
      return {
        state: serializeStateForResponse(existingStateDoc),
        shouldEmit: false,
      };
    }
    if (
      providedSaleCode &&
      existingSales.some((sale) => {
        const status = normalizeString(sale?.status).toLowerCase();
        if (status === 'cancelled') return false;
        const currentCode = normalizeString(sale?.saleCode || sale?.saleCodeLabel || '').toUpperCase();
        return currentCode && currentCode === providedSaleCode;
      })
    ) {
      return {
        state: serializeStateForResponse(existingStateDoc),
        shouldEmit: false,
      };
    }

    const customerSource = payload?.customer && typeof payload.customer === 'object' ? payload.customer : {};
    const customerName = normalizeString(
      payload?.customerName ||
        customerSource?.nome ||
        customerSource?.nomeCompleto ||
        customerSource?.name ||
        ''
    );
    const customerDocument = normalizeString(
      payload?.customerDocument ||
        customerSource?.cpf ||
        customerSource?.cnpj ||
        customerSource?.documento ||
        customerSource?.doc ||
        ''
    );
    const seller =
      payload?.seller && typeof payload.seller === 'object' ? { ...payload.seller } : null;
    const paymentTags = buildPaymentTagsFromPayments(payments);
    const cashContributions = buildSaleContributionsFromPayments(payments);
    const paymentLabel = payments
      .map((payment) => `${payment.label || 'Pagamento'}: ${safeNumber(payment.valor, 0).toFixed(2)}`)
      .join(' | ');
    const normalizedReceivables = (Array.isArray(payload?.receivables) ? payload.receivables : [])
      .map((entry) =>
        normalizeReceivableRecordPayload({
          ...(entry && typeof entry === 'object' ? entry : {}),
          saleId: providedSaleId,
          saleCode: normalizeString(entry?.saleCode || '') || normalizeString(payload?.saleCode || ''),
        })
      )
      .filter(Boolean);

    const incomingSale = normalizeSaleRecordPayload({
      id: providedSaleId || `sale-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      type: normalizeString(payload?.type) || 'venda',
      typeLabel: normalizeString(payload?.typeLabel) || 'Venda',
      saleCode: normalizeString(payload?.saleCode),
      saleCodeLabel: normalizeString(payload?.saleCodeLabel),
      customerName: customerName || 'Cliente não informado',
      customerDocument,
      seller,
      paymentTags,
      items,
      discountValue,
      additionValue,
      total: totalLiquido,
      totalLiquido,
      totalBruto: totalBruto || totalLiquido,
      createdAt,
      receiptSnapshot:
        payload?.receiptSnapshot && typeof payload.receiptSnapshot === 'object'
          ? payload.receiptSnapshot
          : null,
      status: 'completed',
      cashContributions,
      receivables: normalizedReceivables,
    });
    if (!incomingSale) {
      const error = new Error('Não foi possível montar a venda para persistência.');
      error.statusCode = 400;
      throw error;
    }

    const currentBudgets = Array.isArray(existingState?.budgets)
      ? existingState.budgets.map((budget) => ({ ...budget }))
      : [];
    const saleIdentifier = resolveSaleCodeIdentifierForPdv(pdvDoc);
    const saleCounterKey = pdvSaleSequenceKey(pdvId);
    const existingSaleCodes = new Set(
      existingSales
        .map((sale) => normalizeString(sale?.saleCode || sale?.saleCodeLabel).toUpperCase())
        .filter(Boolean)
    );
    let incomingSaleCode = normalizeString(incomingSale.saleCode || incomingSale.saleCodeLabel).toUpperCase();
    const providedSequence = parseTrailingSequence(incomingSaleCode);
    const hasValidProvidedCode =
      Boolean(incomingSaleCode) &&
      incomingSaleCode.startsWith(`${saleIdentifier}-`) &&
      providedSequence > 0 &&
      !existingSaleCodes.has(incomingSaleCode);
    let nextSaleSequence = Math.max(1, Number.parseInt(existingState?.saleCodeSequence, 10) || 1);

    if (hasValidProvidedCode) {
      await ensureScopedSequenceAtLeast({
        scope: saleCounterKey.scope,
        reference: saleCounterKey.reference,
        value: providedSequence,
      });
      const currentSequence = await getScopedSequence({
        scope: saleCounterKey.scope,
        reference: saleCounterKey.reference,
      });
      nextSaleSequence = Math.max(1, currentSequence + 1);
    } else {
      let nextSeq = await nextScopedSequence({
        scope: saleCounterKey.scope,
        reference: saleCounterKey.reference,
      });
      let generated = buildSaleCodeValue(saleIdentifier, nextSeq).toUpperCase();
      while (existingSaleCodes.has(generated)) {
        nextSeq = await nextScopedSequence({
          scope: saleCounterKey.scope,
          reference: saleCounterKey.reference,
        });
        generated = buildSaleCodeValue(saleIdentifier, nextSeq).toUpperCase();
      }
      incomingSaleCode = generated;
      nextSaleSequence = Math.max(1, nextSeq + 1);
    }

    incomingSale.saleCode = incomingSaleCode;
    incomingSale.saleCodeLabel = incomingSaleCode;
    if (incomingSale.receiptSnapshot && typeof incomingSale.receiptSnapshot === 'object') {
      incomingSale.receiptSnapshot.meta = incomingSale.receiptSnapshot.meta || {};
      incomingSale.receiptSnapshot.meta.saleCode = incomingSaleCode;
    }
    if (Array.isArray(incomingSale.receivables)) {
      incomingSale.receivables = incomingSale.receivables.map((entry) =>
        entry && typeof entry === 'object' ? { ...entry, saleCode: incomingSaleCode } : entry
      );
    }

    let nextSales = [incomingSale, ...existingSales];
    perf.mark('sale_finalize.codes_ensured');

    const productIds = collectProductIdsFromSales([incomingSale]);
    if (productIds.length) {
      const products = await Product.find({ _id: { $in: productIds } })
        .select('custo custoMedio custoCalculado precoCusto precoCustoUnitario')
        .lean();
      const productMap = new Map(products.map((product) => [product._id.toString(), product]));
      ensureSalesHaveCostData([incomingSale], productMap);
    }
    perf.mark('sale_finalize.costs_enriched', { products: productIds.length });

    nextSales = mergeInventoryProcessingStatus(nextSales, existingSales);
    const existingInventoryMovements = Array.isArray(existingState?.inventoryMovements)
      ? existingState.inventoryMovements.map((movement) =>
          movement && typeof movement.toObject === 'function' ? movement.toObject() : movement
        )
      : [];
    const depositConfig = pdvDoc?.configuracoesEstoque?.depositoPadrao || null;
    let nextInventoryMovements = existingInventoryMovements;
    if (depositConfig) {
      const salesToProcess = PDV_SALE_FINALIZE_PROCESS_ALL_SALES
        ? nextSales
        : nextSales.filter((sale) => normalizeString(sale?.id || sale?._id) === normalizeString(incomingSale.id));
      const inventoryResult = await applyInventoryMovementsToSales({
        sales: salesToProcess,
        depositId: depositConfig,
        existingMovements: existingInventoryMovements,
        movementContext: {
          companyId: pdvDoc?.empresa || null,
          userId: user?.id || null,
          userName: normalizeString(user?.nomeCompleto || user?.apelido || user?.name || ''),
          userEmail: normalizeString(user?.email || ''),
        },
      });
      const processedSalesById = new Map(
        (Array.isArray(inventoryResult.sales) ? inventoryResult.sales : [])
          .map((sale) => [normalizeString(sale?.id || sale?._id), sale])
      );
      nextSales = nextSales.map((sale) => {
        const key = normalizeString(sale?.id || sale?._id);
        return processedSalesById.get(key) || sale;
      });
      const newInventoryMovements = inventoryResult.movements || [];
      const revertedSales = new Set(inventoryResult.revertedSales || []);
      let combinedMovements = existingInventoryMovements;
      if (revertedSales.size) {
        combinedMovements = combinedMovements.filter(
          (movement) => movement && !revertedSales.has(movement.saleId)
        );
      }
      if (newInventoryMovements.length) {
        combinedMovements = [...combinedMovements, ...newInventoryMovements];
      }
      nextInventoryMovements = combinedMovements;
    }
    perf.mark('sale_finalize.inventory_processed', {
      inventoryEnabled: Boolean(depositConfig),
      inventoryMovements: nextInventoryMovements.length,
    });

    const finalizedSale = nextSales.find(
      (sale) => normalizeString(sale?.id || sale?._id) === normalizeString(incomingSale.id)
    );
    const finalizedSaleId = normalizeString(finalizedSale?.id || finalizedSale?._id || incomingSale.id);
    const finalizedSaleCode = normalizeString(
      finalizedSale?.saleCode || finalizedSale?.saleCodeLabel || payload?.saleCode || ''
    );
    const nextAccountsReceivableBase = (Array.isArray(existingState?.accountsReceivable)
      ? existingState.accountsReceivable
      : []
    ).filter((entry) => normalizeString(entry?.saleId || '') !== finalizedSaleId);
    const nextAccountsReceivable = [
      ...nextAccountsReceivableBase,
      ...normalizedReceivables.map((entry) => ({
        ...entry,
        saleId: finalizedSaleId,
        saleCode: normalizeString(entry?.saleCode || '') || finalizedSaleCode,
      })),
    ];
    const historyEntry = buildSaleHistoryEntry({
      saleCode: normalizeString(finalizedSale?.saleCode || finalizedSale?.saleCodeLabel),
      totalLiquido: safeNumber(finalizedSale?.totalLiquido ?? finalizedSale?.total ?? totalLiquido, 0),
      paymentLabel,
      createdAt,
      userMeta: getCommandHistoryUserMeta(user || {}),
    });
    const nextHistory = mergeRecordsByKey(
      existingState?.history || [],
      historyEntry ? [historyEntry] : [],
      'history'
    );

    const updatePayload = {
      caixaAberto: true,
      summary: {
        abertura: safeNumber(existingState?.summary?.abertura, 0),
        recebido: safeNumber(existingState?.summary?.recebido, 0),
        recebimentosCliente: safeNumber(existingState?.summary?.recebimentosCliente, 0),
        saldo: safeNumber(existingState?.summary?.saldo, 0),
      },
      caixaInfo: {
        aberturaData: existingState?.caixaInfo?.aberturaData || null,
        fechamentoData: null,
        fechamentoPrevisto: safeNumber(existingState?.caixaInfo?.fechamentoPrevisto, 0),
        fechamentoApurado: safeNumber(existingState?.caixaInfo?.fechamentoApurado, 0),
        previstoPagamentos: clonePaymentSnapshots(existingState?.caixaInfo?.previstoPagamentos || []),
        apuradoPagamentos: clonePaymentSnapshots(existingState?.caixaInfo?.apuradoPagamentos || []),
      },
      pagamentos: clonePaymentSnapshots(existingState?.pagamentos || []),
      history: nextHistory,
      lastMovement: nextHistory[0] || null,
      completedSales: nextSales,
      budgets: currentBudgets,
      deliveryOrders: Array.isArray(existingState?.deliveryOrders) ? existingState.deliveryOrders : [],
      accountsReceivable: nextAccountsReceivable,
      inventoryMovements: nextInventoryMovements,
      saleCodeIdentifier:
        normalizeString(existingState?.saleCodeIdentifier) || resolveSaleCodeIdentifierForPdv(pdvDoc),
      saleCodeSequence: nextSaleSequence,
      budgetSequence: Math.max(1, Number.parseInt(existingState?.budgetSequence, 10) || 1),
      printPreferences: {
        fechamento: normalizePrintPreference(existingState?.printPreferences?.fechamento || 'PM'),
        venda: normalizePrintPreference(existingState?.printPreferences?.venda || 'PM'),
      },
      recentStateMutationKeys: getNextRecentMutationKeys(
        existingState?.recentStateMutationKeys || [],
        idempotencyKey
      ),
    };

    reconcileCashStateFromSales({ existingState, updatePayload });
    perf.mark('sale_finalize.cash_reconciled');

    let updatedState = null;
    if (PDV_SALE_FINALIZE_LEGACY_WRITE) {
      updatedState = await PdvState.findOneAndUpdate(
        { pdv: pdvId },
        {
          ...updatePayload,
          pdv: pdvId,
          empresa: existingState?.empresa || pdvDoc?.empresa,
        },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      );
    } else {
      const optimizedSet = {
        caixaAberto: true,
        summary: updatePayload.summary,
        caixaInfo: updatePayload.caixaInfo,
        pagamentos: updatePayload.pagamentos,
        history: updatePayload.history,
        lastMovement: updatePayload.lastMovement,
        completedSales: updatePayload.completedSales,
        inventoryMovements: updatePayload.inventoryMovements,
        saleCodeIdentifier: updatePayload.saleCodeIdentifier,
        saleCodeSequence: updatePayload.saleCodeSequence,
        budgetSequence: updatePayload.budgetSequence,
        recentStateMutationKeys: updatePayload.recentStateMutationKeys,
      };
      if (Array.isArray(normalizedReceivables) && normalizedReceivables.length) {
        optimizedSet.accountsReceivable = updatePayload.accountsReceivable;
      }

      updatedState = await PdvState.findOneAndUpdate(
        { pdv: pdvId },
        { $set: optimizedSet },
        { new: true, upsert: false }
      );
    }
    perf.mark('sale_finalize.state_persisted');

    syncPdvCaixaSessionHistory({
      pdvDoc,
      existingState,
      updatedState,
    }).catch((historyError) => {
      console.error('Erro ao sincronizar histórico de caixas após venda finalizada:', historyError);
    });
    perf.mark('sale_finalize.session_sync_deferred');
    perf.flush('ok', {
      branch: action,
      saleId: normalizeString(incomingSale?.id || ''),
      totalLiquido: safeNumber(totalLiquido, 0),
    });

    return {
      state: serializeStateForResponse(updatedState),
      shouldEmit: true,
    };
    } catch (error) {
      if (shouldTraceCommand) {
        perf.flush('error', {
          branch: action,
          message: normalizeString(error?.message || '') || 'Erro em sale_finalize',
        });
      }
      throw error;
    }
  }

  if (action === PDV_COMMANDS.SALE_CANCEL) {
    if (!idempotencyKey) {
      const error = new Error('Informe o cabeçalho X-Idempotency-Key para cancelar a venda.');
      error.statusCode = 400;
      throw error;
    }
    const existingStateDoc = await PdvState.findOne({ pdv: pdvId });
    if (
      idempotencyKey &&
      Array.isArray(existingStateDoc?.recentStateMutationKeys) &&
      existingStateDoc.recentStateMutationKeys.includes(idempotencyKey)
    ) {
      return {
        state: serializeStateForResponse(existingStateDoc),
        shouldEmit: false,
      };
    }
    if (!existingStateDoc) {
      const error = new Error('Estado do PDV não encontrado para cancelamento.');
      error.statusCode = 404;
      throw error;
    }

    const existingState =
      existingStateDoc && typeof existingStateDoc.toObject === 'function'
        ? existingStateDoc.toObject()
        : existingStateDoc;
    const saleId = normalizeString(payload?.saleId || payload?.id || '');
    if (!saleId) {
      const error = new Error('Informe a venda que será cancelada.');
      error.statusCode = 400;
      throw error;
    }
    const cancellationReason = normalizeString(
      payload?.reason || payload?.motivo || payload?.cancellationReason || ''
    );
    if (!cancellationReason) {
      const error = new Error('Informe o motivo do cancelamento da venda.');
      error.statusCode = 400;
      throw error;
    }

    const existingSales = Array.isArray(existingState?.completedSales)
      ? existingState.completedSales.map((sale) => ({ ...sale }))
      : [];
    const saleIndex = existingSales.findIndex(
      (sale) => normalizeString(sale?.id || sale?._id) === saleId
    );
    if (saleIndex < 0) {
      const error = new Error('Venda não encontrada para cancelamento.');
      error.statusCode = 404;
      throw error;
    }
    const saleRecord = existingSales[saleIndex] || {};
    if (normalizeString(saleRecord?.status).toLowerCase() === 'cancelled') {
      return {
        state: serializeStateForResponse(existingStateDoc),
        shouldEmit: false,
      };
    }

    const cancellationAt = safeDate(payload?.cancellationAt || payload?.cancelledAt) || new Date();
    const saleCode = normalizeString(saleRecord?.saleCode || saleRecord?.saleCodeLabel || '');
    const saleTotal = safeNumber(
      saleRecord?.totalLiquido ?? saleRecord?.total ?? saleRecord?.totalBruto ?? 0,
      0
    );
    const contributions = Array.isArray(saleRecord?.cashContributions)
      ? saleRecord.cashContributions
          .map((entry) => {
            if (!entry || typeof entry !== 'object') return null;
            const amount = safeNumber(entry.amount ?? entry.valor ?? entry.total ?? 0, 0);
            if (!(amount > 0)) return null;
            return {
              paymentId: normalizeString(entry.paymentId || entry.id || ''),
              paymentLabel: normalizeString(entry.paymentLabel || entry.label || ''),
              amount,
            };
          })
          .filter(Boolean)
      : [];

    const nextSales = [...existingSales];
    nextSales[saleIndex] = normalizeSaleRecordPayload({
      ...saleRecord,
      status: 'cancelled',
      cancellationReason,
      cancellationAt,
      updatedAt: cancellationAt,
    });

    const targetSaleKey = normalizeString(saleRecord?.id || saleRecord?._id || saleId);
    const nextDeliveryOrders = (Array.isArray(existingState?.deliveryOrders)
      ? existingState.deliveryOrders
      : []
    ).filter((order) => {
      const orderSaleRecordId = normalizeString(order?.saleRecordId || '');
      const orderSaleCode = normalizeString(order?.saleCode || '');
      if (targetSaleKey && orderSaleRecordId === targetSaleKey) return false;
      if (saleCode && orderSaleCode === saleCode) return false;
      return true;
    });

    const nextAccountsReceivable = (Array.isArray(existingState?.accountsReceivable)
      ? existingState.accountsReceivable
      : []
    ).map((entry) => {
      if (!entry || typeof entry !== 'object') return entry;
      if (normalizeString(entry.saleId || '') !== targetSaleKey) return entry;
      return {
        ...entry,
        status: 'cancelled',
        cancellationReason,
        cancellationAt,
      };
    });

    const nextSummary = {
      abertura: safeNumber(existingState?.summary?.abertura, 0),
      recebido: Math.max(0, safeNumber(existingState?.summary?.recebido, 0) - Math.abs(saleTotal)),
      recebimentosCliente: safeNumber(existingState?.summary?.recebimentosCliente, 0),
      saldo: 0,
    };
    nextSummary.saldo =
      safeNumber(nextSummary.abertura, 0) +
      safeNumber(nextSummary.recebido, 0) +
      safeNumber(nextSummary.recebimentosCliente, 0);

    const nextPagamentos = clonePaymentSnapshots(existingState?.pagamentos || []);
    const nextPrevisto = clonePaymentSnapshots(existingState?.caixaInfo?.previstoPagamentos || []);
    const nextApurado = clonePaymentSnapshots(existingState?.caixaInfo?.apuradoPagamentos || []);

    contributions.forEach((contribution) => {
      const amount = safeNumber(contribution?.amount, 0);
      if (!(amount > 0)) return;
      const currentPayment =
        findPaymentSnapshotByContribution(nextPagamentos, contribution) ||
        resolveCommandTargetPayment(nextPagamentos, contribution?.paymentId) ||
        resolveCommandTargetPayment(nextPagamentos, contribution?.paymentLabel);
      if (currentPayment) {
        currentPayment.valor = Math.max(0, safeNumber(currentPayment.valor, 0) - amount);
      }
      const currentPrevisto =
        findPaymentSnapshotByContribution(nextPrevisto, contribution) ||
        resolveCommandTargetPayment(nextPrevisto, contribution?.paymentId) ||
        resolveCommandTargetPayment(nextPrevisto, contribution?.paymentLabel);
      if (currentPrevisto) {
        currentPrevisto.valor = Math.max(0, safeNumber(currentPrevisto.valor, 0) - amount);
      }
    });

    const paymentLabel = contributions
      .map((entry) => `${entry.paymentLabel || entry.paymentId || 'Pagamento'}: ${safeNumber(entry.amount, 0).toFixed(2)}`)
      .join(' | ');
    const historyEntry = normalizeHistoryEntryPayload({
      id: 'cancelamento-venda',
      label: saleCode ? `Venda ${saleCode} cancelada` : 'Venda cancelada',
      amount: Math.abs(saleTotal),
      delta: -Math.abs(saleTotal),
      motivo: cancellationReason,
      paymentLabel,
      userId: normalizeString(user?.id),
      userName: normalizeString(user?.nomeCompleto || user?.apelido || user?.name || ''),
      userLogin: normalizeString(user?.email || ''),
      responsavel: normalizeString(user?.nomeCompleto || user?.apelido || user?.email || ''),
      timestamp: cancellationAt,
    });
    const nextHistory = mergeRecordsByKey(
      existingState?.history || [],
      historyEntry ? [historyEntry] : [],
      'history'
    );

    const existingInventoryMovements = Array.isArray(existingState?.inventoryMovements)
      ? existingState.inventoryMovements.map((movement) =>
          movement && typeof movement.toObject === 'function' ? movement.toObject() : movement
        )
      : [];
    let nextInventoryMovements = existingInventoryMovements;
    const depositConfig = pdvDoc?.configuracoesEstoque?.depositoPadrao || null;
    if (depositConfig) {
      const inventoryResult = await applyInventoryMovementsToSales({
        sales: nextSales,
        depositId: depositConfig,
        existingMovements: existingInventoryMovements,
        movementContext: {
          companyId: pdvDoc?.empresa || null,
          userId: user?.id || null,
          userName: normalizeString(user?.nomeCompleto || user?.apelido || user?.name || ''),
          userEmail: normalizeString(user?.email || ''),
        },
      });
      const revertedSales = new Set(inventoryResult.revertedSales || []);
      const newInventoryMovements = inventoryResult.movements || [];
      let combinedMovements = existingInventoryMovements;
      if (revertedSales.size) {
        combinedMovements = combinedMovements.filter(
          (movement) => movement && !revertedSales.has(movement.saleId)
        );
      }
      if (newInventoryMovements.length) {
        combinedMovements = [...combinedMovements, ...newInventoryMovements];
      }
      nextInventoryMovements = combinedMovements;
    }

    const updatedState = await PdvState.findOneAndUpdate(
      { pdv: pdvId },
      {
        $set: {
          completedSales: nextSales,
          deliveryOrders: nextDeliveryOrders,
          accountsReceivable: nextAccountsReceivable,
          pagamentos: nextPagamentos,
          summary: nextSummary,
          history: nextHistory,
          lastMovement: nextHistory[0] || null,
          caixaInfo: {
            ...(existingState?.caixaInfo || {}),
            previstoPagamentos: nextPrevisto,
            apuradoPagamentos: nextApurado,
            fechamentoPrevisto: nextPrevisto.reduce(
              (sum, payment) => sum + safeNumber(payment?.valor ?? 0, 0),
              0
            ),
          },
          inventoryMovements: nextInventoryMovements,
          recentStateMutationKeys: getNextRecentMutationKeys(
            existingState?.recentStateMutationKeys || [],
            idempotencyKey
          ),
        },
      },
      { new: true, upsert: false }
    );

    await syncPdvCaixaSessionHistory({
      pdvDoc,
      existingState,
      updatedState,
    });

    return {
      state: serializeStateForResponse(updatedState),
      shouldEmit: true,
    };
  }

  if (action === PDV_COMMANDS.SALE_RESET_FISCAL_STATUS) {
    const existingStateDoc = await PdvState.findOne({ pdv: pdvId });
    if (
      idempotencyKey &&
      Array.isArray(existingStateDoc?.recentStateMutationKeys) &&
      existingStateDoc.recentStateMutationKeys.includes(idempotencyKey)
    ) {
      return {
        state: serializeStateForResponse(existingStateDoc),
        shouldEmit: false,
      };
    }
    if (!existingStateDoc) {
      const error = new Error('Estado do PDV não encontrado para redefinir emissão fiscal.');
      error.statusCode = 404;
      throw error;
    }

    const existingState =
      existingStateDoc && typeof existingStateDoc.toObject === 'function'
        ? existingStateDoc.toObject()
        : existingStateDoc;
    const saleId = normalizeString(payload?.saleId || payload?.id || '');
    if (!saleId) {
      const error = new Error('Informe a venda para redefinir o status fiscal.');
      error.statusCode = 400;
      throw error;
    }

    const existingSales = Array.isArray(existingState?.completedSales)
      ? existingState.completedSales.map((sale) => ({ ...sale }))
      : [];
    const saleIndex = existingSales.findIndex(
      (sale) => normalizeString(sale?.id || sale?._id) === saleId
    );
    if (saleIndex < 0) {
      const error = new Error('Venda não encontrada para redefinir o status fiscal.');
      error.statusCode = 404;
      throw error;
    }
    const saleRecord = existingSales[saleIndex] || {};
    if (normalizeString(saleRecord?.fiscalStatus) !== 'emitting') {
      const error = new Error('Esta venda não está com emissão em andamento.');
      error.statusCode = 409;
      throw error;
    }

    const resetAt = safeDate(payload?.resetAt) || new Date();
    const nextSales = [...existingSales];
    nextSales[saleIndex] = normalizeSaleRecordPayload({
      ...saleRecord,
      fiscalStatus: 'pending',
      updatedAt: resetAt,
    });

    const updatedState = await PdvState.findOneAndUpdate(
      { pdv: pdvId },
      {
        $set: {
          completedSales: nextSales,
          recentStateMutationKeys: getNextRecentMutationKeys(
            existingState?.recentStateMutationKeys || [],
            idempotencyKey
          ),
        },
        $setOnInsert: {
          pdv: pdvId,
          empresa: existingState?.empresa || pdvDoc?.empresa,
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    return {
      state: serializeStateForResponse(updatedState),
      shouldEmit: true,
    };
  }

  if (action === PDV_COMMANDS.SALE_SYNC_RECEIVABLES) {
    const existingStateDoc = await PdvState.findOne({ pdv: pdvId });
    if (
      idempotencyKey &&
      Array.isArray(existingStateDoc?.recentStateMutationKeys) &&
      existingStateDoc.recentStateMutationKeys.includes(idempotencyKey)
    ) {
      return {
        state: serializeStateForResponse(existingStateDoc),
        shouldEmit: false,
      };
    }
    if (!existingStateDoc) {
      const error = new Error('Estado do PDV não encontrado para sincronizar recebíveis.');
      error.statusCode = 404;
      throw error;
    }
    const existingState =
      existingStateDoc && typeof existingStateDoc.toObject === 'function'
        ? existingStateDoc.toObject()
        : existingStateDoc;
    const saleId = normalizeString(payload?.saleId || payload?.id || '');
    if (!saleId) {
      const error = new Error('Informe a venda para sincronizar os recebíveis.');
      error.statusCode = 400;
      throw error;
    }
    const existingSales = Array.isArray(existingState?.completedSales)
      ? existingState.completedSales.map((sale) => ({ ...sale }))
      : [];
    const saleIndex = existingSales.findIndex(
      (sale) => normalizeString(sale?.id || sale?._id) === saleId
    );
    if (saleIndex < 0) {
      const error = new Error('Venda não encontrada para sincronizar recebíveis.');
      error.statusCode = 404;
      throw error;
    }
    const saleRecord = existingSales[saleIndex] || {};
    const normalizedReceivables = (Array.isArray(payload?.receivables) ? payload.receivables : [])
      .map((entry) =>
        normalizeReceivableRecordPayload({
          ...(entry && typeof entry === 'object' ? entry : {}),
          saleId,
          saleCode:
            normalizeString(entry?.saleCode || '') ||
            normalizeString(saleRecord?.saleCode || saleRecord?.saleCodeLabel || ''),
        })
      )
      .filter(Boolean);
    const existingSaleReceivables = Array.isArray(saleRecord?.receivables) ? saleRecord.receivables : [];
    if (areReceivablesEquivalent(existingSaleReceivables, normalizedReceivables)) {
      return {
        state: serializeStateForResponse(existingStateDoc),
        shouldEmit: false,
      };
    }
    const saleCode = normalizeString(saleRecord?.saleCode || saleRecord?.saleCodeLabel || '');
    const nextSales = [...existingSales];
    nextSales[saleIndex] = normalizeSaleRecordPayload({
      ...saleRecord,
      receivables: normalizedReceivables,
      updatedAt: new Date(),
    });
    const preservedReceivables = (Array.isArray(existingState?.accountsReceivable)
      ? existingState.accountsReceivable
      : []
    ).filter((entry) => normalizeString(entry?.saleId || '') !== saleId);
    const nextAccountsReceivable = [
      ...preservedReceivables,
      ...normalizedReceivables.map((entry) => ({
        ...entry,
        saleId,
        saleCode: normalizeString(entry?.saleCode || '') || saleCode,
      })),
    ];

    const updatedState = await PdvState.findOneAndUpdate(
      { pdv: pdvId },
      {
        $set: {
          completedSales: nextSales,
          accountsReceivable: nextAccountsReceivable,
          recentStateMutationKeys: getNextRecentMutationKeys(
            existingState?.recentStateMutationKeys || [],
            idempotencyKey
          ),
        },
      },
      { new: true, upsert: false }
    );

    return {
      state: serializeStateForResponse(updatedState),
      shouldEmit: true,
    };
  }

  if (action === PDV_COMMANDS.SETTINGS_PRINT_PREFERENCES) {
    const existingStateDoc = await PdvState.findOne({ pdv: pdvId });
    if (
      idempotencyKey &&
      Array.isArray(existingStateDoc?.recentStateMutationKeys) &&
      existingStateDoc.recentStateMutationKeys.includes(idempotencyKey)
    ) {
      return {
        state: serializeStateForResponse(existingStateDoc),
        shouldEmit: false,
      };
    }
    const existingState =
      existingStateDoc && typeof existingStateDoc.toObject === 'function'
        ? existingStateDoc.toObject()
        : existingStateDoc || {};
    const incoming =
      payload?.printPreferences && typeof payload.printPreferences === 'object'
        ? payload.printPreferences
        : payload && typeof payload === 'object'
        ? payload
        : {};
    const nextPrintPreferences = {
      fechamento: normalizePrintPreference(
        incoming?.fechamento || existingState?.printPreferences?.fechamento || 'PM'
      ),
      venda: normalizePrintPreference(
        incoming?.venda || existingState?.printPreferences?.venda || 'PM'
      ),
    };
    const updatedState = await PdvState.findOneAndUpdate(
      { pdv: pdvId },
      {
        $set: {
          printPreferences: nextPrintPreferences,
          recentStateMutationKeys: getNextRecentMutationKeys(
            existingState?.recentStateMutationKeys || [],
            idempotencyKey
          ),
        },
        $setOnInsert: {
          pdv: pdvId,
          empresa: existingState?.empresa || pdvDoc?.empresa,
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    return {
      state: serializeStateForResponse(updatedState),
      shouldEmit: true,
    };
  }

  if (
    action === PDV_COMMANDS.BUDGET_SAVE ||
    action === PDV_COMMANDS.BUDGET_FINALIZE ||
    action === PDV_COMMANDS.BUDGET_MARK_IMPORTED ||
    action === PDV_COMMANDS.BUDGET_DELETE
  ) {
    const existingStateDoc = await PdvState.findOne({ pdv: pdvId });
    if (
      idempotencyKey &&
      Array.isArray(existingStateDoc?.recentStateMutationKeys) &&
      existingStateDoc.recentStateMutationKeys.includes(idempotencyKey)
    ) {
      return {
        state: serializeStateForResponse(existingStateDoc),
        shouldEmit: false,
      };
    }

    const existingState =
      existingStateDoc && typeof existingStateDoc.toObject === 'function'
        ? existingStateDoc.toObject()
        : existingStateDoc || {};
    const now = new Date();
    const existingSales = Array.isArray(existingState?.completedSales)
      ? existingState.completedSales.map((sale) => ({ ...sale }))
      : [];
    const existingBudgets = Array.isArray(existingState?.budgets)
      ? existingState.budgets.map((budget) => ({ ...budget }))
      : [];
    let nextBudgets = existingBudgets;

    if (action === PDV_COMMANDS.BUDGET_SAVE) {
      const budgetPayload = payload && typeof payload === 'object' ? payload : {};
      const incomingId = normalizeString(
        budgetPayload.id || budgetPayload.budgetId || budgetPayload._id || ''
      );
      const incomingItems = Array.isArray(budgetPayload.items) ? budgetPayload.items : [];
      if (!incomingItems.length) {
        const error = new Error('Adicione itens para salvar o orçamento.');
        error.statusCode = 400;
        throw error;
      }

      const normalizedBudget = normalizeBudgetRecordPayload(
        {
          ...budgetPayload,
          id: incomingId || budgetPayload.id,
          updatedAt: budgetPayload.updatedAt || now,
          createdAt: budgetPayload.createdAt || now,
          status: normalizeString(budgetPayload.status) || 'aberto',
        },
        { useDefaults: true }
      );
      if (!normalizedBudget) {
        const error = new Error('Não foi possível montar o orçamento para persistência.');
        error.statusCode = 400;
        throw error;
      }

      const targetId = normalizeString(normalizedBudget.id);
      const existingIndex = nextBudgets.findIndex(
        (budget) => normalizeString(budget?.id || budget?._id) === targetId
      );
      if (existingIndex >= 0) {
        nextBudgets[existingIndex] = {
          ...nextBudgets[existingIndex],
          ...normalizedBudget,
          id: targetId,
          createdAt: nextBudgets[existingIndex]?.createdAt || normalizedBudget.createdAt || now,
          updatedAt: now,
        };
      } else {
        nextBudgets = [
          {
            ...normalizedBudget,
            createdAt: normalizedBudget.createdAt || now,
            updatedAt: normalizedBudget.updatedAt || now,
          },
          ...nextBudgets,
        ];
      }
    } else if (action === PDV_COMMANDS.BUDGET_FINALIZE) {
      const budgetId = normalizeString(payload?.budgetId || payload?.id || '');
      if (!budgetId) {
        const error = new Error('Informe o orçamento que será finalizado.');
        error.statusCode = 400;
        throw error;
      }
      const index = nextBudgets.findIndex(
        (budget) => normalizeString(budget?.id || budget?._id) === budgetId
      );
      if (index < 0) {
        const error = new Error('Orçamento não encontrado para finalização.');
        error.statusCode = 404;
        throw error;
      }
      nextBudgets[index] = {
        ...nextBudgets[index],
        status: 'finalizado',
        finalizedAt: safeDate(payload?.finalizedAt) || now,
        finalizedSaleId: normalizeString(payload?.finalizedSaleId || payload?.saleId || ''),
        updatedAt: now,
      };
    } else if (action === PDV_COMMANDS.BUDGET_MARK_IMPORTED) {
      const budgetId = normalizeString(payload?.budgetId || payload?.id || '');
      if (!budgetId) {
        const error = new Error('Informe o orçamento que será marcado como importado.');
        error.statusCode = 400;
        throw error;
      }
      const index = nextBudgets.findIndex(
        (budget) => normalizeString(budget?.id || budget?._id) === budgetId
      );
      if (index < 0) {
        const error = new Error('Orçamento não encontrado para marcação de importação.');
        error.statusCode = 404;
        throw error;
      }
      nextBudgets[index] = {
        ...nextBudgets[index],
        importedAt: safeDate(payload?.importedAt) || now,
        updatedAt: now,
      };
    } else if (action === PDV_COMMANDS.BUDGET_DELETE) {
      const budgetId = normalizeString(payload?.budgetId || payload?.id || '');
      if (!budgetId) {
        const error = new Error('Informe o orçamento que será excluído.');
        error.statusCode = 400;
        throw error;
      }
      const index = nextBudgets.findIndex(
        (budget) => normalizeString(budget?.id || budget?._id) === budgetId
      );
      if (index < 0) {
        const error = new Error('Orçamento não encontrado para exclusão.');
        error.statusCode = 404;
        throw error;
      }
      nextBudgets.splice(index, 1);
    }

    const ensuredCodes = await ensureUniquePdvCodes({
      pdvId,
      pdvDoc,
      sales: existingSales,
      budgets: nextBudgets,
      existingSales,
      existingBudgets,
    });
    nextBudgets = ensuredCodes.budgets;

    const updatedState = await PdvState.findOneAndUpdate(
      { pdv: pdvId },
      {
        $set: {
          budgets: nextBudgets,
          budgetSequence: ensuredCodes.nextBudgetSequence,
          recentStateMutationKeys: getNextRecentMutationKeys(
            existingState?.recentStateMutationKeys || [],
            idempotencyKey
          ),
        },
        $setOnInsert: {
          pdv: pdvId,
          empresa: existingState?.empresa || pdvDoc?.empresa,
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    return {
      state: serializeStateForResponse(updatedState),
      shouldEmit: true,
    };
  }

  if (
    action === PDV_COMMANDS.DELIVERY_REGISTER ||
    action === PDV_COMMANDS.DELIVERY_UPDATE_STATUS ||
    action === PDV_COMMANDS.DELIVERY_UPDATE_COURIER ||
    action === PDV_COMMANDS.DELIVERY_FINALIZE
  ) {
    const existingStateDoc = await PdvState.findOne({ pdv: pdvId });
    if (
      idempotencyKey &&
      Array.isArray(existingStateDoc?.recentStateMutationKeys) &&
      existingStateDoc.recentStateMutationKeys.includes(idempotencyKey)
    ) {
      return {
        state: serializeStateForResponse(existingStateDoc),
        shouldEmit: false,
      };
    }

    const existingState =
      existingStateDoc && typeof existingStateDoc.toObject === 'function'
        ? existingStateDoc.toObject()
        : existingStateDoc || {};
    if (!Boolean(existingState?.caixaAberto)) {
      const error = new Error('Abra o caixa para operar delivery.');
      error.statusCode = 409;
      throw error;
    }

    const now = new Date();
    const items = Array.isArray(payload?.items)
      ? payload.items
          .map((item) => (item && typeof item === 'object' ? { ...item } : null))
          .filter(Boolean)
      : [];
    const payments = normalizeCommandPayments(payload?.payments || []);
    const totalLiquido = safeNumber(payload?.totalLiquido ?? payload?.total ?? 0, 0);
    const totalBruto = safeNumber(payload?.totalBruto ?? totalLiquido, 0);
    const discountValue = safeNumber(payload?.discountValue ?? payload?.discount ?? 0, 0);
    const additionValue = safeNumber(payload?.additionValue ?? payload?.addition ?? 0, 0);
    const customerSource = payload?.customer && typeof payload.customer === 'object' ? payload.customer : {};
    const customerName = normalizeString(
      payload?.customerName || customerSource?.nome || customerSource?.nomeCompleto || ''
    ) || 'Cliente não informado';
    const customerDocument = normalizeString(
      payload?.customerDocument || customerSource?.cpf || customerSource?.cnpj || customerSource?.documento || ''
    );
    const courierSource = payload?.courier && typeof payload.courier === 'object' ? payload.courier : {};
    const courier = {
      id: normalizeString(
        courierSource?.id ||
        courierSource?._id ||
        payload?.courierId ||
        payload?.entregadorId ||
        ''
      ),
      label: normalizeString(
        courierSource?.label ||
        courierSource?.nome ||
        courierSource?.name ||
        payload?.courierLabel ||
        payload?.entregador ||
        ''
      ),
    };
    const address =
      payload?.address && typeof payload.address === 'object'
        ? { ...payload.address }
        : payload?.deliveryAddress && typeof payload.deliveryAddress === 'object'
        ? { ...payload.deliveryAddress }
        : null;

    const existingSales = Array.isArray(existingState?.completedSales)
      ? existingState.completedSales.map((sale) => ({ ...sale }))
      : [];
    const existingBudgets = Array.isArray(existingState?.budgets)
      ? existingState.budgets.map((budget) => ({ ...budget }))
      : [];
    let nextSales = existingSales;
    let nextDeliveryOrders = Array.isArray(existingState?.deliveryOrders)
      ? existingState.deliveryOrders.map((order) => ({ ...order }))
      : [];
    let nextHistory = Array.isArray(existingState?.history)
      ? existingState.history.map((entry) => ({ ...entry }))
      : [];
    const nextSummary = {
      abertura: safeNumber(existingState?.summary?.abertura, 0),
      recebido: safeNumber(existingState?.summary?.recebido, 0),
      recebimentosCliente: safeNumber(existingState?.summary?.recebimentosCliente, 0),
      saldo: safeNumber(existingState?.summary?.saldo, 0),
    };
    const nextPagamentos = clonePaymentSnapshots(existingState?.pagamentos || []);
    const nextPrevisto = clonePaymentSnapshots(existingState?.caixaInfo?.previstoPagamentos || []);
    const nextApurado = clonePaymentSnapshots(existingState?.caixaInfo?.apuradoPagamentos || []);

    const deliveryStatus = normalizeString(payload?.status || payload?.deliveryStatus || '') || 'registrado';
    const incomingOrderId = normalizeString(payload?.orderId || payload?.deliveryOrderId || payload?.id || '');
    const incomingSaleId = normalizeString(payload?.saleId || payload?.saleRecordId || '');

    if (action === PDV_COMMANDS.DELIVERY_UPDATE_STATUS) {
      const allowedDeliveryStatuses = new Set(['registrado', 'emSeparacao', 'emRota', 'finalizado']);
      if (!incomingOrderId) {
        const error = new Error('Informe o delivery para atualizar o status.');
        error.statusCode = 400;
        throw error;
      }
      if (!allowedDeliveryStatuses.has(deliveryStatus)) {
        const error = new Error('Informe um status de delivery válido.');
        error.statusCode = 400;
        throw error;
      }

      const orderIndex = nextDeliveryOrders.findIndex(
        (order) => normalizeString(order?.id || '') === incomingOrderId
      );
      if (orderIndex < 0) {
        const error = new Error('Delivery não encontrado para atualizar o status.');
        error.statusCode = 404;
        throw error;
      }

      const currentOrder = { ...nextDeliveryOrders[orderIndex] };
      const currentStatus = normalizeString(currentOrder?.status || '');
      if (currentStatus === 'finalizado' && deliveryStatus !== 'finalizado') {
        const error = new Error('Delivery finalizado não pode ter o status alterado.');
        error.statusCode = 409;
        throw error;
      }
      if (currentStatus === deliveryStatus) {
        return {
          state: serializeStateForResponse(existingStateDoc),
          shouldEmit: false,
        };
      }

      const nowIso = now.toISOString();
      currentOrder.status = deliveryStatus;
      currentOrder.statusUpdatedAt = nowIso;
      currentOrder.updatedAt = nowIso;
      if (deliveryStatus === 'finalizado' && !currentOrder.finalizedAt) {
        currentOrder.finalizedAt = nowIso;
      }
      nextDeliveryOrders[orderIndex] = currentOrder;

      const updatedState = await PdvState.findOneAndUpdate(
        { pdv: pdvId },
        {
          $set: {
            deliveryOrders: nextDeliveryOrders,
            recentStateMutationKeys: getNextRecentMutationKeys(
              existingState?.recentStateMutationKeys || [],
              idempotencyKey
            ),
          },
          $setOnInsert: {
            pdv: pdvId,
            empresa: existingState?.empresa || pdvDoc?.empresa,
          },
        },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      );

      await syncPdvCaixaSessionHistory({
        pdvDoc,
        existingState,
        updatedState,
      });

      return {
        state: serializeStateForResponse(updatedState),
        shouldEmit: true,
      };
    }

    if (action === PDV_COMMANDS.DELIVERY_UPDATE_COURIER) {
      if (!incomingOrderId) {
        const error = new Error('Informe o delivery para atualizar o entregador.');
        error.statusCode = 400;
        throw error;
      }

      const orderIndex = nextDeliveryOrders.findIndex(
        (order) => normalizeString(order?.id || '') === incomingOrderId
      );
      if (orderIndex < 0) {
        const error = new Error('Delivery não encontrado para atualizar o entregador.');
        error.statusCode = 404;
        throw error;
      }

      const targetOrder = { ...nextDeliveryOrders[orderIndex] };
      const currentStatus = normalizeString(targetOrder?.status || '');
      if (currentStatus === 'emRota' || currentStatus === 'finalizado') {
        const error = new Error('Não é possível alterar entregador para delivery em rota ou finalizado.');
        error.statusCode = 409;
        throw error;
      }

      const currentCourier = targetOrder?.courier && typeof targetOrder.courier === 'object'
        ? {
            id: normalizeString(targetOrder.courier.id || targetOrder.courier._id || ''),
            label: normalizeString(targetOrder.courier.label || targetOrder.courier.nome || ''),
          }
        : { id: '', label: '' };
      const nextCourier = { ...courier };
      if (currentCourier.id === nextCourier.id && currentCourier.label === nextCourier.label) {
        return {
          state: serializeStateForResponse(existingStateDoc),
          shouldEmit: false,
        };
      }

      targetOrder.courier = nextCourier.id || nextCourier.label ? nextCourier : null;
      // Compatibilidade com payloads legados do front: mantém/limpa campos antigos
      targetOrder.courierId = nextCourier.id || '';
      targetOrder.courierLabel = nextCourier.label || '';
      targetOrder.entregadorId = nextCourier.id || '';
      targetOrder.entregador = nextCourier.label || '';
      targetOrder.deliveryCourierId = nextCourier.id || '';
      targetOrder.deliveryCourierLabel = nextCourier.label || '';
      targetOrder.updatedAt = now.toISOString();
      nextDeliveryOrders[orderIndex] = targetOrder;

      const updatedState = await PdvState.findOneAndUpdate(
        { pdv: pdvId },
        {
          $set: {
            deliveryOrders: nextDeliveryOrders,
            recentStateMutationKeys: getNextRecentMutationKeys(
              existingState?.recentStateMutationKeys || [],
              idempotencyKey
            ),
          },
          $setOnInsert: {
            pdv: pdvId,
            empresa: existingState?.empresa || pdvDoc?.empresa,
          },
        },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      );

      await syncPdvCaixaSessionHistory({
        pdvDoc,
        existingState,
        updatedState,
      });

      return {
        state: serializeStateForResponse(updatedState),
        shouldEmit: true,
      };
    }

    if (action === PDV_COMMANDS.DELIVERY_REGISTER) {
      if (!items.length) {
        const error = new Error('Adicione itens para registrar o delivery.');
        error.statusCode = 400;
        throw error;
      }
      if (!(totalLiquido > 0)) {
        const error = new Error('Informe o valor total do delivery.');
        error.statusCode = 400;
        throw error;
      }

      const saleRecord = normalizeSaleRecordPayload({
        id: incomingSaleId || `sale-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
        type: 'delivery',
        typeLabel: normalizeString(payload?.typeLabel || 'Delivery'),
        saleCode: normalizeString(payload?.saleCode || ''),
        saleCodeLabel: normalizeString(payload?.saleCodeLabel || ''),
        customerName,
        customerDocument,
        items,
        discountValue,
        additionValue,
        total: totalLiquido,
        totalLiquido,
        totalBruto,
        createdAt: safeDate(payload?.createdAt) || now,
        receiptSnapshot:
          payload?.receiptSnapshot && typeof payload.receiptSnapshot === 'object'
            ? payload.receiptSnapshot
            : null,
        status: 'completed',
        cashContributions: [],
      });
      nextSales = [saleRecord, ...nextSales];
      const ensuredCodes = await ensureUniquePdvCodes({
        pdvId,
        pdvDoc,
        sales: nextSales,
        budgets: existingBudgets,
        existingSales,
        existingBudgets,
      });
      nextSales = ensuredCodes.sales;
      const savedSale = nextSales.find(
        (sale) => normalizeString(sale?.id || sale?._id) === normalizeString(saleRecord.id)
      ) || saleRecord;

      const orderRecord = {
        id: incomingOrderId || buildDeliveryOrderId(),
        saleRecordId: normalizeString(savedSale?.id || ''),
        saleCode: normalizeString(savedSale?.saleCode || savedSale?.saleCodeLabel || ''),
        status: deliveryStatus,
        statusUpdatedAt: now.toISOString(),
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        total: totalLiquido,
        items: items.map((item) => ({ ...item })),
        payments: payments.map((payment) => ({ ...payment })),
        discount: discountValue,
        addition: additionValue,
        address: address ? { ...address } : null,
        courier,
        courierId: courier.id || '',
        courierLabel: courier.label || '',
        entregadorId: courier.id || '',
        entregador: courier.label || '',
        deliveryCourierId: courier.id || '',
        deliveryCourierLabel: courier.label || '',
        customer: customerSource && typeof customerSource === 'object' ? { ...customerSource } : null,
        customerName,
        customerDocument,
        receiptSnapshot:
          payload?.receiptSnapshot && typeof payload.receiptSnapshot === 'object'
            ? payload.receiptSnapshot
            : null,
      };
      nextDeliveryOrders = [orderRecord, ...nextDeliveryOrders];

      const updatedState = await PdvState.findOneAndUpdate(
        { pdv: pdvId },
        {
          $set: {
            completedSales: nextSales,
            deliveryOrders: nextDeliveryOrders,
            saleCodeSequence: ensuredCodes.nextSaleSequence,
            budgetSequence: ensuredCodes.nextBudgetSequence,
            recentStateMutationKeys: getNextRecentMutationKeys(
              existingState?.recentStateMutationKeys || [],
              idempotencyKey
            ),
          },
          $setOnInsert: {
            pdv: pdvId,
            empresa: existingState?.empresa || pdvDoc?.empresa,
          },
        },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      );

      await syncPdvCaixaSessionHistory({
        pdvDoc,
        existingState,
        updatedState,
      });

      return {
        state: serializeStateForResponse(updatedState),
        shouldEmit: true,
      };
    }

    // DELIVERY_FINALIZE
    const targetOrderId = incomingOrderId;
    if (!targetOrderId) {
      const error = new Error('Informe o delivery que será finalizado.');
      error.statusCode = 400;
      throw error;
    }
    const orderIndex = nextDeliveryOrders.findIndex(
      (order) => normalizeString(order?.id || '') === targetOrderId
    );
    if (orderIndex < 0) {
      const error = new Error('Delivery não encontrado para finalização.');
      error.statusCode = 404;
      throw error;
    }
    if (!(totalLiquido > 0)) {
      const error = new Error('Informe o valor total para finalizar o delivery.');
      error.statusCode = 400;
      throw error;
    }

    const targetOrder = { ...nextDeliveryOrders[orderIndex] };
    const targetSaleRecordId = normalizeString(
      payload?.saleRecordId || targetOrder?.saleRecordId || incomingSaleId
    );
    const saleIndex = nextSales.findIndex(
      (sale) => normalizeString(sale?.id || sale?._id) === targetSaleRecordId
    );

    const contributions = buildSaleContributionsFromPayments(payments);
    const paymentLabel = payments
      .map((payment) => `${payment.label || 'Pagamento'}: ${safeNumber(payment.valor, 0).toFixed(2)}`)
      .join(' | ');
    contributions.forEach((entry) => {
      const payment =
        resolveCommandTargetPayment(nextPagamentos, entry.paymentId) ||
        resolveCommandTargetPayment(nextPagamentos, entry.paymentLabel);
      if (payment) {
        payment.valor = safeNumber(payment.valor, 0) + safeNumber(entry.amount, 0);
      }
      const previsto =
        resolveCommandTargetPayment(nextPrevisto, entry.paymentId) ||
        resolveCommandTargetPayment(nextPrevisto, entry.paymentLabel);
      if (previsto) {
        previsto.valor = safeNumber(previsto.valor, 0) + safeNumber(entry.amount, 0);
      }
    });
    nextSummary.recebido = safeNumber(nextSummary.recebido, 0) + totalLiquido;
    nextSummary.saldo =
      safeNumber(nextSummary.abertura, 0) +
      safeNumber(nextSummary.recebido, 0) +
      safeNumber(nextSummary.recebimentosCliente, 0);

    const historyEntry = buildSaleHistoryEntry({
      saleCode: normalizeString(targetOrder?.saleCode || payload?.saleCode || ''),
      totalLiquido,
      paymentLabel,
      createdAt: now,
      userMeta: getCommandHistoryUserMeta(user || {}),
    });
    nextHistory = mergeRecordsByKey(nextHistory, historyEntry ? [historyEntry] : [], 'history');

    if (saleIndex >= 0) {
      const existingSale = nextSales[saleIndex];
      nextSales[saleIndex] = normalizeSaleRecordPayload({
        ...existingSale,
        saleCode: normalizeString(payload?.saleCode || existingSale?.saleCode || targetOrder?.saleCode || ''),
        saleCodeLabel: normalizeString(payload?.saleCode || existingSale?.saleCodeLabel || targetOrder?.saleCode || ''),
        items: items.length ? items : Array.isArray(existingSale?.items) ? existingSale.items : [],
        payments: payments.length ? payments : [],
        paymentTags: buildPaymentTagsFromPayments(payments),
        discountValue: discountValue || safeNumber(existingSale?.discountValue, 0),
        additionValue: additionValue || safeNumber(existingSale?.additionValue, 0),
        total: totalLiquido,
        totalLiquido,
        totalBruto: totalBruto || safeNumber(existingSale?.totalBruto, totalLiquido),
        customerName,
        customerDocument,
        cashContributions: contributions,
      });
    }

    const ensuredCodes = await ensureUniquePdvCodes({
      pdvId,
      pdvDoc,
      sales: nextSales,
      budgets: existingBudgets,
      existingSales,
      existingBudgets,
    });
    nextSales = ensuredCodes.sales;
    const saleForOrder = nextSales.find(
      (sale) => normalizeString(sale?.id || sale?._id) === normalizeString(targetSaleRecordId)
    );

    targetOrder.saleRecordId = normalizeString(saleForOrder?.id || targetOrder?.saleRecordId || '');
    targetOrder.saleCode = normalizeString(
      payload?.saleCode || saleForOrder?.saleCode || saleForOrder?.saleCodeLabel || targetOrder?.saleCode || ''
    );
    targetOrder.status = 'finalizado';
    targetOrder.statusUpdatedAt = now.toISOString();
    targetOrder.finalizedAt = now.toISOString();
    targetOrder.updatedAt = now.toISOString();
    targetOrder.total = totalLiquido;
    targetOrder.items = items.length ? items.map((item) => ({ ...item })) : targetOrder.items || [];
    targetOrder.payments = payments.map((payment) => ({ ...payment }));
    targetOrder.discount = discountValue;
    targetOrder.addition = additionValue;
    targetOrder.courier = courier.id || courier.label ? { ...courier } : targetOrder.courier || null;
    const effectiveCourier =
      targetOrder.courier && typeof targetOrder.courier === 'object'
        ? {
            id: normalizeString(targetOrder.courier.id || targetOrder.courier._id || ''),
            label: normalizeString(
              targetOrder.courier.label || targetOrder.courier.nome || targetOrder.courier.name || ''
            ),
          }
        : { id: '', label: '' };
    targetOrder.courierId = effectiveCourier.id || '';
    targetOrder.courierLabel = effectiveCourier.label || '';
    targetOrder.entregadorId = effectiveCourier.id || '';
    targetOrder.entregador = effectiveCourier.label || '';
    targetOrder.deliveryCourierId = effectiveCourier.id || '';
    targetOrder.deliveryCourierLabel = effectiveCourier.label || '';
    nextDeliveryOrders[orderIndex] = targetOrder;

    const existingInventoryMovements = Array.isArray(existingState?.inventoryMovements)
      ? existingState.inventoryMovements.map((movement) =>
          movement && typeof movement.toObject === 'function' ? movement.toObject() : movement
        )
      : [];
    let nextInventoryMovements = existingInventoryMovements;
    const depositConfig = pdvDoc?.configuracoesEstoque?.depositoPadrao || null;
    if (depositConfig) {
      const inventoryResult = await applyInventoryMovementsToSales({
        sales: nextSales,
        depositId: depositConfig,
        existingMovements: existingInventoryMovements,
        movementContext: {
          companyId: pdvDoc?.empresa || null,
          userId: user?.id || null,
          userName: normalizeString(user?.nomeCompleto || user?.apelido || user?.name || ''),
          userEmail: normalizeString(user?.email || ''),
        },
      });
      nextSales = inventoryResult.sales;
      const newInventoryMovements = inventoryResult.movements || [];
      const revertedSales = new Set(inventoryResult.revertedSales || []);
      let combinedMovements = existingInventoryMovements;
      if (revertedSales.size) {
        combinedMovements = combinedMovements.filter(
          (movement) => movement && !revertedSales.has(movement.saleId)
        );
      }
      if (newInventoryMovements.length) {
        combinedMovements = [...combinedMovements, ...newInventoryMovements];
      }
      nextInventoryMovements = combinedMovements;
    }

    const updatedState = await PdvState.findOneAndUpdate(
      { pdv: pdvId },
      {
        $set: {
          completedSales: nextSales,
          deliveryOrders: nextDeliveryOrders,
          pagamentos: nextPagamentos,
          summary: nextSummary,
          history: nextHistory,
          lastMovement: nextHistory[0] || null,
          caixaInfo: {
            ...(existingState?.caixaInfo || {}),
            previstoPagamentos: nextPrevisto,
            apuradoPagamentos: nextApurado,
            fechamentoPrevisto: nextPrevisto.reduce(
              (sum, payment) => sum + safeNumber(payment?.valor ?? 0, 0),
              0
            ),
          },
          inventoryMovements: nextInventoryMovements,
          saleCodeSequence: ensuredCodes.nextSaleSequence,
          budgetSequence: ensuredCodes.nextBudgetSequence,
          recentStateMutationKeys: getNextRecentMutationKeys(
            existingState?.recentStateMutationKeys || [],
            idempotencyKey
          ),
        },
        $setOnInsert: {
          pdv: pdvId,
          empresa: existingState?.empresa || pdvDoc?.empresa,
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    await syncPdvCaixaSessionHistory({
      pdvDoc,
      existingState,
      updatedState,
    });

    return {
      state: serializeStateForResponse(updatedState),
      shouldEmit: true,
    };
  }

  const error = new Error('Comando de PDV não suportado.');
  error.statusCode = 400;
  if (shouldTraceCommand) {
    perf.flush('error', { message: error.message, branch: action });
  }
  throw error;
};

router.post('/:id/commands', requireAuth, async (req, res) => {
  const routePerf = createPdvPerfTracer({
    scope: 'POST /:id/commands',
    pdvId: req.params?.id || '',
    action: normalizeString(req.body?.action || ''),
    requestId: normalizeString(req.get('x-idempotency-key')) || `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
  });
  routePerf.mark('start');
  try {
    const pdvId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(pdvId)) {
      routePerf.flush('validation_error', { message: 'Identificador de PDV inválido.' });
      return res.status(400).json({ message: 'Identificador de PDV inválido.' });
    }

    const pdv = await Pdv.findById(pdvId).lean();
    routePerf.mark('pdv_loaded');
    if (!pdv) {
      routePerf.flush('not_found', { message: 'PDV não encontrado.' });
      return res.status(404).json({ message: 'PDV não encontrado.' });
    }

    const { action, payload } = parsePdvCommandRequest(req.body || {});
    if (!action) {
      routePerf.flush('validation_error', { message: 'Informe a ação do comando do PDV.' });
      return res.status(400).json({ message: 'Informe a ação do comando do PDV.' });
    }

    const idempotencyKey = normalizeString(req.get('x-idempotency-key'));
    const commandResult = await enqueuePdvStateWrite(pdvId, async () => {
      return runPdvCommand({
        action,
        payload,
        pdvId,
        pdvDoc: pdv,
        idempotencyKey,
        user: req.user || {},
      });
    });
    routePerf.mark('command_executed');
    const state = commandResult?.state || serializeStateForResponse(null);

    if (commandResult?.shouldEmit) {
      const emitPdvStateUpdate =
        req.app && typeof req.app.get === 'function' ? req.app.get('emitPdvStateUpdate') : null;
      if (typeof emitPdvStateUpdate === 'function') {
        emitPdvStateUpdate({
          pdvId,
          payload: {
            updatedAt: state.updatedAt || new Date().toISOString(),
            state,
          },
        });
      }
    }
    routePerf.mark('emit_processed', { emitted: Boolean(commandResult?.shouldEmit) });
    routePerf.flush('ok', { shouldEmit: Boolean(commandResult?.shouldEmit) });

    return res.json({
      ok: true,
      action,
      state,
      meta: buildPdvCommandMeta(req),
    });
  } catch (error) {
    const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
    const message =
      error?.message && typeof error.message === 'string'
        ? error.message
        : 'Erro ao executar comando do PDV.';
    if (statusCode >= 500) {
      console.error('Erro ao executar comando do PDV:', error);
    } else {
      console.warn('Falha de validação em comando do PDV:', message);
    }
    routePerf.flush(statusCode >= 500 ? 'error' : 'validation_error', {
      statusCode,
      message,
    });
    return res.status(statusCode).json({ message });
  }
});

router.put('/:id/state', requireAuth, async (req, res) => {
  try {
    const pdvId = req.params.id;
    const idempotencyKey = normalizeString(
      req.get('x-idempotency-key') || req.body?._meta?.idempotencyKey || ''
    );
    const expectedUpdatedAt = normalizeString(req.body?._meta?.expectedUpdatedAt || '');
    const isLightweightUpdate = Boolean(req.body?._meta?.lightweight);

    if (!mongoose.Types.ObjectId.isValid(pdvId)) {
      return res.status(400).json({ message: 'Identificador de PDV invÃ¡lido.' });
    }

    const pdv = await Pdv.findById(pdvId).lean();

    if (!pdv) {
      return res.status(404).json({ message: 'PDV nÃ£o encontrado.' });
    }

    return enqueuePdvStateWrite(pdvId, async () => {
      const existingState = isLightweightUpdate
        ? await PdvState.findOne({ pdv: pdvId }).select(LIGHTWEIGHT_STATE_PROJECTION).lean()
        : await PdvState.findOne({ pdv: pdvId });
      if (
        idempotencyKey &&
        Array.isArray(existingState?.recentStateMutationKeys) &&
        existingState.recentStateMutationKeys.includes(idempotencyKey)
      ) {
        return res.json(serializeStateForResponse(existingState));
      }
      if (expectedUpdatedAt) {
        const currentUpdatedAt = existingState?.updatedAt || null;
        if (!sameInstant(currentUpdatedAt, expectedUpdatedAt)) {
          return res.status(409).json({
            message:
              'O estado do PDV foi atualizado por outro operador. Recarregue o estado atual antes de persistir novas alteracoes.',
            conflict: true,
            state: serializeStateForResponse(existingState),
          });
        }
      }

      const updatePayload = buildStateUpdatePayload({
        body: req.body || {},
        existingState: existingState || {},
        empresaId: pdv.empresa,
      });

      const isStartingNewCaixaCycle =
        !Boolean(existingState?.caixaAberto) && Boolean(updatePayload.caixaAberto);
      if (isStartingNewCaixaCycle) {
        updatePayload.caixaInfo = {
          ...updatePayload.caixaInfo,
          fechamentoData: null,
          fechamentoPrevisto: 0,
          fechamentoApurado: 0,
          previstoPagamentos: clonePaymentSnapshots(updatePayload.caixaInfo?.previstoPagamentos || []),
          apuradoPagamentos: [],
        };
      }

      updatePayload.history = isStartingNewCaixaCycle
        ? (Array.isArray(updatePayload.history) ? updatePayload.history : [])
        : mergeRecordsByKey(
            existingState?.history || [],
            updatePayload.history || [],
            'history'
          );
      updatePayload.history = filterHistoryForCurrentCycle(
        updatePayload.history,
        updatePayload?.caixaInfo?.aberturaData || existingState?.caixaInfo?.aberturaData || null
      );
      updatePayload.lastMovement = Array.isArray(updatePayload.history) && updatePayload.history.length
        ? updatePayload.history[0]
        : null;
      if (Boolean(existingState?.caixaAberto) && !Boolean(updatePayload.caixaAberto)) {
        if (!hasExplicitCaixaClosure(updatePayload)) {
          return res.status(409).json({
            message:
              'O fechamento do caixa foi rejeitado porque a requisição nao trouxe os dados explicitos de fechamento. Recarregue o PDV e tente novamente.',
            conflict: true,
            state: serializeStateForResponse(existingState),
          });
        }
      }

      if (isLightweightUpdate) {
        delete updatePayload.completedSales;
        delete updatePayload.budgets;
        delete updatePayload.deliveryOrders;
        delete updatePayload.accountsReceivable;
      } else {
        updatePayload.completedSales = mergeRecordsByKey(
          existingState?.completedSales || [],
          updatePayload.completedSales || [],
          'sale'
        );
        updatePayload.completedSales = dedupeSalesById(updatePayload.completedSales);
        updatePayload.budgets = mergeRecordsByKey(
          existingState?.budgets || [],
          updatePayload.budgets || [],
          'budget'
        );
        updatePayload.deliveryOrders = mergeRecordsByKey(
          existingState?.deliveryOrders || [],
          updatePayload.deliveryOrders || [],
          'delivery'
        );
        updatePayload.accountsReceivable = mergeRecordsByKey(
          existingState?.accountsReceivable || [],
          updatePayload.accountsReceivable || [],
          'receivable'
        );
        const ensuredCodes = await ensureUniquePdvCodes({
          pdvId,
          pdvDoc: pdv,
          sales: updatePayload.completedSales,
          budgets: updatePayload.budgets,
          existingSales: existingState?.completedSales || [],
          existingBudgets: existingState?.budgets || [],
        });
        updatePayload.completedSales = ensuredCodes.sales;
        updatePayload.budgets = ensuredCodes.budgets;
        updatePayload.saleCodeSequence = ensuredCodes.nextSaleSequence;
        updatePayload.budgetSequence = ensuredCodes.nextBudgetSequence;

        const productIds = collectProductIdsFromSales(updatePayload.completedSales);
        if (productIds.length) {
          const products = await Product.find({ _id: { $in: productIds } })
            .select('custo custoMedio custoCalculado precoCusto precoCustoUnitario')
            .lean();
          const productMap = new Map(products.map((product) => [product._id.toString(), product]));
          ensureSalesHaveCostData(updatePayload.completedSales, productMap);
        }

        updatePayload.completedSales = mergeInventoryProcessingStatus(
          updatePayload.completedSales || [],
          existingState?.completedSales || []
        );

        const depositConfig = pdv?.configuracoesEstoque?.depositoPadrao || null;
        const existingInventoryMovements = Array.isArray(existingState?.inventoryMovements)
          ? existingState.inventoryMovements.map((movement) =>
              movement && typeof movement.toObject === 'function' ? movement.toObject() : movement
            )
          : [];

        if (depositConfig) {
          const inventoryResult = await applyInventoryMovementsToSales({
            sales: updatePayload.completedSales,
            depositId: depositConfig,
            existingMovements: existingInventoryMovements,
            movementContext: {
              companyId: pdv?.empresa || null,
              userId: req.user?.id,
              userName: normalizeString(req.user?.nomeCompleto || req.user?.apelido || req.user?.name || ''),
              userEmail: normalizeString(req.user?.email || ''),
            },
          });
          updatePayload.completedSales = inventoryResult.sales;
          const newInventoryMovements = inventoryResult.movements || [];
          const revertedSales = new Set(inventoryResult.revertedSales || []);
          let combinedMovements = existingInventoryMovements;
          if (revertedSales.size) {
            combinedMovements = combinedMovements.filter(
              (movement) => movement && !revertedSales.has(movement.saleId)
            );
          }
          if (newInventoryMovements.length) {
            combinedMovements = [...combinedMovements, ...newInventoryMovements];
          }
          if (revertedSales.size || newInventoryMovements.length) {
            updatePayload.inventoryMovements = combinedMovements;
          }
        }

        reconcileCashStateFromSales({ existingState, updatePayload });
      }

      let updatedState;
      try {
        let updateQuery = PdvState.findOneAndUpdate(
          { pdv: pdvId },
          {
            ...updatePayload,
            pdv: pdvId,
            empresa: updatePayload.empresa || pdv.empresa,
          },
          { new: true, upsert: true, setDefaultsOnInsert: true }
        );
        if (isLightweightUpdate) {
          updateQuery = updateQuery.select(LIGHTWEIGHT_STATE_PROJECTION);
        }
        updatedState = await updateQuery;
      } catch (updateError) {
        if (updateError?.code === 11000 && updateError?.keyPattern?.pdv) {
          const currentState = await PdvState.findOne({ pdv: pdvId });
          return res.status(409).json({
            message:
              'O estado do PDV foi criado ou atualizado por outro operador durante a gravaÃ§Ã£o. Recarregue o estado atual antes de persistir novas alteraÃ§Ãµes.',
            conflict: true,
            state: serializeStateForResponse(currentState),
          });
        }
        throw updateError;
      }

      const serialized = serializeStateForResponse(updatedState);
      res.json(serialized);

      setImmediate(async () => {
        if (idempotencyKey && updatedState?._id) {
          try {
            await PdvState.updateOne(
              { _id: updatedState._id },
              [
                {
                  $set: {
                    recentStateMutationKeys: {
                      $slice: [
                        {
                          $setUnion: [
                            { $ifNull: ['$recentStateMutationKeys', []] },
                            [idempotencyKey],
                          ],
                        },
                        -100,
                      ],
                    },
                  },
                },
              ]
            );
          } catch (mutationKeyError) {
            console.error('Erro ao registrar chave idempotente do estado do PDV:', mutationKeyError);
          }
        }

        try {
          const sessionState = isLightweightUpdate
            ? await PdvState.findById(updatedState?._id)
            : updatedState;
          await syncPdvCaixaSessionHistory({
            pdvDoc: pdv,
            existingState,
            updatedState: sessionState,
          });
        } catch (historyError) {
          console.error('Erro ao sincronizar histÃ³rico de caixas do PDV:', historyError);
        }

        try {
          const emitPdvStateUpdate =
            req.app && typeof req.app.get === 'function' ? req.app.get('emitPdvStateUpdate') : null;
          if (typeof emitPdvStateUpdate === 'function') {
            emitPdvStateUpdate({
              pdvId,
              payload: {
                updatedAt: serialized.updatedAt || new Date().toISOString(),
                state: serialized,
              },
            });
          }
        } catch (emitError) {
          console.error('Erro ao emitir atualizaÃ§Ã£o em tempo real do PDV:', emitError);
        }
      });

      return;
    });
  } catch (error) {
    console.error('Erro ao salvar estado do PDV:', error);
    res.status(500).json({ message: 'Erro ao salvar estado do PDV.' });
  }
});
router.delete('/:id', requireAuth, authorizeRoles('admin', 'admin_master'), async (req, res) => {
  try {
    const deleted = await Pdv.findByIdAndDelete(req.params.id);
    if (!deleted) {
      return res.status(404).json({ message: 'PDV nÃ£o encontrado.' });
    }
    res.json({ message: 'PDV removido com sucesso.' });
  } catch (error) {
    console.error('Erro ao remover PDV:', error);
    res.status(500).json({ message: 'Erro ao remover PDV.' });
  }
});

module.exports = router;

