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

const boxesModal = {
  overlay: null,
  dialog: null,
  form: null,
  errorEl: null,
  submitBtn: null,
  onSuccess: null,
};

let boxesAuthRedirecting = false;

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

function getAuthToken() {
  try {
    const cached = JSON.parse(localStorage.getItem('loggedInUser') || 'null');
    return cached?.token || null;
  } catch (error) {
    console.error('internacao: falha ao ler token do usuário logado', error);
    return null;
  }
}

function showToastMessage(message, type = 'info') {
  const text = String(message || '').trim();
  if (!text) return;
  if (typeof window?.showToast === 'function') {
    window.showToast(text, type);
    return;
  }
  if (typeof window?.alert === 'function') {
    window.alert(text);
  } else {
    console.log(text);
  }
}

function handleUnauthorizedRedirect() {
  if (boxesAuthRedirecting) return;
  boxesAuthRedirecting = true;
  showToastMessage('Sua sessão expirou. Faça login novamente.', 'warning');
  setTimeout(() => {
    window.location.replace('/pages/login.html');
  }, 1200);
}

async function requestJson(path, options = {}) {
  const token = getAuthToken();
  const headers = { Accept: 'application/json', ...(options.headers || {}) };
  let body = options.body;

  if (body && !(body instanceof FormData)) {
    if (typeof body === 'object' && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }
    if (headers['Content-Type']?.includes('application/json') && typeof body === 'object') {
      body = JSON.stringify(body);
    }
  }

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let response;
  try {
    response = await fetch(`${API_CONFIG.BASE_URL}${path}`, {
      ...options,
      headers,
      body,
    });
  } catch (error) {
    console.error('internacao: falha ao acessar a API', error);
    throw new Error('Não foi possível se conectar ao servidor.');
  }

  if (response.status === 401 || response.status === 403) {
    handleUnauthorizedRedirect();
    throw new Error('Sua sessão expirou. Faça login novamente.');
  }

  let data = null;
  try {
    data = await response.json();
  } catch (error) {
    data = null;
  }

  if (!response.ok) {
    const message = data?.message || 'Erro ao comunicar com o servidor.';
    throw new Error(message);
  }

  return data;
}

function normalizeBox(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const boxLabel = typeof raw.box === 'string' && raw.box.trim() ? raw.box.trim() : 'Box';
  const ocupante = typeof raw.ocupante === 'string' && raw.ocupante.trim() ? raw.ocupante.trim() : 'Livre';
  const status = typeof raw.status === 'string' && raw.status.trim()
    ? raw.status.trim()
    : ocupante === 'Livre'
      ? 'Disponível'
      : 'Em uso';
  const especialidade = typeof raw.especialidade === 'string' ? raw.especialidade.trim() : '';
  const higienizacao = typeof raw.higienizacao === 'string' && raw.higienizacao.trim() ? raw.higienizacao.trim() : '—';
  const observacao = typeof raw.observacao === 'string' ? raw.observacao.trim() : '';

  return {
    id: String(raw.id || raw._id || boxLabel).trim() || boxLabel,
    box: boxLabel,
    ocupante,
    status,
    especialidade,
    higienizacao,
    observacao,
  };
}

function setBoxesModalError(message) {
  if (!boxesModal.errorEl) return;
  const text = String(message || '').trim();
  boxesModal.errorEl.textContent = text;
  boxesModal.errorEl.classList.toggle('hidden', !text);
}

function setBoxesModalLoading(isLoading) {
  if (!boxesModal.submitBtn) return;
  if (!boxesModal.submitBtn.dataset.defaultLabel) {
    boxesModal.submitBtn.dataset.defaultLabel = boxesModal.submitBtn.textContent.trim();
  }
  boxesModal.submitBtn.disabled = !!isLoading;
  boxesModal.submitBtn.classList.toggle('opacity-70', !!isLoading);
  boxesModal.submitBtn.textContent = isLoading ? 'Salvando...' : boxesModal.submitBtn.dataset.defaultLabel;
}

function closeCreateBoxModal() {
  if (!boxesModal.overlay) return;
  boxesModal.overlay.classList.add('hidden');
  boxesModal.overlay.removeAttribute('data-modal-open');
  if (boxesModal.form) {
    boxesModal.form.reset();
  }
  setBoxesModalError('');
}

function openCreateBoxModal() {
  ensureCreateBoxModal();
  if (!boxesModal.overlay) return;
  boxesModal.overlay.classList.remove('hidden');
  boxesModal.overlay.dataset.modalOpen = 'true';
  setBoxesModalError('');
  if (boxesModal.dialog) {
    boxesModal.dialog.focus();
  }
  if (boxesModal.form) {
    const firstInput = boxesModal.form.querySelector('input[name="box"]');
    if (firstInput) firstInput.focus();
  }
}

async function handleBoxesModalSubmit(event) {
  event.preventDefault();
  if (!boxesModal.form) return;
  setBoxesModalError('');
  const formData = new FormData(boxesModal.form);
  const payload = {
    box: (formData.get('box') || '').toString().trim(),
    especialidade: (formData.get('especialidade') || '').toString().trim(),
    status: 'Disponível',
    ocupante: 'Livre',
    higienizacao: (formData.get('higienizacao') || '').toString().trim(),
    observacao: (formData.get('observacao') || '').toString().trim(),
  };

  if (!payload.box) {
    setBoxesModalError('Informe o nome do box.');
    return;
  }

  if (!payload.higienizacao) payload.higienizacao = '—';

  setBoxesModalLoading(true);
  try {
    await requestJson('/internacao/boxes', { method: 'POST', body: payload });
    showToastMessage('Box criado com sucesso.', 'success');
    closeCreateBoxModal();
    if (typeof boxesModal.onSuccess === 'function') {
      boxesModal.onSuccess();
    }
  } catch (error) {
    console.error('internacao: falha ao salvar box', error);
    setBoxesModalError(error.message || 'Não foi possível salvar o box.');
  } finally {
    setBoxesModalLoading(false);
  }
}

function ensureCreateBoxModal() {
  if (boxesModal.overlay) return boxesModal.overlay;

  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 z-[9999] hidden flex items-center justify-center bg-black/50 px-4 py-6';
  overlay.innerHTML = `
    <div class="w-full max-w-xl rounded-2xl bg-white shadow-2xl ring-1 ring-black/10" data-boxes-modal-dialog tabindex="-1">
      <header class="flex items-start justify-between gap-4 border-b border-gray-100 px-6 py-4">
        <div>
          <p class="text-xs font-semibold uppercase tracking-wide text-primary">Internação</p>
          <h2 class="text-xl font-bold text-gray-900">Criar novo box</h2>
          <p class="text-sm text-gray-500">Organize os leitos disponíveis antes de iniciar uma internação.</p>
        </div>
        <button type="button" class="text-gray-400 transition hover:text-gray-600" data-close-boxes-modal>
          <i class="fas fa-xmark text-lg"></i>
        </button>
      </header>
      <form class="space-y-4 px-6 py-5" novalidate>
        <div class="grid gap-4 md:grid-cols-2">
          <label class="text-sm font-medium text-gray-700">Nome do box
            <input type="text" name="box" class="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-primary focus:ring-primary" placeholder="Ex.: Box 07" required />
          </label>
          <label class="text-sm font-medium text-gray-700">Especialidade
            <input type="text" name="especialidade" class="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-primary focus:ring-primary" placeholder="Clínico, Cirúrgico..." />
          </label>
        </div>
        <label class="text-sm font-medium text-gray-700">Higienização programada
          <input type="text" name="higienizacao" class="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-primary focus:ring-primary" placeholder="Ex.: 09h30" />
        </label>
        <label class="text-sm font-medium text-gray-700">Observações
          <textarea name="observacao" rows="3" class="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-primary focus:ring-primary" placeholder="Detalhes adicionais para a equipe"></textarea>
        </label>
        <div class="hidden rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700" data-boxes-modal-error></div>
        <div class="flex flex-col gap-3 border-t border-gray-100 pt-4 sm:flex-row sm:items-center sm:justify-end">
          <button type="button" class="rounded-xl border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50" data-close-boxes-modal>Cancelar</button>
          <button type="submit" class="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-primary/90" data-boxes-modal-submit>Salvar</button>
        </div>
      </form>
    </div>
  `;

  document.body.appendChild(overlay);
  boxesModal.overlay = overlay;
  boxesModal.dialog = overlay.querySelector('[data-boxes-modal-dialog]');
  boxesModal.form = overlay.querySelector('form');
  boxesModal.errorEl = overlay.querySelector('[data-boxes-modal-error]');
  boxesModal.submitBtn = overlay.querySelector('[data-boxes-modal-submit]');

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) {
      closeCreateBoxModal();
    }
  });

  overlay.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeCreateBoxModal();
    }
  });

  overlay.querySelectorAll('[data-close-boxes-modal]').forEach((btn) => {
    btn.addEventListener('click', (event) => {
      event.preventDefault();
      closeCreateBoxModal();
    });
  });

  if (boxesModal.form) {
    boxesModal.form.addEventListener('submit', handleBoxesModalSubmit);
  }

  return overlay;
}

function initCreateBoxModal(onSuccess) {
  boxesModal.onSuccess = onSuccess;
  ensureCreateBoxModal();
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
    internarModal.tagsList.innerHTML = '<span class="text-[11px] text-gray-400">Nenhuma marcação adicionada.</span>';
    return;
  }
  internarModal.tagsList.innerHTML = internarModal.tags
    .map(
      (tag) =>
        `<span class="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-[11px] font-semibold text-primary">${escapeHtml(
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
  if (internarModal.dialog) {
    internarModal.dialog.classList.add('opacity-0', 'scale-95');
  }
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
  overlay.className = 'internar-pet-modal fixed inset-0 z-[999] hidden';
  const situacaoOptions = createOptionsMarkup(INTERNAR_SITUACAO_OPTIONS);
  const riscoOptions = createOptionsMarkup(INTERNAR_RISCO_OPTIONS);
  overlay.innerHTML = `
    <div class="absolute inset-0 bg-gray-900/60 backdrop-blur-sm" data-close-modal></div>
    <div class="relative mx-auto flex min-h-full w-full items-start justify-center px-3 py-6 sm:items-center">
      <div class="modal-shell relative flex w-full max-w-4xl transform-gpu flex-col overflow-hidden rounded-2xl bg-white text-[12px] leading-[1.35] shadow-2xl ring-1 ring-black/10 opacity-0 scale-95 transition-all duration-200" role="dialog" aria-modal="true" aria-labelledby="internar-pet-modal-title" data-internar-dialog tabindex="-1">
        <header class="flex flex-col gap-2.5 border-b border-gray-100 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <span class="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
              <i class="fas fa-hospital"></i>
              Internação
            </span>
            <h2 id="internar-pet-modal-title" class="mt-1.5 text-lg font-semibold text-gray-900">Internar pet</h2>
            <p class="mt-1 max-w-2xl text-[11px] text-gray-600">Preencha os dados clínicos e administrativos para encaminhar o paciente para o box escolhido.</p>
          </div>
          <button type="button" class="inline-flex items-center justify-center rounded-full border border-gray-200 p-1.5 text-gray-500 transition hover:bg-gray-50 hover:text-gray-700" data-close-modal aria-label="Fechar modal">
            <i class="fas fa-times text-base"></i>
          </button>
        </header>
        <form class="flex max-h-[80vh] flex-col overflow-hidden" novalidate>
          <div class="flex-1 overflow-y-auto px-4 py-4">
            <div class="grid gap-4 md:grid-cols-2">
              <label class="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Situação
                <select name="internarSituacao" class="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] font-medium text-gray-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20">
                  ${situacaoOptions}
                </select>
              </label>
              <label class="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Risco
                <select name="internarRisco" class="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] font-medium text-gray-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20">
                  <option value="">Selecione</option>
                  ${riscoOptions}
                </select>
              </label>
              <label class="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Veterinário
                <select name="internarVeterinario" class="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] font-medium text-gray-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20">
                  <option value="">Selecione</option>
                </select>
              </label>
              <label class="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Box
                <select name="internarBox" class="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] font-medium text-gray-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20">
                  <option value="">Selecione</option>
                </select>
              </label>
            </div>
            <label class="mt-4 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Alta prevista
              <input type="date" name="internarAltaPrevista" class="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] font-medium text-gray-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20" />
            </label>

            <div class="mt-5 space-y-3">
              <nav class="flex flex-wrap gap-2 border-b border-gray-100 pb-2" aria-label="Abas do modal">
                <button type="button" class="rounded-full border border-transparent px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-600 transition" data-tab-target="medica">Informações médicas</button>
                <button type="button" class="rounded-full border border-transparent px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-600 transition" data-tab-target="observacoes">Acessórios e observações</button>
              </nav>
              <div class="space-y-4" data-tab-panel="medica">
                <label class="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Queixa
                  <textarea name="internarQueixa" rows="3" class="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] text-gray-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20" placeholder="Descreva a queixa principal"></textarea>
                </label>
                <label class="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Diagnóstico
                  <textarea name="internarDiagnostico" rows="3" class="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] text-gray-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20" placeholder="Informe o diagnóstico clínico"></textarea>
                </label>
                <label class="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Prognóstico
                  <textarea name="internarPrognostico" rows="3" class="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] text-gray-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20" placeholder="Indique o prognóstico esperado"></textarea>
                </label>
                <div>
                  <p class="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Alergias e marcações</p>
                  <div class="mt-2 rounded-2xl border border-dashed border-gray-300 bg-gray-50 p-4">
                    <div class="flex flex-wrap gap-2" data-tags-list>
                      <span class="text-[11px] text-gray-400">Nenhuma marcação adicionada.</span>
                    </div>
                    <input type="text" data-tags-input class="mt-3 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] text-gray-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20" placeholder="Digite e pressione Enter" />
                  </div>
                </div>
              </div>
              <div class="space-y-4 hidden" data-tab-panel="observacoes">
                <label class="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Acessórios
                  <textarea name="internarAcessorios" rows="4" class="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] text-gray-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20" placeholder="Coleiras, colares elisabetanos, cateteres, etc."></textarea>
                </label>
                <label class="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Observações
                  <textarea name="internarObservacoes" rows="4" class="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] text-gray-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20" placeholder="Informações administrativas ou recados à enfermagem"></textarea>
                </label>
              </div>
            </div>
          </div>

          <footer class="flex flex-col gap-3 border-t border-gray-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div class="flex items-center gap-2 text-[11px] text-gray-500">
              <i class="fas fa-circle-info text-primary"></i>
              <span>Interface ilustrativa — os dados não são enviados ao servidor.</span>
            </div>
            <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
              <button type="button" class="inline-flex items-center justify-center rounded-lg border border-gray-300 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-gray-700 transition hover:bg-gray-50" data-close-modal>Cancelar</button>
              <button type="submit" class="inline-flex items-center justify-center rounded-lg bg-primary px-5 py-2 text-[11px] font-semibold uppercase tracking-wide text-white shadow-sm transition hover:bg-primary/90">Salvar</button>
            </div>
          </footer>
        </form>
      </div>
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
    requestAnimationFrame(() => {
      internarModal.dialog.classList.remove('opacity-0', 'scale-95');
      internarModal.dialog.focus();
    });
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

function setupBoxesPage(dataset, state, render) {
  const root = document.querySelector('[data-internacao-root]');

  const fetchBoxes = async () => {
    state.boxesLoading = true;
    state.boxesError = '';
    render();
    try {
      const data = await requestJson('/internacao/boxes');
      const normalized = Array.isArray(data) ? data.map(normalizeBox).filter(Boolean) : [];
      dataset.boxes = normalized;
      state.boxes = normalized;
      state.boxesLoading = false;
      render();
    } catch (error) {
      console.error('internacao: falha ao carregar boxes', error);
      state.boxesError = error.message || 'Não foi possível carregar os boxes.';
      state.boxesLoading = false;
      render();
    }
  };

  const createBtn = document.querySelector('[data-boxes-create]');
  if (createBtn) {
    createBtn.addEventListener('click', (event) => {
      event.preventDefault();
      openCreateBoxModal();
    });
  }

  if (root) {
    root.addEventListener('click', (event) => {
      if (event.target.closest('[data-boxes-retry]')) {
        event.preventDefault();
        fetchBoxes();
      }
    });
  }

  initCreateBoxModal(fetchBoxes);
  fetchBoxes();
}

document.addEventListener('DOMContentLoaded', () => {
  const root = document.querySelector('[data-internacao-root]');
  const view = document.body?.dataset?.internacaoPage || '';
  if (!root || !view) return;

  const dataset = getDataset();
  const state = {
    petId: '',
    boxes: Array.isArray(dataset.boxes) ? [...dataset.boxes] : [],
    boxesLoading: false,
    boxesError: '',
  };

  const render = () => {
    const renderer = VIEW_RENDERERS[view];
    if (!renderer) return;
    renderer(root, dataset, state);
  };

  fillPetFilters(dataset, state.petId);
  updateSyncInfo(dataset);
  render();

  if (view === 'boxes') {
    setupBoxesPage(dataset, state, render);
  }

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
