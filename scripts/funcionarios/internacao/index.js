import {
  getDataset,
  renderAnimaisInternados,
  renderMapaExecucao,
  renderHistoricoInternacoes,
  renderParametrosClinicos,
  renderModelosPrescricao,
  renderBoxes,
} from './renderers.js';

const VIEW_RENDERERS = {
  animais: renderAnimaisInternados,
  mapa: renderMapaExecucao,
  historico: renderHistoricoInternacoes,
  parametros: renderParametrosClinicos,
  prescricoes: renderModelosPrescricao,
  boxes: renderBoxes,
};

function fillPetFilters(dataset, currentPetId) {
  const options = ['<option value="">Todos os pets da agenda</option>', ...dataset.pacientes.map((pet) => `<option value="${pet.id}" ${pet.id === currentPetId ? 'selected' : ''}>${pet.nome} · ${pet.tutor.nome}</option>`)];
  document.querySelectorAll('[data-internacao-pet-filter]').forEach((select) => {
    select.innerHTML = options.join('');
  });
}

function updateSyncInfo(dataset) {
  const el = document.querySelector('[data-sync-info]');
  if (!el) return;
  const { texto, fichaAtualizada } = dataset.agendaReferencia;
  el.textContent = `${texto} · ${fichaAtualizada}`;
}

document.addEventListener('DOMContentLoaded', () => {
  const root = document.querySelector('[data-internacao-root]');
  const view = document.body?.dataset?.internacaoPage || '';
  if (!root || !view) return;

  const dataset = getDataset();
  const state = { petId: '' };

  const render = () => {
    const renderer = VIEW_RENDERERS[view];
    if (!renderer) return;
    renderer(root, dataset, state);
  };

  fillPetFilters(dataset, state.petId);
  updateSyncInfo(dataset);
  render();

  document.querySelectorAll('[data-internacao-pet-filter]').forEach((select) => {
    select.addEventListener('change', (event) => {
      state.petId = event.target.value;
      fillPetFilters(dataset, state.petId);
      render();
    });
  });
});
