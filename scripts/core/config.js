const API_CONFIG = (() => {
  const FALLBACK_SERVER = 'http://localhost:3000';
  const FALLBACK_BASE = `${FALLBACK_SERVER}/api`;

  const sanitizeUrl = (value) => {
    if (typeof value !== 'string') return '';
    return value.trim().replace(/\/+$/, '');
  };

  const ensureApiPath = (value) => {
    const sanitized = sanitizeUrl(value);
    if (!sanitized) return '';
    return sanitized.endsWith('/api') ? sanitized : `${sanitized}/api`;
  };

  const getBrowserOrigin = () => {
    if (typeof window === 'undefined' || !window.location) return '';
    const { protocol, hostname, port } = window.location;
    if (!protocol || protocol === 'file:' || !hostname) return '';
    const portSuffix = port ? `:${port}` : '';
    return `${protocol}//${hostname}${portSuffix}`;
  };

  const currentOrigin = sanitizeUrl(getBrowserOrigin());
  const currentHostname = (() => {
    if (!currentOrigin) return '';
    try {
      return new URL(currentOrigin).hostname;
    } catch (error) {
      return '';
    }
  })();
  const isLocalHost = /^(localhost|127\.0\.0\.1)$/i.test(currentHostname || '');

  const existing =
    typeof window !== 'undefined' && window.API_CONFIG && typeof window.API_CONFIG === 'object'
      ? window.API_CONFIG
      : {};

  let serverUrl = sanitizeUrl(existing.SERVER_URL);
  let baseUrl = sanitizeUrl(existing.BASE_URL);

  if (!serverUrl) {
    serverUrl = currentOrigin && !isLocalHost ? currentOrigin : FALLBACK_SERVER;
  } else if (serverUrl.includes('localhost:3000') && currentOrigin && !isLocalHost) {
    serverUrl = currentOrigin;
  }

  if (!baseUrl) {
    baseUrl = ensureApiPath(serverUrl);
  } else if (baseUrl.includes('localhost:3000') && currentOrigin && !isLocalHost) {
    baseUrl = ensureApiPath(currentOrigin);
  } else if (!/\/api(\/|$)/.test(baseUrl)) {
    baseUrl = ensureApiPath(baseUrl);
  }

  return {
    SERVER_URL: sanitizeUrl(serverUrl) || FALLBACK_SERVER,
    BASE_URL: ensureApiPath(baseUrl) || FALLBACK_BASE,
    ADMIN_EMAIL: existing.ADMIN_EMAIL || 'claudio.lobo@lobosti.com.br',
  };
})();

if (typeof window !== 'undefined') {
  window.API_CONFIG = API_CONFIG;
} else if (typeof globalThis !== 'undefined') {
  globalThis.API_CONFIG = API_CONFIG;
}

