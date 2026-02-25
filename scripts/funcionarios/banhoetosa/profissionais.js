import { api, state, els, AGENDA_NO_PREFERENCE_PROF_ID, buildNoPreferenceProfessional } from './core.js';

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
  els.profSelect.innerHTML = (Array.isArray(list) ? list : [])
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
    if (match && !String(match._id).includes(AGENDA_NO_PREFERENCE_PROF_ID)) tipo = match.tipo || '';
  }
  if (!tipo && arr.length) {
    tipo = arr[0].tipo || '';
  }
  const label = labelForTipo(tipo);
  els.profLabel.textContent = `Profissional (${label})`;
}

export function getModalProfissionalTipo(preferredId) {
  const arr = modalProfissionais || [];
  const currentId = preferredId != null ? String(preferredId) : (els.profSelect?.value || '');
  if (currentId) {
    const match = arr.find((p) => String(p._id) === currentId);
    if (match && match.tipo) return String(match.tipo).trim();
  }
  if (arr.length && arr[0].tipo) {
    return String(arr[0].tipo).trim();
  }
  return DEFAULT_PROF_TYPE;
}

function applyModalProfissionais(list, preselectId) {
  modalProfissionais = [buildNoPreferenceProfessional(), ...normalizeProfissionais(list)];
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
  modalProfissionais = [buildNoPreferenceProfessional(), ...state.profissionais];
  if (els.profSelect) {
    const prevValue = els.profSelect.value;
    renderProfOptions(modalProfissionais);
    if (
      prevValue &&
      (prevValue === AGENDA_NO_PREFERENCE_PROF_ID ||
        state.profissionais.some((p) => String(p._id) === prevValue))
    ) {
      els.profSelect.value = prevValue;
    } else if (els.profSelect.options.length) {
      els.profSelect.selectedIndex = 0;
    }
  }
  updateModalProfissionalLabel();
}

export function getModalProfissionaisList() {
  return modalProfissionais.slice();
}
