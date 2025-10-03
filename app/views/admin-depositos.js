import { createLegacyView } from './legacy-loader.js';

export default async function View() {
  return createLegacyView({ slug: 'admin-depositos', htmlPath: '/pages/admin/admin-depositos.html', scripts: [
    {
      src: '/scripts/admin/admin-depositos.js'
    }
  ] });
}
