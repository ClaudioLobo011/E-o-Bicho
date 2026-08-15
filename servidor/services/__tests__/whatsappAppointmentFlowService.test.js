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
let groomingCustomer;
let groomingPets;
let groomingServices;
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
  const groomingGroup = await ServiceGroup.create({
    nome: 'Estética WhatsApp',
    tiposPermitidos: ['esteticista'],
    ativo: true,
  });
  groomingServices = await Service.create([{
    nome: 'Banho',
    grupo: groomingGroup._id,
    duracaoMinutos: 30,
    valor: 60,
    categorias: ['banho'],
    ativo: true,
  }, {
    nome: 'Banho Felino',
    grupo: groomingGroup._id,
    duracaoMinutos: 30,
    valor: 90,
    categorias: ['banho'],
    ativo: true,
  }, {
    nome: 'Tosa Felina Maquina',
    grupo: groomingGroup._id,
    duracaoMinutos: 30,
    valor: 150,
    categorias: ['tosa'],
    ativo: true,
  }, {
    nome: 'Tosa Felina Tesoura',
    grupo: groomingGroup._id,
    duracaoMinutos: 30,
    valor: 180,
    categorias: ['tosa'],
    ativo: true,
  }]);
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
  }, {
    tipoConta: 'pessoa_fisica',
    email: 'groomer-a@example.test',
    senha: 'hash',
    celular: '5511900000003',
    nomeCompleto: 'Adriano Teste',
    role: 'funcionario',
    grupos: ['esteticista'],
    empresas: [storeA._id],
    empresaPrincipal: storeA._id,
    horarios: fullDayProfessionalSchedule,
  }, {
    tipoConta: 'pessoa_fisica',
    email: 'groomer-b@example.test',
    senha: 'hash',
    celular: '5511900000004',
    nomeCompleto: 'Ingrid Teste',
    role: 'funcionario',
    grupos: ['esteticista'],
    empresas: [storeA._id],
    empresaPrincipal: storeA._id,
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
  groomingCustomer = await User.create({
    tipoConta: 'pessoa_fisica',
    email: 'cliente-banho@example.test',
    senha: 'hash',
    celular: '(11) 99999-0102',
    nomeCompleto: 'Claudio Cliente',
    role: 'admin_master',
    empresas: [storeA._id],
    empresaPrincipal: storeA._id,
  });
  groomingPets = await Pet.create([{
    owner: groomingCustomer._id,
    nome: 'Marley',
    tipo: 'Cachorro',
    raca: 'Poodle',
    porte: 'Pequeno',
    sexo: 'Macho',
    dataNascimento: new Date('2021-01-01T12:00:00.000Z'),
  }, {
    owner: groomingCustomer._id,
    nome: 'Yummi',
    tipo: 'Gato',
    raca: 'Sem raça definida',
    porte: 'Pequeno',
    sexo: 'Fêmea',
    dataNascimento: new Date('2022-06-01T12:00:00.000Z'),
  }, {
    owner: groomingCustomer._id,
    nome: 'Luna',
    tipo: 'Cachorro',
    raca: 'Shih-tzu',
    porte: 'Pequeno',
    sexo: 'Fêmea',
    dataNascimento: new Date('2020-03-01T12:00:00.000Z'),
  }, {
    owner: groomingCustomer._id,
    nome: 'Thor',
    tipo: 'Cachorro',
    raca: 'Vira-lata',
    porte: 'Médio',
    sexo: 'Macho',
    dataNascimento: new Date('2019-04-01T12:00:00.000Z'),
  }, {
    owner: groomingCustomer._id,
    nome: 'Nina',
    tipo: 'Gato',
    raca: 'Siamês',
    porte: 'Pequeno',
    sexo: 'Fêmea',
    dataNascimento: new Date('2023-02-01T12:00:00.000Z'),
  }]);
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

test('conduz banho e tosa natural para dois pets e confirma profissionais simultaneos', async () => {
  const waId = '5511999990102';
  const first = await receive({
    waId,
    message: 'Bom dia, quero agendar um banho.',
  });
  assert.equal(first.flow.step, 'select_pet');
  assert.match(first.reply, /Claudio, quem viria/i);

  const pets = await receive({ waId, message: 'Marley e Yummi' });
  assert.equal(pets.flow.step, 'collect_pet_services');
  assert.equal(pets.flow.data.selectedPets.length, 2);

  const services = await receive({
    waId,
    message: 'Seria banho apenas para o Marley e uma tosa na maquina para a Yummi',
  });
  assert.equal(services.flow.step, 'collect_group_preference');
  assert.deepEqual(
    services.flow.data.petServiceItems.map((item) => item.serviceName).sort(),
    ['Banho', 'Tosa Felina Maquina'],
  );

  const together = await receive({
    waId,
    message: 'Os dois podem estar no mesmo horario sem problemas',
  });
  assert.equal(together.flow.step, 'collect_date');

  const requested = futureDateMessage(2, '14:00');
  const professionalQuestion = await receive({ waId, message: requested.message });
  assert.equal(professionalQuestion.flow.step, 'collect_professional_preference');
  assert.match(professionalQuestion.reply, /preferência de profissional/i);
  const offered = await receive({ waId, message: 'Sem preferência' });
  assert.equal(offered.flow.step, 'select_group_slot');
  assert.ok(offered.flow.data.groupOptions.length > 0);
  assert.doesNotMatch(offered.reply, /Adriano|Ingrid/i);
  const offeredOption = offered.flow.data.groupOptions[0];
  assert.equal(offeredOption.assignments.length, 2);
  assert.equal(new Set(offeredOption.assignments.map((item) => String(item.professional))).size, 2);
  assert.equal(new Set(offeredOption.assignments.map((item) => item.time)).size, 1);

  const firstOfferedMinutes = Number(offeredOption.time.slice(0, 2)) * 60
    + Number(offeredOption.time.slice(3, 5));
  const later = await receive({ waId, message: 'As 14 fica cedo, teria mais tarde?' });
  assert.equal(later.flow.step, 'select_group_slot');
  const laterMinutes = Number(later.flow.data.groupOptions[0].time.slice(0, 2)) * 60
    + Number(later.flow.data.groupOptions[0].time.slice(3, 5));
  assert.ok(laterMinutes > firstOfferedMinutes);

  const slot = await receive({ waId, message: '1' });
  assert.equal(slot.flow.step, 'confirm_group');
  const confirmed = await receive({ waId, message: 'Sim pode marcar' });
  assert.equal(confirmed.completed, true);
  assert.equal(confirmed.appointments.length, 2);

  const stored = await Appointment.find({
    _id: { $in: confirmed.appointments.map((appointment) => appointment._id) },
  }).sort({ scheduledAt: 1 });
  assert.equal(stored.length, 2);
  assert.equal(new Set(stored.map((appointment) => String(appointment.pet))).size, 2);
  assert.equal(new Set(stored.map((appointment) => String(appointment.profissional))).size, 2);
  assert.equal(new Set(stored.map((appointment) => appointment.scheduledAt.toISOString())).size, 1);
  assert.deepEqual(
    stored.map((appointment) => String(appointment.servico)).sort(),
    groomingServices
      .filter((entry) => ['Banho', 'Tosa Felina Maquina'].includes(entry.nome))
      .map((entry) => String(entry._id))
      .sort(),
  );
});

test('entende nomes digitados errado, detalha tosa e separa cao e gato sem sobreposicao', async () => {
  const waId = '5511999990102';
  const first = await receive({
    waId,
    message: 'Quero marcar banho e tosa para meus pets',
  });
  assert.equal(first.flow.step, 'select_pet');

  const pets = await receive({ waId, message: 'Marlei e Yuumi' });
  assert.equal(pets.flow.step, 'collect_pet_services');
  assert.equal(pets.flow.data.selectedPets.length, 2);

  const services = await receive({
    waId,
    message: 'Banho para o Marlei e tosa para a Yuumi',
  });
  assert.equal(services.flow.step, 'select_pet_service_detail');
  assert.equal(services.flow.data.pendingServicePet.name, 'Yummi');
  assert.equal(services.flow.data.pendingServiceOptions.length, 2);

  const detail = await receive({ waId, message: 'Na tesoura' });
  assert.equal(detail.flow.step, 'collect_group_preference');
  assert.ok(detail.flow.data.petServiceItems.some((item) => item.serviceName === 'Tosa Felina Tesoura'));

  const separate = await receive({
    waId,
    message: 'Prefiro que o gatinho fique sozinho',
  });
  assert.equal(separate.flow.step, 'collect_date');

  const requested = futureDateMessage(4, '14:00');
  const professionalQuestion = await receive({ waId, message: requested.message });
  assert.equal(professionalQuestion.flow.step, 'collect_professional_preference');
  const offered = await receive({ waId, message: 'Não tenho preferência' });
  assert.equal(offered.flow.step, 'select_group_slot');
  const assignments = offered.flow.data.groupOptions[0].assignments;
  assert.equal(assignments.length, 2);
  assert.equal(new Set(assignments.map((item) => item.time)).size, 2);

  const cancelled = await receive({ waId, message: 'cancelar' });
  assert.equal(cancelled.cancelled, true);
  await WhatsappAutomationJob.updateMany({
    type: 'appointment_flow_reply',
    status: 'pending',
    'payload.flowId': String(cancelled.flow._id),
  }, {
    $set: { status: 'completed', completedAt: new Date() },
  });
});

test('aproveita pet, servico, data, hora e profissional informados na primeira mensagem', async () => {
  const waId = '5511999990102';
  const requested = futureDateMessage(6, '14:00');
  const result = await receive({
    waId,
    message: `Quero agendar banho para o Marley em ${requested.message} com Adriano`,
  });

  assert.equal(String(result.flow.customer), String(groomingCustomer._id));
  assert.equal(result.flow.data.customerName, 'Claudio Cliente');
  assert.equal(result.flow.data.selectedPets.length, 1);
  assert.equal(result.flow.data.selectedPets[0].name, 'Marley');
  assert.equal(result.flow.data.petServiceItems[0].serviceName, 'Banho');
  assert.equal(result.flow.step, 'confirm_group');
  assert.equal(result.flow.status, 'awaiting_confirmation');
  assert.equal(result.flow.data.selectedGroupOption.date, requested.date);
  assert.equal(result.flow.data.selectedGroupOption.time, '14:00');
  assert.match(result.flow.data.professionalPreference, /Adriano/i);
  assert.doesNotMatch(result.reply, /nome completo|nome do pet|espécie|raça/i);

  const cancelled = await receive({ waId, message: 'cancelar' });
  assert.equal(cancelled.cancelled, true);
  await WhatsappAutomationJob.updateMany({
    type: 'appointment_flow_reply',
    status: 'pending',
    'payload.flowId': String(cancelled.flow._id),
  }, {
    $set: { status: 'completed', completedAt: new Date() },
  });
});

test('consulta somente os pets mencionados e oculta profissionais quando nao ha preferencia', async () => {
  const waId = '5511999990102';
  const first = await receive({
    waId,
    message: 'Gostaria de agendar um banho para o Marley',
  });
  assert.equal(first.flow.step, 'collect_date');
  assert.deepEqual(first.flow.data.selectedPets.map((pet) => pet.name), ['Marley']);

  const requested = futureDateMessage(8, '15:00');
  const preference = await receive({ waId, message: requested.message });
  assert.equal(preference.flow.step, 'collect_professional_preference');

  const offered = await receive({ waId, message: 'Sem preferência' });
  assert.equal(offered.flow.step, 'select_group_slot');
  assert.ok(offered.flow.data.groupOptions.every((option) => (
    option.assignments.length === 1 && option.assignments[0].petName === 'Marley'
  )));
  assert.match(offered.reply, /horários para Marley/i);
  assert.doesNotMatch(offered.reply, /pets juntos|Adriano|Ingrid/i);

  const cancelled = await receive({ waId, message: 'cancelar' });
  assert.equal(cancelled.cancelled, true);
  await WhatsappAutomationJob.updateMany({
    type: 'appointment_flow_reply',
    status: 'pending',
    'payload.flowId': String(cancelled.flow._id),
  }, {
    $set: { status: 'completed', completedAt: new Date() },
  });
});

test('diferencia todos os pets de uma selecao por nomes', async () => {
  const waId = '5511999990102';
  const all = await receive({
    waId,
    message: 'Quero agendar banho para todos os meus pets',
  });
  assert.equal(all.flow.data.selectedPets.length, 5);
  assert.deepEqual(
    all.flow.data.selectedPets.map((pet) => pet.name).sort(),
    ['Luna', 'Marley', 'Nina', 'Thor', 'Yummi'],
  );

  const cancelled = await receive({ waId, message: 'cancelar' });
  assert.equal(cancelled.cancelled, true);
  await WhatsappAutomationJob.updateMany({
    type: 'appointment_flow_reply',
    status: 'pending',
    'payload.flowId': String(cancelled.flow._id),
  }, {
    $set: { status: 'completed', completedAt: new Date() },
  });
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
  assert.match(log.message, /Agendamento(?:s)? (?:confirmado|concluídos)/);
  const conversation = await WhatsappConversation.findById(
    pendingConfirmation.conversation
  );
  assert.equal(conversation.status, 'CLOSED');
  assert.equal(conversation.lastActorType, 'bot');
});

test('modo manual impede que o fluxo de agendamento responda antes da ativação do chat', async () => {
  await WhatsappAutomationConfig.updateOne(
    { store: storeB._id, phoneNumberId: '209876543210' },
    { $set: { manualChatActivation: true, aiEnabled: true } },
  );

  const waId = '5511999990999';
  const result = await receive({
    store: storeB,
    phoneNumberId: '209876543210',
    waId,
    message: 'Quero marcar um banho amanhã',
  });

  assert.equal(result.handled, false);
  assert.equal(result.reason, 'conversation_paused');
  assert.equal(result.transition.automationEnabled, false);
  assert.equal(await WhatsappAppointmentFlow.countDocuments({
    store: storeB._id,
    phoneNumberId: '209876543210',
    waId,
  }), 0);
});
