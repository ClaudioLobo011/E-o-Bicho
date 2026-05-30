const API_CONFIG = (() => {
  const DEFAULT_RENDER_SERVER_URL = 'https://e-o-bicho.onrender.com';
  const LOCAL_SERVER_URL = 'http://localhost:3000';
  const STATIC_DEV_PORTS = new Set(['5500', '5501']);

  const normalizeUrl = (url) => {
    if (typeof url !== 'string') return '';
    return url.trim().replace(/\/+$/, '').replace(/\/api$/i, '');
  };

  const parseUrl = (url) => {
    try {
      return new URL(url);
    } catch (_err) {
      return null;
    }
  };

  const isLocalHost = (hostname) => ['localhost', '127.0.0.1', '::1'].includes(hostname);

  const isStaticDevServer = (url) => {
    const parsed = parseUrl(url);
    return Boolean(parsed && isLocalHost(parsed.hostname) && STATIC_DEV_PORTS.has(parsed.port));
  };

  const clearBrokenLocalOverride = (value) => {
    if (!value || typeof window === 'undefined' || !isStaticDevServer(value)) return;
    try {
      localStorage.removeItem('apiServerOverride');
    } catch (_err) {
      // Ignora ambientes onde o storage nao esta disponivel.
    }
  };

  const getLocalOverride = () => {
    try {
      const value = localStorage.getItem('apiServerOverride');
      return typeof value === 'string' ? value.trim() : '';
    } catch (_err) {
      return '';
    }
  };

  const getGlobalOverride = () => {
    if (typeof window === 'undefined') return '';
    const candidates = [
      window.API_SERVER_URL,
      window.API_BASE_URL,
      window?.API_CONFIG?.SERVER_URL,
      window?.API_CONFIG?.BASE_URL?.replace(/\/?api$/, ''),
    ];
    const found = candidates.find((value) => typeof value === 'string' && value.trim());
    return found ? found.trim() : '';
  };

  const resolveServerUrl = () => {
    if (typeof window === 'undefined') {
      return DEFAULT_RENDER_SERVER_URL;
    }

    const localOverride = normalizeUrl(getLocalOverride());
    const safeLocalOverride = isStaticDevServer(localOverride) ? '' : localOverride;
    if (localOverride && !safeLocalOverride) {
      clearBrokenLocalOverride(localOverride);
    }

    const manualOverride = safeLocalOverride || normalizeUrl(getGlobalOverride());
    if (manualOverride) {
      return manualOverride;
    }

    const hostname = window.location.hostname;
    const isLocalhost = isLocalHost(hostname);

    if (isLocalhost) {
      if (window.location.port === '3000') {
        return window.location.origin;
      }
      return LOCAL_SERVER_URL;
    }

    // Em produção sempre usamos o servidor da Render para evitar requisições
    // indevidas para o localhost (que causam bloqueios de CORS).
    return DEFAULT_RENDER_SERVER_URL;
  };

  const serverUrl = normalizeUrl(resolveServerUrl()) || DEFAULT_RENDER_SERVER_URL;

  return {
    SERVER_URL: serverUrl,
    BASE_URL: `${serverUrl}/api`,
    ADMIN_EMAIL: 'claudio.lobo@lobosti.com.br',
  };
})();

if (typeof globalThis !== 'undefined') {
  globalThis.API_CONFIG = API_CONFIG;
}
