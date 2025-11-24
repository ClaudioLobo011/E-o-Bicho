const API_CONFIG = (() => {
  const DEFAULT_RENDER_SERVER_URL = 'https://e-o-bicho.onrender.com';
  const LOCAL_SERVER_URL = 'http://localhost:3000';

  const normalizeUrl = (url) => {
    if (typeof url !== 'string') return '';
    return url.trim().replace(/\/+$/, '');
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
    const manual = normalizeUrl(getLocalOverride()) || normalizeUrl(getGlobalOverride());
    if (manual) return manual;

    if (typeof window !== 'undefined') {
      const hostname = window.location.hostname;
      const isLocalhost = ['localhost', '127.0.0.1', '::1'].includes(hostname);
      if (isLocalhost) return LOCAL_SERVER_URL;
    }

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
