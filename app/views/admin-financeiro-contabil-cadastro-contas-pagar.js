import { createLegacyView } from './legacy-loader.js';

export default async function View() {
  return createLegacyView({ slug: 'admin-financeiro-contabil-cadastro-contas-pagar', htmlPath: '/pages/admin/admin-financeiro-contabil-cadastro-contas-pagar.html', scripts: [] });
}
