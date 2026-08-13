const API_CONFIG = (() => {
  const DEFAULT_PRODUCTION_SERVER_URL = 'https://api.peteobicho.com.br';
  const LEGACY_RENDER_SERVER_URL = 'https://e-o-bicho.onrender.com';
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
      return DEFAULT_PRODUCTION_SERVER_URL;
    }

    const hostname = window.location.hostname;
    const isLocalhost = isLocalHost(hostname);

    // Fora do ambiente local, o dominio publico e a unica fonte valida. Isso
    // impede que navegadores antigos continuem presos a Render por cache ou
    // por um override salvo antes da migracao.
    if (!isLocalhost) {
      const storedOverride = normalizeUrl(getLocalOverride());
      if (storedOverride === LEGACY_RENDER_SERVER_URL) {
        try {
          localStorage.removeItem('apiServerOverride');
        } catch (_err) {
          // Ignora ambientes onde o storage nao esta disponivel.
        }
      }
      return DEFAULT_PRODUCTION_SERVER_URL;
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

    if (isLocalhost) {
      if (window.location.port === '3000' || window.location.port === '3100') {
        return window.location.origin;
      }
      return LOCAL_SERVER_URL;
    }

    // Em producao, o dominio estavel aponta para o servidor Windows por meio
    // do Cloudflare Tunnel. O hostname permanece igual em futuras trocas de PC.
    return DEFAULT_PRODUCTION_SERVER_URL;
  };

  const serverUrl = normalizeUrl(resolveServerUrl()) || DEFAULT_PRODUCTION_SERVER_URL;

  return {
    SERVER_URL: serverUrl,
    BASE_URL: `${serverUrl}/api`,
    ADMIN_EMAIL: 'claudio.lobo@lobosti.com.br',
  };
})();

if (typeof globalThis !== 'undefined') {
  globalThis.API_CONFIG = API_CONFIG;
}
