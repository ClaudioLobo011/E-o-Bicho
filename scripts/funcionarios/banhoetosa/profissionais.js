import { api, state, els } from './core.js';

export async function populateModalProfissionais(storeId, preselectId) {
  try {
    if (!storeId || !els.profSelect) return;
    const resp = await api(`/func/profissionais?storeId=${storeId}`);
    const list = await resp.json().catch(() => []);
    const arr = Array.isArray(list) ? list : [];
    els.profSelect.innerHTML = arr.map(p => `<option value="${p._id}">${p.nome}</option>`).join('');
    const pid = preselectId ? String(preselectId) : '';
    if (pid && arr.some(p => String(p._id) === pid)) {
      els.profSelect.value = pid;
    } else if (arr[0]) {
      els.profSelect.value = String(arr[0]._id);
    }
  } catch {}
}

export async function loadProfissionais() {
  if (!state.selectedStoreId) {
    state.profissionais = [];
    if (els.profSelect) els.profSelect.innerHTML = '';
    return;
  }
  const resp = await api(`/func/profissionais?storeId=${state.selectedStoreId}`);
  const list = await resp.json().catch(() => []);
  state.profissionais = (Array.isArray(list) ? list : []).map(p => ({ ...p, tipo: p.tipo || 'esteticista' }));
  if (els.profSelect) {
    els.profSelect.innerHTML = state.profissionais
      .map(p => `<option value="${p._id}">${p.nome}</option>`)
      .join('');
  }
}
