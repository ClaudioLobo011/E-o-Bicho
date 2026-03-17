// scripts/admin/admin.js
const ADMIN_MASTER_MODE_KEY = 'eobicho-admin-master-active';
let currentEffectiveRole = '';
let currentOriginalRole = '';

function isStoredAdminMasterModeActive() {
  const value = localStorage.getItem(ADMIN_MASTER_MODE_KEY);
  if (value === null) return true;
  return value === '1';
}

function setStoredAdminMasterMode(active) {
  localStorage.setItem(ADMIN_MASTER_MODE_KEY, active ? '1' : '0');
}

function ensureAdminMasterFetchHeaderPatch() {
  if (window.__adminMasterFetchHeaderPatched) return;
  const originalFetch = window.fetch.bind(window);

  window.fetch = (resource, init = {}) => {
    const url =
      typeof resource === 'string'
        ? resource
        : resource && typeof resource === 'object' && typeof resource.url === 'string'
        ? resource.url
        : '';

    const apiBase = typeof API_CONFIG !== 'undefined' && API_CONFIG?.BASE_URL ? API_CONFIG.BASE_URL : '/api';
    const isApiCall =
      (typeof url === 'string' && url.startsWith('/api/')) ||
      (typeof url === 'string' && apiBase && url.startsWith(apiBase));

    const shouldSendMode =
      currentOriginalRole === 'admin_master' ||
      (JSON.parse(localStorage.getItem('loggedInUser') || 'null')?.role === 'admin_master');

    if (!isApiCall || !shouldSendMode) {
      return originalFetch(resource, init);
    }

    const headers = new Headers(init?.headers || {});
    headers.set('x-admin-master-active', isStoredAdminMasterModeActive() ? '1' : '0');

    return originalFetch(resource, {
      ...init,
      headers,
    });
  };

  window.__adminMasterFetchHeaderPatched = true;
}

function renderAdminMasterToggle() {
  const slot = document.querySelector('[data-admin-master-toggle-slot]');
  if (!slot) return;

  if (currentOriginalRole !== 'admin_master') {
    slot.classList.add('hidden');
    slot.innerHTML = '';
    return;
  }

  if (!localStorage.getItem(ADMIN_MASTER_MODE_KEY)) {
    setStoredAdminMasterMode(true);
  }

  slot.classList.remove('hidden');
  slot.innerHTML = `
    <label class="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-2 py-1 text-xs text-gray-600 select-none">
      <span class="font-semibold">AdminMaster</span>
      <button type="button" data-admin-master-mode-toggle class="relative inline-flex h-5 w-9 items-center rounded-full transition bg-gray-300" aria-pressed="false" aria-label="Alternar modo Admin Master">
        <span data-admin-master-mode-thumb class="inline-block h-4 w-4 transform rounded-full bg-white transition translate-x-0.5"></span>
      </button>
      <span data-admin-master-mode-label class="text-[11px] font-semibold text-primary"></span>
    </label>
  `;

  const toggle = slot.querySelector('[data-admin-master-mode-toggle]');
  const thumb = slot.querySelector('[data-admin-master-mode-thumb]');
  const label = slot.querySelector('[data-admin-master-mode-label]');

  const applyVisualState = () => {
    const active = isStoredAdminMasterModeActive();
    toggle?.setAttribute('aria-pressed', active ? 'true' : 'false');
    if (toggle) {
      toggle.classList.toggle('bg-primary', active);
      toggle.classList.toggle('bg-gray-300', !active);
    }
    if (thumb) {
      thumb.classList.toggle('translate-x-4', active);
      thumb.classList.toggle('translate-x-0.5', !active);
    }
    if (label) {
      label.textContent = active ? 'Ativo' : '';
    }
  };

  applyVisualState();

  toggle?.addEventListener('click', () => {
    const next = !isStoredAdminMasterModeActive();
    setStoredAdminMasterMode(next);
    applyVisualState();
    window.location.reload();
  });
}

ensureAdminMasterFetchHeaderPatch();
async function checkAdminAccess() {
  // Esconde conteúdo até validar
  document.body.style.visibility = 'hidden';

  try {
    const loggedInUser = JSON.parse(localStorage.getItem('loggedInUser') || 'null');
    const token = loggedInUser?.token;

    // Sem login -> login
    if (!loggedInUser || !token) {
      alert('Você precisa estar logado para acessar o painel interno.');
      window.location.replace('/pages/login.html');
      return;
    }

    // Valida token e obtém role
    const resp = await fetch(`${API_CONFIG.BASE_URL}/auth/check`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!resp.ok) {
      // token inválido/expirado
      alert('Sessão expirada. Faça login novamente.');
      window.location.replace('/pages/login.html');
      return;
    }

    const data = await resp.json();
    const role = data?.role;
    currentEffectiveRole = role || '';
    currentOriginalRole = data?.originalRole || role || '';
    window.__ADMIN_ROLE = currentEffectiveRole;
    window.__ADMIN_ORIGINAL_ROLE = currentOriginalRole;

    // Libera funcionarios, franqueado, franqueador, admin e admin_master
    const allowed = ['funcionario', 'franqueado', 'franqueador', 'admin', 'admin_master'].includes(role);
    if (!allowed) {
      alert('Acesso negado. Esta área é restrita a colaboradores autorizados.');
      // se quiser mandar para home em vez do login, troque a URL abaixo
      window.location.replace('/pages/login.html');
      return;
    }

    // Ok, mostra a página
    document.body.style.visibility = 'visible';
    renderAdminMasterToggle();
    initAdminScreenSecurity();
    consumeAdminToast();
    initAdminTableEnhancer();
    window.dispatchEvent(new CustomEvent('admin:auth-checked', {
      detail: { role: currentEffectiveRole, originalRole: currentOriginalRole },
    }));
  } catch (err) {
    console.error('Erro ao verificar permissões:', err);
    alert('Erro ao verificar permissões. Faça login novamente.');
    window.location.replace('/pages/login.html');
  }
}

const SECURITY_COMPANY_KEY = 'eobicho-security-company';
const ADMIN_HOME = '/pages/admin.html';
const ADMIN_TOAST_KEY = 'admin-security-toast';
const SCREEN_SECURITY_ENDPOINT =
  typeof API_CONFIG !== 'undefined' && API_CONFIG?.BASE_URL
    ? `${API_CONFIG.BASE_URL}/admin/screen-security`
    : '/api/admin/screen-security';
const ALLOWED_STORES_ENDPOINT =
  typeof API_CONFIG !== 'undefined' && API_CONFIG?.BASE_URL
    ? `${API_CONFIG.BASE_URL}/stores/allowed`
    : '/api/stores/allowed';
const SCREEN_RULES_TTL_MS = 15000;
const ALLOWED_STORES_TTL_MS = 15000;

let screenRulesCache = {};
let screenRulesFetchedAt = 0;
let screenRulesStoreId = '';
let screenRulesPromise = null;
let allowedStoresCache = [];
let allowedStoresFetchedAt = 0;
let allowedStoresPromise = null;
const ADMIN_TABLE_ENHANCED_ATTR = 'data-admin-table-enhanced';
const ADMIN_TABLE_SCROLL_ATTR = 'data-admin-table-scroll';
let adminTableStylesInjected = false;

function ensureAdminTableStyles() {
  if (adminTableStylesInjected || typeof document === 'undefined') return;
  const style = document.createElement('style');
  style.setAttribute('data-admin-table-styles', 'true');
  style.textContent = `
    [${ADMIN_TABLE_SCROLL_ATTR}="true"] {
      overflow: auto;
      max-height: min(65vh, 720px);
    }

    [${ADMIN_TABLE_SCROLL_ATTR}="true"] thead th {
      position: sticky;
      top: 0;
      z-index: 20;
      background: #f9fafb;
      box-shadow: inset 0 -1px 0 rgba(229, 231, 235, 1);
    }
  `;
  document.head.appendChild(style);
  adminTableStylesInjected = true;
}

function normalizeAdminTableText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function escapeAdminTableRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildAdminTableFilterRegex(rawValue) {
  const normalized = normalizeAdminTableText(rawValue);
  if (!normalized) return null;
  const pattern = normalized
    .split('*')
    .map((segment) => escapeAdminTableRegex(segment))
    .join('.*');
  if (!pattern) return null;
  try {
    return new RegExp(pattern, 'i');
  } catch {
    return null;
  }
}

function shouldEnhanceAdminTable(table) {
  if (!table || table.getAttribute(ADMIN_TABLE_ENHANCED_ATTR) === 'true') return false;
  const thead = table.querySelector('thead');
  const tbody = table.querySelector('tbody');
  if (!thead || !tbody) return false;
  if (
    table.querySelector(
      [
        '[data-main-products-filter]',
        '[data-nfe-item-filter]',
        '[data-nfe-volume-filter]',
        '[data-nfe-ref-filter]',
        '[data-code-lookup-filter]',
        '[data-price-filter]',
        '[data-codigo-search-filter]',
      ].join(','),
    )
  ) {
    return false;
  }
  const headerRow = thead.querySelector('tr');
  if (!headerRow) return false;
  const headers = Array.from(headerRow.children).filter((cell) => /th/i.test(cell.tagName));
  if (headers.length < 2) return false;
  if (headerRow.querySelector('input,select,textarea,[data-sort-direction]')) return false;
  return true;
}

function ensureAdminTableScrollContainer(table) {
  if (!table) return;
  const parent = table.parentElement;
  if (!parent) return;
  parent.setAttribute(ADMIN_TABLE_SCROLL_ATTR, 'true');
}

function enhanceAdminTable(table) {
  if (!shouldEnhanceAdminTable(table)) return;
  ensureAdminTableStyles();
  ensureAdminTableScrollContainer(table);
  const thead = table.querySelector('thead');
  const tbody = table.querySelector('tbody');
  const headerRow = thead.querySelector('tr');
  const headers = Array.from(headerRow.children).filter((cell) => /th/i.test(cell.tagName));
  if (!headers.length) return;

  const state = {
    sort: { key: '', direction: 'asc' },
    filters: {},
    selections: {},
    activeDropdown: null,
    activeKey: '',
  };
  headers.forEach((_, index) => {
    state.filters[index] = '';
    state.selections[index] = new Set();
  });

  const filterInputs = new Map();
  const filterTriggers = new Map();
  const sortButtons = new Map();

  const getDataRows = () =>
    Array.from(tbody.querySelectorAll('tr')).filter((row) => {
      const cells = Array.from(row.children).filter((cell) => /td/i.test(cell.tagName));
      return cells.length >= headers.length;
    });

  const getCell = (row, index) =>
    Array.from(row.children).filter((node) => /td/i.test(node.tagName))[index] || null;

  const isBooleanColumn = (index) =>
    getDataRows().some((row) => {
      const cell = getCell(row, index);
      return Boolean(cell?.querySelector('input[type="checkbox"]'));
    });

  const getCellFilterValue = (row, index) => {
    const cell = getCell(row, index);
    if (!cell) return '';
    const checkbox = cell.querySelector('input[type="checkbox"]');
    if (checkbox) {
      return checkbox.checked ? 'ON' : 'OFF';
    }
    const input = cell.querySelector('input,select,textarea');
    if (input && typeof input.value === 'string') return input.value;
    return cell.textContent || '';
  };

  const getCellText = (row, index) => {
    const cell = getCell(row, index);
    if (!cell) return '';
    const input = cell.querySelector('input,select,textarea');
    if (input && typeof input.value === 'string') return input.value;
    return cell.textContent || '';
  };

  const getUniqueValues = (index) => {
    if (isBooleanColumn(index)) {
      return ['ON', 'OFF'];
    }
    const values = new Set();
    getDataRows().forEach((row) => {
      const value = String(getCellFilterValue(row, index) || '').trim();
      if (value) values.add(value);
    });
    return Array.from(values).sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true, sensitivity: 'base' }));
  };

  const closeDropdown = () => {
    if (state.activeDropdown && state.activeDropdown.parentNode) {
      state.activeDropdown.parentNode.removeChild(state.activeDropdown);
    }
    state.activeDropdown = null;
    state.activeKey = '';
  };

  const updateTriggerState = (index) => {
    const trigger = filterTriggers.get(index);
    if (!trigger) return;
    const hasSelection = state.selections[index] && state.selections[index].size > 0;
    trigger.classList.toggle('text-primary', hasSelection);
  };

  const applyFiltersAndSort = () => {
    const rows = getDataRows();
    const filteredRows = rows.filter((row) =>
      headers.every((_, index) => {
        const filterRegex = buildAdminTableFilterRegex(state.filters[index] || '');
        const cellFilterValue = getCellFilterValue(row, index);
        const cellText = normalizeAdminTableText(cellFilterValue);
        if (filterRegex && !filterRegex.test(cellText)) return false;
        const selected = state.selections[index];
        if (selected && selected.size > 0) {
          const rawCell = String(cellFilterValue || '').trim();
          if (!selected.has(rawCell)) return false;
        }
        return true;
      }),
    );

    let sortedRows = rows.slice();
    if (state.sort.key !== '') {
      const sortIndex = Number(state.sort.key);
      sortedRows.sort((a, b) => {
        const aValue = String(getCellText(a, sortIndex) || '');
        const bValue = String(getCellText(b, sortIndex) || '');
        const cmp = aValue.localeCompare(bValue, 'pt-BR', { numeric: true, sensitivity: 'base' });
        return state.sort.direction === 'desc' ? -cmp : cmp;
      });
    }
    sortedRows.forEach((row) => tbody.appendChild(row));
    const visibleSet = new Set(filteredRows);
    rows.forEach((row) => {
      row.classList.toggle('hidden', !visibleSet.has(row));
    });
  };

  const buildDropdown = (index, anchor) => {
    const values = getUniqueValues(index);
    const currentSelection = state.selections[index] || new Set();
    const hasSelection = currentSelection.size > 0;
    const dropdown = document.createElement('div');
    dropdown.className =
      'fixed z-[100000] w-60 rounded-lg border border-gray-200 bg-white shadow-xl p-2 text-xs text-gray-600';
    dropdown.innerHTML = `
      <div class="flex items-center justify-between px-2 py-1 text-[11px] font-semibold text-gray-500 uppercase">
        <span>Opcoes</span>
        <button type="button" class="text-gray-400 hover:text-primary" data-action="close" aria-label="Fechar">
          <i class="fas fa-times"></i>
        </button>
      </div>
      <div class="max-h-40 overflow-y-auto px-2 py-1 space-y-1" data-options></div>
      <div class="flex items-center justify-between gap-2 px-2 pt-2">
        <button type="button" class="text-[11px] text-gray-500 hover:text-primary" data-action="select-all">Selecionar tudo</button>
        <button type="button" class="text-[11px] text-gray-500 hover:text-primary" data-action="clear">Limpar</button>
        <button type="button" class="ml-auto rounded-md bg-primary px-2 py-1 text-[11px] font-semibold text-white hover:bg-primary/90" data-action="apply">Aplicar</button>
      </div>
    `;
    const optionsContainer = dropdown.querySelector('[data-options]');
    values.forEach((value) => {
      const checked = hasSelection ? currentSelection.has(value) : true;
      const row = document.createElement('label');
      row.className = 'flex items-center gap-2 text-[11px] text-gray-600';
      row.innerHTML = `
        <input type="checkbox" class="rounded border-gray-300 text-primary focus:ring-primary/20" value="${value.replace(/\"/g, '&quot;')}" ${checked ? 'checked' : ''}>
        <span class="truncate">${value}</span>
      `;
      optionsContainer.appendChild(row);
    });
    dropdown.addEventListener('click', (event) => {
      event.stopPropagation();
      const action = event.target.closest('[data-action]')?.getAttribute('data-action');
      if (!action) return;
      if (action === 'close') {
        closeDropdown();
        return;
      }
      if (action === 'select-all') {
        dropdown.querySelectorAll('input[type="checkbox"]').forEach((input) => {
          input.checked = true;
        });
        return;
      }
      if (action === 'clear') {
        dropdown.querySelectorAll('input[type="checkbox"]').forEach((input) => {
          input.checked = false;
        });
        return;
      }
      if (action === 'apply') {
        const checkedValues = Array.from(dropdown.querySelectorAll('input[type="checkbox"]:checked')).map((input) =>
          String(input.value || '').trim(),
        );
        const next = state.selections[index] || new Set();
        next.clear();
        if (!(checkedValues.length && checkedValues.length >= values.length)) {
          checkedValues.forEach((value) => next.add(value));
        }
        state.selections[index] = next;
        updateTriggerState(index);
        closeDropdown();
        applyFiltersAndSort();
      }
    });
    document.body.appendChild(dropdown);
    const rect = anchor.getBoundingClientRect();
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    const dropdownWidth = 240;
    const estimatedHeight = 220;
    const margin = 8;
    let left = rect.left;
    let top = rect.bottom + 4;
    if (left + dropdownWidth > viewportWidth - margin) {
      left = Math.max(margin, viewportWidth - dropdownWidth - margin);
    }
    if (top + estimatedHeight > viewportHeight - margin) {
      top = Math.max(margin, rect.top - estimatedHeight - 4);
    }
    dropdown.style.left = `${Math.max(margin, left)}px`;
    dropdown.style.top = `${Math.max(margin, top)}px`;
    return dropdown;
  };

  headers.forEach((th, index) => {
    const label = String(th.textContent || '').replace(/\s+/g, ' ').trim() || `Coluna ${index + 1}`;
    th.classList.add('px-4', 'py-3', 'text-left', 'align-top');
    th.innerHTML = `
      <div class="relative flex flex-col gap-1">
        <div class="flex items-center justify-between gap-1">
          <span class="text-[11px] font-semibold uppercase tracking-wide text-gray-600 whitespace-nowrap">${label}</span>
          <div class="flex items-center gap-1">
            <button type="button" class="rounded p-0.5 text-gray-400 transition hover:text-primary focus:outline-none focus:ring-1 focus:ring-primary/30" data-admin-table-filter-trigger="${index}" aria-label="Abrir filtro de ${label}">
              <i class="fas fa-search text-[9px]"></i>
            </button>
            <div class="flex flex-col items-center justify-center gap-px text-gray-400">
              <button type="button" class="flex h-3.5 w-3.5 items-center justify-center rounded border border-transparent transition hover:text-primary focus:outline-none focus:ring-1 focus:ring-primary/40" data-admin-table-sort="${index}" data-sort-direction="asc" aria-label="Ordenar crescente pela coluna ${label}">
                <i class="fas fa-sort-up text-[9px]"></i>
              </button>
              <button type="button" class="flex h-3.5 w-3.5 items-center justify-center rounded border border-transparent transition hover:text-primary focus:outline-none focus:ring-1 focus:ring-primary/40" data-admin-table-sort="${index}" data-sort-direction="desc" aria-label="Ordenar decrescente pela coluna ${label}">
                <i class="fas fa-sort-down text-[9px]"></i>
              </button>
            </div>
          </div>
        </div>
        <input type="text" placeholder="Filtrar" class="w-full rounded border border-gray-200 bg-white px-2 py-1 text-[10px] font-medium text-gray-600 placeholder:text-gray-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20" data-admin-table-filter="${index}" />
      </div>
    `;
    const filterInput = th.querySelector(`[data-admin-table-filter="${index}"]`);
    const filterTrigger = th.querySelector(`[data-admin-table-filter-trigger="${index}"]`);
    filterInputs.set(index, filterInput);
    filterTriggers.set(index, filterTrigger);
    if (filterInput) {
      filterInput.addEventListener('input', (event) => {
        state.filters[index] = event.target.value || '';
        applyFiltersAndSort();
      });
    }
    if (filterTrigger) {
      filterTrigger.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const anchor = event.currentTarget.closest('.relative') || event.currentTarget.closest('div');
        if (!anchor) return;
        if (state.activeKey === String(index)) {
          closeDropdown();
          return;
        }
        closeDropdown();
        state.activeKey = String(index);
        state.activeDropdown = buildDropdown(index, anchor);
      });
    }

    th.querySelectorAll(`[data-admin-table-sort="${index}"]`).forEach((button) => {
      sortButtons.set(button, {
        key: String(index),
        direction: button.getAttribute('data-sort-direction') === 'desc' ? 'desc' : 'asc',
      });
      button.addEventListener('click', (event) => {
        event.preventDefault();
        const meta = sortButtons.get(button);
        if (!meta) return;
        if (state.sort.key === meta.key && state.sort.direction === meta.direction) {
          state.sort = { key: '', direction: 'asc' };
        } else {
          state.sort = { key: meta.key, direction: meta.direction };
        }
        sortButtons.forEach((btnMeta, btnEl) => {
          const active = btnMeta.key === state.sort.key && btnMeta.direction === state.sort.direction;
          btnEl.classList.toggle('text-primary', active);
          btnEl.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
        applyFiltersAndSort();
      });
    });
  });

  document.addEventListener('click', (event) => {
    if (!state.activeDropdown) return;
    const inDropdown = state.activeDropdown.contains(event.target);
    const inTrigger = !!event.target.closest('[data-admin-table-filter-trigger]');
    if (!inDropdown && !inTrigger) {
      closeDropdown();
    }
  });

  table.setAttribute(ADMIN_TABLE_ENHANCED_ATTR, 'true');
  applyFiltersAndSort();
}

function initAdminTableEnhancer() {
  const pathname = window.location.pathname || '';
  if (!/\/pages\/admin\//i.test(pathname)) return;
  const run = () => {
    document.querySelectorAll('table').forEach((table) => {
      enhanceAdminTable(table);
    });
  };
  run();
  const root = document.querySelector('main') || document.body;
  if (!root) return;
  const rootObserver = new MutationObserver(() => run());
  rootObserver.observe(root, { childList: true, subtree: true });
}

function getLoggedUser() {
  try {
    return JSON.parse(localStorage.getItem('loggedInUser') || 'null') || {};
  } catch {
    return {};
  }
}

function getUserId() {
  const user = getLoggedUser();
  return user?.id || user?._id || '';
}

function getToken() {
  return getLoggedUser()?.token || '';
}

function getCompanyStorageKey() {
  const userId = getUserId();
  return userId ? `${SECURITY_COMPANY_KEY}:${userId}` : SECURITY_COMPANY_KEY;
}

function getActiveCompanyId() {
  try {
    return localStorage.getItem(getCompanyStorageKey()) || '';
  } catch {
    return '';
  }
}

function setActiveCompanyId(value) {
  try {
    const key = getCompanyStorageKey();
    if (value) {
      localStorage.setItem(key, value);
    } else {
      localStorage.removeItem(key);
    }
  } catch {
    // ignore storage errors
  }
}

function normalizeStoreId(value) {
  if (!value) return '';
  if (typeof value === 'object') {
    return String(value._id || value.id || '').trim();
  }
  return String(value).trim();
}

function extractAllowedStores(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.stores)) return payload.stores;
  if (Array.isArray(payload?.data?.stores)) return payload.data.stores;
  return [];
}

async function fetchAllowedStores({ force = false } = {}) {
  const token = getToken();
  if (!token) return [];

  if (!force && allowedStoresFetchedAt) {
    const age = Date.now() - allowedStoresFetchedAt;
    if (age < ALLOWED_STORES_TTL_MS) return allowedStoresCache;
  }

  if (allowedStoresPromise) return allowedStoresPromise;

  allowedStoresPromise = fetch(ALLOWED_STORES_ENDPOINT, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  })
    .then(async (resp) => {
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        allowedStoresCache = [];
        allowedStoresFetchedAt = 0;
        return allowedStoresCache;
      }
      const stores = extractAllowedStores(data);
      allowedStoresCache = Array.isArray(stores) ? stores : [];
      allowedStoresFetchedAt = Date.now();
      return allowedStoresCache;
    })
    .catch(() => {
      allowedStoresCache = [];
      allowedStoresFetchedAt = 0;
      return allowedStoresCache;
    })
    .finally(() => {
      allowedStoresPromise = null;
    });

  return allowedStoresPromise;
}

function rulesAreStale(activeCompanyId) {
  if (!screenRulesFetchedAt) return true;
  const active = activeCompanyId || getActiveCompanyId();
  if (active && screenRulesStoreId && active !== screenRulesStoreId) return true;
  if (!active && screenRulesStoreId) return true;
  if (active && !screenRulesStoreId) return true;
  return Date.now() - screenRulesFetchedAt > SCREEN_RULES_TTL_MS;
}

async function fetchScreenRules({ force = false, retryOnForbidden = true } = {}) {
  if (isAdminMasterBypassActive()) {
    screenRulesCache = {};
    screenRulesFetchedAt = Date.now();
    screenRulesStoreId = '';
    return screenRulesCache;
  }

  const token = getToken();
  if (!token) {
    screenRulesCache = {};
    screenRulesFetchedAt = 0;
    screenRulesStoreId = '';
    return screenRulesCache;
  }

  const activeCompanyId = getActiveCompanyId();
  if (!force && !rulesAreStale(activeCompanyId) && screenRulesCache) {
    return screenRulesCache;
  }

  if (screenRulesPromise) return screenRulesPromise;

  let allowedCompanyId = activeCompanyId;
  if (allowedCompanyId) {
    const allowedStores = await fetchAllowedStores();
    const allowedSet = new Set(allowedStores.map((store) => normalizeStoreId(store)));
    if (!allowedSet.has(normalizeStoreId(allowedCompanyId))) {
      setActiveCompanyId('');
      allowedCompanyId = '';
    }
  }

  const requestRules = async (companyId) => {
    const url = new URL(SCREEN_SECURITY_ENDPOINT, window.location.origin);
    if (companyId) {
      url.searchParams.set('storeId', companyId);
    }
    const resp = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    const data = await resp.json().catch(() => ({}));
    return { resp, data };
  };

  screenRulesPromise = (async () => {
    let currentCompanyId = allowedCompanyId;
    let result = await requestRules(currentCompanyId);

    if (!result.resp.ok && result.resp.status === 403 && retryOnForbidden && currentCompanyId) {
      setActiveCompanyId('');
      currentCompanyId = '';
      result = await requestRules('');
    }

    if (!result.resp.ok) {
      if (result.resp.status !== 403) {
        const message = result.data?.message || `Falha ao carregar regras (${result.resp.status})`;
        console.error('admin:screen-security', new Error(message));
      }
      screenRulesCache = {};
      screenRulesFetchedAt = 0;
      screenRulesStoreId = '';
      return screenRulesCache;
    }

    const rules = result.data?.rules && typeof result.data.rules === 'object' ? result.data.rules : {};
    const resolvedStoreId = result.data?.storeId || currentCompanyId || '';
    screenRulesCache = rules;
    screenRulesFetchedAt = Date.now();
    screenRulesStoreId = resolvedStoreId;
    if (resolvedStoreId && resolvedStoreId !== currentCompanyId) {
      setActiveCompanyId(resolvedStoreId);
    }
    return screenRulesCache;
  })().finally(() => {
    screenRulesPromise = null;
  });

  return screenRulesPromise;
}


async function ensureScreenRules(options) {
  return fetchScreenRules(options);
}

function normalizeHref(href) {
  if (!href) return '';
  try {
    return new URL(href, window.location.origin).pathname;
  } catch {
    return href;
  }
}

function buildScreenKey(href, label) {
  const normalized = href && href !== '#' ? normalizeHref(href) : '';
  return normalized || `label:${label || ''}`;
}

function isAdminMasterBypassActive() {
  const cachedRole = JSON.parse(localStorage.getItem('loggedInUser') || 'null')?.role || '';
  const originalRole = currentOriginalRole || cachedRole;
  return originalRole === 'admin_master' && isStoredAdminMasterModeActive();
}

function shouldBlockScreen(rule) {
  return !!(rule && (rule.hide || rule.block));
}

function shouldRequirePassword(rule) {
  return !!(rule && rule.password) && !shouldBlockScreen(rule);
}

function storeAdminToast(message, type = 'warning') {
  if (!message) return;
  try {
    sessionStorage.setItem(ADMIN_TOAST_KEY, JSON.stringify({ message, type }));
  } catch {
    // ignore storage errors
  }
}

function consumeAdminToast() {
  try {
    const raw = sessionStorage.getItem(ADMIN_TOAST_KEY);
    if (!raw) return;
    sessionStorage.removeItem(ADMIN_TOAST_KEY);
    let payload = { message: raw, type: 'warning' };
    try {
      payload = JSON.parse(raw);
    } catch {
      // ignore parse errors
    }
    if (!payload?.message) return;
    if (typeof window.showToast === 'function') {
      window.showToast(payload.message, payload.type || 'warning', 3000);
    }
  } catch {
    // ignore storage errors
  }
}

function redirectToAdmin(message) {
  if (message) storeAdminToast(message, 'warning');
  window.location.replace(ADMIN_HOME);
}

async function verifyCredentials(identifier, senha) {
  try {
    const resp = await fetch(`${API_CONFIG.BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, senha }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      return { ok: false, message: data?.message || 'Credenciais invalidas.' };
    }

    const currentId = getUserId();
    const responseId = data?.user?._id || data?.user?.id || '';
    if (currentId && responseId && responseId !== currentId) {
      return { ok: false, message: 'Usuario diferente do logado.' };
    }

    return { ok: true };
  } catch (error) {
    console.error('admin:verifyCredentials', error);
    return { ok: false, message: 'Nao foi possivel validar o usuario.' };
  }
}

async function requestPassword() {
  return new Promise((resolve) => {
    let resolved = false;

    const resolveOnce = (value) => {
      if (resolved) return;
      resolved = true;
      resolve(value);
    };

    if (typeof window.showModal !== 'function') {
      const identifier = window.prompt('Usuario');
      if (!identifier) return resolveOnce(false);
      const senha = window.prompt('Senha');
      if (!senha) return resolveOnce(false);
      verifyCredentials(identifier, senha).then((result) => resolveOnce(result.ok));
      return;
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'space-y-3';

    const error = document.createElement('p');
    error.className = 'hidden text-xs text-red-600';
    error.textContent = 'Preencha usuario e senha.';

    const userLabel = document.createElement('label');
    userLabel.className = 'block text-sm font-semibold text-gray-700';
    userLabel.textContent = 'Usuario';

    const userInput = document.createElement('input');
    userInput.type = 'text';
    userInput.className =
      'mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary focus:ring-2 focus:ring-primary/20';

    const passLabel = document.createElement('label');
    passLabel.className = 'block text-sm font-semibold text-gray-700';
    passLabel.textContent = 'Senha';

    const passInput = document.createElement('input');
    passInput.type = 'password';
    passInput.className =
      'mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary focus:ring-2 focus:ring-primary/20';

    wrapper.appendChild(userLabel);
    wrapper.appendChild(userInput);
    wrapper.appendChild(passLabel);
    wrapper.appendChild(passInput);
    wrapper.appendChild(error);

    const showError = (message) => {
      error.textContent = message;
      error.classList.remove('hidden');
    };

    let modal = null;
    let observer = null;

    const cleanupHandlers = () => {
      document.removeEventListener('keydown', handleEsc);
      observer?.disconnect();
    };

    const resolveAndCleanup = (value) => {
      cleanupHandlers();
      resolveOnce(value);
    };

    const handleEsc = (event) => {
      if (event.key !== 'Escape') return;
      if (!modal || modal.classList.contains('hidden')) return;
      resolveAndCleanup(false);
    };

    window.showModal({
      title: 'Confirmar acesso',
      message: wrapper,
      confirmText: 'Entrar',
      cancelText: 'Cancelar',
      onConfirm: async () => {
        const identifier = userInput.value.trim();
        const senha = passInput.value;
        if (!identifier || !senha) {
          showError('Preencha usuario e senha.');
          return false;
        }

        const result = await verifyCredentials(identifier, senha);
        if (!result.ok) {
          showError(result.message || 'Credenciais invalidas.');
          return false;
        }

        resolveAndCleanup(true);
        return true;
      },
      onCancel: () => resolveAndCleanup(false),
    });

    modal = document.getElementById('confirm-modal');
    document.addEventListener('keydown', handleEsc);

    if (modal) {
      observer = new MutationObserver(() => {
        if (modal.classList.contains('hidden')) {
          resolveAndCleanup(false);
        }
      });
      observer.observe(modal, { attributes: true, attributeFilter: ['class'] });
    }
  });
}

function hasVisibleScreenLinks(root) {
  if (!root) return false;
  const links = root.querySelectorAll('a[href]');
  return Array.from(links).some((link) => !link.classList.contains('hidden'));
}

function refreshSidebarGroupVisibility(panel) {
  if (!panel) return;
  const groups = Array.from(panel.querySelectorAll('div')).filter((group) => {
    const button = group.querySelector(':scope > [data-accordion-button]');
    const content = group.querySelector(':scope > [data-accordion-content]');
    return Boolean(button && content);
  });

  groups
    .sort((a, b) => b.querySelectorAll('div').length - a.querySelectorAll('div').length)
    .forEach((group) => {
      const content = group.querySelector(':scope > [data-accordion-content]');
      if (!content) return;
      const hasVisibleLinks = hasVisibleScreenLinks(content);
      if (hasVisibleLinks) {
        if (group.dataset.securityHidden === '1') {
          group.classList.remove('hidden');
          delete group.dataset.securityHidden;
        }
      } else {
        group.classList.add('hidden');
        group.dataset.securityHidden = '1';
        if (!content.classList.contains('hidden')) {
          content.classList.add('hidden');
        }
      }
    });
}

function applyMenuRestrictions() {
  if (isAdminMasterBypassActive()) {
    const placeholder = document.getElementById('admin-sidebar-placeholder');
    if (!placeholder) return false;

    const panel = placeholder.querySelector('[data-admin-sidebar-panel]');
    if (!panel) return false;

    const links = panel.querySelectorAll('nav a[href]');
    links.forEach((link) => {
      link.classList.remove('hidden');
      link.removeAttribute('aria-hidden');
    });

    panel.querySelectorAll('[data-security-hidden="1"]').forEach((group) => {
      group.classList.remove('hidden');
      delete group.dataset.securityHidden;
    });

    return true;
  }

  const rules = screenRulesCache || {};
  const placeholder = document.getElementById('admin-sidebar-placeholder');
  if (!placeholder) return false;

  const panel = placeholder.querySelector('[data-admin-sidebar-panel]');
  if (!panel) return false;

  const links = panel.querySelectorAll('nav a[href]');
  links.forEach((link) => {
    const href = link.getAttribute('href') || '';
    const label = link.textContent.replace(/\s+/g, ' ').trim();
    const key = buildScreenKey(href, label);
    const rule = rules[key];

    if (rule?.hide) {
      link.classList.add('hidden');
      link.setAttribute('aria-hidden', 'true');
    } else {
      link.classList.remove('hidden');
      link.removeAttribute('aria-hidden');
    }
  });

  refreshSidebarGroupVisibility(panel);

  return true;
}

function bindMenuProtection() {
  const placeholder = document.getElementById('admin-sidebar-placeholder');
  if (!placeholder || placeholder.dataset.securityBound === 'true') return false;

  placeholder.dataset.securityBound = 'true';
  placeholder.addEventListener('click', async (event) => {
    if (isAdminMasterBypassActive()) return;

    const link = event.target.closest('a[href]');
    if (!link) return;
    const href = link.getAttribute('href') || '';
    if (!href || href === '#') return;

    await ensureScreenRules({ force: rulesAreStale() });
    const rules = screenRulesCache || {};
    const label = link.textContent.replace(/\s+/g, ' ').trim();
    const key = buildScreenKey(href, label);
    const rule = rules[key];

    if (!rule) return;

    if (shouldBlockScreen(rule)) {
      event.preventDefault();
      redirectToAdmin('Sem Autorizacao');
      return;
    }

    if (shouldRequirePassword(rule)) {
      event.preventDefault();
      const ok = await requestPassword();
      if (ok) {
        window.location.href = link.href;
      } else {
        redirectToAdmin('Acesso cancelado.');
      }
    }
  });

  return true;
}

async function refreshMenuSecurity({ force = false } = {}) {
  await ensureScreenRules({ force });
  const applied = applyMenuRestrictions();
  const bound = bindMenuProtection();
  return applied && bound;
}

async function enforceCurrentScreen() {
  if (isAdminMasterBypassActive()) return;

  await ensureScreenRules({ force: rulesAreStale() });
  const rules = screenRulesCache || {};
  if (!rules || !Object.keys(rules).length) return;

  const currentKey = window.location.pathname;
  const rule = rules[currentKey];
  if (!rule) return;

  if (shouldBlockScreen(rule)) {
    redirectToAdmin('Sem Autorizacao');
    return;
  }

  if (shouldRequirePassword(rule)) {
    const ok = await requestPassword();
    if (ok) {
    } else {
      redirectToAdmin('Acesso cancelado.');
    }
  }
}

function initAdminScreenSecurity() {
  const attempt = () =>
    refreshMenuSecurity().then((ok) => ok);

  attempt().then((ok) => {
    if (ok) return;
    const placeholder = document.getElementById('admin-sidebar-placeholder');
    if (!placeholder) return;
    const observer = new MutationObserver(() => {
      attempt().then((ready) => {
        if (ready) observer.disconnect();
      });
    });
    observer.observe(placeholder, { childList: true, subtree: true });
  });

  document.addEventListener('components:ready', () => {
    refreshMenuSecurity();
  });

  document.addEventListener('security:rules-updated', () => {
    refreshMenuSecurity({ force: true });
  });

  window.addEventListener('storage', (event) => {
    if (!event.key) return;
    if (event.key.startsWith(SECURITY_COMPANY_KEY)) {
      screenRulesFetchedAt = 0;
      screenRulesStoreId = '';
      refreshMenuSecurity({ force: true });
    }
  });

  enforceCurrentScreen();
}

document.addEventListener('components:ready', () => {
  renderAdminMasterToggle();
});

// Garante que o body não pisca antes da validação
document.body.style.visibility = 'hidden';

// Aguarda config.js estar carregado
if (typeof API_CONFIG !== 'undefined') {
  checkAdminAccess();
} else {
  console.error('API_CONFIG não definido. Garanta que config.js é carregado antes de admin.js');
  // mesmo assim tenta validar após um pequeno delay
  setTimeout(checkAdminAccess, 100);
}

