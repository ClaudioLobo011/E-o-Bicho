import { els, fmtMoney, state } from './core.js';
import api from './api.js';
import { ensureKpiBar, renderKpis } from './kpis.js';
import { CATEGORY_MAP } from './categories.js';

export async function carregarGrupos() {
  const select = els.selectGrupo;
  if (!select) return;
  select.innerHTML = `<option value="" disabled selected>Selecione um grupo</option>`;
  try {
    const grupos = await api.grupos();
    // guarda no estado para os chips/KPIs
    state.grupos = Array.isArray(grupos) ? grupos : [];
    for (const g of grupos) {
      const opt = document.createElement('option');
      opt.value = g._id;
      opt.textContent = g.nome;
      select.appendChild(opt);
    }
    // garante a barra de KPIs e renderiza
    ensureKpiBar();
    renderKpis();
  } catch (e) {
    console.error(e);
    alert('Não foi possível carregar os grupos.');
  }
}

export function renderLista(items) {
  const tbody = els.tbody;
  const empty = els.empty;
  if (!tbody || !empty) return;
  tbody.innerHTML = '';
  if (!items.length) {
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  for (const it of items) {
    const tr = document.createElement('tr');
    const grupoNome = it.grupo?.nome || '';
    const categorias = Array.isArray(it.categorias) ? it.categorias : [];
    const categoriaLabels = categorias
      .map((id) => CATEGORY_MAP[id]?.label)
      .filter(Boolean);
    const catBadges = categoriaLabels
      .map((label) => `<span class="inline-flex items-center rounded-full bg-primary/10 px-2 py-1 text-xs font-semibold text-primary">${label}</span>`)
      .join('');
    const categoriaCell = catBadges
      ? `<div class="flex flex-wrap gap-1">${catBadges}</div>`
      : '<span class="text-xs text-gray-400">Sem categoria</span>';

    tr.innerHTML = `
      <td class="px-3 py-2 font-medium text-gray-800">${it.nome || ''}</td>
      <td class="px-3 py-2 text-gray-700">${categoriaCell}</td>
      <td class="px-3 py-2 text-gray-700">${grupoNome}</td>
      <td class="px-3 py-2 text-gray-700">${Number(it.duracaoMinutos || 0)}</td>
      <td class="px-3 py-2 text-gray-700">${fmtMoney(it.custo)}</td>
      <td class="px-3 py-2 text-gray-700">${fmtMoney(it.valor)}</td>
      <td class="px-3 py-2">
        <div class="flex items-center gap-2">
          <button class="px-2 py-1 rounded bg-gray-100 hover:bg-gray-200 text-gray-800" data-edit="${it._id}"><i class="fas fa-pen"></i></button>
          <button class="px-2 py-1 rounded bg-red-50 hover:bg-red-100 text-red-700" data-del="${it._id}"><i class="fas fa-trash"></i></button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  }
}

