// scripts/admin/admin.js
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
    initAdminScreenSecurity();
    consumeAdminToast();
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

function applyMenuRestrictions() {
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

  return true;
}

function bindMenuProtection() {
  const placeholder = document.getElementById('admin-sidebar-placeholder');
  if (!placeholder || placeholder.dataset.securityBound === 'true') return false;

  placeholder.dataset.securityBound = 'true';
  placeholder.addEventListener('click', async (event) => {
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
