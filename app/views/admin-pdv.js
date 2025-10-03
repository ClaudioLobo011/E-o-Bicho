import { createLegacyView } from './legacy-loader.js';

export default async function View() {
  return createLegacyView({ slug: 'admin-pdv', htmlPath: '/pages/admin/admin-pdv.html', scripts: [
    {
      src: '/scripts/admin/admin-pdv.js'
    }
  ] });
}
