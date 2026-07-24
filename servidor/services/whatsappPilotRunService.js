const crypto = require('crypto');

const WhatsappAutomationConfig = require('../models/WhatsappAutomationConfig');
const WhatsappPilotRun = require('../models/WhatsappPilotRun');
const { mapAutomationConfig } = require('./whatsappConversationService');
const { evaluatePilotReadiness } = require('./whatsappPilotReadinessService');

const clean = (value) => (typeof value === 'string' ? value.trim() : '');
const objectIdString = (value) => (value ? String(value) : '');

const createPilotError = (code, message, status = 409, details = {}) => {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  Object.assign(error, details);
  return error;
};

const configurationSnapshot = (configuration = {}) => {
  const flows = Array.isArray(configuration.enabledFlows)
    ? configuration.enabledFlows.filter((flow) => (
      ['veterinary_appointment', 'grooming_appointment'].includes(flow)
    ))
    : [];
  return {
    enabled: configuration.enabled === true,
    timezone: clean(configuration.timezone) || 'America/Sao_Paulo',
    humanGraceMinutes: Math.min(
      120,
      Math.max(1, Number(configuration.humanGraceMinutes) || 5)
    ),
    afterHoursImmediate: configuration.afterHoursImmediate === true,
    botName: clean(configuration.botName),
    welcomeMessage: clean(configuration.welcomeMessage),
    afterHoursMessage: clean(configuration.afterHoursMessage),
    appointmentEnabled: configuration.appointmentEnabled === true,
    enabledFlows: [...new Set(flows)].sort(),
    appointmentMinLeadMinutes: Math.min(
      10080,
      Math.max(0, Number(configuration.appointmentMinLeadMinutes) || 0)
    ),
    appointmentSlotIntervalMinutes: Number(configuration.appointmentSlotIntervalMinutes) || 30,
    appointmentSearchDays: Math.min(
      30,
      Math.max(1, Number(configuration.appointmentSearchDays) || 14)
    ),
    appointmentMaxOptions: Math.min(
      5,
      Math.max(1, Number(configuration.appointmentMaxOptions) || 3)
    ),
    surveyEnabled: configuration.surveyEnabled === true,
    surveyDelayMinutes: Math.min(
      10080,
      Math.max(0, Number(configuration.surveyDelayMinutes) || 0)
    ),
    surveyQuestion: clean(configuration.surveyQuestion),
    surveyTemplateName: clean(configuration.surveyTemplateName),
    surveyTemplateLanguage: clean(configuration.surveyTemplateLanguage) || 'pt_BR',
    surveyTemplateApproved: configuration.surveyTemplateApproved === true,
    surveyRequireOptIn: configuration.surveyRequireOptIn !== false,
    surveyLowRatingThreshold: Math.min(
      5,
      Math.max(1, Number(configuration.surveyLowRatingThreshold) || 3)
    ),
    emergencyHandoffEnabled: configuration.emergencyHandoffEnabled !== false,
  };
};

const fingerprintConfiguration = (snapshot) => crypto
  .createHash('sha256')
  .update(JSON.stringify(snapshot || {}))
  .digest('hex');

const scenario = (key, category, label, description) => ({
  key,
  category,
  label,
  description,
  status: 'pending',
  evidenceNote: '',
  referenceType: '',
  referenceId: '',
  verifiedAt: null,
  verifiedBy: null,
});

const buildPilotScenarios = (configuration = {}) => {
  const snapshot = configurationSnapshot(configuration);
  const scenarios = [
    scenario(
      'inbound_webhook',
      'connection',
      'Mensagem recebida na Central',
      'Envie uma mensagem de um cliente e confirme que ela aparece somente no ambiente da loja e do número selecionados.'
    ),
    scenario(
      'mobile_echo',
      'connection',
      'Resposta do celular espelhada',
      'Responda pelo WhatsApp Business no celular e confirme a mesma resposta na Central WebWhatsapp.'
    ),
    scenario(
      'human_priority',
      'operation',
      'Funcionário responde dentro do prazo',
      'Durante o expediente, responda antes da tolerância configurada e confirme que o robô não assume a conversa.'
    ),
    scenario(
      'human_timeout',
      'operation',
      'Robô assume após ausência humana',
      'Durante o expediente, deixe a mensagem sem resposta além da tolerância e confirme a entrada do assistente.'
    ),
    scenario(
      'after_hours',
      'operation',
      'Atendimento fora do expediente',
      'Fora do expediente, confirme a resposta imediata, a informação de horário e a continuidade apenas nos fluxos permitidos.'
    ),
    scenario(
      'disconnect_safety',
      'safety',
      'Desconexão pausa automações',
      'Valide em ambiente controlado que uma desconexão ou estado inválido impede novos envios automáticos e gera sinalização.'
    ),
  ];

  if (snapshot.appointmentEnabled) {
    if (snapshot.enabledFlows.includes('veterinary_appointment')) {
      scenarios.push(scenario(
        'veterinary_booking',
        'appointments',
        'Agendamento veterinário completo',
        'Solicite atendimento veterinário, informe cliente e pet, escolha uma opção e confirme o atendimento criado na agenda.'
      ));
    }
    if (snapshot.enabledFlows.includes('grooming_appointment')) {
      scenarios.push(scenario(
        'grooming_booking',
        'appointments',
        'Agendamento de banho e tosa',
        'Solicite banho ou tosa, escolha serviço e horário e confirme profissional, pet e atendimento na agenda.'
      ));
    }
    scenarios.push(
      scenario(
        'appointment_conflict',
        'appointments',
        'Conflito de horário revalidado',
        'Ocupe um horário depois da oferta e confirme que o robô não cria duplicidade e apresenta nova alternativa.'
      ),
      scenario(
        'human_takeover_mid_flow',
        'operation',
        'Funcionário assume durante o fluxo',
        'Responda pelo celular ou pela Central no meio do agendamento e confirme o cancelamento das respostas automáticas pendentes.'
      ),
      scenario(
        'emergency_handoff',
        'safety',
        'Urgência encaminhada sem diagnóstico',
        'Envie uma situação veterinária urgente e confirme prioridade humana, orientação segura e ausência de diagnóstico automático.'
      )
    );
  }

  if (snapshot.surveyEnabled) {
    scenarios.push(
      scenario(
        'post_service_survey',
        'survey',
        'Pesquisa após finalização',
        'Finalize um atendimento e confirme uma única pesquisa, no atraso configurado e vinculada ao cliente correto.'
      ),
      scenario(
        'low_rating_handoff',
        'survey',
        'Nota baixa encaminha ao humano',
        'Responda com nota igual ou inferior ao limite e confirme prioridade e atendimento humano na conversa.'
      ),
      scenario(
        'survey_opt_out',
        'survey',
        'Opt-out impede novos envios',
        'Registre opt-out e confirme o cancelamento das pesquisas pendentes e a ausência de novas pesquisas.'
      )
    );
    if (snapshot.surveyTemplateName && snapshot.surveyTemplateApproved) {
      scenarios.push(scenario(
        'survey_template_outside_window',
        'survey',
        'Template fora da janela',
        'Teste um contato elegível fora da janela de atendimento e confirme o envio pelo template aprovado e no idioma configurado.'
      ));
    }
  }
  return scenarios;
};

const progressFromRun = (run = {}) => {
  const scenarios = Array.isArray(run.scenarios) ? run.scenarios : [];
  const passed = scenarios.filter((entry) => entry.status === 'passed').length;
  const failed = scenarios.filter((entry) => entry.status === 'failed').length;
  const pending = scenarios.filter((entry) => entry.status === 'pending').length;
  return {
    total: scenarios.length,
    passed,
    failed,
    pending,
    percent: scenarios.length ? Math.round((passed / scenarios.length) * 100) : 0,
  };
};

const mapPilotRun = (run) => {
  if (!run) return null;
  const plain = run.toObject ? run.toObject() : run;
  const scenarios = Array.isArray(plain.scenarios)
    ? plain.scenarios.map((entry) => ({
      key: entry.key || '',
      category: entry.category || '',
      label: entry.label || '',
      description: entry.description || '',
      status: entry.status || 'pending',
      evidenceNote: entry.evidenceNote || '',
      referenceType: entry.referenceType || '',
      referenceId: entry.referenceId || '',
      verifiedAt: entry.verifiedAt || null,
      verifiedBy: objectIdString(entry.verifiedBy),
    }))
    : [];
  return {
    id: objectIdString(plain._id),
    storeId: objectIdString(plain.store),
    phoneNumberId: plain.phoneNumberId || '',
    attempt: Number(plain.attempt) || 1,
    status: plain.status || 'in_progress',
    checklistVersion: plain.checklistVersion || '',
    checklistFingerprintAtStart: plain.checklistFingerprintAtStart || '',
    checklistFingerprintAtCompletion: plain.checklistFingerprintAtCompletion || '',
    configurationFingerprint: plain.configurationFingerprint || '',
    configurationSnapshot: plain.configurationSnapshot || null,
    scenarios,
    progress: progressFromRun({ scenarios }),
    startedAt: plain.startedAt || null,
    startedBy: objectIdString(plain.startedBy),
    completedAt: plain.completedAt || null,
    completedBy: objectIdString(plain.completedBy),
    completionNotes: plain.completionNotes || '',
    cancelledAt: plain.cancelledAt || null,
    cancelledBy: objectIdString(plain.cancelledBy),
    cancelReason: plain.cancelReason || '',
    createdAt: plain.createdAt || null,
    updatedAt: plain.updatedAt || null,
  };
};

const getRolloutState = async ({ storeId, phoneNumberId }) => {
  const [approved, current, otherInProgress] = await Promise.all([
    WhatsappPilotRun.findOne({ status: 'passed' })
      .sort({ completedAt: -1 })
      .select('_id completedAt checklistVersion')
      .lean(),
    WhatsappPilotRun.findOne({
      store: storeId,
      phoneNumberId,
      status: 'in_progress',
    }).sort({ attempt: -1 }).lean(),
    WhatsappPilotRun.findOne({
      status: 'in_progress',
      $nor: [{ store: storeId, phoneNumberId }],
    }).select('_id').lean(),
  ]);
  return {
    baselineApproved: Boolean(approved),
    baselineApprovedAt: approved?.completedAt || null,
    baselineChecklistVersion: approved?.checklistVersion || '',
    currentEnvironmentIsPilot: Boolean(current),
    expansionAllowed: Boolean(approved) || !otherInProgress,
    expansionBlockedByAnotherPilot: !approved && Boolean(otherInProgress),
  };
};

const assertPilotExpansionAllowed = async ({ storeId, phoneNumberId }) => {
  const rollout = await getRolloutState({ storeId, phoneNumberId });
  if (!rollout.expansionAllowed) {
    throw createPilotError(
      'WHATSAPP_PILOT_EXPANSION_BLOCKED',
      'Existe um piloto em andamento em outro ambiente. Conclua ou cancele esse piloto antes de ativar outra loja.',
      409,
      { rollout }
    );
  }
  return rollout;
};

const startPilotRun = async ({
  storeId,
  phoneNumberId,
  configuration,
  readiness,
  userId,
}) => {
  const existing = await WhatsappPilotRun.findOne({
    store: storeId,
    phoneNumberId,
    status: 'in_progress',
  }).sort({ attempt: -1 });
  if (existing) return { run: existing, reused: true };

  await assertPilotExpansionAllowed({ storeId, phoneNumberId });
  const snapshot = configurationSnapshot(configuration);
  const latest = await WhatsappPilotRun.findOne({ store: storeId, phoneNumberId })
    .sort({ attempt: -1 })
    .select('attempt')
    .lean();
  try {
    const run = await WhatsappPilotRun.create({
      store: storeId,
      phoneNumberId,
      attempt: (Number(latest?.attempt) || 0) + 1,
      status: 'in_progress',
      checklistVersion: readiness.version,
      checklistFingerprintAtStart: readiness.fingerprint,
      configurationFingerprint: fingerprintConfiguration(snapshot),
      configurationSnapshot: snapshot,
      scenarios: buildPilotScenarios(snapshot),
      startedAt: new Date(),
      startedBy: userId || null,
    });
    return { run, reused: false };
  } catch (error) {
    if (error?.code !== 11000) throw error;
    const concurrent = await WhatsappPilotRun.findOne({
      store: storeId,
      phoneNumberId,
      status: 'in_progress',
    }).sort({ attempt: -1 });
    if (concurrent) return { run: concurrent, reused: true };
    throw error;
  }
};

const getCurrentPilotRun = async ({ storeId, phoneNumberId }) => {
  const [run, rollout] = await Promise.all([
    WhatsappPilotRun.findOne({ store: storeId, phoneNumberId })
      .sort({ attempt: -1 }),
    getRolloutState({ storeId, phoneNumberId }),
  ]);
  return { run, rollout };
};

const updatePilotScenario = async ({
  storeId,
  phoneNumberId,
  runId,
  scenarioKey,
  status,
  evidenceNote,
  referenceType,
  referenceId,
  userId,
}) => {
  if (!['pending', 'passed', 'failed'].includes(status)) {
    throw createPilotError(
      'WHATSAPP_PILOT_SCENARIO_STATUS_INVALID',
      'Resultado do cenário inválido.',
      400
    );
  }
  const note = clean(evidenceNote);
  if (status !== 'pending' && note.length < 3) {
    throw createPilotError(
      'WHATSAPP_PILOT_EVIDENCE_REQUIRED',
      'Descreva brevemente a evidência observada neste teste.',
      400
    );
  }
  const run = await WhatsappPilotRun.findOne({
    _id: runId,
    store: storeId,
    phoneNumberId,
  });
  if (!run) {
    throw createPilotError('WHATSAPP_PILOT_RUN_NOT_FOUND', 'Execução do piloto não encontrada.', 404);
  }
  if (run.status !== 'in_progress') {
    throw createPilotError(
      'WHATSAPP_PILOT_RUN_CLOSED',
      'Esta execução do piloto já foi encerrada.',
      409
    );
  }
  const target = run.scenarios.find((entry) => entry.key === scenarioKey);
  if (!target) {
    throw createPilotError(
      'WHATSAPP_PILOT_SCENARIO_NOT_FOUND',
      'Cenário do piloto não encontrado.',
      404
    );
  }
  target.status = status;
  target.evidenceNote = status === 'pending' ? '' : note;
  target.referenceType = status === 'pending'
    ? ''
    : ['message', 'appointment', 'survey', 'manual'].includes(referenceType)
      ? referenceType
      : 'manual';
  target.referenceId = status === 'pending' ? '' : clean(referenceId);
  target.verifiedAt = status === 'pending' ? null : new Date();
  target.verifiedBy = status === 'pending' ? null : (userId || null);
  await run.save();
  return run;
};

const completePilotRun = async ({
  storeId,
  phoneNumberId,
  runId,
  completionNotes,
  userId,
}) => {
  const [run, config] = await Promise.all([
    WhatsappPilotRun.findOne({
      _id: runId,
      store: storeId,
      phoneNumberId,
    }),
    WhatsappAutomationConfig.findOne({ store: storeId, phoneNumberId }),
  ]);
  if (!run) {
    throw createPilotError('WHATSAPP_PILOT_RUN_NOT_FOUND', 'Execução do piloto não encontrada.', 404);
  }
  if (run.status !== 'in_progress') {
    throw createPilotError(
      'WHATSAPP_PILOT_RUN_CLOSED',
      'Esta execução do piloto já foi encerrada.',
      409
    );
  }
  if (!config?.enabled) {
    throw createPilotError(
      'WHATSAPP_PILOT_AUTOMATION_DISABLED',
      'Ative a automação deste ambiente para concluir os testes do piloto.',
      409
    );
  }
  const progress = progressFromRun(run);
  if (progress.pending || progress.failed || progress.passed !== progress.total) {
    throw createPilotError(
      'WHATSAPP_PILOT_SCENARIOS_INCOMPLETE',
      'Todos os cenários obrigatórios precisam estar aprovados.',
      409,
      { progress }
    );
  }
  const currentSnapshot = configurationSnapshot(mapAutomationConfig(config));
  const currentConfigurationFingerprint = fingerprintConfiguration(currentSnapshot);
  if (currentConfigurationFingerprint !== run.configurationFingerprint) {
    throw createPilotError(
      'WHATSAPP_PILOT_CONFIGURATION_CHANGED',
      'A configuração mudou durante os testes. Inicie uma nova execução para validar o estado atual.',
      409
    );
  }
  const readiness = await evaluatePilotReadiness({ storeId, phoneNumberId });
  if (!readiness.summary.canActivate) {
    throw createPilotError(
      'WHATSAPP_PILOT_READINESS_BLOCKED',
      'O ambiente voltou a apresentar bloqueios obrigatórios.',
      409,
      { readiness }
    );
  }
  run.status = 'passed';
  run.checklistFingerprintAtCompletion = readiness.fingerprint;
  run.completedAt = new Date();
  run.completedBy = userId || null;
  run.completionNotes = clean(completionNotes);
  await run.save();
  return { run, readiness };
};

const cancelPilotRun = async ({
  storeId,
  phoneNumberId,
  runId,
  reason,
  userId,
}) => {
  const cancelReason = clean(reason);
  if (cancelReason.length < 3) {
    throw createPilotError(
      'WHATSAPP_PILOT_CANCEL_REASON_REQUIRED',
      'Informe o motivo do cancelamento do piloto.',
      400
    );
  }
  const run = await WhatsappPilotRun.findOne({
    _id: runId,
    store: storeId,
    phoneNumberId,
  });
  if (!run) {
    throw createPilotError('WHATSAPP_PILOT_RUN_NOT_FOUND', 'Execução do piloto não encontrada.', 404);
  }
  if (run.status !== 'in_progress') {
    throw createPilotError(
      'WHATSAPP_PILOT_RUN_CLOSED',
      'Esta execução do piloto já foi encerrada.',
      409
    );
  }
  run.status = 'cancelled';
  run.cancelledAt = new Date();
  run.cancelledBy = userId || null;
  run.cancelReason = cancelReason;
  await run.save();
  return run;
};

module.exports = {
  assertPilotExpansionAllowed,
  buildPilotScenarios,
  cancelPilotRun,
  completePilotRun,
  configurationSnapshot,
  fingerprintConfiguration,
  getCurrentPilotRun,
  getRolloutState,
  mapPilotRun,
  progressFromRun,
  startPilotRun,
  updatePilotScenario,
};
