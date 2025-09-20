// Entry initialization for the Vet ficha clínica
import { els, debounce } from './core.js';
import { openConsultaModal } from './consultas.js';
import { openVacinaModal } from './vacinas.js';
import { openAnexoModal } from './anexos.js';
import { openDocumentoModal } from './documentos.js';
import { openReceitaModal } from './receitas.js';
import { openExameModal } from './exames.js';
import { openPesoModal } from './pesos.js';
import { openObservacaoModal } from './observacoes.js';
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

export function initFichaClinica() {
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
