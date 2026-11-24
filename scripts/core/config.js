const COMPANY_PROFILES = Object.freeze({
  e_o_bicho: Object.freeze({
    name: 'E o Bicho',
    siteUrl: 'https://www.peteobicho.com.br',
    apiUrl: 'https://api.peteobicho.com.br',
    callbackUrl: 'https://callback.peteobicho.com.br',
    cdnUrl: 'https://cdn.peteobicho.com.br',
    facebookDomainVerification: 'aa7dw5o3hdbv9j7uucy54roz2isvue',
    locationLabel: 'Rio de Janeiro · RJ',
    localApiUrl: 'http://localhost:3100',
    apiPort: 3000,
    database: 'test',
    logo: '/public/image/logo.svg',
    socialImage: '/public/image/logo.png',
    instagramUrl: 'https://www.instagram.com/petshopeobichovilaisabel/',
    legalName: 'Vila E o Bicho LTDA - ME',
    taxId: '07.919.703/0001-67',
    adminEmail: 'claudio.lobo@lobosti.com.br',
    pageOverrides: Object.freeze({}),
  }),
  palace_do_pet: Object.freeze({
    name: 'Palace do Pet',
    siteUrl: '',
    apiUrl: '',
    callbackUrl: '',
    cdnUrl: '',
    facebookDomainVerification: '',
    locationLabel: '',
    localApiUrl: 'http://127.0.0.1:3200',
    apiPort: 3200,
    database: 'palace_do_pet',
    logo: '',
    socialImage: '',
    instagramUrl: '',
    legalName: '',
    taxId: '',
    adminEmail: '',
    pageOverrides: Object.freeze({}),
  }),
});

const DEFAULT_COMPANY = 'e_o_bicho';
const PUBLISHED_COMPANY = null;
const getCompany = (id = DEFAULT_COMPANY) => {
  if (!Object.hasOwn(COMPANY_PROFILES, id)) throw new Error('Empresa desconhecida: ' + id);
  return Object.freeze({ id, ...COMPANY_PROFILES[id] });
};

const browserCompany = typeof window === 'undefined' ? null : window.LOBOSTI_COMPANY;
const activeCompany = getCompany(browserCompany?.id || PUBLISHED_COMPANY || DEFAULT_COMPANY);

const API_CONFIG = (() => {
  const DEFAULT_PRODUCTION_SERVER_URL = activeCompany.apiUrl;
  const LEGACY_RENDER_SERVER_URL = 'https://e-o-bicho.onrender.com';
  const LOCAL_SERVER_URL = browserCompany?.localApiUrl || activeCompany.localApiUrl;
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
    if (activeCompany.id !== DEFAULT_COMPANY) {
      const server = isLocalhost ? LOCAL_SERVER_URL : DEFAULT_PRODUCTION_SERVER_URL;
      if (!server) throw new Error('Configure a URL pública da API para ' + activeCompany.name);
      return server;
    }

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
    ADMIN_EMAIL: activeCompany.adminEmail,
    COMPANY: activeCompany,
  };
})();

if (typeof window !== 'undefined') {
  globalThis.API_CONFIG = API_CONFIG;
}

if (typeof module === 'object' && module.exports) {
  module.exports = { DEFAULT_COMPANY, PUBLISHED_COMPANY, getCompany };
}
