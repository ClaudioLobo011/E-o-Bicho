const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const mongoose = require('mongoose');

const Pet = require('../models/Pet');
const Service = require('../models/Service');
const User = require('../models/User');
const WhatsappAppointmentFlow = require('../models/WhatsappAppointmentFlow');
const WhatsappAuditEvent = require('../models/WhatsappAuditEvent');
const WhatsappAutomationConfig = require('../models/WhatsappAutomationConfig');
const WhatsappAutomationJob = require('../models/WhatsappAutomationJob');
const WhatsappConversation = require('../models/WhatsappConversation');
const {
  ensureScopedSequenceAtLeast,
  nextScopedSequence,
  customerSequenceKey,
} = require('../utils/sequences');
const {
  addDays,
  createAppointmentFromFlow,
  findAvailableSlots,
  findCustomerByWhatsapp,
  findServicesForIntent,
  getPetList,
  normalizeText,
  zonedParts,
} = require('./whatsappAppointmentAvailabilityService');
const { normalizeTimezone, parseMinutes } = require('./whatsappOperatingHoursService');

const ACTIVE_FLOW_STATUSES = ['collecting', 'awaiting_confirmation', 'booking'];
const FLOW_TTL_MS = 24 * 60 * 60 * 1000;
const clean = (value) => (typeof value === 'string' ? value.trim() : '');
const digitsOnly = (value) => String(value || '').replace(/\D+/g, '');
const objectIdString = (value) => value ? String(value) : '';
const pad2 = (value) => String(value).padStart(2, '0');

const INTENT_LABELS = Object.freeze({
  appointment_unspecified: 'agendamento',
  veterinary_appointment: 'atendimento veterinário',
  grooming_appointment: 'banho e tosa',
});

const STEP_LABELS = Object.freeze({
  select_intent: 'escolher tipo de atendimento',
  select_service: 'escolher serviço',
  collect_customer_name: 'informar nome do cliente',
  select_pet: 'escolher pet',
  collect_pet_name: 'informar nome do pet',
  collect_pet_species: 'informar espécie do pet',
  collect_pet_breed: 'informar raça do pet',
  collect_pet_sex: 'informar sexo do pet',
  collect_pet_birthdate: 'informar idade do pet',
  collect_date: 'escolher data',
  select_slot: 'escolher horário',
  confirm: 'confirmar agendamento',
  booking: 'gravando agendamento',
  completed: 'agendamento confirmado',
  cancelled: 'agendamento interrompido',
  handoff: 'encaminhado para funcionário',
});

const mapFlow = (flow) => {
  if (!flow) return null;
  const data = flow.data || {};
  const selected = flow.selectedOption || data.selectedOption || null;
  return {
    id: objectIdString(flow._id),
    sessionId: flow.sessionId || '',
    status: flow.status || '',
    intent: flow.intent || '',
    intentLabel: INTENT_LABELS[flow.intent] || 'agendamento',
    step: flow.step || '',
    stepLabel: STEP_LABELS[flow.step] || flow.step || '',
    customerId: objectIdString(flow.customer),
    customerName: data.customerName || '',
    petId: objectIdString(flow.pet),
    petName: data.petName || '',
    serviceId: objectIdString(flow.service),
    serviceName: data.serviceName || '',
    appointmentId: objectIdString(flow.appointment),
    selectedDate: selected?.date || '',
    selectedTime: selected?.time || '',
    professionalName: selected?.professionalName || '',
    expiresAt: flow.expiresAt || null,
    updatedAt: flow.updatedAt || null,
  };
};

const detectAppointmentIntent = (message) => {
  const text = normalizeText(message);
  if (!text) return null;
  const emergency = /(emergenc|urgenc|nao respira|sem respirar|convuls|envenen|atropel|sangramento|desmai)/.test(text);
  if (emergency) return { kind: 'handoff', reason: 'possible_emergency' };
  const human = /(falar com (uma )?pessoa|falar com atendente|quero atendente|atendimento humano)/.test(text);
  if (human) return { kind: 'handoff', reason: 'requested_human' };
  const cancellation = /(cancelar|desmarcar|remarcar|alterar).*(consulta|atendimento|banho|tosa|horario|agendamento)/.test(text)
    || /(consulta|atendimento|banho|tosa|horario|agendamento).*(cancelar|desmarcar|remarcar|alterar)/.test(text);
  if (cancellation) return { kind: 'handoff', reason: 'change_existing_appointment' };
  const booking = /(agend|marcar|marca[cç][aã]o|horario|atendimento|consulta)/.test(text);
  if (!booking) return null;
  if (/(veterin|consulta|vacina|exame)/.test(text)) {
    return { kind: 'booking', intent: 'veterinary_appointment' };
  }
  if (/(banho|tosa|estetic)/.test(text)) {
    return { kind: 'booking', intent: 'grooming_appointment' };
  }
  return { kind: 'booking', intent: 'appointment_unspecified' };
};

const parseSelection = (message, max) => {
  const match = /^\s*(\d{1,2})(?:\D|$)/.exec(clean(message));
  if (!match) return null;
  const index = Number(match[1]) - 1;
  return index >= 0 && index < max ? index : null;
};

const parseRequestedDate = (message, { now = new Date(), timezone } = {}) => {
  const text = normalizeText(message);
  const today = zonedParts(now, timezone).dateKey;
  let date = '';
  if (/\bhoje\b/.test(text)) date = today;
  if (/\bamanha\b/.test(text)) date = addDays(today, 1);
  if (/\bdepois de amanha\b/.test(text)) date = addDays(today, 2);

  const iso = text.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (iso) date = `${iso[1]}-${pad2(iso[2])}-${pad2(iso[3])}`;

  const br = text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (br) {
    const currentYear = Number(today.slice(0, 4));
    let year = br[3] ? Number(br[3]) : currentYear;
    if (year < 100) year += 2000;
    date = `${year}-${pad2(br[2])}-${pad2(br[1])}`;
    if (!br[3] && date < today) {
      date = `${year + 1}-${pad2(br[2])}-${pad2(br[1])}`;
    }
  }

  const weekdays = [
    ['domingo', 0],
    ['segunda', 1],
    ['terca', 2],
    ['quarta', 3],
    ['quinta', 4],
    ['sexta', 5],
    ['sabado', 6],
  ];
  if (!date) {
    const requested = weekdays.find(([label]) => text.includes(label));
    if (requested) {
      const noon = new Date(`${today}T12:00:00.000Z`);
      const currentDay = noon.getUTCDay();
      let delta = (requested[1] - currentDay + 7) % 7;
      if (delta === 0) delta = 7;
      date = addDays(today, delta);
    }
  }

  const timeMatch = text.match(/\b(?:as|a|por volta de)?\s*(\d{1,2})(?::|h)(\d{2})?\b/);
  let preferredMinutes = null;
  if (timeMatch) {
    const hours = Number(timeMatch[1]);
    const minutes = Number(timeMatch[2] || 0);
    if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
      preferredMinutes = (hours * 60) + minutes;
    }
  }

  const parsed = date ? new Date(`${date}T12:00:00.000Z`) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) return null;
  const normalizedDate = [
    parsed.getUTCFullYear(),
    pad2(parsed.getUTCMonth() + 1),
    pad2(parsed.getUTCDate()),
  ].join('-');
  if (normalizedDate !== date || normalizedDate < today) return null;
  return { date, preferredMinutes };
};

const parsePetBirthDate = (message, now = new Date()) => {
  const text = normalizeText(message);
  const br = text.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (br) {
    const parsed = new Date(Date.UTC(Number(br[3]), Number(br[2]) - 1, Number(br[1]), 12));
    if (!Number.isNaN(parsed.getTime()) && parsed <= now) return parsed;
  }
  const years = text.match(/\b(\d{1,2})\s*ano/);
  if (years) {
    const parsed = new Date(now);
    parsed.setUTCFullYear(parsed.getUTCFullYear() - Number(years[1]));
    return parsed;
  }
  const months = text.match(/\b(\d{1,3})\s*(mes|meses)\b/);
  if (months) {
    const parsed = new Date(now);
    parsed.setUTCMonth(parsed.getUTCMonth() - Number(months[1]));
    return parsed;
  }
  return null;
};

const formatDate = (dateKey) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(clean(dateKey));
  return match ? `${match[3]}/${match[2]}/${match[1]}` : dateKey;
};

const listOptions = (items, mapper) => items
  .map((item, index) => `${index + 1}. ${mapper(item)}`)
  .join('\n');

const promptForFlow = (flow) => {
  const data = flow.data || {};
  if (flow.step === 'select_intent') {
    return 'Posso fazer o agendamento. Qual atendimento você precisa?\n1. Veterinário\n2. Banho ou tosa';
  }
  if (flow.step === 'select_service') {
    const services = Array.isArray(data.serviceOptions) ? data.serviceOptions : [];
    return `Qual serviço você deseja?\n${listOptions(services, (item) => item.name)}\nResponda com o número da opção.`;
  }
  if (flow.step === 'collect_customer_name') {
    return 'Para localizar ou criar seu cadastro, qual é o nome completo do responsável pelo pet?';
  }
  if (flow.step === 'select_pet') {
    const pets = Array.isArray(data.petOptions) ? data.petOptions : [];
    return `Para qual pet será o atendimento?\n${listOptions(pets, (item) => (
      `${item.name}${item.breed ? ` — ${item.breed}` : ''}`
    ))}\n${pets.length + 1}. Cadastrar outro pet\nResponda com o número da opção.`;
  }
  if (flow.step === 'collect_pet_name') {
    return 'Qual é o nome do pet?';
  }
  if (flow.step === 'collect_pet_species') {
    return `Qual é a espécie de ${data.petName || 'seu pet'}? Ex.: cachorro, gato ou ave.`;
  }
  if (flow.step === 'collect_pet_breed') {
    return `Qual é a raça de ${data.petName || 'seu pet'}?`;
  }
  if (flow.step === 'collect_pet_sex') {
    return `${data.petName || 'O pet'} é macho ou fêmea?`;
  }
  if (flow.step === 'collect_pet_birthdate') {
    return 'Informe a data de nascimento ou a idade aproximada do pet. Ex.: 15/03/2022, 3 anos ou 8 meses.';
  }
  if (flow.step === 'collect_date') {
    return 'Qual data você prefere? Você pode responder, por exemplo, “amanhã”, “25/07” ou “segunda às 14h”.';
  }
  if (flow.step === 'select_slot') {
    return `Encontrei estes horários:\n${listOptions(flow.options || [], (item) => (
      `${formatDate(item.date)} às ${item.time} — ${item.professionalName}`
    ))}\nResponda com o número do horário desejado.`;
  }
  if (flow.step === 'confirm') {
    const option = flow.selectedOption || {};
    return [
      'Confirme os dados do agendamento:',
      `Serviço: ${data.serviceName || 'Serviço'}`,
      `Pet: ${data.petName || 'Pet'}`,
      `Data: ${formatDate(option.date)} às ${option.time}`,
      `Profissional: ${option.professionalName || 'Equipe disponível'}`,
      '',
      'Responda SIM para confirmar ou NÃO para cancelar.',
    ].join('\n');
  }
  if (flow.step === 'booking') {
    return 'Estou finalizando o agendamento. Aguarde um instante.';
  }
  return '';
};

const touchFlow = (flow, messageId, messageAt) => {
  flow.lastInboundMessageId = clean(messageId);
  flow.lastInboundAt = messageAt || new Date();
  flow.expiresAt = new Date((messageAt || new Date()).getTime() + FLOW_TTL_MS);
  flow.markModified('data');
};

const chooseNextIdentityStep = (flow) => {
  const data = flow.data || {};
  if (!flow.service) {
    flow.step = 'select_service';
    return;
  }
  if (!flow.customer && !clean(data.customerName)) {
    flow.step = 'collect_customer_name';
    return;
  }
  if (flow.pet) {
    flow.step = 'collect_date';
    return;
  }
  if (Array.isArray(data.petOptions) && data.petOptions.length) {
    flow.step = 'select_pet';
    return;
  }
  if (!clean(data.petName)) {
    flow.step = 'collect_pet_name';
    return;
  }
  if (!clean(data.petSpecies)) {
    flow.step = 'collect_pet_species';
    return;
  }
  if (!clean(data.petBreed)) {
    flow.step = 'collect_pet_breed';
    return;
  }
  if (!clean(data.petSex)) {
    flow.step = 'collect_pet_sex';
    return;
  }
  if (!data.petBirthDate) {
    flow.step = 'collect_pet_birthdate';
    return;
  }
  flow.step = 'collect_date';
};

const loadCustomerContext = async (flow) => {
  const customer = await findCustomerByWhatsapp({
    storeId: flow.store,
    waId: flow.waId,
  });
  if (!customer) return;
  flow.customer = customer._id;
  flow.data = {
    ...(flow.data || {}),
    customerName:
      customer.nomeCompleto
      || customer.nomeContato
      || customer.razaoSocial
      || '',
  };
  const pets = await getPetList(customer._id);
  if (pets.length === 1) {
    flow.pet = pets[0]._id;
    flow.data.petName = pets[0].nome;
    flow.data.petSpecies = pets[0].tipo;
    flow.data.petBreed = pets[0].raca;
    flow.data.petSex = pets[0].sexo;
    flow.data.petBirthDate = pets[0].dataNascimento;
    flow.data.petOptions = [];
  } else if (pets.length > 1) {
    flow.data.petOptions = pets.slice(0, 8).map((pet) => ({
      id: String(pet._id),
      name: pet.nome,
      species: pet.tipo,
      breed: pet.raca,
      sex: pet.sexo,
      birthDate: pet.dataNascimento,
    }));
  }
};

const loadServices = async (flow, message) => {
  if (flow.intent === 'appointment_unspecified') {
    flow.step = 'select_intent';
    return;
  }
  const { services, exact } = await findServicesForIntent({
    intent: flow.intent,
    message,
  });
  if (!services.length) {
    flow.status = 'handoff';
    flow.step = 'handoff';
    flow.handoffReason = 'service_not_configured';
    return;
  }
  const selected = exact || (services.length === 1 ? services[0] : null);
  flow.data = {
    ...(flow.data || {}),
    serviceOptions: services.slice(0, 8).map((service) => ({
      id: String(service._id),
      name: service.nome,
      duration: Number(service.duracaoMinutos) || 30,
    })),
  };
  if (selected) {
    flow.service = selected._id;
    flow.data.serviceName = selected.nome;
    flow.data.serviceDuration = Number(selected.duracaoMinutos) || 30;
  }
};

const createFlow = async ({
  storeId,
  phoneNumberId,
  waId,
  conversation,
  intent,
  message,
  messageId,
  messageAt,
}) => {
  const flow = new WhatsappAppointmentFlow({
    store: storeId,
    phoneNumberId,
    waId,
    conversation: conversation._id,
    sessionId: crypto.randomUUID(),
    status: 'collecting',
    intent,
    step: intent === 'appointment_unspecified' ? 'select_intent' : 'select_service',
    data: {},
    lastInboundMessageId: clean(messageId),
    lastInboundAt: messageAt,
    expiresAt: new Date(messageAt.getTime() + FLOW_TTL_MS),
  });
  await Promise.all([
    loadServices(flow, message),
    loadCustomerContext(flow),
  ]);
  if (flow.status === 'collecting') chooseNextIdentityStep(flow);
  touchFlow(flow, messageId, messageAt);
  await flow.save();
  return flow;
};

const materializeCustomer = async (flow) => {
  if (flow.customer) {
    const existing = await User.findOne({ _id: flow.customer, role: 'cliente' });
    if (existing) return existing;
  }
  const matched = await findCustomerByWhatsapp({
    storeId: flow.store,
    waId: flow.waId,
  });
  if (matched) {
    flow.customer = matched._id;
    await flow.save();
    return User.findById(matched._id);
  }

  const customerName = clean(flow.data?.customerName);
  if (!customerName) throw new Error('Nome do cliente não foi informado.');
  const suffix = flow.sessionId.replace(/-/g, '').slice(0, 10);
  const email = `whatsapp.${String(flow.store)}.${suffix}@eobicho.local`;
  const password = crypto.randomBytes(18).toString('base64url');
  const senha = await bcrypt.hash(password, 10);
  const sequenceKey = customerSequenceKey();
  const lastCustomer = await User.findOne({
    codigoCliente: { $type: 'number' },
  }).select('codigoCliente').sort({ codigoCliente: -1 }).lean();
  await ensureScopedSequenceAtLeast({
    ...sequenceKey,
    value: Number(lastCustomer?.codigoCliente) || 0,
  });
  const codigoCliente = await nextScopedSequence(sequenceKey);
  try {
    const customer = await User.create({
      tipoConta: 'pessoa_fisica',
      email,
      senha,
      celular: digitsOnly(flow.waId),
      nomeCompleto: customerName,
      role: 'cliente',
      empresas: [flow.store],
      empresaPrincipal: flow.store,
      codigoCliente,
      pais: 'Brasil',
    });
    flow.customer = customer._id;
    await flow.save();
    return customer;
  } catch (error) {
    if (error?.code === 11000 && (error?.keyPattern?.celular || error?.keyValue?.celular)) {
      const retry = await findCustomerByWhatsapp({
        storeId: flow.store,
        waId: flow.waId,
      });
      if (retry) {
        flow.customer = retry._id;
        await flow.save();
        return User.findById(retry._id);
      }
    }
    throw error;
  }
};

const materializePet = async (flow, customer) => {
  if (flow.pet) {
    const existing = await Pet.findOne({
      _id: flow.pet,
      owner: customer._id,
      obito: { $ne: true },
    });
    if (existing) return existing;
  }
  const data = flow.data || {};
  const pet = await Pet.create({
    owner: customer._id,
    nome: clean(data.petName),
    tipo: clean(data.petSpecies),
    raca: clean(data.petBreed),
    sexo: clean(data.petSex),
    dataNascimento: new Date(data.petBirthDate),
    porte: clean(data.petSize),
  });
  flow.pet = pet._id;
  await flow.save();
  return pet;
};

const buildConfirmation = ({ flow, appointment }) => {
  const data = flow.data || {};
  const option = flow.selectedOption || {};
  return [
    'Agendamento confirmado com sucesso! ✅',
    `Serviço: ${data.serviceName || 'Serviço'}`,
    `Pet: ${data.petName || 'Pet'}`,
    `Data: ${formatDate(option.date)} às ${option.time}`,
    `Profissional: ${option.professionalName || 'Equipe disponível'}`,
    `Código: ${String(appointment._id).slice(-8).toUpperCase()}`,
  ].join('\n');
};

const buildHandoffMessage = (reason, fallback) => {
  if (reason === 'possible_emergency') {
    return 'Identifiquei que pode ser uma urgência. Não vou tentar diagnosticar por mensagem. Procure atendimento veterinário imediato e aguarde nossa equipe assumir esta conversa.';
  }
  if (reason === 'change_existing_appointment') {
    return 'Para alterar, remarcar ou cancelar um atendimento existente, vou encaminhar você para nossa equipe.';
  }
  if (reason === 'service_not_configured') {
    return 'Não encontrei um serviço configurado para concluir esse agendamento. Vou encaminhar a conversa para nossa equipe.';
  }
  return clean(fallback) || 'Vou encaminhar sua conversa para nossa equipe continuar o atendimento.';
};

const recordFlowAudit = async ({ flow, action, userId, previousState, extra }) => {
  await WhatsappAuditEvent.create({
    store: flow.store,
    phoneNumberId: flow.phoneNumberId,
    waId: flow.waId,
    conversation: flow.conversation,
    user: userId || null,
    action,
    previousState: previousState || null,
    nextState: {
      appointmentFlow: mapFlow(flow),
      ...(extra || {}),
    },
  });
};

const updateConversationForFlow = async ({
  flow,
  reply,
  runAt,
  messageId,
  io,
  finalMode = '',
}) => {
  const now = new Date();
  const delayed = runAt && new Date(runAt) > now;
  const isHandoff = flow.status === 'handoff';
  const status = isHandoff ? 'NEEDS_HUMAN' : delayed ? 'WAITING_HUMAN' : 'BOT_ACTIVE';
  const mapped = mapFlow(flow);
  const conversation = await WhatsappConversation.findOneAndUpdate(
    { _id: flow.conversation },
    {
      $set: {
        status,
        serviceMode: isHandoff ? 'waiting' : delayed ? 'waiting' : 'automation',
        intent: flow.intent,
        flow: 'appointment_booking',
        flowState: flow.step,
        flowData: mapped,
        botEligibleAt: delayed ? runAt : null,
        ...(flow.customer ? { customer: flow.customer } : {}),
        ...(isHandoff ? { priority: 90 } : {}),
      },
      $addToSet: {
        labels: isHandoff
          ? { $each: ['agendamento_whatsapp', 'precisa_atendimento_humano'] }
          : 'agendamento_whatsapp',
      },
      $inc: { version: 1 },
    },
    { new: true }
  );

  await WhatsappAutomationJob.updateMany(
    {
      conversation: flow.conversation,
      status: { $in: ['pending', 'processing'] },
      type: { $in: ['human_grace_timeout', 'appointment_flow_reply'] },
    },
    {
      $set: {
        status: 'cancelled',
        cancelledAt: now,
        lastError: 'Substituído por etapa do agendamento conversacional',
        leaseUntil: null,
        lockedAt: null,
        lockedBy: '',
      },
    }
  );

  const replyKey = clean(messageId) || `${flow.sessionId}:${flow.updatedAt?.getTime?.() || now.getTime()}`;
  await WhatsappAutomationJob.findOneAndUpdate(
    {
      idempotencyKey: [
        'appointment_flow_reply',
        String(flow.store),
        flow.phoneNumberId,
        flow.sessionId,
        replyKey,
      ].join(':'),
    },
    {
      $setOnInsert: {
        store: flow.store,
        phoneNumberId: flow.phoneNumberId,
        waId: flow.waId,
        conversation: flow.conversation,
        type: 'appointment_flow_reply',
        status: 'pending',
        runAt: runAt || now,
        payload: {
          flowId: String(flow._id),
          sessionId: flow.sessionId,
          expectedInboundMessageId: clean(messageId),
          reply,
          flowStatus: flow.status,
          flowStep: flow.step,
          appointmentId: objectIdString(flow.appointment),
          finalMode,
        },
        idempotencyKey: [
          'appointment_flow_reply',
          String(flow.store),
          flow.phoneNumberId,
          flow.sessionId,
          replyKey,
        ].join(':'),
        attempts: 0,
        maxAttempts: 5,
      },
    },
    { upsert: true, new: true }
  );

  if (io && conversation) {
    const { emitConversationState } = require('./whatsappConversationService');
    emitConversationState(io, conversation, { appointmentFlow: mapped });
  }
  return conversation;
};

const handoffFlow = async ({
  flow,
  reason,
  config,
  messageId,
  messageAt,
  io,
}) => {
  const previous = mapFlow(flow);
  flow.status = 'handoff';
  flow.step = 'handoff';
  flow.handoffReason = reason;
  touchFlow(flow, messageId, messageAt);
  await flow.save();
  const reply = buildHandoffMessage(reason, config?.fallbackMessage);
  flow.lastPrompt = reply;
  await flow.save();
  await updateConversationForFlow({
    flow,
    reply,
    runAt: new Date(),
    messageId,
    io,
    finalMode: 'handoff',
  });
  await recordFlowAudit({
    flow,
    action: 'appointment_flow_handoff',
    previousState: previous,
    extra: { reason },
  });
  return { handled: true, flow, reply, handoff: true };
};

const cancelFlow = async ({
  flow,
  messageId,
  messageAt = new Date(),
  io,
  userId,
  reason = 'customer_cancelled',
}) => {
  const previous = mapFlow(flow);
  flow.status = 'cancelled';
  flow.step = 'cancelled';
  flow.cancelledAt = messageAt;
  flow.handoffReason = reason;
  touchFlow(flow, messageId, messageAt);
  await flow.save();
  const reply = 'Tudo bem, interrompi este agendamento. Se precisar, é só enviar uma nova mensagem.';
  flow.lastPrompt = reply;
  await flow.save();
  await updateConversationForFlow({
    flow,
    reply,
    runAt: new Date(),
    messageId,
    io,
    finalMode: 'close',
  });
  await recordFlowAudit({
    flow,
    action: 'appointment_flow_cancelled',
    userId,
    previousState: previous,
    extra: { reason },
  });
  return { handled: true, flow, reply, cancelled: true };
};

const advanceFlow = async ({ flow, message, messageId, messageAt, config, io }) => {
  const text = clean(message);
  const normalized = normalizeText(text);
  const previous = mapFlow(flow);

  if (/^(cancelar|cancela|parar|encerrar|desistir|nao quero)\b/.test(normalized)) {
    return cancelFlow({ flow, messageId, messageAt, io });
  }
  if (/(falar com (uma )?pessoa|falar com atendente|quero atendente|atendimento humano)/.test(normalized)) {
    return handoffFlow({
      flow,
      reason: 'requested_human',
      config,
      messageId,
      messageAt,
      io,
    });
  }
  if (/(emergenc|urgenc|nao respira|sem respirar|convuls|envenen|atropel|sangramento|desmai)/.test(normalized)) {
    return handoffFlow({
      flow,
      reason: 'possible_emergency',
      config,
      messageId,
      messageAt,
      io,
    });
  }

  if (flow.status === 'booking') {
    const reply = promptForFlow(flow);
    await updateConversationForFlow({
      flow,
      reply,
      runAt: new Date(),
      messageId,
      io,
    });
    return { handled: true, flow, reply };
  }

  if (flow.step === 'select_intent') {
    const selection = parseSelection(text, 2);
    if (selection === null) {
      if (/(veterin|consulta|vacina|exame)/.test(normalized)) {
        flow.intent = 'veterinary_appointment';
      } else if (/(banho|tosa|estetic)/.test(normalized)) {
        flow.intent = 'grooming_appointment';
      } else {
        touchFlow(flow, messageId, messageAt);
        await flow.save();
        return { handled: true, flow, reply: promptForFlow(flow) };
      }
    } else {
      flow.intent = selection === 0
        ? 'veterinary_appointment'
        : 'grooming_appointment';
    }
    await loadServices(flow, text);
    if (flow.status === 'handoff') {
      return handoffFlow({
        flow,
        reason: flow.handoffReason,
        config,
        messageId,
        messageAt,
        io,
      });
    }
    chooseNextIdentityStep(flow);
  } else if (flow.step === 'select_service') {
    const services = Array.isArray(flow.data?.serviceOptions)
      ? flow.data.serviceOptions
      : [];
    const index = parseSelection(text, services.length);
    const byName = services.find((service) => (
      normalizeText(service.name).length >= 3
      && normalized.includes(normalizeText(service.name))
    ));
    const selected = index === null ? byName : services[index];
    if (!selected) {
      touchFlow(flow, messageId, messageAt);
      await flow.save();
      return {
        handled: true,
        flow,
        reply: `Não reconheci a opção.\n${promptForFlow(flow)}`,
      };
    }
    const service = await Service.findOne({
      _id: selected.id,
      ativo: { $ne: false },
    }).select('_id nome duracaoMinutos').lean();
    if (!service) {
      return handoffFlow({
        flow,
        reason: 'service_not_configured',
        config,
        messageId,
        messageAt,
        io,
      });
    }
    flow.service = service._id;
    flow.data.serviceName = service.nome;
    flow.data.serviceDuration = Number(service.duracaoMinutos) || 30;
    chooseNextIdentityStep(flow);
  } else if (flow.step === 'collect_customer_name') {
    if (text.length < 3 || !/[a-zA-ZÀ-ÿ]/.test(text)) {
      touchFlow(flow, messageId, messageAt);
      await flow.save();
      return {
        handled: true,
        flow,
        reply: 'Preciso do nome completo do responsável para continuar.',
      };
    }
    flow.data.customerName = text.slice(0, 120);
    chooseNextIdentityStep(flow);
  } else if (flow.step === 'select_pet') {
    const pets = Array.isArray(flow.data?.petOptions) ? flow.data.petOptions : [];
    const selection = parseSelection(text, pets.length + 1);
    if (selection === null) {
      touchFlow(flow, messageId, messageAt);
      await flow.save();
      return {
        handled: true,
        flow,
        reply: `Não reconheci a opção.\n${promptForFlow(flow)}`,
      };
    }
    if (selection === pets.length) {
      flow.pet = null;
      flow.data.petName = '';
      flow.data.petSpecies = '';
      flow.data.petBreed = '';
      flow.data.petSex = '';
      flow.data.petBirthDate = null;
      flow.data.petOptions = [];
      flow.step = 'collect_pet_name';
    } else {
      const pet = pets[selection];
      flow.pet = pet.id;
      flow.data.petName = pet.name;
      flow.data.petSpecies = pet.species;
      flow.data.petBreed = pet.breed;
      flow.data.petSex = pet.sex;
      flow.data.petBirthDate = pet.birthDate;
      flow.step = 'collect_date';
    }
  } else if (flow.step === 'collect_pet_name') {
    if (text.length < 2) {
      touchFlow(flow, messageId, messageAt);
      await flow.save();
      return { handled: true, flow, reply: 'Informe o nome do pet para continuar.' };
    }
    flow.data.petName = text.slice(0, 80);
    chooseNextIdentityStep(flow);
  } else if (flow.step === 'collect_pet_species') {
    if (text.length < 2) {
      touchFlow(flow, messageId, messageAt);
      await flow.save();
      return { handled: true, flow, reply: promptForFlow(flow) };
    }
    flow.data.petSpecies = text.slice(0, 60);
    chooseNextIdentityStep(flow);
  } else if (flow.step === 'collect_pet_breed') {
    if (text.length < 2) {
      touchFlow(flow, messageId, messageAt);
      await flow.save();
      return { handled: true, flow, reply: promptForFlow(flow) };
    }
    flow.data.petBreed = text.slice(0, 80);
    chooseNextIdentityStep(flow);
  } else if (flow.step === 'collect_pet_sex') {
    if (/\bmacho\b/.test(normalized)) flow.data.petSex = 'Macho';
    if (/\bfemea\b/.test(normalized)) flow.data.petSex = 'Fêmea';
    if (!flow.data.petSex) {
      touchFlow(flow, messageId, messageAt);
      await flow.save();
      return { handled: true, flow, reply: 'Responda “macho” ou “fêmea” para continuar.' };
    }
    chooseNextIdentityStep(flow);
  } else if (flow.step === 'collect_pet_birthdate') {
    const birthDate = parsePetBirthDate(text, messageAt);
    if (!birthDate) {
      touchFlow(flow, messageId, messageAt);
      await flow.save();
      return {
        handled: true,
        flow,
        reply: 'Não consegui entender a idade. Informe, por exemplo, “3 anos”, “8 meses” ou “15/03/2022”.',
      };
    }
    flow.data.petBirthDate = birthDate.toISOString();
    chooseNextIdentityStep(flow);
  } else if (flow.step === 'collect_date') {
    const requested = parseRequestedDate(text, {
      now: messageAt,
      timezone: config.timezone,
    });
    if (!requested) {
      touchFlow(flow, messageId, messageAt);
      await flow.save();
      return {
        handled: true,
        flow,
        reply: 'Não consegui identificar a data. Envie no formato 25/07, “amanhã” ou “segunda às 14h”.',
      };
    }
    const options = await findAvailableSlots({
      storeId: flow.store,
      serviceId: flow.service,
      intent: flow.intent,
      startDate: requested.date,
      preferredMinutes: requested.preferredMinutes,
      config,
      now: messageAt,
      excludeFlowId: flow._id,
    });
    flow.data.preferredDate = requested.date;
    flow.data.preferredMinutes = requested.preferredMinutes;
    flow.options = options;
    flow.selectedOption = null;
    if (!options.length) {
      flow.step = 'collect_date';
      touchFlow(flow, messageId, messageAt);
      await flow.save();
      return {
        handled: true,
        flow,
        reply: `Não encontrei horário disponível a partir de ${formatDate(requested.date)}. Informe outra data para eu consultar.`,
      };
    }
    flow.step = 'select_slot';
  } else if (flow.step === 'select_slot') {
    const options = Array.isArray(flow.options) ? flow.options : [];
    const selection = parseSelection(text, options.length);
    if (selection === null) {
      touchFlow(flow, messageId, messageAt);
      await flow.save();
      return {
        handled: true,
        flow,
        reply: `Não reconheci o horário.\n${promptForFlow(flow)}`,
      };
    }
    flow.selectedOption = options[selection];
    flow.status = 'awaiting_confirmation';
    flow.step = 'confirm';
  } else if (flow.step === 'confirm') {
    const confirmed = /^(sim|s|confirmo|confirmar|pode confirmar|1)\b/.test(normalized);
    const denied = /^(nao|n|cancelar|cancela|2)\b/.test(normalized);
    if (denied) return cancelFlow({ flow, messageId, messageAt, io });
    if (!confirmed) {
      touchFlow(flow, messageId, messageAt);
      await flow.save();
      return {
        handled: true,
        flow,
        reply: 'Responda SIM para confirmar ou NÃO para cancelar este agendamento.',
      };
    }

    const claimed = await WhatsappAppointmentFlow.findOneAndUpdate(
      {
        _id: flow._id,
        status: 'awaiting_confirmation',
        step: 'confirm',
      },
      {
        $set: {
          status: 'booking',
          step: 'booking',
          lastInboundMessageId: clean(messageId),
          lastInboundAt: messageAt,
        },
      },
      { new: true }
    );
    if (!claimed) {
      const current = await WhatsappAppointmentFlow.findById(flow._id);
      if (current?.status === 'completed' && current.appointment) {
        return {
          handled: true,
          flow: current,
          reply: 'Este agendamento já foi confirmado.',
        };
      }
      return {
        handled: true,
        flow: current || flow,
        reply: 'Este agendamento já está sendo processado.',
      };
    }
    flow = claimed;
    try {
      const customer = await materializeCustomer(flow);
      const pet = await materializePet(flow, customer);
      const result = await createAppointmentFromFlow({
        flow,
        customerId: customer._id,
        petId: pet._id,
        serviceId: flow.service,
        option: flow.selectedOption,
        intent: flow.intent,
        config,
      });
      flow.customer = customer._id;
      flow.pet = pet._id;
      flow.appointment = result.appointment._id;
      flow.status = 'completed';
      flow.step = 'completed';
      flow.completedAt = new Date();
      flow.lastError = '';
      touchFlow(flow, messageId, messageAt);
      await flow.save();
      const reply = buildConfirmation({
        flow,
        appointment: result.appointment,
      });
      flow.lastPrompt = reply;
      await flow.save();
      await updateConversationForFlow({
        flow,
        reply,
        runAt: new Date(),
        messageId,
        io,
        finalMode: 'close',
      });
      await recordFlowAudit({
        flow,
        action: 'appointment_flow_completed',
        previousState: previous,
        extra: {
          appointmentId: String(result.appointment._id),
          replayed: result.replayed,
        },
      });
      return {
        handled: true,
        flow,
        reply,
        appointment: result.appointment,
        completed: true,
      };
    } catch (error) {
      if (error?.code === 'APPOINTMENT_SLOT_UNAVAILABLE') {
        const options = await findAvailableSlots({
          storeId: flow.store,
          serviceId: flow.service,
          intent: flow.intent,
          startDate: flow.data?.preferredDate,
          preferredMinutes: flow.data?.preferredMinutes,
          config,
          now: messageAt,
          excludeFlowId: flow._id,
        });
        flow.status = 'collecting';
        flow.selectedOption = null;
        flow.options = options;
        flow.step = options.length ? 'select_slot' : 'collect_date';
        flow.lastError = error.message;
        touchFlow(flow, messageId, messageAt);
        await flow.save();
        const reply = options.length
          ? `Esse horário acabou de ser ocupado. Separei novas opções:\n${promptForFlow(flow)}`
          : 'Esse horário acabou de ser ocupado. Informe outra data para eu consultar novamente.';
        await updateConversationForFlow({
          flow,
          reply,
          runAt: new Date(),
          messageId,
          io,
        });
        return { handled: true, flow, reply, conflict: true };
      }
      flow.status = 'failed';
      flow.step = 'handoff';
      flow.lastError = clean(error?.message) || 'Falha ao criar agendamento';
      flow.handoffReason = 'booking_failed';
      await flow.save();
      return handoffFlow({
        flow,
        reason: 'booking_failed',
        config,
        messageId,
        messageAt,
        io,
      });
    }
  }

  touchFlow(flow, messageId, messageAt);
  await flow.save();
  const reply = flow.status === 'handoff'
    ? buildHandoffMessage(flow.handoffReason, config.fallbackMessage)
    : promptForFlow(flow);
  flow.lastPrompt = reply;
  await flow.save();
  await recordFlowAudit({
    flow,
    action: 'appointment_flow_advanced',
    previousState: previous,
  });
  return { handled: true, flow, reply };
};

const processAppointmentInbound = async ({
  storeId,
  phoneNumberId,
  waId,
  messageId,
  messageAt = new Date(),
  message,
  transition,
  io,
}) => {
  const customerWaId = digitsOnly(waId);
  const phone = clean(phoneNumberId);
  const body = clean(message);
  if (!storeId || !phone || !customerWaId || !body) return { handled: false };

  const config = await WhatsappAutomationConfig.findOne({
    store: storeId,
    phoneNumberId: phone,
  });
  if (!config?.enabled || config.paused || !config.appointmentEnabled) {
    return { handled: false };
  }

  const now = messageAt instanceof Date ? messageAt : new Date(messageAt);
  await WhatsappAppointmentFlow.updateMany(
    {
      store: storeId,
      phoneNumberId: phone,
      waId: customerWaId,
      status: { $in: ACTIVE_FLOW_STATUSES },
      expiresAt: { $lte: now },
    },
    { $set: { status: 'expired', step: 'expired' } }
  );
  let flow = await WhatsappAppointmentFlow.findOne({
    store: storeId,
    phoneNumberId: phone,
    waId: customerWaId,
    status: { $in: ACTIVE_FLOW_STATUSES },
    expiresAt: { $gt: now },
  }).sort({ updatedAt: -1 });

  const detected = detectAppointmentIntent(body);
  if (!flow && !detected) return { handled: false };

  const conversation = transition?.conversation || await WhatsappConversation.findOne({
    store: storeId,
    phoneNumberId: phone,
    waId: customerWaId,
  });
  if (!conversation) return { handled: false };

  if (!flow && detected?.kind === 'handoff') {
    flow = new WhatsappAppointmentFlow({
      store: storeId,
      phoneNumberId: phone,
      waId: customerWaId,
      conversation: conversation._id,
      sessionId: crypto.randomUUID(),
      status: 'collecting',
      intent: 'appointment_unspecified',
      step: 'handoff',
      data: {},
      lastInboundMessageId: clean(messageId),
      lastInboundAt: now,
      expiresAt: new Date(now.getTime() + FLOW_TTL_MS),
    });
    await flow.save();
    return handoffFlow({
      flow,
      reason: detected.reason,
      config,
      messageId,
      messageAt: now,
      io,
    });
  }

  const isNewFlow = !flow;
  if (!flow) {
    flow = await createFlow({
      storeId,
      phoneNumberId: phone,
      waId: customerWaId,
      conversation,
      intent: detected.intent,
      message: body,
      messageId,
      messageAt: now,
    });
    if (flow.status === 'handoff') {
      return handoffFlow({
        flow,
        reason: flow.handoffReason,
        config,
        messageId,
        messageAt: now,
        io,
      });
    }
  }

  const result = isNewFlow
    ? { handled: true, flow, reply: promptForFlow(flow) }
    : await advanceFlow({
        flow,
        message: body,
        messageId,
        messageAt: now,
        config,
        io,
      });
  if (
    result.cancelled
    || result.handoff
    || result.completed
    || result.conflict
    || result.flow?.status === 'booking'
  ) {
    return result;
  }

  let reply = result.reply || promptForFlow(result.flow);
  const firstReplyOutsideHours = isNewFlow && transition?.hours?.isOpen === false;
  if (firstReplyOutsideHours && clean(config.afterHoursMessage)) {
    reply = `${clean(config.afterHoursMessage)}\n\n${reply}`;
  }
  result.flow.lastPrompt = reply;
  await result.flow.save();
  const runAt = isNewFlow && transition?.hours?.isOpen !== false
    ? (conversation.botEligibleAt || new Date())
    : new Date();
  await updateConversationForFlow({
    flow: result.flow,
    reply,
    runAt,
    messageId,
    io,
  });
  return { ...result, reply, runAt };
};

const cancelActiveAppointmentFlows = async ({
  conversationId,
  reason = 'human_takeover',
  userId,
}) => {
  if (!conversationId) return 0;
  const flows = await WhatsappAppointmentFlow.find({
    conversation: conversationId,
    status: { $in: ACTIVE_FLOW_STATUSES },
  });
  if (!flows.length) return 0;
  const now = new Date();
  await WhatsappAppointmentFlow.updateMany(
    { _id: { $in: flows.map((flow) => flow._id) } },
    {
      $set: {
        status: 'handoff',
        step: 'handoff',
        handoffReason: clean(reason),
        cancelledAt: now,
      },
    }
  );
  await Promise.all(flows.map((flow) => recordFlowAudit({
    flow: {
      ...flow.toObject(),
      status: 'handoff',
      step: 'handoff',
      handoffReason: clean(reason),
    },
    action: 'appointment_flow_interrupted_by_human',
    userId,
    previousState: mapFlow(flow),
    extra: { reason },
  })));
  return flows.length;
};

const getAppointmentFlowStats = async ({ storeId, phoneNumberId }) => {
  const rows = await WhatsappAppointmentFlow.aggregate([
    {
      $match: {
        store: typeof storeId === 'string'
          ? new mongoose.Types.ObjectId(storeId)
          : storeId,
        phoneNumberId,
      },
    },
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]);
  const byStatus = Object.fromEntries(rows.map((row) => [row._id, row.count]));
  return {
    byStatus,
    active:
      Number(byStatus.collecting || 0)
      + Number(byStatus.awaiting_confirmation || 0)
      + Number(byStatus.booking || 0),
    completed: Number(byStatus.completed || 0),
    handoff: Number(byStatus.handoff || 0) + Number(byStatus.failed || 0),
  };
};

module.exports = {
  ACTIVE_FLOW_STATUSES,
  cancelActiveAppointmentFlows,
  cancelFlow,
  detectAppointmentIntent,
  getAppointmentFlowStats,
  mapFlow,
  parsePetBirthDate,
  parseRequestedDate,
  processAppointmentInbound,
};
