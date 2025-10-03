import { createLegacyView } from './legacy-loader.js';

export default async function View() {
  return createLegacyView({ slug: 'admin-destaques', htmlPath: '/pages/admin/admin-destaques.html', scripts: [
    {
      src: '/scripts/admin/admin-destaques.js'
    }
  ] });
}
