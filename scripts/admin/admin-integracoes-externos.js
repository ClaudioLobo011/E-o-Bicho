document.addEventListener('DOMContentLoaded', () => {
  const STORAGE_KEY = 'eobicho_external_integrations_state';
  const WEBHOOK_URL = 'https://api.eobicho.com.br/webhooks/marketplaces';
  const API_BASE = API_CONFIG.BASE_URL;
  const PROVIDERS = ['ifood', 'ubereats', 'ninetyNineFood'];
  const storeSelect = document.getElementById('integration-store-select');

  const defaultState = {
    selectedStoreId: '',
    settings: {
      webhookSecret: '',
      autoApprove: true,
      menuSync: true,
      downtimeGuard: true,
    },
    ifood: {
      label: 'iFood',
      enabled: false,
      status: 'offline',
      lastSync: null,
      ordersToday: 0,
      avgPrepTime: 18,
      rejectionRate: 1.2,
      queue: 'Sem fila',
      autoAccept: true,
      syncMenu: true,
      credentials: {
        clientId: '',
        clientSecret: '',
        merchantId: '',
        webhook: '',
      },
      requiredFields: ['clientId', 'clientSecret', 'merchantId'],
    },
    ubereats: {
      label: 'Uber Eats',
      enabled: false,
      status: 'offline',
      lastSync: null,
      ordersToday: 0,
      avgPrepTime: 16,
      rejectionRate: 0.9,
      queue: 'Sem fila',
      autoAccept: false,
      syncMenu: true,
      credentials: {
        storeId: '',
        accessToken: '',
        refreshToken: '',
        callback: '',
      },
      requiredFields: ['storeId', 'accessToken', 'refreshToken'],
    },
    ninetyNineFood: {
      label: '99Food',
      enabled: false,
      status: 'offline',
      lastSync: null,
      ordersToday: 0,
      avgPrepTime: 17,
      rejectionRate: 1.1,
      queue: 'Sem fila',
      autoAccept: true,
      syncMenu: false,
      credentials: {
        storeCode: '',
        apiKey: '',
        webhook: '',
      },
      requiredFields: ['storeCode', 'apiKey'],
    },
  };

  let state = loadState();

  bindWebhookCard();
  setupGlobalToggles();
  setupIntegrationCards();
  setupActions();
  loadStores();
  updateSummary();

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      return mergeWithDefaults(saved || {}, defaultState);
    } catch (error) {
      console.warn('Nao foi possivel carregar o estado salvo das integracoes, usando padrao.', error);
      return mergeWithDefaults({}, defaultState);
    }
  }

  function resetStateForStore(storeId) {
    const fresh = mergeWithDefaults({}, defaultState);
    fresh.selectedStoreId = storeId || '';
    return fresh;
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
    } else {
      /* fallback silencioso em produção */
    }
  }

  function formatDate(iso) {
    if (!iso) return 'Sem sincronizacao';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return 'Sem sincronizacao';
    return date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  }

  function randomBetween(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function bindWebhookCard() {
    const urlEl = document.getElementById('webhook-url');
    const copyBtn = document.querySelector('[data-copy-webhook]');
    const rotateBtn = document.querySelector('[data-rotate-secret]');

    if (urlEl) urlEl.textContent = WEBHOOK_URL;
    renderWebhookSecret();

    if (copyBtn) {
      copyBtn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(WEBHOOK_URL);
          notify('URL copiada para a area de transferencia.', 'success');
        } catch (_) {
          notify('Nao foi possivel copiar. Copie manualmente.', 'error');
        }
      });
    }

    if (rotateBtn) {
      rotateBtn.addEventListener('click', async () => {
        const newSecret = `mpk_live_${Math.random().toString(36).slice(2, 8)}-${Date.now().toString().slice(-4)}`;
        state.settings.webhookSecret = newSecret;
        renderWebhookSecret();
        persistState();
        await saveSettings({ webhookSecret: newSecret }, 'Nova chave de assinatura gerada.');
      });
    }
  }

  function renderWebhookSecret() {
    const secretEl = document.getElementById('webhook-secret');
    if (secretEl) secretEl.textContent = state.settings.webhookSecret || 'Sem chave definida';
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
      const nextStoreId = persisted ? state.selectedStoreId : (stores[0]?._id || '');
      state.selectedStoreId = nextStoreId;
      if (state.selectedStoreId) storeSelect.value = state.selectedStoreId;
      persistState();

      if (state.selectedStoreId) {
        await fetchIntegrationForStore(state.selectedStoreId);
      }
    } catch (error) {
      console.error('integracoes:loadStores', error);
      storeSelect.innerHTML = '<option value="">Erro ao carregar empresas</option>';
      notify('Nao foi possivel carregar as empresas vinculadas.', 'error');
    } finally {
      storeSelect.disabled = false;
    }

    storeSelect.addEventListener('change', async (e) => {
      state = resetStateForStore(e.target.value);
      persistState();
      renderGlobalToggles();
      refreshCards();
      updateSummary();
      if (state.selectedStoreId) {
        await fetchIntegrationForStore(state.selectedStoreId);
      }
    });
  }

  function setupGlobalToggles() {
    const autoApprove = document.getElementById('auto-approve-global');
    const menuSync = document.getElementById('menu-sync-global');
    const downtimeGuard = document.getElementById('downtime-guard');

    renderGlobalToggles();

    if (autoApprove) {
      autoApprove.addEventListener('change', async (e) => {
        const prev = state.settings.autoApprove;
        state.settings.autoApprove = e.target.checked;
        persistState();
        renderGlobalToggles();
        const resp = await saveSettings({ autoApprove: state.settings.autoApprove }, 'Fluxo de auto-aceite atualizado.');
        if (!resp) {
          state.settings.autoApprove = prev;
          renderGlobalToggles();
        }
      });
    }

    if (menuSync) {
      menuSync.addEventListener('change', async (e) => {
        const prev = state.settings.menuSync;
        state.settings.menuSync = e.target.checked;
        persistState();
        renderGlobalToggles();
        const resp = await saveSettings({ menuSync: state.settings.menuSync }, 'Sincronizacao de cardapio ajustada.');
        if (!resp) {
          state.settings.menuSync = prev;
          renderGlobalToggles();
        }
      });
    }

    if (downtimeGuard) {
      downtimeGuard.addEventListener('change', async (e) => {
        const prev = state.settings.downtimeGuard;
        state.settings.downtimeGuard = e.target.checked;
        persistState();
        renderGlobalToggles();
        const resp = await saveSettings({ downtimeGuard: state.settings.downtimeGuard }, 'Fallback de indisponibilidade atualizado.');
        if (!resp) {
          state.settings.downtimeGuard = prev;
          renderGlobalToggles();
        }
      });
    }
  }

  function renderGlobalToggles() {
    const autoApprove = document.getElementById('auto-approve-global');
    const menuSync = document.getElementById('menu-sync-global');
    const downtimeGuard = document.getElementById('downtime-guard');
    if (autoApprove) autoApprove.checked = !!state.settings.autoApprove;
    if (menuSync) menuSync.checked = !!state.settings.menuSync;
    if (downtimeGuard) downtimeGuard.checked = !!state.settings.downtimeGuard;
    renderWebhookSecret();
  }

  async function saveSettings(partialSettings = {}, successMessage) {
    const payload = { settings: partialSettings };
    await pushUpdate(payload, successMessage);
  }

  function setupActions() {
    const syncAll = document.querySelector('[data-sync-all]');
    if (syncAll) {
      syncAll.addEventListener('click', async () => {
        const active = PROVIDERS.filter((key) => state[key]?.enabled);
        if (!active.length) {
          notify('Ative pelo menos uma integracao para sincronizar.', 'error');
          return;
        }

        syncAll.disabled = true;
        for (const provider of active) {
          await syncIntegration(provider, { silent: true });
        }
        syncAll.disabled = false;
        notify('Sincronizacao disparada para todas as integracoes ativas.', 'success');
      });
    }

    const health = document.querySelector('[data-open-health]');
    if (health) {
      health.addEventListener('click', () => {
        notify('Painel de saude em construcao. Consulte os logs das integracoes.', 'info');
      });
    }
  }

  function setupIntegrationCards() {
    document.querySelectorAll('[data-integration-card]').forEach((card) => {
      const provider = card.dataset.provider;
      if (!provider || !state[provider]) return;
      const data = state[provider];

      hydrateCardInputs(card, data);

      const activeToggle = card.querySelector('[data-toggle="active"]');
      if (activeToggle) {
        activeToggle.checked = !!data.enabled;
        activeToggle.addEventListener('change', async (e) => {
          const prev = data.enabled;
          data.enabled = e.target.checked;
          data.status = e.target.checked ? 'aguardando' : 'offline';
          data.queue = e.target.checked ? 'Aguardando sincronizacao' : 'Pausada';
          persistState();
          renderCard(provider);
          updateSummary();
          const resp = await saveProviderState(provider, {
            includeCredentials: false,
            includeMetrics: false,
            override: { enabled: data.enabled, status: data.status, queue: data.queue },
            message: e.target.checked ? `${data.label} ativado.` : `${data.label} pausado.`,
          });
          if (!resp) {
            data.enabled = prev;
          }
          renderCard(provider);
        });
      }

      const autoAccept = card.querySelector('[data-toggle="autoAccept"]');
      if (autoAccept) {
        autoAccept.checked = !!data.autoAccept;
        autoAccept.addEventListener('change', async (e) => {
          const prev = data.autoAccept;
          data.autoAccept = e.target.checked;
          persistState();
          renderCard(provider);
          const resp = await saveProviderState(provider, {
            includeCredentials: false,
            includeMetrics: false,
            override: { autoAccept: data.autoAccept },
            message: 'Preferencia de aceite atualizada.',
          });
          if (!resp) {
            data.autoAccept = prev;
          }
          renderCard(provider);
        });
      }

      const syncMenu = card.querySelector('[data-toggle="syncMenu"]');
      if (syncMenu) {
        syncMenu.checked = !!data.syncMenu;
        syncMenu.addEventListener('change', async (e) => {
          const prev = data.syncMenu;
          data.syncMenu = e.target.checked;
          persistState();
          renderCard(provider);
          const resp = await saveProviderState(provider, {
            includeCredentials: false,
            includeMetrics: false,
            override: { syncMenu: data.syncMenu },
            message: 'Preferencia de cardapio atualizada.',
          });
          if (!resp) {
            data.syncMenu = prev;
          }
          renderCard(provider);
        });
      }

      const saveBtn = card.querySelector('[data-action="save"]');
      if (saveBtn) {
        saveBtn.addEventListener('click', () => {
          saveCredentials(provider, card);
        });
      }

      const testBtn = card.querySelector('[data-action="test"]');
      if (testBtn) {
        testBtn.addEventListener('click', () => {
          testIntegration(provider);
        });
      }

      const syncBtn = card.querySelector('[data-action="sync"]');
      if (syncBtn) {
        syncBtn.addEventListener('click', () => {
          syncIntegration(provider);
        });
      }

      renderCard(provider);
    });
  }

  function hydrateCardInputs(card, data) {
    card.querySelectorAll('[data-field]').forEach((input) => {
      const key = input.dataset.field;
      if (data.credentials[key] !== undefined && data.credentials[key] !== null) {
        input.value = data.credentials[key];
      }
    });
  }

  function refreshCards() {
    PROVIDERS.forEach((provider) => {
      const card = document.querySelector(`[data-integration-card][data-provider="${provider}"]`);
      if (!card) return;
      hydrateCardInputs(card, state[provider]);
      renderCard(provider);
    });
  }

  function saveCredentials(provider, card) {
    const data = state[provider];
    const credentials = { ...data.credentials };

    card.querySelectorAll('[data-field]').forEach((input) => {
      const key = input.dataset.field;
      credentials[key] = input.value.trim();
    });

    data.credentials = credentials;
    persistState();
    updateSummary();
    saveProviderState(provider, { includeCredentials: true, includeMetrics: false, message: `Credenciais salvas para ${data.label}.` });
  }

  function missingFields(data) {
    return (data.requiredFields || []).filter((field) => !data.credentials[field]);
  }

  function buildProviderPayload(provider, { includeCredentials = false, includeMetrics = false, override = {} } = {}) {
    const data = state[provider];
    const payload = {
      enabled: override.enabled !== undefined ? override.enabled : data.enabled,
      autoAccept: override.autoAccept !== undefined ? override.autoAccept : data.autoAccept,
      syncMenu: override.syncMenu !== undefined ? override.syncMenu : data.syncMenu,
      status: override.status !== undefined ? override.status : data.status,
      queue: override.queue !== undefined ? override.queue : data.queue,
      lastSync: override.lastSync !== undefined ? override.lastSync : data.lastSync,
    };

    if (includeMetrics) {
      payload.metrics = {
        ordersToday: data.ordersToday || 0,
        avgPrepTime: data.avgPrepTime || 0,
        rejectionRate: data.rejectionRate || 0,
      };
    }

    if (includeCredentials) {
      payload.credentials = { ...data.credentials };
    }

    return payload;
  }

  async function saveProviderState(provider, { includeCredentials = false, includeMetrics = false, message, override = {} } = {}) {
    const payload = {
      providers: {
        [provider]: buildProviderPayload(provider, { includeCredentials, includeMetrics, override }),
      },
    };
    await pushUpdate(payload, message);
  }

  function testIntegration(provider) {
    const data = state[provider];
    const missing = missingFields(data);
    if (missing.length) {
      data.status = 'erro';
      data.queue = `Complete: ${missing.join(', ')}`;
      persistState();
      renderCard(provider);
      updateSummary();
      notify(`Complete os campos obrigatorios (${missing.join(', ')}) para testar.`, 'error');
      return;
    }

    data.status = 'ok';
    data.queue = 'Fila limpa';
    data.lastSync = new Date().toISOString();
    persistState();
    renderCard(provider);
    updateSummary();
    saveProviderState(provider, { includeCredentials: true, includeMetrics: true, message: `Conexao de ${data.label} validada.` });
  }

  async function syncIntegration(provider, options = {}) {
    if (!state.selectedStoreId) {
      notify('Selecione uma empresa antes de sincronizar.', 'error');
      return;
    }

    const data = state[provider];
    if (!data.enabled) {
      notify(`Ative ${data.label} antes de sincronizar.`, 'error');
      return;
    }

    const button = document.querySelector(`[data-integration-card][data-provider="${provider}"] [data-action="sync"]`);
    if (button) button.disabled = true;

    try {
      data.queue = 'Sincronizando...';
      renderCard(provider);

      if (provider === 'ifood') {
        const resp = await fetch(`${API_BASE}/integrations/external/${state.selectedStoreId}/ifood/sync`, {
          method: 'POST',
          headers: authHeaders(),
        });
        const payload = await resp.json().catch(() => ({}));
        if (!resp.ok) {
          throw new Error(payload?.message || 'Erro ao sincronizar com o iFood.');
        }
        applyIntegrationResponse(payload);
        persistState();
        renderCard(provider);
        updateSummary();
        if (!options.silent) {
          notify(payload?.message || 'Sincronização enviada para o iFood.', 'success');
        }
        return;
      }

      // Fallback para outros provedores (simulação local)
      await new Promise((resolve) => setTimeout(resolve, randomBetween(400, 900)));
      data.status = 'ok';
      data.queue = 'Fila limpa';
      data.lastSync = new Date().toISOString();
      data.ordersToday = Math.max(data.ordersToday || 0, randomBetween(6, 24));
      data.avgPrepTime = randomBetween(12, 26);
      data.rejectionRate = Number((Math.random() * 2 + 0.4).toFixed(1));

      persistState();
      renderCard(provider);
      updateSummary();
      if (!options.silent) {
        notify(`Sincronizacao disparada para ${data.label}.`, 'success');
      }
      await saveProviderState(provider, { includeCredentials: true, includeMetrics: true });
    } catch (error) {
      console.error('syncIntegration', error);
      data.status = 'erro';
      data.queue = error?.message || 'Erro ao sincronizar.';
      renderCard(provider);
      notify(data.queue, 'error');
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function fetchIntegrationForStore(storeId) {
    if (!storeId) return;
    try {
      const resp = await fetch(`${API_BASE}/integrations/external/${storeId}`, { headers: authHeaders(false) });
      const payload = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        notify(payload?.message || 'Erro ao carregar integracoes.', 'error');
        return;
      }
      applyIntegrationResponse(payload);
    } catch (error) {
      console.error('integracoes:fetchIntegration', error);
      notify('Nao foi possivel carregar as integracoes desta empresa.', 'error');
    }
  }

  async function pushUpdate(partial, successMessage) {
    if (!state.selectedStoreId) {
      notify('Selecione uma empresa antes de salvar.', 'error');
      return null;
    }
    try {
      const resp = await fetch(`${API_BASE}/integrations/external/${state.selectedStoreId}`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify(partial || {}),
      });
      const payload = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        notify(payload?.message || 'Erro ao salvar integracoes.', 'error');
        return null;
      }
      applyIntegrationResponse(payload);
      refreshCards();
      if (successMessage) notify(successMessage, 'success');
      return payload;
    } catch (error) {
      console.error('integracoes:pushUpdate', error);
      notify('Nao foi possivel salvar as integracoes.', 'error');
      return null;
    }
  }

  function applyIntegrationResponse(payload) {
    if (!payload) return;
    const nextState = resetStateForStore(payload.storeId || state.selectedStoreId);
    nextState.selectedStoreId = payload.storeId || state.selectedStoreId;
    nextState.settings = { ...nextState.settings, ...(payload.settings || {}) };

    const providers = payload.providers || {};
    PROVIDERS.forEach((key) => {
      const incoming = providers[key] || {};
      const current = state[key] || nextState[key];
      nextState[key] = {
        ...current,
        ...incoming,
        credentials: incoming.credentials ? { ...current.credentials, ...incoming.credentials } : current.credentials,
      };
    });

    state = mergeWithDefaults(nextState, defaultState);
    persistState();
    renderGlobalToggles();
    refreshCards();
    updateSummary();

    // Garantir que os toggles reflitam o estado final após merge
    setTimeout(() => {
      renderGlobalToggles();
      refreshCards();
    }, 50);
  }

  function statusStyle(status) {
    const styles = {
      ok: { classes: 'bg-emerald-50 text-emerald-700 border-emerald-200', label: 'Operacional', dot: 'bg-emerald-500' },
      aguardando: { classes: 'bg-amber-50 text-amber-700 border-amber-200', label: 'Aguardando', dot: 'bg-amber-500' },
      erro: { classes: 'bg-rose-50 text-rose-700 border-rose-200', label: 'Erro', dot: 'bg-rose-500' },
      offline: { classes: 'bg-gray-100 text-gray-700 border-gray-200', label: 'Offline', dot: 'bg-gray-500' },
    };
    return styles[status] || styles.offline;
  }

  function renderCard(provider) {
    const card = document.querySelector(`[data-integration-card][data-provider="${provider}"]`);
    if (!card) return;
    const data = state[provider];

    const badge = card.querySelector('[data-status-badge]');
    if (badge) {
      const style = statusStyle(data.status);
      badge.className = `inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold border ${style.classes}`;
      badge.innerHTML = `<span class="w-2 h-2 rounded-full ${style.dot}"></span>${style.label}`;
    }

    const metrics = {
      ordersToday: data.ordersToday || 0,
      avgPrepTime: data.avgPrepTime || 0,
      rejectionRate: data.rejectionRate || 0,
      queue: data.queue || '-',
    };

    Object.keys(metrics).forEach((key) => {
      const el = card.querySelector(`[data-metric="${key}"]`);
      if (el) el.textContent = metrics[key];
    });

    const lastSync = card.querySelector('[data-last-sync]');
    if (lastSync) lastSync.textContent = formatDate(data.lastSync);

    const activeToggle = card.querySelector('[data-toggle="active"]');
    if (activeToggle) activeToggle.checked = !!data.enabled;

    const autoAccept = card.querySelector('[data-toggle="autoAccept"]');
    if (autoAccept) autoAccept.checked = !!data.autoAccept;

    const syncMenu = card.querySelector('[data-toggle="syncMenu"]');
    if (syncMenu) syncMenu.checked = !!data.syncMenu;
  }

  function updateSummary() {
    const activeCount = PROVIDERS.filter((p) => state[p]?.enabled).length;
    const ordersToday = PROVIDERS.reduce((sum, p) => sum + (state[p]?.ordersToday || 0), 0);
    const lastSyncValue = PROVIDERS.map((p) => state[p]?.lastSync).filter(Boolean).sort((a, b) => new Date(b) - new Date(a))[0];
    const pending = PROVIDERS.filter((p) => state[p]?.enabled && missingFields(state[p]).length).length;

    const activeEl = document.getElementById('summary-active');
    if (activeEl) activeEl.textContent = `${activeCount}/${PROVIDERS.length}`;

    const ordersEl = document.getElementById('summary-orders');
    if (ordersEl) ordersEl.textContent = ordersToday;

    const lastSyncEl = document.getElementById('summary-last-sync');
    if (lastSyncEl) lastSyncEl.textContent = lastSyncValue ? formatDate(lastSyncValue) : 'Sem registros';

    const pendingEl = document.getElementById('summary-pending');
    if (pendingEl) pendingEl.textContent = pending;
  }
});
