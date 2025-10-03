import { createLegacyView } from './legacy-loader.js';

export default async function View() {
  return createLegacyView({ slug: 'admin-financeiro-contabil-cadastro-conta-contabil', htmlPath: '/pages/admin/admin-financeiro-contabil-cadastro-conta-contabil.html', scripts: [
    {
      src: '/scripts/admin/admin-financeiro-contabil-cadastro-conta-contabil.js'
    }
  ] });
}
