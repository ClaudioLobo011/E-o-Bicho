const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
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
    item.produtoSnapshot?._id,
    item.produtoSnapshot?.id,
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
  const source = Array.isArray(sale.fiscalItemsSnapshot)
    ? sale.fiscalItemsSnapshot
    : Array.isArray(sale.receiptSnapshot?.itens)
    ? sale.receiptSnapshot.itens
    : [];
  for (const item of source) {
    const productId = extractProductIdFromSnapshot(item);
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

  if (entry) {
    let current = 0;
    if (typeof entry.quantidade === 'string') {
      const parsed = Number(entry.quantidade.replace(',', '.'));
      current = Number.isFinite(parsed) ? parsed : 0;
    } else {
      current = safeNumber(entry.quantidade, 0);
    }
    entry.quantidade = current - numericQuantity;
  } else {
    entry = {
      deposito: depositObjectId,
      quantidade: -numericQuantity,
      unidade: product.unidade || 'UN',
    };
    product.estoques.push(entry);
  }

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

const applyInventoryMovementsToSales = async ({ sales, depositId, existingMovements = [] }) => {
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
  const paymentTags = Array.isArray(record.paymentTags)
    ? record.paymentTags.map((tag) => normalizeString(tag)).filter(Boolean)
    : [];
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
      merged[foundIndex] = record;
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

router.put('/:id/state', requireAuth, async (req, res) => {
  try {
    const pdvId = req.params.id;
    const idempotencyKey = normalizeString(
      req.get('x-idempotency-key') || req.body?._meta?.idempotencyKey || ''
    );
    const expectedUpdatedAt = normalizeString(req.body?._meta?.expectedUpdatedAt || '');

    if (!mongoose.Types.ObjectId.isValid(pdvId)) {
      return res.status(400).json({ message: 'Identificador de PDV invÃ¡lido.' });
    }

    const pdv = await Pdv.findById(pdvId).lean();

    if (!pdv) {
      return res.status(404).json({ message: 'PDV nÃ£o encontrado.' });
    }

    return enqueuePdvStateWrite(pdvId, async () => {
      const existingState = await PdvState.findOne({ pdv: pdvId });
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

      let updatedState;
      try {
        updatedState = await PdvState.findOneAndUpdate(
          { pdv: pdvId },
          {
            ...updatePayload,
            pdv: pdvId,
            empresa: updatePayload.empresa || pdv.empresa,
          },
          { new: true, upsert: true, setDefaultsOnInsert: true }
        );
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

      if (idempotencyKey && updatedState) {
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
      }

      try {
        await syncPdvCaixaSessionHistory({
          pdvDoc: pdv,
          existingState,
          updatedState,
        });
      } catch (historyError) {
        console.error('Erro ao sincronizar histÃ³rico de caixas do PDV:', historyError);
      }

      const serialized = serializeStateForResponse(updatedState);
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

      return res.json(serialized);
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

