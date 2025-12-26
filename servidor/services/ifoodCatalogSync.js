const Category = require('../models/Category');
const Deposit = require('../models/Deposit');
const Product = require('../models/Product');
const { decryptText } = require('../utils/certificates');
const ifoodClient = require('./ifoodClient');

const normalizeBarcode = (value) => {
  const normalized = (value ?? '').toString().trim();
  if (!normalized) return '';
  return normalized.replace(/\s+/g, '');
};

const normalizeName = (value) => (value ?? '').toString().trim();

const decryptCredentials = (encrypted) => {
  if (!encrypted) return {};
  try {
    const raw = decryptText(encrypted);
    return JSON.parse(raw);
  } catch (error) {
    return {};
  }
};

async function loadCategoryMap(categoryIds = []) {
  const map = new Map();
  const pending = new Set(
    categoryIds
      .map((id) => (id && id.toString ? id.toString() : id))
      .filter(Boolean),
  );

  while (pending.size) {
    const ids = Array.from(pending);
    pending.clear();
    const docs = await Category.find({ _id: { $in: ids } }).select('_id nome parent').lean();
    docs.forEach((doc) => {
      const id = doc._id.toString();
      if (!map.has(id)) {
        const parentId = doc.parent ? doc.parent.toString() : null;
        map.set(id, { name: doc.nome, parentId });
        if (parentId && !map.has(parentId)) {
          pending.add(parentId);
        }
      }
    });
  }

  return map;
}

function buildCategoryPath(categoryId, map) {
  const path = [];
  let current = categoryId && categoryId.toString ? categoryId.toString() : categoryId;
  const visited = new Set();

  while (current) {
    if (visited.has(current)) break;
    visited.add(current);
    const node = map.get(current);
    if (!node) break;
    path.unshift(node.name);
    current = node.parentId;
  }

  return path;
}

function resolveCategorization(path = []) {
  const normalized = path.map((entry) => (entry ?? '').toString().trim()).filter(Boolean);
  if (!normalized.length) return null;

  if (normalized.length >= 3) {
    const tail = normalized.slice(-3);
    return { department: tail[0], category: tail[1], subCategory: tail[2] };
  }
  if (normalized.length === 2) {
    return { department: normalized[0], category: normalized[1] };
  }
  return { department: normalized[0] };
}

function computeStockForStore(product = {}, depositIds = new Set()) {
  if (!Array.isArray(product.estoques) || !product.estoques.length || !depositIds.size) {
    return 0;
  }
  return product.estoques.reduce((sum, entry) => {
    const depositId = entry?.deposito;
    const normalized = depositId && typeof depositId.toString === 'function' ? depositId.toString() : depositId;
    if (normalized && depositIds.has(String(normalized))) {
      const qty = Number(entry?.quantidade);
      return sum + (Number.isFinite(qty) ? qty : 0);
    }
    return sum;
  }, 0);
}

async function buildIfoodPayload({ storeId }) {
  const publicBase = (process.env.R2_PUBLIC_BASE_URL || '').replace(/\/+$/, '');
  const resolveImageUrl = (product = {}) => {
    const candidates = [];
    if (product.imagemPrincipal) candidates.push(product.imagemPrincipal);
    if (Array.isArray(product.imagens)) candidates.push(...product.imagens);

    for (const img of candidates) {
      if (!img) continue;
      const url = img.toString().trim();
      if (!url) continue;
      if (/^https?:\/\//i.test(url)) return url;
      if (publicBase) return `${publicBase}/${url.replace(/^\/+/, '')}`;
    }
    return null;
  };

  const deposits = await Deposit.find({ empresa: storeId }).select('_id nome').lean();
  const depositIds = new Set(deposits.map((d) => d._id.toString()));

  const products = await Product.find({
    enviarParaIfood: true,
  }).lean();

  const categoryIds = new Set();
  products.forEach((product) => {
    if (Array.isArray(product.categorias)) {
      product.categorias.forEach((catId) => {
        if (!catId) return;
        const normalized = catId && catId.toString ? catId.toString() : catId;
        if (normalized) categoryIds.add(normalized);
      });
    }
  });
  const categoryMap = await loadCategoryMap(Array.from(categoryIds));

  const items = products.map((product) => {
    const barcode = normalizeBarcode(product.codbarras);
    const name = normalizeName(product.nome);
    const price = Number(product.venda);
    const categories = Array.isArray(product.categorias)
      ? product.categorias.map((c) => (c?.toString ? c.toString() : c))
      : [];
    const primaryCategoryId = categories[0] || null;
    const categoryPath = primaryCategoryId ? buildCategoryPath(primaryCategoryId, categoryMap) : [];
    const categorization = resolveCategorization(categoryPath);
    const volume = Number(product.peso);
    const volumeValue = Number.isFinite(volume) ? String(volume) : '';
    const active = !product.inativo;

    return {
      id: product._id?.toString(),
      integratedAt: product.ifoodIntegratedAt || null,
      lastSyncAt: product.ifoodLastSyncAt || null,
      ifoodActive: typeof product.ifoodActive === 'boolean' ? product.ifoodActive : null,
      sku: product.cod,
      barcode,
      name,
      active,
      description: product.descricao || '',
      brand: product.marca || '',
      price: Number.isFinite(price) ? price : null,
      unit: product.unidade || '',
      volume: volumeValue,
      stock: computeStockForStore(product, depositIds),
      categories,
      categorization,
      imageUrl: resolveImageUrl(product),
    };
  });

  return {
    items,
    deposits,
    totals: {
      products: products.length,
      withStock: items.filter((p) => p.stock > 0).length,
    },
  };
}

async function syncIfoodCatalogForStore({ storeId, integration, resetCatalogRequested } = {}) {
  if (!storeId) {
    throw new Error('Identificador de loja invalido.');
  }
  if (!integration) {
    throw new Error('Integracao nao configurada para esta empresa.');
  }

  const provider = integration.providers?.ifood || {};
  if (!provider.enabled) {
    throw new Error('Ative o iFood antes de sincronizar.');
  }
  if (!provider.hasCredentials || !provider.encryptedCredentials) {
    throw new Error('Credenciais do iFood nao encontradas.');
  }

  const credentials = decryptCredentials(provider.encryptedCredentials);
  const { clientId, clientSecret, merchantId } = credentials;
  if (!clientId || !clientSecret || !merchantId) {
    throw new Error('Preencha Client ID, Client Secret e Merchant ID para sincronizar.');
  }

  const payload = await buildIfoodPayload({ storeId });

  const validItems = [];
  const skippedItems = [];
  (payload.items || []).forEach((item) => {
    const barcode = normalizeBarcode(item.barcode);
    const name = normalizeName(item.name);
    const stock = Number(item.stock);
    const price = Number(item.price);
    const active = item.active === false ? false : true;
    if (!barcode) {
      const skipped = { productId: item.id, barcode, name, reason: 'barcode vazio' };
      skippedItems.push(skipped);
      console.info('[ifood:payload][skip]', skipped);
      return;
    }
    if (!name) {
      const skipped = { productId: item.id, barcode, name, reason: 'nome vazio' };
      skippedItems.push(skipped);
      console.info('[ifood:payload][skip]', skipped);
      return;
    }
    if (!Number.isFinite(stock)) {
      const skipped = { productId: item.id, barcode, name, reason: 'stock invalido' };
      skippedItems.push(skipped);
      console.info('[ifood:payload][skip]', skipped);
      return;
    }
    if (!Number.isFinite(price)) {
      const skipped = { productId: item.id, barcode, name, reason: 'price invalido' };
      skippedItems.push(skipped);
      console.info('[ifood:payload][skip]', skipped);
      return;
    }
    validItems.push({ ...item, barcode, name, stock, price, active });
  });

  const postItems = [];
  const patchItems = [];
  validItems.forEach((item) => {
    if (!item.integratedAt && item.active === false) {
      const skipped = {
        productId: item.id,
        barcode: item.barcode,
        name: item.name,
        reason: 'inactive without prior integration',
      };
      skippedItems.push(skipped);
      console.info('[ifood:payload][skip]', skipped);
      return;
    }
    if (!item.integratedAt) {
      postItems.push(item);
      return;
    }
    if (item.active === false) {
      postItems.push(item);
      return;
    }
    if (item.ifoodActive !== true) {
      postItems.push(item);
      return;
    }
    patchItems.push(item);
  });

  if (skippedItems.length) {
    console.info('[ifood:payload][skipped:summary]', { total: skippedItems.length });
  }

  const itemsToSend = [...postItems, ...patchItems];
  const totalToSend = itemsToSend.length;
  const autoResetCatalog = (payload.items || []).length === 0;
  const resetCatalog = autoResetCatalog
    ? true
    : resetCatalogRequested === true
      ? true
      : resetCatalogRequested === false
        ? false
        : undefined;

  const sendResult = await ifoodClient.pushCatalog(credentials, {
    newItems: postItems,
    updateItems: patchItems,
    resetCatalog,
  });

  console.info('[ifood:sync] catalogo enviado', {
    storeId,
    products: totalToSend,
    merchantId,
    created: sendResult?.created,
    updated: sendResult?.updated,
  });

  const now = new Date();
  provider.lastSync = now;
  provider.status = 'ok';
  provider.queue = 'Catalogo enviado (' + totalToSend + ' itens)';
  integration.markModified('providers.ifood');
  await integration.save();

  const sentItemUpdates = itemsToSend
    .filter((item) => item.id)
    .map((item) => ({
      updateOne: {
        filter: { _id: item.id },
        update: {
          $set: {
            ifoodIntegratedAt: now,
            ifoodLastSyncAt: now,
            ifoodActive: item.active,
          },
        },
      },
    }));
  if (sentItemUpdates.length) {
    await Product.bulkWrite(sentItemUpdates);
  }

  return { payload, itemsToSend, totalToSend, sendResult, now, skippedItems };
}

module.exports = {
  buildIfoodPayload,
  normalizeBarcode,
  normalizeName,
  syncIfoodCatalogForStore,
};
