const crypto = require('crypto');
const express = require('express');

const WhatsappIntegration = require('../models/WhatsappIntegration');
const WhatsappOnboardingSession = require('../models/WhatsappOnboardingSession');
const { requireWhatsappAdminAccess } = require('../middlewares/whatsappAccess');
const { encryptText, decryptText } = require('../utils/certificates');
const {
  DEFAULT_GRAPH_VERSION,
  REQUIRED_WEBHOOK_FIELDS,
  WhatsappGraphError,
  createGraphClient,
  normalizeGraphVersion,
} = require('../services/whatsappCoexistenceService');

const router = express.Router({ mergeParams: true });
const SESSION_TTL_MS = 15 * 60 * 1000;
const COEXISTENCE_EVENT = 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING';

const clean = (value) => (typeof value === 'string' ? value.trim() : '');
const hashSessionToken = (value) =>
  crypto.createHash('sha256').update(String(value || '')).digest('hex');

const decryptField = (encrypted, stored) => {
  if (!stored || !encrypted) return '';
  try {
    return decryptText(encrypted);
  } catch (_) {
    return '';
  }
};

const resolveConfig = (integration = {}) => {
  const appId = clean(integration.appId) || clean(process.env.WHATSAPP_META_APP_ID);
  const configId = clean(integration.embeddedSignupConfigId)
    || clean(process.env.WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID);
  const appSecret = decryptField(
    integration.appSecretEncrypted,
    integration.appSecretStored
  ) || clean(process.env.WHATSAPP_META_APP_SECRET);
  const verifyToken = decryptField(
    integration.verifyTokenEncrypted,
    integration.verifyTokenStored
  ) || clean(process.env.WHATSAPP_META_VERIFY_TOKEN);
  const graphApiVersion = normalizeGraphVersion(
    integration.graphApiVersion || process.env.WHATSAPP_GRAPH_API_VERSION
  );

  return {
    appId,
    configId,
    appSecret,
    verifyToken,
    graphApiVersion,
    ready: Boolean(appId && configId && appSecret && verifyToken),
  };
};

const selectIntegrationSecrets = () =>
  '+appSecretEncrypted +accessTokenEncrypted +verifyTokenEncrypted';

const safeError = (error) => ({
  code: clean(error?.code) || 'WHATSAPP_ONBOARDING_ERROR',
  message: clean(error?.message) || 'Falha ao concluir a conexão com a Meta.',
  graphCode: error?.graphCode ?? null,
  graphSubcode: error?.graphSubcode ?? null,
  fbtraceId: clean(error?.fbtraceId),
  at: new Date(),
});

const mapPhoneNumber = (number) => ({
  id: number?._id ? String(number._id) : undefined,
  phoneNumberId: number?.phoneNumberId || '',
  phoneNumber: number?.phoneNumber || '',
  displayName: number?.displayName || '',
  status: number?.status || 'Pendente',
  provider: number?.provider || 'Meta Cloud API',
  connectionMode: number?.connectionMode || '',
  isOnBizApp: Boolean(number?.isOnBizApp),
  platformType: number?.platformType || '',
  qualityRating: number?.qualityRating || '',
  contactsSyncStatus: number?.contactsSyncStatus || '',
  historySyncStatus: number?.historySyncStatus || '',
  historySyncProgress: Number(number?.historySyncProgress) || 0,
  lastSyncAt: number?.lastSyncAt || null,
});

const buildSetupResponse = (integration) => {
  const safeIntegration = integration || {};
  const config = resolveConfig(safeIntegration);
  return {
    ready: config.ready,
    appId: config.appId,
    configId: config.configId,
    graphApiVersion: config.graphApiVersion,
    featureType: 'whatsapp_business_app_onboarding',
    sessionInfoVersion: '3',
    connectionMode: safeIntegration.connectionMode || 'coexistence',
    onboardingStatus: safeIntegration.onboardingStatus || 'not_configured',
    onboardingEvent: safeIntegration.onboardingEvent || '',
    wabaId: safeIntegration.wabaId || '',
    businessId: safeIntegration.businessId || '',
    onboardedAt: safeIntegration.onboardedAt || null,
    webhookSubscribedAt: safeIntegration.webhookSubscribedAt || null,
    syncDeadlineAt: safeIntegration.syncDeadlineAt || null,
    lastHealthCheckAt: safeIntegration.lastHealthCheckAt || null,
    lastError: safeIntegration.lastError || null,
    credentials: {
      appSecretStored: Boolean(safeIntegration.appSecretStored),
      accessTokenStored: Boolean(safeIntegration.accessTokenStored),
      verifyTokenStored: Boolean(safeIntegration.verifyTokenStored),
      appSecretAvailable: Boolean(config.appSecret),
      verifyTokenAvailable: Boolean(config.verifyToken),
    },
    requiredWebhookFields: REQUIRED_WEBHOOK_FIELDS,
    phoneNumbers: Array.isArray(safeIntegration.phoneNumbers)
      ? safeIntegration.phoneNumbers.map(mapPhoneNumber)
      : [],
  };
};

const upsertPhoneNumber = (integration, phoneStatus, sync = {}) => {
  const phoneNumberId = clean(phoneStatus.phoneNumberId);
  const current = integration.phoneNumbers.find(
    (number) => clean(number.phoneNumberId) === phoneNumberId
  );
  const target = current || integration.phoneNumbers.create({ phoneNumberId });
  target.phoneNumber = clean(phoneStatus.phoneNumber) || target.phoneNumber;
  target.displayName = clean(phoneStatus.displayName) || target.displayName;
  target.status = 'Conectado';
  target.provider = 'Meta Cloud API + WhatsApp Business';
  target.connectionMode = 'coexistence';
  target.isOnBizApp = phoneStatus.isOnBizApp === true;
  target.platformType = clean(phoneStatus.platformType);
  target.qualityRating = clean(phoneStatus.qualityRating);
  target.contactsSyncRequestId = clean(sync.contactsRequestId);
  target.contactsSyncStatus = sync.contactsRequestId ? 'requested' : '';
  target.historySyncRequestId = clean(sync.historyRequestId);
  target.historySyncStatus = sync.historyRequestId ? 'requested' : '';
  target.syncStartedAt = sync.startedAt || null;
  target.lastSyncAt = new Date();
  if (!current) integration.phoneNumbers.push(target);
  return target;
};

router.use(requireWhatsappAdminAccess);

router.get('/setup', async (req, res) => {
  try {
    const integration = await WhatsappIntegration.findOne({
      store: req.whatsappContext.storeId,
    }).select(selectIntegrationSecrets());
    return res.json(buildSetupResponse(integration));
  } catch (error) {
    console.error('Erro ao carregar configuração de coexistência:', error);
    return res.status(500).json({ message: 'Erro ao carregar configuração de coexistência.' });
  }
});

router.put('/setup', async (req, res) => {
  try {
    const payload = req.body || {};
    const storeId = req.whatsappContext.storeId;
    const integration = await WhatsappIntegration.findOne({ store: storeId })
      .select(selectIntegrationSecrets())
      || new WhatsappIntegration({ store: storeId });

    if (Object.prototype.hasOwnProperty.call(payload, 'appId')) {
      integration.appId = clean(payload.appId);
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'configId')) {
      integration.embeddedSignupConfigId = clean(payload.configId);
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'graphApiVersion')) {
      integration.graphApiVersion = normalizeGraphVersion(payload.graphApiVersion);
    } else if (!integration.graphApiVersion) {
      integration.graphApiVersion = DEFAULT_GRAPH_VERSION;
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'appSecret')) {
      const appSecret = clean(payload.appSecret);
      if (appSecret) {
        integration.appSecretEncrypted = encryptText(appSecret);
        integration.appSecretStored = true;
      }
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'verifyToken')) {
      const verifyToken = clean(payload.verifyToken);
      if (verifyToken) {
        integration.verifyTokenEncrypted = encryptText(verifyToken);
        integration.verifyTokenStored = true;
      }
    }

    integration.connectionMode = 'coexistence';
    const config = resolveConfig(integration);
    if (!['connected', 'syncing'].includes(integration.onboardingStatus)) {
      integration.onboardingStatus = config.ready ? 'ready' : 'not_configured';
    }
    await integration.save();
    return res.json(buildSetupResponse(integration));
  } catch (error) {
    console.error('Erro ao salvar configuração de coexistência:', error);
    return res.status(500).json({ message: 'Erro ao salvar configuração de coexistência.' });
  }
});

router.post('/session', async (req, res) => {
  try {
    const storeId = req.whatsappContext.storeId;
    const integration = await WhatsappIntegration.findOne({ store: storeId })
      .select(selectIntegrationSecrets());
    const config = resolveConfig(integration || {});
    if (!config.ready) {
      return res.status(409).json({
        message: 'Informe App ID, Configuration ID, App Secret e Verify Token antes de conectar.',
        code: 'WHATSAPP_COEXISTENCE_SETUP_INCOMPLETE',
      });
    }

    const sessionToken = crypto.randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await WhatsappOnboardingSession.create({
      store: storeId,
      user: req.user.id,
      tokenHash: hashSessionToken(sessionToken),
      expiresAt,
    });
    await WhatsappIntegration.updateOne(
      { _id: integration._id },
      {
        $set: {
          connectionMode: 'coexistence',
          onboardingStatus: 'in_progress',
          onboardingEvent: '',
          lastError: null,
        },
      }
    );

    return res.status(201).json({
      sessionId: sessionToken,
      expiresAt,
      appId: config.appId,
      configId: config.configId,
      graphApiVersion: config.graphApiVersion,
      featureType: 'whatsapp_business_app_onboarding',
      sessionInfoVersion: '3',
    });
  } catch (error) {
    console.error('Erro ao iniciar Embedded Signup:', error);
    return res.status(500).json({ message: 'Erro ao iniciar o Embedded Signup.' });
  }
});

router.post('/complete', async (req, res) => {
  const storeId = req.whatsappContext.storeId;
  const payload = req.body || {};
  const sessionId = clean(payload.sessionId);
  const code = clean(payload.code);
  const event = clean(payload.event);
  const sessionInfo = payload.sessionInfo && typeof payload.sessionInfo === 'object'
    ? payload.sessionInfo
    : {};
  const wabaId = clean(sessionInfo.waba_id || sessionInfo.wabaId);
  const phoneNumberId = clean(sessionInfo.phone_number_id || sessionInfo.phoneNumberId);
  const businessId = clean(sessionInfo.business_id || sessionInfo.businessId);

  if (!sessionId || !code || event !== COEXISTENCE_EVENT || !wabaId || !phoneNumberId) {
    return res.status(400).json({
      message: 'Retorno de coexistência incompleto ou inválido.',
      code: 'WHATSAPP_COEXISTENCE_CALLBACK_INVALID',
    });
  }

  let session = null;
  try {
    session = await WhatsappOnboardingSession.findOneAndUpdate(
      {
        store: storeId,
        user: req.user.id,
        tokenHash: hashSessionToken(sessionId),
        status: 'pending',
        expiresAt: { $gt: new Date() },
      },
      {
        $set: {
          status: 'processing',
          event,
          wabaId,
          phoneNumberId,
          businessId,
        },
      },
      { new: true }
    );
    if (!session) {
      return res.status(409).json({
        message: 'Sessão de conexão expirada, já utilizada ou pertencente a outro ambiente.',
        code: 'WHATSAPP_COEXISTENCE_SESSION_INVALID',
      });
    }

    const integration = await WhatsappIntegration.findOne({ store: storeId })
      .select(selectIntegrationSecrets());
    const config = resolveConfig(integration || {});
    if (!integration || !config.ready) {
      throw Object.assign(new Error('A configuração da Meta não está completa.'), {
        code: 'WHATSAPP_COEXISTENCE_SETUP_INCOMPLETE',
      });
    }
    const assetOwner = await WhatsappIntegration.findOne({
      store: { $ne: storeId },
      $or: [
        { wabaId },
        { 'phoneNumbers.phoneNumberId': phoneNumberId },
      ],
    }).select('_id store wabaId');
    if (assetOwner) {
      throw Object.assign(
        new Error('Este WABA ou número já está vinculado ao ambiente de outra loja.'),
        { code: 'WHATSAPP_COEXISTENCE_ASSET_ALREADY_LINKED' }
      );
    }

    const graph = createGraphClient();
    const token = await graph.exchangeCode({
      code,
      appId: config.appId,
      appSecret: config.appSecret,
      graphVersion: config.graphApiVersion,
    });
    await graph.subscribeWaba({
      wabaId,
      accessToken: token.accessToken,
      graphVersion: config.graphApiVersion,
    });
    const phoneStatus = await graph.getPhoneStatus({
      phoneNumberId,
      accessToken: token.accessToken,
      graphVersion: config.graphApiVersion,
    });
    if (!phoneStatus.isOnBizApp || phoneStatus.platformType !== 'CLOUD_API') {
      throw Object.assign(
        new Error('A Meta não confirmou que o número está em modo de coexistência.'),
        { code: 'WHATSAPP_COEXISTENCE_NOT_CONFIRMED' }
      );
    }

    const startedAt = new Date();
    const contactsSync = await graph.startAppDataSync({
      phoneNumberId,
      accessToken: token.accessToken,
      graphVersion: config.graphApiVersion,
      syncType: 'smb_app_state_sync',
    });
    const historySync = await graph.startAppDataSync({
      phoneNumberId,
      accessToken: token.accessToken,
      graphVersion: config.graphApiVersion,
      syncType: 'history',
    });

    integration.wabaId = wabaId;
    integration.businessId = businessId;
    integration.graphApiVersion = config.graphApiVersion;
    integration.connectionMode = 'coexistence';
    integration.onboardingStatus = 'syncing';
    integration.onboardingEvent = event;
    integration.accessTokenEncrypted = encryptText(token.accessToken);
    integration.accessTokenStored = true;
    integration.webhookSubscribedAt = startedAt;
    integration.onboardedAt = startedAt;
    integration.syncDeadlineAt = new Date(startedAt.getTime() + 24 * 60 * 60 * 1000);
    integration.lastHealthCheckAt = startedAt;
    integration.lastError = null;
    upsertPhoneNumber(integration, phoneStatus, {
      contactsRequestId: contactsSync.requestId,
      historyRequestId: historySync.requestId,
      startedAt,
    });
    await integration.save();

    session.status = 'completed';
    session.completedAt = new Date();
    await session.save();

    return res.json({
      connected: true,
      registrationSkipped: true,
      message: 'Número conectado em coexistência. A sincronização inicial foi iniciada.',
      setup: buildSetupResponse(integration),
    });
  } catch (error) {
    const lastError = safeError(error);
    if (session) {
      session.status = 'failed';
      session.failureCode = lastError.code;
      await session.save().catch(() => {});
    }
    await WhatsappIntegration.updateOne(
      { store: storeId },
      { $set: { onboardingStatus: 'error', lastError } }
    ).catch(() => {});
    console.error('Erro ao concluir coexistência do WhatsApp:', {
      code: lastError.code,
      graphCode: lastError.graphCode,
      graphSubcode: lastError.graphSubcode,
      fbtraceId: lastError.fbtraceId,
    });
    const status = error instanceof WhatsappGraphError ? error.status : 502;
    return res.status(status).json({
      message: lastError.message,
      code: lastError.code,
      graphCode: lastError.graphCode,
      graphSubcode: lastError.graphSubcode,
      fbtraceId: lastError.fbtraceId,
    });
  }
});

router.post('/health', async (req, res) => {
  try {
    const storeId = req.whatsappContext.storeId;
    const integration = await WhatsappIntegration.findOne({ store: storeId })
      .select(selectIntegrationSecrets());
    if (!integration) {
      return res.status(404).json({ message: 'Integração do WhatsApp não configurada.' });
    }
    const accessToken = decryptField(
      integration.accessTokenEncrypted,
      integration.accessTokenStored
    );
    const phoneNumberId = clean(req.body?.phoneNumberId)
      || clean(integration.phoneNumbers?.[0]?.phoneNumberId);
    if (!accessToken || !phoneNumberId) {
      return res.status(409).json({
        message: 'Ainda não existe um número conectado para diagnosticar.',
      });
    }

    const config = resolveConfig(integration);
    const phoneStatus = await createGraphClient().getPhoneStatus({
      phoneNumberId,
      accessToken,
      graphVersion: config.graphApiVersion,
    });
    const now = new Date();
    const number = integration.phoneNumbers.find(
      (entry) => clean(entry.phoneNumberId) === phoneNumberId
    );
    if (number) {
      number.phoneNumber = phoneStatus.phoneNumber || number.phoneNumber;
      number.displayName = phoneStatus.displayName || number.displayName;
      number.isOnBizApp = phoneStatus.isOnBizApp;
      number.platformType = phoneStatus.platformType;
      number.qualityRating = phoneStatus.qualityRating;
      number.status = phoneStatus.isOnBizApp ? 'Conectado' : 'Desconectado';
      number.lastSyncAt = now;
    }
    integration.lastHealthCheckAt = now;
    const coexistenceHealthy =
      phoneStatus.isOnBizApp && phoneStatus.platformType === 'CLOUD_API';
    integration.onboardingStatus = coexistenceHealthy ? 'connected' : 'disconnected';
    integration.lastError = null;
    await integration.save();
    return res.json({
      healthy: coexistenceHealthy,
      setup: buildSetupResponse(integration),
    });
  } catch (error) {
    const lastError = safeError(error);
    return res.status(error instanceof WhatsappGraphError ? error.status : 500).json({
      message: lastError.message,
      code: lastError.code,
    });
  }
});

module.exports = router;
