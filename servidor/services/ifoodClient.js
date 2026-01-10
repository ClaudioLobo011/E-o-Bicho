const axios = require('axios');

// Cliente para operações de catálogo (item) no iFood.
// Variáveis de ambiente aceitas:
// - IFOOD_API_BASE (ex.: https://merchant-api.ifood.com.br)
// - IFOOD_OAUTH_PATH (ex.: /authentication/v1.0/oauth/token)
// - IFOOD_ITEMS_PATH (ex.: /item/v1.0/ingestion/{merchantId})
// - IFOOD_RESET_CATALOG (ex.: true|false)

const API_BASE = process.env.IFOOD_API_BASE || 'https://merchant-api.ifood.com.br';
const OAUTH_PATH = process.env.IFOOD_OAUTH_PATH || '/authentication/v1.0/oauth/token';
const ITEMS_PATH_TEMPLATE = process.env.IFOOD_ITEMS_PATH || '/item/v1.0/ingestion/{merchantId}';
const DEFAULT_RESET_CATALOG = process.env.IFOOD_RESET_CATALOG || 'false';

async function getAccessToken({ clientId, clientSecret }) {
  if (!clientId || !clientSecret) {
    throw new Error('Credenciais do iFood ausentes.');
  }

  const url = `${API_BASE}${OAUTH_PATH}`;
  const params = new URLSearchParams();
  params.append('grant_type', 'client_credentials');
  params.append('grantType', 'client_credentials');
  params.append('client_id', clientId);
  params.append('client_secret', clientSecret);
  params.append('clientId', clientId);
  params.append('clientSecret', clientSecret);

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  try {
    const resp = await axios.post(url, params, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${basic}`,
      },
      timeout: 10000,
    });

    const token = resp.data?.access_token || resp.data?.accessToken;
    if (!token) {
      throw new Error(`Token do iFood não retornado: ${JSON.stringify(resp.data)}`);
    }
    return token;
  } catch (error) {
    const detail = error?.response?.data || error?.message || 'Erro desconhecido no OAuth do iFood';
    throw new Error(`Falha no OAuth iFood (${url}): ${JSON.stringify(detail)}`);
  }
}

function normalizeUnit(unit) {
  const raw = (unit || '').toString().trim().toUpperCase();
  if (!raw) return 'UN';
  if (raw === 'SC') return 'UN';
  return raw;
}

const isTruthy = (value) => value === true || value === 'true' || value === 1 || value === '1';

const hasContent = (value) => {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim() !== '';
  return true;
};

const assignIf = (target, key, value) => {
  if (hasContent(value)) {
    target[key] = value;
  }
};

const buildCategorization = (input) => {
  if (!input || typeof input !== 'object') return null;
  const result = {};
  assignIf(result, 'department', input.department);
  assignIf(result, 'category', input.category);
  assignIf(result, 'subCategory', input.subCategory);
  return Object.keys(result).length ? result : null;
};

const buildMultiple = (item = {}) => {
  const source = item.multiple && typeof item.multiple === 'object' ? item.multiple : {};
  const result = {};
  assignIf(result, 'originalEan', source.originalEan ?? item.originalEan);
  const quantity = Number(source.quantity ?? item.quantity);
  if (Number.isFinite(quantity)) {
    result.quantity = quantity;
  }
  return Object.keys(result).length ? result : null;
};

function buildFullItemPayload(item = {}) {
  const payload = {
    barcode: item.barcode,
    name: item.name,
  };

  assignIf(payload, 'plu', item.sku ?? item.plu);

  const active = typeof item.active === 'boolean' ? item.active : true;
  payload.active = active;

  const details = {};
  const categorization = buildCategorization(item.categorization || item.details?.categorization);
  if (categorization) {
    details.categorization = categorization;
  }
  assignIf(details, 'brand', item.brand);
  assignIf(details, 'volume', item.volume);
  const unit = item.unit ? normalizeUnit(item.unit) : null;
  if (hasContent(unit)) {
    details.unit = unit;
  }
  assignIf(details, 'imageUrl', item.imageUrl);
  assignIf(details, 'description', item.description);
  if (typeof item.nearExpiration === 'boolean') {
    details.nearExpiration = item.nearExpiration;
  }
  if (Object.keys(details).length) {
    payload.details = details;
  }

  const price = Number(item.price);
  if (Number.isFinite(price)) {
    payload.prices = { price };
  }

  const stock = Number(item.stock);
  if (Number.isFinite(stock)) {
    payload.inventory = { stock };
  }

  const multiple = buildMultiple(item);
  if (multiple) {
    payload.multiple = multiple;
  }

  assignIf(payload, 'channels', item.channels);

  return payload;
}

function buildPatchItemPayload(item = {}) {
  const payload = buildFullItemPayload(item);
  delete payload.active;
  return payload;
}

const normalizeInventoryStock = (item = {}) => {
  const normalized = { ...item };
  if (normalized.stock !== undefined) {
    const inv = normalized.inventory || {};
    if (inv.stock === undefined) {
      normalized.inventory = { ...inv, stock: normalized.stock };
    }
    delete normalized.stock;
  }
  return normalized;
};

async function sendBatches({ url, method, token, items, mapFn }) {
  const batchSize = 30;
  let sent = 0;

  const collectIngestionErrors = (data) => {
    const errors = [];
    if (!data) return errors;

    if (Array.isArray(data)) {
      data.forEach((entry) => {
        if (Array.isArray(entry?.errors) && entry.errors.length) {
          errors.push(
            ...entry.errors.map((err) => ({
              ...err,
              itemId: entry?.id,
              barcode: entry?.barcode,
            })),
          );
        } else if (entry?.error) {
          errors.push({
            ...entry.error,
            itemId: entry?.id,
            barcode: entry?.barcode,
          });
        }
      });
    } else if (Array.isArray(data?.errors)) {
      errors.push(...data.errors);
    }

    return errors;
  };

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items
      .slice(i, i + batchSize)
      .map(mapFn)
      .map(normalizeInventoryStock);
    try {
      const resp = await axios({
        method,
        url,
        data: batch,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      });
      const errors = collectIngestionErrors(resp?.data);
      if (errors.length) {
        console.error(`[ifood:catalog][${method.toUpperCase()}][errors]`, {
          url,
          errors,
        });
        throw new Error(`Falha no envio iFood (${method}) - itens com erro`);
      }
      sent += batch.length;
    } catch (err) {
      console.error('ifood:catalog:error', {
        status: err.response?.status || null,
        data: err.response?.data || null,
        errors: err.response?.data?.errors || null,
      });
      throw err;
    }
  }

  return sent;
}

async function sendResetCatalog({ url, token }) {
  await axios({
    method: 'post',
    url,
    data: [],
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    timeout: 15000,
  });
}

async function pushCatalog(credentials, payload) {
  const { clientId, clientSecret, merchantId } = credentials || {};
  if (!clientId || !clientSecret || !merchantId) {
    throw new Error('Credenciais/merchantId do iFood ausentes.');
  }

  const token = await getAccessToken({ clientId, clientSecret });
  const postItems = Array.isArray(payload?.newItems) ? payload.newItems : [];
  const patchItems = Array.isArray(payload?.updateItems) ? payload.updateItems : [];
  const resetCatalog = isTruthy(payload?.resetCatalog ?? DEFAULT_RESET_CATALOG);

  const allItems = [...postItems, ...patchItems];

  if (!allItems.length && !resetCatalog) {
    return { created: 0, updated: 0, message: 'Nenhum item marcado para envio.' };
  }

  const path = ITEMS_PATH_TEMPLATE.replace('{merchantId}', merchantId);
  const baseUrl = `${API_BASE}${path}`;
  const postUrl = resetCatalog ? `${baseUrl}?reset=true` : baseUrl;

  let created = 0;
  let updated = 0;

  if (resetCatalog) {
    if (!allItems.length) {
      await sendResetCatalog({ url: postUrl, token });
      const message = 'Catalogo resetado no iFood (reset=true, sem itens).';
      return { created, updated, message };
    }
    created = await sendBatches({
      url: postUrl,
      method: 'post',
      token,
      items: allItems,
      mapFn: buildFullItemPayload,
    });
    const message = `Itens enviados ao iFood via POST (reset=true): ${created}`;
    return { created, updated, message };
  }

  if (postItems.length) {
    created = await sendBatches({
      url: postUrl,
      method: 'post',
      token,
      items: postItems,
      mapFn: buildFullItemPayload,
    });
  }

  if (patchItems.length) {
    updated = await sendBatches({
      url: baseUrl,
      method: 'patch',
      token,
      items: patchItems,
      mapFn: buildPatchItemPayload,
    });
  }

  const message = `Itens enviados ao iFood via POST: ${created}, PATCH: ${updated}`;
  return { created, updated, message };
}

module.exports = {
  pushCatalog,
  getAccessToken,
};
