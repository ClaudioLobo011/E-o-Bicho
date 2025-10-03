import { createLegacyView } from './legacy-loader.js';

export default async function View() {
  return createLegacyView({ slug: 'admin-servicos', htmlPath: '/pages/admin/admin-servicos.html', scripts: [
    {
      src: '/scripts/admin/cadastro-de-servicos/precos.js',
      defer: true
    },
    {
      src: '/scripts/admin/cadastro-de-servicos/index.js',
      type: 'module'
    }
  ] });
}
