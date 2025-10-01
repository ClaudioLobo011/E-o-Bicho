import { els, state, todayStr } from './core.js';
import { loadStores, updateStoreLabel } from './stores.js';
import { loadProfissionais, populateModalProfissionais } from './profissionais.js';
import { loadAgendamentos, startAutoRefresh } from './agendamentos.js';
import { renderGrid } from './grid.js';
import { enhanceAgendaUI } from './ui.js';
import { ensureToolbar, loadFiltersFromStorage, renderKpis, renderFilters } from './filters.js';
import { openAddModal, closeModal, saveAgendamento, bindModalAndActionsEvents } from './modal.js';
import { handlePrintCupom } from './print.js';

function ensureTodayButton() {
  if (!els.dateInput) return;
  if (document.getElementById('agenda-today-btn')) return;
  const btn = document.createElement('button');
  btn.id = 'agenda-today-btn';
  btn.type = 'button';
  btn.className = 'ml-2 inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-slate-300 text-slate-700 hover:bg-slate-50';
  btn.textContent = 'Hoje';
  els.dateInput.insertAdjacentElement('afterend', btn);
  btn.addEventListener('click', async () => {
    els.dateInput.value = todayStr();
    state.__didInitialScroll = false;
    await loadAgendamentos();
    renderGrid();
    enhanceAgendaUI();
  });
}

function setupShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (e.target && ['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName)) return;
    if (e.key === 't' || e.key === 'T') {
      if (els.dateInput) {
        els.dateInput.value = todayStr();
        state.__didInitialScroll = false;
        loadAgendamentos().then(() => { renderKpis(); renderFilters(); renderGrid(); enhanceAgendaUI(); });
      }
    }
    if (e.key === 'n' || e.key === 'N') {
      e.preventDefault();
      openAddModal();
    }
  });
}

function bindBaseEvents() {
  els.addBtn?.addEventListener('click', () => {
    openAddModal();
  });
  els.modalClose?.addEventListener('click', closeModal);
  els.modalCancel?.addEventListener('click', closeModal);
  els.modalSave?.addEventListener('click', saveAgendamento);
  els.addStoreSelect?.addEventListener('change', () => {
    const sid = els.addStoreSelect.value;
    const current = els.profSelect?.value || '';
    populateModalProfissionais(sid, current);
  });
  // Bind/imprime agenda (garante nosso listener)
  const btn0 = document.getElementById('print-agenda-btn');
  if (btn0) {
    const clone = btn0.cloneNode(true);
    btn0.parentNode.replaceChild(clone, btn0);
    clone.addEventListener('click', (ev) => { ev.preventDefault(); ev.stopImmediatePropagation?.(); handlePrintCupom(); });
  }
  els.storeSelect?.addEventListener('change', async () => {
    state.selectedStoreId = els.storeSelect.value;
    updateStoreLabel();
    state.__didInitialScroll = false;
    await loadProfissionais();
    await loadAgendamentos();
    renderKpis();
    renderFilters();
    renderGrid();
    enhanceAgendaUI();
  });
  els.dateInput?.addEventListener('change', async () => {
    state.__didInitialScroll = false;
    await loadAgendamentos();
    renderKpis();
    renderFilters();
    renderGrid();
    enhanceAgendaUI();
  });
  els.viewSelect?.addEventListener('change', async () => {
    state.view = els.viewSelect.value || 'day';
    state.__didInitialScroll = false;
    await loadAgendamentos();
    renderKpis();
    renderFilters();
    renderGrid();
    enhanceAgendaUI();
  });
}

export async function initBanhoETosa() {
  if (!els.dateInput?.value) els.dateInput.value = todayStr();
  if (els.viewSelect && !els.viewSelect.value) els.viewSelect.value = 'day';
  state.view = (els.viewSelect?.value) || 'day';
  loadFiltersFromStorage();
  await loadStores();
  if (!state.selectedStoreId && els.storeSelect?.value) {
    state.selectedStoreId = els.storeSelect.value;
  }
  await loadProfissionais();
  await loadAgendamentos();
  ensureToolbar();
  ensureTodayButton();
  setupShortcuts();
  bindBaseEvents();
  bindModalAndActionsEvents();
  // Força o uso dos handlers diretos nos botões (desativa delegação antiga)
  window.__forceDirectHandlers = true;
  renderKpis();
  renderFilters();
  renderGrid();
  enhanceAgendaUI();
  startAutoRefresh();
}
