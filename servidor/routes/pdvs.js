const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const Pdv = require('../models/Pdv');
const Store = require('../models/Store');
const Deposit = require('../models/Deposit');
const PdvState = require('../models/PdvState');
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

const ambientesPermitidos = ['homologacao', 'producao'];
const ambientesSet = new Set(ambientesPermitidos);
const opcoesImpressao = ['sim', 'nao', 'perguntar'];
const opcoesImpressaoSet = new Set(opcoesImpressao);
const perfisDesconto = ['funcionario', 'gerente', 'admin'];
const perfisDescontoSet = new Set(perfisDesconto);
const tiposEmissao = ['matricial', 'fiscal', 'ambos'];
const tiposEmissaoSet = new Set(tiposEmissao);

let qrCodeModulePromise;

const loadQrCodeModule = () => {
  if (!qrCodeModulePromise) {
    qrCodeModulePromise = import('qrcode')
      .then((mod) => mod?.default || mod)
      .catch((error) => {
        console.error('Não foi possível carregar a dependência "qrcode".', error);
        return null;
      });
  }
  return qrCodeModulePromise;
};

const normalizeString = (value) => {
  if (value === undefined || value === null) return '';
  return String(value).trim();
};

const generateQrCodeDataUrl = async (payload) => {
  const normalized = normalizeString(payload);
  if (!normalized) return '';

  const qrCode = await loadQrCodeModule();
  if (!qrCode || typeof qrCode.toDataURL !== 'function') {
    console.error('Dependência "qrcode" indisponível para gerar imagem.');
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
      ? `Informe um número atual válido para ${label}.`
      : `Informe um número inicial válido para ${label}.`;
    throw createValidationError(message);
  }

  const integer = Math.trunc(normalized);
  const min = allowZero ? 0 : 1;
  if (integer < min) {
    const message = allowZero
      ? `O número atual de ${label} deve ser maior ou igual a ${min}.`
      : `O número inicial de ${label} deve ser maior ou igual a ${min}.`;
    throw createValidationError(message);
  }

  return integer;
};

const parseSempreImprimir = (value) => {
  const normalized = normalizeString(value).toLowerCase();
  if (!normalized) return 'perguntar';
  if (!opcoesImpressaoSet.has(normalized)) {
    throw createValidationError('Selecione uma opção válida para "Sempre imprimir".');
  }
  return normalized;
};

const parseCopias = (value, { allowNull = true } = {}) => {
  if (value === undefined || value === null || value === '') {
    return allowNull ? null : 1;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw createValidationError('Informe um número válido de vias para a impressora selecionada.');
  }
  const inteiro = Math.trunc(parsed);
  if (inteiro < 1 || inteiro > 10) {
    throw createValidationError('O número de vias deve estar entre 1 e 10.');
  }
  return inteiro;
};

const buildPrinterPayload = (payload) => {
  if (!payload) return null;

  const nome = normalizeString(payload.nome || payload.printer || payload.nomeImpressora);
  const vias = parseCopias(payload.vias ?? payload.copias ?? payload.copiasImpressao ?? '', {
    allowNull: !nome,
  });

  if (!nome) {
    return null;
  }

  return {
    nome,
    vias: vias ?? 1,
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
    throw createValidationError('Selecione um tipo de emissão padrão válido.');
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
    console.warn('Produto não encontrado para movimentação de estoque no PDV.', {
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
    console.error('Erro ao salvar movimentação de estoque do produto no PDV.', {
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
  const label = normalizeString(entry.label || entry.descricao || entry.tipo) || 'Movimentação';
  const amount = safeNumber(entry.amount ?? entry.valor ?? entry.delta ?? 0, 0);
  const delta = safeNumber(entry.delta ?? entry.valor ?? amount, 0);
  const motivo = normalizeString(entry.motivo || entry.observacao);
  const paymentLabel = normalizeString(entry.paymentLabel || entry.meioPagamento || entry.formaPagamento);
  const paymentId = normalizeString(entry.paymentId || entry.formaPagamentoId || entry.payment || entry.paymentMethodId);
  const timestamp = safeDate(entry.timestamp || entry.data || entry.createdAt || entry.atualizadoEm) || new Date();
  return {
    id: id || undefined,
    label,
    amount,
    delta,
    motivo,
    paymentLabel,
    paymentId,
    timestamp,
  };
};

const normalizeSaleRecordPayload = (record) => {
  if (!record || typeof record !== 'object') return null;
  const id = normalizeString(record.id || record._id) || `sale-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const type = normalizeString(record.type) || 'venda';
  const typeLabel = normalizeString(record.typeLabel) || (type === 'delivery' ? 'Delivery' : 'Venda');
  const saleCode = normalizeString(record.saleCode);
  const saleCodeLabel = normalizeString(record.saleCodeLabel) || saleCode || 'Sem código';
  const customerName =
    normalizeString(record.customerName) || normalizeString(record.cliente) || 'Cliente não informado';
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
    : [];
  const cashContributions = cashContributionsSource
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const paymentId = normalizeString(entry.paymentId || entry.id);
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

const buildStateUpdatePayload = ({ body = {}, existingState = {}, empresaId }) => {
  const caixaAberto = Boolean(
    body.caixaAberto ?? body.caixa?.aberto ?? body.statusCaixa === 'aberto' ?? existingState.caixaAberto
  );
  const summarySource = body.summary || body.caixa?.resumo || {};
  const caixaSource = body.caixaInfo || body.caixa || {};
  const pagamentosSource = Array.isArray(body.pagamentos) ? body.pagamentos : body.caixa?.pagamentos;
  const historicoSource = Array.isArray(body.history) ? body.history : body.caixa?.historico;
  const vendasSource = Array.isArray(body.completedSales) ? body.completedSales : body.caixa?.vendas;
  const previstoSource = caixaSource.previstoPagamentos || caixaSource.pagamentosPrevistos;
  const apuradoSource = caixaSource.apuradoPagamentos || caixaSource.pagamentosApurados;
  const lastMovementSource = body.lastMovement || body.caixa?.ultimoLancamento;
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
      saldo: safeNumber(summarySource.saldo ?? existingState.summary?.saldo ?? 0, 0),
    },
    caixaInfo: {
      aberturaData:
        safeDate(caixaSource.aberturaData || caixaSource.dataAbertura || caixaSource.abertura || existingState.caixaInfo?.aberturaData) ||
        null,
      fechamentoData:
        safeDate(caixaSource.fechamentoData || caixaSource.dataFechamento || caixaSource.fechamento || existingState.caixaInfo?.fechamentoData) ||
        null,
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
      },
      pagamentos: [],
      summary: { abertura: 0, recebido: 0, saldo: 0 },
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
    },
    pagamentos,
    summary: {
      abertura: summary.abertura || 0,
      recebido: summary.recebido || 0,
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
  let limiteOffline = permitirModoOffline ? parseNumber(body.limiteOffline) : null;
  if (limiteOffline === null && permitirModoOffline) {
    limiteOffline = 0;
  }

  if (limiteOffline !== null && limiteOffline < 0) {
    throw new Error('O limite de emissões offline deve ser maior ou igual a zero.');
  }

  if (!ambientesHabilitados.length) {
    throw new Error('Informe ao menos um ambiente fiscal habilitado.');
  }

  if (!ambientePadrao) {
    throw new Error('Informe o ambiente padrão de emissão.');
  }

  if (!ambientesHabilitados.includes(ambientePadrao)) {
    throw new Error('O ambiente padrão precisa estar entre os ambientes habilitados.');
  }

  for (const env of ambientesHabilitados) {
    if (!storeSupportsEnvironment(store, env)) {
      if (env === 'producao') {
        throw new Error('A empresa selecionada não possui CSC configurado para Produção.');
      }
      if (env === 'homologacao') {
        throw new Error('A empresa selecionada não possui CSC configurado para Homologação.');
      }
      throw new Error('Ambiente fiscal indisponível para a empresa selecionada.');
    }
  }

  if (numeroNfeInicial !== null && numeroNfeAtual !== null && numeroNfeAtual < numeroNfeInicial - 1) {
    throw createValidationError(
      'O número atual da NF-e não pode ser inferior ao número inicial menos um.'
    );
  }

  if (numeroNfceInicial !== null && numeroNfceAtual !== null && numeroNfceAtual < numeroNfceInicial - 1) {
    throw createValidationError(
      'O número atual da NFC-e não pode ser inferior ao número inicial menos um.'
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
    limiteOffline,
    observacoes,
  };
};

router.get('/', async (req, res) => {
  try {
    const { empresa } = req.query;
    const query = {};
    if (empresa) {
      query.empresa = empresa;
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

router.get('/next-code', async (req, res) => {
  try {
    const codigo = await generateNextCode();
    res.json({ codigo });
  } catch (error) {
    console.error('Erro ao gerar próximo código de PDV:', error);
    res.status(500).json({ message: 'Erro ao gerar próximo código.' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const pdv = await Pdv.findById(req.params.id)
      .populate('empresa')
      .populate('configuracoesEstoque.depositoPadrao')
      .populate('configuracoesFinanceiro.contaCorrente')
      .populate('configuracoesFinanceiro.contaContabilReceber')
      .populate('configuracoesFinanceiro.contaContabilPagar')
      .lean();

    if (!pdv) {
      return res.status(404).json({ message: 'PDV não encontrado.' });
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
      return res.status(400).json({ message: 'O nome do PDV é obrigatório.' });
    }
    if (!empresaId) {
      return res.status(400).json({ message: 'Selecione a empresa responsável pelo PDV.' });
    }

    const store = await Store.findById(empresaId).lean();
    if (!store) {
      return res.status(400).json({ message: 'Empresa informada não foi encontrada.' });
    }

    let codigo = normalizeString(req.body.codigo);
    if (!codigo) {
      codigo = await generateNextCode();
    }

    const codigoDuplicado = await Pdv.exists({ codigo });
    if (codigoDuplicado) {
      return res.status(409).json({ message: 'Já existe um PDV com este código.' });
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
      return res.status(400).json({ message: 'O nome do PDV é obrigatório.' });
    }
    if (!empresaId) {
      return res.status(400).json({ message: 'Selecione a empresa responsável pelo PDV.' });
    }

    const store = await Store.findById(empresaId).lean();
    if (!store) {
      return res.status(400).json({ message: 'Empresa informada não foi encontrada.' });
    }

    let payload;
    try {
      payload = buildPdvPayload({ body: req.body, store });
    } catch (validationError) {
      return res.status(400).json({ message: validationError.message });
    }

    const codigo = normalizeString(req.body.codigo);
    if (!codigo) {
      return res.status(400).json({ message: 'O código do PDV é obrigatório.' });
    }

    const duplicado = await Pdv.findOne({ codigo, _id: { $ne: pdvId } });
    if (duplicado) {
      return res.status(409).json({ message: 'Já existe outro PDV com este código.' });
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
      return res.status(404).json({ message: 'PDV não encontrado.' });
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
      return res.status(400).json({ message: 'Identificador de PDV inválido.' });
    }

    if (!saleId) {
      return res.status(400).json({ message: 'Identificador da venda é obrigatório.' });
    }

    if (!isR2Configured()) {
      return res
        .status(500)
        .json({ message: 'Armazenamento externo não está configurado (Cloudflare R2).' });
    }

    const pdv = await Pdv.findById(pdvId).populate('empresa');

    if (!pdv) {
      return res.status(404).json({ message: 'PDV não encontrado.' });
    }

    const empresaId = pdv.empresa?._id || pdv.empresa;
    if (!empresaId) {
      return res.status(400).json({ message: 'Empresa vinculada ao PDV não foi encontrada.' });
    }

    const empresa = await Store.findById(empresaId).select(
      '+certificadoArquivoCriptografado +certificadoSenhaCriptografada +cscTokenProducaoCriptografado +cscTokenHomologacaoCriptografado'
    );

    if (!empresa) {
      return res.status(400).json({ message: 'Empresa vinculada ao PDV não foi encontrada.' });
    }

    if (!empresa.certificadoArquivoCriptografado || !empresa.certificadoSenhaCriptografada) {
      return res.status(400).json({ message: 'A empresa não possui certificado digital configurado.' });
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
        .json({ message: 'O ambiente selecionado não está habilitado para este PDV.' });
    }

    if (!storeSupportsEnvironment(empresa, ambiente)) {
      const ambienteLabel = ambiente === 'producao' ? 'Produção' : 'Homologação';
      return res
        .status(400)
        .json({ message: `A empresa não possui CSC configurado para ${ambienteLabel}.` });
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
      return res.status(404).json({ message: 'Venda informada não foi encontrada.' });
    }

    if (sale.status === 'cancelled') {
      return res
        .status(400)
        .json({ message: 'Não é possível emitir nota fiscal para uma venda cancelada.' });
    }

    if (sale.fiscalStatus === 'emitted' && (sale.fiscalDriveFileId || sale.fiscalXmlUrl)) {
      return res.status(409).json({ message: 'Esta venda já possui XML emitido.' });
    }

    const snapshotFromRequest = req.body?.snapshot;
    if (!sale.receiptSnapshot && snapshotFromRequest) {
      sale.receiptSnapshot = snapshotFromRequest;
    }

    if (!sale.saleCode && req.body?.saleCode) {
      sale.saleCode = normalizeString(req.body.saleCode);
      sale.saleCodeLabel = sale.saleCode || 'Sem código';
    }

    if (!sale.receiptSnapshot) {
      return res
        .status(400)
        .json({ message: 'Snapshot da venda indisponível para emissão fiscal.' });
    }

    const serieNfce = normalizeString(pdv.serieNfce || pdv.serieNfe);

    if (!serieNfce) {
      return res
        .status(400)
        .json({ message: 'Configure a série fiscal do PDV antes de emitir a nota.' });
    }

    const numeroInicialNfce = Number.isInteger(pdv.numeroNfceInicial)
      ? pdv.numeroNfceInicial
      : null;
    const numeroInicialNfe = Number.isInteger(pdv.numeroNfeInicial) ? pdv.numeroNfeInicial : null;
    const numeroInicial = numeroInicialNfce || numeroInicialNfe || null;

    if (!numeroInicial || numeroInicial < 1) {
      return res
        .status(400)
        .json({ message: 'Configure o número inicial de emissão para o PDV.' });
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
          console.error('Falha ao restaurar status fiscal após rejeição:', persistError);
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
      return res.status(404).json({ message: 'PDV não encontrado.' });
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
          throw createValidationError('Depósito selecionado é inválido.');
        }
        const deposito = await Deposit.findOne({ _id: depositoPadraoId, empresa: pdv.empresa });
        if (!deposito) {
          throw createValidationError('Depósito selecionado não pertence à mesma empresa do PDV.');
        }
      }
    }

    let contaCorrenteId = null;
    const contaCorrenteRaw = normalizeString(financeiroPayload.contaCorrente);
    if (contaCorrenteRaw) {
      if (!mongoose.Types.ObjectId.isValid(contaCorrenteRaw)) {
        throw createValidationError('Conta corrente selecionada é inválida.');
      }
      const contaCorrente = await BankAccount.findOne({
        _id: contaCorrenteRaw,
        company: pdv.empresa,
      });
      if (!contaCorrente) {
        throw createValidationError('Conta corrente selecionada não pertence à mesma empresa do PDV.');
      }
      contaCorrenteId = contaCorrente._id;
    }

    let contaContabilReceberId = null;
    const contaContabilReceberRaw = normalizeString(financeiroPayload.contaContabilReceber);
    if (contaContabilReceberRaw) {
      if (!mongoose.Types.ObjectId.isValid(contaContabilReceberRaw)) {
        throw createValidationError('Conta contábil de receber selecionada é inválida.');
      }
      const contaReceber = await AccountingAccount.findOne({
        _id: contaContabilReceberRaw,
        companies: pdv.empresa,
        paymentNature: 'contas_receber',
      });
      if (!contaReceber) {
        throw createValidationError(
          'Conta contábil de receber selecionada não pertence à empresa ou não está classificada como contas a receber.'
        );
      }
      contaContabilReceberId = contaReceber._id;
    }

    let contaContabilPagarId = null;
    const contaContabilPagarRaw = normalizeString(financeiroPayload.contaContabilPagar);
    if (contaContabilPagarRaw) {
      if (!mongoose.Types.ObjectId.isValid(contaContabilPagarRaw)) {
        throw createValidationError('Conta contábil de pagar selecionada é inválida.');
      }
      const contaPagar = await AccountingAccount.findOne({
        _id: contaContabilPagarRaw,
        companies: pdv.empresa,
        paymentNature: 'contas_pagar',
      });
      if (!contaPagar) {
        throw createValidationError(
          'Conta contábil de pagar selecionada não pertence à empresa ou não está classificada como contas a pagar.'
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
        : 'Erro ao salvar configurações do PDV.';
    console.error('Erro ao salvar configurações do PDV:', error);
    res.status(statusCode).json({ message });
  }
});

router.put('/:id/state', requireAuth, async (req, res) => {
  try {
    const pdvId = req.params.id;

    if (!mongoose.Types.ObjectId.isValid(pdvId)) {
      return res.status(400).json({ message: 'Identificador de PDV inválido.' });
    }

    const pdv = await Pdv.findById(pdvId).lean();

    if (!pdv) {
      return res.status(404).json({ message: 'PDV não encontrado.' });
    }

    const existingState = await PdvState.findOne({ pdv: pdvId });

    const updatePayload = buildStateUpdatePayload({
      body: req.body || {},
      existingState: existingState || {},
      empresaId: pdv.empresa,
    });

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
    let newInventoryMovements = [];

    if (depositConfig) {
      const inventoryResult = await applyInventoryMovementsToSales({
        sales: updatePayload.completedSales,
        depositId: depositConfig,
        existingMovements: existingInventoryMovements,
      });
      updatePayload.completedSales = inventoryResult.sales;
      newInventoryMovements = inventoryResult.movements || [];
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

    const updatedState = await PdvState.findOneAndUpdate(
      { pdv: pdvId },
      {
        ...updatePayload,
        pdv: pdvId,
        empresa: updatePayload.empresa || pdv.empresa,
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    const serialized = serializeStateForResponse(updatedState);

    res.json(serialized);
  } catch (error) {
    console.error('Erro ao salvar estado do PDV:', error);
    res.status(500).json({ message: 'Erro ao salvar estado do PDV.' });
  }
});

router.delete('/:id', requireAuth, authorizeRoles('admin', 'admin_master'), async (req, res) => {
  try {
    const deleted = await Pdv.findByIdAndDelete(req.params.id);
    if (!deleted) {
      return res.status(404).json({ message: 'PDV não encontrado.' });
    }
    res.json({ message: 'PDV removido com sucesso.' });
  } catch (error) {
    console.error('Erro ao remover PDV:', error);
    res.status(500).json({ message: 'Erro ao remover PDV.' });
  }
});

module.exports = router;
