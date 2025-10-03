import { createLegacyView } from './legacy-loader.js';

export default async function View() {
  return createLegacyView({ slug: 'admin-fiscal-regras', htmlPath: '/pages/admin/admin-fiscal-regras.html', scripts: [
    {
      src: '/scripts/admin/admin-fiscal-regras.js'
    }
  ] });
}
