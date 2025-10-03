import { createLegacyView } from './legacy-loader.js';

export default async function View() {
  return createLegacyView({ slug: 'admin-produtos', htmlPath: '/pages/admin/admin-produtos.html', scripts: [
    {
      src: '/scripts/admin/admin-produtos.js'
    }
  ] });
}
