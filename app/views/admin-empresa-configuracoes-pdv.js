import { createLegacyView } from './legacy-loader.js';

export default async function View() {
  return createLegacyView({ slug: 'admin-empresa-configuracoes-pdv', htmlPath: '/pages/admin/admin-empresa-configuracoes-pdv.html', scripts: [
    {
      src: '/scripts/admin/admin-configuracoes-pdv.js'
    }
  ] });
}
