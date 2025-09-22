// Atendimento actions for finalizar and reabrir fluxos
import {
  state,
  els,
  api,
  notify,
  persistAgendaContext,
  normalizeId,
  VACINA_STORAGE_PREFIX,
  ANEXO_STORAGE_PREFIX,
  EXAME_STORAGE_PREFIX,
  OBSERVACAO_STORAGE_PREFIX,
  isConsultaLockedForCurrentUser,
  isAdminRole,
} from './core.js';
import {
  getConsultasKey,
  updateConsultaAgendaCard,
  updateMainTabLayout,
  deleteConsulta,
} from './consultas.js';
import {
  addHistoricoEntry,
  removeHistoricoEntry,
  renderHistoricoArea,
  getHistoricoEntryById,
  setHistoricoReopenHandler,
  setActiveMainTab,
  persistHistoricoEntry,
} from './historico.js';
import { emitFichaClinicaUpdate } from './real-time.js';
import { deleteVacina } from './vacinas.js';
import { deleteAnexo, isExameAttachmentRecord } from './anexos.js';
import { deleteExame } from './exames.js';
import { deletePeso } from './pesos.js';
import { deleteObservacao } from './observacoes.js';
import { deleteDocumentoRegistro } from './documentos.js';
import { deleteReceitaRegistro } from './receitas.js';

function deepClone(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

function buildAtendimentoEventPayload(extra = {}) {
  const payload = { ...extra };
  const clienteId = normalizeId(state.selectedCliente?._id);
  const petId = normalizeId(state.selectedPetId);
  const agenda = state.agendaContext && typeof state.agendaContext === 'object' ? state.agendaContext : null;
  const appointmentId = normalizeId(agenda?.appointmentId);

  if (clienteId) payload.clienteId = clienteId;
  if (petId) payload.petId = petId;
  if (appointmentId) payload.appointmentId = appointmentId;

  if (agenda) {
    if (agenda.status) {
      payload.agendaStatus = String(agenda.status);
    }
    if (Array.isArray(agenda.servicos)) {
      payload.agendaServicos = deepClone(agenda.servicos) || [...agenda.servicos];
    }
    if (agenda.valor !== undefined) {
      const valor = Number(agenda.valor);
      if (!Number.isNaN(valor)) {
        payload.agendaValor = valor;
      }
    }
    const profissional =
      agenda.profissionalNome !== undefined
        ? agenda.profissionalNome
        : agenda.profissional !== undefined
          ? agenda.profissional
          : undefined;
    if (profissional !== undefined) {
      payload.agendaProfissional = profissional;
    }
  }

  return payload;
}

function buildHistoricoEntryFromState() {
  const clienteId = normalizeId(state.selectedCliente?._id);
  const petId = normalizeId(state.selectedPetId);
  const appointmentId = normalizeId(state.agendaContext?.appointmentId);
  if (!(clienteId && petId && appointmentId)) return null;
  const now = new Date().toISOString();
  return {
    id: `hist-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    clienteId,
    petId,
    appointmentId,
    finalizadoEm: now,
    agenda: deepClone(state.agendaContext) || {},
    consultas: deepClone(state.consultas) || [],
    vacinas: deepClone(state.vacinas) || [],
    anexos: deepClone(state.anexos) || [],
    exames: deepClone(state.exames) || [],
    pesos: deepClone(state.pesos) || [],
    observacoes: deepClone(state.observacoes) || [],
    documentos: deepClone(state.documentos) || [],
    receitas: deepClone(state.receitas) || [],
  };
}

function findHistoricoEntryByAppointmentId(appointmentId) {
  const targetId = normalizeId(appointmentId);
  if (!targetId) return null;
  const historicos = Array.isArray(state.historicos) ? state.historicos : [];
  return (
    historicos.find((item) => normalizeId(item?.appointmentId || item?.appointment) === targetId) || null
  );
}

function clearLocalStoredDataForSelection(clienteId, petId) {
  const base = getConsultasKey(clienteId, petId);
  if (!base) return;
  try {
    localStorage.removeItem(`${VACINA_STORAGE_PREFIX}${base}`);
  } catch {}
  try {
    localStorage.removeItem(`${ANEXO_STORAGE_PREFIX}${base}`);
  } catch {}
  try {
    localStorage.removeItem(`${EXAME_STORAGE_PREFIX}${base}`);
  } catch {}
  try {
    localStorage.removeItem(`${OBSERVACAO_STORAGE_PREFIX}${base}`);
  } catch {}
}

function persistLocalDataForSelection(clienteId, petId) {
  const base = getConsultasKey(clienteId, petId);
  if (!base) return;
  try {
    if (Array.isArray(state.vacinas) && state.vacinas.length) {
      localStorage.setItem(`${VACINA_STORAGE_PREFIX}${base}`, JSON.stringify(state.vacinas));
    } else {
      localStorage.removeItem(`${VACINA_STORAGE_PREFIX}${base}`);
    }
  } catch {}
  try {
    if (Array.isArray(state.anexos) && state.anexos.length) {
      localStorage.setItem(`${ANEXO_STORAGE_PREFIX}${base}`, JSON.stringify(state.anexos));
    } else {
      localStorage.removeItem(`${ANEXO_STORAGE_PREFIX}${base}`);
    }
  } catch {}
  try {
    if (Array.isArray(state.exames) && state.exames.length) {
      localStorage.setItem(`${EXAME_STORAGE_PREFIX}${base}`, JSON.stringify(state.exames));
    } else {
      localStorage.removeItem(`${EXAME_STORAGE_PREFIX}${base}`);
    }
  } catch {}
  try {
    if (Array.isArray(state.observacoes) && state.observacoes.length) {
      localStorage.setItem(`${OBSERVACAO_STORAGE_PREFIX}${base}`, JSON.stringify(state.observacoes));
    } else {
      localStorage.removeItem(`${OBSERVACAO_STORAGE_PREFIX}${base}`);
    }
  } catch {}
}

function resetConsultaState() {
  state.consultas = [];
  state.consultasLoading = false;
  state.consultasLoadKey = null;
  state.vacinas = [];
  state.vacinasLoadKey = null;
  state.anexos = [];
  state.anexosLoadKey = null;
  state.exames = [];
  state.examesLoadKey = null;
  state.pesos = [];
  state.pesosLoadKey = null;
  state.observacoes = [];
  state.observacoesLoadKey = null;
  state.documentos = [];
  state.documentosLoadKey = null;
  state.receitas = [];
  state.receitasLoadKey = null;
}

function setLimparConsultaProcessing(isProcessing) {
  if (!els.limparConsultaBtn) return;
  if (isProcessing) {
    els.limparConsultaBtn.setAttribute('disabled', 'disabled');
    els.limparConsultaBtn.classList.add('opacity-60', 'cursor-not-allowed');
  } else {
    els.limparConsultaBtn.removeAttribute('disabled');
    els.limparConsultaBtn.classList.remove('opacity-60', 'cursor-not-allowed');
  }
}

let isProcessingLimpeza = false;
let isProcessingFinalizacao = false;

async function limparConsultaAtual() {
  if (isProcessingLimpeza) return;

  const clienteId = normalizeId(state.selectedCliente?._id);
  const petId = normalizeId(state.selectedPetId);

  let confirmed = true;
  if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
    confirmed = window.confirm('Limpar os registros atuais da consulta? Esta ação não altera o histórico.');
  }
  if (!confirmed) return;

  isProcessingLimpeza = true;
  setLimparConsultaProcessing(true);

  const errorMessages = new Set();
  const recordError = (tag, error, fallbackMessage) => {
    if (error) {
      console.error(tag, error);
    }
    const message = (error && error.message) || fallbackMessage;
    if (message) {
      errorMessages.add(message);
    }
  };

  const hasSelection = !!(clienteId && petId);
  const appointmentId = normalizeId(state.agendaContext?.appointmentId);

  try {
    if (hasSelection) {
      const consultas = Array.isArray(state.consultas) ? [...state.consultas] : [];
      for (const consulta of consultas) {
        try {
          await deleteConsulta(consulta, { skipConfirm: true, suppressNotify: true });
        } catch (error) {
          recordError('limparConsultaAtual/deleteConsulta', error, 'Não foi possível remover um registro de consulta.');
        }
      }

      if (appointmentId) {
        const vacinas = Array.isArray(state.vacinas) ? [...state.vacinas] : [];
        for (const vacina of vacinas) {
          try {
            await deleteVacina(vacina, { skipConfirm: true, suppressNotify: true });
          } catch (error) {
            recordError('limparConsultaAtual/deleteVacina', error, 'Não foi possível remover uma vacina registrada.');
          }
        }

        const exames = Array.isArray(state.exames) ? [...state.exames] : [];
        for (const exame of exames) {
          try {
            await deleteExame(exame, { skipConfirm: true, suppressNotify: true });
          } catch (error) {
            recordError('limparConsultaAtual/deleteExame', error, 'Não foi possível remover um exame registrado.');
          }
        }
      }

      const documentos = Array.isArray(state.documentos) ? [...state.documentos] : [];
      for (const documento of documentos) {
        try {
          await deleteDocumentoRegistro(documento, { suppressNotify: true });
        } catch (error) {
          recordError('limparConsultaAtual/deleteDocumento', error, 'Não foi possível remover um documento salvo.');
        }
      }

      const receitas = Array.isArray(state.receitas) ? [...state.receitas] : [];
      for (const receita of receitas) {
        try {
          await deleteReceitaRegistro(receita, { suppressNotify: true });
        } catch (error) {
          recordError('limparConsultaAtual/deleteReceita', error, 'Não foi possível remover uma receita salva.');
        }
      }

      const pesos = Array.isArray(state.pesos) ? state.pesos.filter((entry) => entry && !entry.isInitial) : [];
      for (const peso of pesos) {
        try {
          await deletePeso(peso, { skipConfirm: true, suppressNotify: true, skipReload: true });
        } catch (error) {
          recordError('limparConsultaAtual/deletePeso', error, 'Não foi possível remover um registro de peso.');
        }
      }

      const anexos = Array.isArray(state.anexos)
        ? state.anexos.filter((anexo) => !isExameAttachmentRecord(anexo))
        : [];
      for (const anexo of anexos) {
        try {
          await deleteAnexo(anexo, { skipConfirm: true, suppressNotify: true, skipReload: true });
        } catch (error) {
          recordError('limparConsultaAtual/deleteAnexo', error, 'Não foi possível remover um anexo enviado.');
        }
      }

      const observacoes = Array.isArray(state.observacoes) ? [...state.observacoes] : [];
      for (const observacao of observacoes) {
        try {
          await deleteObservacao(observacao, { suppressNotify: true });
        } catch (error) {
          recordError('limparConsultaAtual/deleteObservacao', error, 'Não foi possível remover uma observação registrada.');
        }
      }
    }

    clearLocalStoredDataForSelection(clienteId, petId);
    resetConsultaState();
    updateConsultaAgendaCard();

    if (hasSelection) {
      const eventPayload = buildAtendimentoEventPayload({
        scope: 'atendimento',
        action: 'limpar',
      });
      emitFichaClinicaUpdate(eventPayload).catch(() => {});
    }

    if (errorMessages.size) {
      if (errorMessages.size === 1) {
        notify([...errorMessages][0], 'warning');
      } else {
        console.warn('limparConsultaAtual errors:', [...errorMessages]);
        notify('Alguns registros não puderam ser removidos. Verifique e tente novamente.', 'warning');
      }
    } else {
      notify('Registros da consulta atual foram limpos.', 'info');
    }
  } catch (error) {
    console.error('limparConsultaAtual', error);
    notify(error?.message || 'Erro ao limpar os registros da consulta.', 'error');
  } finally {
    isProcessingLimpeza = false;
    setLimparConsultaProcessing(false);
  }
}

export async function finalizarAtendimento() {
  if (isProcessingFinalizacao) return;
  const clienteId = normalizeId(state.selectedCliente?._id);
  const petId = normalizeId(state.selectedPetId);
  const appointmentId = normalizeId(state.agendaContext?.appointmentId);
  if (!(clienteId && petId)) {
    notify('Selecione um tutor e um pet antes de finalizar o atendimento.', 'warning');
    return;
  }
  if (!appointmentId) {
    notify('Abra a ficha pela agenda para finalizar o atendimento.', 'warning');
    return;
  }

  if (isConsultaLockedForCurrentUser()) {
    notify('Apenas o veterinário responsável pode finalizar este atendimento.', 'warning');
    return;
  }

  const entry = buildHistoricoEntryFromState();
  if (!entry) {
    notify('Não foi possível coletar os dados do atendimento atual.', 'error');
    return;
  }

  let confirmed = true;
  if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
    confirmed = window.confirm('Finalizar o atendimento? Os registros serão movidos para o histórico.');
  }
  if (!confirmed) return;

  isProcessingFinalizacao = true;
  if (els.finalizarAtendimentoBtn) {
    els.finalizarAtendimentoBtn.disabled = true;
    els.finalizarAtendimentoBtn.classList.add('opacity-60', 'cursor-not-allowed');
  }

  try {
    const response = await api(`/func/agendamentos/${appointmentId}`, {
      method: 'PUT',
      body: JSON.stringify({ status: 'finalizado' }),
    });
    const data = await response.json().catch(() => (response.ok ? {} : {}));
    if (!response.ok) {
      const message = typeof data?.message === 'string' ? data.message : 'Erro ao atualizar status do agendamento.';
      throw new Error(message);
    }

    if (!state.agendaContext || typeof state.agendaContext !== 'object') {
      state.agendaContext = {};
    }
    state.agendaContext.status = 'finalizado';
    if (data && typeof data === 'object') {
      if (Array.isArray(data.servicos)) {
        state.agendaContext.servicos = data.servicos;
      }
      if (typeof data.valor === 'number') {
        state.agendaContext.valor = Number(data.valor);
      }
      if (data.profissional) {
        state.agendaContext.profissionalNome = data.profissional;
      }
    }
    persistAgendaContext(state.agendaContext);

    let savedEntry = null;
    try {
      savedEntry = await persistHistoricoEntry(entry);
    } catch (persistError) {
      console.error('persistHistoricoEntry', persistError);
      notify(persistError.message || 'Não foi possível sincronizar o histórico do atendimento.', 'warning');
      savedEntry = entry;
    }

    addHistoricoEntry(savedEntry);

    clearLocalStoredDataForSelection(clienteId, petId);
    resetConsultaState();

    state.activeMainTab = 'historico';
    updateMainTabLayout();
    renderHistoricoArea();
    updateConsultaAgendaCard();

    const historicoId = normalizeId(
      (savedEntry && (savedEntry.id || savedEntry._id)) || (entry && (entry.id || entry._id)),
    );
    const historicoSnapshot = deepClone(savedEntry || entry) || savedEntry || entry || null;
    const eventPayload = buildAtendimentoEventPayload({
      scope: 'atendimento',
      action: 'finalizar',
      historicoId: historicoId || null,
      finalizadoEm: (savedEntry || entry)?.finalizadoEm || new Date().toISOString(),
      ...(historicoSnapshot ? { historico: historicoSnapshot } : {}),
    });
    emitFichaClinicaUpdate(eventPayload).catch(() => {});

    notify('Atendimento finalizado com sucesso.', 'success');
  } catch (error) {
    console.error('finalizarAtendimento', error);
    notify(error.message || 'Erro ao finalizar atendimento.', 'error');
  } finally {
    isProcessingFinalizacao = false;
    if (els.finalizarAtendimentoBtn) {
      els.finalizarAtendimentoBtn.disabled = false;
      els.finalizarAtendimentoBtn.classList.remove('opacity-60', 'cursor-not-allowed');
    }
  }
}

async function reopenHistoricoEntry(entry, closeModal) {
  if (!entry) return;
  const clienteId = normalizeId(entry.clienteId);
  const petId = normalizeId(entry.petId);
  const appointmentId = normalizeId(entry.appointmentId);
  const entryId = normalizeId(entry.id || entry._id || entry.key);
  if (!(clienteId && petId && appointmentId)) {
    notify('Não foi possível identificar o atendimento selecionado.', 'error');
    return;
  }

  let confirmed = true;
  if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
    confirmed = window.confirm('Reabrir o atendimento para edição? Ele retornará para a aba Consulta.');
  }
  if (!confirmed) return;

  let statusUpdated = false;

  try {
    const response = await api(`/func/agendamentos/${appointmentId}`, {
      method: 'PUT',
      body: JSON.stringify({ status: 'em_atendimento' }),
    });
    const data = await response.json().catch(() => (response.ok ? {} : {}));
    if (!response.ok) {
      const message = typeof data?.message === 'string' ? data.message : 'Erro ao atualizar status do agendamento.';
      throw new Error(message);
    }

    statusUpdated = true;

    if (entryId) {
      const deleteResponse = await api(`/func/vet/historicos/${entryId}`, {
        method: 'DELETE',
      });
      const deleteData = await deleteResponse.json().catch(() => (deleteResponse.ok ? {} : {}));
      if (!deleteResponse.ok && deleteResponse.status !== 404) {
        const message = typeof deleteData?.message === 'string'
          ? deleteData.message
          : 'Erro ao remover histórico do atendimento.';
        throw new Error(message);
      }
    }

    removeHistoricoEntry(entryId || entry.id);

    state.consultas = Array.isArray(entry.consultas) ? entry.consultas : [];
    state.vacinas = Array.isArray(entry.vacinas) ? entry.vacinas : [];
    state.anexos = Array.isArray(entry.anexos) ? entry.anexos : [];
    state.exames = Array.isArray(entry.exames) ? entry.exames : [];
    state.pesos = Array.isArray(entry.pesos) ? entry.pesos : [];
    state.observacoes = Array.isArray(entry.observacoes) ? entry.observacoes : [];
    state.documentos = Array.isArray(entry.documentos) ? entry.documentos : [];
    state.receitas = Array.isArray(entry.receitas) ? entry.receitas : [];

    persistLocalDataForSelection(clienteId, petId);

    const agendaSnapshot = entry.agenda && typeof entry.agenda === 'object' ? { ...entry.agenda } : {};
    if (!state.agendaContext || typeof state.agendaContext !== 'object') {
      state.agendaContext = {};
    }
    state.agendaContext = {
      ...agendaSnapshot,
      ...state.agendaContext,
      status: 'em_atendimento',
      appointmentId,
    };
    persistAgendaContext(state.agendaContext);

    state.activeMainTab = 'consulta';
    updateMainTabLayout();
    updateConsultaAgendaCard();
    renderHistoricoArea();

    if (typeof closeModal === 'function') {
      closeModal();
    }

    const reopenSnapshot = deepClone(entry) || entry || null;
    const eventPayload = buildAtendimentoEventPayload({
      scope: 'atendimento',
      action: 'reabrir',
      historicoId: entryId || entry.id || null,
      ...(reopenSnapshot ? { reopened: reopenSnapshot } : {}),
    });
    emitFichaClinicaUpdate(eventPayload).catch(() => {});

    notify('Atendimento reaberto para edição.', 'success');
  } catch (error) {
    if (statusUpdated) {
      try {
        await api(`/func/agendamentos/${appointmentId}`, {
          method: 'PUT',
          body: JSON.stringify({ status: 'finalizado' }),
        });
      } catch (rollbackError) {
        console.error('rollbackReopenHistoricoEntry', rollbackError);
      }
    }
    console.error('reopenHistoricoEntry', error);
    notify(error.message || 'Erro ao reabrir atendimento.', 'error');
  }
}

export async function reopenCurrentAgendamento() {
  if (!isAdminRole()) {
    notify('Apenas administradores podem reabrir atendimentos finalizados.', 'warning');
    return;
  }

  const appointmentId = normalizeId(state.agendaContext?.appointmentId);
  if (!appointmentId) {
    notify('Nenhum agendamento finalizado selecionado para reabrir.', 'warning');
    return;
  }

  const entry = findHistoricoEntryByAppointmentId(appointmentId);
  if (!entry) {
    if (state.historicosLoading) {
      notify('Aguarde o carregamento do histórico para reabrir o atendimento.', 'info');
    } else {
      notify('Não foi possível localizar o histórico deste atendimento.', 'warning');
    }
    return;
  }

  await reopenHistoricoEntry(entry);
}

setHistoricoReopenHandler((entry, closeModal) => {
  const fullEntry = typeof entry === 'string' ? getHistoricoEntryById(entry) : entry;
  return reopenHistoricoEntry(fullEntry || getHistoricoEntryById(entry?.id), closeModal);
});

export function handleAtendimentoRealTimeEvent(event = {}) {
  if (!event || typeof event !== 'object') return false;
  if (event.scope && event.scope !== 'atendimento') return false;

  const action = String(event.action || '').toLowerCase();
  if (!action) return false;

  const targetClienteId = normalizeId(event.clienteId || event.tutorId || event.cliente);
  const targetPetId = normalizeId(event.petId || event.pet);
  const targetAppointmentId = normalizeId(event.appointmentId || event.agendamentoId || event.appointment);

  const currentClienteId = normalizeId(state.selectedCliente?._id);
  const currentPetId = normalizeId(state.selectedPetId);
  const currentAppointmentId = normalizeId(state.agendaContext?.appointmentId);

  if (targetClienteId && currentClienteId && targetClienteId !== currentClienteId) return false;
  if (targetPetId && currentPetId && targetPetId !== currentPetId) return false;
  if (targetAppointmentId && currentAppointmentId && targetAppointmentId !== currentAppointmentId) return false;

  if (action === 'finalizar') {
    if (!state.agendaContext || typeof state.agendaContext !== 'object') {
      state.agendaContext = {};
    }
    if (targetAppointmentId) {
      state.agendaContext.appointmentId = targetAppointmentId;
    }
    const status = String(event.agendaStatus || 'finalizado');
    state.agendaContext.status = status;

    if (Array.isArray(event.agendaServicos)) {
      const servicos = deepClone(event.agendaServicos) || [...event.agendaServicos];
      state.agendaContext.servicos = servicos;
      state.agendaContext.totalServicos = servicos.length;
    }

    if (event.agendaValor !== undefined) {
      const valor = Number(event.agendaValor);
      if (!Number.isNaN(valor)) {
        state.agendaContext.valor = valor;
      }
    }

    if (event.agendaProfissional !== undefined) {
      state.agendaContext.profissionalNome = event.agendaProfissional || '';
    }

    if (event.finalizadoEm) {
      state.agendaContext.finalizadoEm = event.finalizadoEm;
    }

    persistAgendaContext(state.agendaContext);

    const clienteId = targetClienteId || currentClienteId;
    const petId = targetPetId || currentPetId;
    if (clienteId && petId) {
      clearLocalStoredDataForSelection(clienteId, petId);
    }
    resetConsultaState();

    const historicoEntry = event.historico || event.historicoEntry || event.historicoSnapshot;
    if (historicoEntry) {
      addHistoricoEntry(historicoEntry);
    }

    state.activeMainTab = 'historico';
    updateMainTabLayout();
    renderHistoricoArea();
    updateConsultaAgendaCard();
    notify('O atendimento foi finalizado por outro usuário.', 'info');
    return true;
  }

  if (action === 'reabrir') {
    if (!state.agendaContext || typeof state.agendaContext !== 'object') {
      state.agendaContext = {};
    }
    if (targetAppointmentId) {
      state.agendaContext.appointmentId = targetAppointmentId;
    }
    const status = String(event.agendaStatus || 'em_atendimento');
    state.agendaContext.status = status;

    if (Array.isArray(event.agendaServicos)) {
      const servicos = deepClone(event.agendaServicos) || [...event.agendaServicos];
      state.agendaContext.servicos = servicos;
      state.agendaContext.totalServicos = servicos.length;
    }

    if (event.agendaValor !== undefined) {
      const valor = Number(event.agendaValor);
      if (!Number.isNaN(valor)) {
        state.agendaContext.valor = valor;
      }
    }

    if (event.agendaProfissional !== undefined) {
      state.agendaContext.profissionalNome = event.agendaProfissional || '';
    }

    persistAgendaContext(state.agendaContext);

    const historicoId = normalizeId(event.historicoId || event.historico?.id || event.historico?._id);
    if (historicoId) {
      removeHistoricoEntry(historicoId);
    }

    const clienteId = targetClienteId || currentClienteId;
    const petId = targetPetId || currentPetId;

    const reopenedSnapshot =
      deepClone(event.reopened || event.historico || event.historicoEntry) ||
      event.reopened ||
      event.historico ||
      event.historicoEntry ||
      null;

    if (reopenedSnapshot && typeof reopenedSnapshot === 'object') {
      state.consultas = Array.isArray(reopenedSnapshot.consultas) ? reopenedSnapshot.consultas : [];
      state.vacinas = Array.isArray(reopenedSnapshot.vacinas) ? reopenedSnapshot.vacinas : [];
      state.anexos = Array.isArray(reopenedSnapshot.anexos) ? reopenedSnapshot.anexos : [];
      state.exames = Array.isArray(reopenedSnapshot.exames) ? reopenedSnapshot.exames : [];
      state.pesos = Array.isArray(reopenedSnapshot.pesos) ? reopenedSnapshot.pesos : [];
      state.observacoes = Array.isArray(reopenedSnapshot.observacoes) ? reopenedSnapshot.observacoes : [];
      state.documentos = Array.isArray(reopenedSnapshot.documentos) ? reopenedSnapshot.documentos : [];
      state.receitas = Array.isArray(reopenedSnapshot.receitas) ? reopenedSnapshot.receitas : [];

      if (clienteId && petId) {
        persistLocalDataForSelection(clienteId, petId);
      }
    } else {
      resetConsultaState();
    }

    state.activeMainTab = 'consulta';
    updateMainTabLayout();
    renderHistoricoArea();
    updateConsultaAgendaCard();
    notify('O atendimento foi reaberto por outro usuário.', 'info');
    return true;
  }

  if (action === 'limpar') {
    if (!state.agendaContext || typeof state.agendaContext !== 'object') {
      state.agendaContext = targetAppointmentId ? { appointmentId: targetAppointmentId } : {};
    } else if (targetAppointmentId) {
      state.agendaContext.appointmentId = targetAppointmentId;
    }

    if (targetClienteId) {
      state.agendaContext.tutorId = targetClienteId;
    }
    if (targetPetId) {
      state.agendaContext.petId = targetPetId;
    }

    if (event.agendaStatus !== undefined) {
      state.agendaContext.status = String(event.agendaStatus);
    }

    if (Array.isArray(event.agendaServicos)) {
      const servicos = deepClone(event.agendaServicos) || [...event.agendaServicos];
      state.agendaContext.servicos = servicos;
      state.agendaContext.totalServicos = servicos.length;
    } else if (state.agendaContext) {
      if (Array.isArray(state.agendaContext.servicos)) {
        state.agendaContext.totalServicos = state.agendaContext.servicos.length;
      } else {
        delete state.agendaContext.totalServicos;
      }
    }

    if (event.agendaValor !== undefined) {
      const valor = Number(event.agendaValor);
      if (!Number.isNaN(valor)) {
        state.agendaContext.valor = valor;
      }
    }

    if (event.agendaProfissional !== undefined) {
      state.agendaContext.profissionalNome = event.agendaProfissional || '';
    }

    persistAgendaContext(state.agendaContext);

    const clienteId = targetClienteId || currentClienteId;
    const petId = targetPetId || currentPetId;
    if (clienteId && petId) {
      clearLocalStoredDataForSelection(clienteId, petId);
    }
    resetConsultaState();
    updateConsultaAgendaCard();
    notify('Os registros da consulta foram limpos por outro usuário.', 'info');
    return true;
  }

  return false;
}

export function initAtendimentoActions() {
  if (els.finalizarAtendimentoBtn) {
    els.finalizarAtendimentoBtn.addEventListener('click', (event) => {
      event.preventDefault();
      finalizarAtendimento();
    });
  }
  if (els.limparConsultaBtn) {
    els.limparConsultaBtn.addEventListener('click', (event) => {
      event.preventDefault();
      const result = limparConsultaAtual();
      if (result && typeof result.then === 'function') {
        result.catch(() => {});
      }
    });
  }
}

export function activateHistoricoTab() {
  setActiveMainTab('historico');
  renderHistoricoArea();
}

export function activateConsultaTab() {
  setActiveMainTab('consulta');
  updateConsultaAgendaCard();
}
