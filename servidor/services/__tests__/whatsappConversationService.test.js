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

test('modo manual mantém conversas pausadas e ativa o bot somente após liberação', async () => {
  await WhatsappAutomationConfig.updateOne(
    { store: storeB._id, phoneNumberId: '209876543210' },
    { $set: { manualChatActivation: true, aiEnabled: true } }
  );
  const firstInbound = await handleInboundMessage({
    storeId: storeB._id,
    phoneNumberId: '209876543210',
    waId: '5511777770001',
    messageId: 'wamid.manual-paused-1',
    messageAt: new Date(),
  });
  assert.equal(firstInbound.conversation.status, 'PAUSED');
  assert.equal(firstInbound.conversation.automationOptIn, false);
  assert.equal(firstInbound.automationEnabled, false);
  assert.equal(await WhatsappAutomationJob.countDocuments({
    conversation: firstInbound.conversation._id,
    status: 'pending',
  }), 0);

  const released = await transitionConversation({
    storeId: storeB._id,
    phoneNumberId: '209876543210',
    waId: '5511777770001',
    action: 'release',
    userId: new mongoose.Types.ObjectId(),
  });
  assert.equal(released.status, 'BOT_ACTIVE');
  assert.equal(released.automationOptIn, true);
  assert.equal(await WhatsappAutomationJob.countDocuments({
    conversation: released._id,
    status: 'pending',
  }), 1);

  const nextInbound = await handleInboundMessage({
    storeId: storeB._id,
    phoneNumberId: '209876543210',
    waId: '5511777770001',
    messageId: 'wamid.manual-active-2',
    messageAt: new Date(Date.now() + 1000),
  });
  assert.equal(nextInbound.conversation.status, 'BOT_ACTIVE');
  assert.equal(nextInbound.automationEnabled, true);

  const paused = await transitionConversation({
    storeId: storeB._id,
    phoneNumberId: '209876543210',
    waId: '5511777770001',
    action: 'pause',
    pauseMinutes: 0,
    reason: 'Pausa do piloto',
  });
  assert.equal(paused.status, 'PAUSED');
  assert.equal(paused.automationOptIn, false);

  const inboundWhilePaused = await handleInboundMessage({
    storeId: storeB._id,
    phoneNumberId: '209876543210',
    waId: '5511777770001',
    messageId: 'wamid.manual-paused-3',
    messageAt: new Date(Date.now() + 2000),
  });
  assert.equal(inboundWhilePaused.conversation.status, 'PAUSED');
  assert.equal(inboundWhilePaused.automationEnabled, false);
  assert.equal(await WhatsappAutomationJob.countDocuments({
    conversation: released._id,
    status: 'pending',
  }), 0);
});

test('modo manual nao agenda resposta no futuro quando o relogio da Meta esta adiantado', async () => {
  const receivedAt = new Date();
  const futureMetaTimestamp = new Date(receivedAt.getTime() + (6 * 60 * 1000));
  const waId = '5511777770099';
  const initial = await handleInboundMessage({
    storeId: storeB._id,
    phoneNumberId: '209876543210',
    waId,
    messageId: 'wamid.clock-skew-initial',
    messageAt: receivedAt,
    receivedAt,
  });
  assert.equal(initial.conversation.status, 'PAUSED');

  await transitionConversation({
    storeId: storeB._id,
    phoneNumberId: '209876543210',
    waId,
    action: 'release',
    userId: new mongoose.Types.ObjectId(),
  });
  const next = await handleInboundMessage({
    storeId: storeB._id,
    phoneNumberId: '209876543210',
    waId,
    messageId: 'wamid.clock-skew-future',
    messageAt: futureMetaTimestamp,
    receivedAt,
  });
  const pending = await WhatsappAutomationJob.findOne({
    conversation: next.conversation._id,
    status: 'pending',
  }).sort({ createdAt: -1 });

  assert.equal(next.conversation.lastInboundAt.getTime(), receivedAt.getTime());
  assert.equal(pending.runAt.getTime(), receivedAt.getTime());
});

test('chat liberado usa a IA local com prompt separado antes de enviar ao WhatsApp', async () => {
  await WhatsappAutomationJob.updateMany(
    { status: 'pending' },
    { $set: { status: 'cancelled', cancelledAt: new Date() } }
  );
  await WhatsappIntegration.create({
    store: storeB._id,
    appId: 'app-id-b',
    wabaId: 'waba-id-b',
    accessTokenEncrypted: encryptText('business-token-b'),
    accessTokenStored: true,
    onboardingStatus: 'connected',
    phoneNumbers: [{
      phoneNumberId: '209876543210',
      phoneNumber: '5511999999998',
      displayName: 'Loja B',
      status: 'Conectado',
    }],
  });
  await WhatsappLog.create({
    store: storeB._id,
    phoneNumberId: '209876543210',
    direction: 'incoming',
    status: 'Recebido',
    origin: '5511777770002',
    destination: '5511999999998',
    message: 'Vocês fazem banho em cachorro?',
    messageId: 'wamid.ai-inbound-1',
    messageType: 'text',
    actorType: 'customer',
  });
  await handleInboundMessage({
    storeId: storeB._id,
    phoneNumberId: '209876543210',
    waId: '5511777770002',
    messageId: 'wamid.ai-inbound-1',
    messageAt: new Date(),
  });
  const released = await transitionConversation({
    storeId: storeB._id,
    phoneNumberId: '209876543210',
    waId: '5511777770002',
    action: 'release',
    userId: new mongoose.Types.ObjectId(),
  });
  assert.equal(released.automationOptIn, true);

  const originalFetch = global.fetch;
  const originalKey = process.env.EOBICHO_LOCAL_AI_API_KEY;
  process.env.EOBICHO_LOCAL_AI_API_KEY = 'test-local-key';
  let localAiPayload;
  global.fetch = async (url, options) => {
    const parsed = new URL(String(url));
    if (parsed.hostname === '127.0.0.1') {
      localAiPayload = JSON.parse(options.body);
      return new Response(JSON.stringify({
        choices: [{ message: { content: 'Sim! Trabalhamos com banho. O valor precisa ser confirmado pela equipe conforme o porte.' } }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({ messages: [{ id: 'wamid.ai-reply-1' }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  try {
    const processed = await runAutomationCycle({ workerId: 'ai-worker', maxJobs: 1 });
    assert.equal(processed, 1);
  } finally {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.EOBICHO_LOCAL_AI_API_KEY;
    else process.env.EOBICHO_LOCAL_AI_API_KEY = originalKey;
  }

  assert.match(localAiPayload.messages[0].content, /E o Bicho/);
  assert.match(localAiPayload.messages.at(-1).content, /banho em cachorro/i);
  const reply = await WhatsappLog.findOne({ messageId: 'wamid.ai-reply-1' }).lean();
  assert.equal(reply.source, 'automation_ai');
  assert.equal(reply.meta.aiGenerated, true);
  assert.match(reply.message, /valor precisa ser confirmado/i);
});
