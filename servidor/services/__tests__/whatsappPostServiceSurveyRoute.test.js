const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const supertest = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');

const Appointment = require('../../models/Appointment');
const Pet = require('../../models/Pet');
const Store = require('../../models/Store');
const User = require('../../models/User');
const WhatsappAutomationConfig = require('../../models/WhatsappAutomationConfig');
const WhatsappAutomationJob = require('../../models/WhatsappAutomationJob');
const WhatsappIntegration = require('../../models/WhatsappIntegration');
const WhatsappServiceSurvey = require('../../models/WhatsappServiceSurvey');
const funcAgendaRouter = require('../../routes/funcAgenda');

let mongoServer;
let app;
let token;
let appointment;

test.before(async () => {
  process.env.JWT_SECRET = 'survey-route-test-secret';
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());

  const store = await Store.create({ nome: 'Loja Agenda Pesquisa' });
  const [admin, customer] = await User.create([
    {
      tipoConta: 'pessoa_fisica',
      email: 'survey-route-admin@example.test',
      senha: 'hash-local',
      celular: '5521999990001',
      nomeCompleto: 'Admin Pesquisa',
      role: 'admin',
      empresaPrincipal: store._id,
      empresas: [store._id],
    },
    {
      tipoConta: 'pessoa_fisica',
      email: 'survey-route-customer@example.test',
      senha: 'hash-local',
      celular: '21988880001',
      nomeCompleto: 'Cliente Pesquisa',
      role: 'cliente',
      empresaPrincipal: store._id,
    },
  ]);
  const pet = await Pet.create({
    owner: customer._id,
    nome: 'Bidu',
    tipo: 'cachorro',
    raca: 'SRD',
    sexo: 'macho',
    dataNascimento: new Date('2022-01-01T00:00:00.000Z'),
  });
  appointment = await Appointment.create({
    store: store._id,
    cliente: customer._id,
    pet: pet._id,
    scheduledAt: new Date(),
    valor: 80,
    status: 'em_atendimento',
  });
  await Promise.all([
    WhatsappAutomationConfig.create({
      store: store._id,
      phoneNumberId: '109876543210',
      surveyEnabled: true,
      surveyDelayMinutes: 60,
    }),
    WhatsappIntegration.create({
      store: store._id,
      appId: 'app-route-survey',
      wabaId: 'waba-route-survey',
      onboardingStatus: 'connected',
      phoneNumbers: [{
        phoneNumberId: '109876543210',
        phoneNumber: '5521999999999',
        displayName: 'Pesquisa',
        status: 'Conectado',
      }],
    }),
  ]);

  token = jwt.sign({ id: String(admin._id) }, process.env.JWT_SECRET);
  app = express();
  app.use(express.json());
  app.use('/func', funcAgendaRouter);
});

test.after(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

test('transição da agenda para finalizado cria uma pesquisa e reabertura cancela o job', async () => {
  const finalize = await supertest(app)
    .put(`/func/agendamentos/${appointment._id}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ status: 'finalizado' });
  assert.equal(finalize.status, 200, finalize.text);
  assert.equal(finalize.body.status, 'finalizado');
  assert.equal(await WhatsappServiceSurvey.countDocuments({
    appointment: appointment._id,
    status: 'scheduled',
  }), 1);
  assert.equal(await WhatsappAutomationJob.countDocuments({
    type: 'post_service_survey',
    status: 'pending',
  }), 1);

  const duplicate = await supertest(app)
    .put(`/func/agendamentos/${appointment._id}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ status: 'finalizado' });
  assert.equal(duplicate.status, 200, duplicate.text);
  assert.equal(await WhatsappServiceSurvey.countDocuments({
    appointment: appointment._id,
  }), 1);

  const reopen = await supertest(app)
    .put(`/func/agendamentos/${appointment._id}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ status: 'em_atendimento' });
  assert.equal(reopen.status, 200, reopen.text);
  assert.equal(await WhatsappServiceSurvey.countDocuments({
    appointment: appointment._id,
    status: 'cancelled',
  }), 1);
  assert.equal(await WhatsappAutomationJob.countDocuments({
    type: 'post_service_survey',
    status: 'pending',
  }), 0);
});
