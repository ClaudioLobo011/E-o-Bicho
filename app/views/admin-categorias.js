import { createLegacyView } from './legacy-loader.js';

export default async function View() {
  return createLegacyView({ slug: 'admin-categorias', htmlPath: '/pages/admin/admin-categorias.html', scripts: [
    {
      src: '/scripts/admin/admin-categorias.js'
    }
  ] });
}
