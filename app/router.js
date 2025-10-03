const routes = new Map();

function normalizePath(path) {
  if (!path) return '/';
  const url = new URL(path, window.location.origin);
  let normalized = url.pathname;
  if (!normalized.startsWith('/')) {
    normalized = `/${normalized}`;
  }
  if (normalized !== '/' && normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }
  return normalized || '/';
}

function registerRoute(path, loader) {
  const normalized = normalizePath(path);
  routes.set(normalized, loader);
}

async function render(pathname) {
  const app = document.getElementById('app');
  if (!app) return;

  const normalized = normalizePath(pathname);
  const loader = routes.get(normalized);

  if (!loader) {
    app.innerHTML = '<div class="w-full p-4"><h1 class="text-xl font-semibold">Tela não encontrada</h1></div>';
    return;
  }

  try {
    app.setAttribute('aria-busy', 'true');
    const module = await loader();
    const View = module.default;
    const element = await View({ path: normalized });
    app.innerHTML = '';
    app.appendChild(element);

    if (typeof window.loadComponents === 'function') {
      try {
        await window.loadComponents();
      } catch (componentError) {
        console.error('Erro ao carregar componentes dinâmicos', componentError);
      }
    }

    if (typeof element.__legacyInit === 'function') {
      await element.__legacyInit();
    }

    const searchRoot = document.querySelector('[data-admin-screen-search]');
    if (searchRoot) {
      searchRoot.dispatchEvent(new CustomEvent('admin:sidebar:updated', { bubbles: true }));
    }

    document.querySelectorAll('a[data-spa]').forEach((link) => {
      const href = link.getAttribute('href');
      const linkPath = href ? normalizePath(href) : null;
      const isActive = linkPath === normalized;
      link.classList.toggle('bg-primary/10', isActive);
      link.classList.toggle('text-primary', isActive);
      link.setAttribute('aria-current', isActive ? 'page' : 'false');
    });
  } catch (error) {
    console.error('Erro ao renderizar rota', normalized, error);
    app.innerHTML = '<div class="w-full p-4 text-red-600">Erro ao carregar a tela.</div>';
  } finally {
    app.removeAttribute('aria-busy');
  }
}

function navigate(path, { replace = false } = {}) {
  const url = new URL(path, window.location.origin);
  const normalized = normalizePath(url.pathname);

  if (!replace) {
    history.pushState({ path: normalized }, '', normalized);
  }

  return render(normalized);
}

function handleLink(event) {
  const anchor = event.target.closest('a[data-spa]');
  if (!anchor) return;

  const href = anchor.getAttribute('href');
  if (!href || href.startsWith('http')) {
    return;
  }

  event.preventDefault();
  navigate(href);
}

document.addEventListener('click', handleLink);
window.addEventListener('popstate', (event) => {
  const path = event.state?.path || window.location.pathname;
  render(path);
});

export { routes, registerRoute, navigate, render };
