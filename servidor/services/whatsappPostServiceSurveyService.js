const mongoose = require('mongoose');

const Appointment = require('../models/Appointment');
const Store = require('../models/Store');
const User = require('../models/User');
const WhatsappAuditEvent = require('../models/WhatsappAuditEvent');
const WhatsappAutomationConfig = require('../models/WhatsappAutomationConfig');
const WhatsappAutomationJob = require('../models/WhatsappAutomationJob');
const WhatsappContactPreference = require('../models/WhatsappContactPreference');
const WhatsappConversation = require('../models/WhatsappConversation');
const WhatsappIntegration = require('../models/WhatsappIntegration');
const WhatsappServiceSurvey = require('../models/WhatsappServiceSurvey');
const { emitConversationState } = require('./whatsappConversationService');

const clean = (value) => (typeof value === 'string' ? value.trim() : '');
const digitsOnly = (value) => String(value || '').replace(/\D+/g, '');
const objectIdString = (value) => value ? String(value) : '';

const normalizeKeyword = (value) => clean(value)
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .trim();

const OPT_OUT_KEYWORDS = new Set([
  'sair',
  'parar',
  'cancelar',
  'stop',
  'nao quero receber',
  'nao enviar mensagens',
]);

const OPT_IN_KEYWORDS = new Set([
  'autorizo',
  'aceito receber',
  'quero receber',
  'iniciar',
]);

const normalizeBrazilWhatsappId = (value) => {
  let digits = digitsOnly(value);
  if (!digits) return '';
  if (digits.startsWith('00')) digits = digits.slice(2);
  if ((digits.length === 10 || digits.length === 11) && !digits.startsWith('55')) {
    digits = `55${digits}`;
  }
  return digits.length >= 12 && digits.length <= 15 ? digits : '';
};

const resolveCustomerWaId = (customer = {}) => {
  const candidates = [
    customer.celular,
    customer.telefone,
    customer.celularSecundario,
    customer.telefoneSecundario,
  ];
  for (const candidate of candidates) {
    const normalized = normalizeBrazilWhatsappId(candidate);
    if (normalized) return normalized;
  }
  return '';
};

const selectSurveyEnvironment = async (storeId) => {
  const [integration, configs] = await Promise.all([
    WhatsappIntegration.findOne({ store: storeId }).lean(),
    WhatsappAutomationConfig.find({
      store: storeId,
      surveyEnabled: true,
    }).sort({ updatedAt: -1 }).lean(),
  ]);
  if (!integration || !configs.length) return null;
  const connectedNumbers = new Map(
    (integration.phoneNumbers || [])
      .filter((number) => number?.status === 'Conectado')
      .map((number) => [clean(number.phoneNumberId), number])
  );
  const config = configs.find((entry) => connectedNumbers.has(clean(entry.phoneNumberId)));
  if (!config) return null;
  return {
    integration,
    config,
    number: connectedNumbers.get(clean(config.phoneNumberId)),
  };
};

const ensureConversation = async ({
  storeId,
  phoneNumberId,
  waId,
  customerId,
}) => {
  try {
    return await WhatsappConversation.findOneAndUpdate(
      { store: storeId, phoneNumberId, waId },
      {
        $set: { customer: customerId || null },
        $setOnInsert: {
          store: storeId,
          phoneNumberId,
          waId,
          status: 'CLOSED',
          serviceMode: 'closed',
          closedAt: new Date(),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  } catch (error) {
    if (error?.code !== 11000) throw error;
    return WhatsappConversation.findOne({ store: storeId, phoneNumberId, waId });
  }
};

const createSurveyRecord = async (payload) => {
  try {
    return await WhatsappServiceSurvey.create(payload);
  } catch (error) {
    if (error?.code !== 11000) throw error;
    return WhatsappServiceSurvey.findOne({
      store: payload.store,
      appointment: payload.appointment,
    });
  }
};

const schedulePostServiceSurvey = async ({
  appointmentId,
  completedAt = new Date(),
  userId,
  source = 'appointment_finalized',
} = {}) => {
  if (!mongoose.Types.ObjectId.isValid(appointmentId)) {
    return { scheduled: false, reason: 'invalid_appointment' };
  }
  const existing = await WhatsappServiceSurvey.findOne({
    appointment: appointmentId,
  });
  if (existing) return { scheduled: false, reason: 'already_registered', survey: existing };

  const appointment = await Appointment.findById(appointmentId)
    .select('_id store cliente pet status deletedAt')
    .lean();
  if (!appointment || appointment.deletedAt || appointment.status !== 'finalizado') {
    return { scheduled: false, reason: 'appointment_not_finalized' };
  }

  const environment = await selectSurveyEnvironment(appointment.store);
  if (!environment) return { scheduled: false, reason: 'survey_not_configured' };

  const [customer, store] = await Promise.all([
    User.findById(appointment.cliente)
      .select('_id celular telefone celularSecundario telefoneSecundario')
      .lean(),
    Store.findById(appointment.store).select('_id nome nomeFantasia razaoSocial').lean(),
  ]);
  const waId = resolveCustomerWaId(customer);
  if (!customer || !waId) return { scheduled: false, reason: 'customer_without_whatsapp' };

  const phoneNumberId = clean(environment.config.phoneNumberId);
  const conversation = await ensureConversation({
    storeId: appointment.store,
    phoneNumberId,
    waId,
    customerId: customer._id,
  });
  const preference = await WhatsappContactPreference.findOne({
    store: appointment.store,
    waId,
  }).lean();
  const delayMinutes = Math.min(
    10080,
    Math.max(0, Number(environment.config.surveyDelayMinutes) || 0)
  );
  const scheduledAt = new Date(new Date(completedAt).getTime() + (delayMinutes * 60 * 1000));
  const idempotencyKey = `post_service_survey:${appointment.store}:${appointment._id}`;
  const baseSurvey = {
    store: appointment.store,
    phoneNumberId,
    waId,
    conversation: conversation._id,
    appointment: appointment._id,
    customer: customer._id,
    pet: appointment.pet || null,
    idempotencyKey,
    source,
    serviceCompletedAt: completedAt,
    scheduledAt,
    questionSnapshot: clean(environment.config.surveyQuestion),
    templateName: clean(environment.config.surveyTemplateName),
    templateLanguage: clean(environment.config.surveyTemplateLanguage) || 'pt_BR',
    lowRatingThreshold: Math.min(
      5,
      Math.max(1, Number(environment.config.surveyLowRatingThreshold) || 3)
    ),
    createdBy: userId || null,
  };

  if (preference?.status === 'opted_out') {
    const survey = await createSurveyRecord({
      ...baseSurvey,
      status: 'skipped',
      skipReason: 'contact_opted_out',
    });
    return { scheduled: false, reason: 'contact_opted_out', survey };
  }

  const survey = await createSurveyRecord({
    ...baseSurvey,
    status: 'scheduled',
  });
  if (survey.status !== 'scheduled') {
    return { scheduled: false, reason: survey.skipReason || survey.status, survey };
  }
  await WhatsappAutomationJob.findOneAndUpdate(
    { idempotencyKey },
    {
      $setOnInsert: {
        store: appointment.store,
        phoneNumberId,
        waId,
        conversation: conversation._id,
        type: 'post_service_survey',
        status: 'pending',
        runAt: scheduledAt,
        payload: {
          surveyId: objectIdString(survey._id),
          appointmentId: objectIdString(appointment._id),
          storeName: store?.nomeFantasia || store?.nome || store?.razaoSocial || '',
        },
        idempotencyKey,
        attempts: 0,
        maxAttempts: 5,
      },
    },
    { upsert: true, new: true }
  );
  return { scheduled: true, survey };
};

const cancelPostServiceSurvey = async ({
  appointmentId,
  reason = 'appointment_reopened',
} = {}) => {
  if (!mongoose.Types.ObjectId.isValid(appointmentId)) return false;
  const survey = await WhatsappServiceSurvey.findOneAndUpdate(
    {
      appointment: appointmentId,
      status: 'scheduled',
    },
    {
      $set: {
        status: 'cancelled',
        skipReason: clean(reason),
      },
    },
    { new: true }
  );
  if (!survey) return false;
  await WhatsappAutomationJob.updateMany(
    {
      idempotencyKey: survey.idempotencyKey,
      status: { $in: ['pending', 'processing'] },
    },
    {
      $set: {
        status: 'cancelled',
        cancelledAt: new Date(),
        lastError: clean(reason),
        leaseUntil: null,
        lockedAt: null,
        lockedBy: '',
      },
    }
  );
  return true;
};

const setContactPreference = async ({
  storeId,
  waId,
  status,
  source,
  proof,
  customerId,
  userId,
  at = new Date(),
}) => {
  const normalizedWaId = digitsOnly(waId);
  const normalizedStatus = ['unknown', 'opted_in', 'opted_out'].includes(status)
    ? status
    : 'unknown';
  const previous = await WhatsappContactPreference.findOne({
    store: storeId,
    waId: normalizedWaId,
  }).lean();
  const set = {
    status: normalizedStatus,
    source: clean(source),
    proof: clean(proof),
  };
  if (customerId) set.customer = customerId;
  if (userId) set.updatedBy = userId;
  if (normalizedStatus === 'opted_in') {
    set.optedInAt = at;
    set.optedOutAt = null;
  } else if (normalizedStatus === 'opted_out') {
    set.optedOutAt = at;
  }
  const preference = await WhatsappContactPreference.findOneAndUpdate(
    { store: storeId, waId: normalizedWaId },
    {
      $set: set,
      $setOnInsert: { store: storeId, waId: normalizedWaId },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  await WhatsappAuditEvent.create({
    store: storeId,
    waId: normalizedWaId,
    user: userId || null,
    action: `contact_preference_${normalizedStatus}`,
    previousState: previous ? mapContactPreference(previous) : null,
    nextState: mapContactPreference(preference),
  });
  if (normalizedStatus === 'opted_out') {
    const scheduledSurveys = await WhatsappServiceSurvey.find({
      store: storeId,
      waId: normalizedWaId,
      status: 'scheduled',
    }).select('idempotencyKey');
    const keys = scheduledSurveys.map((entry) => entry.idempotencyKey).filter(Boolean);
    await Promise.all([
      WhatsappServiceSurvey.updateMany(
        { store: storeId, waId: normalizedWaId, status: 'scheduled' },
        { $set: { status: 'cancelled', skipReason: 'contact_opted_out' } }
      ),
      keys.length
        ? WhatsappAutomationJob.updateMany(
            { idempotencyKey: { $in: keys }, status: { $in: ['pending', 'processing'] } },
            {
              $set: {
                status: 'cancelled',
                cancelledAt: at,
                lastError: 'Contato solicitou opt-out',
                leaseUntil: null,
                lockedAt: null,
                lockedBy: '',
              },
            }
          )
        : Promise.resolve(),
    ]);
  }
  return preference;
};

const mapContactPreference = (preference) => ({
  status: preference?.status || 'unknown',
  source: preference?.source || '',
  proof: preference?.proof || '',
  optedInAt: preference?.optedInAt || null,
  optedOutAt: preference?.optedOutAt || null,
  lastInboundAt: preference?.lastInboundAt || null,
});

const parseSurveyRating = (message) => {
  const match = clean(message).match(/^\s*([1-5])(?:\s|$|[.,;:!?\-⭐])/u);
  return match ? Number(match[1]) : null;
};

const handleSurveyInboundResponse = async ({
  storeId,
  phoneNumberId,
  waId,
  message,
  messageId,
  messageAt = new Date(),
} = {}) => {
  const normalizedWaId = digitsOnly(waId);
  const keyword = normalizeKeyword(message);
  await WhatsappContactPreference.findOneAndUpdate(
    { store: storeId, waId: normalizedWaId },
    {
      $set: { lastInboundAt: messageAt },
      $setOnInsert: { store: storeId, waId: normalizedWaId },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  if (OPT_OUT_KEYWORDS.has(keyword)) {
    const preference = await setContactPreference({
      storeId,
      waId: normalizedWaId,
      status: 'opted_out',
      source: 'whatsapp_keyword',
      proof: clean(message),
      at: messageAt,
    });
    return { handled: true, type: 'opt_out', preference };
  }
  if (OPT_IN_KEYWORDS.has(keyword)) {
    const preference = await setContactPreference({
      storeId,
      waId: normalizedWaId,
      status: 'opted_in',
      source: 'whatsapp_keyword',
      proof: clean(message),
      at: messageAt,
    });
    return { handled: true, type: 'opt_in', preference };
  }

  const survey = await WhatsappServiceSurvey.findOne({
    store: storeId,
    phoneNumberId,
    waId: normalizedWaId,
    status: 'sent',
    responseExpiresAt: { $gt: messageAt },
  }).sort({ sentAt: -1 });
  if (!survey) return { handled: false };
  const rating = parseSurveyRating(message);
  if (!rating) return { handled: false };

  const lowRating = rating <= (Number(survey.lowRatingThreshold) || 3);
  survey.status = lowRating ? 'escalated' : 'responded';
  survey.rating = rating;
  survey.feedback = clean(message);
  survey.respondedAt = messageAt;
  survey.responseMessageId = clean(messageId);
  await survey.save();
  return {
    handled: true,
    type: 'survey_rating',
    lowRating,
    rating,
    survey,
  };
};

const applySurveyConversationOutcome = async ({
  result,
  io,
} = {}) => {
  if (!result?.handled || result.type !== 'survey_rating' || !result.survey) return null;
  const survey = result.survey;
  let conversation;
  if (result.lowRating) {
    const current = await WhatsappConversation.findById(survey.conversation).lean();
    const keepHuman = current?.status === 'HUMAN_ACTIVE';
    conversation = await WhatsappConversation.findOneAndUpdate(
      { _id: survey.conversation },
      {
        $set: {
          ...(keepHuman ? {} : { status: 'NEEDS_HUMAN', serviceMode: 'waiting' }),
          botEligibleAt: null,
        },
        $max: { priority: 100 },
        $addToSet: { labels: 'avaliacao_baixa' },
        $inc: { version: 1 },
      },
      { new: true }
    );
  } else {
    conversation = await WhatsappConversation.findOneAndUpdate(
      {
        _id: survey.conversation,
        status: { $in: ['WAITING_HUMAN', 'BOT_ACTIVE', 'CLOSED'] },
      },
      {
        $set: {
          status: 'CLOSED',
          serviceMode: 'closed',
          botEligibleAt: null,
          closedAt: new Date(),
        },
        $addToSet: { labels: 'pesquisa_respondida' },
        $inc: { version: 1 },
      },
      { new: true }
    );
    if (!conversation) {
      conversation = await WhatsappConversation.findById(survey.conversation);
    }
  }
  if (conversation) {
    await WhatsappAuditEvent.create({
      store: survey.store,
      phoneNumberId: survey.phoneNumberId,
      waId: survey.waId,
      conversation: conversation._id,
      action: result.lowRating ? 'survey_low_rating' : 'survey_response',
      previousState: null,
      nextState: {
        surveyId: objectIdString(survey._id),
        appointmentId: objectIdString(survey.appointment),
        rating: result.rating,
        status: survey.status,
      },
    });
    emitConversationState(io, conversation, {
      survey: {
        id: objectIdString(survey._id),
        rating: result.rating,
        lowRating: result.lowRating,
      },
    });
  }
  return conversation;
};

const getSurveyStats = async ({ storeId, phoneNumberId }) => {
  const rows = await WhatsappServiceSurvey.aggregate([
    {
      $match: {
        store: new mongoose.Types.ObjectId(storeId),
        phoneNumberId,
      },
    },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
        averageRating: { $avg: '$rating' },
      },
    },
  ]);
  const byStatus = {};
  let ratingTotal = 0;
  let ratingCount = 0;
  rows.forEach((row) => {
    byStatus[row._id] = row.count;
    if (Number.isFinite(row.averageRating)) {
      ratingTotal += row.averageRating * row.count;
      ratingCount += row.count;
    }
  });
  return {
    byStatus,
    averageRating: ratingCount ? Number((ratingTotal / ratingCount).toFixed(2)) : null,
  };
};

module.exports = {
  applySurveyConversationOutcome,
  cancelPostServiceSurvey,
  getSurveyStats,
  handleSurveyInboundResponse,
  mapContactPreference,
  normalizeBrazilWhatsappId,
  parseSurveyRating,
  resolveCustomerWaId,
  schedulePostServiceSurvey,
  setContactPreference,
};
