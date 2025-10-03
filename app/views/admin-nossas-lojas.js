import { createLegacyView } from './legacy-loader.js';

export default async function View() {
  return createLegacyView({ slug: 'admin-nossas-lojas', htmlPath: '/pages/admin/admin-nossas-lojas.html', scripts: [
    {
      src: '/scripts/admin/admin-nossas-lojas.js'
    }
  ] });
}
