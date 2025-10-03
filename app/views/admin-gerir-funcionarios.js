import { createLegacyView } from './legacy-loader.js';

export default async function View() {
  return createLegacyView({ slug: 'admin-gerir-funcionarios', htmlPath: '/pages/admin/admin-gerir-funcionarios.html', scripts: [
    {
      src: '/scripts/admin/admin-funcionarios.js'
    }
  ] });
}
