import { createLegacyView } from './legacy-loader.js';

export default async function View() {
  return createLegacyView({ slug: 'admin-zerar-deposito', htmlPath: '/pages/admin/admin-zerar-deposito.html', scripts: [
    {
      src: '/scripts/admin/admin-zerar-deposito.js'
    }
  ] });
}
