import { state, els } from './core.js';

export async function loadStores() {
  const resp = await fetch(`${API_CONFIG.BASE_URL}/stores`);
  const list = await resp.json().catch(() => []);
  state.stores = Array.isArray(list) ? list : [];
  if (els.storeSelect) {
    els.storeSelect.innerHTML = state.stores.map(s => `<option value="${s._id}">${s.nome}</option>`).join('');
  }
  if (!state.selectedStoreId && state.stores[0]) {
    state.selectedStoreId = state.stores[0]._id;
    if (els.storeSelect) els.storeSelect.value = state.selectedStoreId;
  }
  updateStoreLabel();
}

export function updateStoreLabel() {
  const s = state.stores.find(x => x._id === state.selectedStoreId);
  if (els.storeLabelVisible) els.storeLabelVisible.textContent = s ? s.nome : '—';
  const vis = document.getElementById('agenda-store-label-visible');
  if (vis) vis.textContent = s ? s.nome : '—';
}

