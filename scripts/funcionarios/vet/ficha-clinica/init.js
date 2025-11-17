// Entry initialization for the Vet ficha clínica
import { els, debounce, state, normalizeId, pickFirst, formatPhone, notify } from './core.js';
import { openConsultaModal, loadConsultasFromServer, loadWaitingAppointments } from './consultas.js';
import { openVacinaModal, loadVacinasForSelection, handleVacinaRealTimeEvent } from './vacinas.js';
import {
  openAnexoModal,
  loadAnexosForSelection,
  loadAnexosFromServer,
  handleAnexoRealTimeEvent,
} from './anexos.js';
import { openDocumentoModal, loadDocumentosFromServer } from './documentos.js';
import { openReceitaModal, loadReceitasFromServer } from './receitas.js';
import { openExameModal, loadExamesForSelection, handleExameRealTimeEvent } from './exames.js';
import { openPesoModal, loadPesosFromServer } from './pesos.js';
import {
  openObservacaoModal,
  loadObservacoesForSelection,
  handleObservacaoRealTimeEvent,
} from './observacoes.js';
import {
  searchClientes,
  hideSugestoes,
  onSelectPet,
  clearCliente,
  clearPet,
  restorePersistedSelection,
} from './tutor.js';
import { updateCardDisplay, updatePageVisibility, setCardMode } from './ui.js';
import {
  initAtendimentoActions,
  activateHistoricoTab,
  activateConsultaTab,
  reopenCurrentAgendamento,
  handleAtendimentoRealTimeEvent,
} from './atendimento.js';
import { loadHistoricoForSelection } from './historico.js';
import {
  initFichaRealTime,
  registerFichaUpdateHandler,
} from './real-time.js';

let remoteSyncTimeout = null;
let remoteSyncRunning = false;

async function performRemoteSync() {
  if (remoteSyncRunning) return;
  remoteSyncRunning = true;
  try {
    await Promise.allSettled([
      loadConsultasFromServer({ force: true }),
      loadWaitingAppointments({ force: true }),
      loadAnexosFromServer({ force: true }),
      loadPesosFromServer({ force: true }),
      loadDocumentosFromServer({ force: true }),
      loadReceitasFromServer({ force: true }),
      loadHistoricoForSelection(),
    ]);
    loadVacinasForSelection();
    loadAnexosForSelection();
    loadExamesForSelection();
    loadObservacoesForSelection();
    updateCardDisplay();
    updatePageVisibility();
  } finally {
    remoteSyncRunning = false;
  }
}

function scheduleRemoteSync() {
  if (remoteSyncTimeout) return;
  remoteSyncTimeout = setTimeout(() => {
    remoteSyncTimeout = null;
    performRemoteSync().catch((error) => {
      console.error('Erro ao sincronizar dados da ficha clínica em tempo real.', error);
    });
  }, 150);
}

function handleFichaRealTimeMessage(message) {
  const event = message && typeof message === 'object' ? message.event : null;
  let handled = false;

  if (event && typeof event === 'object') {
    const scope = event.scope;
    if (scope === 'atendimento') {
      handled = handleAtendimentoRealTimeEvent(event) || handled;
    } else if (scope === 'vacina') {
      handled = handleVacinaRealTimeEvent(event) || handled;
    } else if (scope === 'exame') {
      handled = handleExameRealTimeEvent(event) || handled;
    } else if (scope === 'observacao') {
      handled = handleObservacaoRealTimeEvent(event) || handled;
    } else if (scope === 'anexo') {
      handled = handleAnexoRealTimeEvent(event) || handled;
    }
  }

  if (handled) {
    updateCardDisplay();
    updatePageVisibility();
  }

  scheduleRemoteSync();
}

export function initFichaClinica() {
  initFichaRealTime();
  registerFichaUpdateHandler(handleFichaRealTimeMessage);

  if (els.cliInput) {
    const debouncedSearch = debounce((value) => searchClientes(value), 300);
    els.cliInput.addEventListener('input', (event) => {
      debouncedSearch(event.target.value);
    });
    document.addEventListener('click', (event) => {
      if (!els.cliSug || els.cliSug.classList.contains('hidden')) return;
      const within = event.target === els.cliInput || els.cliSug.contains(event.target);
      if (!within) hideSugestoes();
    });
  }

  if (els.cliClear) {
    els.cliClear.addEventListener('click', (event) => {
      event.preventDefault();
      clearCliente();
    });
  }

  if (els.petSelect) {
    els.petSelect.addEventListener('change', (event) => {
      const result = onSelectPet(event.target.value);
      if (result && typeof result.then === 'function') {
        result.catch(() => {});
      }
    });
  }

  if (els.petClear) {
    els.petClear.addEventListener('click', (event) => {
      event.preventDefault();
      clearPet();
    });
  }

  if (els.toggleTutor) {
    els.toggleTutor.addEventListener('click', (event) => {
      event.preventDefault();
      setCardMode('tutor');
    });
  }

  if (els.togglePet) {
    els.togglePet.addEventListener('click', (event) => {
      event.preventDefault();
      setCardMode('pet');
    });
  }

  if (els.addConsultaBtn) {
    els.addConsultaBtn.addEventListener('click', (event) => {
      event.preventDefault();
      openConsultaModal();
    });
  }

  if (els.reopenAgendamentoBtn) {
    els.reopenAgendamentoBtn.addEventListener('click', async (event) => {
      event.preventDefault();
      if (els.reopenAgendamentoBtn.classList.contains('hidden')) return;
      if (els.reopenAgendamentoBtn.dataset.processing === 'true') return;
      els.reopenAgendamentoBtn.dataset.processing = 'true';
      els.reopenAgendamentoBtn.classList.add('opacity-60', 'cursor-not-allowed');
      try {
        await reopenCurrentAgendamento();
      } finally {
        delete els.reopenAgendamentoBtn.dataset.processing;
        els.reopenAgendamentoBtn.classList.remove('opacity-60', 'cursor-not-allowed');
      }
    });
  }

  if (els.addVacinaBtn) {
    els.addVacinaBtn.addEventListener('click', (event) => {
      event.preventDefault();
      openVacinaModal();
    });
  }

  if (els.addAnexoBtn) {
    els.addAnexoBtn.addEventListener('click', (event) => {
      event.preventDefault();
      openAnexoModal();
    });
  }

  if (els.addDocumentoBtn) {
    els.addDocumentoBtn.addEventListener('click', (event) => {
      event.preventDefault();
      openDocumentoModal();
    });
  }

  if (els.addReceitaBtn) {
    els.addReceitaBtn.addEventListener('click', (event) => {
      event.preventDefault();
      openReceitaModal();
    });
  }

  if (els.addExameBtn) {
    els.addExameBtn.addEventListener('click', (event) => {
      event.preventDefault();
      openExameModal();
    });
  }

  if (els.addPesoBtn) {
    els.addPesoBtn.addEventListener('click', (event) => {
      event.preventDefault();
      openPesoModal();
    });
  }

  if (els.addObservacaoBtn) {
    els.addObservacaoBtn.addEventListener('click', (event) => {
      event.preventDefault();
      openObservacaoModal();
    });
  }

  initInternacaoShortcut();

  if (els.consultaTab) {
    els.consultaTab.addEventListener('click', (event) => {
      event.preventDefault();
      activateConsultaTab();
    });
  }

  if (els.historicoTab) {
    els.historicoTab.addEventListener('click', (event) => {
      event.preventDefault();
      activateHistoricoTab();
    });
  }

  initAtendimentoActions();
  updateCardDisplay();
  restorePersistedSelection();
  updatePageVisibility();
}

function initInternacaoShortcut() {
  if (!els.openInternacaoBtn) return;
  els.openInternacaoBtn.addEventListener('click', (event) => {
    const petId = normalizeId(state.selectedPetId);
    const tutor = state.selectedCliente || {};
    const pet = (petId && state.petsById && state.petsById[petId]) || null;

    if (!petId || !pet) {
      event.preventDefault();
      notify('Selecione um pet na ficha clínica antes de encaminhar para a internação.', 'warning');
      return;
    }

    const petNome = pickFirst(pet?.nome, pet?.petNome, pet?.apelido, pet?.nomePet);
    const petEspecie = pickFirst(pet?.especie, pet?.tipoPet, pet?.tipo, pet?.categoria);
    const petRaca = pickFirst(pet?.raca, pet?.racaPrincipal, pet?.racaPet);
    const petPeso = pickFirst(pet?.peso, pet?.pesoAtual, pet?.pesoKg, pet?.pesoAtualKg);
    const petIdade = pickFirst(pet?.idade, pet?.idadeFormatada, pet?.idadePet);
    const tutorNome = pickFirst(tutor?.nome, tutor?.razaoSocial);
    const tutorId = normalizeId(tutor?._id || tutor?.id || tutor?.clienteId);
    const tutorDocumento = pickFirst(
      tutor?.documento,
      tutor?.documentoPrincipal,
      tutor?.cpf,
      tutor?.cpfCnpj,
      tutor?.cnpj,
      tutor?.doc,
    );
    const tutorContato = pickFirst(formatPhone(tutor?.celular), formatPhone(tutor?.telefone), tutor?.email);

    const payload = {
      petId,
      petNome,
      petEspecie,
      petRaca,
      petPeso,
      petIdade,
      tutorId,
      tutorNome,
      tutorDocumento,
      tutorContato,
    };

    try {
      sessionStorage.setItem('internacaoPreselect', JSON.stringify(payload));
    } catch (error) {
      console.warn('internacao preselect storage', error);
    }

    const params = new URLSearchParams();
    params.set('internar', '1');
    params.set('petId', petId);
    if (petNome) params.set('petNome', petNome);
    if (tutorNome) params.set('tutorNome', tutorNome);

    const baseUrl = './internacao/animais-internados.html';
    const url = `${baseUrl}?${params.toString()}`;
    event.preventDefault();
    const novaGuia = window.open(url, '_blank', 'noopener');
    if (novaGuia) {
      novaGuia.focus();
    }
  });
}
