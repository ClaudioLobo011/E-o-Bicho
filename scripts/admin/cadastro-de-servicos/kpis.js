import { els, state, getFilteredServicos, getGrupoIdFromItem } from './core.js';
import { renderLista } from './ui.js';

export function ensureKpiBar() {
  if (document.getElementById('serv-kpis')) return;
  if (!els.tbody) return;
  // tenta inserir acima da tabela
  const tableWrap = els.tbody.closest('div');
  const card = tableWrap?.parentElement || null;
  const where = card || els.tbody.parentElement;
  if (!where) return;
  const bar = document.createElement('div');
  bar.id = 'serv-kpis';
  bar.className = 'mb-4';
  bar.innerHTML = `
    <div id="serv-kpis-top" class="flex flex-wrap items-center gap-2 mb-2"></div>
    <div id="serv-kpis-groups" class="flex flex-wrap items-center gap-2"></div>
  `;
  where.insertBefore(bar, tableWrap);
}

function computeCountsByGroup() {
  const counts = new Map();
  for (const s of state.servicos || []) {
    const gid = getGrupoIdFromItem(s);
    if (!gid) continue;
    counts.set(gid, (counts.get(gid) || 0) + 1);
  }
  return counts;
}

function computeCountsByFunc() {
  const counts = new Map();
  const wanted = new Set(['esteticista', 'veterinario']);
  for (const s of state.servicos || []) {
    const tipos = (s.grupo && s.grupo.tiposPermitidos) || [];
    for (const t of Array.isArray(tipos) ? tipos : []) {
      if (!wanted.has(t)) continue;
      counts.set(t, (counts.get(t) || 0) + 1);
    }
  }
  return counts;
}

function labelFunc(key) {
  switch (key) {
    case 'esteticista': return 'Esteticista';
    case 'veterinario': return 'Veterinário';
    default: return key;
  }
}

export function renderKpis() {
  const bar = document.getElementById('serv-kpis');
  if (!bar) return;
  const top = document.getElementById('serv-kpis-top');
  const below = document.getElementById('serv-kpis-groups');
  if (!top || !below) return;

  const all = state.servicos || [];
  const filtered = getFilteredServicos();

  // Top row: totals + function chips
  const countsFunc = computeCountsByFunc();
  const funcoesDisponiveis = ['esteticista', 'veterinario'].filter(f => (countsFunc.get(f) || 0) > 0);
  const chipsFunc = funcoesDisponiveis.map(f => {
    const active = state.filters.func === f ? 'chip-active' : '';
    const n = countsFunc.get(f) || 0;
    return `<button class="chip ${active}" data-func="${f}">${labelFunc(f)} <span class="chip-badge">${n}</span></button>`;
  }).join('');

  const clearTop = state.filters.func
    ? `<button id="serv-func-clear" class="chip chip-clear" title="Limpar função">Limpar</button>` : '';

  top.innerHTML = `
    <div class="kpi-chip">Total: <strong>${all.length}</strong></div>
    ${state.filters.func || state.filters.grupoIds.size ? `<div class=\"kpi-chip kpi-muted\">Filtrados: <strong>${filtered.length}</strong></div>` : ''}
    <span class="chip-sep"></span>
    ${chipsFunc}
    ${clearTop}
  `;

  // Second row: group chips for selected function
  const countsGroup = computeCountsByGroup();
  const funcSel = state.filters.func;
  const groupsForFunc = (state.grupos || []).filter(g => Array.isArray(g.tiposPermitidos) && (!funcSel || g.tiposPermitidos.includes(funcSel)));

  const chipsGroups = groupsForFunc.map(g => {
    const id = String(g._id);
    const active = state.filters.grupoIds.has(id) ? 'chip-active' : '';
    const n = countsGroup.get(id) || 0;
    return `<button class="chip ${active}" data-grupo="${id}">${g.nome} <span class="chip-badge">${n}</span></button>`;
  }).join('');

  const clearGroups = state.filters.grupoIds.size
    ? `<button id="serv-chip-clear" class="chip chip-clear" title="Limpar grupos">Limpar grupos</button>` : '';

  below.innerHTML = chipsGroups ? chipsGroups + clearGroups : '';
  below.style.display = funcSel ? 'flex' : 'none';

  // events
  top.querySelectorAll('button.chip[data-func]')?.forEach(btn => {
    btn.addEventListener('click', () => {
      const f = btn.getAttribute('data-func');
      state.filters.func = (state.filters.func === f) ? '' : f;
      // quando muda função, limpamos grupos
      state.filters.grupoIds.clear();
      renderKpis();
      renderLista(getFilteredServicos());
    });
  });
  const clearF = document.getElementById('serv-func-clear');
  if (clearF) clearF.addEventListener('click', () => {
    state.filters.func = '';
    state.filters.grupoIds.clear();
    renderKpis();
    renderLista(getFilteredServicos());
  });

  below.querySelectorAll('button.chip[data-grupo]')?.forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-grupo');
      if (!id) return;
      state.filters.grupoIds.has(id) ? state.filters.grupoIds.delete(id) : state.filters.grupoIds.add(id);
      renderKpis();
      renderLista(getFilteredServicos());
    });
  });

  const clearG = document.getElementById('serv-chip-clear');
  if (clearG) clearG.addEventListener('click', () => {
    state.filters.grupoIds.clear();
    renderKpis();
    renderLista(getFilteredServicos());
  });
}
