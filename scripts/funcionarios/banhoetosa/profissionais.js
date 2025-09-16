import { api, state, els } from './core.js';

const DEFAULT_PROF_TYPE = 'esteticista';
const TYPE_LABELS = {
  esteticista: 'esteticista',
  veterinario: 'veterinário',
  banhista: 'banhista',
  tosador: 'tosador',
};

let modalProfissionais = [];

function normalizeProfissionais(list) {
  return (Array.isArray(list) ? list : []).map((p) => {
    const id = p && p._id != null ? String(p._id) : '';
    const rawTipo = p && p.tipo != null ? String(p.tipo) : '';
    const tipo = rawTipo.trim() ? rawTipo : DEFAULT_PROF_TYPE;
    return { ...p, _id: id, tipo };
  });
}

function renderProfOptions(list) {
  if (!els.profSelect) return;
  els.profSelect.innerHTML = list
    .map((p) => `<option value="${p._id || ''}">${p.nome || ''}</option>`)
    .join('');
}

function labelForTipo(tipo) {
  const key = String(tipo || '').trim().toLowerCase();
  if (!key) return TYPE_LABELS[DEFAULT_PROF_TYPE];
  return TYPE_LABELS[key] || key;
}

export function updateModalProfissionalLabel(preferredId) {
  if (!els.profLabel) return;
  const arr = modalProfissionais || [];
  const currentId = preferredId != null ? String(preferredId) : (els.profSelect?.value || '');
  let tipo = '';
  if (currentId) {
    const match = arr.find((p) => String(p._id) === currentId);
    if (match) tipo = match.tipo || '';
  }
  if (!tipo && arr.length) {
    tipo = arr[0].tipo || '';
  }
  const label = labelForTipo(tipo);
  els.profLabel.textContent = `Profissional (${label})`;
}

function applyModalProfissionais(list, preselectId) {
  modalProfissionais = normalizeProfissionais(list);
  renderProfOptions(modalProfissionais);
  const pid = preselectId != null ? String(preselectId) : '';
  if (els.profSelect) {
    if (pid && modalProfissionais.some((p) => String(p._id) === pid)) {
      els.profSelect.value = pid;
    } else if (modalProfissionais[0] && modalProfissionais[0]._id) {
      els.profSelect.value = modalProfissionais[0]._id;
    } else if (els.profSelect.options.length) {
      els.profSelect.selectedIndex = 0;
    }
  }
  updateModalProfissionalLabel(preselectId);
}

export async function populateModalProfissionais(storeId, preselectId) {
  try {
    if (!storeId || !els.profSelect) {
      updateModalProfissionalLabel(preselectId);
      return;
    }
    const resp = await api(`/func/profissionais?storeId=${storeId}`);
    const list = await resp.json().catch(() => []);
    applyModalProfissionais(list, preselectId);
  } catch {
    updateModalProfissionalLabel(preselectId);
  }
}

export async function loadProfissionais() {
  if (!state.selectedStoreId) {
    state.profissionais = [];
    modalProfissionais = [];
    if (els.profSelect) els.profSelect.innerHTML = '';
    updateModalProfissionalLabel();
    return;
  }
  const resp = await api(`/func/profissionais?storeId=${state.selectedStoreId}`);
  const list = await resp.json().catch(() => []);
  state.profissionais = normalizeProfissionais(list);
  modalProfissionais = state.profissionais.slice();
  if (els.profSelect) {
    const prevValue = els.profSelect.value;
    renderProfOptions(state.profissionais);
    if (prevValue && state.profissionais.some((p) => String(p._id) === prevValue)) {
      els.profSelect.value = prevValue;
    } else if (els.profSelect.options.length) {
      els.profSelect.selectedIndex = 0;
    }
  }
  updateModalProfissionalLabel();
}
