import { api, state, els, normalizeDate, startOfWeek, addDays, startOfMonth, startOfNextMonth, updateHeaderLabel, todayStr } from './core.js';
import { renderGrid } from './grid.js';
import { enhanceAgendaUI } from './ui.js';

export async function loadAgendamentos() {
  const base = normalizeDate(els.dateInput?.value || todayStr());
  let url = '';
  if (state.view === 'week') {
    const ini = startOfWeek(base);
    const fim = addDays(ini, 7);
    url = `/func/agendamentos/range?start=${ini}&end=${fim}&storeId=${state.selectedStoreId}`;
  } else if (state.view === 'month') {
    const m0 = startOfMonth(base);
    const m1 = startOfNextMonth(base);
    url = `/func/agendamentos/range?start=${m0}&end=${m1}&storeId=${state.selectedStoreId}`;
  } else {
    url = `/func/agendamentos?date=${base}&storeId=${state.selectedStoreId}`;
  }
  try {
    const resp = await api(url);
    if (!resp.ok) {
      const txt = await resp.text();
      console.error('GET', url, '->', resp.status, txt);
      state.agendamentos = [];
      return;
    }
    const list = await resp.json();
    state.agendamentos = Array.isArray(list) ? list : [];
    updateHeaderLabel();
    state.lastSnapshotHash = `${state.view}:${base}:${state.selectedStoreId || ''}:${state.agendamentos.length}`;
  } catch (e) {
    console.error('Erro ao carregar agendamentos', e);
    state.agendamentos = [];
  }
}

export function snapshotHash(items) {
  try {
    const compact = (items || []).map(x => [
      String(x._id || ''),
      String(x.status || ''),
      String(x.h || x.scheduledAt || ''),
      Number(x.valor || 0),
      !!x.pago
    ]).sort((a, b) => a[0].localeCompare(b[0]));
    return JSON.stringify(compact);
  } catch {
    return String(Date.now());
  }
}

export async function refreshAgendaIfChanged() {
  const prev = state.lastSnapshotHash || '';
  await loadAgendamentos();
  const next = snapshotHash(state.agendamentos);
  if (next !== prev) {
    state.lastSnapshotHash = next;
    renderGrid();
    enhanceAgendaUI();
  }
}

export function startAutoRefresh() {
  if (window.__agendaRefreshTimer) clearInterval(window.__agendaRefreshTimer);
  state.lastSnapshotHash = snapshotHash(state.agendamentos);
  window.__agendaRefreshTimer = setInterval(refreshAgendaIfChanged, 60000);
}

