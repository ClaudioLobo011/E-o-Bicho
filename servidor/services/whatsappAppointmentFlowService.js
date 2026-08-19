const bcrypt = require('bcryptjs');
const { normalizeBrazilPhone } = require('../utils/customerIdentity');
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
  findAvailableGroupSlots,
  findAvailableSeparateSlots,
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
  collect_pet_services: 'definir serviços de cada pet',
  select_pet_service_detail: 'detalhar serviço do pet',
  collect_group_preference: 'definir se os pets podem ficar juntos',
  collect_professional_preference: 'informar preferência de profissional',
  collect_pet_name: 'informar nome do pet',
  collect_pet_species: 'informar espécie do pet',
  collect_pet_breed: 'informar raça do pet',
  collect_pet_sex: 'informar sexo do pet',
  collect_pet_birthdate: 'informar idade do pet',
  collect_date: 'escolher data',
  select_slot: 'escolher horário',
  select_group_slot: 'escolher horário dos pets',
  select_professional_preference: 'escolher preferência de profissional',
  confirm: 'confirmar agendamento',
  confirm_group: 'confirmar agendamentos',
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
    pets: Array.isArray(data.selectedPets) ? data.selectedPets : [],
    appointmentIds: Array.isArray(data.appointmentIds) ? data.appointmentIds : [],
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

const selectedPets = (flow) => {
  const data = flow.data || {};
  if (Array.isArray(data.selectedPets) && data.selectedPets.length) return data.selectedPets;
  if (flow.pet && data.petName) {
    return [{
      id: String(flow.pet),
      name: data.petName,
      species: data.petSpecies || '',
      breed: data.petBreed || '',
      sex: data.petSex || '',
      birthDate: data.petBirthDate || null,
      size: data.petSize || '',
    }];
  }
  return [];
};

const petDisplay = (pet) => `${pet.name}${pet.species ? ` (${pet.species})` : ''}`;

const hasMixedDogAndCat = (pets) => {
  const species = pets.map((pet) => normalizeText(pet.species));
  return species.some((value) => /(cao|cachorr)/.test(value))
    && species.some((value) => /(gato|felin)/.test(value));
};

const shortEditSimilarity = (left, right) => {
  const a = normalizeText(left);
  const b = normalizeText(right);
  if (!a || !b) return 0;
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let row = 1; row <= a.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= b.length; column += 1) {
      current[column] = Math.min(
        previous[column] + 1,
        current[column - 1] + 1,
        previous[column - 1] + (a[row - 1] === b[column - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return 1 - (previous[b.length] / Math.max(a.length, b.length));
};

const parseNamedPets = (message, pets) => {
  const normalized = normalizeText(message);
  if (/\btod[oa]s?(?:\s+os|\s+as)?(?:\s+pets|\s+animais)?\b/.test(normalized)) {
    return [...pets];
  }
  return pets.filter((pet) => {
    const name = normalizeText(pet.name);
    if (!name) return false;
    if (normalized.includes(name)) return true;
    return normalized.split(/\s+/).some((token) => (
      token.length >= 3
      && name.length >= 3
      && (
        token.startsWith(name)
        || name.startsWith(token)
        || shortEditSimilarity(token, name) >= 0.72
      )
    ));
  });
};

const applySelectedPets = (flow, pets) => {
  const chosen = Array.isArray(pets) ? pets.filter(Boolean) : [];
  if (!chosen.length) return false;
  flow.data.selectedPets = chosen.map((pet) => ({ ...pet }));
  flow.pet = chosen.length === 1 ? chosen[0].id : null;
  if (chosen.length === 1) {
    const [pet] = chosen;
    flow.data.petName = pet.name;
    flow.data.petSpecies = pet.species;
    flow.data.petBreed = pet.breed;
    flow.data.petSex = pet.sex;
    flow.data.petBirthDate = pet.birthDate;
    flow.data.petSize = pet.size || '';
  }
  return true;
};

const inferRequestedServiceKind = (message) => {
  const normalized = normalizeText(message);
  const hasBath = /\bbanho\b/.test(normalized);
  const hasGrooming = /\btosa\b|\btosar\b/.test(normalized);
  if (hasBath && hasGrooming) return 'banho_tosa';
  if (hasGrooming) return 'tosa';
  if (hasBath) return 'banho';
  return '';
};

const inferPetServiceKind = (message, pet, allPets) => {
  const normalized = normalizeText(message);
  const name = normalizeText(pet.name);
  const alias = normalized.split(/\s+/).find((token) => (
    token === name || shortEditSimilarity(token, name) >= 0.72
  )) || name;
  const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const before = new RegExp(`(banho(?:\\s+e\\s+tosa)?|tosa)[^,.!?]{0,55}\\b${escaped}\\b`);
  const after = new RegExp(`\\b${escaped}\\b[^,.!?]{0,55}(banho(?:\\s+e\\s+tosa)?|tosa)`);
  const match = normalized.match(before) || normalized.match(after);
  if (match) return inferRequestedServiceKind(match[0]);
  const globalKind = inferRequestedServiceKind(message);
  const mentioned = parseNamedPets(message, allPets);
  return mentioned.length <= 1 ? globalKind : '';
};

const serviceMatchesPet = (service, pet) => {
  const name = normalizeText(service.name);
  const species = normalizeText(pet.species);
  const feline = /(gato|felin)/.test(species);
  if (feline) return /felin/.test(name) || !/(canin|cao|caes|cachorr)/.test(name);
  return !/felin/.test(name);
};

const resolvePetService = ({ services, pet, kind, message }) => {
  const normalized = normalizeText(message);
  let candidates = services.filter((service) => serviceMatchesPet(service, pet));
  if (kind === 'banho') {
    candidates = candidates.filter((service) => (
      service.categories.includes('banho') && /\bbanho\b/.test(normalizeText(service.name))
    ));
  } else if (kind === 'tosa' || kind === 'banho_tosa') {
    candidates = candidates.filter((service) => (
      service.categories.some((category) => ['tosa', 'banho_tosa'].includes(category))
      && /\btosa\b/.test(normalizeText(service.name))
    ));
  } else {
    return { selected: null, candidates: [] };
  }
  const explicit = candidates.find((service) => {
    const words = normalizeText(service.name).split(/\s+/).filter((word) => (
      word.length >= 4 && !['banho', 'tosa', 'felino', 'felina', 'canino', 'canina', 'completa', 'completo'].includes(word)
    ));
    return words.length && words.every((word) => normalized.includes(word));
  });
  if (explicit) return { selected: explicit, candidates };
  if (kind === 'banho') {
    const feline = /(gato|felin)/.test(normalizeText(pet.species));
    const defaultBath = candidates.find((service) => (
      feline ? normalizeText(service.name) === 'banho felino' : normalizeText(service.name) === 'banho'
    ));
    if (defaultBath) return { selected: defaultBath, candidates };
  }
  return { selected: candidates.length === 1 ? candidates[0] : null, candidates };
};

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
    const firstName = clean(data.customerName).split(/\s+/)[0];
    const greeting = firstName ? `${firstName}, quem viria para o atendimento?` : 'Quem viria para o atendimento?';
    return `${greeting}\n${listOptions(pets, (item) => (
      `${item.name}${item.breed ? ` — ${item.breed}` : ''}`
    ))}\n${pets.length + 1}. Cadastrar outro pet\nVocê pode responder com o nome de um ou mais pets.`;
  }
  if (flow.step === 'collect_pet_services') {
    const pets = selectedPets(flow);
    return `Perfeito. Qual serviço cada pet precisa?\n${pets.map((pet) => `- ${petDisplay(pet)}: banho, tosa ou banho e tosa?`).join('\n')}`;
  }
  if (flow.step === 'select_pet_service_detail') {
    const pending = data.pendingServicePet || {};
    const options = Array.isArray(data.pendingServiceOptions) ? data.pendingServiceOptions : [];
    return `Para ${pending.name || 'o pet'}, qual tipo de serviço você prefere?\n${listOptions(options, (item) => item.name)}\nResponda com o número ou com o nome do serviço.`;
  }
  if (flow.step === 'collect_group_preference') {
    return 'Vejo que há um cãozinho e um gatinho. Eles podem permanecer no mesmo horário sem problemas ou você prefere que o gatinho fique sozinho?';
  }
  if (flow.step === 'collect_professional_preference') {
    const unavailable = data.requestedProfessionalUnavailable && data.requestedProfessionalName
      ? `Não encontrei horários disponíveis com ${data.requestedProfessionalName} nessa data. `
      : '';
    return `${unavailable}Você tem preferência de profissional? Se não tiver, responda “sem preferência”.`;
  }
  if (flow.step === 'select_group_slot') {
    const options = Array.isArray(data.groupOptions) ? data.groupOptions : [];
    const pets = selectedPets(flow);
    const petNames = pets.map((pet) => pet.name).join(' e ');
    const preferenceText = data.professionalPreference === 'Sem preferência'
      ? 'sem preferência de profissional'
      : `considerando sua preferência por ${data.requestedProfessionalName || data.professionalPreference}`;
    if (data.petsMayStayTogether === false) {
      return `Encontrei estas combinações para ${petNames} em horários separados, ${preferenceText}:\n${listOptions(options, (option) => (
        option.assignments.map((item) => `${item.petName} em ${formatDate(item.date)} às ${item.time}`).join(' | ')
      ))}\nVocê pode responder com o número da combinação desejada.`;
    }
    const subject = pets.length === 1 ? petNames : `${petNames} juntos`;
    return `Encontrei estes horários para ${subject}, ${preferenceText}:\n${listOptions(options, (option) => (
      `${formatDate(option.date)} às ${option.time}`
    ))}\nVocê pode responder com o número ou com o horário desejado.`;
  }
  if (flow.step === 'select_professional_preference') {
    const option = data.selectedGroupOption || {};
    const names = [...new Set((option.assignments || []).map((item) => item.professionalName))];
    return `Para esse horário tenho ${names.join(' e ')}. Você tem preferência de profissional ou pode ser sem preferência?`;
  }
  if (flow.step === 'confirm_group') {
    const option = data.selectedGroupOption || {};
    const noPreference = data.professionalPreference === 'Sem preferência';
    return [
      'Confirme os dados dos agendamentos:',
      ...(option.assignments || []).map((item) => (
        `${item.petName}: ${item.serviceName} — ${formatDate(item.date || option.date)} às ${item.time || option.time} — ${noPreference ? 'Sem preferência' : item.professionalName}`
      )),
      '',
      'Responda SIM para confirmar ou NÃO para cancelar.',
    ].join('\n');
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
  if (flow.intent === 'grooming_appointment' && flow.customer) {
    const pets = selectedPets(flow);
    if (!pets.length && Array.isArray(data.petOptions) && data.petOptions.length) {
      flow.step = 'select_pet';
      return;
    }
    if (pets.length && !Array.isArray(data.petServiceItems)) {
      flow.step = 'collect_pet_services';
      return;
    }
    if (Array.isArray(data.petServiceItems) && data.petServiceItems.length) {
      if (hasMixedDogAndCat(pets) && typeof data.petsMayStayTogether !== 'boolean') {
        flow.step = 'collect_group_preference';
        return;
      }
      flow.step = 'collect_date';
      return;
    }
  }
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
    flow.data.selectedPets = [{
      id: String(pets[0]._id),
      name: pets[0].nome,
      species: pets[0].tipo,
      breed: pets[0].raca,
      size: pets[0].porte || '',
      sex: pets[0].sexo,
      birthDate: pets[0].dataNascimento,
    }];
  } else if (pets.length > 1) {
    flow.data.petOptions = pets.slice(0, 8).map((pet) => ({
      id: String(pet._id),
      name: pet.nome,
      species: pet.tipo,
      breed: pet.raca,
      sex: pet.sexo,
      birthDate: pet.dataNascimento,
      size: pet.porte || '',
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
    serviceOptions: services.slice(0, 30).map((service) => ({
      id: String(service._id),
      name: service.nome,
      duration: Number(service.duracaoMinutos) || 30,
      categories: Array.isArray(service.categorias) ? service.categorias : [],
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
  config,
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
    data: {
      initialServiceKind: intent === 'grooming_appointment'
        ? inferRequestedServiceKind(message)
        : '',
      initialRequestedDate: intent === 'grooming_appointment'
        ? parseRequestedDate(message, { now: messageAt })
        : null,
    },
    lastInboundMessageId: clean(messageId),
    lastInboundAt: messageAt,
    expiresAt: new Date(messageAt.getTime() + FLOW_TTL_MS),
  });
  await Promise.all([
    loadServices(flow, message),
    loadCustomerContext(flow),
  ]);
  if (flow.status === 'collecting') {
    chooseNextIdentityStep(flow);
    await applyInlineGroomingDetails({
      flow,
      message,
      config,
      now: messageAt,
    });
  }
  touchFlow(flow, messageId, messageAt);
  await flow.save();
  return flow;
};

const materializeCustomer = async (flow) => {
  if (flow.customer) {
    const existing = await User.findById(flow.customer);
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
      celularNormalizado: normalizeBrazilPhone(flow.waId),
      nomeCompleto: customerName,
      role: 'cliente',
      webAccountStatus: 'store_only',
      registrationSource: 'whatsapp',
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

const assignGroomingServices = (flow, message, existingItems = []) => {
  const pets = selectedPets(flow);
  const services = Array.isArray(flow.data?.serviceOptions) ? flow.data.serviceOptions : [];
  const byPetId = new Map(existingItems.map((item) => [String(item.petId), item]));
  for (const pet of pets) {
    if (byPetId.has(String(pet.id))) continue;
    const kind = inferPetServiceKind(message, pet, pets)
      || (pets.length === 1 ? clean(flow.data?.initialServiceKind) : '');
    const resolved = resolvePetService({ services, pet, kind, message });
    if (!resolved.selected) {
      flow.data.pendingServicePet = pet;
      flow.data.pendingServiceKind = kind;
      flow.data.pendingServiceOptions = resolved.candidates.slice(0, 8);
      flow.data.draftPetServiceItems = [...byPetId.values()];
      flow.step = resolved.candidates.length
        ? 'select_pet_service_detail'
        : 'collect_pet_services';
      return false;
    }
    byPetId.set(String(pet.id), {
      petId: String(pet.id),
      petName: pet.name,
      petSpecies: pet.species,
      serviceId: resolved.selected.id,
      serviceName: resolved.selected.name,
      serviceDuration: resolved.selected.duration,
      serviceKind: kind,
    });
  }
  flow.data.petServiceItems = [...byPetId.values()];
  flow.data.pendingServicePet = null;
  flow.data.pendingServiceKind = '';
  flow.data.pendingServiceOptions = [];
  flow.data.draftPetServiceItems = [];
  return flow.data.petServiceItems.length === pets.length;
};

const prepareGroomingGroupOptions = async ({
  flow,
  requested,
  config,
  now,
  strictlyAfterMinutes,
}) => {
  const finder = flow.data?.petsMayStayTogether === false
    ? findAvailableSeparateSlots
    : findAvailableGroupSlots;
  const options = await finder({
    storeId: flow.store,
    items: flow.data?.petServiceItems || [],
    intent: flow.intent,
    startDate: requested.date,
    preferredMinutes: requested.preferredMinutes,
    preferredProfessionalId: flow.data?.requestedProfessionalId || null,
    ...(flow.data?.petsMayStayTogether === false ? {} : { strictlyAfterMinutes }),
    config,
    now,
    excludeFlowId: flow._id,
  });
  const requestedProfessionalId = clean(flow.data?.requestedProfessionalId);
  const matchingProfessional = requestedProfessionalId
    ? options.filter((option) => option.assignments.some((assignment) => (
      String(assignment.professional) === requestedProfessionalId
    )))
    : [];
  flow.data.requestedProfessionalUnavailable = Boolean(
    requestedProfessionalId && !matchingProfessional.length
  );
  const orderedOptions = requestedProfessionalId
    ? matchingProfessional
    : options;
  flow.data.preferredDate = requested.date;
  flow.data.preferredMinutes = requested.preferredMinutes;
  flow.data.groupOptions = orderedOptions;
  flow.data.selectedGroupOption = null;
  flow.step = orderedOptions.length
    ? 'select_group_slot'
    : flow.data.requestedProfessionalUnavailable
      ? 'collect_professional_preference'
      : 'collect_date';
  return orderedOptions;
};

const parseRequestedMinutes = (message) => {
  const match = normalizeText(message).match(/\b(?:as|a|por volta de)?\s*(\d{1,2})(?::|h)(\d{2})?\b/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2] || 0);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59
    ? (hours * 60) + minutes
    : null;
};

const findMentionedProfessional = async ({ storeId, intent, message, requireCue = true }) => {
  const normalized = normalizeText(message);
  if (
    requireCue
    && !/(?:\bcom\b|profission|prefer|atendid[oa]\s+por|\bpel[oa]\b)/.test(normalized)
  ) return null;
  const group = intent === 'veterinary_appointment' ? 'veterinario' : 'esteticista';
  const professionals = await User.find({
    empresas: storeId,
    grupos: group,
    role: { $in: ['funcionario', 'franqueado', 'franqueador', 'admin', 'admin_master'] },
  }).select('_id nomeCompleto nomeContato razaoSocial').lean();
  const matches = professionals.map((professional) => {
    const name = clean(
      professional.nomeCompleto || professional.nomeContato || professional.razaoSocial
    );
    const parts = normalizeText(name).split(/\s+/).filter((part) => part.length >= 4);
    const matchedParts = parts.filter((part) => normalized.includes(part));
    return { professional, name, score: matchedParts.length };
  }).filter((entry) => entry.score > 0).sort((left, right) => right.score - left.score);
  if (!matches.length || (matches[1] && matches[1].score === matches[0].score)) return null;
  return { id: String(matches[0].professional._id), name: matches[0].name };
};

const inferTogetherPreference = (message) => {
  const normalized = normalizeText(message);
  if (/(sozinh|separad|nao.*junt)/.test(normalized)) return false;
  if (/(junt|mesmo horario|sem problema|podem ficar|pode ficar)/.test(normalized)) return true;
  return null;
};

const applyInlineGroomingDetails = async ({ flow, message, config, now }) => {
  if (flow.intent !== 'grooming_appointment') return false;
  let changed = false;
  const data = flow.data || {};
  const petOptions = Array.isArray(data.petOptions) ? data.petOptions : [];
  if (!selectedPets(flow).length && petOptions.length) {
    const namedPets = parseNamedPets(message, petOptions);
    if (namedPets.length) changed = applySelectedPets(flow, namedPets) || changed;
  }

  const requestedDate = parseRequestedDate(message, {
    now,
    timezone: config.timezone,
  });
  const requestedMinutes = parseRequestedMinutes(message);
  if (requestedDate) {
    flow.data.initialRequestedDate = {
      ...requestedDate,
      preferredMinutes: requestedDate.preferredMinutes ?? requestedMinutes ?? data.requestedPreferredMinutes ?? null,
    };
    changed = true;
  } else if (requestedMinutes !== null) {
    flow.data.requestedPreferredMinutes = requestedMinutes;
    changed = true;
  }

  const professional = await findMentionedProfessional({
    storeId: flow.store,
    intent: flow.intent,
    message,
  });
  if (professional) {
    flow.data.requestedProfessionalId = professional.id;
    flow.data.requestedProfessionalName = professional.name;
    flow.data.professionalPreference = professional.name;
    flow.data.professionalPreferenceResolved = true;
    changed = true;
  } else if (/(sem prefer|nao tenho prefer|qualquer|tanto faz)/.test(normalizeText(message))) {
    flow.data.requestedProfessionalId = '';
    flow.data.requestedProfessionalName = '';
    flow.data.requestedProfessionalUnavailable = false;
    flow.data.professionalPreference = 'Sem preferência';
    flow.data.professionalPreferenceResolved = true;
    changed = true;
  }

  const pets = selectedPets(flow);
  if (!pets.length) {
    chooseNextIdentityStep(flow);
    return changed;
  }

  if (!Array.isArray(flow.data.petServiceItems) || flow.data.petServiceItems.length < pets.length) {
    const hasServiceInMessage = Boolean(inferRequestedServiceKind(message));
    const canReuseInitialService = pets.length === 1 && clean(flow.data.initialServiceKind);
    if (hasServiceInMessage || canReuseInitialService) {
      assignGroomingServices(
        flow,
        message,
        Array.isArray(flow.data.draftPetServiceItems) ? flow.data.draftPetServiceItems : [],
      );
      changed = true;
    }
  }
  if (!Array.isArray(flow.data.petServiceItems) || flow.data.petServiceItems.length < pets.length) {
    if (flow.step === 'select_pet_service_detail') return changed;
    chooseNextIdentityStep(flow);
    return changed;
  }

  if (hasMixedDogAndCat(pets) && typeof flow.data.petsMayStayTogether !== 'boolean') {
    const preference = inferTogetherPreference(message);
    if (preference === null) {
      flow.step = 'collect_group_preference';
      return changed;
    }
    flow.data.petsMayStayTogether = preference;
    changed = true;
  }

  const requested = flow.data.initialRequestedDate;
  if (!requested?.date) {
    flow.step = 'collect_date';
    return changed;
  }
  if (flow.data.professionalPreferenceResolved !== true) {
    flow.step = 'collect_professional_preference';
    return changed;
  }
  if (requested.preferredMinutes === null && Number.isFinite(Number(flow.data.requestedPreferredMinutes))) {
    requested.preferredMinutes = Number(flow.data.requestedPreferredMinutes);
  }
  const options = await prepareGroomingGroupOptions({ flow, requested, config, now });
  changed = true;
  if (!options.length) return changed;

  const exact = requested.preferredMinutes === null
    ? null
    : options.find((option) => (
      option.date === requested.date && parseMinutes(option.time) === requested.preferredMinutes
    ));
  if (
    exact
    && flow.data.requestedProfessionalId
    && !flow.data.requestedProfessionalUnavailable
  ) {
    flow.data.selectedGroupOption = exact;
    flow.data.professionalPreference = flow.data.requestedProfessionalName;
    flow.status = 'awaiting_confirmation';
    flow.step = 'confirm_group';
  }
  return changed;
};

const parseGroupOption = (message, options, { timezone, now } = {}) => {
  const index = parseSelection(message, options.length);
  if (index !== null) return options[index];
  const requested = parseRequestedDate(message, { timezone, now });
  const normalized = normalizeText(message);
  const timeOnly = normalized.match(/\b(\d{1,2})(?::|h)(\d{2})?\b/);
  const wantedMinutes = requested?.preferredMinutes ?? (timeOnly
    ? (Number(timeOnly[1]) * 60) + Number(timeOnly[2] || 0)
    : null);
  return options.find((option) => {
    if (requested?.date && option.date !== requested.date) return false;
    if (wantedMinutes !== null && parseMinutes(option.time) !== wantedMinutes) return false;
    return requested?.date || wantedMinutes !== null;
  }) || null;
};

const buildGroupConfirmation = ({ flow, appointments }) => {
  const option = flow.data?.selectedGroupOption || {};
  const preference = flow.data?.professionalPreference || 'Sem preferência';
  return [
    'Agendamentos concluídos com sucesso! ✅',
    ...(option.assignments || []).map((item) => (
      `${item.petName}: ${item.serviceName} — ${formatDate(item.date || option.date)} às ${item.time || option.time} — ${preference === 'Sem preferência' ? preference : item.professionalName}`
    )),
    '',
    'Algo mais em que eu possa ajudar?',
    appointments.length ? `Códigos: ${appointments.map((appointment) => String(appointment._id).slice(-8).toUpperCase()).join(', ')}` : '',
  ].filter(Boolean).join('\n');
};

const createGroupAppointments = async ({ flow, config }) => {
  const option = flow.data?.selectedGroupOption || {};
  const assignments = Array.isArray(option.assignments) ? option.assignments : [];
  if (!assignments.length) throw new Error('Nenhum horário foi selecionado para os pets.');
  const created = [];
  try {
    for (let index = 0; index < assignments.length; index += 1) {
      const assignment = assignments[index];
      const childFlow = {
        ...flow.toObject(),
        _id: flow._id,
        sessionId: `${flow.sessionId}:${index + 1}`,
        pet: assignment.petId,
        service: assignment.serviceId,
        selectedOption: assignment,
      };
      const result = await createAppointmentFromFlow({
        flow: childFlow,
        customerId: flow.customer,
        petId: assignment.petId,
        serviceId: assignment.serviceId,
        option: assignment,
        intent: flow.intent,
        config,
      });
      created.push({ appointment: result.appointment, replayed: result.replayed });
    }
    return created;
  } catch (error) {
    const newAppointments = created.filter((entry) => !entry.replayed).map((entry) => entry.appointment._id);
    if (newAppointments.length) {
      await mongoose.model('Appointment').deleteMany({ _id: { $in: newAppointments } });
    }
    await mongoose.model('WhatsappAppointmentSlotLock').deleteMany({
      flow: flow._id,
      appointment: { $in: newAppointments },
    });
    throw error;
  }
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

  if (
    flow.intent === 'grooming_appointment'
    && ['select_pet', 'collect_pet_services', 'collect_group_preference', 'collect_date'].includes(flow.step)
  ) {
    const inlineHandled = await applyInlineGroomingDetails({
      flow,
      message: text,
      config,
      now: messageAt,
    });
    if (inlineHandled) {
      touchFlow(flow, messageId, messageAt);
      await flow.save();
      const reply = promptForFlow(flow);
      flow.lastPrompt = reply;
      await flow.save();
      await recordFlowAudit({
        flow,
        action: 'appointment_flow_advanced',
        previousState: previous,
        extra: { inlineDetails: true },
      });
      return { handled: true, flow, reply };
    }
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
    const named = parseNamedPets(text, pets);
    if (selection === null && !named.length) {
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
      const chosen = named.length ? named : [pets[selection]];
      applySelectedPets(flow, chosen);
      flow.step = flow.intent === 'grooming_appointment'
        ? 'collect_pet_services'
        : 'collect_date';
    }
  } else if (flow.step === 'collect_pet_services') {
    const assigned = assignGroomingServices(
      flow,
      text,
      Array.isArray(flow.data?.draftPetServiceItems) ? flow.data.draftPetServiceItems : [],
    );
    if (assigned) {
      if (hasMixedDogAndCat(selectedPets(flow))) {
        flow.step = 'collect_group_preference';
      } else {
        const initialDate = flow.data?.initialRequestedDate;
        if (initialDate?.date) {
          const options = await prepareGroomingGroupOptions({
            flow,
            requested: initialDate,
            config,
            now: messageAt,
          });
          if (!options.length) flow.step = 'collect_date';
        } else {
          flow.step = 'collect_date';
        }
      }
    }
  } else if (flow.step === 'select_pet_service_detail') {
    const options = Array.isArray(flow.data?.pendingServiceOptions)
      ? flow.data.pendingServiceOptions
      : [];
    const selection = parseSelection(text, options.length);
    const matchingByName = options.filter((service) => {
      const name = normalizeText(service.name);
      if (name.length >= 4 && normalized.includes(name)) return true;
      const distinguishingWords = name.split(/\s+/).filter((word) => (
        word.length >= 4
        && !['banho', 'tosa', 'felino', 'felina', 'canino', 'canina', 'completa', 'completo'].includes(word)
      ));
      return distinguishingWords.some((word) => normalized.includes(word));
    });
    const byName = matchingByName.length === 1 ? matchingByName[0] : null;
    const selected = selection === null ? byName : options[selection];
    if (!selected) {
      touchFlow(flow, messageId, messageAt);
      await flow.save();
      return { handled: true, flow, reply: `Não reconheci o serviço.\n${promptForFlow(flow)}` };
    }
    const pendingPet = flow.data.pendingServicePet;
    const draft = Array.isArray(flow.data.draftPetServiceItems)
      ? flow.data.draftPetServiceItems
      : [];
    draft.push({
      petId: String(pendingPet.id),
      petName: pendingPet.name,
      petSpecies: pendingPet.species,
      serviceId: selected.id,
      serviceName: selected.name,
      serviceDuration: selected.duration,
      serviceKind: flow.data.pendingServiceKind || inferRequestedServiceKind(selected.name),
    });
    flow.data.draftPetServiceItems = draft;
    flow.data.pendingServicePet = null;
    flow.data.pendingServiceOptions = [];
    if (draft.length === selectedPets(flow).length) {
      flow.data.petServiceItems = draft;
      flow.data.draftPetServiceItems = [];
      if (hasMixedDogAndCat(selectedPets(flow))) {
        flow.step = 'collect_group_preference';
      } else if (!flow.data?.initialRequestedDate?.date) {
        flow.step = 'collect_date';
      } else if (flow.data.professionalPreferenceResolved !== true) {
        flow.step = 'collect_professional_preference';
      } else {
        await prepareGroomingGroupOptions({
          flow,
          requested: flow.data.initialRequestedDate,
          config,
          now: messageAt,
        });
      }
    } else {
      flow.step = 'collect_pet_services';
    }
  } else if (flow.step === 'collect_group_preference') {
    if (/(sozinh|separad|nao.*junt)/.test(normalized)) {
      flow.data.petsMayStayTogether = false;
      const initialDate = flow.data?.initialRequestedDate;
      if (initialDate?.date) {
        const options = await prepareGroomingGroupOptions({
          flow,
          requested: initialDate,
          config,
          now: messageAt,
        });
        if (!options.length) flow.step = 'collect_date';
      } else {
        flow.step = 'collect_date';
      }
    } else if (/(junt|mesmo horario|sem problema|podem ficar|pode ficar)/.test(normalized)) {
      flow.data.petsMayStayTogether = true;
      const initialDate = flow.data?.initialRequestedDate;
      if (initialDate?.date) {
        const options = await prepareGroomingGroupOptions({
          flow,
          requested: initialDate,
          config,
          now: messageAt,
        });
        if (!options.length) flow.step = 'collect_date';
      } else {
        flow.step = 'collect_date';
      }
    } else {
      touchFlow(flow, messageId, messageAt);
      await flow.save();
      return { handled: true, flow, reply: promptForFlow(flow) };
    }
  } else if (flow.step === 'collect_professional_preference') {
    const noPreference = /(sem prefer|nao tenho prefer|qualquer|tanto faz)/.test(normalized);
    const professional = noPreference ? null : await findMentionedProfessional({
      storeId: flow.store,
      intent: flow.intent,
      message: text,
      requireCue: false,
    });
    if (!noPreference && !professional) {
      touchFlow(flow, messageId, messageAt);
      await flow.save();
      return {
        handled: true,
        flow,
        reply: `Não reconheci o profissional. ${promptForFlow(flow)}`,
      };
    }
    flow.data.requestedProfessionalId = professional?.id || '';
    flow.data.requestedProfessionalName = professional?.name || '';
    flow.data.requestedProfessionalUnavailable = false;
    flow.data.professionalPreference = professional?.name || 'Sem preferência';
    flow.data.professionalPreferenceResolved = true;
    const requested = flow.data.initialRequestedDate || {
      date: flow.data.preferredDate,
      preferredMinutes: flow.data.preferredMinutes ?? null,
    };
    if (!requested?.date) {
      flow.step = 'collect_date';
    } else {
      await prepareGroomingGroupOptions({
        flow,
        requested,
        config,
        now: messageAt,
      });
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
    if (
      flow.intent === 'grooming_appointment'
      && Array.isArray(flow.data?.petServiceItems)
      && flow.data.petServiceItems.length
    ) {
      const options = await prepareGroomingGroupOptions({
        flow,
        requested,
        config,
        now: messageAt,
      });
      if (!options.length) {
        touchFlow(flow, messageId, messageAt);
        await flow.save();
        return {
          handled: true,
          flow,
          reply: `Não encontrei uma combinação disponível a partir de ${formatDate(requested.date)}. Informe outra data para eu consultar.`,
        };
      }
    } else {
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
    }
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
  } else if (flow.step === 'select_group_slot') {
    const options = Array.isArray(flow.data?.groupOptions) ? flow.data.groupOptions : [];
    if (/(mais tarde|depois|horario posterior)/.test(normalized)) {
      const baseline = Number.isFinite(Number(flow.data?.preferredMinutes))
        ? Number(flow.data.preferredMinutes)
        : parseMinutes(options[0]?.time);
      const requested = {
        date: flow.data?.preferredDate || options[0]?.date,
        preferredMinutes: baseline === null ? null : baseline + Number(config.appointmentSlotIntervalMinutes || 30),
      };
      const later = await prepareGroomingGroupOptions({
        flow,
        requested,
        config,
        now: messageAt,
        strictlyAfterMinutes: baseline,
      });
      if (!later.length) {
        flow.step = 'collect_date';
        touchFlow(flow, messageId, messageAt);
        await flow.save();
        return { handled: true, flow, reply: 'Não encontrei um horário posterior com essa combinação. Qual outra data você prefere?' };
      }
    } else {
      if (/(junt|mesmo horario)/.test(normalized) && flow.data?.petsMayStayTogether === false) {
        flow.data.petsMayStayTogether = true;
        const requested = {
          date: flow.data?.preferredDate || options[0]?.date,
          preferredMinutes: flow.data?.preferredMinutes ?? null,
        };
        const together = await prepareGroomingGroupOptions({
          flow,
          requested,
          config,
          now: messageAt,
        });
        if (!together.length) {
          flow.step = 'collect_date';
          touchFlow(flow, messageId, messageAt);
          await flow.save();
          return { handled: true, flow, reply: 'Não encontrei os dois juntos nessa data. Qual outra data você prefere?' };
        }
      } else {
        let selected = parseGroupOption(text, options, {
          timezone: config.timezone,
          now: messageAt,
        });
        if (!selected) {
          touchFlow(flow, messageId, messageAt);
          await flow.save();
          return { handled: true, flow, reply: `Não reconheci o horário.\n${promptForFlow(flow)}` };
        }
        const requestedProfessional = await findMentionedProfessional({
          storeId: flow.store,
          intent: flow.intent,
          message: text,
        });
        if (requestedProfessional) {
          flow.data.requestedProfessionalId = requestedProfessional.id;
          flow.data.requestedProfessionalName = requestedProfessional.name;
          const refreshed = await prepareGroomingGroupOptions({
            flow,
            requested: {
              date: selected.date,
              preferredMinutes: parseMinutes(selected.time),
            },
            config,
            now: messageAt,
          });
          selected = refreshed.find((option) => (
            option.date === selected.date
            && option.time === selected.time
            && option.assignments.some((assignment) => (
              String(assignment.professional) === requestedProfessional.id
            ))
          ));
          if (!selected) {
            touchFlow(flow, messageId, messageAt);
            await flow.save();
            return { handled: true, flow, reply: promptForFlow(flow) };
          }
        }
        flow.data.selectedGroupOption = selected;
        if (requestedProfessional) {
          flow.data.professionalPreference = requestedProfessional.name;
          flow.status = 'awaiting_confirmation';
          flow.step = 'confirm_group';
        } else if (flow.data.professionalPreferenceResolved === true) {
          flow.status = 'awaiting_confirmation';
          flow.step = 'confirm_group';
        } else {
          flow.step = 'select_professional_preference';
        }
      }
    }
  } else if (flow.step === 'select_professional_preference') {
    const option = flow.data?.selectedGroupOption || {};
    const assignments = Array.isArray(option.assignments) ? option.assignments : [];
    const noPreference = /(sem prefer|nao tenho prefer|qualquer|tanto faz|pode ser)/.test(normalized);
    const named = assignments.filter((assignment) => {
      const fullName = normalizeText(assignment.professionalName);
      return fullName.split(/\s+/).some((part) => part.length >= 4 && normalized.includes(part));
    });
    if (!noPreference && !named.length) {
      touchFlow(flow, messageId, messageAt);
      await flow.save();
      return { handled: true, flow, reply: promptForFlow(flow) };
    }
    flow.data.professionalPreference = noPreference
      ? 'Sem preferência'
      : named.map((entry) => entry.professionalName).join(' e ');
    flow.status = 'awaiting_confirmation';
    flow.step = 'confirm_group';
  } else if (flow.step === 'confirm_group') {
    const confirmed = /^(sim|s|confirmo|confirmar|pode marcar|pode confirmar|1)\b/.test(normalized);
    const denied = /^(nao|n|cancelar|cancela|2)\b/.test(normalized);
    if (denied) return cancelFlow({ flow, messageId, messageAt, io });
    if (!confirmed) {
      touchFlow(flow, messageId, messageAt);
      await flow.save();
      return { handled: true, flow, reply: 'Responda SIM para confirmar ou NÃO para cancelar os agendamentos.' };
    }
    const claimed = await WhatsappAppointmentFlow.findOneAndUpdate(
      { _id: flow._id, status: 'awaiting_confirmation', step: 'confirm_group' },
      {
        $set: {
          status: 'booking',
          step: 'booking',
          lastInboundMessageId: clean(messageId),
          lastInboundAt: messageAt,
        },
      },
      { new: true },
    );
    if (!claimed) {
      const current = await WhatsappAppointmentFlow.findById(flow._id);
      return {
        handled: true,
        flow: current || flow,
        reply: current?.status === 'completed'
          ? 'Estes agendamentos já foram confirmados.'
          : 'Estes agendamentos já estão sendo processados.',
      };
    }
    flow = claimed;
    try {
      const results = await createGroupAppointments({ flow, config });
      const appointments = results.map((entry) => entry.appointment);
      flow.appointment = appointments[0]?._id || null;
      flow.data.appointmentIds = appointments.map((appointment) => String(appointment._id));
      flow.status = 'completed';
      flow.step = 'completed';
      flow.completedAt = new Date();
      flow.lastError = '';
      touchFlow(flow, messageId, messageAt);
      await flow.save();
      const reply = buildGroupConfirmation({ flow, appointments });
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
        extra: { appointmentIds: flow.data.appointmentIds },
      });
      return { handled: true, flow, reply, appointments, completed: true };
    } catch (error) {
      if (error?.code === 'APPOINTMENT_SLOT_UNAVAILABLE') {
        const requested = {
          date: flow.data?.preferredDate,
          preferredMinutes: flow.data?.preferredMinutes,
        };
        flow.status = 'collecting';
        const options = await prepareGroomingGroupOptions({
          flow,
          requested,
          config,
          now: messageAt,
        });
        flow.lastError = error.message;
        touchFlow(flow, messageId, messageAt);
        await flow.save();
        const reply = options.length
          ? `Esse horário acabou de ser ocupado. Separei novas opções:\n${promptForFlow(flow)}`
          : 'Esse horário acabou de ser ocupado. Informe outra data para eu consultar novamente.';
        await updateConversationForFlow({ flow, reply, runAt: new Date(), messageId, io });
        return { handled: true, flow, reply, conflict: true };
      }
      flow.status = 'failed';
      flow.step = 'handoff';
      flow.lastError = clean(error?.message) || 'Falha ao criar os agendamentos';
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
  const automationAllowed = transition
    ? transition.automationEnabled === true
    : config.manualChatActivation !== true || conversation.automationOptIn === true;
  if (!automationAllowed || conversation.status === 'PAUSED') {
    return { handled: false, reason: 'conversation_paused' };
  }

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
      config,
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
