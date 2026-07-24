const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const request = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');

const Store = require('../../models/Store');
const User = require('../../models/User');
const WhatsappIntegration = require('../../models/WhatsappIntegration');
const WhatsappLog = require('../../models/WhatsappLog');
const WhatsappOnboardingSession = require('../../models/WhatsappOnboardingSession');
const WhatsappWebhookEvent = require('../../models/WhatsappWebhookEvent');
const whatsappRouter = require('../../routes/integrationsWhatsapp');
const {
  processCoexistenceWebhookChanges,
} = require('../whatsappCoexistenceWebhookService');

let mongoServer;
let app;
let store;
let adminToken;
let employeeToken;

const jsonResponse = (payload, status = 200) => new Response(
  JSON.stringify(payload),
  {
    status,
    headers: { 'content-type': 'application/json' },
  }
);

async function createUser({ role, suffix }) {
  return User.create({
    tipoConta: 'pessoa_fisica',
    email: `coexistence-${suffix}@example.test`,
    senha: 'hash-local',
    celular: `55118888${suffix.padStart(4, '0')}`,
    nomeCompleto: `Usuário ${suffix}`,
    role,
    empresaPrincipal: store._id,
    empresas: [store._id],
  });
}

test.before(async () => {
  process.env.JWT_SECRET = 'whatsapp-coexistence-test-secret';
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  store = await Store.create({ nome: 'Loja Coexistência' });
  const admin = await createUser({ role: 'admin', suffix: '2001' });
  const employee = await createUser({ role: 'funcionario', suffix: '2002' });
  adminToken = jwt.sign({ id: String(admin._id) }, process.env.JWT_SECRET);
  employeeToken = jwt.sign({ id: String(employee._id) }, process.env.JWT_SECRET);

  app = express();
  app.use(express.json());
  app.use('/api/integrations/whatsapp', whatsappRouter);
});

test.after(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

test('funcionário não pode consultar nem alterar o setup técnico', async () => {
  const response = await request(app)
    .get(`/api/integrations/whatsapp/${store._id}/coexistence/setup`)
    .set('Authorization', `Bearer ${employeeToken}`);
  assert.equal(response.status, 403);
});

test('setup administrativo grava segredos sem devolvê-los', async () => {
  const saved = await request(app)
    .put(`/api/integrations/whatsapp/${store._id}/coexistence/setup`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      appId: 'app-id',
      configId: 'config-id',
      appSecret: 'app-secret',
      verifyToken: 'verify-token',
      graphApiVersion: 'v25.0',
    });

  assert.equal(saved.status, 200);
  assert.equal(saved.body.ready, true);
  assert.equal(saved.body.appId, 'app-id');
  assert.equal(saved.body.configId, 'config-id');
  assert.equal(saved.body.credentials.appSecretStored, true);
  assert.equal(saved.body.credentials.verifyTokenStored, true);
  assert.equal('appSecret' in saved.body, false);
  assert.equal('verifyToken' in saved.body, false);
  assert.equal('accessToken' in saved.body, false);
});

test('conclui coexistência, pula registro e inicia as duas sincronizações', async () => {
  const sessionResponse = await request(app)
    .post(`/api/integrations/whatsapp/${store._id}/coexistence/session`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({});
  assert.equal(sessionResponse.status, 201);

  const invalidEvent = await request(app)
    .post(`/api/integrations/whatsapp/${store._id}/coexistence/complete`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      sessionId: sessionResponse.body.sessionId,
      code: 'temporary-code',
      event: 'FINISH',
      sessionInfo: {
        waba_id: 'waba-id',
        phone_number_id: '109876543210',
      },
    });
  assert.equal(invalidEvent.status, 400);

  const originalFetch = global.fetch;
  const calls = [];
  const responses = [
    jsonResponse({ access_token: 'business-token' }),
    jsonResponse({ success: true }),
    jsonResponse({
      id: '109876543210',
      display_phone_number: '+55 11 99999-0001',
      verified_name: 'Loja Coexistência',
      quality_rating: 'GREEN',
      is_on_biz_app: true,
      platform_type: 'CLOUD_API',
    }),
    jsonResponse({ request_id: 'contacts-request' }),
    jsonResponse({ request_id: 'history-request' }),
  ];
  global.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    return responses.shift();
  };

  try {
    const completed = await request(app)
      .post(`/api/integrations/whatsapp/${store._id}/coexistence/complete`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        sessionId: sessionResponse.body.sessionId,
        code: 'temporary-code',
        event: 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING',
        sessionInfo: {
          waba_id: 'waba-id',
          phone_number_id: '109876543210',
          business_id: 'business-id',
        },
      });

    assert.equal(completed.status, 200);
    assert.equal(completed.body.connected, true);
    assert.equal(completed.body.registrationSkipped, true);
    assert.equal(completed.body.setup.onboardingStatus, 'syncing');
    assert.equal(completed.body.setup.phoneNumbers[0].isOnBizApp, true);
    assert.equal(completed.body.setup.phoneNumbers[0].contactsSyncStatus, 'requested');
    assert.equal(completed.body.setup.phoneNumbers[0].historySyncStatus, 'requested');
    assert.equal('accessToken' in completed.body, false);
    assert.equal(calls.length, 5);

    const integration = await WhatsappIntegration.findOne({ store: store._id });
    assert.equal(integration.accessTokenStored, true);
    assert.equal(integration.connectionMode, 'coexistence');
    assert.equal(integration.wabaId, 'waba-id');
    assert.equal(integration.phoneNumbers[0].contactsSyncRequestId, 'contacts-request');
    assert.equal(integration.phoneNumbers[0].historySyncRequestId, 'history-request');

    const session = await WhatsappOnboardingSession.findOne({ store: store._id });
    assert.equal(session.status, 'completed');
  } finally {
    global.fetch = originalFetch;
  }
});

test('uma sessão concluída não pode ser reutilizada', async () => {
  const completedSession = await WhatsappOnboardingSession.findOne({
    store: store._id,
    status: 'completed',
  });
  assert.ok(completedSession);

  const response = await request(app)
    .post(`/api/integrations/whatsapp/${store._id}/coexistence/complete`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      sessionId: 'token-que-nao-pertence-a-sessao',
      code: 'temporary-code',
      event: 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING',
      sessionInfo: {
        waba_id: 'waba-id',
        phone_number_id: '109876543210',
      },
    });
  assert.equal(response.status, 409);
  assert.equal(response.body.code, 'WHATSAPP_COEXISTENCE_SESSION_INVALID');
});

test('webhooks de coexistência espelham mensagem do celular e atualizam a sincronização', async () => {
  let integration = await WhatsappIntegration.findOne({ store: store._id }).lean();
  const emitted = [];
  const io = {
    to: (room) => ({
      emit: (event, payload) => emitted.push({ room, event, payload }),
    }),
  };
  const echoEntries = [{
    changes: [{
      field: 'smb_message_echoes',
      value: {
        metadata: {
          phone_number_id: '109876543210',
          display_phone_number: '5511999990001',
        },
        message_echoes: [{
          id: 'wamid.echo-1',
          to: '5511888880001',
          timestamp: '1750000000',
          type: 'text',
          text: { body: 'Resposta enviada pelo celular' },
        }],
      },
    }],
  }];

  await processCoexistenceWebhookChanges({
    entries: echoEntries,
    integration,
    wabaId: 'waba-id',
    io,
  });
  await processCoexistenceWebhookChanges({
    entries: echoEntries,
    integration,
    wabaId: 'waba-id',
    io,
  });

  const echoedLogs = await WhatsappLog.find({
    store: store._id,
    messageId: 'wamid.echo-1',
  }).lean();
  assert.equal(echoedLogs.length, 1);
  assert.equal(echoedLogs[0].direction, 'outgoing');
  assert.equal(echoedLogs[0].source, 'whatsapp_business_app');
  assert.equal(emitted.some((entry) => entry.event === 'whatsapp:message'), true);

  integration = await WhatsappIntegration.findOne({ store: store._id }).lean();
  await processCoexistenceWebhookChanges({
    entries: [{
      changes: [{
        field: 'history',
        value: {
          metadata: { phone_number_id: '109876543210' },
          history: [{
            metadata: { phase: 2, progress: 100, chunk_order: 4 },
            threads: [],
          }],
        },
      }],
    }],
    integration,
    wabaId: 'waba-id',
    io,
  });
  let updated = await WhatsappIntegration.findOne({ store: store._id });
  assert.equal(updated.onboardingStatus, 'connected');
  assert.equal(updated.phoneNumbers[0].historySyncStatus, 'completed');
  assert.equal(updated.phoneNumbers[0].historySyncProgress, 100);

  integration = updated.toObject();
  await processCoexistenceWebhookChanges({
    entries: [{
      changes: [{
        field: 'account_update',
        value: { event: 'PARTNER_REMOVED' },
      }],
    }],
    integration,
    wabaId: 'waba-id',
    io,
  });
  updated = await WhatsappIntegration.findOne({ store: store._id });
  assert.equal(updated.onboardingStatus, 'disconnected');
  assert.equal(updated.phoneNumbers[0].status, 'Desconectado');
  assert.equal(await WhatsappWebhookEvent.countDocuments({ store: store._id }), 3);
});
