import {
  getDataset,
  renderAnimaisInternados,
  renderMapaExecucao,
  renderHistoricoInternacoes,
  renderParametrosClinicos,
  renderModelosPrescricao,
  renderBoxes,
} from './renderers.js';

const INTERNAR_SITUACAO_OPTIONS = [
  { value: '', label: 'Selecione' },
  { value: 'triagem', label: 'Triagem' },
  { value: 'internado', label: 'Internado' },
];

const INTERNAR_RISCO_OPTIONS = [
  { value: 'nao-urgente', label: 'Não urgente' },
  { value: 'pouco-urgente', label: 'Pouco urgente' },
  { value: 'urgente', label: 'Urgente' },
  { value: 'muito-urgente', label: 'Muito urgente' },
  { value: 'emergencia', label: 'Emergência' },
];

const internarModal = {
  overlay: null,
  dialog: null,
  form: null,
  tabButtons: [],
  tabPanels: [],
  tagsInput: null,
  tagsList: null,
  tags: [],
};

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function createOptionsMarkup(options) {
  return options.map((opt) => `<option value="${escapeHtml(opt.value)}">${escapeHtml(opt.label)}</option>`).join('');
}

function getEquipeOptions(dataset) {
  const set = new Set();
  (dataset?.pacientes || []).forEach((pet) => {
    const nome = pet?.internacao?.equipeMedica;
    if (nome) set.add(nome);
  });
  return Array.from(set).sort().map((nome) => ({ value: nome, label: nome }));
}

function getBoxOptions(dataset) {
  const boxes = Array.isArray(dataset?.boxes) ? dataset.boxes : [];
  return boxes.map((item) => ({ value: item.box, label: `${item.box}${item.ocupante ? ` · ${item.ocupante}` : ''}` }));
}

function renderTagList() {
  if (!internarModal.tagsList) return;
  if (!internarModal.tags.length) {
    internarModal.tagsList.innerHTML = '<span class="text-xs text-gray-400">Nenhuma marcação adicionada.</span>';
    return;
  }
  internarModal.tagsList.innerHTML = internarModal.tags
    .map(
      (tag) =>
        `<span class="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">${escapeHtml(
          tag,
        )}<button type="button" class="text-primary/80 hover:text-primary" data-remove-tag="${escapeHtml(tag)}"><i class="fas fa-xmark text-[10px]"></i></button></span>`,
    )
    .join('');
}

function setInternarModalTab(targetId) {
  const fallback = internarModal.tabButtons[0]?.dataset.tabTarget || '';
  const resolved = internarModal.tabButtons.some((btn) => btn.dataset.tabTarget === targetId) ? targetId : fallback;
  internarModal.tabButtons.forEach((btn) => {
    const active = btn.dataset.tabTarget === resolved;
    btn.classList.toggle('bg-primary/10', active);
    btn.classList.toggle('text-primary', active);
    btn.classList.toggle('text-gray-600', !active);
  });
  internarModal.tabPanels.forEach((panel) => {
    panel.classList.toggle('hidden', panel.dataset.tabPanel !== resolved);
  });
}

function closeInternarPetModal() {
  if (!internarModal.overlay) return;
  internarModal.overlay.classList.add('hidden');
  delete internarModal.overlay.dataset.modalOpen;
  if (internarModal.form) {
    internarModal.form.reset();
  }
  internarModal.tags = [];
  if (internarModal.tagsInput) internarModal.tagsInput.value = '';
  renderTagList();
}

function ensureInternarPetModal() {
  if (internarModal.overlay) return internarModal.overlay;

  const overlay = document.createElement('div');
  overlay.className = 'internar-pet-modal fixed inset-0 z-[999] hidden flex items-center justify-center bg-black/50 px-4 py-6';
  const situacaoOptions = createOptionsMarkup(INTERNAR_SITUACAO_OPTIONS);
  const riscoOptions = createOptionsMarkup(INTERNAR_RISCO_OPTIONS);
  overlay.innerHTML = `
    <div class="modal-shell w-full max-w-4xl rounded-2xl bg-white shadow-2xl ring-1 ring-black/10" role="dialog" aria-modal="true" aria-labelledby="internar-pet-modal-title" data-internar-dialog tabindex="-1">
      <header class="flex flex-col gap-2 border-b border-gray-100 px-6 py-4 sm:flex-row sm:items-start">
        <div>
          <p class="text-xs font-semibold uppercase tracking-wide text-primary">Internação</p>
          <h2 id="internar-pet-modal-title" class="text-xl font-bold text-gray-900">Internar pet</h2>
          <p class="text-sm text-gray-500">Preencha os dados clínicos e administrativos para encaminhar o paciente.</p>
        </div>
        <button type="button" class="ml-auto text-gray-400 transition hover:text-gray-600" data-close-modal aria-label="Fechar modal">
          <i class="fas fa-xmark text-lg"></i>
        </button>
      </header>
      <form class="space-y-6 px-6 pb-6 pt-4" novalidate>
        <div class="grid gap-4 md:grid-cols-2">
          <label class="text-sm font-medium text-gray-700">Situação
            <select name="internarSituacao" class="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-800 focus:border-primary focus:ring-primary">
              ${situacaoOptions}
            </select>
          </label>
          <label class="text-sm font-medium text-gray-700">Risco
            <select name="internarRisco" class="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-800 focus:border-primary focus:ring-primary">
              <option value="">Selecione</option>
              ${riscoOptions}
            </select>
          </label>
          <label class="text-sm font-medium text-gray-700">Veterinário
            <select name="internarVeterinario" class="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-800 focus:border-primary focus:ring-primary">
              <option value="">Selecione</option>
            </select>
          </label>
          <label class="text-sm font-medium text-gray-700">Box
            <select name="internarBox" class="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-800 focus:border-primary focus:ring-primary">
              <option value="">Selecione</option>
            </select>
          </label>
        </div>
        <label class="text-sm font-medium text-gray-700">Alta prevista
          <input type="date" name="internarAltaPrevista" class="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-800 focus:border-primary focus:ring-primary" />
        </label>

        <div class="space-y-3">
          <div class="flex flex-wrap gap-2 text-sm font-semibold text-gray-600">
            <button type="button" class="rounded-xl px-4 py-2 text-primary" data-tab-target="medica">Informações médicas</button>
            <button type="button" class="rounded-xl px-4 py-2 text-gray-600" data-tab-target="observacoes">Acessórios e observações</button>
          </div>
          <div class="space-y-4" data-tab-panel="medica">
            <label class="text-sm font-medium text-gray-700">Queixa
              <textarea name="internarQueixa" rows="3" class="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-800 focus:border-primary focus:ring-primary" placeholder="Descreva a queixa principal"></textarea>
            </label>
            <label class="text-sm font-medium text-gray-700">Diagnóstico
              <textarea name="internarDiagnostico" rows="3" class="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-800 focus:border-primary focus:ring-primary" placeholder="Informe o diagnóstico clínico"></textarea>
            </label>
            <label class="text-sm font-medium text-gray-700">Prognóstico
              <textarea name="internarPrognostico" rows="3" class="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-800 focus:border-primary focus:ring-primary" placeholder="Indique o prognóstico esperado"></textarea>
            </label>
            <div>
              <p class="text-sm font-medium text-gray-700">Alergias e marcações</p>
              <div class="mt-2 rounded-2xl border border-dashed border-gray-300 bg-gray-50 p-4">
                <div class="flex flex-wrap gap-2" data-tags-list>
                  <span class="text-xs text-gray-400">Nenhuma marcação adicionada.</span>
                </div>
                <input type="text" data-tags-input class="mt-3 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-800 focus:border-primary focus:ring-primary" placeholder="Digite e pressione Enter" />
              </div>
            </div>
          </div>
          <div class="space-y-4 hidden" data-tab-panel="observacoes">
            <label class="text-sm font-medium text-gray-700">Acessórios
              <textarea name="internarAcessorios" rows="4" class="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-800 focus:border-primary focus:ring-primary" placeholder="Coleiras, colares elisabetanos, cateteres, etc."></textarea>
            </label>
            <label class="text-sm font-medium text-gray-700">Observações
              <textarea name="internarObservacoes" rows="4" class="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-800 focus:border-primary focus:ring-primary" placeholder="Informações administrativas ou recados à enfermagem"></textarea>
            </label>
          </div>
        </div>

        <div class="flex flex-col gap-3 border-t border-gray-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div class="flex items-center gap-2 text-xs text-gray-500">
            <i class="fas fa-circle-info text-primary"></i>
            <span>Interface ilustrativa — os dados não são enviados ao servidor.</span>
          </div>
          <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
            <button type="button" class="rounded-xl border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50" data-close-modal>Cancelar</button>
            <button type="submit" class="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-primary/90">Salvar</button>
          </div>
        </div>
      </form>
    </div>
  `;

  document.body.appendChild(overlay);

  internarModal.overlay = overlay;
  internarModal.dialog = overlay.querySelector('[data-internar-dialog]');
  internarModal.form = overlay.querySelector('form');
  internarModal.tabButtons = Array.from(overlay.querySelectorAll('[data-tab-target]'));
  internarModal.tabPanels = Array.from(overlay.querySelectorAll('[data-tab-panel]'));
  internarModal.tagsInput = overlay.querySelector('[data-tags-input]');
  internarModal.tagsList = overlay.querySelector('[data-tags-list]');

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) {
      closeInternarPetModal();
    }
  });

  overlay.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeInternarPetModal();
    }
  });

  overlay.querySelectorAll('[data-close-modal]').forEach((btn) => {
    btn.addEventListener('click', (event) => {
      event.preventDefault();
      closeInternarPetModal();
    });
  });

  internarModal.tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      setInternarModalTab(btn.dataset.tabTarget);
    });
  });

  if (internarModal.tagsInput) {
    internarModal.tagsInput.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      const value = event.currentTarget.value.trim();
      if (!value) return;
      if (!internarModal.tags.includes(value)) {
        internarModal.tags.push(value);
        renderTagList();
      }
      event.currentTarget.value = '';
    });
  }

  if (internarModal.tagsList) {
    internarModal.tagsList.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-remove-tag]');
      if (!btn) return;
      const tagValue = btn.dataset.removeTag || '';
      internarModal.tags = internarModal.tags.filter((tag) => tag !== tagValue);
      renderTagList();
    });
  }

  if (internarModal.form) {
    internarModal.form.addEventListener('submit', (event) => {
      event.preventDefault();
      const data = {};
      new FormData(internarModal.form).forEach((value, key) => {
        data[key] = value;
      });
      data.alergias = [...internarModal.tags];
      try {
        if (typeof window?.showToast === 'function') {
          window.showToast('Solicitação de internação registrada (ilustrativo).', 'success');
        } else {
          alert('Solicitação de internação registrada (ilustrativo).');
        }
      } catch (error) {
        console.warn('internacao modal submit', error);
      }
      closeInternarPetModal();
    });
  }

  setInternarModalTab('medica');
  renderTagList();

  return overlay;
}

function populateDynamicSelects(dataset) {
  if (!internarModal.form) return;
  const vetSelect = internarModal.form.querySelector('select[name="internarVeterinario"]');
  const boxSelect = internarModal.form.querySelector('select[name="internarBox"]');
  if (vetSelect) {
    const options = ['<option value="">Selecione</option>', ...getEquipeOptions(dataset).map((opt) => `<option value="${escapeHtml(opt.value)}">${escapeHtml(opt.label)}</option>`)]
      .join('');
    vetSelect.innerHTML = options;
  }
  if (boxSelect) {
    const options = ['<option value="">Selecione</option>', ...getBoxOptions(dataset).map((opt) => `<option value="${escapeHtml(opt.value)}">${escapeHtml(opt.label)}</option>`)]
      .join('');
    boxSelect.innerHTML = options;
  }
}

function openInternarPetModal(dataset) {
  ensureInternarPetModal();
  populateDynamicSelects(dataset);
  setInternarModalTab('medica');
  internarModal.overlay.classList.remove('hidden');
  internarModal.overlay.dataset.modalOpen = 'true';
  if (internarModal.dialog) {
    internarModal.dialog.focus();
  }
}

function registerInternarModalTriggers(dataset) {
  document.querySelectorAll('[data-open-internar-modal]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      openInternarPetModal(dataset);
    });
  });
}

function maybeOpenInternarModalFromQuery(dataset) {
  try {
    const params = new URLSearchParams(window.location.search);
    const flag = params.get('internar');
    if (!flag) return;
    openInternarPetModal(dataset);
    params.delete('internar');
    const query = params.toString();
    const newUrl = query ? `${window.location.pathname}?${query}` : window.location.pathname;
    window.history.replaceState({}, document.title, `${newUrl}${window.location.hash || ''}`);
  } catch (error) {
    console.warn('internacao: falha ao processar parâmetro de internação automática', error);
  }
}

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

  registerInternarModalTriggers(dataset);
  maybeOpenInternarModalFromQuery(dataset);
});
