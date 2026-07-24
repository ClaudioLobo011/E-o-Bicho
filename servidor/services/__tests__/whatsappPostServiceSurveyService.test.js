const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const Appointment = require('../../models/Appointment');
const Store = require('../../models/Store');
const User = require('../../models/User');
const WhatsappAutomationConfig = require('../../models/WhatsappAutomationConfig');
const WhatsappAutomationJob = require('../../models/WhatsappAutomationJob');
const WhatsappContactPreference = require('../../models/WhatsappContactPreference');
const WhatsappConversation = require('../../models/WhatsappConversation');
const WhatsappIntegration = require('../../models/WhatsappIntegration');
const WhatsappLog = require('../../models/WhatsappLog');
const WhatsappServiceSurvey = require('../../models/WhatsappServiceSurvey');
const { encryptText } = require('../../utils/certificates');
const { runAutomationCycle } = require('../whatsappAutomationWorker');
const { handleInboundMessage } = require('../whatsappConversationService');
const {
  applySurveyConversationOutcome,
  handleSurveyInboundResponse,
  schedulePostServiceSurvey,
  setContactPreference,
} = require('../whatsappPostServiceSurveyService');

let mongoServer;
let fixture;

const createFixture = async () => {
  const store = await Store.create({ nome: 'Loja Pesquisa' });
  const customer = await User.create({
    tipoConta: 'pessoa_fisica',
    email: `survey-${new mongoose.Types.ObjectId()}@example.test`,
    senha: 'hash-local',
    celular: '21988887777',
    nomeCompleto: 'Cliente Pesquisa',
    role: 'cliente',
  });
  const appointment = await Appointment.create({
    store: store._id,
    cliente: customer._id,
    pet: new mongoose.Types.ObjectId(),
    scheduledAt: new Date(),
    valor: 100,
    status: 'finalizado',
  });
  await Promise.all([
    WhatsappAutomationConfig.create({
      store: store._id,
      phoneNumberId: '109876543210',
      surveyEnabled: true,
      surveyDelayMinutes: 0,
      surveyQuestion: 'Como foi o atendimento? Responda de 1 a 5.',
      surveyTemplateName: 'pesquisa_pos_atendimento',
      surveyTemplateLanguage: 'pt_BR',
      surveyRequireOptIn: true,
      surveyLowRatingThreshold: 3,
    }),
    WhatsappIntegration.create({
      store: store._id,
      appId: 'app-survey',
      wabaId: 'waba-survey',
      accessTokenEncrypted: encryptText('business-token'),
      accessTokenStored: true,
      onboardingStatus: 'connected',
      phoneNumbers: [{
        phoneNumberId: '109876543210',
        phoneNumber: '5521999999999',
        displayName: 'Loja Pesquisa',
        status: 'Conectado',
      }],
    }),
  ]);
  return { store, customer, appointment };
};

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
});

test.beforeEach(async () => {
  await Promise.all(Object.values(mongoose.connection.collections).map(
    (collection) => collection.deleteMany({})
  ));
  fixture = await createFixture();
});

test.after(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

test('finalização agenda uma única pesquisa persistente por atendimento', async () => {
  const first = await schedulePostServiceSurvey({
    appointmentId: fixture.appointment._id,
    completedAt: new Date(),
  });
  const second = await schedulePostServiceSurvey({
    appointmentId: fixture.appointment._id,
    completedAt: new Date(),
  });

  assert.equal(first.scheduled, true);
  assert.equal(second.scheduled, false);
  assert.equal(second.reason, 'already_registered');
  assert.equal(await WhatsappServiceSurvey.countDocuments({}), 1);
  assert.equal(await WhatsappAutomationJob.countDocuments({
    type: 'post_service_survey',
    status: 'pending',
  }), 1);
  assert.equal(first.survey.waId, '5521988887777');
});

test('worker usa texto livre dentro da janela ativa e registra o envio', async () => {
  const scheduled = await schedulePostServiceSurvey({
    appointmentId: fixture.appointment._id,
    completedAt: new Date(),
  });
  await WhatsappConversation.updateOne(
    { _id: scheduled.survey.conversation },
    {
      $set: {
        lastInboundAt: new Date(),
        customerServiceWindowExpiresAt: new Date(Date.now() + (60 * 60 * 1000)),
      },
    }
  );

  let requestBody;
  const originalFetch = global.fetch;
  global.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return new Response(JSON.stringify({
      messages: [{ id: 'wamid.survey-text' }],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  try {
    assert.equal(await runAutomationCycle({ workerId: 'survey-text', maxJobs: 1 }), 1);
  } finally {
    global.fetch = originalFetch;
  }

  assert.equal(requestBody.type, 'text');
  assert.match(requestBody.text.body, /1 a 5/);
  const survey = await WhatsappServiceSurvey.findById(scheduled.survey._id);
  assert.equal(survey.status, 'sent');
  assert.equal(survey.sentMode, 'text');
  assert.equal(survey.messageId, 'wamid.survey-text');
  assert.equal(await WhatsappLog.countDocuments({
    messageId: 'wamid.survey-text',
    source: 'automation_survey',
  }), 1);
});

test('fora da janela exige opt-in e envia o template aprovado', async () => {
  await setContactPreference({
    storeId: fixture.store._id,
    waId: '5521988887777',
    status: 'opted_in',
    source: 'test',
    proof: 'Autorização de teste',
  });
  const scheduled = await schedulePostServiceSurvey({
    appointmentId: fixture.appointment._id,
    completedAt: new Date(),
  });

  let requestBody;
  const originalFetch = global.fetch;
  global.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return new Response(JSON.stringify({
      messages: [{ id: 'wamid.survey-template' }],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  try {
    assert.equal(await runAutomationCycle({ workerId: 'survey-template', maxJobs: 1 }), 1);
  } finally {
    global.fetch = originalFetch;
  }

  assert.equal(requestBody.type, 'template');
  assert.equal(requestBody.template.name, 'pesquisa_pos_atendimento');
  assert.equal(requestBody.template.language.code, 'pt_BR');
  const survey = await WhatsappServiceSurvey.findById(scheduled.survey._id);
  assert.equal(survey.status, 'sent');
  assert.equal(survey.sentMode, 'template');
});

test('sem opt-in fora da janela ignora a pesquisa sem chamar a Meta', async () => {
  const scheduled = await schedulePostServiceSurvey({
    appointmentId: fixture.appointment._id,
    completedAt: new Date(),
  });
  const originalFetch = global.fetch;
  global.fetch = async () => {
    throw new Error('A Meta não deveria ser chamada.');
  };
  try {
    assert.equal(await runAutomationCycle({ workerId: 'survey-no-consent', maxJobs: 1 }), 1);
  } finally {
    global.fetch = originalFetch;
  }

  const survey = await WhatsappServiceSurvey.findById(scheduled.survey._id);
  assert.equal(survey.status, 'skipped');
  assert.match(survey.skipReason, /Consentimento/);
});

test('nota baixa é registrada e encaminha a conversa para atendimento humano', async () => {
  const scheduled = await schedulePostServiceSurvey({
    appointmentId: fixture.appointment._id,
    completedAt: new Date(),
  });
  await Promise.all([
    WhatsappServiceSurvey.updateOne(
      { _id: scheduled.survey._id },
      {
        $set: {
          status: 'sent',
          sentAt: new Date(),
          responseExpiresAt: new Date(Date.now() + (60 * 60 * 1000)),
          messageId: 'wamid.question',
        },
      }
    ),
    WhatsappConversation.updateOne(
      { _id: scheduled.survey.conversation },
      { $set: { status: 'BOT_ACTIVE', serviceMode: 'automation' } }
    ),
  ]);

  const activity = {
    storeId: fixture.store._id,
    phoneNumberId: '109876543210',
    waId: '5521988887777',
    message: '2 - Demorou muito',
    messageId: 'wamid.rating',
    messageAt: new Date(),
  };
  const result = await handleSurveyInboundResponse(activity);
  assert.equal(result.handled, true);
  assert.equal(result.lowRating, true);
  await handleInboundMessage({ ...activity, suppressAutomation: true });
  await applySurveyConversationOutcome({ result });

  const [survey, conversation] = await Promise.all([
    WhatsappServiceSurvey.findById(scheduled.survey._id),
    WhatsappConversation.findById(scheduled.survey.conversation),
  ]);
  assert.equal(survey.status, 'escalated');
  assert.equal(survey.rating, 2);
  assert.equal(conversation.status, 'NEEDS_HUMAN');
  assert.equal(conversation.priority, 100);
  assert.ok(conversation.labels.includes('avaliacao_baixa'));
  assert.equal(await WhatsappAutomationJob.countDocuments({
    conversation: conversation._id,
    type: 'human_grace_timeout',
    status: 'pending',
  }), 0);
});

test('opt-out cancela pesquisas ainda pendentes', async () => {
  await schedulePostServiceSurvey({
    appointmentId: fixture.appointment._id,
    completedAt: new Date(Date.now() + (60 * 60 * 1000)),
  });
  await setContactPreference({
    storeId: fixture.store._id,
    waId: '5521988887777',
    status: 'opted_out',
    source: 'whatsapp_keyword',
    proof: 'SAIR',
  });

  const [preference, survey, pendingJobs] = await Promise.all([
    WhatsappContactPreference.findOne({ store: fixture.store._id }),
    WhatsappServiceSurvey.findOne({ appointment: fixture.appointment._id }),
    WhatsappAutomationJob.countDocuments({ status: 'pending' }),
  ]);
  assert.equal(preference.status, 'opted_out');
  assert.equal(survey.status, 'cancelled');
  assert.equal(pendingJobs, 0);
});
