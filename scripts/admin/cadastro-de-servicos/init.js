import { els } from './core.js';
import { carregarGrupos } from './ui.js';
import { listar } from './list.js';
import { initCategoriesBar } from './categories.js';

export async function init() {
  if (!els.form) return; // safety if HTML not present
  initCategoriesBar();
  try {
    await Promise.all([carregarGrupos(), listar()]);
  } catch (err) {
    console.error(err);
    alert('Erro ao inicializar a página de serviços.\n' + (err?.message || ''));
  }
}

