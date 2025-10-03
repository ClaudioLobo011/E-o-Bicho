import { createLegacyView } from './legacy-loader.js';

export default async function View() {
  return createLegacyView({ slug: 'admin-produto-editar', htmlPath: '/pages/admin/admin-produto-editar.html', scripts: [
    {
      src: '/scripts/admin/admin-produto-form.js'
    }
  ] });
}
