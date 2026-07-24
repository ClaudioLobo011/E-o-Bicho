const crypto = require('crypto');

const Service = require('../models/Service');
const Store = require('../models/Store');
const User = require('../models/User');
const WhatsappAutomationConfig = require('../models/WhatsappAutomationConfig');
const WhatsappIntegration = require('../models/WhatsappIntegration');
const WhatsappLog = require('../models/WhatsappLog');
const WhatsappWebhookEvent = require('../models/WhatsappWebhookEvent');
const { parseMinutes } = require('./whatsappOperatingHoursService');

const PILOT_CHECKLIST_VERSION = '2026-07-23.1';
const STAFF_ROLES = ['funcionario', 'franqueado', 'franqueador', 'admin', 'admin_master'];
const FLOW_META = Object.freeze({
  veterinary_appointment: {
    label: 'Atendimento veterinário',
    categories: ['veterinario', 'vacina', 'exame'],
    professionalType: 'veterinario',
    fallback: /(veterin|consulta|vacina|exame)/,
  },
  grooming_appointment: {
    label: 'Banho e tosa',
    categories: ['banho', 'tosa', 'banho_tosa'],
    professionalType: 'esteticista',
    fallback: /(banho|tosa|estetic)/,
  },
});

const clean = (value) => (typeof value === 'string' ? value.trim() : '');
const normalizeText = (value) => clean(value)
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase();
const objectIdString = (value) => (value ? String(value) : '');

const hasConfiguredStoreSchedule = (schedule = {}) => Object.values(schedule || {}).some(
  (day) => Boolean(day?.fechada || clean(day?.abre) || clean(day?.fecha))
);

const hasValidOpenStoreDay = (schedule = {}) => Object.values(schedule || {}).some((day) => {
  if (!day || day.fechada) return false;
  const open = parseMinutes(day.abre);
  const close = parseMinutes(day.fecha);
  return open !== null && close !== null && open !== close;
});

const hasValidProfessionalSchedule = (professional = {}) => (
  Array.isArray(professional.horarios)
  && professional.horarios.some((day) => (
    parseMinutes(day?.horaInicio) !== null
    && parseMinutes(day?.horaFim) !== null
    && parseMinutes(day?.horaInicio) !== parseMinutes(day?.horaFim)
  ))
);

const resolveTechnicalSetup = (integration = {}) => Boolean(
  (clean(integration.appId) || clean(process.env.WHATSAPP_META_APP_ID))
  && (
    clean(integration.embeddedSignupConfigId)
    || clean(process.env.WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID)
  )
  && (integration.appSecretStored || clean(process.env.WHATSAPP_META_APP_SECRET))
  && (integration.verifyTokenStored || clean(process.env.WHATSAPP_META_VERIFY_TOKEN))
);

const mapConfiguration = (config, overrides = {}) => {
  const base = config?.toObject ? config.toObject() : (config || {});
  const allowedOverrides = Object.fromEntries(
    Object.entries(overrides || {}).filter(([key]) => [
      'enabled',
      'appointmentEnabled',
      'surveyEnabled',
      'enabledFlows',
      'humanGraceMinutes',
      'afterHoursImmediate',
      'welcomeMessage',
      'afterHoursMessage',
      'fallbackMessage',
      'surveyQuestion',
      'surveyTemplateName',
      'surveyTemplateLanguage',
      'surveyTemplateApproved',
      'surveyRequireOptIn',
      'emergencyHandoffEnabled',
    ].includes(key))
  );
  const merged = { ...base, ...allowedOverrides };
  return {
    enabled: merged.enabled === true,
    appointmentEnabled: merged.appointmentEnabled === true,
    surveyEnabled: merged.surveyEnabled === true,
    enabledFlows: Array.isArray(merged.enabledFlows)
      ? merged.enabledFlows.filter((flow) => FLOW_META[flow])
      : ['veterinary_appointment', 'grooming_appointment'],
    humanGraceMinutes: Math.min(
      120,
      Math.max(1, Number(merged.humanGraceMinutes) || 5)
    ),
    afterHoursImmediate: merged.afterHoursImmediate === true,
    welcomeMessage: clean(merged.welcomeMessage),
    afterHoursMessage: clean(merged.afterHoursMessage),
    fallbackMessage: clean(merged.fallbackMessage),
    surveyQuestion: clean(merged.surveyQuestion),
    surveyTemplateName: clean(merged.surveyTemplateName),
    surveyTemplateLanguage: clean(merged.surveyTemplateLanguage) || 'pt_BR',
    surveyTemplateApproved: merged.surveyTemplateApproved === true,
    surveyRequireOptIn: merged.surveyRequireOptIn !== false,
    emergencyHandoffEnabled: merged.emergencyHandoffEnabled !== false,
    pilotAcknowledgedAt: base.pilotAcknowledgedAt || null,
    pilotAcknowledgedBy: objectIdString(base.pilotAcknowledgedBy),
    pilotChecklistVersion: clean(base.pilotChecklistVersion),
    pilotReadinessFingerprint: clean(base.pilotReadinessFingerprint),
  };
};

const serviceMatchesFlow = (service, flow) => {
  const meta = FLOW_META[flow];
  if (!meta) return false;
  const categories = Array.isArray(service?.categorias) ? service.categorias : [];
  if (categories.some((category) => meta.categories.includes(category))) return true;
  return meta.fallback.test(normalizeText(`${service?.nome || ''} ${service?.grupo?.nome || ''}`));
};

const serviceAllowsProfessional = (service, flow) => {
  const meta = FLOW_META[flow];
  const allowed = Array.isArray(service?.grupo?.tiposPermitidos)
    ? service.grupo.tiposPermitidos
    : [];
  return Boolean(meta && allowed.includes(meta.professionalType));
};

const buildAction = (label, href) => ({ label, href });

const evaluatePilotReadiness = async ({
  storeId,
  phoneNumberId,
  configuration: configurationOverrides = {},
  now = new Date(),
}) => {
  const [
    store,
    integration,
    savedConfig,
    services,
    professionals,
    lastCoexistenceEvent,
    lastInboundLog,
    lastMobileEcho,
  ] = await Promise.all([
    Store.findById(storeId).select('_id nome nomeFantasia razaoSocial horario').lean(),
    WhatsappIntegration.findOne({ store: storeId }).lean(),
    WhatsappAutomationConfig.findOne({ store: storeId, phoneNumberId }),
    Service.find({ ativo: { $ne: false } })
      .select('_id nome duracaoMinutos categorias grupo ativo')
      .populate({ path: 'grupo', select: 'nome tiposPermitidos ativo' })
      .lean(),
    User.find({
      empresas: storeId,
      role: { $in: STAFF_ROLES },
      grupos: { $in: ['veterinario', 'esteticista'] },
    }).select('_id nomeCompleto grupos horarios').lean(),
    WhatsappWebhookEvent.findOne({
      store: storeId,
      phoneNumberId,
      field: { $in: ['history', 'smb_app_state_sync', 'smb_message_echoes'] },
      status: 'processed',
    }).sort({ processedAt: -1 }).select('field processedAt').lean(),
    WhatsappLog.findOne({
      store: storeId,
      phoneNumberId,
      direction: 'incoming',
    }).sort({ createdAt: -1 }).select('createdAt messageTimestamp').lean(),
    WhatsappLog.findOne({
      store: storeId,
      phoneNumberId,
      direction: 'outgoing',
      source: 'whatsapp_business_app',
    }).sort({ createdAt: -1 }).select('createdAt messageTimestamp').lean(),
  ]);

  const defaultConfig = new WhatsappAutomationConfig({ store: storeId, phoneNumberId });
  const config = mapConfiguration(savedConfig || defaultConfig, configurationOverrides);
  const number = (integration?.phoneNumbers || []).find(
    (entry) => clean(entry?.phoneNumberId) === clean(phoneNumberId)
  ) || null;
  const configPage = (
    `admin-web-whatsapp.html?storeId=${encodeURIComponent(storeId)}`
    + `&phoneNumberId=${encodeURIComponent(phoneNumberId)}`
  );
  const integrationPage = `admin-integracoes-whatsapp.html?storeId=${encodeURIComponent(storeId)}`;
  const checks = [];
  const addCheck = (section, id, label, status, message, action = null) => {
    checks.push({ section, id, label, status, message, action });
  };

  addCheck(
    'connection',
    'technical_setup',
    'Aplicativo Meta e webhook configurados',
    resolveTechnicalSetup(integration) ? 'pass' : 'blocker',
    resolveTechnicalSetup(integration)
      ? 'App ID, Configuration ID e segredos necessários estão disponíveis.'
      : 'Complete App ID, Configuration ID, App Secret e Verify Token desta loja.',
    buildAction('Abrir configuração', integrationPage)
  );
  addCheck(
    'connection',
    'access_token',
    'Token de acesso conectado',
    integration?.accessTokenStored ? 'pass' : 'blocker',
    integration?.accessTokenStored
      ? 'O token da conexão está armazenado de forma protegida.'
      : 'Conclua o Embedded Signup para obter o token da conta.',
    buildAction('Conectar número', integrationPage)
  );
  addCheck(
    'connection',
    'coexistence_connected',
    'Coexistência confirmada',
    (
      integration?.onboardingStatus === 'connected'
      && integration?.connectionMode === 'coexistence'
      && clean(number?.status).toLowerCase() === 'conectado'
      && number?.connectionMode === 'coexistence'
      && number?.isOnBizApp === true
    ) ? 'pass' : 'blocker',
    (
      integration?.onboardingStatus === 'connected'
      && integration?.connectionMode === 'coexistence'
      && clean(number?.status).toLowerCase() === 'conectado'
      && number?.connectionMode === 'coexistence'
      && number?.isOnBizApp === true
    )
      ? 'O número está disponível no celular e no sistema.'
      : 'A Meta ainda não confirmou este número como celular + sistema.',
    buildAction('Verificar coexistência', integrationPage)
  );
  addCheck(
    'connection',
    'webhook_subscription',
    'Assinatura de webhooks ativa',
    integration?.webhookSubscribedAt ? 'pass' : 'blocker',
    integration?.webhookSubscribedAt
      ? 'A WABA foi assinada durante o onboarding.'
      : 'A assinatura da WABA não foi registrada; reconecte ou verifique a integração.',
    buildAction('Revisar webhook', integrationPage)
  );

  const lastHealthAt = integration?.lastHealthCheckAt
    ? new Date(integration.lastHealthCheckAt)
    : null;
  const healthAgeMs = lastHealthAt && !Number.isNaN(lastHealthAt.getTime())
    ? now.getTime() - lastHealthAt.getTime()
    : Number.POSITIVE_INFINITY;
  addCheck(
    'connection',
    'recent_health_check',
    'Diagnóstico recente na Meta',
    healthAgeMs <= (7 * 24 * 60 * 60 * 1000) ? 'pass' : 'warning',
    healthAgeMs <= (7 * 24 * 60 * 60 * 1000)
      ? 'A coexistência foi conferida nos últimos sete dias.'
      : 'Execute “Verificar conexão” antes do piloto e repita após mudanças no celular.',
    buildAction('Executar diagnóstico', integrationPage)
  );

  const syncCompleted = number?.historySyncStatus === 'completed'
    && number?.contactsSyncStatus === 'completed';
  addCheck(
    'connection',
    'initial_sync',
    'Histórico e contatos sincronizados',
    syncCompleted ? 'pass' : 'warning',
    syncCompleted
      ? 'As duas sincronizações iniciais foram concluídas.'
      : 'A sincronização inicial ainda não terminou; conversas antigas podem não aparecer.',
    buildAction('Acompanhar sincronização', integrationPage)
  );
  addCheck(
    'connection',
    'webhook_evidence',
    'Webhook recebido neste número',
    lastInboundLog || lastCoexistenceEvent ? 'pass' : 'warning',
    lastInboundLog || lastCoexistenceEvent
      ? 'Há evidência de evento recebido e processado para este número.'
      : 'Envie uma mensagem de teste ao número e confirme que ela aparece na Central.',
    buildAction('Abrir Central', configPage)
  );
  addCheck(
    'connection',
    'mobile_echo_evidence',
    'Resposta do celular espelhada',
    lastMobileEcho ? 'pass' : 'warning',
    lastMobileEcho
      ? 'O sistema já recebeu uma resposta enviada pelo WhatsApp Business.'
      : 'Responda uma conversa pelo celular e confirme que a resposta aparece na Central.',
    buildAction('Testar na Central', configPage)
  );

  const storeScheduleConfigured = hasConfiguredStoreSchedule(store?.horario);
  const storeHasOpenDay = hasValidOpenStoreDay(store?.horario);
  addCheck(
    'operation',
    'store_schedule',
    'Expediente da loja configurado',
    storeScheduleConfigured && storeHasOpenDay ? 'pass' : 'blocker',
    storeScheduleConfigured && storeHasOpenDay
      ? 'A regra humano primeiro e o atendimento fora do horário usarão este expediente.'
      : 'Cadastre ao menos um dia aberto com horários válidos para esta loja.',
    buildAction('Configurar loja', 'admin-nossas-lojas.html')
  );
  addCheck(
    'operation',
    'human_priority',
    'Prioridade humana definida',
    Number(config.humanGraceMinutes) >= 1 ? 'pass' : 'blocker',
    `Durante o expediente, o sistema aguardará ${Math.max(1, Number(config.humanGraceMinutes) || 5)} minuto(s) pela equipe.`,
    buildAction('Revisar automação', configPage)
  );
  addCheck(
    'operation',
    'automation_messages',
    'Mensagens de entrada configuradas',
    config.welcomeMessage && config.afterHoursMessage ? 'pass' : 'blocker',
    config.welcomeMessage && config.afterHoursMessage
      ? 'Há mensagens para assumir a conversa e para o atendimento fora do expediente.'
      : 'Preencha as mensagens de entrada e de fora do expediente.',
    buildAction('Editar mensagens', configPage)
  );

  const enabledFlows = Array.isArray(config.enabledFlows)
    ? config.enabledFlows.filter((flow) => FLOW_META[flow])
    : [];
  if (!config.appointmentEnabled) {
    addCheck(
      'appointments',
      'appointments_disabled',
      'Agendamento conversacional',
      'pass',
      'O agendamento está fora do escopo desta ativação; o atendimento geral continua disponível.',
      buildAction('Configurar agendamento', configPage)
    );
  } else if (!enabledFlows.length) {
    addCheck(
      'appointments',
      'appointment_flows',
      'Tipos de agendamento selecionados',
      'blocker',
      'Ative ao menos veterinário ou banho e tosa para usar o agendamento conversacional.',
      buildAction('Selecionar fluxos', configPage)
    );
  }

  enabledFlows.forEach((flow) => {
    if (!config.appointmentEnabled) return;
    const meta = FLOW_META[flow];
    const flowServices = services.filter((service) => (
      service?.grupo?.ativo !== false && serviceMatchesFlow(service, flow)
    ));
    const compatibleServices = flowServices.filter((service) => (
      serviceAllowsProfessional(service, flow)
    ));
    const flowProfessionals = professionals.filter((professional) => (
      Array.isArray(professional.grupos)
      && professional.grupos.includes(meta.professionalType)
    ));
    const scheduledProfessionals = flowProfessionals.filter(hasValidProfessionalSchedule);

    addCheck(
      'appointments',
      `services_${flow}`,
      `Serviços de ${meta.label.toLowerCase()}`,
      flowServices.length && compatibleServices.length ? 'pass' : 'blocker',
      flowServices.length && compatibleServices.length
        ? `${compatibleServices.length} serviço(s) ativo(s) com profissional compatível.`
        : `Cadastre um serviço ativo de ${meta.label.toLowerCase()} e permita ${meta.professionalType}.`,
      buildAction('Revisar serviços', 'admin-servicos.html')
    );
    addCheck(
      'appointments',
      `professionals_${flow}`,
      `Profissionais de ${meta.label.toLowerCase()}`,
      flowProfessionals.length ? 'pass' : 'blocker',
      flowProfessionals.length
        ? `${flowProfessionals.length} profissional(is) vinculado(s) a esta loja.`
        : `Vincule pelo menos um ${meta.professionalType} a esta loja.`,
      buildAction('Revisar funcionários', 'admin-gerir-funcionarios.html')
    );
    addCheck(
      'appointments',
      `professional_schedule_${flow}`,
      `Jornada para ${meta.label.toLowerCase()}`,
      scheduledProfessionals.length ? 'pass' : 'blocker',
      scheduledProfessionals.length
        ? `${scheduledProfessionals.length} profissional(is) possui(em) jornada válida.`
        : `Preencha a jornada de ao menos um ${meta.professionalType} desta loja.`,
      buildAction('Configurar jornadas', 'admin-gerir-funcionarios.html')
    );
  });

  if (!config.surveyEnabled) {
    addCheck(
      'survey',
      'survey_disabled',
      'Pesquisa pós-atendimento',
      'pass',
      'A pesquisa está fora do escopo desta ativação e pode ser validada em uma etapa posterior.',
      buildAction('Configurar pesquisa', configPage)
    );
  } else {
    addCheck(
      'survey',
      'survey_question',
      'Pergunta da pesquisa configurada',
      config.surveyQuestion ? 'pass' : 'blocker',
      config.surveyQuestion
        ? 'A pergunta será enviada dentro da janela ativa do cliente.'
        : 'Informe a pergunta que será enviada após a finalização.',
      buildAction('Editar pesquisa', configPage)
    );
    addCheck(
      'survey',
      'survey_template',
      'Template para envio fora da janela',
      config.surveyTemplateName && config.surveyTemplateApproved ? 'pass' : 'warning',
      config.surveyTemplateName && config.surveyTemplateApproved
        ? `O administrador confirmou “${config.surveyTemplateName}” (${config.surveyTemplateLanguage}) como aprovado na Meta.`
        : config.surveyTemplateName
          ? `Marque a confirmação somente após verificar na Meta se “${config.surveyTemplateName}” está aprovado.`
          : 'Sem template aprovado, a pesquisa ficará limitada à janela de atendimento do cliente.',
      buildAction('Revisar template', configPage)
    );
    addCheck(
      'survey',
      'survey_consent',
      'Regra de consentimento',
      config.surveyRequireOptIn ? 'pass' : 'warning',
      config.surveyRequireOptIn
        ? 'Fora da janela, somente contatos com opt-in registrado serão elegíveis.'
        : 'O opt-in fora da janela está desativado; valide a política antes do piloto.',
      buildAction('Revisar consentimento', configPage)
    );
  }

  addCheck(
    'safety',
    'emergency_handoff',
    'Urgências encaminhadas ao humano',
    config.emergencyHandoffEnabled ? 'pass' : 'warning',
    config.emergencyHandoffEnabled
      ? 'Pedidos de urgência não recebem diagnóstico automático.'
      : 'Reative o encaminhamento de urgência antes de liberar atendimento veterinário.',
    buildAction('Revisar segurança', configPage)
  );

  const blockers = checks.filter((check) => check.status === 'blocker').length;
  const warnings = checks.filter((check) => check.status === 'warning').length;
  const passed = checks.filter((check) => check.status === 'pass').length;
  const status = blockers ? 'blocked' : (warnings ? 'warning' : 'ready');
  const relevantProfessionalTypes = new Set(
    config.appointmentEnabled
      ? enabledFlows.map((flow) => FLOW_META[flow]?.professionalType).filter(Boolean)
      : []
  );
  const relevantServices = config.appointmentEnabled
    ? services.filter((service) => enabledFlows.some((flow) => serviceMatchesFlow(service, flow)))
    : [];
  const relevantProfessionals = config.appointmentEnabled
    ? professionals.filter((professional) => (
      Array.isArray(professional.grupos)
      && professional.grupos.some((group) => relevantProfessionalTypes.has(group))
    ))
    : [];
  const fingerprintContext = {
    version: PILOT_CHECKLIST_VERSION,
    storeId: objectIdString(storeId),
    phoneNumberId: clean(phoneNumberId),
    configuration: {
      appointmentEnabled: config.appointmentEnabled,
      enabledFlows,
      surveyEnabled: config.surveyEnabled,
      surveyTemplateName: config.surveyTemplateName,
      surveyTemplateLanguage: config.surveyTemplateLanguage,
      surveyTemplateApproved: config.surveyTemplateApproved,
      surveyRequireOptIn: config.surveyRequireOptIn,
      humanGraceMinutes: config.humanGraceMinutes,
      afterHoursImmediate: config.afterHoursImmediate,
      welcomeMessage: config.welcomeMessage,
      afterHoursMessage: config.afterHoursMessage,
      emergencyHandoffEnabled: config.emergencyHandoffEnabled,
    },
    storeSchedule: store?.horario || {},
    connection: {
      onboardingStatus: integration?.onboardingStatus || '',
      connectionMode: integration?.connectionMode || '',
      webhookSubscribedAt: integration?.webhookSubscribedAt || null,
      lastHealthCheckAt: integration?.lastHealthCheckAt || null,
      numberStatus: number?.status || '',
      numberConnectionMode: number?.connectionMode || '',
      isOnBizApp: number?.isOnBizApp === true,
      contactsSyncStatus: number?.contactsSyncStatus || '',
      historySyncStatus: number?.historySyncStatus || '',
    },
    services: relevantServices
      .map((service) => ({
        id: objectIdString(service._id),
        nome: service.nome || '',
        duracaoMinutos: Number(service.duracaoMinutos) || 0,
        categorias: Array.isArray(service.categorias) ? [...service.categorias].sort() : [],
        groupId: objectIdString(service?.grupo?._id),
        groupActive: service?.grupo?.ativo !== false,
        professionalTypes: Array.isArray(service?.grupo?.tiposPermitidos)
          ? [...service.grupo.tiposPermitidos].sort()
          : [],
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    professionals: relevantProfessionals
      .map((professional) => ({
        id: objectIdString(professional._id),
        grupos: Array.isArray(professional.grupos) ? [...professional.grupos].sort() : [],
        horarios: Array.isArray(professional.horarios) ? professional.horarios : [],
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    evidence: {
      inboundReceived: Boolean(lastInboundLog),
      mobileEchoReceived: Boolean(lastMobileEcho),
      coexistenceEventReceived: Boolean(lastCoexistenceEvent),
    },
    checks: checks.map(({ id, status: checkStatus, message }) => [
      id,
      checkStatus,
      message,
    ]),
  };
  const fingerprint = crypto
    .createHash('sha256')
    .update(JSON.stringify(fingerprintContext))
    .digest('hex');

  return {
    version: PILOT_CHECKLIST_VERSION,
    evaluatedAt: now,
    store: {
      id: objectIdString(store?._id || storeId),
      name: store?.nomeFantasia || store?.nome || store?.razaoSocial || 'Loja',
    },
    number: {
      phoneNumberId: clean(phoneNumberId),
      phoneNumber: clean(number?.phoneNumber),
      displayName: clean(number?.displayName),
    },
    summary: {
      status,
      canActivate: blockers === 0,
      blockers,
      warnings,
      passed,
      total: checks.length,
    },
    activation: {
      enabled: Boolean(config.enabled),
      acknowledgedAt: config.pilotAcknowledgedAt || null,
      acknowledgedBy: config.pilotAcknowledgedBy || '',
      checklistVersion: config.pilotChecklistVersion || '',
      readinessFingerprint: config.pilotReadinessFingerprint || '',
    },
    fingerprint,
    checks,
  };
};

module.exports = {
  PILOT_CHECKLIST_VERSION,
  evaluatePilotReadiness,
};
