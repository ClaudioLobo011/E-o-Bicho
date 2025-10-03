import { registerRoute, render, navigate } from './router.js';
import { ensureAdminAccess } from '../scripts/admin/admin-auth.js';

import { ROUTES } from './routes.js';

Object.entries(ROUTES).forEach(([path, loader]) => registerRoute(path, loader));

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
