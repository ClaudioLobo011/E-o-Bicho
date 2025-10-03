import { registerRoute, render, navigate } from './router.js';
import { ensureAdminAccess } from '../scripts/admin/admin-auth.js';

const ROUTE_MAP = {
  '/pages/admin.html': () => import('./views/dashboard.js'),
  '/pages/admin/produtos': () => import('./views/produtos.js'),
};

Object.entries(ROUTE_MAP).forEach(([path, loader]) => registerRoute(path, loader));

async function bootstrap() {
  try {
    await ensureAdminAccess();
    if (typeof loadComponents === 'function') {
      await loadComponents();
    }

    const currentPath = window.location.pathname;
    await render(currentPath);
  } catch (error) {
    console.error('Erro ao inicializar painel administrativo', error);
  }
}

bootstrap();

window.AdminSPA = { navigate };
