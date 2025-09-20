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
import { getConsultasKey, updateConsultaAgendaCard, updateMainTabLayout } from './consultas.js';
import {
  addHistoricoEntry,
  removeHistoricoEntry,
  renderHistoricoArea,
  getHistoricoEntryById,
  setHistoricoReopenHandler,
  setActiveMainTab,
  persistHistoricoEntry,
} from './historico.js';

function deepClone(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
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
  state.anexos = [];
  state.exames = [];
  state.pesos = [];
  state.observacoes = [];
  state.documentos = [];
  state.receitas = [];
}

let isProcessingFinalizacao = false;

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
      const clienteId = normalizeId(state.selectedCliente?._id);
      const petId = normalizeId(state.selectedPetId);
      let confirmed = true;
      if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
        confirmed = window.confirm('Limpar os registros atuais da consulta? Esta ação não altera o histórico.');
      }
      if (!confirmed) return;
      clearLocalStoredDataForSelection(clienteId, petId);
      resetConsultaState();
      updateConsultaAgendaCard();
      notify('Registros da consulta atual foram limpos.', 'info');
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
