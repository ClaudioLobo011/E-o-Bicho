const os = require('os');
const crypto = require('crypto');

const Appointment = require('../models/Appointment');
const WhatsappAppointmentFlow = require('../models/WhatsappAppointmentFlow');
const WhatsappAutomationConfig = require('../models/WhatsappAutomationConfig');
const WhatsappAutomationJob = require('../models/WhatsappAutomationJob');
const WhatsappContact = require('../models/WhatsappContact');
const WhatsappContactPreference = require('../models/WhatsappContactPreference');
const WhatsappConversation = require('../models/WhatsappConversation');
const WhatsappIntegration = require('../models/WhatsappIntegration');
const WhatsappLog = require('../models/WhatsappLog');
const WhatsappServiceSurvey = require('../models/WhatsappServiceSurvey');
const { decryptText } = require('../utils/certificates');
const {
  emitConversationState,
} = require('./whatsappConversationService');

const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_API_VERSION || 'v25.0';
const GRAPH_ORIGIN = process.env.WHATSAPP_GRAPH_ORIGIN || 'https://graph.facebook.com';
const LEASE_MS = 60 * 1000;
const POLL_MS = Math.max(
  1000,
  Number.parseInt(process.env.WHATSAPP_AUTOMATION_POLL_MS, 10) || 2000
);

const clean = (value) => (typeof value === 'string' ? value.trim() : '');

const decryptAccessToken = (integration) => {
  if (!integration?.accessTokenStored || !integration?.accessTokenEncrypted) return '';
  try {
    return decryptText(integration.accessTokenEncrypted);
  } catch (_) {
    return '';
  }
};

const sendBotText = async ({
  accessToken,
  phoneNumberId,
  destination,
  message,
}) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(
      `${GRAPH_ORIGIN}/${GRAPH_VERSION}/${encodeURIComponent(phoneNumberId)}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: destination,
          type: 'text',
          text: { body: message },
        }),
        signal: controller.signal,
      }
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(
        clean(payload?.error?.message)
        || `A Meta recusou a mensagem automática (${response.status}).`
      );
      error.code = 'WHATSAPP_AUTOMATION_SEND_FAILED';
      throw error;
    }
    return {
      messageId: clean(payload?.messages?.[0]?.id),
      graphStatus: response.status,
    };
  } finally {
    clearTimeout(timer);
  }
};

const sendBotTemplate = async ({
  accessToken,
  phoneNumberId,
  destination,
  templateName,
  language,
}) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(
      `${GRAPH_ORIGIN}/${GRAPH_VERSION}/${encodeURIComponent(phoneNumberId)}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: destination,
          type: 'template',
          template: {
            name: templateName,
            language: { code: language || 'pt_BR' },
          },
        }),
        signal: controller.signal,
      }
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(
        clean(payload?.error?.message)
        || `A Meta recusou o template da pesquisa (${response.status}).`
      );
      error.code = 'WHATSAPP_SURVEY_TEMPLATE_SEND_FAILED';
      throw error;
    }
    return {
      messageId: clean(payload?.messages?.[0]?.id),
      graphStatus: response.status,
    };
  } finally {
    clearTimeout(timer);
  }
};

const completeJob = (job, detail = '') => WhatsappAutomationJob.updateOne(
  { _id: job._id, status: 'processing', lockedBy: job.lockedBy },
  {
    $set: {
      status: 'completed',
      completedAt: new Date(),
      leaseUntil: null,
      lockedAt: null,
      lockedBy: '',
      lastError: clean(detail),
    },
  }
);

const retryJob = async (job, error) => {
  const attempts = Number(job.attempts) || 1;
  const maxAttempts = Number(job.maxAttempts) || 5;
  const failed = attempts >= maxAttempts;
  const retryDelayMs = Math.min(15 * 60 * 1000, (2 ** attempts) * 15000);
  await WhatsappAutomationJob.updateOne(
    { _id: job._id, status: 'processing', lockedBy: job.lockedBy },
    {
      $set: {
        status: failed ? 'failed' : 'pending',
        runAt: failed ? job.runAt : new Date(Date.now() + retryDelayMs),
        leaseUntil: null,
        lockedAt: null,
        lockedBy: '',
        lastError: clean(error?.message) || 'Falha na automação',
      },
    }
  );
  if (job.type === 'post_service_survey' && job.payload?.surveyId) {
    await WhatsappServiceSurvey.updateOne(
      {
        _id: job.payload.surveyId,
        status: 'scheduled',
      },
      {
        $set: {
          ...(failed ? { status: 'failed' } : {}),
          lastError: clean(error?.message) || 'Falha no envio da pesquisa',
        },
      }
    );
  }
  if (job.type === 'appointment_flow_reply' && job.payload?.flowId) {
    await WhatsappAppointmentFlow.updateOne(
      { _id: job.payload.flowId },
      {
        $set: {
          lastError: clean(error?.message) || 'Falha ao responder fluxo de agendamento',
          ...(failed && job.payload?.flowStatus !== 'completed'
            ? {
                status: 'failed',
                step: 'handoff',
                handoffReason: 'reply_failed',
              }
            : {}),
        },
      }
    );
  }
};

const claimJob = async (workerId, now = new Date()) => WhatsappAutomationJob.findOneAndUpdate(
  {
    $or: [
      {
        status: 'pending',
        runAt: { $lte: now },
        $or: [
          { leaseUntil: null },
          { leaseUntil: { $lte: now } },
        ],
      },
      {
        status: 'processing',
        leaseUntil: { $lte: now },
      },
    ],
  },
  {
    $set: {
      status: 'processing',
      lockedAt: now,
      lockedBy: workerId,
      leaseUntil: new Date(now.getTime() + LEASE_MS),
    },
    $inc: { attempts: 1 },
  },
  {
    sort: { runAt: 1, _id: 1 },
    new: true,
  }
);

const executeHumanGraceJob = async ({ job, io }) => {
  const [config, integration, originalConversation] = await Promise.all([
    WhatsappAutomationConfig.findOne({
      store: job.store,
      phoneNumberId: job.phoneNumberId,
    }).lean(),
    WhatsappIntegration.findOne({
      store: job.store,
      'phoneNumbers.phoneNumberId': job.phoneNumberId,
    }).select('+accessTokenEncrypted'),
    WhatsappConversation.findById(job.conversation).lean(),
  ]);

  if (!config?.enabled || config.paused) {
    await completeJob(job, 'Automação desativada ou pausada');
    return { skipped: true };
  }
  if (!integration || ['disconnected', 'error'].includes(integration.onboardingStatus)) {
    throw new Error('Integração do WhatsApp indisponível para automação.');
  }
  if (!originalConversation) {
    await completeJob(job, 'Conversa não encontrada');
    return { skipped: true };
  }
  const serviceWindowExpiresAt = originalConversation.customerServiceWindowExpiresAt
    ? new Date(originalConversation.customerServiceWindowExpiresAt)
    : null;
  if (
    !serviceWindowExpiresAt
    || Number.isNaN(serviceWindowExpiresAt.getTime())
    || serviceWindowExpiresAt <= new Date()
  ) {
    const expiredConversation = await WhatsappConversation.findOneAndUpdate(
      { _id: originalConversation._id },
      {
        $set: {
          status: 'NEEDS_HUMAN',
          serviceMode: 'waiting',
          botEligibleAt: null,
        },
        $inc: { version: 1 },
      },
      { new: true }
    );
    await completeJob(job, 'Janela de atendimento de 24 horas expirada');
    emitConversationState(io, expiredConversation);
    return { skipped: true, reason: 'service_window_expired' };
  }
  const expectedInboundMessageId = clean(job.payload?.expectedInboundMessageId);
  const eligibleStatus = ['WAITING_HUMAN', 'BOT_ACTIVE'].includes(originalConversation.status);
  const inboundMatches = !expectedInboundMessageId
    || originalConversation.lastInboundMessageId === expectedInboundMessageId;
  const noLaterHumanReply = !originalConversation.lastHumanAt
    || !originalConversation.lastInboundAt
    || new Date(originalConversation.lastHumanAt) < new Date(originalConversation.lastInboundAt);
  if (!eligibleStatus || !inboundMatches || !noLaterHumanReply) {
    await completeJob(job, 'Conversa assumida ou alterada antes da automação');
    return { skipped: true };
  }

  const conversation = await WhatsappConversation.findOneAndUpdate(
    {
      _id: originalConversation._id,
      status: { $in: ['WAITING_HUMAN', 'BOT_ACTIVE'] },
      version: originalConversation.version,
      customerServiceWindowExpiresAt: { $gt: new Date() },
      ...(expectedInboundMessageId ? { lastInboundMessageId: expectedInboundMessageId } : {}),
      $or: [
        { lastHumanAt: null },
        { lastHumanAt: { $lt: originalConversation.lastInboundAt || new Date(0) } },
      ],
    },
    {
      $set: {
        status: 'BOT_ACTIVE',
        serviceMode: 'automation',
        botEligibleAt: null,
      },
      $inc: { version: 1 },
    },
    { new: true }
  );
  if (!conversation) {
    await completeJob(job, 'A condição atômica da automação não foi satisfeita');
    return { skipped: true };
  }

  const latest = await WhatsappConversation.findById(conversation._id).lean();
  const latestWindowExpiresAt = latest?.customerServiceWindowExpiresAt
    ? new Date(latest.customerServiceWindowExpiresAt)
    : null;
  if (
    latest?.status !== 'BOT_ACTIVE'
    || !latestWindowExpiresAt
    || Number.isNaN(latestWindowExpiresAt.getTime())
    || latestWindowExpiresAt <= new Date()
  ) {
    await completeJob(job, 'Atendimento humano assumiu antes do envio');
    return { skipped: true };
  }

  const reason = clean(job.payload?.reason);
  const message = reason.includes('after_hours')
    ? clean(config.afterHoursMessage)
    : clean(config.welcomeMessage);
  if (!message) {
    await completeJob(job, 'Mensagem automática não configurada');
    emitConversationState(io, conversation);
    return { skipped: true };
  }

  const accessToken = decryptAccessToken(integration);
  if (!accessToken) throw new Error('Token de acesso do WhatsApp indisponível.');
  const result = await sendBotText({
    accessToken,
    phoneNumberId: job.phoneNumberId,
    destination: job.waId,
    message,
  });
  const now = new Date();
  const number = integration.phoneNumbers.find(
    (entry) => entry.phoneNumberId === job.phoneNumberId
  );
  const idempotencyKey = `automation-job:${job._id}`;
  const log = await WhatsappLog.findOneAndUpdate(
    { store: job.store, phoneNumberId: job.phoneNumberId, idempotencyKey },
    {
      $set: {
        direction: 'outgoing',
        status: 'Enviado',
        phoneNumber: number?.phoneNumber || '',
        numberLabel: number?.displayName || number?.phoneNumber || '',
        origin: number?.phoneNumber || '',
        destination: job.waId,
        message,
        messageId: result.messageId,
        messageTimestamp: now,
        source: 'automation',
        actorType: 'bot',
        messageType: 'text',
        correlationId: clean(job.payload?.correlationId),
        meta: {
          graphStatus: result.graphStatus,
          automationJobId: String(job._id),
          reason,
        },
        updatedAt: now,
      },
      $setOnInsert: {
        store: job.store,
        phoneNumberId: job.phoneNumberId,
        idempotencyKey,
        createdAt: now,
      },
    },
    { upsert: true, new: true }
  );
  await Promise.all([
    WhatsappContact.updateOne(
      {
        store: job.store,
        phoneNumberId: job.phoneNumberId,
        waId: job.waId,
      },
      {
        $set: {
          lastMessage: message,
          lastMessageAt: now,
          lastDirection: 'outgoing',
          lastMessageId: result.messageId,
          lastStatus: 'Enviado',
          updatedAt: now,
        },
        $setOnInsert: {
          store: job.store,
          phoneNumberId: job.phoneNumberId,
          waId: job.waId,
          createdAt: now,
        },
      },
      { upsert: true }
    ),
    WhatsappConversation.updateOne(
      { _id: conversation._id, status: 'BOT_ACTIVE' },
      {
        $set: {
          lastBotAt: now,
          lastMessageAt: now,
          lastActorType: 'bot',
        },
        $inc: { version: 1 },
      }
    ),
  ]);
  await completeJob(job);

  const updatedConversation = await WhatsappConversation.findById(conversation._id);
  const room = buildRoom(job.store, job.phoneNumberId);
  if (io && room) {
    io.to(room).emit('whatsapp:message', {
      storeId: String(job.store),
      phoneNumberId: job.phoneNumberId,
      waId: job.waId,
      direction: 'outgoing',
      status: 'Enviado',
      message,
      messageId: result.messageId,
      origin: number?.phoneNumber || '',
      destination: job.waId,
      createdAt: log?.createdAt?.toISOString?.() || now.toISOString(),
      actorType: 'bot',
      source: 'automation',
    });
  }
  emitConversationState(io, updatedConversation);
  return { skipped: false, messageId: result.messageId };
};

const skipSurveyJob = async (job, survey, reason) => {
  if (survey) {
    await WhatsappServiceSurvey.updateOne(
      { _id: survey._id, status: 'scheduled' },
      {
        $set: {
          status: 'skipped',
          skipReason: clean(reason),
        },
      }
    );
  }
  await completeJob(job, reason);
  return { skipped: true, reason };
};

const executePostServiceSurveyJob = async ({ job, io }) => {
  const surveyId = clean(job.payload?.surveyId);
  const survey = surveyId
    ? await WhatsappServiceSurvey.findById(surveyId)
    : await WhatsappServiceSurvey.findOne({ idempotencyKey: job.idempotencyKey });
  if (!survey || survey.status !== 'scheduled') {
    await completeJob(job, 'Pesquisa inexistente ou já processada');
    return { skipped: true };
  }

  const [config, integration, conversation, appointment, preference] = await Promise.all([
    WhatsappAutomationConfig.findOne({
      store: survey.store,
      phoneNumberId: survey.phoneNumberId,
    }).lean(),
    WhatsappIntegration.findOne({
      store: survey.store,
      'phoneNumbers.phoneNumberId': survey.phoneNumberId,
    }).select('+accessTokenEncrypted'),
    WhatsappConversation.findById(survey.conversation),
    Appointment.findById(survey.appointment).select('_id status deletedAt').lean(),
    WhatsappContactPreference.findOne({
      store: survey.store,
      waId: survey.waId,
    }).lean(),
  ]);

  if (!config?.surveyEnabled) {
    return skipSurveyJob(job, survey, 'Pesquisa pós-atendimento desativada');
  }
  if (!appointment || appointment.deletedAt || appointment.status !== 'finalizado') {
    return skipSurveyJob(job, survey, 'Atendimento não está mais finalizado');
  }
  if (preference?.status === 'opted_out') {
    return skipSurveyJob(job, survey, 'Contato solicitou opt-out');
  }
  if (!integration || ['disconnected', 'error'].includes(integration.onboardingStatus)) {
    throw new Error('Integração do WhatsApp indisponível para enviar a pesquisa.');
  }
  if (!conversation) {
    return skipSurveyJob(job, survey, 'Conversa da pesquisa não encontrada');
  }

  const now = new Date();
  const windowExpiresAt = conversation.customerServiceWindowExpiresAt
    ? new Date(conversation.customerServiceWindowExpiresAt)
    : null;
  const hasOpenServiceWindow = Boolean(
    windowExpiresAt
    && !Number.isNaN(windowExpiresAt.getTime())
    && windowExpiresAt > now
  );
  const requiresOptIn = config.surveyRequireOptIn !== false;
  const templateName = clean(config.surveyTemplateName || survey.templateName);
  const templateLanguage = clean(
    config.surveyTemplateLanguage || survey.templateLanguage
  ) || 'pt_BR';
  const question = clean(config.surveyQuestion || survey.questionSnapshot)
    || 'Como foi sua experiência com o atendimento? Responda com uma nota de 1 a 5.';

  let sentMode = 'text';
  if (!hasOpenServiceWindow) {
    if (requiresOptIn && preference?.status !== 'opted_in') {
      return skipSurveyJob(job, survey, 'Consentimento não registrado para iniciar conversa');
    }
    if (!templateName) {
      return skipSurveyJob(job, survey, 'Template aprovado não configurado');
    }
    sentMode = 'template';
  }

  const accessToken = decryptAccessToken(integration);
  if (!accessToken) throw new Error('Token de acesso do WhatsApp indisponível.');
  const result = sentMode === 'template'
    ? await sendBotTemplate({
        accessToken,
        phoneNumberId: survey.phoneNumberId,
        destination: survey.waId,
        templateName,
        language: templateLanguage,
      })
    : await sendBotText({
        accessToken,
        phoneNumberId: survey.phoneNumberId,
        destination: survey.waId,
        message: question,
      });

  const number = integration.phoneNumbers.find(
    (entry) => entry.phoneNumberId === survey.phoneNumberId
  );
  const responseHours = Math.min(
    720,
    Math.max(1, Number(config.surveyResponseExpiresHours) || 168)
  );
  const responseExpiresAt = new Date(now.getTime() + (responseHours * 60 * 60 * 1000));
  const displayMessage = sentMode === 'template'
    ? `Pesquisa pós-atendimento (${templateName})`
    : question;
  const logIdempotencyKey = `automation-job:${job._id}`;
  const log = await WhatsappLog.findOneAndUpdate(
    {
      store: survey.store,
      phoneNumberId: survey.phoneNumberId,
      idempotencyKey: logIdempotencyKey,
    },
    {
      $set: {
        direction: 'outgoing',
        status: 'Enviado',
        phoneNumber: number?.phoneNumber || '',
        numberLabel: number?.displayName || number?.phoneNumber || '',
        origin: number?.phoneNumber || '',
        destination: survey.waId,
        message: displayMessage,
        messageId: result.messageId,
        messageTimestamp: now,
        source: 'automation_survey',
        actorType: 'bot',
        messageType: sentMode,
        idempotencyKey: logIdempotencyKey,
        meta: {
          graphStatus: result.graphStatus,
          automationJobId: String(job._id),
          surveyId: String(survey._id),
          appointmentId: String(survey.appointment),
          templateName: sentMode === 'template' ? templateName : '',
        },
        updatedAt: now,
      },
      $setOnInsert: {
        store: survey.store,
        phoneNumberId: survey.phoneNumberId,
        createdAt: now,
      },
    },
    { upsert: true, new: true }
  );

  await Promise.all([
    WhatsappServiceSurvey.updateOne(
      { _id: survey._id, status: 'scheduled' },
      {
        $set: {
          status: 'sent',
          sentAt: now,
          sentMode,
          messageId: result.messageId,
          responseExpiresAt,
          questionSnapshot: question,
          templateName,
          templateLanguage,
          lastError: '',
        },
      }
    ),
    WhatsappContact.updateOne(
      {
        store: survey.store,
        phoneNumberId: survey.phoneNumberId,
        waId: survey.waId,
      },
      {
        $set: {
          lastMessage: displayMessage,
          lastMessageAt: now,
          lastDirection: 'outgoing',
          lastMessageId: result.messageId,
          lastStatus: 'Enviado',
          updatedAt: now,
        },
        $setOnInsert: {
          store: survey.store,
          phoneNumberId: survey.phoneNumberId,
          waId: survey.waId,
          createdAt: now,
        },
      },
      { upsert: true }
    ),
    WhatsappConversation.updateOne(
      { _id: conversation._id },
      {
        $set: {
          status: 'BOT_ACTIVE',
          serviceMode: 'automation',
          lastBotAt: now,
          lastMessageAt: now,
          lastActorType: 'bot',
          botEligibleAt: null,
          closedAt: null,
        },
        $addToSet: { labels: 'pesquisa_pos_atendimento' },
        $inc: { version: 1 },
      }
    ),
  ]);
  await completeJob(job);

  const updatedConversation = await WhatsappConversation.findById(conversation._id);
  const room = buildRoom(survey.store, survey.phoneNumberId);
  if (io && room) {
    io.to(room).emit('whatsapp:message', {
      storeId: String(survey.store),
      phoneNumberId: survey.phoneNumberId,
      waId: survey.waId,
      direction: 'outgoing',
      status: 'Enviado',
      message: displayMessage,
      messageId: result.messageId,
      origin: number?.phoneNumber || '',
      destination: survey.waId,
      createdAt: log?.createdAt?.toISOString?.() || now.toISOString(),
      actorType: 'bot',
      messageType: sentMode,
      source: 'automation_survey',
      survey: {
        id: String(survey._id),
        appointmentId: String(survey.appointment),
      },
    });
    io.to(room).emit('whatsapp:survey', {
      storeId: String(survey.store),
      phoneNumberId: survey.phoneNumberId,
      waId: survey.waId,
      surveyId: String(survey._id),
      appointmentId: String(survey.appointment),
      status: 'sent',
      sentMode,
      sentAt: now.toISOString(),
    });
  }
  emitConversationState(io, updatedConversation);
  return { skipped: false, messageId: result.messageId, surveyId: String(survey._id) };
};

const executeAppointmentFlowReplyJob = async ({ job, io }) => {
  const flowId = clean(job.payload?.flowId);
  const reply = clean(job.payload?.reply);
  if (!flowId || !reply) {
    await completeJob(job, 'Resposta do agendamento sem conteúdo');
    return { skipped: true };
  }
  const [flow, config, integration, conversation] = await Promise.all([
    WhatsappAppointmentFlow.findById(flowId).lean(),
    WhatsappAutomationConfig.findOne({
      store: job.store,
      phoneNumberId: job.phoneNumberId,
    }).lean(),
    WhatsappIntegration.findOne({
      store: job.store,
      'phoneNumbers.phoneNumberId': job.phoneNumberId,
    }).select('+accessTokenEncrypted'),
    WhatsappConversation.findById(job.conversation).lean(),
  ]);
  if (!flow || flow.sessionId !== clean(job.payload?.sessionId)) {
    await completeJob(job, 'Fluxo de agendamento inexistente ou substituído');
    return { skipped: true };
  }
  if (!config?.enabled || config.paused || !config.appointmentEnabled) {
    await completeJob(job, 'Agendamento conversacional desativado');
    return { skipped: true };
  }
  if (!integration || ['disconnected', 'error'].includes(integration.onboardingStatus)) {
    throw new Error('Integração do WhatsApp indisponível para responder o agendamento.');
  }
  if (!conversation) {
    await completeJob(job, 'Conversa do agendamento não encontrada');
    return { skipped: true };
  }
  const expectedInboundMessageId = clean(job.payload?.expectedInboundMessageId);
  if (
    expectedInboundMessageId
    && conversation.lastInboundMessageId !== expectedInboundMessageId
  ) {
    await completeJob(job, 'Cliente enviou nova mensagem antes desta resposta');
    return { skipped: true };
  }
  if (['HUMAN_ACTIVE', 'PAUSED', 'CLOSED'].includes(conversation.status)) {
    await completeJob(job, 'Conversa assumida, pausada ou encerrada');
    return { skipped: true };
  }
  if (
    conversation.flow !== 'appointment_booking'
    || conversation.flowData?.sessionId !== flow.sessionId
  ) {
    await completeJob(job, 'Fluxo da conversa foi alterado');
    return { skipped: true };
  }
  const windowExpiresAt = conversation.customerServiceWindowExpiresAt
    ? new Date(conversation.customerServiceWindowExpiresAt)
    : null;
  if (
    !windowExpiresAt
    || Number.isNaN(windowExpiresAt.getTime())
    || windowExpiresAt <= new Date()
  ) {
    await WhatsappConversation.updateOne(
      { _id: conversation._id },
      {
        $set: {
          status: 'NEEDS_HUMAN',
          serviceMode: 'waiting',
          priority: 90,
          botEligibleAt: null,
        },
        $addToSet: { labels: 'janela_whatsapp_expirada' },
        $inc: { version: 1 },
      }
    );
    await completeJob(job, 'Janela de atendimento expirada');
    return { skipped: true };
  }

  const accessToken = decryptAccessToken(integration);
  if (!accessToken) throw new Error('Token de acesso do WhatsApp indisponível.');
  const result = await sendBotText({
    accessToken,
    phoneNumberId: job.phoneNumberId,
    destination: job.waId,
    message: reply,
  });
  const now = new Date();
  const number = integration.phoneNumbers.find(
    (entry) => entry.phoneNumberId === job.phoneNumberId
  );
  const idempotencyKey = `automation-job:${job._id}`;
  const log = await WhatsappLog.findOneAndUpdate(
    { store: job.store, phoneNumberId: job.phoneNumberId, idempotencyKey },
    {
      $set: {
        direction: 'outgoing',
        status: 'Enviado',
        phoneNumber: number?.phoneNumber || '',
        numberLabel: number?.displayName || number?.phoneNumber || '',
        origin: number?.phoneNumber || '',
        destination: job.waId,
        message: reply,
        messageId: result.messageId,
        messageTimestamp: now,
        source: 'automation_appointment',
        actorType: 'bot',
        messageType: 'text',
        correlationId: clean(job.payload?.correlationId),
        meta: {
          graphStatus: result.graphStatus,
          automationJobId: String(job._id),
          appointmentFlowId: String(flow._id),
          appointmentId: clean(job.payload?.appointmentId),
          flowStatus: flow.status,
          flowStep: flow.step,
        },
        updatedAt: now,
      },
      $setOnInsert: {
        store: job.store,
        phoneNumberId: job.phoneNumberId,
        idempotencyKey,
        createdAt: now,
      },
    },
    { upsert: true, new: true }
  );

  const finalMode = clean(job.payload?.finalMode);
  const conversationStatus = finalMode === 'close'
    ? 'CLOSED'
    : finalMode === 'handoff'
      ? 'NEEDS_HUMAN'
      : 'BOT_ACTIVE';
  const conversationMode = finalMode === 'close'
    ? 'closed'
    : finalMode === 'handoff'
      ? 'waiting'
      : 'automation';
  await Promise.all([
    WhatsappAppointmentFlow.updateOne(
      { _id: flow._id },
      {
        $set: {
          lastPrompt: reply,
          lastError: '',
        },
      }
    ),
    WhatsappContact.updateOne(
      {
        store: job.store,
        phoneNumberId: job.phoneNumberId,
        waId: job.waId,
      },
      {
        $set: {
          lastMessage: reply,
          lastMessageAt: now,
          lastDirection: 'outgoing',
          lastMessageId: result.messageId,
          lastStatus: 'Enviado',
          updatedAt: now,
        },
        $setOnInsert: {
          store: job.store,
          phoneNumberId: job.phoneNumberId,
          waId: job.waId,
          createdAt: now,
        },
      },
      { upsert: true }
    ),
    WhatsappConversation.updateOne(
      { _id: conversation._id },
      {
        $set: {
          status: conversationStatus,
          serviceMode: conversationMode,
          lastBotAt: now,
          lastMessageAt: now,
          lastActorType: 'bot',
          botEligibleAt: null,
          ...(finalMode === 'close' ? { closedAt: now } : { closedAt: null }),
          ...(finalMode === 'handoff' ? { priority: 90 } : {}),
        },
        $inc: { version: 1 },
      }
    ),
  ]);
  await completeJob(job);

  const updatedConversation = await WhatsappConversation.findById(conversation._id);
  const room = buildRoom(job.store, job.phoneNumberId);
  if (io && room) {
    io.to(room).emit('whatsapp:message', {
      storeId: String(job.store),
      phoneNumberId: job.phoneNumberId,
      waId: job.waId,
      direction: 'outgoing',
      status: 'Enviado',
      message: reply,
      messageId: result.messageId,
      origin: number?.phoneNumber || '',
      destination: job.waId,
      createdAt: log?.createdAt?.toISOString?.() || now.toISOString(),
      actorType: 'bot',
      messageType: 'text',
      source: 'automation_appointment',
      appointmentFlow: {
        id: String(flow._id),
        status: flow.status,
        step: flow.step,
        appointmentId: String(flow.appointment || ''),
      },
    });
  }
  emitConversationState(io, updatedConversation, {
    appointmentFlow: updatedConversation?.flowData || null,
  });
  return {
    skipped: false,
    messageId: result.messageId,
    appointmentFlowId: String(flow._id),
  };
};

const buildRoom = (storeId, phoneNumberId) => {
  const store = String(storeId || '').trim();
  const phone = clean(phoneNumberId);
  if (!/^[a-fA-F0-9]{24}$/.test(store) || !/^\d{6,}$/.test(phone)) return '';
  return `whatsapp:store:${store}:number:${phone}`;
};

const executeJob = async ({ job, io }) => {
  if (job.type === 'human_grace_timeout') {
    return executeHumanGraceJob({ job, io });
  }
  if (job.type === 'post_service_survey') {
    return executePostServiceSurveyJob({ job, io });
  }
  if (job.type === 'appointment_flow_reply') {
    return executeAppointmentFlowReplyJob({ job, io });
  }
  await completeJob(job, `Tipo ${job.type} ainda não possui executor`);
  return { skipped: true };
};

const runAutomationCycle = async ({
  workerId = `${os.hostname()}:${process.pid}:${crypto.randomUUID()}`,
  io,
  maxJobs = 10,
} = {}) => {
  let processed = 0;
  for (let index = 0; index < maxJobs; index += 1) {
    const job = await claimJob(workerId);
    if (!job) break;
    try {
      await executeJob({ job, io });
    } catch (error) {
      await retryJob(job, error);
      console.error('Falha em trabalho de automação do WhatsApp:', {
        jobId: String(job._id),
        type: job.type,
        message: clean(error?.message),
      });
    }
    processed += 1;
  }
  return processed;
};

const startWhatsappAutomationWorker = ({ io } = {}) => {
  if (String(process.env.WHATSAPP_AUTOMATION_WORKER_DISABLED || '').toLowerCase() === 'true') {
    return { stop() {} };
  }
  const workerId = `${os.hostname()}:${process.pid}:${crypto.randomUUID()}`;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runAutomationCycle({ workerId, io });
    } catch (error) {
      console.error('Erro no worker de automação do WhatsApp:', error);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => {
    void tick();
  }, POLL_MS);
  timer.unref?.();
  void tick();
  return {
    workerId,
    stop() {
      clearInterval(timer);
    },
  };
};

module.exports = {
  claimJob,
  executeAppointmentFlowReplyJob,
  executeHumanGraceJob,
  runAutomationCycle,
  startWhatsappAutomationWorker,
};
