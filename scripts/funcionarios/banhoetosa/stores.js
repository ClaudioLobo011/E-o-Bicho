import { state, els, notify, token, STORE_STORAGE_KEY } from './core.js';

export function loadSelectedStoreFromStorage() {
  try {
    const raw = localStorage.getItem(STORE_STORAGE_KEY);
    const value = String(raw || '').trim();
    if (!value) return '';
    state.selectedStoreId = value;
    return value;
  } catch {
    return '';
  }
}

export function saveSelectedStoreToStorage(storeId) {
  try {
    const value = String(storeId || '').trim();
    if (!value) {
      localStorage.removeItem(STORE_STORAGE_KEY);
      return;
    }
    localStorage.setItem(STORE_STORAGE_KEY, value);
  } catch {}
}

export async function loadStores() {
  let stores = [];
  try {
    const resp = await fetch(`${API_CONFIG.BASE_URL}/stores/allowed`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!resp.ok) {
      throw new Error(`Falha ao carregar empresas (${resp.status})`);
    }
    const data = await resp.json().catch(() => ({}));
    stores = Array.isArray(data?.stores) ? data.stores : Array.isArray(data) ? data : [];
  } catch (error) {
    console.error('agenda-banho:loadStores', error);
    notify('Não foi possível carregar as empresas vinculadas ao seu usuário.', 'error');
    stores = [];
  }

  state.stores = stores;

  const hasSelection = stores.some((s) => s && s._id === state.selectedStoreId);
  if (!hasSelection) {
    state.selectedStoreId = stores[0]?._id || '';
  }
  saveSelectedStoreToStorage(state.selectedStoreId);

  const optionsHtml = stores.length
    ? ['<option value=\"\">Selecione a empresa</option>', ...stores.map((s) => `<option value=\"${s._id}\">${s.nome}</option>`)].join('')
    : '<option value=\"\">Nenhuma empresa vinculada</option>';

  if (els.storeSelect) {
    els.storeSelect.innerHTML = optionsHtml;
    if (state.selectedStoreId) {
      els.storeSelect.value = state.selectedStoreId;
    }
  }

  if (els.addStoreSelect) {
    els.addStoreSelect.innerHTML = optionsHtml;
    if (state.selectedStoreId) {
      els.addStoreSelect.value = state.selectedStoreId;
    }
  }

  updateStoreLabel();
}

export function updateStoreLabel() {
  const s = state.stores.find(x => x._id === state.selectedStoreId);
  if (els.storeLabelVisible) els.storeLabelVisible.textContent = s ? s.nome : '—';
  const vis = document.getElementById('agenda-store-label-visible');
  if (vis) vis.textContent = s ? s.nome : '—';
}
