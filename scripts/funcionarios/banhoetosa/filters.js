import { state, els, FILTER_STORAGE_KEY, money, getFilteredAgendamentos, getVisibleProfissionais, normalizeStatus } from './core.js';
import { renderGrid } from './grid.js';
import { enhanceAgendaUI } from './ui.js';

// ---- Persistência dos filtros ----
export function loadFiltersFromStorage() {
  try {
    const raw = JSON.parse(localStorage.getItem(FILTER_STORAGE_KEY) || 'null');
    if (raw && typeof raw === 'object') {
      state.filters.statuses = new Set(Array.isArray(raw.statuses) ? raw.statuses : []);
      state.filters.profIds  = new Set(Array.isArray(raw.profIds)  ? raw.profIds  : []);
      state.filters.profTipo = typeof raw.profTipo === 'string' ? raw.profTipo : '';
    }
  } catch {}
}
export function saveFiltersToStorage() {
  try {
    localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify({
      statuses: Array.from(state.filters.statuses),
      profIds : Array.from(state.filters.profIds),
      profTipo: state.filters.profTipo || ''
    }));
  } catch {}
}

// ---- Toolbar fixa (KPIs + filtros) ----
export function ensureToolbar() {
  if (!els.agendaList) return;
  if (document.getElementById('agenda-toolbar')) return;

  const bar = document.createElement('div');
  bar.id = 'agenda-toolbar';
  bar.className = 'sticky top-0 z-30 bg-white/90 backdrop-blur supports-[backdrop-filter]:bg-white/70 border-b border-slate-200 mb-2 flex flex-col gap-2 px-3 py-2 rounded-lg';

  const kpis = document.createElement('div');
  kpis.id = 'agenda-kpis';
  kpis.className = 'flex flex-wrap items-center gap-2';
  bar.appendChild(kpis);

  const filters = document.createElement('div');
  filters.id = 'agenda-filters';
  filters.className = 'flex flex-col gap-2';
  bar.appendChild(filters);

  // insere a barra imediatamente antes da lista da agenda
  const parent = els.agendaList.parentElement || document.body;
  parent.insertBefore(bar, els.agendaList);
}

// ---- KPIs ----
function computeKPIs(items) {
  const total = items.length;
  const previsto = items.reduce((s, i) => s + Number(i.valor || 0), 0);
  const recebido = items.reduce((s, i) => s + (i.pago ? Number(i.valor || 0) : 0), 0);
  const pendente = previsto - recebido;
  return { total, previsto, recebido, pendente };
}

function labelTipo(t) {
  const k = String(t || '').trim().toLowerCase();
  if (!k) return '—';
  const map = { esteticista: 'Esteticista', banhista: 'Banhista', tosador: 'Tosador', veterinario: 'Veterinário' };
  return map[k] || (k.charAt(0).toUpperCase() + k.slice(1));
}

export function renderKpis() {
  const wrap = document.getElementById('agenda-kpis');
  if (!wrap) return;

  const all = state.agendamentos || [];
  const f   = getFilteredAgendamentos();

  const kAll = computeKPIs(all);
  const kF   = computeKPIs(f);

  const needClear = (state.filters.statuses.size || state.filters.profIds.size || state.filters.profTipo);
  const totalLabel = state.view === 'week' ? 'Total semana' : (state.view === 'month' ? 'Total mês' : 'Total dia');

  wrap.innerHTML = `
    <div class="kpi-chip">${totalLabel}: <strong>${kAll.total}</strong></div>
    <div class="kpi-chip">Previsto: <strong>${money(kAll.previsto)}</strong></div>
    <div class="kpi-chip">Recebido: <strong>${money(kAll.recebido)}</strong></div>
    <div class="kpi-chip">Pendente: <strong>${money(kAll.pendente)}</strong></div>
    ${ needClear ? `<div class="kpi-chip kpi-muted">Filtrados: <strong>${kF.total}</strong></div>` : '' }
  `;
}

// ---- Filtros (chips) ----
export function renderFilters() {
  const el = document.getElementById('agenda-filters');
  if (!el) return;

  // contadores por status
  const counts = { agendado:0, em_espera:0, em_atendimento:0, finalizado:0 };
  for (const a of (state.agendamentos || [])) {
    const key = normalizeStatus(a.status);
    if (counts[key] !== undefined) counts[key] += 1;
  }

  const statuses = [
    {key:'agendado',       label:'Agend.'},
    {key:'em_espera',      label:'Espera'},
    {key:'em_atendimento', label:'Atend.'},
    {key:'finalizado',     label:'Fim.'}
  ];
  const chipsStatus = statuses.map(s => {
    const active = state.filters.statuses.has(s.key) ? 'chip-active' : '';
    return `<button class="chip ${active}" data-filter="status" data-value="${s.key}">${s.label} <span class="chip-badge">${counts[s.key] || 0}</span></button>`;
  }).join('');

  // contadores por profissional (para badges)
  const byProf = new Map();
  for (const a of (state.agendamentos || [])) {
    const id = a.profissionalId || (a.profissional && a.profissional._id) || null;
    if (!id) continue;
    const key = String(id);
    byProf.set(key, (byProf.get(key) || 0) + 1);
  }

  // tipos disponíveis e chips
  const tipos = Array.from(new Set((state.profissionais || []).map(p => String(p.tipo || 'esteticista')))).sort();
  const chipsTipos = tipos.map(t => {
    const active = state.filters.profTipo === t ? 'chip-active' : '';
    const n = (state.profissionais || []).filter(p => (p.tipo || 'esteticista') === t).length;
    return `<button class="chip ${active}" data-filter="tipo" data-value="${t}">${labelTipo(t)} <span class="chip-badge">${n}</span></button>`;
  }).join('');

  // chips de profissionais por tipo selecionado
  const selectedType = state.filters.profTipo || '';
  const profsAll = state.profissionais || [];
  const chipsProfPorTipo = selectedType ? (profsAll || [])
    .filter(p => (p.tipo || 'esteticista') === selectedType)
    .map(p => {
      const id = String(p._id);
      const active = state.filters.profIds.has(id) ? 'chip-active' : '';
      const n = byProf.get(id) || 0;
      return `<button class="chip ${active}" data-filter="prof" data-value="${id}" title="${p.nome}">${p.nome} <span class="chip-badge">${n}</span></button>`;
    }).join('') : '';

  const needClear = (state.filters.statuses.size || state.filters.profIds.size || state.filters.profTipo);
  const clearBtn = needClear ? `<button id="chip-clear" class="chip chip-clear" title="Limpar filtros">Limpar</button>` : '';

  el.innerHTML = `
    <div class="flex flex-wrap items-center gap-2 mb-2">
      ${chipsStatus}
      <span class="chip-sep"></span>
      ${chipsTipos}
      ${clearBtn}
    </div>
    <div id="chips-prof-by-type" class="flex flex-wrap items-center gap-2" style="${selectedType ? '' : 'display:none'}">
      ${chipsProfPorTipo}
    </div>
  `;

  // eventos
  el.querySelectorAll('.chip[data-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      const type = btn.getAttribute('data-filter');
      const val  = btn.getAttribute('data-value');
      if (type === 'status') {
        state.filters.statuses.has(val) ? state.filters.statuses.delete(val) : state.filters.statuses.add(val);
      } else if (type === 'tipo') {
        state.filters.profTipo = (state.filters.profTipo === val) ? '' : val;
        state.filters.profIds.clear();
      } else if (type === 'prof') {
        state.filters.profIds.has(val) ? state.filters.profIds.delete(val) : state.filters.profIds.add(val);
      }
      saveFiltersToStorage();
      renderKpis();
      renderFilters();
      renderGrid();
      enhanceAgendaUI();
    });
  });

  const clear = document.getElementById('chip-clear');
  if (clear) clear.addEventListener('click', () => {
    state.filters.statuses.clear();
    state.filters.profIds.clear();
    state.filters.profTipo = '';
    saveFiltersToStorage();
    renderKpis();
    renderFilters();
    renderGrid();
    enhanceAgendaUI();
  });
}
