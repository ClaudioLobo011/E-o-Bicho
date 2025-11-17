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
  petInfo: null,
  petSummaryEl: null,
  petSummaryNameEl: null,
  petSummaryMetaEl: null,
  petSummaryTutorEl: null,
  petSummaryContactEl: null,
  submitBtn: null,
  errorEl: null,
  onSuccess: null,
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

function normalizePetInfo(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const allowedKeys = [
    'petId',
    'petNome',
    'petEspecie',
    'petRaca',
    'petPeso',
    'petIdade',
    'tutorId',
    'tutorNome',
    'tutorDocumento',
    'tutorContato',
  ];
  const result = {};
  allowedKeys.forEach((key) => {
    if (!(key in raw)) return;
    const value = raw[key];
    if (value === null || value === undefined) return;
    const str = typeof value === 'string' ? value.trim() : String(value).trim();
    if (!str) return;
    result[key] = str;
  });
  return Object.keys(result).length ? result : null;
}

function mergePetInfo(base, incoming) {
  const normalizedBase = normalizePetInfo(base) || {};
  const normalizedIncoming = normalizePetInfo(incoming);
  if (!normalizedIncoming) {
    return Object.keys(normalizedBase).length ? normalizedBase : null;
  }
  const result = { ...normalizedBase };
  Object.entries(normalizedIncoming).forEach(([key, value]) => {
    if (!result[key]) {
      result[key] = value;
    }
  });
  return result;
}

function getPetInfoFromDataset(dataset, petId) {
  const id = String(petId || '').trim();
  if (!id || !dataset?.pacientes?.length) return null;
  const match = dataset.pacientes.find((pet) => pet.id === id);
  if (!match) return null;
  return normalizePetInfo({
    petId: match.id,
    petNome: match.nome,
    petEspecie: match.especie,
    petRaca: match.raca,
    petPeso: match.peso,
    petIdade: match.idade,
    tutorNome: match.tutor?.nome,
    tutorDocumento: match.tutor?.documento,
    tutorContato: match.tutor?.telefone || match.tutor?.email,
  });
}

function getPetInfoFromInternacoes(state, key) {
  const lookupKey = String(key || '').trim();
  if (!lookupKey || !Array.isArray(state?.internacoes)) return null;
  const match = state.internacoes.find((registro) => registro.filterKey === lookupKey);
  if (!match) return null;
  return normalizePetInfo({
    petId: match.pet?.id,
    petNome: match.pet?.nome,
    petEspecie: match.pet?.especie,
    petRaca: match.pet?.raca,
    petPeso: match.pet?.peso,
    petIdade: match.pet?.idade,
    tutorNome: match.tutor?.nome,
    tutorContato: match.tutor?.contato,
    tutorDocumento: match.tutor?.documento,
  });
}

function getPetInfoFromParams(params) {
  if (!(params instanceof URLSearchParams)) return null;
  const payload = {};
  ['petId', 'petNome', 'petEspecie', 'petRaca', 'petPeso', 'petIdade', 'tutorNome', 'tutorContato', 'tutorDocumento'].forEach((key) => {
    const value = params.get(key);
    if (value) payload[key] = value;
  });
  return normalizePetInfo(payload);
}

function consumeInternacaoPreselectPayload() {
  try {
    const raw = sessionStorage.getItem('internacaoPreselect');
    if (!raw) return null;
    sessionStorage.removeItem('internacaoPreselect');
    const parsed = JSON.parse(raw);
    return normalizePetInfo(parsed);
  } catch (error) {
    console.warn('internacao: falha ao consumir preselect da sessão', error);
    return null;
  }
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

function combineDateAndTime(dateStr, timeStr) {
  const datePart = typeof dateStr === 'string' ? dateStr.trim() : '';
  if (!datePart) return '';
  const timePart = typeof timeStr === 'string' && timeStr.trim() ? timeStr.trim() : '00:00';
  const isoCandidate = `${datePart}T${timePart.length === 5 ? timePart : `${timePart}:00`}`;
  const parsed = new Date(isoCandidate);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString();
}

function normalizeInternacaoRecord(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const codigoNumber = Number.parseInt(raw.codigo, 10);
  const codigo = Number.isFinite(codigoNumber) ? codigoNumber : null;
  const petId = typeof raw.petId === 'string' && raw.petId.trim() ? raw.petId.trim() : '';
  const baseId = String(raw.id || raw._id || codigo || petId || '').trim();
  const filterKey = petId || (codigo !== null ? `codigo-${codigo}` : baseId || `registro-${Date.now()}`);
  const toText = (value) => {
    if (value === undefined || value === null) return '';
    return String(value).trim();
  };

  return {
    id: baseId || filterKey,
    filterKey,
    codigo,
    pet: {
      id: petId || filterKey,
      nome: toText(raw.petNome),
      especie: toText(raw.petEspecie),
      raca: toText(raw.petRaca),
      idade: toText(raw.petIdade),
      peso: toText(raw.petPeso),
    },
    tutor: {
      nome: toText(raw.tutorNome),
      contato: toText(raw.tutorContato),
      documento: toText(raw.tutorDocumento),
    },
    situacao: toText(raw.situacao),
    situacaoCodigo: toText(raw.situacaoCodigo),
    risco: toText(raw.risco),
    riscoCodigo: toText(raw.riscoCodigo),
    veterinario: toText(raw.veterinario),
    box: toText(raw.box),
    altaPrevistaData: toText(raw.altaPrevistaData),
    altaPrevistaHora: toText(raw.altaPrevistaHora),
    altaPrevistaISO: combineDateAndTime(raw.altaPrevistaData, raw.altaPrevistaHora),
    admissao: raw.admissao || raw.createdAt || '',
    createdAt: raw.createdAt || '',
    updatedAt: raw.updatedAt || '',
  };
}

function setInternarModalError(message) {
  if (!internarModal.errorEl) return;
  const text = String(message || '').trim();
  internarModal.errorEl.textContent = text;
  internarModal.errorEl.classList.toggle('hidden', !text);
}

function setInternarModalLoading(isLoading) {
  if (!internarModal.submitBtn) return;
  if (!internarModal.submitBtn.dataset.defaultLabel) {
    internarModal.submitBtn.dataset.defaultLabel = internarModal.submitBtn.textContent.trim();
  }
  internarModal.submitBtn.disabled = !!isLoading;
  internarModal.submitBtn.classList.toggle('opacity-60', !!isLoading);
  internarModal.submitBtn.textContent = isLoading
    ? 'Salvando...'
    : internarModal.submitBtn.dataset.defaultLabel;
}

function getOptionDetails(options, value) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  const match = options.find((opt) => opt.value === normalized);
  return {
    value: normalized,
    label: match?.label || '',
  };
}

async function handleInternarModalSubmit(event) {
  event.preventDefault();
  if (!internarModal.form) return;
  setInternarModalError('');
  const petInfo = internarModal.petInfo || {};
  const petNome = petInfo?.petNome || '';
  if (!petNome) {
    setInternarModalError('Selecione um paciente a partir da ficha clínica antes de salvar.');
    return;
  }

  const formData = new FormData(internarModal.form);
  const situacaoDetails = getOptionDetails(INTERNAR_SITUACAO_OPTIONS, formData.get('internarSituacao'));
  const riscoDetails = getOptionDetails(INTERNAR_RISCO_OPTIONS, formData.get('internarRisco'));
  const payload = {
    petId: petInfo.petId || '',
    petNome,
    petEspecie: petInfo.petEspecie || '',
    petRaca: petInfo.petRaca || '',
    petPeso: petInfo.petPeso || '',
    petIdade: petInfo.petIdade || '',
    tutorNome: petInfo.tutorNome || '',
    tutorContato: petInfo.tutorContato || '',
    tutorDocumento: petInfo.tutorDocumento || '',
    situacao: situacaoDetails.label || situacaoDetails.value,
    situacaoCodigo: situacaoDetails.value,
    risco: riscoDetails.label || riscoDetails.value,
    riscoCodigo: riscoDetails.value,
    veterinario: (formData.get('internarVeterinario') || '').toString().trim(),
    box: (formData.get('internarBox') || '').toString().trim(),
    altaPrevistaData: (formData.get('internarAltaPrevista') || '').toString().trim(),
    altaPrevistaHora: (formData.get('internarAltaPrevistaHora') || '').toString().trim(),
    queixa: (formData.get('internarQueixa') || '').toString().trim(),
    diagnostico: (formData.get('internarDiagnostico') || '').toString().trim(),
    prognostico: (formData.get('internarPrognostico') || '').toString().trim(),
    alergias: [...internarModal.tags],
    acessorios: (formData.get('internarAcessorios') || '').toString().trim(),
    observacoes: (formData.get('internarObservacoes') || '').toString().trim(),
  };

  setInternarModalLoading(true);
  try {
    await requestJson('/internacao/registros', { method: 'POST', body: payload });
    showToastMessage('Internação registrada com sucesso.', 'success');
    const successCallback = internarModal.onSuccess;
    closeInternarPetModal();
    if (typeof successCallback === 'function') {
      successCallback();
    }
  } catch (error) {
    console.error('internacao: falha ao salvar internação', error);
    setInternarModalError(error.message || 'Não foi possível salvar a internação.');
  } finally {
    setInternarModalLoading(false);
  }
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

function setInternarPetInfo(info) {
  const normalized = normalizePetInfo(info);
  internarModal.petInfo = normalized;
  if (!internarModal.petSummaryEl) return;
  const hasInfo = !!normalized;
  internarModal.petSummaryEl.classList.toggle('hidden', !hasInfo);
  if (!hasInfo) {
    if (internarModal.petSummaryNameEl) internarModal.petSummaryNameEl.textContent = '';
    if (internarModal.petSummaryMetaEl) internarModal.petSummaryMetaEl.textContent = '';
    if (internarModal.petSummaryTutorEl) internarModal.petSummaryTutorEl.textContent = '';
    if (internarModal.petSummaryContactEl) {
      internarModal.petSummaryContactEl.textContent = '';
      internarModal.petSummaryContactEl.classList.add('hidden');
    }
    return;
  }

  const { petNome, petEspecie, petRaca, petPeso, petIdade, tutorNome, tutorContato, tutorDocumento } = normalized;
  if (internarModal.petSummaryNameEl) {
    internarModal.petSummaryNameEl.textContent = petNome || 'Pet não identificado';
  }
  if (internarModal.petSummaryMetaEl) {
    const details = [petEspecie, petRaca, petPeso || petIdade].filter(Boolean);
    internarModal.petSummaryMetaEl.textContent = details.length ? details.join(' · ') : '—';
  }
  if (internarModal.petSummaryTutorEl) {
    internarModal.petSummaryTutorEl.textContent = tutorNome ? `Tutor: ${tutorNome}` : 'Tutor não informado';
  }
  if (internarModal.petSummaryContactEl) {
    const contact = [tutorContato, tutorDocumento].filter(Boolean).join(' · ');
    internarModal.petSummaryContactEl.textContent = contact;
    internarModal.petSummaryContactEl.classList.toggle('hidden', !contact);
  }
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
  setInternarPetInfo(null);
  setInternarModalError('');
  setInternarModalLoading(false);
  internarModal.onSuccess = null;
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
            <div class="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-[11px] text-gray-600 hidden" data-pet-summary>
              <div class="flex flex-wrap items-center gap-2 text-gray-700">
                <span class="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Paciente</span>
                <span class="text-sm font-semibold text-gray-900" data-pet-summary-name>—</span>
                <span class="text-[10px] text-gray-400" data-pet-summary-meta>—</span>
              </div>
              <div class="mt-1 flex flex-wrap items-center gap-2 text-gray-600">
                <span class="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Tutor</span>
                <span class="font-semibold text-gray-900" data-pet-summary-tutor>—</span>
                <span class="text-gray-400" data-pet-summary-contact></span>
              </div>
            </div>
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
            <div class="mt-4 grid gap-3 md:grid-cols-[2fr,1fr]">
              <label class="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Alta prevista (data)
                <input type="date" name="internarAltaPrevista" class="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] font-medium text-gray-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20" />
              </label>
              <label class="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Horário previsto
                <input type="time" name="internarAltaPrevistaHora" class="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] font-medium text-gray-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20" />
              </label>
            </div>

            <div class="mt-5 space-y-3">
              <nav class="flex flex-wrap gap-2 border-b border-gray-100 pb-2" aria-label="Abas do modal">
                <button type="button" class="rounded-full border border-transparent px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-600 transition" data-tab-target="medica">Informações médicas</button>
                <button type="button" class="rounded-full border border-transparent px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-600 transition" data-tab-target="observacoes">Acessórios e observações</button>
              </nav>
              <div class="space-y-4" data-tab-panel="medica">
                <div class="grid gap-4 md:grid-cols-3">
                  <label class="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Queixa
                    <textarea name="internarQueixa" rows="3" class="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] text-gray-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20" placeholder="Descreva a queixa principal"></textarea>
                  </label>
                  <label class="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Diagnóstico
                    <textarea name="internarDiagnostico" rows="3" class="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] text-gray-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20" placeholder="Informe o diagnóstico clínico"></textarea>
                  </label>
                  <label class="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Prognóstico
                    <textarea name="internarPrognostico" rows="3" class="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] text-gray-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20" placeholder="Indique o prognóstico esperado"></textarea>
                  </label>
                </div>
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
            <div class="flex flex-col gap-1 text-[11px] text-gray-500">
              <span class="inline-flex items-center gap-2">
                <i class="fas fa-circle-info text-primary"></i>
                <span>Os dados são registrados no banco de dados.</span>
              </span>
              <p class="hidden text-[11px] font-semibold text-red-600" data-modal-error></p>
            </div>
            <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
              <button type="button" class="inline-flex items-center justify-center rounded-lg border border-gray-300 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-gray-700 transition hover:bg-gray-50" data-close-modal>Cancelar</button>
              <button type="submit" class="inline-flex items-center justify-center rounded-lg bg-primary px-5 py-2 text-[11px] font-semibold uppercase tracking-wide text-white shadow-sm transition hover:bg-primary/90" data-modal-submit>Salvar</button>
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
  internarModal.submitBtn = overlay.querySelector('[data-modal-submit]');
  internarModal.errorEl = overlay.querySelector('[data-modal-error]');
  internarModal.tabButtons = Array.from(overlay.querySelectorAll('[data-tab-target]'));
  internarModal.tabPanels = Array.from(overlay.querySelectorAll('[data-tab-panel]'));
  internarModal.tagsInput = overlay.querySelector('[data-tags-input]');
  internarModal.tagsList = overlay.querySelector('[data-tags-list]');
  internarModal.petSummaryEl = overlay.querySelector('[data-pet-summary]');
  internarModal.petSummaryNameEl = overlay.querySelector('[data-pet-summary-name]');
  internarModal.petSummaryMetaEl = overlay.querySelector('[data-pet-summary-meta]');
  internarModal.petSummaryTutorEl = overlay.querySelector('[data-pet-summary-tutor]');
  internarModal.petSummaryContactEl = overlay.querySelector('[data-pet-summary-contact]');

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
    internarModal.form.addEventListener('submit', handleInternarModalSubmit);
  }

  setInternarModalTab('medica');
  renderTagList();
  setInternarPetInfo(null);

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

function openInternarPetModal(dataset, options = {}) {
  const petInfo = options?.petInfo || null;
  ensureInternarPetModal();
  internarModal.onSuccess = typeof options.onSuccess === 'function' ? options.onSuccess : null;
  setInternarModalError('');
  setInternarModalLoading(false);
  populateDynamicSelects(dataset);
  setInternarModalTab('medica');
  setInternarPetInfo(petInfo);
  internarModal.overlay.classList.remove('hidden');
  internarModal.overlay.dataset.modalOpen = 'true';
  if (internarModal.dialog) {
    requestAnimationFrame(() => {
      internarModal.dialog.classList.remove('opacity-0', 'scale-95');
      internarModal.dialog.focus();
    });
  }
}

function registerInternarModalTriggers(dataset, state = {}) {
  document.querySelectorAll('[data-open-internar-modal]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      const triggerPetId = button.dataset.petId || '';
      const resolvedId = triggerPetId || state.petId || '';
      let petInfo = null;
      if (resolvedId) {
        petInfo = getPetInfoFromDataset(dataset, resolvedId) || getPetInfoFromInternacoes(state, resolvedId);
      }
      openInternarPetModal(dataset, {
        petInfo,
        onSuccess: state.refreshInternacoes,
      });
    });
  });
}

function maybeOpenInternarModalFromQuery(dataset, state = {}) {
  try {
    const params = new URLSearchParams(window.location.search);
    const flag = params.get('internar');
    if (!flag) {
      consumeInternacaoPreselectPayload();
      return;
    }

    let petInfo = consumeInternacaoPreselectPayload();
    const fromParams = getPetInfoFromParams(params);
    petInfo = mergePetInfo(petInfo, fromParams);

    const paramPetId = params.get('petId') || params.get('pet');
    if (paramPetId) {
      petInfo = mergePetInfo(petInfo, { petId: paramPetId });
    }

    if (petInfo?.petId) {
      petInfo = mergePetInfo(petInfo, getPetInfoFromDataset(dataset, petInfo.petId));
      petInfo = mergePetInfo(petInfo, getPetInfoFromInternacoes(state, petInfo.petId));
    }

    openInternarPetModal(dataset, {
      petInfo,
      onSuccess: state.refreshInternacoes,
    });

    ['internar', 'pet', 'petId', 'petNome', 'petEspecie', 'petRaca', 'petPeso', 'petIdade', 'tutorNome', 'tutorContato', 'tutorDocumento'].forEach((key) => {
      params.delete(key);
    });
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

function fillPetFilters(dataset, currentPetId, state = {}) {
  const baseOptions = [];
  if (Array.isArray(state?.internacoes) && state.internacoes.length) {
    const seen = new Set();
    state.internacoes.forEach((registro) => {
      const value = registro.filterKey;
      if (!value || seen.has(value)) return;
      seen.add(value);
      const petNome = registro.pet?.nome || (registro.codigo ? `Registro #${registro.codigo}` : 'Paciente');
      const tutorNome = registro.tutor?.nome;
      const label = tutorNome ? `${petNome} · ${tutorNome}` : petNome;
      baseOptions.push({ value, label });
    });
  } else {
    (dataset.pacientes || []).forEach((pet) => {
      baseOptions.push({ value: pet.id, label: `${pet.nome} · ${pet.tutor.nome}` });
    });
  }

  const options = [
    '<option value="">Todos os pets da agenda</option>',
    ...baseOptions.map(
      (opt) => `<option value="${escapeHtml(opt.value)}" ${opt.value === currentPetId ? 'selected' : ''}>${escapeHtml(opt.label)}</option>`,
    ),
  ];
  document.querySelectorAll('[data-internacao-pet-filter]').forEach((select) => {
    select.innerHTML = options.join('');
    select.value = currentPetId || '';
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

function setupAnimaisPage(dataset, state, render) {
  const root = document.querySelector('[data-internacao-root]');

  const fetchInternacoes = async () => {
    state.internacoesLoading = true;
    state.internacoesError = '';
    render();
    try {
      const data = await requestJson('/internacao/registros');
      const normalized = Array.isArray(data) ? data.map(normalizeInternacaoRecord).filter(Boolean) : [];
      dataset.internacoes = normalized;
      state.internacoes = normalized;
      state.internacoesLoading = false;
      const availableKeys = new Set(normalized.map((item) => item.filterKey));
      if (state.petId && availableKeys.size && !availableKeys.has(state.petId)) {
        state.petId = '';
      }
      fillPetFilters(dataset, state.petId, state);
      render();
    } catch (error) {
      console.error('internacao: falha ao carregar internações', error);
      state.internacoesError = error.message || 'Não foi possível carregar as internações.';
      state.internacoesLoading = false;
      render();
    }
  };

  state.refreshInternacoes = fetchInternacoes;

  if (root) {
    root.addEventListener('click', (event) => {
      if (event.target.closest('[data-internacoes-retry]')) {
        event.preventDefault();
        fetchInternacoes();
      }
    });
  }

  fetchInternacoes();
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
    internacoes: Array.isArray(dataset.internacoes) ? [...dataset.internacoes] : [],
    internacoesLoading: false,
    internacoesError: '',
    refreshInternacoes: null,
  };

  try {
    const searchParams = new URLSearchParams(window.location.search);
    const initialPetFilter = searchParams.get('pet') || searchParams.get('petId');
    if (initialPetFilter) {
      state.petId = initialPetFilter;
    }
  } catch (error) {
    console.warn('internacao: falha ao aplicar filtro inicial', error);
  }

  const render = () => {
    const renderer = VIEW_RENDERERS[view];
    if (!renderer) return;
    renderer(root, dataset, state);
  };

  fillPetFilters(dataset, state.petId, state);
  updateSyncInfo(dataset);
  render();

  if (view === 'animais') {
    setupAnimaisPage(dataset, state, render);
  }
  if (view === 'boxes') {
    setupBoxesPage(dataset, state, render);
  }

  document.querySelectorAll('[data-internacao-pet-filter]').forEach((select) => {
    select.addEventListener('change', (event) => {
      state.petId = event.target.value;
      fillPetFilters(dataset, state.petId, state);
      render();
    });
  });

  registerInternarModalTriggers(dataset, state);
  maybeOpenInternarModalFromQuery(dataset, state);
});
