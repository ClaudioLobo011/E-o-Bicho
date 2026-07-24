const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const Appointment = require('../../models/Appointment');
const Pet = require('../../models/Pet');
const Service = require('../../models/Service');
const ServiceGroup = require('../../models/ServiceGroup');
const Store = require('../../models/Store');
const User = require('../../models/User');
const WhatsappAppointmentFlow = require('../../models/WhatsappAppointmentFlow');
const WhatsappAutomationConfig = require('../../models/WhatsappAutomationConfig');
const WhatsappAutomationJob = require('../../models/WhatsappAutomationJob');
const WhatsappConversation = require('../../models/WhatsappConversation');
const WhatsappIntegration = require('../../models/WhatsappIntegration');
const WhatsappLog = require('../../models/WhatsappLog');
const { encryptText } = require('../../utils/certificates');
const {
  addDays,
  zonedParts,
} = require('../whatsappAppointmentAvailabilityService');
const {
  getAppointmentFlowStats,
  processAppointmentInbound,
} = require('../whatsappAppointmentFlowService');
const {
  handleHumanReply,
  handleInboundMessage,
} = require('../whatsappConversationService');
const { runAutomationCycle } = require('../whatsappAutomationWorker');

let mongoServer;
let storeA;
let storeB;
let service;
let professionalA;
let customerA;
let petA;
let sequence = 0;

const fullDayStoreSchedule = {
  domingo: { abre: '00:00', fecha: '23:59', fechada: false },
  segunda: { abre: '00:00', fecha: '23:59', fechada: false },
  terca: { abre: '00:00', fecha: '23:59', fechada: false },
  quarta: { abre: '00:00', fecha: '23:59', fechada: false },
  quinta: { abre: '00:00', fecha: '23:59', fechada: false },
  sexta: { abre: '00:00', fecha: '23:59', fechada: false },
  sabado: { abre: '00:00', fecha: '23:59', fechada: false },
};

const fullDayProfessionalSchedule = [
  'domingo',
  'segunda',
  'terca',
  'quarta',
  'quinta',
  'sexta',
  'sabado',
].map((dia) => ({
  dia,
  horaInicio: '00:00',
  horaFim: '23:59',
}));

const receive = async ({
  store = storeA,
  phoneNumberId = '109876543210',
  waId,
  message,
  messageAt = new Date(),
}) => {
  sequence += 1;
  const messageId = `wamid.appointment.${sequence}`;
  const transition = await handleInboundMessage({
    storeId: store._id,
    phoneNumberId,
    waId,
    messageId,
    messageAt,
  });
  const result = await processAppointmentInbound({
    storeId: store._id,
    phoneNumberId,
    waId,
    messageId,
    messageAt,
    message,
    transition,
  });
  return { ...result, transition, messageId };
};

const futureDateMessage = (days = 2, hour = '14:00') => {
  const today = zonedParts(new Date(), 'America/Sao_Paulo').dateKey;
  const date = addDays(today, days);
  const [year, month, day] = date.split('-');
  return {
    date,
    message: `${day}/${month}/${year} às ${hour}`,
  };
};

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  [storeA, storeB] = await Store.create([
    { nome: 'Loja Agenda A', horario: fullDayStoreSchedule },
    { nome: 'Loja Agenda B', horario: fullDayStoreSchedule },
  ]);
  const group = await ServiceGroup.create({
    nome: 'Consultas WhatsApp',
    tiposPermitidos: ['veterinario'],
    ativo: true,
  });
  service = await Service.create({
    nome: 'Consulta veterinária',
    grupo: group._id,
    duracaoMinutos: 30,
    valor: 120,
    categorias: ['veterinario'],
    ativo: true,
  });
  [professionalA] = await User.create([{
    tipoConta: 'pessoa_fisica',
    email: 'vet-a@example.test',
    senha: 'hash',
    celular: '5511900000001',
    nomeCompleto: 'Dra. Ana',
    role: 'funcionario',
    grupos: ['veterinario'],
    empresas: [storeA._id],
    empresaPrincipal: storeA._id,
    horarios: fullDayProfessionalSchedule,
  }, {
    tipoConta: 'pessoa_fisica',
    email: 'vet-b@example.test',
    senha: 'hash',
    celular: '5511900000002',
    nomeCompleto: 'Dr. Bruno',
    role: 'funcionario',
    grupos: ['veterinario'],
    empresas: [storeB._id],
    empresaPrincipal: storeB._id,
    horarios: fullDayProfessionalSchedule,
  }]);
  customerA = await User.create({
    tipoConta: 'pessoa_fisica',
    email: 'cliente-a@example.test',
    senha: 'hash',
    celular: '5511999990101',
    nomeCompleto: 'Cliente Agenda',
    role: 'cliente',
    empresas: [storeA._id],
    empresaPrincipal: storeA._id,
  });
  petA = await Pet.create({
    owner: customerA._id,
    nome: 'Bidu',
    tipo: 'Cachorro',
    raca: 'Vira-lata',
    sexo: 'Macho',
    dataNascimento: new Date('2022-01-01T12:00:00.000Z'),
  });
  await WhatsappAutomationConfig.create([{
    store: storeA._id,
    phoneNumberId: '109876543210',
    enabled: true,
    appointmentEnabled: true,
    humanGraceMinutes: 5,
    appointmentMinLeadMinutes: 0,
    appointmentSlotIntervalMinutes: 30,
    appointmentSearchDays: 14,
    appointmentMaxOptions: 3,
  }, {
    store: storeB._id,
    phoneNumberId: '209876543210',
    enabled: true,
    appointmentEnabled: true,
    humanGraceMinutes: 5,
    appointmentMinLeadMinutes: 0,
  }]);
});

test.after(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

test('inicia o fluxo com espera humana e confirma um agendamento existente', async () => {
  const waId = customerA.celular;
  const first = await receive({
    waId,
    message: 'Gostaria de marcar um atendimento veterinário',
  });
  assert.equal(first.handled, true);
  assert.equal(first.flow.step, 'collect_date');
  assert.equal(first.transition.hours.isOpen, true);
  const firstJob = await WhatsappAutomationJob.findOne({
    conversation: first.flow.conversation,
    type: 'appointment_flow_reply',
    status: 'pending',
  });
  assert.ok(firstJob);
  assert.ok(firstJob.runAt > new Date());

  const requested = futureDateMessage(2, '14:00');
  const dateResult = await receive({
    waId,
    message: requested.message,
  });
  assert.equal(dateResult.flow.step, 'select_slot');
  assert.ok(dateResult.flow.options.length > 0);
  assert.equal(dateResult.flow.options[0].date, requested.date);

  const slotResult = await receive({ waId, message: '1' });
  assert.equal(slotResult.flow.step, 'confirm');
  assert.equal(slotResult.flow.status, 'awaiting_confirmation');

  const confirmation = await receive({ waId, message: 'sim' });
  assert.equal(confirmation.completed, true);
  assert.ok(confirmation.appointment);
  const stored = await Appointment.findById(confirmation.appointment._id);
  assert.equal(stored.source, 'whatsapp_automation');
  assert.equal(String(stored.store), String(storeA._id));
  assert.equal(String(stored.cliente), String(customerA._id));
  assert.equal(String(stored.pet), String(petA._id));
  assert.equal(await Appointment.countDocuments({
    sourceReference: confirmation.flow.sessionId,
  }), 1);

  const replay = await receive({ waId, message: 'sim' });
  assert.equal(replay.handled, false);
  assert.equal(await Appointment.countDocuments({
    sourceReference: confirmation.flow.sessionId,
  }), 1);
});

test('cadastra novo cliente e pet somente ao confirmar', async () => {
  const waId = '5511999990202';
  const first = await receive({
    waId,
    message: 'Quero agendar consulta veterinária',
  });
  assert.equal(first.flow.step, 'collect_customer_name');
  assert.equal(await User.countDocuments({ celular: waId }), 0);

  assert.equal((await receive({ waId, message: 'Maria da Silva' })).flow.step, 'collect_pet_name');
  assert.equal((await receive({ waId, message: 'Luna' })).flow.step, 'collect_pet_species');
  assert.equal((await receive({ waId, message: 'Cachorro' })).flow.step, 'collect_pet_breed');
  assert.equal((await receive({ waId, message: 'Poodle' })).flow.step, 'collect_pet_sex');
  assert.equal((await receive({ waId, message: 'fêmea' })).flow.step, 'collect_pet_birthdate');
  assert.equal((await receive({ waId, message: '3 anos' })).flow.step, 'collect_date');
  assert.equal(await User.countDocuments({ celular: waId }), 0);

  const requested = futureDateMessage(3, '15:00');
  assert.equal((await receive({ waId, message: requested.message })).flow.step, 'select_slot');
  assert.equal((await receive({ waId, message: '1' })).flow.step, 'confirm');
  const confirmation = await receive({ waId, message: 'SIM' });
  assert.equal(confirmation.completed, true);

  const customer = await User.findOne({ celular: waId });
  assert.ok(customer);
  assert.equal(customer.nomeCompleto, 'Maria da Silva');
  assert.ok(customer.empresas.some((id) => String(id) === String(storeA._id)));
  const pet = await Pet.findOne({ owner: customer._id });
  assert.equal(pet.nome, 'Luna');
  assert.equal(pet.raca, 'Poodle');
  assert.ok(await Appointment.findOne({
    cliente: customer._id,
    pet: pet._id,
    source: 'whatsapp_automation',
  }));
});

test('resposta humana interrompe o fluxo e cancela a resposta automática', async () => {
  const waId = '5511999990303';
  const started = await receive({
    waId,
    message: 'Quero marcar uma consulta veterinária',
  });
  const humanId = new mongoose.Types.ObjectId();
  const conversation = await handleHumanReply({
    storeId: storeA._id,
    phoneNumberId: '109876543210',
    waId,
    userId: humanId,
    source: 'human_web',
  });
  assert.equal(conversation.status, 'HUMAN_ACTIVE');
  const flow = await WhatsappAppointmentFlow.findById(started.flow._id);
  assert.equal(flow.status, 'handoff');
  assert.equal(flow.handoffReason, 'human_reply_web');
  assert.equal(await WhatsappAutomationJob.countDocuments({
    conversation: conversation._id,
    status: 'pending',
  }), 0);
});

test('revalida conflito criado depois da oferta e não duplica o horário', async () => {
  const waId = '5511999990404';
  await receive({ waId, message: 'Agendar consulta veterinária' });
  await receive({ waId, message: 'Carlos Souza' });
  await receive({ waId, message: 'Thor' });
  await receive({ waId, message: 'Cachorro' });
  await receive({ waId, message: 'Labrador' });
  await receive({ waId, message: 'macho' });
  await receive({ waId, message: '4 anos' });
  const requested = futureDateMessage(4, '16:00');
  const offered = await receive({ waId, message: requested.message });
  const selected = offered.flow.options[0];
  await receive({ waId, message: '1' });

  await Appointment.create({
    store: storeA._id,
    cliente: customerA._id,
    pet: petA._id,
    servico: service._id,
    itens: [{
      servico: service._id,
      valor: 120,
      profissional: selected.professional,
      data: selected.date,
      hora: selected.time,
      status: 'agendado',
    }],
    profissional: selected.professional,
    scheduledAt: selected.startAt,
    valor: 120,
    status: 'agendado',
  });

  const result = await receive({ waId, message: 'sim' });
  assert.equal(result.conflict, true);
  assert.equal(result.flow.status, 'collecting');
  assert.equal(await Appointment.countDocuments({
    sourceReference: result.flow.sessionId,
  }), 0);
});

test('mantém o mesmo contato isolado entre lojas e expõe indicadores por ambiente', async () => {
  const waId = '5511999990303';
  const secondStore = await receive({
    store: storeB,
    phoneNumberId: '209876543210',
    waId,
    message: 'Gostaria de marcar consulta veterinária',
  });
  assert.equal(secondStore.handled, true);
  assert.equal(String(secondStore.flow.store), String(storeB._id));
  const distinctStores = await WhatsappAppointmentFlow.distinct('store', { waId });
  assert.equal(distinctStores.length, 2);

  const statsA = await getAppointmentFlowStats({
    storeId: storeA._id,
    phoneNumberId: '109876543210',
  });
  const statsB = await getAppointmentFlowStats({
    storeId: storeB._id,
    phoneNumberId: '209876543210',
  });
  assert.ok(statsA.handoff >= 1);
  assert.equal(statsB.active, 1);
});

test('worker envia a confirmação e fecha a conversa sem usar resposta humana', async () => {
  await WhatsappIntegration.create({
    store: storeA._id,
    appId: 'app-id',
    wabaId: 'waba-id',
    accessTokenEncrypted: encryptText('business-token'),
    accessTokenStored: true,
    onboardingStatus: 'connected',
    phoneNumbers: [{
      phoneNumberId: '109876543210',
      phoneNumber: '5511888888888',
      displayName: 'Loja Agenda A',
      status: 'Conectado',
    }],
  });
  const pendingConfirmation = await WhatsappAutomationJob.findOne({
    store: storeA._id,
    type: 'appointment_flow_reply',
    status: 'pending',
    'payload.flowStatus': 'completed',
  }).sort({ createdAt: 1 });
  assert.ok(pendingConfirmation);
  await WhatsappAutomationJob.updateOne(
    { _id: pendingConfirmation._id },
    { $set: { runAt: new Date(Date.now() - 1000) } }
  );

  const originalFetch = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({
    messages: [{ id: 'wamid.appointment.confirmation' }],
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
  try {
    await runAutomationCycle({ workerId: 'appointment-worker', maxJobs: 1 });
  } finally {
    global.fetch = originalFetch;
  }

  const log = await WhatsappLog.findOne({
    store: storeA._id,
    messageId: 'wamid.appointment.confirmation',
  });
  assert.ok(log);
  assert.equal(log.source, 'automation_appointment');
  assert.match(log.message, /Agendamento confirmado/);
  const conversation = await WhatsappConversation.findById(
    pendingConfirmation.conversation
  );
  assert.equal(conversation.status, 'CLOSED');
  assert.equal(conversation.lastActorType, 'bot');
});
