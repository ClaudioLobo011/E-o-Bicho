import { createLegacyView } from './legacy-loader.js';

export default async function View() {
  return createLegacyView({ slug: 'admin-cadastro-pdv', htmlPath: '/pages/admin/admin-cadastro-pdv.html', scripts: [
    {
      src: '/scripts/admin/admin-cadastro-pdv.js'
    }
  ] });
}
