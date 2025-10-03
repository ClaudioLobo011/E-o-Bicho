import { createLegacyView } from './legacy-loader.js';

export default async function View() {
  return createLegacyView({ slug: 'admin-importar', htmlPath: '/pages/admin/admin-importar.html', scripts: [
    {
      src: '/scripts/admin/admin-importar.js'
    }
  ] });
}
