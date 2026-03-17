document.addEventListener('DOMContentLoaded', () => {
  const select = document.getElementById('security-company-select');
  const feedback = document.getElementById('security-company-feedback');
  const tableBody = document.getElementById('security-screens-body');
  const tableEmpty = document.getElementById('security-screens-empty');
  const bulkActions = document.getElementById('security-bulk-actions');
  const screenFilterInput = document.getElementById('security-screen-filter');
  const sortAscButton = document.getElementById('security-screen-sort-asc');
  const sortDescButton = document.getElementById('security-screen-sort-desc');
  const sidebarPlaceholder = document.getElementById('admin-sidebar-placeholder');
  if (!select) return;

  const API_BASE = API_CONFIG.BASE_URL;
  const STORAGE_KEY = 'eobicho-security-company';
  const SECURITY_ENDPOINT = `${API_BASE}/admin/screen-security`;

  const state = {
    screenConfig: {},
    currentCompanyId: '',
    requestId: 0,
    saveTimer: null,
    screenFilter: '',
    screenSortDirection: 'asc',
  };

  const getToken = () => {
    try {
      return JSON.parse(localStorage.getItem('loggedInUser') || 'null')?.token || '';
    } catch {
      return '';
    }
  };

  const getStorageKey = () => {
    try {
      const user = JSON.parse(localStorage.getItem('loggedInUser') || 'null') || {};
      const userId = user?.id || user?._id || '';
      return userId ? `${STORAGE_KEY}:${userId}` : STORAGE_KEY;
    } catch {
      return STORAGE_KEY;
    }
  };

  const getStoredCompanyId = () => {
    try {
      return localStorage.getItem(getStorageKey()) || '';
    } catch {
      return '';
    }
  };

  const setStoredCompanyId = (value) => {
    try {
      const key = getStorageKey();
      if (value) {
        localStorage.setItem(key, value);
      } else {
        localStorage.removeItem(key);
      }
    } catch {
      // ignore storage errors
    }
  };

  const notifyRulesUpdated = () => {
    window.dispatchEvent(new CustomEvent('security:rules-updated'));
  };

  const setFeedback = (message, tone = 'info') => {
    if (!feedback) return;
    const toneClass =
      tone === 'error' ? 'text-red-600' : tone === 'warning' ? 'text-amber-600' : 'text-gray-500';
    feedback.className = `mt-2 text-xs ${toneClass}`;
    feedback.textContent = message || '';
  };

  const showToastMessage = (message, type = 'success') => {
    if (typeof window.showToast !== 'function') return;
    window.showToast(message, type, 2400);
  };

  const getAuthHeaders = () => {
    const token = getToken();
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  };

  const rowActions = [
    { key: 'hide', label: 'Nao mostrar' },
    { key: 'block', label: 'Bloquear' },
    { key: 'password', label: 'Pedir senha' },
  ];

  const bulkActionOptions = [
    { key: 'hide', label: 'Todos Nao mostrar' },
    { key: 'block', label: 'Todos Bloquear' },
    { key: 'password', label: 'Todos Pedir senha' },
  ];

  const updateActionCardState = (input) => {
    if (!input) return;
    const card = input.nextElementSibling;
    if (!card) return;
    const isActive = !!input.checked;
    const isDisabled = !!input.disabled;
    card.classList.toggle('border-primary', isActive);
    card.classList.toggle('text-primary', isActive);
    card.classList.toggle('bg-primary/10', isActive);
    card.classList.toggle('opacity-50', isDisabled);
  };

  const normalizeText = (value) =>
    String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();

  const escapeRegex = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const buildWildcardRegex = (pattern) => {
    const normalized = normalizeText(pattern);
    if (!normalized) return null;
    const source = escapeRegex(normalized).replace(/\\\*/g, '.*');
    try {
      return new RegExp(source);
    } catch {
      return null;
    }
  };

  const matchesFilter = (label, filterValue) => {
    const normalizedLabel = normalizeText(label);
    const normalizedFilter = normalizeText(filterValue);
    if (!normalizedFilter) return true;
    if (normalizedFilter.includes('*')) {
      const regex = buildWildcardRegex(normalizedFilter);
      return regex ? regex.test(normalizedLabel) : normalizedLabel.includes(normalizedFilter.replace(/\*/g, ''));
    }
    return normalizedLabel.includes(normalizedFilter);
  };

  const setActionForScreen = (screenKey, actionKey, checked) => {
    if (!screenKey || !actionKey) return;
    const config = state.screenConfig || {};
    const entry = config[screenKey] || {};
    entry[actionKey] = !!checked;

    const hasAny =
      entry.hide === true || entry.block === true || entry.password === true;

    if (hasAny) {
      config[screenKey] = entry;
    } else {
      delete config[screenKey];
    }

    state.screenConfig = config;
  };

  const updateBulkActionState = () => {
    if (!bulkActions) return;
    bulkActionOptions.forEach((action) => {
      const bulkInput = bulkActions.querySelector(`input[data-bulk-action="${action.key}"]`);
      if (!bulkInput) return;
      const rowInputs = Array.from(
        tableBody?.querySelectorAll(`input[type="checkbox"][data-action="${action.key}"][data-screen-key]`) || []
      );
      if (!rowInputs.length) {
        bulkInput.checked = false;
        bulkInput.indeterminate = false;
        bulkInput.disabled = true;
        updateActionCardState(bulkInput);
        return;
      }
      bulkInput.disabled = false;
      const checkedCount = rowInputs.filter((input) => input.checked).length;
      bulkInput.checked = checkedCount > 0 && checkedCount === rowInputs.length;
      bulkInput.indeterminate = checkedCount > 0 && checkedCount < rowInputs.length;
      updateActionCardState(bulkInput);
    });
  };

  const renderBulkActionControls = () => {
    if (!bulkActions) return;
    bulkActions.innerHTML = '';

    bulkActionOptions.forEach((action, index) => {
      const id = `security-bulk-${action.key}-${index}`;
      const label = document.createElement('label');
      label.className = 'relative';
      label.setAttribute('for', id);

      const input = document.createElement('input');
      input.type = 'checkbox';
      input.id = id;
      input.className = 'peer sr-only';
      input.dataset.bulkAction = action.key;

      const card = document.createElement('span');
      card.className =
        'inline-flex items-center justify-center rounded-lg border border-gray-200 px-2 py-1 text-[10px] font-semibold text-gray-600 transition ' +
        'hover:border-primary hover:text-primary';
      card.textContent = action.label;

      label.appendChild(input);
      label.appendChild(card);
      bulkActions.appendChild(label);
    });

    updateBulkActionState();
  };

  const fetchScreenConfig = async (companyId) => {
    if (!companyId) return {};
    const token = getToken();
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const resp = await fetch(
      `${SECURITY_ENDPOINT}?storeId=${encodeURIComponent(companyId)}`,
      { headers }
    );
    if (!resp.ok) {
      throw new Error(`Falha ao carregar permissoes (${resp.status})`);
    }
    const data = await resp.json().catch(() => ({}));
    return data?.rules && typeof data.rules === 'object' ? data.rules : {};
  };

  const persistScreenConfig = async (companyId, config) => {
    if (!companyId) return null;
    const resp = await fetch(SECURITY_ENDPOINT, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify({ storeId: companyId, rules: config || {} }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      throw new Error(data?.message || `Falha ao salvar permissoes (${resp.status})`);
    }
    return data;
  };

  const loadScreenConfig = async (companyId) => {
    const targetId = companyId || '';
    state.currentCompanyId = targetId;
    state.requestId += 1;
    const requestId = state.requestId;

    if (state.saveTimer) {
      clearTimeout(state.saveTimer);
      state.saveTimer = null;
    }

    if (!targetId) {
      state.screenConfig = {};
      applyScreenConfig({});
      return;
    }

    setFeedback('Carregando permissoes...', 'info');
    try {
      const rules = await fetchScreenConfig(targetId);
      if (requestId !== state.requestId) return;
      state.screenConfig = rules || {};
      applyScreenConfig(state.screenConfig);
      setFeedback('Permissoes carregadas.', 'info');
      notifyRulesUpdated();
    } catch (error) {
      console.error('seguranca:loadScreenConfig', error);
      if (requestId !== state.requestId) return;
      state.screenConfig = {};
      applyScreenConfig({});
      setFeedback('Nao foi possivel carregar as permissoes.', 'error');
    }
  };

  const scheduleSave = () => {
    if (state.saveTimer) clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(async () => {
      const companyId = select.value || state.currentCompanyId || '';
      if (!companyId || companyId !== state.currentCompanyId) return;
      setFeedback('Salvando permissoes...', 'info');
      try {
        const response = await persistScreenConfig(companyId, state.screenConfig);
        if (response?.rules && typeof response.rules === 'object') {
          state.screenConfig = response.rules;
          applyScreenConfig(state.screenConfig);
        }
        setFeedback('Permissoes salvas.', 'info');
        showToastMessage('Configuracao salva.', 'success');
        notifyRulesUpdated();
      } catch (error) {
        console.error('seguranca:saveScreenConfig', error);
        setFeedback(error?.message || 'Nao foi possivel salvar as permissoes.', 'error');
      }
    }, 400);
  };

  const buildOptions = (stores) => {
    if (!Array.isArray(stores) || !stores.length) {
      select.innerHTML = '<option value="">Nenhuma empresa vinculada</option>';
      select.disabled = true;
      setStoredCompanyId('');
      setFeedback('Nenhuma empresa vinculada ao seu usuario.', 'warning');
      state.currentCompanyId = '';
      state.screenConfig = {};
      applyScreenConfig({});
      return;
    }

    const options = ['<option value="">Selecione a empresa</option>'];
    stores.forEach((store) => {
      const name = store?.nome || store?.razaoSocial || store?.nomeFantasia || 'Empresa sem nome';
      options.push(`<option value="${store._id}">${name}</option>`);
    });
    select.innerHTML = options.join('');
    select.disabled = false;
    const storedId = getStoredCompanyId();
    const canReuse = storedId && stores.some((store) => store?._id === storedId);
    const selectedId = canReuse ? storedId : (stores[0]?._id || '');
    select.value = selectedId;
    setStoredCompanyId(selectedId);
    loadScreenConfig(selectedId);
    setFeedback('Empresas exibidas conforme permissao do usuario.', 'info');
  };

  const loadCompanies = async () => {
    select.disabled = true;
    select.innerHTML = '<option value="">Carregando...</option>';
    setFeedback('Carregando empresas...', 'info');

    try {
      const token = getToken();
      const resp = await fetch(`${API_BASE}/stores/allowed`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!resp.ok) {
        throw new Error(`Falha ao carregar empresas (${resp.status})`);
      }

      const data = await resp.json().catch(() => ({}));
      const stores = Array.isArray(data?.stores) ? data.stores : Array.isArray(data) ? data : [];
      buildOptions(stores);
    } catch (error) {
      console.error('seguranca:loadCompanies', error);
      select.innerHTML = '<option value="">Erro ao carregar empresas</option>';
      select.disabled = true;
      setFeedback('Nao foi possivel carregar as empresas vinculadas.', 'error');
    }
  };

  select.addEventListener('change', () => {
    setStoredCompanyId(select.value || '');
    loadScreenConfig(select.value || '');
  });

  const normalizeHref = (href) => {
    if (!href) return '';
    try {
      return new URL(href, window.location.origin).pathname;
    } catch {
      return href;
    }
  };

  const getScreenKey = (href, label) => {
    const normalized = href && href !== '#' ? normalizeHref(href) : '';
    return normalized || `label:${label || ''}`;
  };

  const collectScreens = () => {
    if (!sidebarPlaceholder) return { ready: false, screens: [] };
    const panelEl = sidebarPlaceholder.querySelector('[data-admin-sidebar-panel]');
    if (!panelEl) return { ready: false, screens: [] };

    const links = Array.from(panelEl.querySelectorAll('nav a[href]'));
    const unique = new Map();

    links.forEach((link) => {
      const label = link.textContent.replace(/\s+/g, ' ').trim();
      if (!label) return;

      const href = link.getAttribute('href') || '';
      const screenKey = getScreenKey(href, label);

      if (!unique.has(screenKey)) {
        unique.set(screenKey, { label, href, screenKey });
      }
    });

    return { ready: true, screens: Array.from(unique.values()) };
  };

  const applyScreenConfig = (config) => {
    if (!tableBody) return;
    const entries = config || {};
    const inputs = tableBody.querySelectorAll('input[type="checkbox"][data-screen-key]');
    inputs.forEach((input) => {
      const key = input.dataset.screenKey;
      const action = input.dataset.action;
      input.checked = !!(entries[key] && entries[key][action]);
      updateActionCardState(input);
    });
    updateBulkActionState();
  };

  const updateScreenSortButtonsState = () => {
    const isAsc = state.screenSortDirection !== 'desc';
    const setActive = (button, active) => {
      if (!button) return;
      button.classList.toggle('text-primary', active);
      button.classList.toggle('border-primary/40', active);
      button.classList.toggle('bg-primary/10', active);
      button.classList.toggle('text-gray-400', !active);
    };
    setActive(sortAscButton, isAsc);
    setActive(sortDescButton, !isAsc);
  };

  const getFilteredAndSortedScreens = (screens) => {
    const list = Array.isArray(screens) ? screens.slice() : [];
    const filtered = list.filter((screen) => matchesFilter(screen?.label || '', state.screenFilter));
    filtered.sort((a, b) => {
      const compare = String(a?.label || '').localeCompare(String(b?.label || ''), 'pt-BR', { sensitivity: 'base' });
      return state.screenSortDirection === 'desc' ? compare * -1 : compare;
    });
    return filtered;
  };

  const renderScreensTable = () => {
    if (!tableBody) return false;

    const { ready, screens } = collectScreens();
    if (!ready) return false;

    tableBody.innerHTML = '';
    const processedScreens = getFilteredAndSortedScreens(screens);
    if (!processedScreens.length) {
      if (tableEmpty) {
        tableEmpty.textContent = state.screenFilter
          ? 'Nenhuma tela encontrada para o filtro informado.'
          : 'Nenhuma tela encontrada no menu administrativo.';
      }
      tableEmpty?.classList.remove('hidden');
      updateBulkActionState();
      updateScreenSortButtonsState();
      return true;
    }

    tableEmpty?.classList.add('hidden');

    processedScreens.forEach((screen, index) => {
      const tr = document.createElement('tr');

      const screenTd = document.createElement('td');
      screenTd.className = 'px-4 py-3';
      const title = document.createElement('div');
      title.className = 'font-semibold text-gray-800';
      title.textContent = screen.label;

      screenTd.appendChild(title);

      tr.appendChild(screenTd);

      const actionsTd = document.createElement('td');
      actionsTd.className = 'px-4 py-3 align-top text-right';
      const actionsWrap = document.createElement('div');
      actionsWrap.className = 'flex flex-wrap items-start justify-end gap-2';

      rowActions.forEach((action) => {
        const id = `security-${action.key}-${index}`;
        const label = document.createElement('label');
        label.className = 'relative';
        label.setAttribute('for', id);

        const input = document.createElement('input');
        input.type = 'checkbox';
        input.id = id;
        input.className = 'peer sr-only';
        input.dataset.action = action.key;
        input.dataset.screenHref = screen.href || '';
        input.dataset.screenLabel = screen.label;
        input.dataset.screenKey = screen.screenKey || '';

        const card = document.createElement('span');
        card.className =
          'inline-flex items-center justify-center rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-600 transition ' +
          'hover:border-primary hover:text-primary';
        card.textContent = action.label;

        label.appendChild(input);
        label.appendChild(card);
        actionsWrap.appendChild(label);
      });

      actionsTd.appendChild(actionsWrap);
      tr.appendChild(actionsTd);
      tableBody.appendChild(tr);
    });

    applyScreenConfig(state.screenConfig);
    updateBulkActionState();
    updateScreenSortButtonsState();
    return true;
  };

  const initScreensTable = () => {
    if (!tableBody) return;
    if (renderScreensTable()) return;

    if (!sidebarPlaceholder) return;
    const observer = new MutationObserver(() => {
      if (renderScreensTable()) observer.disconnect();
    });
    observer.observe(sidebarPlaceholder, { childList: true, subtree: true });
  };

  document.addEventListener('components:ready', () => {
    renderScreensTable();
  });

  tableBody?.addEventListener('change', (event) => {
    const input = event.target;
    if (!input || input.tagName !== 'INPUT') return;
    const screenKey = input.dataset.screenKey;
    const actionKey = input.dataset.action;
    if (!screenKey || !actionKey) return;

    updateActionCardState(input);
    setActionForScreen(screenKey, actionKey, !!input.checked);
    updateBulkActionState();
    scheduleSave();
  });

  bulkActions?.addEventListener('change', (event) => {
    const input = event.target;
    if (!input || input.tagName !== 'INPUT') return;
    const actionKey = input.dataset.bulkAction;
    if (!actionKey) return;

    const checked = !!input.checked;
    const rowInputs = Array.from(
      tableBody?.querySelectorAll(`input[type="checkbox"][data-action="${actionKey}"][data-screen-key]`) || []
    );
    rowInputs.forEach((rowInput) => {
      rowInput.checked = checked;
      updateActionCardState(rowInput);
      setActionForScreen(rowInput.dataset.screenKey, actionKey, checked);
    });

    updateBulkActionState();
    scheduleSave();
  });

  screenFilterInput?.addEventListener('input', () => {
    state.screenFilter = screenFilterInput.value || '';
    renderScreensTable();
  });

  sortAscButton?.addEventListener('click', () => {
    state.screenSortDirection = 'asc';
    renderScreensTable();
  });

  sortDescButton?.addEventListener('click', () => {
    state.screenSortDirection = 'desc';
    renderScreensTable();
  });

  loadCompanies();
  renderBulkActionControls();
  updateScreenSortButtonsState();
  initScreensTable();
});
