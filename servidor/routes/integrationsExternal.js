const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const ExternalIntegration = require('../models/ExternalIntegration');
const Store = require('../models/Store');
const { encryptText, decryptText } = require('../utils/certificates');
const { syncIfoodCatalogForStore } = require('../services/ifoodCatalogSync');
const requireAuth = require('../middlewares/requireAuth');
const authorizeRoles = require('../middlewares/authorizeRoles');

const PROVIDER_FIELDS = {
  ifood: ['clientId', 'clientSecret', 'merchantId', 'webhook'],
  ubereats: ['storeId', 'accessToken', 'refreshToken', 'callback'],
  ninetyNineFood: ['storeCode', 'apiKey', 'webhook'],
  mercadopago: ['publicKey', 'accessToken', 'webhook'],
};

const SECRET_SELECT =
  '+webhookSecretEncrypted +providers.ifood.encryptedCredentials +providers.ubereats.encryptedCredentials +providers.ninetyNineFood.encryptedCredentials +providers.mercadopago.encryptedCredentials';

const sanitizeString = (value) => (typeof value === 'string' ? value.trim() : '');
const toBoolean = (value) => value === true || value === 'true' || value === 1 || value === '1';
const toNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
};
function decryptCredentials(encrypted) {
  if (!encrypted) return {};
  try {
    const raw = decryptText(encrypted);
    return JSON.parse(raw);
  } catch (error) {
    return {};
  }
}

function buildProviderResponse(providerDoc = {}, includeCredentials = true) {
  const safeCredentials = includeCredentials && providerDoc.hasCredentials
    ? decryptCredentials(providerDoc.encryptedCredentials)
    : {};

  return {
    enabled: !!providerDoc.enabled,
    autoAccept: !!providerDoc.autoAccept,
    syncMenu: !!providerDoc.syncMenu,
    status: providerDoc.status || 'offline',
    queue: providerDoc.queue || '',
    lastSync: providerDoc.lastSync ? providerDoc.lastSync.toISOString() : null,
    metrics: {
      ordersToday: providerDoc.metrics?.ordersToday || 0,
      avgPrepTime: providerDoc.metrics?.avgPrepTime || 0,
      rejectionRate: providerDoc.metrics?.rejectionRate || 0,
    },
    credentials: safeCredentials,
  };
}

function buildResponse(doc) {
  const secret = doc.webhookSecretStored && doc.webhookSecretEncrypted
    ? decryptText(doc.webhookSecretEncrypted)
    : '';

  return {
    storeId: String(doc.store),
    settings: {
      autoApprove: !!doc.autoApprove,
      menuSync: !!doc.menuSync,
      downtimeGuard: !!doc.downtimeGuard,
      webhookSecret: secret,
    },
    providers: {
      ifood: buildProviderResponse(doc.providers?.ifood, true),
      ubereats: buildProviderResponse(doc.providers?.ubereats, true),
      ninetyNineFood: buildProviderResponse(doc.providers?.ninetyNineFood, true),
      mercadopago: buildProviderResponse(doc.providers?.mercadopago, true),
    },
  };
}

function mergeProvider(doc, providerKey, payload = {}) {
  if (!PROVIDER_FIELDS[providerKey]) return;

  doc.providers = doc.providers || {};
  const target = doc.providers[providerKey] || {};

  if (payload.enabled !== undefined) target.enabled = toBoolean(payload.enabled);
  if (payload.autoAccept !== undefined) target.autoAccept = toBoolean(payload.autoAccept);
  if (payload.syncMenu !== undefined) target.syncMenu = toBoolean(payload.syncMenu);
  if (payload.status !== undefined) target.status = sanitizeString(payload.status) || target.status || 'offline';
  if (payload.queue !== undefined) target.queue = sanitizeString(payload.queue);
  if (payload.lastSync !== undefined) {
    target.lastSync = payload.lastSync ? new Date(payload.lastSync) : null;
  }

  if (payload.metrics && typeof payload.metrics === 'object') {
    target.metrics = target.metrics || {};
    const { ordersToday, avgPrepTime, rejectionRate } = payload.metrics;
    if (ordersToday !== undefined) target.metrics.ordersToday = toNumber(ordersToday) ?? target.metrics.ordersToday ?? 0;
    if (avgPrepTime !== undefined) target.metrics.avgPrepTime = toNumber(avgPrepTime) ?? target.metrics.avgPrepTime ?? 0;
    if (rejectionRate !== undefined) target.metrics.rejectionRate = toNumber(rejectionRate) ?? target.metrics.rejectionRate ?? 0;
  }

  const credentialsSource = payload.credentials || payload;
  const fields = PROVIDER_FIELDS[providerKey];
  const credentials = {};
  let touchedCredentials = false;

  fields.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(credentialsSource, field)) {
      touchedCredentials = true;
    }
    const value = sanitizeString(credentialsSource[field]);
    if (value) credentials[field] = value;
  });

  if (touchedCredentials) {
    if (Object.keys(credentials).length) {
      target.encryptedCredentials = encryptText(JSON.stringify(credentials));
      target.hasCredentials = true;
    } else {
      target.encryptedCredentials = null;
      target.hasCredentials = false;
    }
  }

  doc.providers[providerKey] = target;
  doc.markModified(`providers.${providerKey}`);
}

async function findIntegration(storeId) {
  return ExternalIntegration.findOne({ store: storeId }).select(SECRET_SELECT);
}

router.get('/:storeId', requireAuth, authorizeRoles('admin', 'admin_master'), async (req, res) => {
  try {
    const { storeId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(storeId)) {
      return res.status(400).json({ message: 'Identificador de loja inválido.' });
    }

    const storeExists = await Store.exists({ _id: storeId });
    if (!storeExists) {
      return res.status(404).json({ message: 'Loja não encontrada.' });
    }

    const integration = await findIntegration(storeId);
    const doc = integration || new ExternalIntegration({ store: storeId });
    return res.json(buildResponse(doc));
  } catch (error) {
    console.error('Erro ao buscar integrações externas:', error);
    return res.status(500).json({ message: 'Erro ao buscar integrações externas.' });
  }
});

router.put('/:storeId', requireAuth, authorizeRoles('admin', 'admin_master'), async (req, res) => {
  try {
    const { storeId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(storeId)) {
      return res.status(400).json({ message: 'Identificador de loja inválido.' });
    }

    const storeExists = await Store.exists({ _id: storeId });
    if (!storeExists) {
      return res.status(404).json({ message: 'Loja não encontrada.' });
    }

    const body = req.body || {};
    const settings = typeof body.settings === 'object' ? body.settings : {};
    const providers = typeof body.providers === 'object' ? body.providers : {};

    const integration = await findIntegration(storeId) || new ExternalIntegration({ store: storeId });

    if (settings.autoApprove !== undefined) integration.autoApprove = toBoolean(settings.autoApprove);
    if (settings.menuSync !== undefined) integration.menuSync = toBoolean(settings.menuSync);
    if (settings.downtimeGuard !== undefined) integration.downtimeGuard = toBoolean(settings.downtimeGuard);

    if (settings.webhookSecret !== undefined) {
      const secret = sanitizeString(settings.webhookSecret);
      if (secret) {
        integration.webhookSecretEncrypted = encryptText(secret);
        integration.webhookSecretStored = true;
      } else {
        integration.webhookSecretEncrypted = null;
        integration.webhookSecretStored = false;
      }
    }

    Object.keys(PROVIDER_FIELDS).forEach((providerKey) => {
      if (providers[providerKey]) {
        mergeProvider(integration, providerKey, providers[providerKey]);
      }
    });

    await integration.save();
    const response = buildResponse(integration);
    return res.json(response);
  } catch (error) {
    console.error('Erro ao salvar integrações externas:', error);
    return res.status(500).json({ message: 'Erro ao salvar integrações externas.' });
  }
});

router.post('/:storeId/ifood/sync', requireAuth, authorizeRoles('admin', 'admin_master'), async (req, res) => {
  try {
    const { storeId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(storeId)) {
      return res.status(400).json({ message: 'Identificador de loja invalido.' });
    }

    const integration = await findIntegration(storeId);
    if (!integration) {
      return res.status(404).json({ message: 'Integracao nao configurada para esta empresa.' });
    }

    const resetCatalogInput = req.body?.resetCatalog ?? req.query?.resetCatalog;
    const resetCatalogRequested = resetCatalogInput !== undefined ? toBoolean(resetCatalogInput) : undefined;
    const forcePostInput = req.body?.forcePost ?? req.query?.forcePost;
    const forcePostRequested = forcePostInput !== undefined ? toBoolean(forcePostInput) : false;

    const result = await syncIfoodCatalogForStore({
      storeId,
      integration,
      resetCatalogRequested,
      forcePostRequested,
    });
    const { itemsToSend, totalToSend, sendResult, now } = result;

    const response = buildResponse(integration);
    return res.json({
      ...response,
      message: sendResult?.message || ('Sincronizacao enviada para o iFood (' + totalToSend + ' produtos).'),
      synced: (sendResult?.created ?? 0) + (sendResult?.updated ?? 0),
      lastSync: now.toISOString(),
      preview: itemsToSend.slice(0, 20),
    });
  } catch (error) {
    console.error('Erro ao sincronizar iFood:', error);
    const message = error?.message;
    const userErrors = new Set([
      'Ative o iFood antes de sincronizar.',
      'Credenciais do iFood nao encontradas.',
      'Preencha Client ID, Client Secret e Merchant ID para sincronizar.',
      'Integracao nao configurada para esta empresa.',
      'Identificador de loja invalido.',
    ]);
    if (message && userErrors.has(message)) {
      return res.status(400).json({ message });
    }
    return res.status(500).json({ message: 'Erro ao sincronizar com o iFood.' });
  }
});

module.exports = router;
