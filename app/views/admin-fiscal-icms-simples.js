import { createLegacyView } from './legacy-loader.js';

export default async function View() {
  return createLegacyView({ slug: 'admin-fiscal-icms-simples', htmlPath: '/pages/admin/admin-fiscal-icms-simples.html', scripts: [
    {
      src: '/scripts/admin/admin-fiscal-icms-simples.js'
    }
  ] });
}
