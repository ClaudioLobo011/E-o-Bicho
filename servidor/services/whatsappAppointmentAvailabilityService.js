const Appointment = require('../models/Appointment');
const Pet = require('../models/Pet');
const Service = require('../models/Service');
const ServiceBreedPrice = require('../models/ServiceBreedPrice');
const Store = require('../models/Store');
const User = require('../models/User');
const WhatsappAppointmentSlotLock = require('../models/WhatsappAppointmentSlotLock');
const { normalizeTimezone, parseMinutes } = require('./whatsappOperatingHoursService');

const DAY_KEYS = Object.freeze({
  sun: 'domingo',
  mon: 'segunda',
  tue: 'terca',
  wed: 'quarta',
  thu: 'quinta',
  fri: 'sexta',
  sat: 'sabado',
});

const INTENT_CATEGORIES = Object.freeze({
  appointment_unspecified: [],
  veterinary_appointment: ['veterinario', 'vacina', 'exame'],
  grooming_appointment: ['banho', 'tosa', 'banho_tosa'],
});

const clean = (value) => (typeof value === 'string' ? value.trim() : '');
const digitsOnly = (value) => String(value || '').replace(/\D+/g, '');
const normalizeText = (value) => clean(value)
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase();
const pad2 = (value) => String(value).padStart(2, '0');

const addDays = (dateKey, amount) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(clean(dateKey));
  if (!match) return '';
  const date = new Date(Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]) + Number(amount || 0),
    12
  ));
  return [
    date.getUTCFullYear(),
    pad2(date.getUTCMonth() + 1),
    pad2(date.getUTCDate()),
  ].join('-');
};

const zonedParts = (date, timezone) => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: normalizeTimezone(timezone),
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date).map((part) => [part.type, part.value])
  );
  return {
    weekday: DAY_KEYS[normalizeText(parts.weekday)] || '',
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
    minutes: (Number(parts.hour) * 60) + Number(parts.minute),
  };
};

const zonedDateTimeToUtc = (dateKey, time, timezone) => {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(clean(dateKey));
  const timeMatch = /^(\d{1,2}):(\d{2})$/.exec(clean(time));
  if (!dateMatch || !timeMatch) return null;
  const desiredUtc = Date.UTC(
    Number(dateMatch[1]),
    Number(dateMatch[2]) - 1,
    Number(dateMatch[3]),
    Number(timeMatch[1]),
    Number(timeMatch[2]),
    0,
    0
  );
  let candidate = new Date(desiredUtc);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = zonedParts(candidate, timezone);
    const renderedUtc = Date.UTC(
      Number(parts.dateKey.slice(0, 4)),
      Number(parts.dateKey.slice(5, 7)) - 1,
      Number(parts.dateKey.slice(8, 10)),
      Number(parts.time.slice(0, 2)),
      Number(parts.time.slice(3, 5)),
      0,
      0
    );
    const delta = desiredUtc - renderedUtc;
    if (!delta) break;
    candidate = new Date(candidate.getTime() + delta);
  }
  return Number.isNaN(candidate.getTime()) ? null : candidate;
};

const dateTimeFromMinutes = (dateKey, minutes, timezone) => {
  const dayOffset = Math.floor(minutes / 1440);
  const normalized = ((minutes % 1440) + 1440) % 1440;
  return zonedDateTimeToUtc(
    addDays(dateKey, dayOffset),
    `${pad2(Math.floor(normalized / 60))}:${pad2(normalized % 60)}`,
    timezone
  );
};

const phoneCandidates = (waId) => {
  const digits = digitsOnly(waId);
  const values = new Set([digits]);
  if (digits.startsWith('55') && digits.length >= 12) values.add(digits.slice(2));
  if ([10, 11].includes(digits.length)) values.add(`55${digits}`);
  return Array.from(values).filter(Boolean);
};

const findCustomerByWhatsapp = async ({ storeId, waId }) => {
  const phones = phoneCandidates(waId);
  if (!phones.length) return null;
  const customer = await User.findOne({
    role: 'cliente',
    $or: [
      { celular: { $in: phones } },
      { celularSecundario: { $in: phones } },
    ],
  })
    .select('_id nomeCompleto nomeContato razaoSocial celular celularSecundario empresas empresaPrincipal')
    .lean();
  if (!customer) return null;
  await User.updateOne(
    { _id: customer._id },
    {
      $addToSet: { empresas: storeId },
      ...(!customer.empresaPrincipal ? { $set: { empresaPrincipal: storeId } } : {}),
    }
  );
  return customer;
};

const findServicesForIntent = async ({ intent, message = '' }) => {
  const categories = INTENT_CATEGORIES[intent] || [];
  let services = await Service.find({
    ativo: { $ne: false },
    categorias: { $in: categories },
  })
    .select('_id nome valor duracaoMinutos categorias grupo ativo')
    .populate({ path: 'grupo', select: 'nome tiposPermitidos ativo' })
    .sort({ nome: 1 })
    .lean();
  services = services.filter((entry) => entry?.grupo?.ativo !== false);
  if (!services.length) {
    const fallbackPattern = intent === 'veterinary_appointment'
      ? /(veterin|consulta|vacina|exame)/
      : /(banho|tosa|estetic)/;
    const active = await Service.find({ ativo: { $ne: false } })
      .select('_id nome valor duracaoMinutos categorias grupo ativo')
      .populate({ path: 'grupo', select: 'nome tiposPermitidos ativo' })
      .sort({ nome: 1 })
      .lean();
    services = active.filter((entry) => (
      entry?.grupo?.ativo !== false
      && fallbackPattern.test(normalizeText(`${entry.nome} ${entry?.grupo?.nome || ''}`))
    ));
  }

  const normalizedMessage = normalizeText(message);
  const exact = services.find((service) => {
    const name = normalizeText(service.nome);
    return name.length >= 4 && normalizedMessage.includes(name);
  });
  return { services, exact: exact || null };
};

const getPetList = (customerId) => Pet.find({
  owner: customerId,
  obito: { $ne: true },
})
  .select('_id nome tipo raca porte sexo dataNascimento')
  .sort({ nome: 1 })
  .lean();

const professionalDisplayName = (professional) => (
  professional?.nomeCompleto
  || professional?.nomeContato
  || professional?.razaoSocial
  || professional?.email
  || 'Profissional'
);

const allowedProfessionalTypes = (service, intent) => {
  const configured = Array.isArray(service?.grupo?.tiposPermitidos)
    ? service.grupo.tiposPermitidos.filter((type) => (
        ['esteticista', 'veterinario'].includes(type)
      ))
    : [];
  if (configured.length) return configured;
  return intent === 'veterinary_appointment' ? ['veterinario'] : ['esteticista'];
};

const resolveStoreRange = ({ store, config, dateKey, weekday }) => {
  const special = Array.isArray(config?.specialHours)
    ? config.specialHours.find((entry) => clean(entry?.date) === dateKey)
    : null;
  if (special) {
    if (special.closed) return null;
    const open = parseMinutes(special.open);
    const close = parseMinutes(special.close);
    if (open === null || close === null || open === close) return null;
    return { open, close: close < open ? close + 1440 : close };
  }

  const schedule = store?.horario || {};
  const configured = Object.values(schedule).some((entry) => (
    entry?.fechada || clean(entry?.abre) || clean(entry?.fecha)
  ));
  if (!configured) return { open: 9 * 60, close: 18 * 60 };
  const day = schedule[weekday] || {};
  if (day.fechada) return null;
  const open = parseMinutes(day.abre);
  const close = parseMinutes(day.fecha);
  if (open === null || close === null || open === close) return null;
  return { open, close: close < open ? close + 1440 : close };
};

const resolveProfessionalRange = ({ professional, weekday, storeRange }) => {
  const schedule = Array.isArray(professional?.horarios)
    ? professional.horarios.filter(Boolean)
    : [];
  if (!schedule.length) return { ...storeRange, breaks: [] };
  const day = schedule.find((entry) => normalizeText(entry.dia) === weekday);
  if (!day) return null;
  const open = parseMinutes(day.horaInicio);
  const close = parseMinutes(day.horaFim);
  if (open === null || close === null || open === close) return null;
  const normalizedClose = close < open ? close + 1440 : close;
  const range = {
    open: Math.max(storeRange.open, open),
    close: Math.min(storeRange.close, normalizedClose),
    breaks: [],
  };
  const lunchOpen = parseMinutes(day.almocoInicio);
  const lunchClose = parseMinutes(day.almocoFim);
  if (lunchOpen !== null && lunchClose !== null && lunchOpen !== lunchClose) {
    range.breaks.push({
      start: lunchOpen,
      end: lunchClose < lunchOpen ? lunchClose + 1440 : lunchClose,
    });
  }
  return range.close > range.open ? range : null;
};

const intervalsOverlap = (startA, endA, startB, endB) => (
  startA < endB && endA > startB
);

const appointmentItemStart = ({ appointment, item, timezone }) => {
  const date = clean(item?.data);
  const time = clean(item?.hora);
  if (/^\d{4}-\d{2}-\d{2}$/.test(date) && /^\d{1,2}:\d{2}$/.test(time)) {
    return zonedDateTimeToUtc(date, time, timezone);
  }
  const fallback = new Date(appointment.scheduledAt);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
};

const loadBusyIntervals = async ({
  storeId,
  professionalIds,
  rangeStart,
  rangeEnd,
  startDateKey,
  endDateKey,
  timezone,
  excludeFlowId,
}) => {
  const appointments = await Appointment.find({
    store: storeId,
    status: { $ne: 'finalizado' },
    $or: [
      { scheduledAt: { $gte: rangeStart, $lt: rangeEnd } },
      { 'itens.data': { $gte: startDateKey, $lt: endDateKey } },
    ],
  })
    .select('_id profissional scheduledAt status itens')
    .populate('itens.servico', 'duracaoMinutos')
    .lean();
  const intervals = new Map(professionalIds.map((id) => [String(id), []]));

  appointments.forEach((appointment) => {
    const items = Array.isArray(appointment.itens) && appointment.itens.length
      ? appointment.itens
      : [{ profissional: appointment.profissional }];
    items.forEach((item) => {
      if (item?.status === 'finalizado') return;
      const professionalId = String(item?.profissional || appointment.profissional || '');
      if (!intervals.has(professionalId)) return;
      const start = appointmentItemStart({ appointment, item, timezone });
      if (!start) return;
      const duration = Math.max(1, Number(item?.servico?.duracaoMinutos) || 30);
      intervals.get(professionalId).push({
        start: start.getTime(),
        end: start.getTime() + (duration * 60 * 1000),
      });
    });
  });

  const locks = await WhatsappAppointmentSlotLock.find({
    store: storeId,
    professional: { $in: professionalIds },
    startsAt: { $gte: rangeStart, $lt: rangeEnd },
    expiresAt: { $gt: new Date() },
    ...(excludeFlowId ? { flow: { $ne: excludeFlowId } } : {}),
  }).select('professional startsAt').lean();
  locks.forEach((lock) => {
    const professionalId = String(lock.professional);
    if (!intervals.has(professionalId)) return;
    const start = new Date(lock.startsAt).getTime();
    intervals.get(professionalId).push({
      start,
      end: start + (15 * 60 * 1000),
    });
  });
  return intervals;
};

const findAvailableSlots = async ({
  storeId,
  serviceId,
  intent,
  startDate,
  config = {},
  now = new Date(),
  maxOptions,
  excludeFlowId,
  preferredMinutes,
}) => {
  const timezone = normalizeTimezone(config.timezone);
  const searchDays = Math.min(30, Math.max(1, Number(config.appointmentSearchDays) || 14));
  const limit = Math.min(
    5,
    Math.max(1, Number(maxOptions || config.appointmentMaxOptions) || 3)
  );
  const slotInterval = [15, 30, 60].includes(Number(config.appointmentSlotIntervalMinutes))
    ? Number(config.appointmentSlotIntervalMinutes)
    : 30;
  const configuredLead = Number(config.appointmentMinLeadMinutes);
  const minLead = Math.min(
    10080,
    Math.max(0, Number.isFinite(configuredLead) ? configuredLead : 60)
  );
  const today = zonedParts(now, timezone).dateKey;
  const firstDate = /^\d{4}-\d{2}-\d{2}$/.test(clean(startDate))
    ? clean(startDate)
    : today;
  const [store, service] = await Promise.all([
    Store.findById(storeId).select('_id horario nome').lean(),
    Service.findOne({ _id: serviceId, ativo: { $ne: false } })
      .select('_id nome valor duracaoMinutos categorias grupo ativo')
      .populate({ path: 'grupo', select: 'nome tiposPermitidos ativo' })
      .lean(),
  ]);
  if (!store || !service || service?.grupo?.ativo === false) return [];

  const types = allowedProfessionalTypes(service, intent);
  const professionals = await User.find({
    empresas: storeId,
    grupos: { $in: types },
    role: { $in: ['funcionario', 'franqueado', 'franqueador', 'admin', 'admin_master'] },
  })
    .select('_id nomeCompleto nomeContato razaoSocial email grupos horarios')
    .sort({ nomeCompleto: 1, nomeContato: 1, razaoSocial: 1 })
    .lean();
  if (!professionals.length) return [];

  const endDateKey = addDays(firstDate, searchDays);
  const rangeStart = zonedDateTimeToUtc(firstDate, '00:00', timezone);
  const rangeEnd = zonedDateTimeToUtc(endDateKey, '00:00', timezone);
  if (!rangeStart || !rangeEnd) return [];
  const busy = await loadBusyIntervals({
    storeId,
    professionalIds: professionals.map((entry) => entry._id),
    rangeStart,
    rangeEnd,
    startDateKey: firstDate,
    endDateKey,
    timezone,
    excludeFlowId,
  });

  const duration = Math.max(1, Number(service.duracaoMinutos) || 30);
  const earliest = now.getTime() + (minLead * 60 * 1000);
  const options = [];
  for (let dayOffset = 0; dayOffset < searchDays && options.length < limit; dayOffset += 1) {
    const dateKey = addDays(firstDate, dayOffset);
    const noon = zonedDateTimeToUtc(dateKey, '12:00', timezone);
    if (!noon) continue;
    const weekday = zonedParts(noon, timezone).weekday;
    const storeRange = resolveStoreRange({ store, config, dateKey, weekday });
    if (!storeRange) continue;

    for (const professional of professionals) {
      const professionalRange = resolveProfessionalRange({
        professional,
        weekday,
        storeRange,
      });
      if (!professionalRange) continue;
      const professionalBusy = busy.get(String(professional._id)) || [];
      const preferred = Number.isFinite(Number(preferredMinutes))
        ? Math.min(1439, Math.max(0, Number(preferredMinutes)))
        : null;
      const roundedPreferred = preferred === null
        ? null
        : Math.ceil(preferred / slotInterval) * slotInterval;
      const minuteCandidates = [];
      const appendMinutes = (from, to) => {
        for (let minute = from; minute + duration <= to; minute += slotInterval) {
          minuteCandidates.push(minute);
        }
      };
      if (
        roundedPreferred !== null
        && roundedPreferred >= professionalRange.open
        && roundedPreferred < professionalRange.close
      ) {
        appendMinutes(roundedPreferred, professionalRange.close);
        appendMinutes(professionalRange.open, roundedPreferred);
      } else {
        appendMinutes(professionalRange.open, professionalRange.close);
      }
      for (const minute of minuteCandidates) {
        const startAt = dateTimeFromMinutes(dateKey, minute, timezone);
        if (!startAt || startAt.getTime() < earliest) continue;
        const endAt = new Date(startAt.getTime() + (duration * 60 * 1000));
        const hitsBreak = professionalRange.breaks.some((entry) => (
          intervalsOverlap(minute, minute + duration, entry.start, entry.end)
        ));
        if (hitsBreak) continue;
        const conflict = professionalBusy.some((entry) => (
          intervalsOverlap(
            startAt.getTime(),
            endAt.getTime(),
            entry.start,
            entry.end
          )
        ));
        if (conflict) continue;
        const time = `${pad2(Math.floor((minute % 1440) / 60))}:${pad2(minute % 60)}`;
        options.push({
          key: `${professional._id}:${startAt.toISOString()}`,
          startAt,
          endAt,
          date: zonedParts(startAt, timezone).dateKey,
          time,
          professional: professional._id,
          professionalName: professionalDisplayName(professional),
        });
        if (options.length >= limit) break;
      }
      if (options.length >= limit) break;
    }
  }
  return options;
};

const getServicePrice = async ({ storeId, service, pet }) => {
  if (pet?.tipo && pet?.raca) {
    const escapedBreed = clean(pet.raca).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const override = await ServiceBreedPrice.findOne({
      store: storeId,
      service: service._id,
      tipo: new RegExp(`^${clean(pet.tipo).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
      raca: new RegExp(`^${escapedBreed}$`, 'i'),
    }).select('valor').lean();
    if (override && Number(override.valor) >= 0) return Number(override.valor);
  }
  return Number(service.valor) || 0;
};

const buildLockBuckets = (startAt, endAt) => {
  const bucketMs = 15 * 60 * 1000;
  const keys = [];
  let cursor = Math.floor(startAt.getTime() / bucketMs) * bucketMs;
  while (cursor < endAt.getTime()) {
    keys.push({
      slotKey: String(Math.floor(cursor / bucketMs)),
      startsAt: new Date(cursor),
    });
    cursor += bucketMs;
  }
  return keys;
};

const claimSlotLocks = async ({ storeId, professionalId, flowId, startAt, endAt }) => {
  const buckets = buildLockBuckets(startAt, endAt);
  const createdIds = [];
  try {
    for (const bucket of buckets) {
      let existing = await WhatsappAppointmentSlotLock.findOne({
        store: storeId,
        professional: professionalId,
        slotKey: bucket.slotKey,
      });
      if (existing?.expiresAt && existing.expiresAt <= new Date()) {
        await WhatsappAppointmentSlotLock.deleteOne({
          _id: existing._id,
          expiresAt: { $lte: new Date() },
        });
        existing = null;
      }
      if (existing) {
        if (String(existing.flow) === String(flowId)) continue;
        const error = new Error('O horário acabou de ser reservado por outro cliente.');
        error.code = 'APPOINTMENT_SLOT_UNAVAILABLE';
        throw error;
      }
      try {
        const lock = await WhatsappAppointmentSlotLock.create({
          store: storeId,
          professional: professionalId,
          slotKey: bucket.slotKey,
          startsAt: bucket.startsAt,
          flow: flowId,
          expiresAt: new Date(endAt.getTime() + (24 * 60 * 60 * 1000)),
        });
        createdIds.push(lock._id);
      } catch (error) {
        if (error?.code === 11000) {
          const conflict = new Error('O horário acabou de ser reservado por outro cliente.');
          conflict.code = 'APPOINTMENT_SLOT_UNAVAILABLE';
          throw conflict;
        }
        throw error;
      }
    }
    return createdIds;
  } catch (error) {
    if (createdIds.length) {
      await WhatsappAppointmentSlotLock.deleteMany({ _id: { $in: createdIds } });
    }
    throw error;
  }
};

const createAppointmentFromFlow = async ({
  flow,
  customerId,
  petId,
  serviceId,
  option,
  intent,
  config,
}) => {
  const clientMutationId = `whatsapp-appointment:${flow.sessionId}`;
  const existing = await Appointment.findOne({ clientMutationId });
  if (existing) return { appointment: existing, replayed: true };

  const [customer, pet, service, professional] = await Promise.all([
    User.findOne({ _id: customerId, role: 'cliente' }).select('_id').lean(),
    Pet.findOne({ _id: petId, owner: customerId, obito: { $ne: true } }).lean(),
    Service.findOne({ _id: serviceId, ativo: { $ne: false } })
      .select('_id nome valor duracaoMinutos categorias grupo')
      .populate({ path: 'grupo', select: 'tiposPermitidos ativo' })
      .lean(),
    User.findOne({
      _id: option.professional,
      empresas: flow.store,
      role: { $in: ['funcionario', 'franqueado', 'franqueador', 'admin', 'admin_master'] },
    }).select('_id grupos').lean(),
  ]);
  if (!customer || !pet || !service || !professional || service?.grupo?.ativo === false) {
    const error = new Error('Os dados do agendamento deixaram de estar disponíveis.');
    error.code = 'APPOINTMENT_DATA_INVALID';
    throw error;
  }
  const types = allowedProfessionalTypes(service, intent);
  if (!professional.grupos?.some((type) => types.includes(type))) {
    const error = new Error('O profissional selecionado não atende este serviço.');
    error.code = 'APPOINTMENT_PROFESSIONAL_INVALID';
    throw error;
  }

  const exactOptions = await findAvailableSlots({
    storeId: flow.store,
    serviceId: service._id,
    intent,
    startDate: option.date,
    config: { ...config, appointmentMinLeadMinutes: 0 },
    now: new Date(),
    maxOptions: 5,
    excludeFlowId: flow._id,
    preferredMinutes: parseMinutes(option.time),
  });
  const stillAvailable = exactOptions.some((entry) => (
    String(entry.professional) === String(option.professional)
    && new Date(entry.startAt).getTime() === new Date(option.startAt).getTime()
  ));
  if (!stillAvailable) {
    const error = new Error('O horário selecionado não está mais disponível.');
    error.code = 'APPOINTMENT_SLOT_UNAVAILABLE';
    throw error;
  }

  const startAt = new Date(option.startAt);
  const endAt = new Date(startAt.getTime() + (
    Math.max(1, Number(service.duracaoMinutos) || 30) * 60 * 1000
  ));
  await claimSlotLocks({
    storeId: flow.store,
    professionalId: option.professional,
    flowId: flow._id,
    startAt,
    endAt,
  });

  try {
    const value = await getServicePrice({ storeId: flow.store, service, pet });
    const appointment = await Appointment.create({
      store: flow.store,
      cliente: customer._id,
      pet: pet._id,
      servico: service._id,
      itens: [{
        servico: service._id,
        valor: value,
        profissional: option.professional,
        data: option.date,
        hora: option.time,
        status: 'agendado',
        observacao: 'Agendado automaticamente pelo WhatsApp.',
      }],
      profissional: option.professional,
      scheduledAt: startAt,
      valor: value,
      pago: false,
      status: 'agendado',
      observacoes: 'Agendado automaticamente pelo WhatsApp.',
      source: 'whatsapp_automation',
      sourceReference: flow.sessionId,
      whatsappConversation: flow.conversation,
      whatsappFlow: flow._id,
      clientMutationId,
    });
    await WhatsappAppointmentSlotLock.updateMany(
      { flow: flow._id, appointment: null },
      { $set: { appointment: appointment._id } }
    );
    return { appointment, replayed: false, service, pet };
  } catch (error) {
    if (error?.code === 11000 && error?.keyPattern?.clientMutationId) {
      const replay = await Appointment.findOne({ clientMutationId });
      if (replay) return { appointment: replay, replayed: true, service, pet };
    }
    await WhatsappAppointmentSlotLock.deleteMany({
      flow: flow._id,
      appointment: null,
    });
    throw error;
  }
};

module.exports = {
  addDays,
  createAppointmentFromFlow,
  findAvailableSlots,
  findCustomerByWhatsapp,
  findServicesForIntent,
  getPetList,
  normalizeText,
  phoneCandidates,
  zonedDateTimeToUtc,
  zonedParts,
};
