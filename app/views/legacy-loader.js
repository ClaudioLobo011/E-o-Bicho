const htmlCache = new Map();
const scriptPromises = new Map();

const EXCLUDED_IDS = new Set([
  'admin-header-placeholder',
  'admin-footer-placeholder',
  'admin-sidebar-placeholder',
  'modal-placeholder',
  'confirm-modal-placeholder',
]);

function normalizeScriptDescriptor(descriptor) {
  if (typeof descriptor === 'string') {
    return { src: descriptor, type: 'text/javascript', async: false, defer: false };
  }
  const { src, type = 'text/javascript', async = false, defer = false } = descriptor || {};
  return { src, type, async, defer };
}

async function fetchHtml(path) {
  if (!htmlCache.has(path)) {
    const response = await fetch(path, { credentials: 'same-origin' });
    if (!response.ok) {
      throw new Error(`Falha ao carregar HTML legado: ${path}`);
    }
    const text = await response.text();
    htmlCache.set(path, text);
  }
  return htmlCache.get(path);
}

function cloneLegacyContent(html) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const root = document.createElement('div');
  root.className = 'w-full p-4';
  root.dataset.legacyView = 'true';

  const main = doc.querySelector('main');
  if (main) {
    Array.from(main.children).forEach((child) => {
      root.appendChild(child.cloneNode(true));
    });
  }

  doc.querySelectorAll('body > div').forEach((element) => {
    if (EXCLUDED_IDS.has(element.id)) {
      return;
    }
    root.appendChild(element.cloneNode(true));
  });

  cleanLegacyLayout(root);
  enableSpaLinks(root);

  return root;
}

function cleanLegacyLayout(root) {

  const containerClasses = ['container', 'mx-auto', 'px-4', 'px-6', 'pt-1', 'pt-6', 'pt-8', 'pb-6', 'pb-8', 'min-h-screen'];
  root.querySelectorAll('[class]').forEach((el) => {
    if (!(el instanceof HTMLElement)) return;

    containerClasses.forEach((cls) => {
      if (el.classList.contains(cls)) {
        el.classList.remove(cls);
      }
    });

    if (el.closest('[role="dialog"], [id*="modal" i]')) {
      return;
    }

    const cardIndicators = [
      'shadow', 'shadow-sm', 'shadow-md', 'shadow-lg',
      'border', 'border-gray-100', 'border-gray-200',
      'rounded', 'rounded-md', 'rounded-lg', 'rounded-xl', 'rounded-2xl',
    ];
    const hasCardIndicator = cardIndicators.some((cls) => el.classList.contains(cls));
    if (hasCardIndicator) {
      ['bg-white', 'bg-gray-50', 'bg-slate-50', 'shadow', 'shadow-sm', 'shadow-md', 'shadow-lg', 'border', 'border-gray-100', 'border-gray-200', 'rounded', 'rounded-md', 'rounded-lg', 'rounded-xl', 'rounded-2xl']
        .forEach((cls) => el.classList.remove(cls));
    }
  });
}

function enableSpaLinks(root) {
  const base = new URL('/pages/admin/', window.location.origin);
  root.querySelectorAll('a[href]').forEach((anchor) => {
    const href = anchor.getAttribute('href');
    if (!href) return;
    if (anchor.target === '_blank') return;
    if (href.startsWith('#')) return;
    if (/^https?:\/\//i.test(href) || href.startsWith('mailto:') || href.startsWith('tel:')) {
      return;
    }
    try {
      const absolute = new URL(href, base);
      if (absolute.pathname.startsWith('/pages/admin/')) {
        anchor.setAttribute('data-spa', '');
        anchor.setAttribute('href', `${absolute.pathname}${absolute.search}${absolute.hash}`);
      }
    } catch (error) {
      console.warn('Não foi possível normalizar link legado', href, error);
    }
  });
}

async function ensureScriptLoaded(descriptor) {
  const { src, type, async, defer } = normalizeScriptDescriptor(descriptor);
  if (!src) return;

  const key = `${type}:${src}`;
  if (!scriptPromises.has(key)) {
    scriptPromises.set(
      key,
      new Promise((resolve, reject) => {
        const existing = Array.from(document.scripts).find((script) => script.src.endsWith(src));
        if (existing) {
          resolve();
          return;
        }

        const script = document.createElement('script');
        script.src = src;
        if (type === 'module') {
          script.type = 'module';
        }
        if (defer) script.defer = true;
        if (async) script.async = true;
        script.onload = () => resolve();
        script.onerror = (event) => reject(new Error(`Falha ao carregar script legado: ${src}`));
        document.head.appendChild(script);
      }),
    );
  }
  return scriptPromises.get(key);
}

export async function createLegacyView({ slug, htmlPath, scripts = [] }) {
  const html = await fetchHtml(htmlPath);
  const element = cloneLegacyContent(html);

  const scriptDescriptors = Array.isArray(scripts) ? scripts.map(normalizeScriptDescriptor) : [];
  const init = async () => {
    if (scriptDescriptors.length > 0) {
      await Promise.all(scriptDescriptors.map(ensureScriptLoaded));
    }
    const registry = window.__EOBICHO_ADMIN_VIEWS__ || {};
    const initializer = registry[slug];
    if (typeof initializer === 'function') {
      try {
        initializer();
      } catch (error) {
        console.error(`Erro ao inicializar view legacy ${slug}`, error);
      }
    }
  };

  element.__legacyInit = init;
  return element;
}
