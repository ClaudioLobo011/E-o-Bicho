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
  titleEl: null,
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
  dataset: null,
  state: null,
  mode: 'create',
  recordId: null,
  currentRecord: null,
};

const boxesModal = {
  overlay: null,
  dialog: null,
  form: null,
  errorEl: null,
  submitBtn: null,
  onSuccess: null,
};

const fichaInternacaoModal = {
  overlay: null,
  dialog: null,
  record: null,
  dataset: null,
  state: null,
  subtitleEl: null,
  petNameEl: null,
  petMetaEl: null,
  tutorResumoEl: null,
  tutorNomeEl: null,
  tutorContatoEl: null,
  situacaoBadgeEl: null,
  riscoBadgeEl: null,
  tagsContainer: null,
  statusEl: null,
  boxEl: null,
  altaEl: null,
  duracaoEl: null,
  vetEl: null,
  codigoEl: null,
  admissaoEl: null,
  historicoListEl: null,
  tabButtons: [],
  tabPanels: [],
};

const RISCO_BADGE_CLASSES = {
  'nao-urgente': 'bg-emerald-50 text-emerald-700 ring-emerald-100',
  'pouco-urgente': 'bg-lime-50 text-lime-700 ring-lime-100',
  urgente: 'bg-amber-50 text-amber-700 ring-amber-100',
  'muito-urgente': 'bg-orange-50 text-orange-700 ring-orange-100',
  emergencia: 'bg-red-50 text-red-700 ring-red-100',
};

const FICHA_TAB_IDS = ['historico', 'prescricao'];

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

function getRiscoBadgeClass(code) {
  const key = String(code || '').toLowerCase();
  return RISCO_BADGE_CLASSES[key] || 'bg-gray-100 text-gray-700 ring-gray-100';
}

function formatDateTimeLabel(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDurationSince(dateInput) {
  if (!dateInput) return '—';
  const date = new Date(dateInput);
  if (Number.isNaN(date.getTime())) return '—';
  const diffMs = Date.now() - date.getTime();
  if (diffMs <= 0) return 'Menos de 1 hora';
  const totalMinutes = Math.floor(diffMs / 60000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  const parts = [];
  if (days) parts.push(`${days} ${days === 1 ? 'dia' : 'dias'}`);
  if (hours) parts.push(`${hours} ${hours === 1 ? 'hora' : 'horas'}`);
  if (!parts.length) parts.push(`${Math.max(minutes, 1)} min`);
  return parts.slice(0, 2).join(' e ');
}

function normalizeTagList(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter((item, index, arr) => item && arr.indexOf(item) === index);
  }
  const text = typeof value === 'string' ? value.trim() : '';
  return text ? [text] : [];
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

function getPetInfoFromInternacaoRecord(record) {
  if (!record) return null;
  return normalizePetInfo({
    petId: record.pet?.id || record.petId || record.filterKey,
    petNome: record.pet?.nome || record.petNome,
    petEspecie: record.pet?.especie,
    petRaca: record.pet?.raca,
    petPeso: record.pet?.peso,
    petIdade: record.pet?.idade,
    tutorNome: record.tutor?.nome || record.tutorNome,
    tutorContato: record.tutor?.contato || record.tutorContato,
    tutorDocumento: record.tutor?.documento || record.tutorDocumento,
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

function normalizeVeterinario(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const nome = typeof raw.nome === 'string' && raw.nome.trim() ? raw.nome.trim() : '';
  const id = typeof raw._id === 'string' && raw._id.trim()
    ? raw._id.trim()
    : typeof raw.id === 'string' && raw.id.trim()
      ? raw.id.trim()
      : nome;
  if (!id && !nome) return null;
  return {
    id,
    nome: nome || 'Veterinário(a)',
  };
}

function isBoxAvailable(box) {
  const ocupante = String(box?.ocupante || '').trim().toLowerCase();
  const status = String(box?.status || '').trim().toLowerCase();
  if (!ocupante && !status) return true;
  if (ocupante && ocupante !== 'livre') return false;
  if (status && !['disponível', 'disponivel'].includes(status)) return false;
  return true;
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

function normalizeHistoricoEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const toText = (value) => {
    if (value === undefined || value === null) return '';
    return String(value).trim();
  };
  const baseId = toText(entry.id) || toText(entry._id) || toText(entry.criadoEm);
  return {
    id: baseId || `hist-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    tipo: toText(entry.tipo) || 'Atualização',
    descricao: toText(entry.descricao) || 'Atualização registrada.',
    criadoPor: toText(entry.criadoPor) || 'Sistema',
    criadoEm: entry.criadoEm || entry.createdAt || entry.data || '',
  };
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

  const historico = Array.isArray(raw.historico)
    ? raw.historico.map(normalizeHistoricoEntry).filter(Boolean)
    : [];

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
    queixa: toText(raw.queixa),
    diagnostico: toText(raw.diagnostico),
    prognostico: toText(raw.prognostico),
    acessorios: toText(raw.acessorios),
    observacoes: toText(raw.observacoes),
    alergias: normalizeTagList(raw.alergias),
    admissao: raw.admissao || raw.createdAt || '',
    createdAt: raw.createdAt || '',
    updatedAt: raw.updatedAt || '',
    historico,
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
    const isEditMode = internarModal.mode === 'edit';
    const recordId = internarModal.recordId;
    if (isEditMode && !recordId) {
      throw new Error('Não foi possível identificar a internação selecionada para edição.');
    }
    const url = isEditMode ? `/internacao/registros/${encodeURIComponent(recordId)}` : '/internacao/registros';
    const method = isEditMode ? 'PUT' : 'POST';
    await requestJson(url, { method, body: payload });
    const datasetRef = internarModal.dataset || null;
    const stateRef = internarModal.state || null;
    let boxesRefreshPromise = null;
    try {
      if (stateRef && typeof stateRef.refreshBoxes === 'function') {
        boxesRefreshPromise = Promise.resolve(stateRef.refreshBoxes());
      } else if (datasetRef) {
        boxesRefreshPromise = fetchBoxesData(datasetRef, stateRef, { quiet: true });
      }
    } catch (refreshError) {
      console.warn('internacao: falha ao agendar atualização dos boxes', refreshError);
    }
    showToastMessage(isEditMode ? 'Internação atualizada com sucesso.' : 'Internação registrada com sucesso.', 'success');
    const successCallback = internarModal.onSuccess;
    closeInternarPetModal();
    if (boxesRefreshPromise && typeof boxesRefreshPromise.catch === 'function') {
      boxesRefreshPromise.catch((error) => {
        console.warn('internacao: falha ao atualizar boxes após internação', error);
      });
    }
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
  const veterinarios = Array.isArray(dataset?.veterinarios) ? dataset.veterinarios : [];
  if (veterinarios.length) {
    return veterinarios.map((vet) => ({
      value: vet.nome || vet.id,
      label: vet.nome || vet.id || 'Veterinário(a)',
    }));
  }

  const set = new Set();
  (dataset?.pacientes || []).forEach((pet) => {
    const nome = pet?.internacao?.equipeMedica;
    if (nome) set.add(nome);
  });
  return Array.from(set).sort().map((nome) => ({ value: nome, label: nome }));
}

function getBoxOptions(dataset) {
  const boxes = Array.isArray(dataset?.boxes) ? dataset.boxes : [];
  return boxes
    .filter((item) => isBoxAvailable(item))
    .map((item) => ({ value: item.box, label: `${item.box}${item.ocupante ? ` · ${item.ocupante}` : ''}` }));
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

function resetInternarModalForm() {
  if (internarModal.form) {
    internarModal.form.reset();
  }
  internarModal.tags = [];
  if (internarModal.tagsInput) {
    internarModal.tagsInput.value = '';
  }
  renderTagList();
}

function setInternarModalMode(mode) {
  const resolved = mode === 'edit' ? 'edit' : 'create';
  internarModal.mode = resolved;
  if (internarModal.dialog) {
    internarModal.dialog.dataset.modalMode = resolved;
  }
  const title = resolved === 'edit' ? 'Editar internação' : 'Internar pet';
  if (internarModal.titleEl) {
    internarModal.titleEl.textContent = title;
  }
  if (internarModal.submitBtn) {
    const label = resolved === 'edit' ? 'Salvar alterações' : 'Salvar';
    internarModal.submitBtn.dataset.defaultLabel = label;
    if (!internarModal.submitBtn.disabled) {
      internarModal.submitBtn.textContent = label;
    }
  }
}

function fillInternarModalFormFromRecord(record) {
  if (!internarModal.form || !record) return;
  const setValue = (name, value) => {
    const field = internarModal.form.querySelector(`[name="${name}"]`);
    if (!field) return;
    field.value = value || '';
  };

  const situacaoValue = record.situacaoCodigo || record.situacao || '';
  const riscoValue = record.riscoCodigo || record.risco || '';
  const altaData = record.altaPrevistaData || (record.altaPrevistaISO ? record.altaPrevistaISO.slice(0, 10) : '');
  const altaHora = record.altaPrevistaHora || (record.altaPrevistaISO ? record.altaPrevistaISO.slice(11, 16) : '');

  setValue('internarSituacao', situacaoValue);
  setValue('internarRisco', riscoValue);
  setValue('internarVeterinario', record.veterinario || '');
  setValue('internarBox', record.box || '');
  setValue('internarAltaPrevista', altaData || '');
  setValue('internarAltaPrevistaHora', altaHora || '');
  setValue('internarQueixa', record.queixa || '');
  setValue('internarDiagnostico', record.diagnostico || '');
  setValue('internarPrognostico', record.prognostico || '');
  setValue('internarAcessorios', record.acessorios || '');
  setValue('internarObservacoes', record.observacoes || '');

  internarModal.tags = Array.isArray(record.alergias) ? [...record.alergias] : [];
  renderTagList();
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
  resetInternarModalForm();
  setInternarPetInfo(null);
  setInternarModalError('');
  setInternarModalLoading(false);
  internarModal.onSuccess = null;
  internarModal.dataset = null;
  internarModal.state = null;
  internarModal.recordId = null;
  internarModal.currentRecord = null;
  setInternarModalMode('create');
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
  internarModal.titleEl = overlay.querySelector('#internar-pet-modal-title');
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

function ensureSelectOption(select, option) {
  if (!select || !option?.value) return;
  const exists = Array.from(select.options).some((opt) => opt.value === option.value);
  if (exists) return;
  const opt = document.createElement('option');
  opt.value = option.value;
  opt.textContent = option.label || option.value;
  select.appendChild(opt);
}

function populateDynamicSelects(dataset, extraOptions = {}) {
  if (!internarModal.form) return;
  const vetSelect = internarModal.form.querySelector('select[name="internarVeterinario"]');
  const boxSelect = internarModal.form.querySelector('select[name="internarBox"]');
  if (vetSelect) {
    const options = ['<option value="">Selecione</option>', ...getEquipeOptions(dataset).map((opt) => `<option value="${escapeHtml(opt.value)}">${escapeHtml(opt.label)}</option>`)]
      .join('');
    vetSelect.innerHTML = options;
    if (extraOptions.forceVeterinario) {
      ensureSelectOption(vetSelect, extraOptions.forceVeterinario);
    }
  }
  if (boxSelect) {
    const options = ['<option value="">Selecione</option>', ...getBoxOptions(dataset).map((opt) => `<option value="${escapeHtml(opt.value)}">${escapeHtml(opt.label)}</option>`)]
      .join('');
    boxSelect.innerHTML = options;
    if (extraOptions.forceBox) {
      ensureSelectOption(boxSelect, extraOptions.forceBox);
    }
  }
}

function openInternarPetModal(dataset, options = {}) {
  ensureInternarPetModal();
  const wantsEdit = options?.mode === 'edit';
  const record = wantsEdit && options?.record ? options.record : null;
  const mode = wantsEdit && record ? 'edit' : 'create';
  let petInfo = options?.petInfo || null;
  if (!petInfo && record) {
    petInfo = getPetInfoFromInternacaoRecord(record);
  }
  internarModal.onSuccess = typeof options.onSuccess === 'function' ? options.onSuccess : null;
  internarModal.dataset = dataset || null;
  internarModal.state = options?.state || null;
  internarModal.currentRecord = record;
  internarModal.recordId = mode === 'edit' && record ? record.id || record.filterKey || '' : null;
  setInternarModalMode(mode);
  setInternarModalError('');
  setInternarModalLoading(false);
  resetInternarModalForm();
  const selectOverrides = {};
  if (mode === 'edit' && record) {
    if (record.veterinario) {
      selectOverrides.forceVeterinario = { value: record.veterinario, label: record.veterinario };
    }
    if (record.box) {
      selectOverrides.forceBox = { value: record.box, label: record.box };
    }
  }
  populateDynamicSelects(dataset, selectOverrides);
  if (mode === 'edit' && record) {
    fillInternarModalFormFromRecord(record);
  }
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
    button.addEventListener('click', async (event) => {
      event.preventDefault();

      if (!Array.isArray(dataset?.veterinarios) || !dataset.veterinarios.length) {
        await fetchVeterinariosData(dataset, state, { quiet: false });
      }

      if (!Array.isArray(dataset?.boxes) || !dataset.boxes.length) {
        await fetchBoxesData(dataset, state, { quiet: false });
      }

      const triggerPetId = button.dataset.petId || '';
      const resolvedId = triggerPetId || state.petId || '';
      let petInfo = null;
      if (resolvedId) {
        petInfo = getPetInfoFromDataset(dataset, resolvedId) || getPetInfoFromInternacoes(state, resolvedId);
      }
      openInternarPetModal(dataset, {
        petInfo,
        onSuccess: state.refreshInternacoes,
        state,
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

    fetchVeterinariosData(dataset, state, { quiet: true });
    fetchBoxesData(dataset, state, { quiet: true });

    openInternarPetModal(dataset, {
      petInfo,
      onSuccess: state.refreshInternacoes,
      state,
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

function closeFichaInternacaoModal() {
  if (!fichaInternacaoModal.overlay) return;
  if (fichaInternacaoModal.dialog) {
    fichaInternacaoModal.dialog.classList.add('opacity-0', 'scale-95');
  }
  fichaInternacaoModal.overlay.classList.add('hidden');
  fichaInternacaoModal.overlay.removeAttribute('data-modal-open');
  fichaInternacaoModal.record = null;
}

function setFichaModalTab(targetId) {
  const activeId = FICHA_TAB_IDS.includes(targetId) ? targetId : FICHA_TAB_IDS[0];
  fichaInternacaoModal.tabButtons.forEach((button) => {
    const isActive = button.dataset.fichaTab === activeId;
    button.classList.toggle('bg-primary/10', isActive);
    button.classList.toggle('text-primary', isActive);
    button.classList.toggle('text-gray-500', !isActive);
  });
  fichaInternacaoModal.tabPanels.forEach((panel) => {
    panel.classList.toggle('hidden', panel.dataset.fichaPanel !== activeId);
  });
}

function renderFichaTags(tags = []) {
  if (!fichaInternacaoModal.tagsContainer) return;
  const hasTags = Array.isArray(tags) && tags.length;
  if (!hasTags) {
    fichaInternacaoModal.tagsContainer.innerHTML = '<span class="text-[11px] text-gray-400">Nenhuma marcação registrada.</span>';
    return;
  }
  fichaInternacaoModal.tagsContainer.innerHTML = tags
    .map(
      (tag) =>
        `<span class="inline-flex items-center rounded-full bg-primary/10 px-3 py-1 text-[11px] font-semibold text-primary">${escapeHtml(
          tag,
        )}</span>`,
    )
    .join('');
}

function renderFichaHistorico(record) {
  if (!fichaInternacaoModal.historicoListEl) return;
  if (!record) {
    fichaInternacaoModal.historicoListEl.innerHTML = '<p class="text-sm text-gray-500">Nenhum histórico disponível.</p>';
    return;
  }

  const admissaoLabel = formatDateTimeLabel(record.admissao);
  const metaBlocks = [
    record.box ? { label: 'Box', value: record.box } : null,
    record.veterinario ? { label: 'Veterinário responsável', value: record.veterinario } : null,
    record.situacao ? { label: 'Situação inicial', value: record.situacao } : null,
    record.risco ? { label: 'Risco', value: record.risco } : null,
    record.altaPrevistaISO ? { label: 'Alta prevista', value: formatDateTimeLabel(record.altaPrevistaISO) } : null,
  ].filter(Boolean);

  const detalhes = [
    record.queixa ? { label: 'Queixa', value: record.queixa } : null,
    record.diagnostico ? { label: 'Diagnóstico', value: record.diagnostico } : null,
    record.prognostico ? { label: 'Prognóstico', value: record.prognostico } : null,
    record.acessorios ? { label: 'Acessórios', value: record.acessorios } : null,
    record.observacoes ? { label: 'Observações', value: record.observacoes } : null,
  ].filter(Boolean);

  const buildMetaGrid = (items = []) => {
    if (!items.length) {
      return '<p class="mt-3 text-sm text-gray-500">Sem dados administrativos adicionais.</p>';
    }
    return `
      <div class="mt-3 grid gap-3 md:grid-cols-2">
        ${items
          .map(
            (item) => `
              <div class="rounded-xl bg-gray-50 px-3 py-2">
                <p class="text-[10px] font-semibold uppercase tracking-wide text-gray-500">${escapeHtml(item.label)}</p>
                <p class="text-sm font-medium text-gray-900">${escapeHtml(item.value)}</p>
              </div>
            `,
          )
          .join('')}
      </div>
    `;
  };

  const buildDetailList = (items = []) => {
    if (!items.length) {
      return '<p class="mt-3 text-sm text-gray-500">Sem informações clínicas adicionais registradas.</p>';
    }
    return `
      <div class="mt-3 space-y-2 text-sm text-gray-600">
        ${items
          .map(
            (info) => `
              <p><span class="font-semibold text-gray-800">${escapeHtml(info.label)}:</span> ${escapeHtml(info.value)}</p>
            `,
          )
          .join('')}
      </div>
    `;
  };

  const timelineEntries = [];
  const admissaoTimestamp = record.admissao || record.createdAt || '';
  timelineEntries.push({
    id: 'admissao',
    badge: 'Admissão',
    title: 'Admissão em internação',
    subtitle: record.pet?.nome || record.petNome || 'Paciente registrado',
    timestamp: admissaoTimestamp,
    timestampLabel: admissaoLabel,
    extraMarkup: `${buildMetaGrid(metaBlocks)}${buildDetailList(detalhes)}`,
  });

  const updates = Array.isArray(record.historico) ? [...record.historico] : [];
  updates.forEach((entry) => {
    timelineEntries.push({
      id: entry.id || entry.criadoEm || `hist-${Date.now()}-${Math.random()}`,
      badge: entry.tipo || 'Atualização',
      title: entry.descricao || 'Registro atualizado.',
      subtitle: entry.criadoPor ? `Responsável: ${entry.criadoPor}` : '',
      timestamp: entry.criadoEm || entry.createdAt || Date.now(),
      timestampLabel: formatDateTimeLabel(entry.criadoEm),
      extraMarkup: '',
    });
  });

  const sortedEntries = timelineEntries
    .filter((entry) => entry && entry.title)
    .sort((a, b) => {
      const aTime = new Date(a.timestamp || 0).getTime();
      const bTime = new Date(b.timestamp || 0).getTime();
      return bTime - aTime;
    });

  if (!sortedEntries.length) {
    fichaInternacaoModal.historicoListEl.innerHTML = '<p class="text-sm text-gray-500">Nenhum histórico disponível.</p>';
    return;
  }

  const timelineMarkup = sortedEntries
    .map((entry, index) => {
      const isLast = index === sortedEntries.length - 1;
      const lineMarkup = !isLast
        ? '<span class="absolute left-[7px] top-6 block h-full w-px bg-gray-200" aria-hidden="true"></span>'
        : '';
      return `
        <li class="relative pl-6 sm:pl-8">
          ${lineMarkup}
          <span class="absolute left-0 top-4 flex h-4 w-4 items-center justify-center rounded-full bg-white text-[9px] font-bold text-primary ring-2 ring-primary/20" aria-hidden="true">
            <span class="h-2 w-2 rounded-full bg-primary"></span>
          </span>
          <article class="rounded-2xl border border-gray-100 p-4 shadow-sm">
            <div class="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p class="text-[11px] font-semibold uppercase tracking-wide text-primary/80">${escapeHtml(entry.badge)}</p>
                <h3 class="text-base font-semibold text-gray-900">${escapeHtml(entry.title)}</h3>
                ${entry.subtitle ? `<p class="text-xs text-gray-500">${escapeHtml(entry.subtitle)}</p>` : ''}
              </div>
              <p class="text-xs text-gray-500">${escapeHtml(entry.timestampLabel || 'Sem data')}</p>
            </div>
            ${entry.extraMarkup || ''}
          </article>
        </li>
      `;
    })
    .join('');

  fichaInternacaoModal.historicoListEl.innerHTML = `<ol class="relative space-y-4">${timelineMarkup}</ol>`;
}

function ensureFichaInternacaoModal() {
  if (fichaInternacaoModal.overlay) return fichaInternacaoModal.overlay;

  const overlay = document.createElement('div');
  overlay.className = 'ficha-internacao-modal fixed inset-0 z-[1000] hidden';
  overlay.innerHTML = `
    <div class="absolute inset-0 bg-gray-900/60 backdrop-blur-sm" data-close-modal></div>
    <div class="relative mx-auto flex min-h-full w-full items-start justify-center px-3 py-6 sm:items-center">
      <div
        class="relative flex w-full max-w-[1352px] transform-gpu flex-col overflow-hidden rounded-2xl bg-white text-[12px] leading-[1.35] text-gray-700 shadow-2xl opacity-0 transition-all duration-200 ease-out scale-95 max-h-[90vh]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ficha-internacao-title"
        data-ficha-dialog
        tabindex="-1"
      >
        <header class="flex flex-col gap-2.5 border-b border-gray-100 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <span class="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
              <i class="fas fa-stethoscope"></i>
              Internação ativa
            </span>
            <h2 id="ficha-internacao-title" class="mt-1.5 text-lg font-semibold text-gray-900">Ficha de internação</h2>
            <p class="mt-1 text-[11px] text-gray-600" data-ficha-subtitle>Detalhes completos da internação.</p>
          </div>
          <button type="button" class="inline-flex items-center justify-center rounded-full border border-gray-200 p-1.5 text-gray-500 transition hover:bg-gray-50 hover:text-gray-700" data-close-modal>
            <span class="sr-only">Fechar modal</span>
            <i class="fas fa-xmark text-sm"></i>
          </button>
        </header>
        <div class="flex flex-1 flex-col overflow-hidden">
          <div class="flex-1 overflow-y-auto px-4 py-4">
            <div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div class="space-y-1">
                <div class="flex flex-wrap items-center gap-2">
                  <h3 class="text-[15px] font-semibold text-gray-900" data-ficha-pet-nome>Paciente</h3>
                  <span class="rounded-full border border-gray-200 px-2 py-0.5 text-[10px] font-semibold text-gray-600" data-ficha-situacao-badge>—</span>
                  <span class="rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-gray-200" data-ficha-risco-badge>—</span>
                </div>
                <p class="text-[11px] text-gray-500" data-ficha-pet-meta>—</p>
                <p class="text-[10px] text-gray-400" data-ficha-tutor-resumo>—</p>
              </div>
              <div class="flex flex-wrap items-center justify-end gap-2" data-ficha-actions>
                ${['Editar', 'Alta', 'Óbito', 'Box', 'Cancelar']
                  .map(
                    (acao) => `
                      <button type="button" class="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-[11px] font-semibold text-gray-600 transition hover:border-primary/40 hover:text-primary" data-ficha-action="${acao.toLowerCase()}">
                        ${acao}
                      </button>
                    `,
                  )
                  .join('')}
              </div>
            </div>

            <div class="mt-4">
              <p class="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Marcações clínicas</p>
              <div class="mt-2 flex flex-wrap gap-1.5" data-ficha-tags></div>
            </div>

            <div class="mt-4 rounded-xl border border-gray-200 px-4 py-3">
              <p class="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Informações do tutor</p>
              <p class="mt-1.5 text-[13px] font-semibold text-gray-900" data-ficha-tutor-nome>—</p>
              <p class="text-[11px] text-gray-500" data-ficha-tutor-contatos>—</p>
            </div>

            <div class="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
              <div class="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5">
                <p class="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Status</p>
                <p class="text-[13px] font-semibold text-gray-900" data-ficha-status>—</p>
              </div>
              <div class="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5">
                <p class="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Box internado</p>
                <p class="text-[13px] font-semibold text-gray-900" data-ficha-box>—</p>
              </div>
              <div class="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5">
                <p class="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Alta prevista</p>
                <p class="text-[13px] font-semibold text-gray-900" data-ficha-alta>—</p>
              </div>
              <div class="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5">
                <p class="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Duração</p>
                <p class="text-[13px] font-semibold text-gray-900" data-ficha-duracao>—</p>
              </div>
              <div class="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5">
                <p class="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Veterinário responsável</p>
                <p class="text-[13px] font-semibold text-gray-900" data-ficha-veterinario>—</p>
              </div>
            </div>

            <div class="mt-4 grid gap-3 md:grid-cols-2">
              <div class="rounded-xl border border-gray-200 px-3 py-2.5">
                <p class="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Código interno</p>
                <p class="text-[13px] font-semibold text-gray-900" data-ficha-codigo>—</p>
              </div>
              <div class="rounded-xl border border-gray-200 px-3 py-2.5">
                <p class="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Admissão</p>
                <p class="text-[13px] font-semibold text-gray-900" data-ficha-admissao>—</p>
              </div>
            </div>

            <div class="mt-4">
              <div class="flex flex-wrap gap-2 border-b border-gray-100 pb-2 text-[11px] font-semibold text-gray-500">
                <button type="button" class="rounded-lg px-3 py-1.5 text-[11px] text-gray-500 transition" data-ficha-tab="historico">Histórico</button>
                <button type="button" class="rounded-lg px-3 py-1.5 text-[11px] text-gray-500 transition" data-ficha-tab="prescricao">Prescrição médica</button>
              </div>
              <div class="pt-4" data-ficha-panel="historico">
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <div class="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Ações rápidas</div>
                  <div class="flex flex-wrap gap-1.5">
                    ${['Ocorrência', 'Peso', 'Relatório médico']
                      .map(
                        (acao) => `
                          <button type="button" class="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-[11px] font-semibold text-gray-600 transition hover:border-primary/40 hover:text-primary" data-ficha-hist-action="${acao.toLowerCase()}">
                            ${acao}
                          </button>
                        `,
                      )
                      .join('')}
                  </div>
                </div>
                <div class="mt-4 space-y-3" data-ficha-historico-list>
                  <p class="text-[12px] text-gray-500">Carregando histórico...</p>
                </div>
              </div>
              <div class="hidden pt-4" data-ficha-panel="prescricao">
                <div class="rounded-2xl border border-dashed border-gray-200 bg-gray-50 px-4 py-8 text-center text-[12px] text-gray-500">
                  Em desenvolvimento
                </div>
              </div>
            </div>
          </div>
          <footer class="border-t border-gray-100 px-4 py-3 text-[11px] text-gray-500">Atualizado em tempo real conforme registros da internação.</footer>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  fichaInternacaoModal.overlay = overlay;
  fichaInternacaoModal.dialog = overlay.querySelector('[data-ficha-dialog]');
  fichaInternacaoModal.subtitleEl = overlay.querySelector('[data-ficha-subtitle]');
  fichaInternacaoModal.petNameEl = overlay.querySelector('[data-ficha-pet-nome]');
  fichaInternacaoModal.petMetaEl = overlay.querySelector('[data-ficha-pet-meta]');
  fichaInternacaoModal.tutorResumoEl = overlay.querySelector('[data-ficha-tutor-resumo]');
  fichaInternacaoModal.tutorNomeEl = overlay.querySelector('[data-ficha-tutor-nome]');
  fichaInternacaoModal.tutorContatoEl = overlay.querySelector('[data-ficha-tutor-contatos]');
  fichaInternacaoModal.situacaoBadgeEl = overlay.querySelector('[data-ficha-situacao-badge]');
  fichaInternacaoModal.riscoBadgeEl = overlay.querySelector('[data-ficha-risco-badge]');
  fichaInternacaoModal.tagsContainer = overlay.querySelector('[data-ficha-tags]');
  fichaInternacaoModal.statusEl = overlay.querySelector('[data-ficha-status]');
  fichaInternacaoModal.boxEl = overlay.querySelector('[data-ficha-box]');
  fichaInternacaoModal.altaEl = overlay.querySelector('[data-ficha-alta]');
  fichaInternacaoModal.duracaoEl = overlay.querySelector('[data-ficha-duracao]');
  fichaInternacaoModal.vetEl = overlay.querySelector('[data-ficha-veterinario]');
  fichaInternacaoModal.codigoEl = overlay.querySelector('[data-ficha-codigo]');
  fichaInternacaoModal.admissaoEl = overlay.querySelector('[data-ficha-admissao]');
  fichaInternacaoModal.historicoListEl = overlay.querySelector('[data-ficha-historico-list]');
  fichaInternacaoModal.tabButtons = Array.from(overlay.querySelectorAll('[data-ficha-tab]'));
  fichaInternacaoModal.tabPanels = Array.from(overlay.querySelectorAll('[data-ficha-panel]'));

  overlay.addEventListener('click', async (event) => {
    const closeTrigger = event.target.closest('[data-close-modal]');
    if (closeTrigger) {
      event.preventDefault();
      closeFichaInternacaoModal();
      return;
    }
    const actionTrigger = event.target.closest('[data-ficha-action]');
    if (actionTrigger) {
      event.preventDefault();
      const actionType = actionTrigger.dataset.fichaAction;
      if (actionType === 'editar') {
        await handleFichaEditarAction();
      } else {
        showToastMessage('Funcionalidade em desenvolvimento.', 'info');
      }
      return;
    }
    const quickActionTrigger = event.target.closest('[data-ficha-hist-action]');
    if (quickActionTrigger) {
      event.preventDefault();
      showToastMessage('Funcionalidade em desenvolvimento.', 'info');
      return;
    }
    const tabTrigger = event.target.closest('[data-ficha-tab]');
    if (tabTrigger) {
      event.preventDefault();
      setFichaModalTab(tabTrigger.dataset.fichaTab);
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !overlay.classList.contains('hidden')) {
      closeFichaInternacaoModal();
    }
  });

  setFichaModalTab('historico');
  renderFichaTags([]);
  renderFichaHistorico(null);

  return overlay;
}

async function handleFichaEditarAction() {
  const record = fichaInternacaoModal.record;
  if (!record) {
    showToastMessage('Não foi possível carregar os dados dessa internação.', 'warning');
    return;
  }
  const dataset = fichaInternacaoModal.dataset || getDataset();
  const state = fichaInternacaoModal.state || {};
  try {
    await fetchVeterinariosData(dataset, state, { quiet: true });
  } catch (error) {
    console.warn('internacao: falha ao atualizar veterinários antes de editar', error);
  }
  try {
    await fetchBoxesData(dataset, state, { quiet: true });
  } catch (error) {
    console.warn('internacao: falha ao atualizar boxes antes de editar', error);
  }
  closeFichaInternacaoModal();
  openInternarPetModal(dataset, {
    petInfo: getPetInfoFromInternacaoRecord(record),
    onSuccess: state.refreshInternacoes,
    state,
    mode: 'edit',
    record,
  });
}

function fillFichaInternacaoModal(record) {
  if (!record) return;
  ensureFichaInternacaoModal();
  const petNome = record.pet?.nome || record.petNome || 'Paciente';
  const meta = [record.pet?.especie, record.pet?.raca, record.pet?.peso || record.pet?.idade].filter(Boolean).join(' · ');
  const tutorNome = record.tutor?.nome || 'Tutor não informado';
  const tutorContato = [record.tutor?.contato, record.tutor?.documento].filter(Boolean).join(' · ');
  const tutorResumo = tutorNome ? `Tutor: ${tutorNome}` : 'Tutor não informado';
  const subtitleParts = [];
  if (record.codigo !== null && record.codigo !== undefined) {
    subtitleParts.push(`Código interno #${record.codigo}`);
  }
  if (record.admissao) {
    subtitleParts.push(`Admissão: ${formatDateTimeLabel(record.admissao)}`);
  }

  if (fichaInternacaoModal.petNameEl) fichaInternacaoModal.petNameEl.textContent = petNome;
  if (fichaInternacaoModal.petMetaEl) fichaInternacaoModal.petMetaEl.textContent = meta || '—';
  if (fichaInternacaoModal.subtitleEl) fichaInternacaoModal.subtitleEl.textContent = subtitleParts.join(' · ') || 'Detalhes completos da internação.';
  if (fichaInternacaoModal.tutorResumoEl) fichaInternacaoModal.tutorResumoEl.textContent = tutorResumo;
  if (fichaInternacaoModal.tutorNomeEl) fichaInternacaoModal.tutorNomeEl.textContent = tutorNome;
  if (fichaInternacaoModal.tutorContatoEl) fichaInternacaoModal.tutorContatoEl.textContent = tutorContato || '—';

  if (fichaInternacaoModal.situacaoBadgeEl) {
    fichaInternacaoModal.situacaoBadgeEl.textContent = record.situacao ? `Situação: ${record.situacao}` : 'Situação não informada';
  }
  if (fichaInternacaoModal.riscoBadgeEl) {
    fichaInternacaoModal.riscoBadgeEl.textContent = record.risco ? `Risco: ${record.risco}` : 'Risco não informado';
    fichaInternacaoModal.riscoBadgeEl.className = `inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${getRiscoBadgeClass(
      record.riscoCodigo,
    )}`;
  }

  if (fichaInternacaoModal.statusEl) fichaInternacaoModal.statusEl.textContent = record.situacao || '—';
  if (fichaInternacaoModal.boxEl) fichaInternacaoModal.boxEl.textContent = record.box || '—';
  if (fichaInternacaoModal.altaEl) fichaInternacaoModal.altaEl.textContent = formatDateTimeLabel(record.altaPrevistaISO);
  if (fichaInternacaoModal.duracaoEl) fichaInternacaoModal.duracaoEl.textContent = formatDurationSince(record.admissao);
  if (fichaInternacaoModal.vetEl) fichaInternacaoModal.vetEl.textContent = record.veterinario || '—';
  if (fichaInternacaoModal.codigoEl) fichaInternacaoModal.codigoEl.textContent = record.codigo !== null && record.codigo !== undefined ? `#${record.codigo}` : '—';
  if (fichaInternacaoModal.admissaoEl) fichaInternacaoModal.admissaoEl.textContent = formatDateTimeLabel(record.admissao);

  renderFichaTags(record.alergias || []);
  renderFichaHistorico(record);
}

function openFichaInternacaoModal(record, options = {}) {
  if (!record) return;
  ensureFichaInternacaoModal();
  fichaInternacaoModal.record = record;
  fichaInternacaoModal.dataset = options.dataset || fichaInternacaoModal.dataset || null;
  fichaInternacaoModal.state = options.state || fichaInternacaoModal.state || null;
  fillFichaInternacaoModal(record);
  setFichaModalTab('historico');
  fichaInternacaoModal.overlay.classList.remove('hidden');
  fichaInternacaoModal.overlay.dataset.modalOpen = 'true';
  if (fichaInternacaoModal.dialog) {
    requestAnimationFrame(() => {
      fichaInternacaoModal.dialog.classList.remove('opacity-0', 'scale-95');
      fichaInternacaoModal.dialog.focus();
    });
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

async function fetchBoxesData(dataset, state = {}, { quiet = false, onUpdate } = {}) {
  if (state) {
    state.boxesLoading = true;
    state.boxesError = '';
  }
  if (typeof onUpdate === 'function') onUpdate();

  try {
    const data = await requestJson('/internacao/boxes');
    const normalized = Array.isArray(data) ? data.map(normalizeBox).filter(Boolean) : [];
    if (dataset) dataset.boxes = normalized;
    if (state) {
      state.boxes = normalized;
      state.boxesLoading = false;
    }
    populateDynamicSelects(dataset);
    if (typeof onUpdate === 'function') onUpdate();
    return normalized;
  } catch (error) {
    console.error('internacao: falha ao carregar boxes', error);
    if (state) {
      state.boxesError = error.message || 'Não foi possível carregar os boxes.';
      state.boxesLoading = false;
    }
    if (!quiet) {
      showToastMessage(state?.boxesError || 'Não foi possível carregar os boxes.', 'warning');
    }
    if (typeof onUpdate === 'function') onUpdate();
    return [];
  }
}

async function fetchVeterinariosData(dataset, state = {}, { quiet = false } = {}) {
  if (state) {
    state.veterinariosLoading = true;
    state.veterinariosError = '';
  }

  try {
    const data = await requestJson('/func/profissionais?tipos=veterinario');
    const normalized = Array.isArray(data) ? data.map(normalizeVeterinario).filter(Boolean) : [];
    if (dataset) dataset.veterinarios = normalized;
    if (state) {
      state.veterinarios = normalized;
      state.veterinariosLoading = false;
    }
    populateDynamicSelects(dataset);
    return normalized;
  } catch (error) {
    console.error('internacao: falha ao carregar veterinários', error);
    if (state) {
      state.veterinariosError = error.message || 'Não foi possível carregar os veterinários.';
      state.veterinariosLoading = false;
    }
    if (!quiet) {
      showToastMessage(state?.veterinariosError || 'Não foi possível carregar os veterinários.', 'warning');
    }
    return [];
  }
}

function setupBoxesPage(dataset, state, render) {
  const root = document.querySelector('[data-internacao-root]');

  const fetchBoxes = () => fetchBoxesData(dataset, state, { quiet: true, onUpdate: render });
  state.refreshBoxes = fetchBoxes;

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
      const sorted = [...normalized].sort((a, b) => {
        const aTime = new Date(a.admissao || a.createdAt || 0).getTime();
        const bTime = new Date(b.admissao || b.createdAt || 0).getTime();
        return bTime - aTime;
      });
      dataset.internacoes = sorted;
      state.internacoes = sorted;
      state.internacoesLoading = false;
      const availableKeys = new Set(sorted.map((item) => item.filterKey));
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
        return;
      }
      const fichaTrigger = event.target.closest('[data-open-ficha]');
      if (fichaTrigger) {
        event.preventDefault();
        const recordId = fichaTrigger.dataset.recordId || '';
        let registro = null;
        if (recordId) {
          registro = state.internacoes.find(
            (item) => item.id === recordId || item.filterKey === recordId || String(item.codigo) === recordId,
          );
        }
        if (!registro) {
          showToastMessage('Não foi possível carregar os detalhes dessa internação.', 'warning');
          return;
        }
        openFichaInternacaoModal(registro, { dataset, state });
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
    veterinarios: Array.isArray(dataset.veterinarios) ? [...dataset.veterinarios] : [],
    veterinariosLoading: false,
    veterinariosError: '',
    internacoes: Array.isArray(dataset.internacoes) ? [...dataset.internacoes] : [],
    internacoesLoading: false,
    internacoesError: '',
    refreshInternacoes: null,
    refreshBoxes: null,
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

  state.refreshBoxes = () => fetchBoxesData(dataset, state, { quiet: true });

  fillPetFilters(dataset, state.petId, state);
  updateSyncInfo(dataset);
  render();

  if (view === 'animais') {
    setupAnimaisPage(dataset, state, render);
  }
  if (view === 'boxes') {
    setupBoxesPage(dataset, state, render);
  } else {
    state.refreshBoxes();
  }

  fetchVeterinariosData(dataset, state, { quiet: true });

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
