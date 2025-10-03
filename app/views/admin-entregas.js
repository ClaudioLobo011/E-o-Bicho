import { createLegacyView } from './legacy-loader.js';

export default async function View() {
  return createLegacyView({ slug: 'admin-entregas', htmlPath: '/pages/admin/admin-entregas.html', scripts: [
    {
      src: '/scripts/admin/admin-entregas.js'
    }
  ] });
}
