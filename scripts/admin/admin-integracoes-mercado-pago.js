document.addEventListener('DOMContentLoaded', () => {
  const STORAGE_KEY = 'eobicho_mercadopago_integrations_state';
  const WEBHOOK_URL = 'https://callback.peteobicho.com.br/webhooks/mercadopago';
  const API_BASE = API_CONFIG.BASE_URL;

  const storeSelect = document.getElementById('mercadopago-store-select');
  const statusText = document.querySelector('[data-mercadopago-status]');
  const badge = document.querySelector('[data-mercadopago-badge]');
  const enabledToggle = document.getElementById('mercadopago-enabled');
  const publicKeyInput = document.getElementById('mercadopago-public-key');
  const accessTokenInput = document.getElementById('mercadopago-access-token');
  const tokenToggle = document.getElementById('mercadopago-token-toggle');
  const saveBtn = document.getElementById('mercadopago-save-btn');
  const saveStatus = document.getElementById('mercadopago-save-status');
  const webhookUrlEl = document.getElementById('mercadopago-webhook-url');
  const copyWebhookBtn = document.getElementById('mercadopago-copy-webhook');

  const defaultState = {
    selectedStoreId: '',
    enabled: false,
    credentials: {
      publicKey: '',
      accessToken: '',
      webhook: WEBHOOK_URL,
    },
  };

  let state = loadState();

  bindWebhookCard();
  loadStores();
  bindActions();

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      return mergeWithDefaults(saved || {}, defaultState);
    } catch (error) {
      return mergeWithDefaults({}, defaultState);
    }
  }

  function mergeWithDefaults(current, defaults) {
    if (Array.isArray(defaults)) return Array.isArray(current) ? current.slice() : defaults.slice();
    if (defaults && typeof defaults === 'object') {
      const merged = {};
      Object.keys(defaults).forEach((key) => {
        merged[key] = mergeWithDefaults(current ? current[key] : undefined, defaults[key]);
      });
      return merged;
    }
    return current === undefined ? defaults : current;
  }

  function persistState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function getToken() {
    try {
      return JSON.parse(localStorage.getItem('loggedInUser') || 'null')?.token || '';
    } catch {
      return '';
    }
  }

  function authHeaders(json = true) {
    const token = getToken();
    return {
      ...(json ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  }

  function notify(message, type = 'info') {
    if (typeof showToast === 'function') {
      showToast(message, type, 3500);
    }
  }

  function bindWebhookCard() {
    if (webhookUrlEl) webhookUrlEl.textContent = WEBHOOK_URL;
    if (copyWebhookBtn) {
      copyWebhookBtn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(WEBHOOK_URL);
          notify('URL copiada para a area de transferencia.', 'success');
        } catch (_) {
          notify('Nao foi possivel copiar. Copie manualmente.', 'error');
        }
      });
    }
  }

  async function loadStores() {
    if (!storeSelect) return;
    storeSelect.disabled = true;
    storeSelect.innerHTML = '<option>Carregando...</option>';

    try {
      const resp = await fetch(`${API_BASE}/stores/allowed`, { headers: authHeaders(false) });
      if (!resp.ok) {
        throw new Error(`Falha ao carregar (${resp.status})`);
      }

      const data = await resp.json().catch(() => ({}));
      const stores = Array.isArray(data?.stores) ? data.stores : Array.isArray(data) ? data : [];

      if (!stores.length) {
        storeSelect.innerHTML = '<option value="">Nenhuma empresa vinculada</option>';
        notify('Nenhuma empresa vinculada ao seu usuario.', 'warning');
        return;
      }

      const options = ['<option value="">Selecione a empresa</option>', ...stores.map((s) => `<option value="${s._id}">${s.nome}</option>`)];
      storeSelect.innerHTML = options.join('');

      const persisted = state.selectedStoreId && stores.some((s) => s._id === state.selectedStoreId);
      state.selectedStoreId = persisted ? state.selectedStoreId : (stores[0]?._id || '');
      if (state.selectedStoreId) storeSelect.value = state.selectedStoreId;
      persistState();

      if (state.selectedStoreId) {
        await fetchIntegrationForStore(state.selectedStoreId);
      }
    } catch (error) {
      console.error('mercadopago:loadStores', error);
      storeSelect.innerHTML = '<option value="">Erro ao carregar empresas</option>';
      notify('Nao foi possivel carregar as empresas vinculadas.', 'error');
    } finally {
      storeSelect.disabled = false;
    }
  }

  async function fetchIntegrationForStore(storeId) {
    if (!storeId) return;
    try {
      const resp = await fetch(`${API_BASE}/integrations/external/${storeId}`, { headers: authHeaders(false) });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(data?.message || 'Erro ao carregar integracao.');
      }
      const provider = data?.providers?.mercadopago || {};
      state.enabled = !!provider.enabled;
      state.credentials = {
        publicKey: provider.credentials?.publicKey || '',
        accessToken: provider.credentials?.accessToken || '',
        webhook: provider.credentials?.webhook || WEBHOOK_URL,
      };
      persistState();
      render();
    } catch (error) {
      console.error('mercadopago:loadIntegration', error);
      notify('Nao foi possivel carregar as credenciais do Mercado Pago.', 'error');
    }
  }

  function render() {
    if (enabledToggle) enabledToggle.checked = state.enabled;
    if (publicKeyInput) publicKeyInput.value = state.credentials.publicKey || '';
    if (accessTokenInput) accessTokenInput.value = state.credentials.accessToken || '';

    if (statusText) {
      statusText.textContent = state.enabled ? 'Ativa' : 'Desativada';
    }
    if (badge) {
      badge.className = 'inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold';
      if (state.enabled) {
        badge.classList.add('bg-emerald-50', 'text-emerald-700', 'border', 'border-emerald-200');
        badge.textContent = 'Conectado';
      } else {
        badge.classList.add('bg-amber-50', 'text-amber-700', 'border', 'border-amber-200');
        badge.textContent = 'Pendente';
      }
    }
  }

  function bindActions() {
    if (storeSelect) {
      storeSelect.addEventListener('change', async (e) => {
        state.selectedStoreId = e.target.value;
        state.enabled = false;
        state.credentials = { ...defaultState.credentials };
        persistState();
        render();
        if (state.selectedStoreId) {
          await fetchIntegrationForStore(state.selectedStoreId);
        }
      });
    }

    if (tokenToggle && accessTokenInput) {
      tokenToggle.addEventListener('click', () => {
        const isPassword = accessTokenInput.type === 'password';
        accessTokenInput.type = isPassword ? 'text' : 'password';
        tokenToggle.innerHTML = isPassword ? '<i class="fas fa-eye-slash"></i>' : '<i class="fas fa-eye"></i>';
      });
    }

    if (saveBtn) {
      saveBtn.addEventListener('click', async () => {
        if (!state.selectedStoreId) {
          notify('Selecione uma empresa para salvar.', 'warning');
          return;
        }
        state.enabled = !!enabledToggle?.checked;
        state.credentials.publicKey = publicKeyInput?.value.trim() || '';
        state.credentials.accessToken = accessTokenInput?.value.trim() || '';
        state.credentials.webhook = WEBHOOK_URL;
        renderSaveStatus('Salvando...');

        try {
          const payload = {
            providers: {
              mercadopago: {
                enabled: state.enabled,
                credentials: {
                  publicKey: state.credentials.publicKey,
                  accessToken: state.credentials.accessToken,
                  webhook: state.credentials.webhook,
                },
              },
            },
          };
          const resp = await fetch(`${API_BASE}/integrations/external/${state.selectedStoreId}`, {
            method: 'PUT',
            headers: authHeaders(true),
            body: JSON.stringify(payload),
          });
          const data = await resp.json().catch(() => ({}));
          if (!resp.ok) {
            throw new Error(data?.message || 'Falha ao salvar credenciais.');
          }
          const provider = data?.providers?.mercadopago || {};
          state.enabled = !!provider.enabled;
          state.credentials = {
            publicKey: provider.credentials?.publicKey || '',
            accessToken: provider.credentials?.accessToken || '',
            webhook: provider.credentials?.webhook || WEBHOOK_URL,
          };
          persistState();
          render();
          notify('Credenciais do Mercado Pago salvas.', 'success');
          renderSaveStatus('Atualizado agora');
        } catch (error) {
          console.error('mercadopago:save', error);
          notify(error.message || 'Nao foi possivel salvar as credenciais.', 'error');
          renderSaveStatus('Erro ao salvar');
        }
      });
    }
  }

  function renderSaveStatus(message) {
    if (!saveStatus) return;
    saveStatus.textContent = message || '';
  }
});
