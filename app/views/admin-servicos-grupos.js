import { createLegacyView } from './legacy-loader.js';

export default async function View() {
  return createLegacyView({ slug: 'admin-servicos-grupos', htmlPath: '/pages/admin/admin-servicos-grupos.html', scripts: [
    {
      src: '/scripts/admin/admin-servicos-grupos.js'
    }
  ] });
}
