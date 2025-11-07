const mongoose = require('mongoose');
const Product = require('../models/Product');
const {
  recalculateFractionalStockForProduct,
  refreshParentFractionalStocks,
} = require('./fractionalInventory');

const toObjectIdOrNull = (value) => {
  if (!value) return null;
  if (value instanceof mongoose.Types.ObjectId) {
    return value;
  }
  if (typeof value === 'object' && value._id) {
    return toObjectIdOrNull(value._id);
  }
  const normalized = String(value).trim();
  if (!mongoose.Types.ObjectId.isValid(normalized)) {
    return null;
  }
  return new mongoose.Types.ObjectId(normalized);
};

const resolveProductObjectId = (value) => {
  if (!value) return null;
  if (value instanceof mongoose.Types.ObjectId) {
    return value;
  }
  if (typeof value === 'object' && value._id) {
    return resolveProductObjectId(value._id);
  }
  if (mongoose.Types.ObjectId.isValid(String(value))) {
    return new mongoose.Types.ObjectId(String(value));
  }
  return null;
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

const adjustProductStockForDeposit = async ({
  productId,
  depositId,
  quantity,
  session,
  cascadeFractional = true,
  visited,
}) => {
  const delta = Number(quantity);
  if (!Number.isFinite(delta) || delta === 0) {
    return { updated: false };
  }

  const productObjectId = resolveProductObjectId(productId);
  const depositObjectId = toObjectIdOrNull(depositId);
  if (!productObjectId || !depositObjectId) {
    return { updated: false };
  }

  const tolerance = 0.000001;

  const loadProduct = async () => Product.findById(productObjectId).session(session);

  let product = await loadProduct();
  if (!product) {
    const error = new Error('Produto vinculado à movimentação de estoque não foi encontrado.');
    error.statusCode = 400;
    error.details = { productId: String(productId) };
    throw error;
  }

  if (!Array.isArray(product.estoques)) {
    product.estoques = [];
  }

  const visitSet = visited instanceof Set ? visited : new Set();
  const visitKey = product._id.toString();
  const alreadyVisited = visitSet.has(visitKey);
  if (!alreadyVisited) {
    visitSet.add(visitKey);
  }

  const depositKey = depositObjectId.toString();

  const findEntry = () =>
    product.estoques.find(
      (stockEntry) => stockEntry?.deposito && stockEntry.deposito.toString() === depositKey,
    );

  const refreshFractionalSnapshot = async (context) => {
    const fractionalConfig = product?.fracionado;
    if (!fractionalConfig || !fractionalConfig.ativo) {
      return false;
    }

    try {
      await recalculateFractionalStockForProduct(product._id, { session });
      const reloaded = await loadProduct();
      if (!reloaded) {
        return false;
      }

      product.estoques = Array.isArray(reloaded.estoques) ? reloaded.estoques : [];
      product.fracionado = reloaded.fracionado;
      product.stock = reloaded.stock;
      return Boolean(findEntry());
    } catch (error) {
      console.error(
        'Erro ao sincronizar estoque fracionado antes da movimentação de estoque.',
        {
          productId: product._id.toString(),
          depositId: depositKey,
          context,
        },
        error,
      );
      return false;
    }
  };

  let entry = findEntry();

  if (!entry && delta < 0) {
    const refreshed = await refreshFractionalSnapshot('missing_entry');
    if (refreshed) {
      entry = findEntry();
    }
  }

  if (!entry) {
    entry = {
      deposito: depositObjectId,
      quantidade: 0,
      unidade: product.unidade || 'UN',
    };
    product.estoques.push(entry);
  }

  const computeNextQuantity = () => {
    const currentQuantity = Number(entry?.quantidade) || 0;
    const nextQuantityRaw = currentQuantity + delta;
    const nextQuantity = Math.round(nextQuantityRaw * 1_000_000) / 1_000_000;
    return { currentQuantity, nextQuantity };
  };

  let { currentQuantity, nextQuantity } = computeNextQuantity();

  if (delta < 0 && nextQuantity < -tolerance) {
    const refreshed = await refreshFractionalSnapshot('insufficient_stock');
    if (refreshed) {
      entry = findEntry() || entry;
      ({ currentQuantity, nextQuantity } = computeNextQuantity());
    }
  }

  if (delta < 0 && nextQuantity < -tolerance) {
    const error = new Error('Estoque insuficiente para concluir a movimentação.');
    error.statusCode = 400;
    error.details = {
      productId: product._id.toString(),
      depositId: depositKey,
      available: currentQuantity,
      requested: delta,
    };
    throw error;
  }

  entry.quantidade = nextQuantity > 0 ? nextQuantity : 0;
  if (!entry.unidade) {
    entry.unidade = product.unidade || 'UN';
  }

  const totalStock = product.estoques.reduce((sum, stockEntry) => {
    const qty = Number(stockEntry?.quantidade);
    return sum + (Number.isFinite(qty) ? qty : 0);
  }, 0);

  product.stock = Math.max(0, Math.round(totalStock * 1_000_000) / 1_000_000);
  product.markModified('estoques');

  await product.save({ session });

  if (cascadeFractional && !alreadyVisited) {
    const fractionalConfig = product.fracionado || {};
    const fractionalItems = Array.isArray(fractionalConfig.itens) ? fractionalConfig.itens : [];

    for (const item of fractionalItems) {
      const baseQuantity = Number(item?.quantidadeOrigem);
      const fractionQuantity = Number(item?.quantidadeFracionada);
      if (!Number.isFinite(baseQuantity) || baseQuantity <= 0) continue;
      if (!Number.isFinite(fractionQuantity) || fractionQuantity <= 0) continue;

      const childObjectId = resolveProductObjectId(item?.produto);
      if (!childObjectId) continue;

      const ratio = resolveFractionalChildRatio(baseQuantity, fractionQuantity);
      const childDelta = delta * ratio;
      if (!Number.isFinite(childDelta) || childDelta === 0) continue;

      try {
        await adjustProductStockForDeposit({
          productId: childObjectId,
          depositId: depositObjectId,
          quantity: childDelta,
          session,
          cascadeFractional: true,
          visited: visitSet,
        });
      } catch (error) {
        console.error('Erro ao ajustar estoque de produto fracionado vinculado.', {
          parentProductId: product._id.toString(),
          childProductId: String(childObjectId),
          depositId: depositKey,
        }, error);
        throw error;
      }
    }

    try {
      await recalculateFractionalStockForProduct(product._id, { session });
    } catch (error) {
      console.error('Erro ao recalcular estoque fracionado do produto.', {
        productId: product._id.toString(),
      }, error);
    }
  }

  try {
    await refreshParentFractionalStocks(product._id, { session });
  } catch (error) {
    console.error('Erro ao atualizar produtos pais fracionados.', {
      productId: product._id.toString(),
    }, error);
  }

  return { updated: true };
};

module.exports = {
  toObjectIdOrNull,
  resolveProductObjectId,
  adjustProductStockForDeposit,
};

