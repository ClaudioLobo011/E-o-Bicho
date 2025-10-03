import { createLegacyView } from './legacy-loader.js';

export default async function View() {
  return createLegacyView({ slug: 'admin-promocoes', htmlPath: '/pages/admin/admin-promocoes.html', scripts: [
    {
      src: '/scripts/admin/admin-promocoes.js'
    }
  ] });
}
