// Entry initialization for the Vet ficha clínica
import { els, debounce } from './core.js';
import { openConsultaModal, loadConsultasFromServer } from './consultas.js';
import { openVacinaModal, loadVacinasForSelection, handleVacinaRealTimeEvent } from './vacinas.js';
import {
  openAnexoModal,
  loadAnexosForSelection,
  loadAnexosFromServer,
} from './anexos.js';
import { openDocumentoModal, loadDocumentosFromServer } from './documentos.js';
import { openReceitaModal, loadReceitasFromServer } from './receitas.js';
import { openExameModal, loadExamesForSelection, handleExameRealTimeEvent } from './exames.js';
import { openPesoModal, loadPesosFromServer } from './pesos.js';
import { openObservacaoModal, loadObservacoesForSelection } from './observacoes.js';
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
    if (scope === 'vacina') {
      handled = handleVacinaRealTimeEvent(event) || handled;
    } else if (scope === 'exame') {
      handled = handleExameRealTimeEvent(event) || handled;
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
