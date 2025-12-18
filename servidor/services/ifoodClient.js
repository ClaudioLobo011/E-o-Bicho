const axios = require('axios');

// Cliente simples para a API do iFood (catalogo/petshop)
// Depende de variaveis de ambiente para flexibilidade de sandbox/prod:
// IFOOD_API_BASE: ex. https://merchant-api.ifood.com.br
// IFOOD_OAUTH_PATH: ex. /oauth/token
// IFOOD_ITEMS_PATH: ex. /v1.0/merchants/{merchantId}/items

const API_BASE = process.env.IFOOD_API_BASE || 'https://merchant-api.ifood.com.br';
const OAUTH_PATH = process.env.IFOOD_OAUTH_PATH || '/oauth/token';
// Endpoint de ingestão de itens (homologação indica /item/v1.0/ingestion/{merchantId}?reset=false)
const ITEMS_PATH_TEMPLATE = process.env.IFOOD_ITEMS_PATH || '/item/v1.0/ingestion/{merchantId}';
const ITEMS_RESET_PARAM = process.env.IFOOD_ITEMS_RESET || 'false'; // reset=true/false

async function getAccessToken({ clientId, clientSecret }) {
  if (!clientId || !clientSecret) {
    throw new Error('Credenciais do iFood ausentes.');
  }

  const url = `${API_BASE}${OAUTH_PATH}`;
  const params = new URLSearchParams();
  // Alguns docs do iFood usam camelCase (grantType), então enviamos ambos.
  params.append('grant_type', 'client_credentials');
  params.append('grantType', 'client_credentials');
  // Envia nas duas convenções: snake_case e camelCase
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

function buildItemPayload(item) {
  const normalizedUnit = (() => {
    const raw = (item.unit || '').toString().trim().toUpperCase();
    if (!raw) return 'UN';
    if (raw === 'SC') return 'UN'; // normaliza saco/embalagem para unidade
    return raw;
  })();

  return {
    barcode: item.barcode,
    name: item.name,
    plu: item.sku,
    active: true,
    inventory: { stock: Number(item.stock) || 0 },
    details: {
      categorization: { department: null, category: null, subCategory: null },
      brand: null,
      unit: normalizedUnit,
      volume: null,
      imageUrl: null,
      description: item.description || '',
      nearExpiration: true,
      family: null,
    },
    prices: { price: Number(item.price) || 0, promotionPrice: null },
    scalePrices: null,
    multiple: null,
    channels: null,
  };
}

async function pushCatalog(credentials, payload) {
  const { clientId, clientSecret, merchantId } = credentials || {};
  if (!clientId || !clientSecret || !merchantId) {
    throw new Error('Credenciais/merchantId do iFood ausentes.');
  }

  const token = await getAccessToken({ clientId, clientSecret });
  const items = Array.isArray(payload?.items) ? payload.items : [];
  if (!items.length) {
    return { synced: 0, message: 'Nenhum item marcado para envio.' };
  }

  const path = ITEMS_PATH_TEMPLATE.replace('{merchantId}', merchantId);
  // Exemplo direto: https://merchant-api.ifood.com.br/item/v1.0/ingestion/{merchantId}?reset=false
  const url = `${API_BASE}${path}?reset=${encodeURIComponent(ITEMS_RESET_PARAM)}`;

  // Envia em lotes pequenos para evitar timeouts (ajuste conforme doc/limites)
  const batchSize = 30;
  let sent = 0;

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize).map(buildItemPayload);
    try {
      await axios.post(url, batch, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      });
    } catch (err) {
      console.log('STATUS:', err.response?.status);
      console.log('DATA:', JSON.stringify(err.response?.data, null, 2));
      console.log('ERRORS:', JSON.stringify(err.response?.data?.errors, null, 2));
      throw err;
    }
    sent += batch.length;
  }

  return { synced: sent, message: `Itens enviados ao iFood: ${sent}` };
}

module.exports = {
  pushCatalog,
  getAccessToken,
};
