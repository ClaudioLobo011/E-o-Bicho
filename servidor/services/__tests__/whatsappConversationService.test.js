const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const Store = require('../../models/Store');
const WhatsappAutomationConfig = require('../../models/WhatsappAutomationConfig');
const WhatsappAutomationJob = require('../../models/WhatsappAutomationJob');
const WhatsappContact = require('../../models/WhatsappContact');
const WhatsappConversation = require('../../models/WhatsappConversation');
const WhatsappIntegration = require('../../models/WhatsappIntegration');
const WhatsappLog = require('../../models/WhatsappLog');
const { encryptText } = require('../../utils/certificates');
const {
  handleHumanReply,
  handleInboundMessage,
  transitionConversation,
} = require('../whatsappConversationService');
const {
  runAutomationCycle,
} = require('../whatsappAutomationWorker');

let mongoServer;
let storeA;
let storeB;

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  [storeA, storeB] = await Store.create([
    {
      nome: 'Loja A',
      horario: {
        segunda: { abre: '09:00', fecha: '18:00', fechada: false },
      },
    },
    { nome: 'Loja B' },
  ]);
  await WhatsappAutomationConfig.create([
    {
      store: storeA._id,
      phoneNumberId: '109876543210',
      enabled: true,
      humanGraceMinutes: 5,
      afterHoursImmediate: true,
      welcomeMessage: 'Mensagem do robô',
      afterHoursMessage: 'Mensagem fora do expediente',
    },
    {
      store: storeB._id,
      phoneNumberId: '209876543210',
      enabled: true,
      humanGraceMinutes: 10,
    },
  ]);
});

test.after(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

test('mensagem durante expediente cria espera humana persistente de cinco minutos', async () => {
  const messageAt = new Date('2026-07-20T15:00:00.000Z');
  const result = await handleInboundMessage({
    storeId: storeA._id,
    phoneNumberId: '109876543210',
    waId: '5511999990001',
    messageId: 'wamid.inbound-open',
    messageAt,
  });
  assert.equal(result.conversation.status, 'WAITING_HUMAN');
  assert.equal(result.hours.isOpen, true);
  assert.equal(
    result.conversation.botEligibleAt.getTime(),
    messageAt.getTime() + (5 * 60 * 1000)
  );
  const job = await WhatsappAutomationJob.findOne({
    conversation: result.conversation._id,
    status: 'pending',
  });
  assert.ok(job);
  assert.equal(job.runAt.getTime(), result.conversation.botEligibleAt.getTime());
});

test('resposta humana cancela o trabalho pendente e assume a conversa', async () => {
  const conversation = await handleHumanReply({
    storeId: storeA._id,
    phoneNumberId: '109876543210',
    waId: '5511999990001',
    userId: new mongoose.Types.ObjectId(),
    source: 'human_web',
    at: new Date('2026-07-20T15:02:00.000Z'),
  });
  assert.equal(conversation.status, 'HUMAN_ACTIVE');
  assert.equal(conversation.lastHumanSource, 'human_web');
  assert.equal(
    await WhatsappAutomationJob.countDocuments({
      conversation: conversation._id,
      status: 'pending',
    }),
    0
  );
});

test('mesmo contato em outra loja permanece isolado', async () => {
  const result = await handleInboundMessage({
    storeId: storeB._id,
    phoneNumberId: '209876543210',
    waId: '5511999990001',
    messageId: 'wamid.store-b',
    messageAt: new Date(Date.now() + (60 * 60 * 1000)),
  });
  assert.equal(result.conversation.store.toString(), storeB._id.toString());
  assert.equal(
    await WhatsappConversation.countDocuments({ waId: '5511999990001' }),
    2
  );
});

test('fora do expediente ativa o robô imediatamente e worker envia resposta configurada', async () => {
  await WhatsappIntegration.create({
    store: storeA._id,
    appId: 'app-id',
    wabaId: 'waba-id',
    accessTokenEncrypted: encryptText('business-token'),
    accessTokenStored: true,
    onboardingStatus: 'connected',
    phoneNumbers: [{
      phoneNumberId: '109876543210',
      phoneNumber: '5511999999999',
      displayName: 'Loja A',
      status: 'Conectado',
    }],
  });
  const messageAt = new Date(Date.now() - 60_000);
  const zonedDateParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(messageAt);
  const datePart = (type) => zonedDateParts.find((entry) => entry.type === type)?.value;
  const specialDate = `${datePart('year')}-${datePart('month')}-${datePart('day')}`;
  await WhatsappAutomationConfig.updateOne(
    { store: storeA._id, phoneNumberId: '109876543210' },
    { $set: { specialHours: [{ date: specialDate, closed: true, label: 'Teste' }] } }
  );
  const result = await handleInboundMessage({
    storeId: storeA._id,
    phoneNumberId: '109876543210',
    waId: '5511888880001',
    messageId: 'wamid.after-hours',
    messageAt,
  });
  assert.equal(result.hours.isOpen, false);
  assert.equal(result.conversation.status, 'BOT_ACTIVE');

  const originalFetch = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({
    messages: [{ id: 'wamid.bot-reply' }],
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
  try {
    const processed = await runAutomationCycle({
      workerId: 'test-worker',
      maxJobs: 5,
    });
    assert.equal(processed, 1);
  } finally {
    global.fetch = originalFetch;
  }

  const log = await WhatsappLog.findOne({
    store: storeA._id,
    messageId: 'wamid.bot-reply',
  });
  assert.equal(log.actorType, 'bot');
  assert.equal(log.message, 'Mensagem fora do expediente');
  const contact = await WhatsappContact.findOne({
    store: storeA._id,
    phoneNumberId: '109876543210',
    waId: '5511888880001',
  });
  assert.equal(contact.lastDirection, 'outgoing');
  assert.equal(
    await WhatsappAutomationJob.countDocuments({
      conversation: result.conversation._id,
      status: 'completed',
    }),
    1
  );
});

test('worker não envia texto livre depois da janela de atendimento de 24 horas', async () => {
  const result = await handleInboundMessage({
    storeId: storeA._id,
    phoneNumberId: '109876543210',
    waId: '5511888880002',
    messageId: 'wamid.expired-window',
    messageAt: new Date(Date.now() - 60_000),
  });
  await Promise.all([
    WhatsappConversation.updateOne(
      { _id: result.conversation._id },
      { $set: { customerServiceWindowExpiresAt: new Date(Date.now() - 1000) } }
    ),
    WhatsappAutomationJob.updateMany(
      { conversation: result.conversation._id, status: 'pending' },
      { $set: { runAt: new Date(Date.now() - 1000) } }
    ),
  ]);

  const originalFetch = global.fetch;
  global.fetch = async () => {
    throw new Error('A Graph API não deveria ser chamada.');
  };
  try {
    const processed = await runAutomationCycle({
      workerId: 'expired-window-worker',
      maxJobs: 1,
    });
    assert.equal(processed, 1);
  } finally {
    global.fetch = originalFetch;
  }

  const conversation = await WhatsappConversation.findById(result.conversation._id);
  assert.equal(conversation.status, 'NEEDS_HUMAN');
  assert.equal(
    await WhatsappLog.countDocuments({
      store: storeA._id,
      destination: '5511888880002',
      actorType: 'bot',
    }),
    0
  );
});

test('tomada e liberação manual registram transições sem temporizador em memória', async () => {
  const takeover = await transitionConversation({
    storeId: storeA._id,
    phoneNumberId: '109876543210',
    waId: '5511888880001',
    action: 'takeover',
    userId: new mongoose.Types.ObjectId(),
  });
  assert.equal(takeover.status, 'HUMAN_ACTIVE');
  const released = await transitionConversation({
    storeId: storeA._id,
    phoneNumberId: '109876543210',
    waId: '5511888880001',
    action: 'release',
    userId: new mongoose.Types.ObjectId(),
  });
  assert.equal(released.status, 'BOT_ACTIVE');
  assert.equal(
    await WhatsappAutomationJob.countDocuments({
      conversation: released._id,
      status: 'pending',
    }),
    1
  );
});
