// Entry initialization for the Vet ficha clínica
import { els, debounce } from './core.js';
import { openConsultaModal } from './consultas.js';
import { openVacinaModal } from './vacinas.js';
import { openAnexoModal } from './anexos.js';
import {
  searchClientes,
  hideSugestoes,
  onSelectPet,
  clearCliente,
  clearPet,
  restorePersistedSelection,
} from './tutor.js';
import { updateCardDisplay, updatePageVisibility, setCardMode } from './ui.js';

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

  updateCardDisplay();
  restorePersistedSelection();
  updatePageVisibility();
}
