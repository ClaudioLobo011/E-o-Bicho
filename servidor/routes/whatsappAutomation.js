const express = require('express');

const WhatsappAppointmentFlow = require('../models/WhatsappAppointmentFlow');
const WhatsappAutomationConfig = require('../models/WhatsappAutomationConfig');
const WhatsappContactPreference = require('../models/WhatsappContactPreference');
const { requireWhatsappAdminAccess, requireWhatsappNumberAccess } = require('../middlewares/whatsappAccess');
const {
  buildRequestMeta,
  getAutomationSnapshot,
  getAutomationConfig,
  getConversationState,
  mapAutomationConfig,
  mapConversationState,
  transitionConversation,
  updateAutomationConfig,
} = require('../services/whatsappConversationService');
const {
  getSurveyStats,
  mapContactPreference,
  setContactPreference,
} = require('../services/whatsappPostServiceSurveyService');
const {
  getAppointmentFlowStats,
  mapFlow,
} = require('../services/whatsappAppointmentFlowService');
const {
  evaluatePilotReadiness,
} = require('../services/whatsappPilotReadinessService');
const {
  cancelPilotRun,
  completePilotRun,
  getCurrentPilotRun,
  mapPilotRun,
  startPilotRun,
  updatePilotScenario,
} = require('../services/whatsappPilotRunService');

const router = express.Router({ mergeParams: true });
const digitsOnly = (value) => String(value || '').replace(/\D+/g, '');
const sendPilotError = (res, error, fallbackMessage) => res
  .status(Number(error?.status) || 500)
  .json({
    message: error?.message || fallbackMessage,
    ...(error?.code ? { code: error.code } : {}),
    ...(error?.readiness ? { readiness: error.readiness } : {}),
    ...(error?.rollout ? { rollout: error.rollout } : {}),
    ...(error?.progress ? { progress: error.progress } : {}),
  });
const logUnexpectedPilotError = (message, error) => {
  const status = Number(error?.status) || 500;
  if (status >= 500) {
    console.error(message, error);
  }
};

router.use(requireWhatsappNumberAccess());

router.get('/automation', async (req, res) => {
  try {
    const snapshot = await getAutomationSnapshot({
      storeId: req.whatsappContext.storeId,
      phoneNumberId: req.whatsappContext.phoneNumberId,
    });
    return res.json(snapshot);
  } catch (error) {
    console.error('Erro ao carregar automação do WhatsApp:', error);
    return res.status(500).json({ message: 'Erro ao carregar automação do WhatsApp.' });
  }
});

router.get('/pilot-readiness', async (req, res) => {
  try {
    const readiness = await evaluatePilotReadiness({
      storeId: req.whatsappContext.storeId,
      phoneNumberId: req.whatsappContext.phoneNumberId,
    });
    return res.json({ readiness });
  } catch (error) {
    console.error('Erro ao avaliar prontidão do piloto WhatsApp:', error);
    return res.status(500).json({ message: 'Erro ao avaliar prontidão do piloto.' });
  }
});

router.post('/pilot-readiness', requireWhatsappAdminAccess, async (req, res) => {
  try {
    const readiness = await evaluatePilotReadiness({
      storeId: req.whatsappContext.storeId,
      phoneNumberId: req.whatsappContext.phoneNumberId,
      configuration: req.body?.configuration || {},
    });
    return res.json({ readiness });
  } catch (error) {
    console.error('Erro ao simular prontidão do piloto WhatsApp:', error);
    return res.status(500).json({ message: 'Erro ao avaliar prontidão do piloto.' });
  }
});

router.get('/pilot', async (req, res) => {
  try {
    const result = await getCurrentPilotRun({
      storeId: req.whatsappContext.storeId,
      phoneNumberId: req.whatsappContext.phoneNumberId,
    });
    return res.json({
      pilotRun: mapPilotRun(result.run),
      rollout: result.rollout,
    });
  } catch (error) {
    logUnexpectedPilotError('Erro ao carregar execução do piloto WhatsApp:', error);
    return sendPilotError(res, error, 'Erro ao carregar execução do piloto.');
  }
});

router.post('/pilot/start', requireWhatsappAdminAccess, async (req, res) => {
  try {
    const config = await getAutomationConfig(
      req.whatsappContext.storeId,
      req.whatsappContext.phoneNumberId
    );
    if (!config?.enabled) {
      const error = new Error('Ative a automação deste ambiente antes de iniciar a homologação.');
      error.code = 'WHATSAPP_PILOT_AUTOMATION_DISABLED';
      error.status = 409;
      throw error;
    }
    const readiness = await evaluatePilotReadiness({
      storeId: req.whatsappContext.storeId,
      phoneNumberId: req.whatsappContext.phoneNumberId,
    });
    if (!readiness.summary.canActivate) {
      const error = new Error('Corrija os bloqueios de prontidão antes de iniciar o piloto.');
      error.code = 'WHATSAPP_PILOT_READINESS_BLOCKED';
      error.status = 409;
      error.readiness = readiness;
      throw error;
    }
    const result = await startPilotRun({
      storeId: req.whatsappContext.storeId,
      phoneNumberId: req.whatsappContext.phoneNumberId,
      configuration: mapAutomationConfig(config),
      readiness,
      userId: req.user?.id,
    });
    const current = await getCurrentPilotRun({
      storeId: req.whatsappContext.storeId,
      phoneNumberId: req.whatsappContext.phoneNumberId,
    });
    return res.status(result.reused ? 200 : 201).json({
      pilotRun: mapPilotRun(result.run),
      rollout: current.rollout,
      reused: result.reused,
    });
  } catch (error) {
    logUnexpectedPilotError('Erro ao iniciar piloto WhatsApp:', error);
    return sendPilotError(res, error, 'Erro ao iniciar o piloto.');
  }
});

router.patch(
  '/pilot/:runId/scenarios/:scenarioKey',
  requireWhatsappAdminAccess,
  async (req, res) => {
    try {
      const run = await updatePilotScenario({
        storeId: req.whatsappContext.storeId,
        phoneNumberId: req.whatsappContext.phoneNumberId,
        runId: req.params.runId,
        scenarioKey: req.params.scenarioKey,
        status: String(req.body?.status || ''),
        evidenceNote: req.body?.evidenceNote,
        referenceType: req.body?.referenceType,
        referenceId: req.body?.referenceId,
        userId: req.user?.id,
      });
      return res.json({ pilotRun: mapPilotRun(run) });
    } catch (error) {
      logUnexpectedPilotError('Erro ao registrar cenário do piloto WhatsApp:', error);
      return sendPilotError(res, error, 'Erro ao registrar resultado do cenário.');
    }
  }
);

router.post('/pilot/:runId/complete', requireWhatsappAdminAccess, async (req, res) => {
  try {
    const result = await completePilotRun({
      storeId: req.whatsappContext.storeId,
      phoneNumberId: req.whatsappContext.phoneNumberId,
      runId: req.params.runId,
      completionNotes: req.body?.completionNotes,
      userId: req.user?.id,
    });
    const current = await getCurrentPilotRun({
      storeId: req.whatsappContext.storeId,
      phoneNumberId: req.whatsappContext.phoneNumberId,
    });
    return res.json({
      pilotRun: mapPilotRun(result.run),
      rollout: current.rollout,
      readiness: result.readiness,
    });
  } catch (error) {
    logUnexpectedPilotError('Erro ao concluir piloto WhatsApp:', error);
    return sendPilotError(res, error, 'Erro ao concluir o piloto.');
  }
});

router.post('/pilot/:runId/cancel', requireWhatsappAdminAccess, async (req, res) => {
  try {
    const run = await cancelPilotRun({
      storeId: req.whatsappContext.storeId,
      phoneNumberId: req.whatsappContext.phoneNumberId,
      runId: req.params.runId,
      reason: req.body?.reason,
      userId: req.user?.id,
    });
    const current = await getCurrentPilotRun({
      storeId: req.whatsappContext.storeId,
      phoneNumberId: req.whatsappContext.phoneNumberId,
    });
    return res.json({
      pilotRun: mapPilotRun(run),
      rollout: current.rollout,
    });
  } catch (error) {
    logUnexpectedPilotError('Erro ao cancelar piloto WhatsApp:', error);
    return sendPilotError(res, error, 'Erro ao cancelar o piloto.');
  }
});

router.put('/automation', requireWhatsappAdminAccess, async (req, res) => {
  try {
    const current = await getAutomationConfig(
      req.whatsappContext.storeId,
      req.whatsappContext.phoneNumberId
    );
    const activating = req.body?.enabled === true && current?.enabled !== true;
    let pilotAcknowledgement = null;
    let pilotRun = null;
    if (activating) {
      const readiness = await evaluatePilotReadiness({
        storeId: req.whatsappContext.storeId,
        phoneNumberId: req.whatsappContext.phoneNumberId,
        configuration: req.body || {},
      });
      if (!readiness.summary.canActivate) {
        return res.status(409).json({
          message: 'O piloto está bloqueado. Corrija os itens obrigatórios antes de ativar.',
          code: 'WHATSAPP_PILOT_BLOCKED',
          readiness,
        });
      }
      if (req.body?.pilotAcknowledged !== true) {
        return res.status(409).json({
          message: 'Confirme a revisão do checklist antes de ativar o piloto.',
          code: 'WHATSAPP_PILOT_ACKNOWLEDGEMENT_REQUIRED',
          readiness,
        });
      }
      if (req.body?.pilotReadinessFingerprint !== readiness.fingerprint) {
        return res.status(409).json({
          message: 'O checklist mudou desde a última revisão. Confira os itens novamente.',
          code: 'WHATSAPP_PILOT_READINESS_CHANGED',
          readiness,
        });
      }
      const safeCurrent = current || new WhatsappAutomationConfig({
        store: req.whatsappContext.storeId,
        phoneNumberId: req.whatsappContext.phoneNumberId,
      });
      const pilotStart = await startPilotRun({
        storeId: req.whatsappContext.storeId,
        phoneNumberId: req.whatsappContext.phoneNumberId,
        configuration: {
          ...mapAutomationConfig(safeCurrent),
          ...(req.body || {}),
          enabled: true,
        },
        readiness,
        userId: req.user?.id,
      });
      pilotRun = pilotStart.run;
      pilotAcknowledgement = {
        at: new Date(),
        userId: req.user?.id,
        version: readiness.version,
        fingerprint: readiness.fingerprint,
      };
    }
    const config = await updateAutomationConfig({
      storeId: req.whatsappContext.storeId,
      phoneNumberId: req.whatsappContext.phoneNumberId,
      payload: req.body || {},
      userId: req.user?.id,
      pilotAcknowledgement,
    });
    const snapshot = await getAutomationSnapshot({
      storeId: req.whatsappContext.storeId,
      phoneNumberId: req.whatsappContext.phoneNumberId,
    });
    return res.json({
      ...snapshot,
      configuration: mapAutomationConfig(config),
      ...(pilotRun ? { pilotRun: mapPilotRun(pilotRun) } : {}),
    });
  } catch (error) {
    logUnexpectedPilotError('Erro ao salvar automação do WhatsApp:', error);
    return sendPilotError(res, error, 'Erro ao salvar automação do WhatsApp.');
  }
});

router.get('/surveys/stats', async (req, res) => {
  try {
    const stats = await getSurveyStats({
      storeId: req.whatsappContext.storeId,
      phoneNumberId: req.whatsappContext.phoneNumberId,
    });
    return res.json({ stats });
  } catch (error) {
    console.error('Erro ao carregar indicadores das pesquisas WhatsApp:', error);
    return res.status(500).json({ message: 'Erro ao carregar indicadores das pesquisas.' });
  }
});

router.get('/appointments/stats', async (req, res) => {
  try {
    const stats = await getAppointmentFlowStats({
      storeId: req.whatsappContext.storeId,
      phoneNumberId: req.whatsappContext.phoneNumberId,
    });
    return res.json({ stats });
  } catch (error) {
    console.error('Erro ao carregar indicadores de agendamentos WhatsApp:', error);
    return res.status(500).json({ message: 'Erro ao carregar indicadores de agendamentos.' });
  }
});

router.get('/contacts/:waId/preference', async (req, res) => {
  try {
    const waId = digitsOnly(req.params.waId);
    if (!waId) return res.status(400).json({ message: 'Contato inválido.' });
    const preference = await WhatsappContactPreference.findOne({
      store: req.whatsappContext.storeId,
      waId,
    }).lean();
    return res.json({ preference: mapContactPreference(preference) });
  } catch (error) {
    console.error('Erro ao carregar preferência WhatsApp:', error);
    return res.status(500).json({ message: 'Erro ao carregar preferência do contato.' });
  }
});

router.put('/contacts/:waId/preference', async (req, res) => {
  try {
    const waId = digitsOnly(req.params.waId);
    const status = String(req.body?.status || '').trim();
    if (!waId) return res.status(400).json({ message: 'Contato inválido.' });
    if (!['unknown', 'opted_in', 'opted_out'].includes(status)) {
      return res.status(400).json({ message: 'Preferência inválida.' });
    }
    const preference = await setContactPreference({
      storeId: req.whatsappContext.storeId,
      waId,
      status,
      source: 'staff_web',
      proof: String(req.body?.proof || '').trim(),
      userId: req.user?.id,
    });
    return res.json({ preference: mapContactPreference(preference) });
  } catch (error) {
    console.error('Erro ao salvar preferência WhatsApp:', error);
    return res.status(500).json({ message: 'Erro ao salvar preferência do contato.' });
  }
});

router.get('/conversations/:waId/state', async (req, res) => {
  try {
    const waId = digitsOnly(req.params.waId);
    if (!waId) return res.status(400).json({ message: 'Contato inválido.' });
    const conversation = await getConversationState({
      storeId: req.whatsappContext.storeId,
      phoneNumberId: req.whatsappContext.phoneNumberId,
      waId,
    });
    const snapshot = await getAutomationSnapshot({
      storeId: req.whatsappContext.storeId,
      phoneNumberId: req.whatsappContext.phoneNumberId,
    });
    return res.json({ conversation, ...snapshot });
  } catch (error) {
    console.error('Erro ao carregar estado da conversa:', error);
    return res.status(500).json({ message: 'Erro ao carregar estado da conversa.' });
  }
});

router.get('/conversations/:waId/appointment-flow', async (req, res) => {
  try {
    const waId = digitsOnly(req.params.waId);
    if (!waId) return res.status(400).json({ message: 'Contato inválido.' });
    const flow = await WhatsappAppointmentFlow.findOne({
      store: req.whatsappContext.storeId,
      phoneNumberId: req.whatsappContext.phoneNumberId,
      waId,
    }).sort({ updatedAt: -1 });
    return res.json({ appointmentFlow: mapFlow(flow) });
  } catch (error) {
    console.error('Erro ao carregar fluxo de agendamento WhatsApp:', error);
    return res.status(500).json({ message: 'Erro ao carregar fluxo de agendamento.' });
  }
});

const conversationAction = (action) => async (req, res) => {
  try {
    const waId = digitsOnly(req.params.waId);
    if (!waId) return res.status(400).json({ message: 'Contato inválido.' });
    const conversation = await transitionConversation({
      storeId: req.whatsappContext.storeId,
      phoneNumberId: req.whatsappContext.phoneNumberId,
      waId,
      action,
      userId: req.user?.id,
      pauseMinutes: req.body?.pauseMinutes,
      reason: req.body?.reason,
      io: req.app?.get('socketio'),
      requestMeta: buildRequestMeta(req),
    });
    return res.json({ conversation: mapConversationState(conversation) });
  } catch (error) {
    console.error(`Erro na ação ${action} da conversa WhatsApp:`, error);
    return res.status(error?.code ? 400 : 500).json({
      message: error?.message || 'Erro ao alterar atendimento da conversa.',
      code: error?.code,
    });
  }
};

router.post('/conversations/:waId/takeover', conversationAction('takeover'));
router.post('/conversations/:waId/release', conversationAction('release'));
router.post('/conversations/:waId/pause', conversationAction('pause'));
router.post('/conversations/:waId/close', conversationAction('close'));

module.exports = router;
