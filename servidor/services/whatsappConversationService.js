const crypto = require('crypto');

const Store = require('../models/Store');
const WhatsappAuditEvent = require('../models/WhatsappAuditEvent');
const WhatsappAppointmentFlow = require('../models/WhatsappAppointmentFlow');
const WhatsappAutomationConfig = require('../models/WhatsappAutomationConfig');
const WhatsappAutomationJob = require('../models/WhatsappAutomationJob');
const WhatsappConversation = require('../models/WhatsappConversation');
const { resolveOperatingHours } = require('./whatsappOperatingHoursService');
const {
  cancelActiveAppointmentFlows,
} = require('./whatsappAppointmentFlowService');

const clean = (value) => (typeof value === 'string' ? value.trim() : '');
const digitsOnly = (value) => String(value || '').replace(/\D+/g, '');
const objectIdString = (value) => value ? String(value) : '';

const STATUS_MODE = Object.freeze({
  WAITING_HUMAN: 'waiting',
  BOT_ACTIVE: 'automation',
  HUMAN_ACTIVE: 'human',
  NEEDS_HUMAN: 'waiting',
  PAUSED: 'paused',
  CLOSED: 'closed',
});

const buildRoom = (storeId, phoneNumberId) => {
  const store = objectIdString(storeId);
  const phone = clean(phoneNumberId);
  if (!/^[a-fA-F0-9]{24}$/.test(store) || !/^\d{6,}$/.test(phone)) return '';
  return `whatsapp:store:${store}:number:${phone}`;
};

const mapConversationState = (conversation) => {
  if (!conversation) return null;
  return {
    id: objectIdString(conversation._id),
    storeId: objectIdString(conversation.store),
    phoneNumberId: conversation.phoneNumberId || '',
    waId: conversation.waId || '',
    status: conversation.status || 'WAITING_HUMAN',
    serviceMode: conversation.serviceMode || 'waiting',
    assignedTo: objectIdString(conversation.assignedTo),
    lastInboundMessageId: conversation.lastInboundMessageId || '',
    lastInboundAt: conversation.lastInboundAt || null,
    lastHumanAt: conversation.lastHumanAt || null,
    lastHumanSource: conversation.lastHumanSource || '',
    lastBotAt: conversation.lastBotAt || null,
    lastMessageAt: conversation.lastMessageAt || null,
    lastActorType: conversation.lastActorType || '',
    botEligibleAt: conversation.botEligibleAt || null,
    automationPausedUntil: conversation.automationPausedUntil || null,
    automationPauseReason: conversation.automationPauseReason || '',
    customerServiceWindowExpiresAt: conversation.customerServiceWindowExpiresAt || null,
    intent: conversation.intent || '',
    flow: conversation.flow || '',
    flowState: conversation.flowState || '',
    appointmentFlow: conversation.flow === 'appointment_booking'
      ? (conversation.flowData || null)
      : null,
    unreadCount: Number(conversation.unreadCount) || 0,
    priority: Number(conversation.priority) || 0,
    labels: Array.isArray(conversation.labels) ? conversation.labels : [],
    version: Number(conversation.version) || 0,
    closedAt: conversation.closedAt || null,
  };
};

const mapAutomationConfig = (config = {}) => ({
  enabled: Boolean(config.enabled),
  timezone: config.timezone || 'America/Sao_Paulo',
  humanGraceMinutes: Number(config.humanGraceMinutes) || 5,
  afterHoursImmediate: config.afterHoursImmediate !== false,
  humanTakeoverTimeoutMinutes: Number(config.humanTakeoverTimeoutMinutes) || 0,
  botName: config.botName || 'Assistente virtual',
  welcomeMessage: config.welcomeMessage || '',
  afterHoursMessage: config.afterHoursMessage || '',
  fallbackMessage: config.fallbackMessage || '',
  enabledFlows: Array.isArray(config.enabledFlows) ? config.enabledFlows : [],
  appointmentEnabled: Boolean(config.appointmentEnabled),
  appointmentMinLeadMinutes: Number.isFinite(Number(config.appointmentMinLeadMinutes))
    ? Number(config.appointmentMinLeadMinutes)
    : 60,
  appointmentSlotIntervalMinutes: Number(config.appointmentSlotIntervalMinutes) || 30,
  appointmentSearchDays: Number(config.appointmentSearchDays) || 14,
  appointmentMaxOptions: Number(config.appointmentMaxOptions) || 3,
  surveyEnabled: Boolean(config.surveyEnabled),
  surveyDelayMinutes: Number.isFinite(Number(config.surveyDelayMinutes))
    ? Number(config.surveyDelayMinutes)
    : 30,
  surveyQuestion: config.surveyQuestion || '',
  surveyTemplateName: config.surveyTemplateName || '',
  surveyTemplateLanguage: config.surveyTemplateLanguage || 'pt_BR',
  surveyTemplateApproved: Boolean(config.surveyTemplateApproved),
  surveyRequireOptIn: config.surveyRequireOptIn !== false,
  surveyResponseExpiresHours: Number(config.surveyResponseExpiresHours) || 168,
  surveyLowRatingThreshold: Number(config.surveyLowRatingThreshold) || 3,
  emergencyHandoffEnabled: config.emergencyHandoffEnabled !== false,
  paused: Boolean(config.paused),
  pauseReason: config.pauseReason || '',
  specialHours: Array.isArray(config.specialHours) ? config.specialHours : [],
  pilotAcknowledgedAt: config.pilotAcknowledgedAt || null,
  pilotAcknowledgedBy: objectIdString(config.pilotAcknowledgedBy),
  pilotChecklistVersion: config.pilotChecklistVersion || '',
  pilotReadinessFingerprint: config.pilotReadinessFingerprint || '',
});

const emitConversationState = (io, conversation, extra = {}) => {
  const mapped = mapConversationState(conversation);
  const room = buildRoom(mapped?.storeId, mapped?.phoneNumberId);
  if (!io || !room || !mapped) return;
  io.to(room).emit('whatsapp:conversation', {
    ...mapped,
    ...extra,
  });
};

const getAutomationConfig = async (storeId, phoneNumberId, options = {}) => {
  let config = await WhatsappAutomationConfig.findOne({
    store: storeId,
    phoneNumberId,
  });
  if (!config && options.create === true) {
    config = await WhatsappAutomationConfig.create({
      store: storeId,
      phoneNumberId,
    });
  }
  return config;
};

const getAutomationSnapshot = async ({ storeId, phoneNumberId, at = new Date() }) => {
  const [store, config] = await Promise.all([
    Store.findById(storeId).select('_id horario').lean(),
    getAutomationConfig(storeId, phoneNumberId),
  ]);
  const safeConfig = config || new WhatsappAutomationConfig({ store: storeId, phoneNumberId });
  return {
    configuration: mapAutomationConfig(safeConfig),
    workingHours: resolveOperatingHours({ store, config: safeConfig, at }),
  };
};

const cancelConversationJobs = async (conversationId, reason) => {
  if (!conversationId) return;
  await WhatsappAutomationJob.updateMany(
    {
      conversation: conversationId,
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
};

const createGraceJob = async ({
  conversation,
  runAt,
  expectedInboundMessageId,
  reason,
}) => {
  const inboundKey = clean(expectedInboundMessageId)
    || `${conversation.version}:${new Date(runAt).getTime()}`;
  const jobKey = clean(reason).startsWith('manual_release')
    ? `${inboundKey}:${clean(reason)}:${conversation.version}`
    : inboundKey;
  const idempotencyKey = [
    'human_grace_timeout',
    objectIdString(conversation.store),
    conversation.phoneNumberId,
    conversation.waId,
    jobKey,
  ].join(':');
  return WhatsappAutomationJob.findOneAndUpdate(
    { idempotencyKey },
    {
      $setOnInsert: {
        store: conversation.store,
        phoneNumberId: conversation.phoneNumberId,
        waId: conversation.waId,
        conversation: conversation._id,
        type: 'human_grace_timeout',
        status: 'pending',
        runAt,
        payload: {
          expectedInboundMessageId: clean(expectedInboundMessageId),
          reason: clean(reason),
        },
        idempotencyKey,
        attempts: 0,
        maxAttempts: 5,
      },
    },
    { upsert: true, new: true }
  );
};

const recordAudit = async ({
  conversation,
  userId,
  action,
  previousState,
  requestMeta = {},
}) => {
  if (!conversation) return;
  await WhatsappAuditEvent.create({
    store: conversation.store,
    phoneNumberId: conversation.phoneNumberId,
    waId: conversation.waId,
    conversation: conversation._id,
    user: userId || null,
    action,
    previousState: previousState || null,
    nextState: mapConversationState(conversation),
    correlationId: clean(requestMeta.correlationId),
    ip: clean(requestMeta.ip),
    userAgent: clean(requestMeta.userAgent),
  });
};

const upsertConversation = async (filter, update) => {
  try {
    return await WhatsappConversation.findOneAndUpdate(
      filter,
      update,
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  } catch (error) {
    if (error?.code !== 11000) throw error;
    return WhatsappConversation.findOneAndUpdate(filter, update, { new: true });
  }
};

const handleInboundMessage = async ({
  storeId,
  phoneNumberId,
  waId,
  messageId,
  messageAt = new Date(),
  suppressAutomation = false,
  io,
}) => {
  const customer = digitsOnly(waId);
  const phone = clean(phoneNumberId);
  if (!storeId || !phone || !customer) return null;

  const [store, config] = await Promise.all([
    Store.findById(storeId).select('_id horario').lean(),
    getAutomationConfig(storeId, phone),
  ]);
  const safeConfig = config || new WhatsappAutomationConfig({ store: storeId, phoneNumberId: phone });
  const hours = resolveOperatingHours({ store, config: safeConfig, at: messageAt });
  const current = await WhatsappConversation.findOne({
    store: storeId,
    phoneNumberId: phone,
    waId: customer,
  }).lean();
  const pauseActive = current?.status === 'PAUSED'
    && (!current.automationPausedUntil || new Date(current.automationPausedUntil) > messageAt);
  const automationEnabled = Boolean(
    !suppressAutomation
    && safeConfig.enabled
    && !safeConfig.paused
    && !pauseActive
  );
  const graceMs = Math.max(1, Number(safeConfig.humanGraceMinutes) || 5) * 60 * 1000;
  const immediate = !hours.isOpen && safeConfig.afterHoursImmediate !== false;
  const botEligibleAt = automationEnabled
    ? new Date(messageAt.getTime() + (immediate ? 0 : graceMs))
    : null;
  const nextStatus = pauseActive
    ? 'PAUSED'
    : immediate && automationEnabled
      ? 'BOT_ACTIVE'
      : 'WAITING_HUMAN';
  const serviceWindowExpiresAt = new Date(messageAt.getTime() + (24 * 60 * 60 * 1000));

  const conversation = await upsertConversation(
    { store: storeId, phoneNumberId: phone, waId: customer },
    {
      $set: {
        status: nextStatus,
        serviceMode: STATUS_MODE[nextStatus],
        lastInboundMessageId: clean(messageId),
        lastInboundAt: messageAt,
        lastMessageAt: messageAt,
        lastActorType: 'customer',
        botEligibleAt,
        customerServiceWindowExpiresAt: serviceWindowExpiresAt,
        closedAt: null,
      },
      $inc: { unreadCount: 1, version: 1 },
      $setOnInsert: {
        store: storeId,
        phoneNumberId: phone,
        waId: customer,
      },
    }
  );

  await cancelConversationJobs(conversation._id, 'Nova mensagem do cliente');
  if (automationEnabled && !pauseActive) {
    await createGraceJob({
      conversation,
      runAt: botEligibleAt,
      expectedInboundMessageId: clean(messageId),
      reason: hours.isOpen ? 'human_grace' : 'after_hours',
    });
  }
  emitConversationState(io, conversation, { workingHours: hours });
  return { conversation, hours, automationEnabled };
};

const handleHumanReply = async ({
  storeId,
  phoneNumberId,
  waId,
  userId,
  source = 'human_web',
  at = new Date(),
  io,
  requestMeta,
}) => {
  const customer = digitsOnly(waId);
  const phone = clean(phoneNumberId);
  if (!storeId || !phone || !customer) return null;
  const previous = await WhatsappConversation.findOne({
    store: storeId,
    phoneNumberId: phone,
    waId: customer,
  }).lean();
  const conversation = await upsertConversation(
    { store: storeId, phoneNumberId: phone, waId: customer },
    {
      $set: {
        status: 'HUMAN_ACTIVE',
        serviceMode: 'human',
        assignedTo: userId || previous?.assignedTo || null,
        lastHumanAt: at,
        lastHumanSource: source,
        lastMessageAt: at,
        lastActorType: source === 'human_mobile' ? 'human_mobile' : 'human_web',
        botEligibleAt: null,
        automationPausedUntil: null,
        automationPauseReason: '',
        intent: '',
        flow: '',
        flowState: '',
        flowData: null,
        closedAt: null,
      },
      $inc: { version: 1 },
      $setOnInsert: { store: storeId, phoneNumberId: phone, waId: customer },
    }
  );
  await cancelConversationJobs(conversation._id, 'Resposta humana');
  await cancelActiveAppointmentFlows({
    conversationId: conversation._id,
    reason: source === 'human_mobile' ? 'human_reply_mobile' : 'human_reply_web',
    userId,
  });
  await recordAudit({
    conversation,
    userId,
    action: source === 'human_mobile' ? 'human_reply_mobile' : 'human_reply_web',
    previousState: previous ? mapConversationState(previous) : null,
    requestMeta,
  });
  emitConversationState(io, conversation);
  return conversation;
};

const transitionConversation = async ({
  storeId,
  phoneNumberId,
  waId,
  action,
  userId,
  pauseMinutes,
  reason,
  io,
  requestMeta,
}) => {
  const customer = digitsOnly(waId);
  const phone = clean(phoneNumberId);
  const filter = { store: storeId, phoneNumberId: phone, waId: customer };
  let current = await WhatsappConversation.findOne(filter);
  if (!current) {
    current = await WhatsappConversation.create({
      ...filter,
      status: 'WAITING_HUMAN',
      serviceMode: 'waiting',
    });
  }
  const previousState = mapConversationState(current);
  const now = new Date();

  if (action === 'takeover') {
    current.status = 'HUMAN_ACTIVE';
    current.serviceMode = 'human';
    current.assignedTo = userId || current.assignedTo;
    current.lastHumanAt = now;
    current.lastHumanSource = 'manual_takeover';
    current.lastActorType = 'human_web';
    current.botEligibleAt = null;
    current.closedAt = null;
    current.intent = '';
    current.flow = '';
    current.flowState = '';
    current.flowData = null;
  } else if (action === 'pause') {
    const minutes = Math.max(0, Number(pauseMinutes) || 0);
    current.status = 'PAUSED';
    current.serviceMode = 'paused';
    current.assignedTo = userId || current.assignedTo;
    current.automationPausedUntil = minutes
      ? new Date(now.getTime() + (minutes * 60 * 1000))
      : null;
    current.automationPauseReason = clean(reason) || 'Pausa manual';
    current.botEligibleAt = null;
    current.intent = '';
    current.flow = '';
    current.flowState = '';
    current.flowData = null;
  } else if (action === 'close') {
    current.status = 'CLOSED';
    current.serviceMode = 'closed';
    current.botEligibleAt = null;
    current.closedAt = now;
    current.intent = '';
    current.flow = '';
    current.flowState = '';
    current.flowData = null;
  } else if (action === 'release') {
    const [store, config] = await Promise.all([
      Store.findById(storeId).select('_id horario').lean(),
      getAutomationConfig(storeId, phone),
    ]);
    const safeConfig = config || new WhatsappAutomationConfig({ store: storeId, phoneNumberId: phone });
    const hours = resolveOperatingHours({ store, config: safeConfig, at: now });
    const automationEnabled = Boolean(safeConfig.enabled && !safeConfig.paused);
    const immediate = automationEnabled && !hours.isOpen && safeConfig.afterHoursImmediate !== false;
    const graceMs = Math.max(1, Number(safeConfig.humanGraceMinutes) || 5) * 60 * 1000;
    current.status = immediate ? 'BOT_ACTIVE' : 'WAITING_HUMAN';
    current.serviceMode = STATUS_MODE[current.status];
    current.assignedTo = null;
    current.automationPausedUntil = null;
    current.automationPauseReason = '';
    current.botEligibleAt = automationEnabled
      ? new Date(now.getTime() + (immediate ? 0 : graceMs))
      : null;
    current.closedAt = null;
    await current.save();
    await cancelConversationJobs(current._id, 'Atendimento liberado');
    if (automationEnabled) {
      await createGraceJob({
        conversation: current,
        runAt: current.botEligibleAt,
        expectedInboundMessageId: current.lastInboundMessageId,
        reason: hours.isOpen ? 'manual_release' : 'manual_release_after_hours',
      });
    }
    current.version += 1;
    await current.save();
    await recordAudit({
      conversation: current,
      userId,
      action,
      previousState,
      requestMeta,
    });
    emitConversationState(io, current, { workingHours: hours });
    return current;
  } else {
    throw Object.assign(new Error('Ação de atendimento inválida.'), {
      code: 'WHATSAPP_CONVERSATION_ACTION_INVALID',
    });
  }

  current.version += 1;
  await current.save();
  await cancelConversationJobs(current._id, `Ação manual: ${action}`);
  if (['takeover', 'pause', 'close'].includes(action)) {
    await cancelActiveAppointmentFlows({
      conversationId: current._id,
      reason: `manual_${action}`,
      userId,
    });
  }
  await recordAudit({
    conversation: current,
    userId,
    action,
    previousState,
    requestMeta,
  });
  emitConversationState(io, current);
  return current;
};

const updateAutomationConfig = async ({
  storeId,
  phoneNumberId,
  payload,
  userId,
  pilotAcknowledgement,
}) => {
  const allowed = {};
  if (Object.prototype.hasOwnProperty.call(payload, 'enabled')) {
    allowed.enabled = payload.enabled === true;
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'timezone')) {
    allowed.timezone = clean(payload.timezone) || 'America/Sao_Paulo';
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'humanGraceMinutes')) {
    allowed.humanGraceMinutes = Math.min(
      120,
      Math.max(1, Number(payload.humanGraceMinutes) || 5)
    );
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'afterHoursImmediate')) {
    allowed.afterHoursImmediate = payload.afterHoursImmediate === true;
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'surveyEnabled')) {
    allowed.surveyEnabled = payload.surveyEnabled === true;
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'appointmentEnabled')) {
    allowed.appointmentEnabled = payload.appointmentEnabled === true;
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'appointmentMinLeadMinutes')) {
    const value = Number(payload.appointmentMinLeadMinutes);
    allowed.appointmentMinLeadMinutes = Math.min(
      10080,
      Math.max(0, Number.isFinite(value) ? value : 60)
    );
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'appointmentSlotIntervalMinutes')) {
    const value = Number(payload.appointmentSlotIntervalMinutes);
    allowed.appointmentSlotIntervalMinutes = [15, 30, 60].includes(value) ? value : 30;
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'appointmentSearchDays')) {
    allowed.appointmentSearchDays = Math.min(
      30,
      Math.max(1, Number(payload.appointmentSearchDays) || 14)
    );
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'appointmentMaxOptions')) {
    allowed.appointmentMaxOptions = Math.min(
      5,
      Math.max(1, Number(payload.appointmentMaxOptions) || 3)
    );
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'enabledFlows')) {
    const enabledFlows = Array.isArray(payload.enabledFlows) ? payload.enabledFlows : [];
    allowed.enabledFlows = enabledFlows.filter((entry) => (
      ['veterinary_appointment', 'grooming_appointment'].includes(entry)
    ));
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'surveyRequireOptIn')) {
    allowed.surveyRequireOptIn = payload.surveyRequireOptIn !== false;
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'surveyTemplateApproved')) {
    allowed.surveyTemplateApproved = payload.surveyTemplateApproved === true;
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'surveyDelayMinutes')) {
    allowed.surveyDelayMinutes = Math.min(
      10080,
      Math.max(0, Number(payload.surveyDelayMinutes) || 0)
    );
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'surveyResponseExpiresHours')) {
    allowed.surveyResponseExpiresHours = Math.min(
      720,
      Math.max(1, Number(payload.surveyResponseExpiresHours) || 168)
    );
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'surveyLowRatingThreshold')) {
    allowed.surveyLowRatingThreshold = Math.min(
      5,
      Math.max(1, Number(payload.surveyLowRatingThreshold) || 3)
    );
  }
  [
    'botName',
    'welcomeMessage',
    'afterHoursMessage',
    'fallbackMessage',
    'pauseReason',
    'surveyQuestion',
    'surveyTemplateName',
    'surveyTemplateLanguage',
  ].forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(payload, field)) {
      allowed[field] = clean(payload[field]);
    }
  });
  if (Object.prototype.hasOwnProperty.call(payload, 'paused')) {
    allowed.paused = payload.paused === true;
  }
  if (pilotAcknowledgement) {
    allowed.pilotAcknowledgedAt = pilotAcknowledgement.at || new Date();
    allowed.pilotAcknowledgedBy = pilotAcknowledgement.userId || userId || null;
    allowed.pilotChecklistVersion = clean(pilotAcknowledgement.version);
    allowed.pilotReadinessFingerprint = clean(pilotAcknowledgement.fingerprint);
  }
  allowed.updatedBy = userId || null;

  const config = await WhatsappAutomationConfig.findOneAndUpdate(
    { store: storeId, phoneNumberId },
    {
      $set: allowed,
      $setOnInsert: { store: storeId, phoneNumberId },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  if (!config.enabled || config.paused) {
    await WhatsappAutomationJob.updateMany(
      {
        store: storeId,
        phoneNumberId,
        status: { $in: ['pending', 'processing'] },
      },
      {
        $set: {
          status: 'cancelled',
          cancelledAt: new Date(),
          lastError: config.paused ? 'Automação pausada' : 'Automação desativada',
          leaseUntil: null,
          lockedAt: null,
          lockedBy: '',
        },
      }
    );
  }
  if (!config.enabled || config.paused || !config.appointmentEnabled) {
    await Promise.all([
      WhatsappAutomationJob.updateMany(
        {
          store: storeId,
          phoneNumberId,
          type: 'appointment_flow_reply',
          status: { $in: ['pending', 'processing'] },
        },
        {
          $set: {
            status: 'cancelled',
            cancelledAt: new Date(),
            lastError: 'Agendamento conversacional desativado',
            leaseUntil: null,
            lockedAt: null,
            lockedBy: '',
          },
        }
      ),
      WhatsappAppointmentFlow.updateMany(
        {
          store: storeId,
          phoneNumberId,
          status: { $in: ['collecting', 'awaiting_confirmation', 'booking'] },
        },
        {
          $set: {
            status: 'cancelled',
            step: 'cancelled',
            cancelledAt: new Date(),
            handoffReason: 'appointment_automation_disabled',
          },
        }
      ),
    ]);
  }
  return config;
};

const enrichConversationSummaries = async ({
  storeId,
  phoneNumberId,
  conversations,
}) => {
  const waIds = (Array.isArray(conversations) ? conversations : [])
    .map((entry) => digitsOnly(entry?.waId))
    .filter(Boolean);
  if (!waIds.length) return conversations || [];
  const states = await WhatsappConversation.find({
    store: storeId,
    phoneNumberId,
    waId: { $in: waIds },
  }).lean();
  const byWaId = new Map(states.map((entry) => [entry.waId, mapConversationState(entry)]));
  return conversations.map((entry) => ({
    ...entry,
    conversationState: byWaId.get(digitsOnly(entry.waId)) || null,
  }));
};

const getConversationState = async ({ storeId, phoneNumberId, waId }) => {
  const conversation = await WhatsappConversation.findOne({
    store: storeId,
    phoneNumberId,
    waId: digitsOnly(waId),
  }).lean();
  return mapConversationState(conversation);
};

const buildRequestMeta = (req) => ({
  correlationId: clean(req.headers?.['x-correlation-id']) || crypto.randomUUID(),
  ip: clean(req.ip),
  userAgent: clean(req.headers?.['user-agent']),
});

module.exports = {
  buildRequestMeta,
  cancelConversationJobs,
  emitConversationState,
  enrichConversationSummaries,
  getAutomationConfig,
  getAutomationSnapshot,
  getConversationState,
  handleHumanReply,
  handleInboundMessage,
  mapAutomationConfig,
  mapConversationState,
  transitionConversation,
  updateAutomationConfig,
};
