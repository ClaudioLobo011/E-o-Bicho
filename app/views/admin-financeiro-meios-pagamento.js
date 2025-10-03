import { createLegacyView } from './legacy-loader.js';

export default async function View() {
  return createLegacyView({ slug: 'admin-financeiro-meios-pagamento', htmlPath: '/pages/admin/admin-financeiro-meios-pagamento.html', scripts: [
    {
      src: '/scripts/admin/admin-financeiro-meios-pagamento.js'
    }
  ] });
}
