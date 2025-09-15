import api from './api.js';
import { renderLista } from './ui.js';
import { state, getFilteredServicos } from './core.js';
import { ensureKpiBar, renderKpis } from './kpis.js';

export async function listar() {
  const data = await api.list();
  const items = Array.isArray(data) ? data : (data?.items || []);
  state.servicos = items;
  ensureKpiBar();
  renderKpis();
  renderLista(getFilteredServicos());
}
