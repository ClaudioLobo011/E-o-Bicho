const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const request = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');

const Store = require('../../models/Store');
const Service = require('../../models/Service');
const ServiceGroup = require('../../models/ServiceGroup');
const User = require('../../models/User');
const WhatsappIntegration = require('../../models/WhatsappIntegration');
const WhatsappLog = require('../../models/WhatsappLog');
const whatsappRouter = require('../../routes/integrationsWhatsapp');

let mongoServer;
let app;
let storeA;
let storeB;
let employeeToken;
let adminToken;

async function createUser({ role, store, suffix }) {
  return User.create({
    tipoConta: 'pessoa_fisica',
    email: `whatsapp-${suffix}@example.test`,
    senha: 'hash-local',
    celular: `55119999${suffix.padStart(4, '0')}`,
    nomeCompleto: `Usuário ${suffix}`,
    role,
    empresaPrincipal: store._id,
    empresas: [store._id],
  });
}

test.before(async () => {
  process.env.JWT_SECRET = 'whatsapp-tenant-test-secret';
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());

  [storeA, storeB] = await Store.create([
    { nome: 'Loja A' },
    { nome: 'Loja B' },
  ]);
  const employee = await createUser({ role: 'funcionario', store: storeA, suffix: '1001' });
  const admin = await createUser({ role: 'admin', store: storeA, suffix: '1002' });
  employeeToken = jwt.sign({ id: String(employee._id) }, process.env.JWT_SECRET);
  adminToken = jwt.sign({ id: String(admin._id) }, process.env.JWT_SECRET);

  await WhatsappIntegration.create([
    {
      store: storeA._id,
      appId: 'app-a',
      wabaId: 'waba-a',
      appSecretEncrypted: 'nao-deve-sair',
      appSecretStored: true,
      accessTokenEncrypted: 'nao-deve-sair',
      accessTokenStored: true,
      verifyTokenEncrypted: 'nao-deve-sair',
      verifyTokenStored: true,
      phoneNumbers: [{
        phoneNumberId: '109876543210',
        phoneNumber: '5511999990001',
        displayName: 'Atendimento A',
        status: 'Conectado',
      }],
    },
    {
      store: storeB._id,
      appId: 'app-b',
      phoneNumbers: [{
        phoneNumberId: '209876543210',
        phoneNumber: '5511999990002',
        displayName: 'Atendimento B',
        status: 'Conectado',
      }],
    },
  ]);

  app = express();
  app.use(express.json());
  app.use('/api/integrations/whatsapp', whatsappRouter);
  app.use((error, _req, res, _next) => {
    res.status(500).json({ message: error.message });
  });
});

test.after(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

test('funcionário carrega somente o ambiente de uma loja vinculada', async () => {
  const allowed = await request(app)
    .get(`/api/integrations/whatsapp/${storeA._id}/environment`)
    .set('Authorization', `Bearer ${employeeToken}`);
  assert.equal(allowed.status, 200);
  assert.equal(allowed.body.store.id, String(storeA._id));
  assert.equal(allowed.body.phoneNumbers[0].phoneNumberId, '109876543210');

  const denied = await request(app)
    .get(`/api/integrations/whatsapp/${storeB._id}/environment`)
    .set('Authorization', `Bearer ${employeeToken}`);
  assert.equal(denied.status, 403);
  assert.equal(denied.body.code, 'WHATSAPP_STORE_ACCESS_DENIED');
});

test('funcionário comum não acessa a configuração administrativa', async () => {
  const response = await request(app)
    .get(`/api/integrations/whatsapp/${storeA._id}`)
    .set('Authorization', `Bearer ${employeeToken}`);

  assert.equal(response.status, 403);
});

test('resposta administrativa informa apenas presença das credenciais', async () => {
  const response = await request(app)
    .get(`/api/integrations/whatsapp/${storeA._id}`)
    .set('Authorization', `Bearer ${adminToken}`);

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.credentials, {
    appSecretStored: true,
    accessTokenStored: true,
    verifyTokenStored: true,
  });
  assert.equal('appSecret' in response.body, false);
  assert.equal('accessToken' in response.body, false);
  assert.equal('verifyToken' in response.body, false);
  assert.equal('pin' in response.body.phoneNumbers[0], false);
});

test('número de outra loja é rejeitado antes de consultar conversas', async () => {
  const response = await request(app)
    .get(`/api/integrations/whatsapp/${storeA._id}/conversations`)
    .query({ phoneNumberId: '209876543210' })
    .set('Authorization', `Bearer ${employeeToken}`);

  assert.equal(response.status, 403);
  assert.equal(response.body.code, 'WHATSAPP_NUMBER_ACCESS_DENIED');
});

test('funcionário consulta automação e pode assumir conversa, mas não altera configuração', async () => {
  const setup = await request(app)
    .get(`/api/integrations/whatsapp/${storeA._id}/numbers/109876543210/automation`)
    .set('Authorization', `Bearer ${employeeToken}`);
  assert.equal(setup.status, 200);
  assert.equal(setup.body.configuration.enabled, false);

  const takeover = await request(app)
    .post(`/api/integrations/whatsapp/${storeA._id}/numbers/109876543210/conversations/5511888880001/takeover`)
    .set('Authorization', `Bearer ${employeeToken}`)
    .send({});
  assert.equal(takeover.status, 200);
  assert.equal(takeover.body.conversation.status, 'HUMAN_ACTIVE');

  const denied = await request(app)
    .put(`/api/integrations/whatsapp/${storeA._id}/numbers/109876543210/automation`)
    .set('Authorization', `Bearer ${employeeToken}`)
    .send({ enabled: true });
  assert.equal(denied.status, 403);
});

test('preferência do contato e indicadores permanecem isolados por loja e número', async () => {
  const preference = await request(app)
    .put(`/api/integrations/whatsapp/${storeA._id}/numbers/109876543210/contacts/5511888880001/preference`)
    .set('Authorization', `Bearer ${employeeToken}`)
    .send({
      status: 'opted_in',
      proof: 'Autorização registrada no atendimento',
    });
  assert.equal(preference.status, 200, preference.text);
  assert.equal(preference.body.preference.status, 'opted_in');

  const read = await request(app)
    .get(`/api/integrations/whatsapp/${storeA._id}/numbers/109876543210/contacts/5511888880001/preference`)
    .set('Authorization', `Bearer ${employeeToken}`);
  assert.equal(read.status, 200, read.text);
  assert.equal(read.body.preference.status, 'opted_in');

  const deniedNumber = await request(app)
    .get(`/api/integrations/whatsapp/${storeA._id}/numbers/209876543210/contacts/5511888880001/preference`)
    .set('Authorization', `Bearer ${employeeToken}`);
  assert.equal(deniedNumber.status, 403);
  assert.equal(deniedNumber.body.code, 'WHATSAPP_NUMBER_ACCESS_DENIED');

  const config = await request(app)
    .put(`/api/integrations/whatsapp/${storeA._id}/numbers/109876543210/automation`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      surveyEnabled: true,
      surveyDelayMinutes: 45,
      surveyTemplateName: 'pesquisa_pos_atendimento',
      surveyTemplateLanguage: 'pt_BR',
      surveyRequireOptIn: true,
      surveyLowRatingThreshold: 2,
      appointmentEnabled: true,
      appointmentMinLeadMinutes: 90,
      appointmentSlotIntervalMinutes: 15,
      appointmentSearchDays: 21,
      appointmentMaxOptions: 4,
    });
  assert.equal(config.status, 200, config.text);
  assert.equal(config.body.configuration.surveyEnabled, true);
  assert.equal(config.body.configuration.surveyDelayMinutes, 45);
  assert.equal(config.body.configuration.surveyLowRatingThreshold, 2);
  assert.equal(config.body.configuration.appointmentEnabled, true);
  assert.equal(config.body.configuration.appointmentMinLeadMinutes, 90);
  assert.equal(config.body.configuration.appointmentSlotIntervalMinutes, 15);
  assert.equal(config.body.configuration.appointmentSearchDays, 21);
  assert.equal(config.body.configuration.appointmentMaxOptions, 4);

  const stats = await request(app)
    .get(`/api/integrations/whatsapp/${storeA._id}/numbers/109876543210/surveys/stats`)
    .set('Authorization', `Bearer ${employeeToken}`);
  assert.equal(stats.status, 200, stats.text);
  assert.deepEqual(stats.body.stats.byStatus, {});

  const appointmentStats = await request(app)
    .get(`/api/integrations/whatsapp/${storeA._id}/numbers/109876543210/appointments/stats`)
    .set('Authorization', `Bearer ${employeeToken}`);
  assert.equal(appointmentStats.status, 200, appointmentStats.text);
  assert.deepEqual(appointmentStats.body.stats.byStatus, {});

  const deniedAppointmentStats = await request(app)
    .get(`/api/integrations/whatsapp/${storeA._id}/numbers/209876543210/appointments/stats`)
    .set('Authorization', `Bearer ${employeeToken}`);
  assert.equal(deniedAppointmentStats.status, 403);
  assert.equal(deniedAppointmentStats.body.code, 'WHATSAPP_NUMBER_ACCESS_DENIED');
});

test('checklist bloqueia ativação incompleta e exige confirmação administrativa no piloto pronto', async () => {
  const blocked = await request(app)
    .get(`/api/integrations/whatsapp/${storeA._id}/numbers/109876543210/pilot-readiness`)
    .set('Authorization', `Bearer ${employeeToken}`);
  assert.equal(blocked.status, 200, blocked.text);
  assert.equal(blocked.body.readiness.store.id, String(storeA._id));
  assert.equal(blocked.body.readiness.number.phoneNumberId, '109876543210');
  assert.equal(blocked.body.readiness.summary.status, 'blocked');
  assert.equal(blocked.body.readiness.summary.canActivate, false);
  assert.ok(blocked.body.readiness.summary.blockers > 0);
  assert.equal(JSON.stringify(blocked.body).includes(String(storeB._id)), false);

  const blockedActivation = await request(app)
    .put(`/api/integrations/whatsapp/${storeA._id}/numbers/109876543210/automation`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ enabled: true, pilotAcknowledged: true });
  assert.equal(blockedActivation.status, 409, blockedActivation.text);
  assert.equal(blockedActivation.body.code, 'WHATSAPP_PILOT_BLOCKED');
  assert.equal(blockedActivation.body.readiness.summary.canActivate, false);

  await Store.updateOne(
    { _id: storeA._id },
    {
      $set: {
        horario: {
          domingo: { fechada: true },
          segunda: { abre: '08:00', fecha: '18:00', fechada: false },
          terca: { abre: '08:00', fecha: '18:00', fechada: false },
          quarta: { abre: '08:00', fecha: '18:00', fechada: false },
          quinta: { abre: '08:00', fecha: '18:00', fechada: false },
          sexta: { abre: '08:00', fecha: '18:00', fechada: false },
          sabado: { abre: '08:00', fecha: '12:00', fechada: false },
        },
      },
    }
  );
  await WhatsappIntegration.updateOne(
    { store: storeA._id, 'phoneNumbers.phoneNumberId': '109876543210' },
    {
      $set: {
        embeddedSignupConfigId: 'config-a',
        wabaId: 'waba-a',
        connectionMode: 'coexistence',
        onboardingStatus: 'connected',
        webhookSubscribedAt: new Date(),
        lastHealthCheckAt: new Date(),
        'phoneNumbers.$.status': 'Conectado',
        'phoneNumbers.$.connectionMode': 'coexistence',
        'phoneNumbers.$.isOnBizApp': true,
        'phoneNumbers.$.contactsSyncStatus': 'completed',
        'phoneNumbers.$.historySyncStatus': 'completed',
        'phoneNumbers.$.historySyncProgress': 100,
      },
    }
  );

  const [vetGroup, groomingGroup] = await ServiceGroup.create([
    {
      nome: 'Veterinário piloto WhatsApp',
      tiposPermitidos: ['veterinario'],
      ativo: true,
    },
    {
      nome: 'Estética piloto WhatsApp',
      tiposPermitidos: ['esteticista'],
      ativo: true,
    },
  ]);
  await Service.create([
    {
      nome: 'Consulta piloto WhatsApp',
      grupo: vetGroup._id,
      duracaoMinutos: 30,
      valor: 100,
      categorias: ['veterinario'],
      ativo: true,
    },
    {
      nome: 'Banho piloto WhatsApp',
      grupo: groomingGroup._id,
      duracaoMinutos: 60,
      valor: 80,
      categorias: ['banho'],
      ativo: true,
    },
  ]);
  const professional = await createUser({
    role: 'funcionario',
    store: storeA,
    suffix: '1003',
  });
  professional.grupos = ['veterinario', 'esteticista'];
  professional.horarios = [{
    dia: 'segunda',
    tipoJornada: 'jornada',
    modalidade: 'integral',
    horaInicio: '08:00',
    horaFim: '18:00',
    almocoInicio: '12:00',
    almocoFim: '13:00',
  }];
  await professional.save();

  const ready = await request(app)
    .post(`/api/integrations/whatsapp/${storeA._id}/numbers/109876543210/pilot-readiness`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      configuration: {
        enabled: true,
        appointmentEnabled: true,
        surveyEnabled: true,
      },
    });
  assert.equal(ready.status, 200, ready.text);
  assert.equal(ready.body.readiness.summary.canActivate, true);
  assert.equal(ready.body.readiness.summary.blockers, 0);
  assert.ok(ready.body.readiness.summary.warnings > 0);

  await WhatsappLog.create([
    {
      store: storeA._id,
      direction: 'incoming',
      phoneNumberId: '109876543210',
      origin: '5511888880001',
      destination: '5511999990001',
      message: 'Mensagem de teste do piloto',
      source: 'webhook',
    },
    {
      store: storeA._id,
      direction: 'outgoing',
      phoneNumberId: '109876543210',
      origin: '5511999990001',
      destination: '5511888880001',
      message: 'Resposta enviada pelo celular',
      source: 'whatsapp_business_app',
    },
  ]);
  const fullyReady = await request(app)
    .post(`/api/integrations/whatsapp/${storeA._id}/numbers/109876543210/pilot-readiness`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      configuration: {
        enabled: true,
        appointmentEnabled: true,
        surveyEnabled: true,
        surveyTemplateApproved: true,
      },
    });
  assert.equal(fullyReady.status, 200, fullyReady.text);
  assert.equal(fullyReady.body.readiness.summary.status, 'ready');
  assert.equal(fullyReady.body.readiness.summary.warnings, 0);

  const missingAcknowledgement = await request(app)
    .put(`/api/integrations/whatsapp/${storeA._id}/numbers/109876543210/automation`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ enabled: true });
  assert.equal(missingAcknowledgement.status, 409, missingAcknowledgement.text);
  assert.equal(
    missingAcknowledgement.body.code,
    'WHATSAPP_PILOT_ACKNOWLEDGEMENT_REQUIRED'
  );

  const staleChecklist = await request(app)
    .put(`/api/integrations/whatsapp/${storeA._id}/numbers/109876543210/automation`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      enabled: true,
      surveyTemplateApproved: true,
      pilotAcknowledged: true,
      pilotReadinessFingerprint: 'checklist-antigo',
    });
  assert.equal(staleChecklist.status, 409, staleChecklist.text);
  assert.equal(staleChecklist.body.code, 'WHATSAPP_PILOT_READINESS_CHANGED');
  assert.ok(staleChecklist.body.readiness.fingerprint);

  const activated = await request(app)
    .put(`/api/integrations/whatsapp/${storeA._id}/numbers/109876543210/automation`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      enabled: true,
      surveyTemplateApproved: true,
      pilotAcknowledged: true,
      pilotReadinessFingerprint: fullyReady.body.readiness.fingerprint,
    });
  assert.equal(activated.status, 200, activated.text);
  assert.equal(activated.body.configuration.enabled, true);
  assert.ok(activated.body.configuration.pilotAcknowledgedAt);
  assert.ok(activated.body.configuration.pilotChecklistVersion);
  assert.ok(activated.body.configuration.pilotReadinessFingerprint);
  assert.equal(activated.body.configuration.surveyTemplateApproved, true);
  assert.equal(activated.body.pilotRun.status, 'in_progress');
  assert.ok(activated.body.pilotRun.scenarios.length >= 10);

  const pilotSnapshot = await request(app)
    .get(`/api/integrations/whatsapp/${storeA._id}/numbers/109876543210/pilot`)
    .set('Authorization', `Bearer ${employeeToken}`);
  assert.equal(pilotSnapshot.status, 200, pilotSnapshot.text);
  assert.equal(pilotSnapshot.body.pilotRun.id, activated.body.pilotRun.id);
  assert.equal(pilotSnapshot.body.pilotRun.progress.passed, 0);
  assert.equal(pilotSnapshot.body.rollout.baselineApproved, false);

  const employeeCannotApprove = await request(app)
    .patch(
      `/api/integrations/whatsapp/${storeA._id}/numbers/109876543210`
      + `/pilot/${activated.body.pilotRun.id}/scenarios/inbound_webhook`
    )
    .set('Authorization', `Bearer ${employeeToken}`)
    .send({
      status: 'passed',
      evidenceNote: 'Mensagem recebida na Central',
    });
  assert.equal(employeeCannotApprove.status, 403);

  const evidenceRequired = await request(app)
    .patch(
      `/api/integrations/whatsapp/${storeA._id}/numbers/109876543210`
      + `/pilot/${activated.body.pilotRun.id}/scenarios/inbound_webhook`
    )
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ status: 'passed', evidenceNote: '' });
  assert.equal(evidenceRequired.status, 400, evidenceRequired.text);
  assert.equal(evidenceRequired.body.code, 'WHATSAPP_PILOT_EVIDENCE_REQUIRED');

  const incompletePilot = await request(app)
    .post(
      `/api/integrations/whatsapp/${storeA._id}/numbers/109876543210`
      + `/pilot/${activated.body.pilotRun.id}/complete`
    )
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ completionNotes: 'Tentativa antes dos cenários' });
  assert.equal(incompletePilot.status, 409, incompletePilot.text);
  assert.equal(incompletePilot.body.code, 'WHATSAPP_PILOT_SCENARIOS_INCOMPLETE');

  await WhatsappIntegration.updateOne(
    { store: storeA._id },
    {
      $push: {
        phoneNumbers: {
          phoneNumberId: '109876543211',
          phoneNumber: '5511999990003',
          displayName: 'Segundo número A',
          status: 'Conectado',
          connectionMode: 'coexistence',
          isOnBizApp: true,
          contactsSyncStatus: 'completed',
          historySyncStatus: 'completed',
          historySyncProgress: 100,
        },
      },
    }
  );
  const secondReadiness = await request(app)
    .post(`/api/integrations/whatsapp/${storeA._id}/numbers/109876543211/pilot-readiness`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ configuration: { enabled: true } });
  assert.equal(secondReadiness.status, 200, secondReadiness.text);
  assert.equal(secondReadiness.body.readiness.summary.canActivate, true);

  const expansionBlocked = await request(app)
    .put(`/api/integrations/whatsapp/${storeA._id}/numbers/109876543211/automation`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      enabled: true,
      pilotAcknowledged: true,
      pilotReadinessFingerprint: secondReadiness.body.readiness.fingerprint,
    });
  assert.equal(expansionBlocked.status, 409, expansionBlocked.text);
  assert.equal(expansionBlocked.body.code, 'WHATSAPP_PILOT_EXPANSION_BLOCKED');
  assert.equal(expansionBlocked.body.rollout.expansionBlockedByAnotherPilot, true);

  for (const scenario of activated.body.pilotRun.scenarios) {
    const scenarioResult = await request(app)
      .patch(
        `/api/integrations/whatsapp/${storeA._id}/numbers/109876543210`
        + `/pilot/${activated.body.pilotRun.id}/scenarios/${scenario.key}`
      )
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        status: 'passed',
        evidenceNote: `Cenário ${scenario.key} validado no ambiente de teste`,
        referenceType: 'manual',
        referenceId: `evidencia-${scenario.key}`,
      });
    assert.equal(scenarioResult.status, 200, scenarioResult.text);
  }

  const originalWelcomeMessage =
    activated.body.pilotRun.configurationSnapshot.welcomeMessage;
  const changedConfiguration = await request(app)
    .put(`/api/integrations/whatsapp/${storeA._id}/numbers/109876543210/automation`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ welcomeMessage: `${originalWelcomeMessage} Alterada durante o piloto.` });
  assert.equal(changedConfiguration.status, 200, changedConfiguration.text);

  const changedPilotCannotComplete = await request(app)
    .post(
      `/api/integrations/whatsapp/${storeA._id}/numbers/109876543210`
      + `/pilot/${activated.body.pilotRun.id}/complete`
    )
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ completionNotes: 'Configuração foi alterada' });
  assert.equal(changedPilotCannotComplete.status, 409, changedPilotCannotComplete.text);
  assert.equal(
    changedPilotCannotComplete.body.code,
    'WHATSAPP_PILOT_CONFIGURATION_CHANGED'
  );

  const restoredConfiguration = await request(app)
    .put(`/api/integrations/whatsapp/${storeA._id}/numbers/109876543210/automation`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ welcomeMessage: originalWelcomeMessage });
  assert.equal(restoredConfiguration.status, 200, restoredConfiguration.text);

  const completedPilot = await request(app)
    .post(
      `/api/integrations/whatsapp/${storeA._id}/numbers/109876543210`
      + `/pilot/${activated.body.pilotRun.id}/complete`
    )
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ completionNotes: 'Todos os cenários obrigatórios foram validados.' });
  assert.equal(completedPilot.status, 200, completedPilot.text);
  assert.equal(completedPilot.body.pilotRun.status, 'passed');
  assert.equal(completedPilot.body.pilotRun.progress.percent, 100);
  assert.equal(completedPilot.body.rollout.baselineApproved, true);

  const expanded = await request(app)
    .put(`/api/integrations/whatsapp/${storeA._id}/numbers/109876543211/automation`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      enabled: true,
      pilotAcknowledged: true,
      pilotReadinessFingerprint: secondReadiness.body.readiness.fingerprint,
    });
  assert.equal(expanded.status, 200, expanded.text);
  assert.equal(expanded.body.configuration.enabled, true);
  assert.equal(expanded.body.pilotRun.status, 'in_progress');
  assert.equal(expanded.body.pilotRun.phoneNumberId, '109876543211');

  const deniedOtherNumber = await request(app)
    .get(`/api/integrations/whatsapp/${storeA._id}/numbers/209876543210/pilot-readiness`)
    .set('Authorization', `Bearer ${employeeToken}`);
  assert.equal(deniedOtherNumber.status, 403);
  assert.equal(deniedOtherNumber.body.code, 'WHATSAPP_NUMBER_ACCESS_DENIED');
});
