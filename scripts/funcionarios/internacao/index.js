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

const PRESCRICAO_TIPO_OPTIONS = [
  { value: 'procedimento', label: 'Procedimento' },
  { value: 'medicamento', label: 'Medicamento' },
  { value: 'fluidoterapia', label: 'Fluidoterapia' },
];

const PRESCRICAO_FREQUENCIA_OPTIONS = [
  { value: 'recorrente', label: 'Recorrente' },
  { value: 'unica', label: 'Apenas 1 vez' },
  { value: 'necessario', label: 'Quando necessário' },
];

const PRESCRICAO_INTERVALO_OPTIONS = [
  { value: 'horas', label: 'Hora(s)' },
  { value: 'dias', label: 'Dia(s)' },
];

const PRESCRICAO_POR_OPTIONS = [
  { value: 'horas', label: 'Hora(s)' },
  { value: 'dias', label: 'Dia(s)' },
  { value: 'vezes', label: 'Vez(es)' },
];

const PRESCRICAO_MED_UNIDADE_GROUPS = [
  {
    label: 'Absolutos',
    options: [
      { value: 'borrifada', label: 'Borrifada' },
      { value: 'capsula', label: 'Cápsula' },
      { value: 'cm', label: 'cm' },
      { value: 'comprimidos', label: 'Comprimido(s)' },
      { value: 'dragea', label: 'Drágea' },
      { value: 'g', label: 'g' },
      { value: 'gotas', label: 'Gota(s)' },
      { value: 'l', label: 'l' },
      { value: 'mcg', label: 'mcg' },
      { value: 'medida', label: 'Medida' },
      { value: 'mg', label: 'mg' },
      { value: 'ml', label: 'ml' },
      { value: 'sache', label: 'Sachê' },
      { value: 'ui', label: 'UI' },
      { value: 'un', label: 'UN' },
    ],
  },
  {
    label: 'Relativos',
    options: [
      { value: 'gkg', label: 'g/kg' },
      { value: 'gotaskg', label: 'Gotas/kg' },
      { value: 'mcgkg', label: 'mcg/kg' },
      { value: 'mgkg', label: 'mg/kg' },
      { value: 'mlkg', label: 'ml/kg' },
      { value: 'uikg', label: 'UI/kg' },
    ],
  },
];

const PRESCRICAO_MED_UNIDADE_OPTIONS = PRESCRICAO_MED_UNIDADE_GROUPS.flatMap((group) => group.options);

const PRESCRICAO_MED_VIA_OPTIONS = [
  { value: 'enema', label: 'Enema' },
  { value: 'epidural', label: 'Epidural' },
  { value: 'inalatoria', label: 'Inalatória' },
  { value: 'intramuscular', label: 'Intramuscular' },
  { value: 'intraossea', label: 'Intraóssea' },
  { value: 'intraperitoneal', label: 'Intraperitoneal' },
  { value: 'intravenosa', label: 'Intravenosa' },
  { value: 'oftalmica', label: 'Oftálmica' },
  { value: 'oral', label: 'Oral' },
  { value: 'otologica', label: 'Otológica' },
  { value: 'sonda', label: 'Sonda' },
  { value: 'subcutanea', label: 'Subcutânea' },
  { value: 'topica', label: 'Tópica' },
];

const PRESCRICAO_FLUID_EQUIPO_OPTIONS = [
  { value: 'macro', label: 'Macro gotas' },
  { value: 'micro', label: 'Micro gotas' },
];

const PRESCRICAO_FLUID_VELOCIDADE_OPTIONS = [
  { value: 'gotasmin', label: 'Gotas/m' },
  { value: 'mlhora', label: 'ml/h' },
  { value: 'mldia', label: 'ml/dia' },
];

const EXECUCAO_STATUS_FINISHED = [
  'executado',
  'executada',
  'realizado',
  'realizada',
  'concluido',
  'concluida',
  'finalizado',
  'finalizada',
  'aplicado',
  'aplicada',
  'administrado',
  'administrada',
  'feito',
  'feita',
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

const obitoModal = {
  overlay: null,
  dialog: null,
  form: null,
  submitBtn: null,
  errorEl: null,
  petSummaryEl: null,
  petSummaryNameEl: null,
  petSummaryMetaEl: null,
  petSummaryTutorEl: null,
  confirmInput: null,
  confirmLabelEl: null,
  dataset: null,
  state: null,
  onSuccess: null,
  record: null,
  recordId: null,
  petInfo: null,
};

const cancelarModal = {
  overlay: null,
  dialog: null,
  form: null,
  submitBtn: null,
  errorEl: null,
  petSummaryEl: null,
  petSummaryNameEl: null,
  petSummaryMetaEl: null,
  petSummaryTutorEl: null,
  dataset: null,
  state: null,
  onSuccess: null,
  onClose: null,
  record: null,
  recordId: null,
  petInfo: null,
};

const ocorrenciaModal = {
  overlay: null,
  dialog: null,
  form: null,
  submitBtn: null,
  errorEl: null,
  petSummaryEl: null,
  petSummaryNameEl: null,
  petSummaryMetaEl: null,
  petSummaryTutorEl: null,
  dataset: null,
  state: null,
  onSuccess: null,
  record: null,
  recordId: null,
  petInfo: null,
};

const moverBoxModal = {
  overlay: null,
  dialog: null,
  form: null,
  submitBtn: null,
  errorEl: null,
  selectEl: null,
  noOptionsEl: null,
  petSummaryEl: null,
  petSummaryNameEl: null,
  petSummaryMetaEl: null,
  petSummaryTutorEl: null,
  dataset: null,
  state: null,
  onSuccess: null,
  record: null,
  recordId: null,
  petInfo: null,
};

const prescricaoModal = {
  overlay: null,
  dialog: null,
  form: null,
  submitBtn: null,
  errorEl: null,
  dataset: null,
  state: null,
  record: null,
  petInfo: null,
  resumoField: null,
  recorrenciaFields: null,
  recorrenciaTitleEl: null,
  intervaloDetalheFields: null,
  medicamentoFields: null,
  fluidFields: null,
  tipoInputs: null,
  frequenciaInputs: null,
  descricaoWrapper: null,
  descricaoField: null,
  petSummaryEl: null,
  petSummaryNameEl: null,
  petSummaryMetaEl: null,
  petSummaryTutorEl: null,
  medPesoField: null,
  medPesoMetaEl: null,
  descricaoLabelEl: null,
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
  prescricoesListEl: null,
  tabButtons: [],
  tabPanels: [],
  actionsContainer: null,
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

function createCardOptionsMarkup(name, options) {
  if (!name || !Array.isArray(options)) return '';
  const fieldName = escapeHtml(name);
  return options
    .map((opt, index) => {
      const value = escapeHtml(opt.value);
      const label = escapeHtml(opt.label);
      const defaultAttr = index === 0 ? 'checked' : '';
      return `
        <label class="group relative block" data-prescricao-card>
          <input type="radio" name="${fieldName}" value="${value}" class="peer sr-only" ${defaultAttr} />
          <span class="flex min-h-[32px] w-full items-center justify-center rounded-lg border border-gray-200 bg-white px-2 py-1 text-[9px] font-semibold uppercase tracking-wide text-gray-600 transition-colors duration-150" data-prescricao-card-visual>
            ${label}
          </span>
        </label>
      `;
    })
    .join('');
}

function createGroupedOptionsMarkup(groups) {
  if (!Array.isArray(groups)) return '';
  return groups
    .map((group) => {
      const optionsMarkup = createOptionsMarkup(group?.options || []);
      if (!optionsMarkup) return '';
      const label = escapeHtml(group?.label || 'Opções');
      return `<optgroup label="${label}">${optionsMarkup}</optgroup>`;
    })
    .join('');
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

function normalizeExecucaoStatusKey(status) {
  const key = normalizeActionKey(status);
  if (!key) return '';
  if (EXECUCAO_STATUS_FINISHED.includes(key)) return 'concluida';
  if (key.includes('agend')) return 'agendada';
  if (key.includes('demanda')) return 'sob-demanda';
  return key;
}

function hasNecessarioFlag(value) {
  if (!value) return false;
  return String(value)
    .normalize('NFD')
    .replace(/[^\w\s]/g, '')
    .toLowerCase()
    .includes('necess');
}

function isExecucaoSobDemanda(item) {
  if (!item || typeof item !== 'object') return false;

  const status = String(item?.status || '').toLowerCase();
  if (status.includes('sob demanda') || status.includes('necess')) return true;

  return [
    item.frequencia,
    item.freq,
    item.tipoFrequencia,
    item.prescricaoFrequencia,
    item.prescricaoTipo,
    item.programadoLabel,
    item.tipo,
    item.resumo,
  ].some((value) => hasNecessarioFlag(value));
}

function buildExecucaoProgramadoLabel(programadoEm, programadoData, programadoHora, fallbackHora) {
  if (programadoEm) {
    return formatDateTimeLabel(programadoEm);
  }
  if (programadoData && programadoHora) {
    const combined = combineDateAndTime(programadoData, programadoHora);
    if (combined) {
      return formatDateTimeLabel(combined);
    }
  }
  if (programadoData) {
    const combined = combineDateAndTime(programadoData, fallbackHora || '00:00');
    if (combined) {
      return formatDateTimeLabel(combined);
    }
  }
  if (programadoHora || fallbackHora) {
    return `Horário ${programadoHora || fallbackHora}`;
  }
  return '—';
}

function resolveExecucaoDayKey(programadoData, programadoEm, realizadoData, realizadoEm) {
  const normalizeDateKey = (value) => {
    if (!value) return '';
    const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) return `${match[1]}-${match[2]}-${match[3]}`;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return getLocalDateInputValue(date);
  };

  return (
    normalizeDateKey(programadoData) ||
    normalizeDateKey(programadoEm) ||
    normalizeDateKey(realizadoData) ||
    normalizeDateKey(realizadoEm) ||
    getLocalDateInputValue()
  );
}

function normalizeExecucaoItem(raw, { quandoNecessarioPrescricaoIds } = {}) {
  if (!raw || typeof raw !== 'object') return null;
  const toText = (value) => {
    if (value === undefined || value === null) return '';
    return String(value).trim();
  };
  const horario = toText(raw.horario) || toText(raw.programadoHora) || toText(raw.realizadoHora);
  const prescricaoId = toText(raw.prescricaoId);
  const sobDemandaPrescricao = prescricaoId && quandoNecessarioPrescricaoIds?.has(prescricaoId);
  const sobDemanda = Boolean(raw.sobDemanda) || isExecucaoSobDemanda(raw) || sobDemandaPrescricao;
  const hourKey = horario ? horario.slice(0, 2).padStart(2, '0') : sobDemanda ? '00' : '';
  const id = toText(raw.id) || toText(raw._id) || `${horario || 'exec'}-${Math.random().toString(36).slice(2, 8)}`;
  const descricao = toText(raw.descricao);
  const responsavel = toText(raw.responsavel);
  const status = toText(raw.status) || 'Agendado';
  const statusKey = normalizeExecucaoStatusKey(status);
  const programadoData = toText(raw.programadoData);
  const programadoHora = toText(raw.programadoHora) || horario;
  const programadoEm = raw.programadoEm || combineDateAndTime(programadoData, programadoHora);
  const programadoLabel = buildExecucaoProgramadoLabel(programadoEm, programadoData, programadoHora, horario);
  const realizadoData = toText(raw.realizadoData);
  const realizadoHora = toText(raw.realizadoHora);
  const realizadoEm = raw.realizadoEm || combineDateAndTime(realizadoData, realizadoHora);
  const realizadoLabel = realizadoEm ? formatDateTimeLabel(realizadoEm) : '';
  const observacoes = toText(raw.observacoes);
  const realizadoPor = toText(raw.realizadoPor);
  const dayKey = resolveExecucaoDayKey(programadoData, programadoEm, realizadoData, realizadoEm);
  return {
    id,
    horario,
    hourKey,
    sobDemanda,
    descricao,
    responsavel,
    status,
    statusKey,
    prescricaoId,
    programadoData,
    programadoHora,
    programadoEm,
    programadoLabel,
    realizadoData,
    realizadoHora,
    realizadoEm,
    realizadoLabel,
    observacoes,
    realizadoPor,
    dayKey,
  };
}

function normalizeExecucoes(list, options = {}) {
  if (!Array.isArray(list)) return [];
  return list
    .map((raw) => normalizeExecucaoItem(raw, options))
    .filter((item) => item && (item.hourKey || item.sobDemanda));
}

function getLocalDateInputValue(dateInput = new Date()) {
  const date = new Date(dateInput);
  if (Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function getLocalTimeInputValue(dateInput = new Date()) {
  const date = new Date(dateInput);
  if (Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(11, 16);
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
    'petPesoAtualizadoEm',
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
    petPesoAtualizadoEm: match.pesoAtualizadoEm,
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
    petPesoAtualizadoEm: match.pet?.pesoAtualizadoEm,
    petIdade: match.pet?.idade,
    tutorNome: match.tutor?.nome,
    tutorContato: match.tutor?.contato,
    tutorDocumento: match.tutor?.documento,
  });
}

function getPetInfoFromInternacaoRecord(record) {
  if (!record) return null;
  const pesoAtualizadoEm =
    record.pet?.pesoAtualizadoEm ||
    record.petPesoAtualizadoEm ||
    getLatestPesoHistoricoTimestamp(record);
  return normalizePetInfo({
    petId: record.pet?.id || record.petId || record.filterKey,
    petNome: record.pet?.nome || record.petNome,
    petEspecie: record.pet?.especie,
    petRaca: record.pet?.raca,
    petPeso: record.pet?.peso,
    petIdade: record.pet?.idade,
    petPesoAtualizadoEm: pesoAtualizadoEm,
    tutorNome: record.tutor?.nome || record.tutorNome,
    tutorContato: record.tutor?.contato || record.tutorContato,
    tutorDocumento: record.tutor?.documento || record.tutorDocumento,
  });
}

function getPetInfoFromParams(params) {
  if (!(params instanceof URLSearchParams)) return null;
  const payload = {};
  [
    'petId',
    'petNome',
    'petEspecie',
    'petRaca',
    'petPeso',
    'petPesoAtualizadoEm',
    'petIdade',
    'tutorNome',
    'tutorContato',
    'tutorDocumento',
  ].forEach((key) => {
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

function normalizePrescricaoItem(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const toText = (value) => {
    if (value === undefined || value === null) return '';
    return String(value).trim();
  };
  const tipo = toText(entry.tipo) || 'procedimento';
  const frequencia = toText(entry.frequencia) || 'recorrente';
  const { label: tipoLabel } = getOptionDetails(PRESCRICAO_TIPO_OPTIONS, tipo);
  const { label: frequenciaLabel } = getOptionDetails(PRESCRICAO_FREQUENCIA_OPTIONS, frequencia);
  const aCadaValor = toText(entry.aCadaValor);
  const aCadaUnidade = toText(entry.aCadaUnidade);
  const porValor = toText(entry.porValor);
  const porUnidade = toText(entry.porUnidade);
  const dataInicio = toText(entry.dataInicio);
  const horaInicio = toText(entry.horaInicio);
  const resumo = toText(entry.resumo);
  const medUnidade = toText(entry.medUnidade);
  const medDose = toText(entry.medDose);
  const medVia = toText(entry.medVia);
  const medPeso = toText(entry.medPeso);
  const medPesoAtualizadoEm = toText(entry.medPesoAtualizadoEm);
  const { label: medUnidadeLabel } = getOptionDetails(PRESCRICAO_MED_UNIDADE_OPTIONS, medUnidade);
  const { label: medViaLabel } = getOptionDetails(PRESCRICAO_MED_VIA_OPTIONS, medVia);
  const fluidFluido = toText(entry.fluidFluido);
  const fluidEquipo = toText(entry.fluidEquipo);
  const fluidUnidade = toText(entry.fluidUnidade);
  const fluidDose = toText(entry.fluidDose);
  const fluidVia = toText(entry.fluidVia);
  const fluidVelocidadeValor = toText(entry.fluidVelocidadeValor);
  const fluidVelocidadeUnidade = toText(entry.fluidVelocidadeUnidade);
  const fluidSuplemento = toText(entry.fluidSuplemento);
  const { label: fluidEquipoLabel } = getOptionDetails(PRESCRICAO_FLUID_EQUIPO_OPTIONS, fluidEquipo);
  const { label: fluidVelocidadeLabel } = getOptionDetails(PRESCRICAO_FLUID_VELOCIDADE_OPTIONS, fluidVelocidadeUnidade);
  const { label: fluidViaLabel } = getOptionDetails(PRESCRICAO_MED_VIA_OPTIONS, fluidVia);
  return {
    id:
      toText(entry.id) ||
      toText(entry._id) ||
      `presc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    tipo,
    tipoLabel: tipoLabel || 'Procedimento',
    frequencia,
    frequenciaLabel: frequenciaLabel || 'Recorrente',
    descricao: toText(entry.descricao),
    resumo: resumo || 'Prescrição registrada.',
    aCadaValor,
    aCadaUnidade,
    porValor,
    porUnidade,
    dataInicio,
    horaInicio,
    inicioISO: combineDateAndTime(dataInicio, horaInicio),
    criadoEm: entry.criadoEm || entry.createdAt || new Date().toISOString(),
    medUnidade,
    medUnidadeLabel: medUnidadeLabel || '',
    medDose,
    medVia,
    medViaLabel: medViaLabel || '',
    medPeso,
    medPesoAtualizadoEm,
    fluidFluido,
    fluidEquipo,
    fluidEquipoLabel: fluidEquipoLabel || '',
    fluidUnidade,
    fluidDose,
    fluidVia,
    fluidViaLabel: fluidViaLabel || '',
    fluidVelocidadeValor,
    fluidVelocidadeUnidade,
    fluidVelocidadeLabel: fluidVelocidadeLabel || '',
    fluidSuplemento: fluidSuplemento || 'Sem suplemento',
  };
}

function findPrescricaoById(record, prescricaoId) {
  if (!record || !Array.isArray(record.prescricoes)) return null;
  const targetId = String(prescricaoId || '').trim();
  if (!targetId) return null;
  return record.prescricoes.find((item) => item && item.id === targetId) || null;
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
  const situacaoCodigo = toText(raw.situacaoCodigo);
  const canceladoFlag = Boolean(raw.cancelado) || normalizeActionKey(situacaoCodigo) === 'cancelado';
  const ultimoPesoHistorico = historico.find((entry) =>
    normalizeActionKey(entry.tipo).includes('peso'),
  );
  const petPesoAtualizadoEm =
    toText(raw.petPesoAtualizadoEm) || toText(raw.pesoAtualizadoEm) || ultimoPesoHistorico?.criadoEm || '';

  const prescricoes = Array.isArray(raw.prescricoes)
    ? raw.prescricoes.map(normalizePrescricaoItem).filter(Boolean)
    : [];

  const quandoNecessarioPrescricaoIds = new Set(
    prescricoes
      .filter((presc) => normalizeActionKey(presc.frequencia) === 'necessario' && presc.id)
      .map((presc) => presc.id),
  );

  const execucoes = normalizeExecucoes(raw.execucoes, { quandoNecessarioPrescricaoIds });

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
      pesoAtualizadoEm: petPesoAtualizadoEm,
    },
    tutor: {
      nome: toText(raw.tutorNome),
      contato: toText(raw.tutorContato),
      documento: toText(raw.tutorDocumento),
    },
    situacao: toText(raw.situacao),
    situacaoCodigo,
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
    execucoes,
    cancelado: canceladoFlag,
    canceladoResponsavel: toText(raw.canceladoResponsavel),
    canceladoData: toText(raw.canceladoData),
    canceladoHora: toText(raw.canceladoHora),
    canceladoISO: combineDateAndTime(raw.canceladoData, raw.canceladoHora),
    canceladoJustificativa: toText(raw.canceladoJustificativa),
    canceladoObservacoes: toText(raw.canceladoObservacoes),
    canceladoRegistradoEm: raw.canceladoRegistradoEm || '',
    obitoRegistrado: Boolean(raw.obitoRegistrado),
    obitoVeterinario: toText(raw.obitoVeterinario),
    obitoData: toText(raw.obitoData),
    obitoHora: toText(raw.obitoHora),
    obitoISO: combineDateAndTime(raw.obitoData, raw.obitoHora),
    obitoCausa: toText(raw.obitoCausa),
    obitoRelatorio: toText(raw.obitoRelatorio),
    obitoConfirmadoEm: raw.obitoConfirmadoEm || '',
    admissao: raw.admissao || raw.createdAt || '',
    createdAt: raw.createdAt || '',
    updatedAt: raw.updatedAt || '',
    historico,
    prescricoes,
    petPesoAtualizadoEm,
  };
}

function applyInternacaoRecordUpdate(record, dataset, state) {
  if (!record || !record.id) return;
  const isSameRecord = (item) => {
    if (!item) return false;
    if (item.id && item.id === record.id) return true;
    if (item.filterKey && record.filterKey && item.filterKey === record.filterKey) return true;
    if (
      record.codigo !== null &&
      record.codigo !== undefined &&
      item.codigo !== null &&
      item.codigo !== undefined &&
      item.codigo === record.codigo
    ) {
      return true;
    }
    return false;
  };

  if (dataset && Array.isArray(dataset.internacoes)) {
    dataset.internacoes = dataset.internacoes.map((item) => (isSameRecord(item) ? record : item));
  }

  if (state && Array.isArray(state.internacoes)) {
    state.internacoes = state.internacoes.map((item) => (isSameRecord(item) ? record : item));
  }

  if (state?.render && typeof state.render === 'function') {
    state.render();
  }
}

function isSameInternacaoRecord(a, b) {
  if (!a || !b) return false;
  if (a.id && b.id && a.id === b.id) return true;
  if (a.filterKey && b.filterKey && a.filterKey === b.filterKey) return true;
  const aCodigoValido = a.codigo !== null && a.codigo !== undefined;
  const bCodigoValido = b.codigo !== null && b.codigo !== undefined;
  if (aCodigoValido && bCodigoValido && a.codigo === b.codigo) {
    return true;
  }
  return false;
}

function getSharedDatasetRef() {
  return prescricaoModal.dataset || fichaInternacaoModal.dataset || getDataset();
}

function getSharedStateRef() {
  return prescricaoModal.state || fichaInternacaoModal.state || {};
}

function syncInternacaoRecordState(updatedRecord) {
  const normalized = normalizeInternacaoRecord(updatedRecord);
  if (!normalized) return null;
  const datasetRef = getSharedDatasetRef();
  const stateRef = getSharedStateRef();
  applyInternacaoRecordUpdate(normalized, datasetRef, stateRef);
  if (fichaInternacaoModal.record && isSameInternacaoRecord(fichaInternacaoModal.record, normalized)) {
    fichaInternacaoModal.record = normalized;
    fillFichaInternacaoModal(normalized);
  }
  if (prescricaoModal.record && isSameInternacaoRecord(prescricaoModal.record, normalized)) {
    prescricaoModal.record = normalized;
  }
  return normalized;
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

function setObitoModalError(message) {
  if (!obitoModal.errorEl) return;
  const text = String(message || '').trim();
  obitoModal.errorEl.textContent = text;
  obitoModal.errorEl.classList.toggle('hidden', !text);
}

function setObitoModalLoading(isLoading) {
  if (!obitoModal.submitBtn) return;
  if (!obitoModal.submitBtn.dataset.defaultLabel) {
    obitoModal.submitBtn.dataset.defaultLabel = obitoModal.submitBtn.textContent.trim();
  }
  obitoModal.submitBtn.disabled = !!isLoading;
  obitoModal.submitBtn.classList.toggle('opacity-60', !!isLoading);
  obitoModal.submitBtn.textContent = isLoading ? 'Salvando...' : obitoModal.submitBtn.dataset.defaultLabel;
}

function resetObitoModalForm() {
  if (obitoModal.form) {
    obitoModal.form.reset();
  }
  if (obitoModal.confirmInput) {
    obitoModal.confirmInput.checked = false;
  }
}

function setObitoModalPetInfo(info) {
  const normalized = normalizePetInfo(info);
  obitoModal.petInfo = normalized;
  if (!obitoModal.petSummaryEl) return;
  const hasInfo = !!normalized;
  obitoModal.petSummaryEl.classList.toggle('hidden', !hasInfo);
  const petName = normalized?.petNome || 'Paciente';
  const meta = normalized
    ? [normalized.petEspecie, normalized.petRaca, normalized.petPeso || normalized.petIdade].filter(Boolean).join(' · ')
    : '';
  const tutorNome = normalized?.tutorNome || '';
  const tutorContato = [normalized?.tutorDocumento, normalized?.tutorContato]
    .filter(Boolean)
    .join(' · ');
  const tutorLabel = tutorNome && tutorContato ? `${tutorNome} · ${tutorContato}` : tutorNome || tutorContato || 'Tutor não informado';

  if (obitoModal.petSummaryNameEl) obitoModal.petSummaryNameEl.textContent = hasInfo ? petName : 'Paciente';
  if (obitoModal.petSummaryMetaEl) obitoModal.petSummaryMetaEl.textContent = meta || '—';
  if (obitoModal.petSummaryTutorEl) obitoModal.petSummaryTutorEl.textContent = tutorLabel;
  if (obitoModal.confirmLabelEl) {
    const targetName = petName || 'o paciente selecionado';
    obitoModal.confirmLabelEl.textContent = `Confirmo que o animal ${targetName} veio a óbito.`;
  }
}

function fillObitoModalForm(record) {
  if (!obitoModal.form) return;
  const vetSelect = obitoModal.form.querySelector('select[name="obitoVeterinario"]');
  const dateField = obitoModal.form.querySelector('input[name="obitoData"]');
  const timeField = obitoModal.form.querySelector('input[name="obitoHora"]');
  const causaField = obitoModal.form.querySelector('textarea[name="obitoCausa"]');
  const relatorioField = obitoModal.form.querySelector('textarea[name="obitoRelatorio"]');
  const now = new Date();
  const vetValue = record?.obitoVeterinario || record?.veterinario || '';
  if (vetSelect) {
    if (vetValue) {
      ensureSelectOption(vetSelect, { value: vetValue, label: vetValue });
      vetSelect.value = vetValue;
    } else {
      vetSelect.value = '';
    }
  }
  if (dateField) {
    dateField.value = record?.obitoData || getLocalDateInputValue(now) || '';
  }
  if (timeField) {
    timeField.value = record?.obitoHora || getLocalTimeInputValue(now) || '';
  }
  if (causaField) {
    causaField.value = record?.obitoCausa || '';
  }
  if (relatorioField) {
    relatorioField.value = record?.obitoRelatorio || '';
  }
  if (obitoModal.confirmInput) {
    obitoModal.confirmInput.checked = false;
  }
}

function closeObitoModal() {
  if (!obitoModal.overlay) return;
  if (obitoModal.dialog) {
    obitoModal.dialog.classList.add('opacity-0', 'scale-95');
  }
  obitoModal.overlay.classList.add('hidden');
  delete obitoModal.overlay.dataset.modalOpen;
  resetObitoModalForm();
  setObitoModalError('');
  setObitoModalLoading(false);
  setObitoModalPetInfo(null);
  obitoModal.dataset = null;
  obitoModal.state = null;
  obitoModal.onSuccess = null;
  obitoModal.record = null;
  obitoModal.recordId = null;
}

function ensureObitoModal() {
  if (obitoModal.overlay) return obitoModal.overlay;

  const overlay = document.createElement('div');
  overlay.className = 'internacao-obito-modal fixed inset-0 z-[1005] hidden';
  overlay.innerHTML = `
    <div class="absolute inset-0 bg-gray-900/60 backdrop-blur-sm" data-close-modal></div>
    <div class="relative mx-auto flex min-h-full w-full items-start justify-center px-3 py-6 sm:items-center">
      <div class="relative flex w-full max-w-3xl transform-gpu flex-col overflow-hidden rounded-2xl bg-white text-[12px] leading-[1.35] shadow-2xl ring-1 ring-black/10 opacity-0 scale-95 transition-all duration-200" role="dialog" aria-modal="true" aria-labelledby="obito-modal-title" data-obito-dialog tabindex="-1">
        <header class="flex flex-col gap-2.5 border-b border-gray-100 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <span class="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-600">
              <i class="fas fa-heart-pulse"></i>
              Óbito
            </span>
            <h2 id="obito-modal-title" class="mt-1.5 text-lg font-semibold text-gray-900">Registrar óbito</h2>
            <p class="mt-1 max-w-2xl text-[11px] text-gray-600">Confirme os dados clínicos e administrativos do registro.</p>
          </div>
          <button type="button" class="inline-flex items-center justify-center rounded-full border border-gray-200 p-1.5 text-gray-500 transition hover:bg-gray-50 hover:text-gray-700" data-close-modal>
            <span class="sr-only">Fechar modal</span>
            <i class="fas fa-xmark text-sm"></i>
          </button>
        </header>
        <form class="flex max-h-[80vh] flex-col overflow-hidden" novalidate>
          <div class="flex-1 space-y-4 overflow-y-auto px-4 py-4">
            <div class="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-[11px] text-gray-600" data-obito-summary>
              <div class="flex flex-wrap items-center gap-2 text-gray-700">
                <span class="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Paciente</span>
                <span class="text-[13px] font-semibold text-gray-900" data-obito-summary-name>—</span>
                <span class="text-[10px] text-gray-400" data-obito-summary-meta>—</span>
              </div>
              <div class="mt-1 flex flex-wrap items-center gap-2 text-gray-600">
                <span class="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Tutor</span>
                <span data-obito-summary-tutor>—</span>
              </div>
            </div>
            <div class="grid gap-3 md:grid-cols-2">
              <label class="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Veterinário*
                <select name="obitoVeterinario" class="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] font-medium text-gray-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20">
                  <option value="">Selecione</option>
                </select>
              </label>
              <label class="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Data*
                <input type="date" name="obitoData" class="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] font-medium text-gray-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20" />
              </label>
              <label class="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Hora*
                <input type="time" name="obitoHora" class="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] font-medium text-gray-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20" />
              </label>
            </div>
            <label class="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Causa do óbito*
              <textarea name="obitoCausa" rows="3" class="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] text-gray-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20" placeholder="Descreva a causa identificada"></textarea>
            </label>
            <label class="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Relatório do óbito*
              <textarea name="obitoRelatorio" rows="4" class="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] text-gray-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20" placeholder="Detalhe os acontecimentos, procedimentos e responsáveis"></textarea>
            </label>
            <div class="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-[11px] text-amber-900">
              <p class="font-semibold">Atenção</p>
              <p class="mt-1">Ao confirmar o óbito o paciente não receberá novas prescrições ou parâmetros, e todas as pendências ainda não executadas serão canceladas automaticamente.</p>
            </div>
            <label class="inline-flex items-start gap-2 text-[11px] font-medium text-gray-700">
              <input type="checkbox" name="obitoConfirm" class="mt-1 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary" />
              <span data-obito-confirm-label>Confirmo que o animal veio a óbito.</span>
            </label>
            <p class="hidden rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-[11px] text-red-700" data-obito-error></p>
          </div>
          <footer class="flex flex-col gap-3 border-t border-gray-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <span class="text-[11px] text-gray-500">As informações ficam registradas na ficha de internação.</span>
            <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
              <button type="button" class="inline-flex items-center justify-center rounded-lg border border-gray-300 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-gray-700 transition hover:bg-gray-50" data-close-modal>Cancelar</button>
              <button type="submit" class="inline-flex items-center justify-center rounded-lg bg-red-600 px-5 py-2 text-[11px] font-semibold uppercase tracking-wide text-white shadow-sm transition hover:bg-red-500" data-obito-submit>Salvar</button>
            </div>
          </footer>
        </form>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  obitoModal.overlay = overlay;
  obitoModal.dialog = overlay.querySelector('[data-obito-dialog]');
  obitoModal.form = overlay.querySelector('form');
  obitoModal.submitBtn = overlay.querySelector('[data-obito-submit]');
  obitoModal.errorEl = overlay.querySelector('[data-obito-error]');
  obitoModal.petSummaryEl = overlay.querySelector('[data-obito-summary]');
  obitoModal.petSummaryNameEl = overlay.querySelector('[data-obito-summary-name]');
  obitoModal.petSummaryMetaEl = overlay.querySelector('[data-obito-summary-meta]');
  obitoModal.petSummaryTutorEl = overlay.querySelector('[data-obito-summary-tutor]');
  obitoModal.confirmInput = overlay.querySelector('input[name="obitoConfirm"]');
  obitoModal.confirmLabelEl = overlay.querySelector('[data-obito-confirm-label]');

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) {
      closeObitoModal();
      return;
    }
    const closeTrigger = event.target.closest('[data-close-modal]');
    if (closeTrigger) {
      event.preventDefault();
      closeObitoModal();
    }
  });

  overlay.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !overlay.classList.contains('hidden')) {
      event.preventDefault();
      closeObitoModal();
    }
  });

  if (obitoModal.form) {
    obitoModal.form.addEventListener('submit', handleObitoModalSubmit);
  }

  setObitoModalPetInfo(null);

  return overlay;
}

function openObitoModal(record, options = {}) {
  if (!record) return;
  ensureObitoModal();
  const datasetRef = options.dataset || obitoModal.dataset || getDataset();
  const stateRef = options.state || obitoModal.state || {};
  const successHandler =
    typeof options.onSuccess === 'function'
      ? options.onSuccess
      : typeof stateRef?.refreshInternacoes === 'function'
        ? stateRef.refreshInternacoes
        : null;
  const recordId = record.id || '';
  if (!recordId) {
    showToastMessage('Não foi possível identificar essa internação para registrar o óbito.', 'warning');
    return;
  }

  obitoModal.dataset = datasetRef || null;
  obitoModal.state = stateRef || null;
  obitoModal.onSuccess = successHandler || null;
  obitoModal.record = record;
  obitoModal.recordId = recordId;

  setObitoModalError('');
  setObitoModalLoading(false);
  resetObitoModalForm();
  const petInfo = getPetInfoFromInternacaoRecord(record);
  setObitoModalPetInfo(petInfo);

  const selectOverrides = {};
  if (record.obitoVeterinario || record.veterinario) {
    const value = record.obitoVeterinario || record.veterinario;
    selectOverrides.forceObitoVeterinario = { value, label: value };
  }
  populateDynamicSelects(datasetRef, selectOverrides);
  fillObitoModalForm(record);

  obitoModal.overlay.classList.remove('hidden');
  obitoModal.overlay.dataset.modalOpen = 'true';
  if (obitoModal.dialog) {
    requestAnimationFrame(() => {
      obitoModal.dialog.classList.remove('opacity-0', 'scale-95');
      obitoModal.dialog.focus();
    });
  }
}

async function handleObitoModalSubmit(event) {
  event.preventDefault();
  if (!obitoModal.form) return;
  setObitoModalError('');
  const recordId = obitoModal.recordId;
  if (!recordId) {
    setObitoModalError('Não foi possível identificar a internação selecionada.');
    return;
  }

  const formData = new FormData(obitoModal.form);
  const payload = {
    veterinario: (formData.get('obitoVeterinario') || '').toString().trim(),
    data: (formData.get('obitoData') || '').toString().trim(),
    hora: (formData.get('obitoHora') || '').toString().trim(),
    causa: (formData.get('obitoCausa') || '').toString().trim(),
    relatorio: (formData.get('obitoRelatorio') || '').toString().trim(),
  };

  if (!payload.veterinario) {
    setObitoModalError('Informe o veterinário responsável.');
    return;
  }
  if (!payload.data) {
    setObitoModalError('Informe a data do óbito.');
    return;
  }
  if (!payload.hora) {
    setObitoModalError('Informe o horário do óbito.');
    return;
  }
  if (!payload.causa) {
    setObitoModalError('Descreva a causa do óbito.');
    return;
  }
  if (!payload.relatorio) {
    setObitoModalError('Preencha o relatório do óbito.');
    return;
  }
  if (!obitoModal.confirmInput || !obitoModal.confirmInput.checked) {
    setObitoModalError('Confirme que o paciente veio a óbito para continuar.');
    return;
  }

  setObitoModalLoading(true);
  const datasetRef = obitoModal.dataset || getDataset();
  const stateRef = obitoModal.state || {};
  try {
    const updatedRecord = await requestJson(`/internacao/registros/${encodeURIComponent(recordId)}/obito`, {
      method: 'POST',
      body: payload,
    });
    const normalized = normalizeInternacaoRecord(updatedRecord);
    if (normalized) {
      applyInternacaoRecordUpdate(normalized, datasetRef, stateRef);
      const fichaRecord = fichaInternacaoModal.record;
      if (fichaRecord) {
        const sameRecord =
          fichaRecord.id === normalized.id ||
          fichaRecord.filterKey === normalized.filterKey ||
          (normalized.codigo !== null && fichaRecord.codigo === normalized.codigo);
        if (sameRecord) {
          fichaInternacaoModal.record = normalized;
          fillFichaInternacaoModal(normalized);
        }
      }
    }

    let boxesRefreshPromise = null;
    try {
      if (stateRef && typeof stateRef.refreshBoxes === 'function') {
        boxesRefreshPromise = Promise.resolve(stateRef.refreshBoxes());
      } else if (datasetRef) {
        boxesRefreshPromise = fetchBoxesData(datasetRef, stateRef, { quiet: true });
      }
    } catch (refreshError) {
      console.warn('internacao: falha ao agendar atualização dos boxes após óbito', refreshError);
    }

    showToastMessage('Óbito registrado com sucesso.', 'success');
    const successCallback = obitoModal.onSuccess;
    closeObitoModal();

    if (boxesRefreshPromise && typeof boxesRefreshPromise.catch === 'function') {
      boxesRefreshPromise.catch((error) => {
        console.warn('internacao: falha ao atualizar boxes após óbito', error);
      });
    }

    if (typeof successCallback === 'function') {
      successCallback();
    }
  } catch (error) {
    console.error('internacao: falha ao registrar óbito', error);
    setObitoModalError(error.message || 'Não foi possível registrar o óbito.');
  } finally {
    setObitoModalLoading(false);
  }
}

function setOcorrenciaModalError(message) {
  if (!ocorrenciaModal.errorEl) return;
  const text = String(message || '').trim();
  ocorrenciaModal.errorEl.textContent = text;
  ocorrenciaModal.errorEl.classList.toggle('hidden', !text);
}

function setOcorrenciaModalLoading(isLoading) {
  if (!ocorrenciaModal.submitBtn) return;
  if (!ocorrenciaModal.submitBtn.dataset.defaultLabel) {
    ocorrenciaModal.submitBtn.dataset.defaultLabel = ocorrenciaModal.submitBtn.textContent.trim();
  }
  ocorrenciaModal.submitBtn.disabled = !!isLoading;
  ocorrenciaModal.submitBtn.classList.toggle('opacity-60', !!isLoading);
  ocorrenciaModal.submitBtn.textContent = isLoading
    ? 'Salvando...'
    : ocorrenciaModal.submitBtn.dataset.defaultLabel;
}

function resetOcorrenciaModalForm() {
  if (ocorrenciaModal.form) {
    ocorrenciaModal.form.reset();
  }
}

function setOcorrenciaModalPetInfo(info) {
  const normalized = normalizePetInfo(info);
  ocorrenciaModal.petInfo = normalized;
  if (!ocorrenciaModal.petSummaryEl) return;
  const hasInfo = !!normalized;
  ocorrenciaModal.petSummaryEl.classList.toggle('hidden', !hasInfo);
  const petName = normalized?.petNome || 'Paciente';
  const meta = normalized
    ? [normalized.petEspecie, normalized.petRaca, normalized.petPeso || normalized.petIdade].filter(Boolean).join(' · ')
    : '';
  const tutorNome = normalized?.tutorNome || '';
  const tutorContato = [normalized?.tutorDocumento, normalized?.tutorContato]
    .filter(Boolean)
    .join(' · ');
  const tutorLabel = tutorNome && tutorContato ? `${tutorNome} · ${tutorContato}` : tutorNome || tutorContato || 'Tutor não informado';

  if (ocorrenciaModal.petSummaryNameEl) ocorrenciaModal.petSummaryNameEl.textContent = hasInfo ? petName : 'Paciente';
  if (ocorrenciaModal.petSummaryMetaEl) ocorrenciaModal.petSummaryMetaEl.textContent = meta || '—';
  if (ocorrenciaModal.petSummaryTutorEl) ocorrenciaModal.petSummaryTutorEl.textContent = tutorLabel;
}

function fillOcorrenciaModalForm(record) {
  if (!ocorrenciaModal.form) return;
  const dateField = ocorrenciaModal.form.querySelector('input[name="ocorrenciaData"]');
  const timeField = ocorrenciaModal.form.querySelector('input[name="ocorrenciaHora"]');
  const resumoField = ocorrenciaModal.form.querySelector('input[name="ocorrenciaResumo"]');
  const descricaoField = ocorrenciaModal.form.querySelector('textarea[name="ocorrenciaDescricao"]');
  const now = new Date();
  if (dateField) {
    dateField.value = getLocalDateInputValue(now);
  }
  if (timeField) {
    timeField.value = getLocalTimeInputValue(now);
  }
  if (resumoField) resumoField.value = '';
  if (descricaoField) descricaoField.value = '';
}

function closeOcorrenciaModal() {
  const onClose = ocorrenciaModal.onClose;
  if (!ocorrenciaModal.overlay) return;
  ocorrenciaModal.overlay.classList.add('hidden');
  ocorrenciaModal.overlay.dataset.modalOpen = 'false';
  if (ocorrenciaModal.dialog) {
    ocorrenciaModal.dialog.classList.add('opacity-0', 'scale-95');
  }
  ocorrenciaModal.record = null;
  ocorrenciaModal.recordId = null;
  ocorrenciaModal.dataset = null;
  ocorrenciaModal.state = null;
  ocorrenciaModal.onSuccess = null;
  ocorrenciaModal.petInfo = null;
  ocorrenciaModal.onClose = null;

  if (typeof onClose === 'function') {
    try {
      onClose();
    } catch (error) {
      console.warn('internacao: falha ao acionar callback de fechamento da ocorrência', error);
    }
  }
}

function ensureOcorrenciaModal() {
  if (ocorrenciaModal.overlay) return ocorrenciaModal.overlay;

  const overlay = document.createElement('div');
  overlay.className = 'internacao-ocorrencia-modal fixed inset-0 z-[1004] hidden';
  overlay.innerHTML = `
    <div class="absolute inset-0 bg-gray-900/60 backdrop-blur-sm" data-close-modal></div>
    <div class="relative mx-auto flex min-h-full w-full items-start justify-center px-3 py-6 sm:items-center">
      <div class="relative flex w-full max-w-3xl transform-gpu flex-col overflow-hidden rounded-2xl bg-white text-[12px] leading-[1.35] shadow-2xl ring-1 ring-black/10 opacity-0 scale-95 transition-all duration-200" role="dialog" aria-modal="true" aria-labelledby="ocorrencia-modal-title" data-ocorrencia-dialog tabindex="-1">
        <header class="flex flex-col gap-2.5 border-b border-gray-100 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <span class="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
              <i class="fas fa-triangle-exclamation"></i>
              Ocorrência
            </span>
            <h2 id="ocorrencia-modal-title" class="mt-1.5 text-lg font-semibold text-gray-900">Registrar ocorrência</h2>
            <p class="mt-1 max-w-3xl text-[11px] text-gray-600">Registre rapidamente ocorrências que sejam relevantes relatar ao Veterinário para ajuda-lo na criação do relatório médico.</p>
          </div>
          <button type="button" class="inline-flex items-center justify-center rounded-full border border-gray-200 p-1.5 text-gray-500 transition hover:bg-gray-50 hover:text-gray-700" data-close-modal>
            <span class="sr-only">Fechar modal</span>
            <i class="fas fa-xmark text-sm"></i>
          </button>
        </header>
        <form class="flex max-h-[80vh] flex-col overflow-hidden" novalidate>
          <div class="flex-1 space-y-4 overflow-y-auto px-4 py-4">
            <div class="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-[11px] text-gray-600" data-ocorrencia-summary>
              <div class="flex flex-wrap items-center gap-2 text-gray-700">
                <span class="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Paciente</span>
                <span class="text-[13px] font-semibold text-gray-900" data-ocorrencia-summary-name>—</span>
                <span class="text-[10px] text-gray-400" data-ocorrencia-summary-meta>—</span>
              </div>
              <div class="mt-1 flex flex-wrap items-center gap-2 text-gray-600">
                <span class="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Tutor</span>
                <span data-ocorrencia-summary-tutor>—</span>
              </div>
            </div>
            <div class="grid gap-3 md:grid-cols-2">
              <label class="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Data*
                <input type="date" name="ocorrenciaData" class="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] font-medium text-gray-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20" />
              </label>
              <label class="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Hora*
                <input type="time" name="ocorrenciaHora" class="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] font-medium text-gray-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20" />
              </label>
            </div>
            <label class="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Resumo*
              <input type="text" name="ocorrenciaResumo" class="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] text-gray-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20" placeholder="Título rápido da ocorrência" />
            </label>
            <label class="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Descrição*
              <textarea name="ocorrenciaDescricao" rows="4" class="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] text-gray-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20" placeholder="Detalhe o ocorrido para ajudar o veterinário na análise"></textarea>
            </label>
            <p class="hidden rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-[11px] text-red-700" data-ocorrencia-error></p>
          </div>
          <footer class="flex flex-col gap-3 border-t border-gray-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <span class="text-[11px] text-gray-500">A ocorrência fica registrada no histórico da internação.</span>
            <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
              <button type="button" class="inline-flex items-center justify-center rounded-lg border border-gray-300 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-gray-700 transition hover:bg-gray-50" data-close-modal>Cancelar</button>
              <button type="submit" class="inline-flex items-center justify-center rounded-lg bg-primary px-5 py-2 text-[11px] font-semibold uppercase tracking-wide text-white shadow-sm transition hover:bg-primary/90" data-ocorrencia-submit>Salvar</button>
            </div>
          </footer>
        </form>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  ocorrenciaModal.overlay = overlay;
  ocorrenciaModal.dialog = overlay.querySelector('[data-ocorrencia-dialog]');
  ocorrenciaModal.form = overlay.querySelector('form');
  ocorrenciaModal.submitBtn = overlay.querySelector('[data-ocorrencia-submit]');
  ocorrenciaModal.errorEl = overlay.querySelector('[data-ocorrencia-error]');
  ocorrenciaModal.petSummaryEl = overlay.querySelector('[data-ocorrencia-summary]');
  ocorrenciaModal.petSummaryNameEl = overlay.querySelector('[data-ocorrencia-summary-name]');
  ocorrenciaModal.petSummaryMetaEl = overlay.querySelector('[data-ocorrencia-summary-meta]');
  ocorrenciaModal.petSummaryTutorEl = overlay.querySelector('[data-ocorrencia-summary-tutor]');

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) {
      closeOcorrenciaModal();
      return;
    }
    const closeTrigger = event.target.closest('[data-close-modal]');
    if (closeTrigger) {
      event.preventDefault();
      closeOcorrenciaModal();
    }
  });

  overlay.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !overlay.classList.contains('hidden')) {
      event.preventDefault();
      closeOcorrenciaModal();
    }
  });

  if (ocorrenciaModal.form) {
    ocorrenciaModal.form.addEventListener('submit', handleOcorrenciaModalSubmit);
  }

  setOcorrenciaModalPetInfo(null);

  return overlay;
}

function openOcorrenciaModal(record, options = {}) {
  if (!record) return;
  ensureOcorrenciaModal();
  const datasetRef = options.dataset || ocorrenciaModal.dataset || getDataset();
  const stateRef = options.state || ocorrenciaModal.state || {};
  const successHandler =
    typeof options.onSuccess === 'function'
      ? options.onSuccess
      : typeof stateRef?.refreshInternacoes === 'function'
        ? stateRef.refreshInternacoes
        : null;
  const recordId = record.id || '';
  if (!recordId) {
    showToastMessage('Não foi possível identificar essa internação para registrar a ocorrência.', 'warning');
    return;
  }

  ocorrenciaModal.dataset = datasetRef || null;
  ocorrenciaModal.state = stateRef || null;
  ocorrenciaModal.onSuccess = successHandler || null;
  ocorrenciaModal.onClose = typeof options.onClose === 'function' ? options.onClose : null;
  ocorrenciaModal.record = record;
  ocorrenciaModal.recordId = recordId;

  setOcorrenciaModalError('');
  setOcorrenciaModalLoading(false);
  resetOcorrenciaModalForm();
  const petInfo = getPetInfoFromInternacaoRecord(record);
  setOcorrenciaModalPetInfo(petInfo);
  fillOcorrenciaModalForm(record);

  ocorrenciaModal.overlay.classList.remove('hidden');
  ocorrenciaModal.overlay.dataset.modalOpen = 'true';
  if (ocorrenciaModal.dialog) {
    requestAnimationFrame(() => {
      ocorrenciaModal.dialog.classList.remove('opacity-0', 'scale-95');
      ocorrenciaModal.dialog.focus();
    });
  }
}

async function handleOcorrenciaModalSubmit(event) {
  event.preventDefault();
  if (!ocorrenciaModal.form) return;
  setOcorrenciaModalError('');
  const recordId = ocorrenciaModal.recordId;
  if (!recordId) {
    setOcorrenciaModalError('Não foi possível identificar a internação selecionada.');
    return;
  }

  const formData = new FormData(ocorrenciaModal.form);
  const payload = {
    data: (formData.get('ocorrenciaData') || '').toString().trim(),
    hora: (formData.get('ocorrenciaHora') || '').toString().trim(),
    resumo: (formData.get('ocorrenciaResumo') || '').toString().trim(),
    descricao: (formData.get('ocorrenciaDescricao') || '').toString().trim(),
  };

  if (!payload.data) {
    setOcorrenciaModalError('Informe a data da ocorrência.');
    return;
  }
  if (!payload.hora) {
    setOcorrenciaModalError('Informe o horário da ocorrência.');
    return;
  }
  if (!payload.resumo) {
    setOcorrenciaModalError('Preencha um resumo para a ocorrência.');
    return;
  }
  if (!payload.descricao) {
    setOcorrenciaModalError('Descreva a ocorrência antes de salvar.');
    return;
  }

  setOcorrenciaModalLoading(true);
  const datasetRef = ocorrenciaModal.dataset || getDataset();
  const stateRef = ocorrenciaModal.state || {};
  try {
    const updatedRecord = await requestJson(`/internacao/registros/${encodeURIComponent(recordId)}/ocorrencias`, {
      method: 'POST',
      body: payload,
    });
    const normalized = normalizeInternacaoRecord(updatedRecord);
    if (normalized) {
      applyInternacaoRecordUpdate(normalized, datasetRef, stateRef);
      const fichaRecord = fichaInternacaoModal.record;
      if (fichaRecord) {
        const sameRecord =
          fichaRecord.id === normalized.id ||
          fichaRecord.filterKey === normalized.filterKey ||
          (normalized.codigo !== null && fichaRecord.codigo === normalized.codigo);
        if (sameRecord) {
          fichaInternacaoModal.record = normalized;
          fillFichaInternacaoModal(normalized);
        }
      }
    }

    showToastMessage('Ocorrência registrada com sucesso.', 'success');
    const successCallback = ocorrenciaModal.onSuccess;
    closeOcorrenciaModal();

    if (typeof successCallback === 'function') {
      successCallback();
    }
  } catch (error) {
    console.error('internacao: falha ao salvar ocorrência', error);
    setOcorrenciaModalError(error.message || 'Não foi possível registrar a ocorrência.');
  } finally {
    setOcorrenciaModalLoading(false);
  }
}

function setCancelarModalError(message) {
  if (!cancelarModal.errorEl) return;
  const text = String(message || '').trim();
  cancelarModal.errorEl.textContent = text;
  cancelarModal.errorEl.classList.toggle('hidden', !text);
}

function setCancelarModalLoading(isLoading) {
  if (!cancelarModal.submitBtn) return;
  if (!cancelarModal.submitBtn.dataset.defaultLabel) {
    cancelarModal.submitBtn.dataset.defaultLabel = cancelarModal.submitBtn.textContent.trim();
  }
  cancelarModal.submitBtn.disabled = !!isLoading;
  cancelarModal.submitBtn.classList.toggle('opacity-60', !!isLoading);
  cancelarModal.submitBtn.textContent = isLoading
    ? 'Salvando...'
    : cancelarModal.submitBtn.dataset.defaultLabel;
}

function resetCancelarModalForm() {
  if (cancelarModal.form) {
    cancelarModal.form.reset();
  }
}

function setCancelarModalPetInfo(info) {
  const normalized = normalizePetInfo(info);
  cancelarModal.petInfo = normalized;
  const hasInfo = !!normalized;
  const metaParts = hasInfo ? [normalized.petEspecie, normalized.petRaca, normalized.petPeso].filter(Boolean) : [];
  const tutorParts = hasInfo
    ? [normalized.tutorNome, normalized.tutorContato, normalized.tutorDocumento].filter(Boolean)
    : [];
  if (cancelarModal.petSummaryEl) {
    cancelarModal.petSummaryEl.classList.toggle('hidden', !hasInfo);
  }
  if (cancelarModal.petSummaryNameEl) {
    cancelarModal.petSummaryNameEl.textContent = hasInfo ? normalized.petNome || 'Paciente' : 'Paciente';
  }
  if (cancelarModal.petSummaryMetaEl) {
    cancelarModal.petSummaryMetaEl.textContent = hasInfo && metaParts.length ? metaParts.join(' · ') : '—';
  }
  if (cancelarModal.petSummaryTutorEl) {
    cancelarModal.petSummaryTutorEl.textContent = tutorParts.length ? tutorParts.join(' · ') : '—';
  }
}

function fillCancelarModalForm(record) {
  if (!cancelarModal.form) return;
  const now = new Date();
  const responsavelField = cancelarModal.form.querySelector('input[name="cancelResponsavel"]');
  const dataField = cancelarModal.form.querySelector('input[name="cancelData"]');
  const horaField = cancelarModal.form.querySelector('input[name="cancelHora"]');
  const justificativaField = cancelarModal.form.querySelector('textarea[name="cancelJustificativa"]');
  const observacoesField = cancelarModal.form.querySelector('textarea[name="cancelObservacoes"]');

  if (responsavelField) {
    responsavelField.value = record?.canceladoResponsavel || record?.veterinario || '';
  }
  if (dataField) {
    dataField.value = record?.canceladoData || getLocalDateInputValue(now) || '';
  }
  if (horaField) {
    horaField.value = record?.canceladoHora || getLocalTimeInputValue(now) || '';
  }
  if (justificativaField) {
    justificativaField.value = record?.canceladoJustificativa || '';
  }
  if (observacoesField) {
    observacoesField.value = record?.canceladoObservacoes || '';
  }
}

function closeCancelarModal() {
  if (!cancelarModal.overlay) return;
  if (cancelarModal.dialog) {
    cancelarModal.dialog.classList.add('opacity-0', 'scale-95');
  }
  cancelarModal.overlay.classList.add('hidden');
  cancelarModal.overlay.removeAttribute('data-modal-open');
  resetCancelarModalForm();
  setCancelarModalError('');
  setCancelarModalLoading(false);
  setCancelarModalPetInfo(null);
  cancelarModal.dataset = null;
  cancelarModal.state = null;
  cancelarModal.onSuccess = null;
  cancelarModal.record = null;
  cancelarModal.recordId = null;
}

function ensureCancelarModal() {
  if (cancelarModal.overlay) return cancelarModal.overlay;

  const overlay = document.createElement('div');
  overlay.className = 'internacao-cancelar-modal fixed inset-0 z-[1005] hidden';
  overlay.innerHTML = `
    <div class="absolute inset-0 bg-gray-900/60 backdrop-blur-sm" data-close-cancel-modal></div>
    <div class="relative mx-auto flex min-h-full w-full items-start justify-center px-3 py-6 sm:items-center">
      <div
        class="relative flex w-full max-w-3xl transform-gpu flex-col overflow-hidden rounded-2xl bg-white text-[12px] leading-[1.35] text-gray-700 shadow-2xl ring-1 ring-black/10 opacity-0 scale-95 transition-all duration-200"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cancelar-modal-title"
        data-cancel-dialog
        tabindex="-1"
      >
        <header class="flex flex-col gap-2.5 border-b border-gray-100 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <span class="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
              <i class="fas fa-ban"></i>
              Cancelamento
            </span>
            <h2 id="cancelar-modal-title" class="mt-1.5 text-lg font-semibold text-gray-900">Cancelar internação</h2>
            <p class="mt-1 text-[11px] text-gray-600">Revise o motivo do cancelamento antes de confirmar.</p>
          </div>
          <button type="button" class="inline-flex items-center justify-center rounded-full border border-gray-200 p-1.5 text-gray-500 transition hover:bg-gray-50 hover:text-gray-700" data-close-cancel-modal>
            <span class="sr-only">Fechar modal</span>
            <i class="fas fa-xmark text-sm"></i>
          </button>
        </header>
        <form class="flex max-h-[80vh] flex-col overflow-hidden" novalidate>
          <div class="flex-1 space-y-4 overflow-y-auto px-4 py-4">
            <div class="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-[11px] text-gray-600" data-cancel-summary>
              <div class="flex flex-wrap items-center gap-2 text-gray-700">
                <span class="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Paciente</span>
                <span class="text-[13px] font-semibold text-gray-900" data-cancel-summary-name>—</span>
                <span class="text-[10px] text-gray-400" data-cancel-summary-meta>—</span>
              </div>
              <p class="mt-1 text-[11px] text-gray-500" data-cancel-summary-tutor>—</p>
            </div>
            <div class="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-[11px] text-amber-900">
              <p class="font-semibold">Atenção</p>
              <p class="mt-1">Ao cancelar você encerra a internação com status de cancelada, interrompe prescrições futuras e libera o box ocupado.</p>
            </div>
            <label class="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Responsável*
              <input type="text" name="cancelResponsavel" class="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] font-medium text-gray-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20" placeholder="Nome do responsável" />
            </label>
            <div class="grid gap-3 md:grid-cols-2">
              <label class="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Data*
                <input type="date" name="cancelData" class="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] font-medium text-gray-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20" />
              </label>
              <label class="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Hora*
                <input type="time" name="cancelHora" class="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] font-medium text-gray-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20" />
              </label>
            </div>
            <label class="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Justificativa*
              <textarea name="cancelJustificativa" rows="3" class="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] text-gray-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20" placeholder="Descreva o motivo do cancelamento"></textarea>
            </label>
            <label class="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Observações
              <textarea name="cancelObservacoes" rows="3" class="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] text-gray-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20" placeholder="Informe detalhes adicionais, se necessário"></textarea>
            </label>
            <p class="hidden rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-[11px] text-red-700" data-cancel-error></p>
          </div>
          <footer class="flex flex-col gap-3 border-t border-gray-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <span class="text-[11px] text-gray-500">O histórico completo fica disponível na ficha de internação.</span>
            <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
              <button type="button" class="inline-flex items-center justify-center rounded-lg border border-gray-300 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-gray-700 transition hover:bg-gray-50" data-close-cancel-modal>Cancelar</button>
              <button type="submit" class="inline-flex items-center justify-center rounded-lg bg-amber-600 px-5 py-2 text-[11px] font-semibold uppercase tracking-wide text-white shadow-sm transition hover:bg-amber-500" data-cancel-submit>Salvar</button>
            </div>
          </footer>
        </form>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  cancelarModal.overlay = overlay;
  cancelarModal.dialog = overlay.querySelector('[data-cancel-dialog]');
  cancelarModal.form = overlay.querySelector('form');
  cancelarModal.submitBtn = overlay.querySelector('[data-cancel-submit]');
  cancelarModal.errorEl = overlay.querySelector('[data-cancel-error]');
  cancelarModal.petSummaryEl = overlay.querySelector('[data-cancel-summary]');
  cancelarModal.petSummaryNameEl = overlay.querySelector('[data-cancel-summary-name]');
  cancelarModal.petSummaryMetaEl = overlay.querySelector('[data-cancel-summary-meta]');
  cancelarModal.petSummaryTutorEl = overlay.querySelector('[data-cancel-summary-tutor]');

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) {
      closeCancelarModal();
      return;
    }
    const closeTrigger = event.target.closest('[data-close-cancel-modal]');
    if (closeTrigger) {
      event.preventDefault();
      closeCancelarModal();
    }
  });

  overlay.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !overlay.classList.contains('hidden')) {
      event.preventDefault();
      closeCancelarModal();
    }
  });

  if (cancelarModal.form) {
    cancelarModal.form.addEventListener('submit', handleCancelarModalSubmit);
  }

  return overlay;
}

function openCancelarModal(record, options = {}) {
  if (!record) {
    showToastMessage('Não foi possível carregar essa internação.', 'warning');
    return;
  }
  ensureCancelarModal();
  const datasetRef = options.dataset || cancelarModal.dataset || getDataset();
  const stateRef = options.state || cancelarModal.state || {};
  const successHandler = options.onSuccess || cancelarModal.onSuccess;
  const recordId = record.id || record._id || '';
  if (!recordId) {
    showToastMessage('Não foi possível identificar essa internação para cancelar.', 'warning');
    return;
  }

  cancelarModal.dataset = datasetRef || null;
  cancelarModal.state = stateRef || null;
  cancelarModal.onSuccess = successHandler || null;
  cancelarModal.record = record;
  cancelarModal.recordId = recordId;

  setCancelarModalError('');
  setCancelarModalLoading(false);
  resetCancelarModalForm();
  setCancelarModalPetInfo(getPetInfoFromInternacaoRecord(record));
  fillCancelarModalForm(record);

  cancelarModal.overlay.classList.remove('hidden');
  cancelarModal.overlay.dataset.modalOpen = 'true';
  if (cancelarModal.dialog) {
    requestAnimationFrame(() => {
      cancelarModal.dialog.classList.remove('opacity-0', 'scale-95');
      cancelarModal.dialog.focus();
    });
  }
}

async function handleCancelarModalSubmit(event) {
  event.preventDefault();
  if (!cancelarModal.form) return;
  setCancelarModalError('');
  const recordId = cancelarModal.recordId;
  if (!recordId) {
    setCancelarModalError('Não foi possível identificar a internação selecionada.');
    return;
  }

  const formData = new FormData(cancelarModal.form);
  const payload = {
    responsavel: (formData.get('cancelResponsavel') || '').toString().trim(),
    data: (formData.get('cancelData') || '').toString().trim(),
    hora: (formData.get('cancelHora') || '').toString().trim(),
    justificativa: (formData.get('cancelJustificativa') || '').toString().trim(),
    observacoes: (formData.get('cancelObservacoes') || '').toString().trim(),
  };

  if (!payload.responsavel) {
    setCancelarModalError('Informe o responsável pelo cancelamento.');
    return;
  }
  if (!payload.data) {
    setCancelarModalError('Informe a data do cancelamento.');
    return;
  }
  if (!payload.hora) {
    setCancelarModalError('Informe o horário do cancelamento.');
    return;
  }
  if (!payload.justificativa) {
    setCancelarModalError('Descreva a justificativa do cancelamento.');
    return;
  }

  setCancelarModalLoading(true);
  const datasetRef = cancelarModal.dataset || getDataset();
  const stateRef = cancelarModal.state || {};
  try {
    const updatedRecord = await requestJson(`/internacao/registros/${encodeURIComponent(recordId)}/cancelar`, {
      method: 'POST',
      body: payload,
    });
    const normalized = normalizeInternacaoRecord(updatedRecord);
    if (normalized) {
      applyInternacaoRecordUpdate(normalized, datasetRef, stateRef);
      const fichaRecord = fichaInternacaoModal.record;
      if (fichaRecord) {
        const sameRecord =
          fichaRecord.id === normalized.id ||
          fichaRecord.filterKey === normalized.filterKey ||
          (normalized.codigo !== null && fichaRecord.codigo === normalized.codigo);
        if (sameRecord) {
          fichaInternacaoModal.record = normalized;
          fillFichaInternacaoModal(normalized);
        }
      }
    }

    let boxesRefreshPromise = null;
    try {
      if (stateRef && typeof stateRef.refreshBoxes === 'function') {
        boxesRefreshPromise = Promise.resolve(stateRef.refreshBoxes());
      } else if (datasetRef) {
        boxesRefreshPromise = fetchBoxesData(datasetRef, stateRef, { quiet: true });
      }
    } catch (refreshError) {
      console.warn('internacao: falha ao agendar atualização dos boxes após cancelamento', refreshError);
    }

    showToastMessage('Internação cancelada com sucesso.', 'success');
    const successCallback = cancelarModal.onSuccess;
    closeCancelarModal();

    if (boxesRefreshPromise && typeof boxesRefreshPromise.catch === 'function') {
      boxesRefreshPromise.catch((error) => {
        console.warn('internacao: falha ao atualizar boxes após cancelamento', error);
      });
    }

    if (typeof successCallback === 'function') {
      successCallback();
    }
  } catch (error) {
    console.error('internacao: falha ao cancelar internação', error);
    setCancelarModalError(error.message || 'Não foi possível cancelar a internação.');
  } finally {
    setCancelarModalLoading(false);
  }
}

function setMoverBoxModalError(message) {
  if (!moverBoxModal.errorEl) return;
  const text = String(message || '').trim();
  moverBoxModal.errorEl.textContent = text;
  moverBoxModal.errorEl.classList.toggle('hidden', !text);
}

function setMoverBoxModalLoading(isLoading) {
  if (!moverBoxModal.submitBtn) return;
  if (!moverBoxModal.submitBtn.dataset.defaultLabel) {
    moverBoxModal.submitBtn.dataset.defaultLabel = moverBoxModal.submitBtn.textContent.trim();
  }
  moverBoxModal.submitBtn.disabled = !!isLoading;
  moverBoxModal.submitBtn.classList.toggle('opacity-60', !!isLoading);
  moverBoxModal.submitBtn.textContent = isLoading
    ? 'Salvando...'
    : moverBoxModal.submitBtn.dataset.defaultLabel;
}

function resetMoverBoxModalForm() {
  if (moverBoxModal.form) {
    moverBoxModal.form.reset();
  }
}

function setMoverBoxModalPetInfo(info) {
  const normalized = normalizePetInfo(info);
  moverBoxModal.petInfo = normalized;
  const hasInfo = !!normalized;
  const metaParts = hasInfo ? [normalized.petEspecie, normalized.petRaca, normalized.petPeso].filter(Boolean) : [];
  const tutorParts = hasInfo
    ? [normalized.tutorNome, normalized.tutorContato, normalized.tutorDocumento].filter(Boolean)
    : [];

  if (moverBoxModal.petSummaryEl) {
    moverBoxModal.petSummaryEl.classList.toggle('hidden', !hasInfo);
  }
  if (moverBoxModal.petSummaryNameEl) {
    moverBoxModal.petSummaryNameEl.textContent = hasInfo ? normalized.petNome || 'Paciente' : 'Paciente';
  }
  if (moverBoxModal.petSummaryMetaEl) {
    moverBoxModal.petSummaryMetaEl.textContent = metaParts.length ? metaParts.join(' · ') : '—';
  }
  if (moverBoxModal.petSummaryTutorEl) {
    moverBoxModal.petSummaryTutorEl.textContent = tutorParts.length ? tutorParts.join(' · ') : '—';
  }
}

function updateMoverBoxOptions(record, dataset) {
  if (!moverBoxModal.selectEl) return;
  const boxes = Array.isArray(dataset?.boxes) ? dataset.boxes : [];
  const currentValue = typeof record?.box === 'string' ? record.box.trim() : '';
  const available = boxes.filter((box) => isBoxAvailable(box));
  const seen = new Set(['']);
  const options = [{ value: '', label: 'Não atribuído' }];
  const sorted = available
    .slice()
    .sort((a, b) => a.box.localeCompare(b.box, 'pt-BR', { numeric: true, sensitivity: 'base' }));
  sorted.forEach((box) => {
    const value = box.box;
    if (!value || seen.has(value)) return;
    const detail = box.especialidade ? ` · ${box.especialidade}` : '';
    options.push({ value, label: `${value}${detail}` });
    seen.add(value);
  });

  if (currentValue) {
    if (!seen.has(currentValue)) {
      options.push({ value: currentValue, label: `${currentValue} (atual)` });
      seen.add(currentValue);
    } else {
      options.forEach((option) => {
        if (option.value === currentValue) {
          option.label = `${option.label} (atual)`;
        }
      });
    }
  }

  moverBoxModal.selectEl.innerHTML = options
    .map((option) => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`)
    .join('');
  moverBoxModal.selectEl.value = currentValue || '';

  if (moverBoxModal.noOptionsEl) {
    moverBoxModal.noOptionsEl.classList.toggle('hidden', sorted.length > 0);
  }
}

function ensureMoverBoxModal() {
  if (moverBoxModal.overlay) return moverBoxModal.overlay;

  const overlay = document.createElement('div');
  overlay.className = 'mover-box-modal fixed inset-0 z-[1000] hidden';
  overlay.innerHTML = `
    <div class="absolute inset-0 bg-gray-900/60 backdrop-blur-sm" data-close-modal></div>
    <div class="relative mx-auto flex min-h-full w-full items-start justify-center px-3 py-6 sm:items-center">
      <div
        class="relative flex w-full max-w-xl transform-gpu flex-col overflow-hidden rounded-2xl bg-white text-[12px] leading-[1.35] text-gray-700 shadow-2xl opacity-0 transition-all duration-200 ease-out scale-95"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mover-box-title"
        data-mover-box-dialog
        tabindex="-1"
      >
        <header class="flex items-start justify-between border-b border-gray-100 px-4 py-3">
          <div>
            <span class="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
              <i class="fas fa-box"></i>
              Ajustar box
            </span>
            <h2 id="mover-box-title" class="mt-1 text-lg font-semibold text-gray-900">Mover paciente de box</h2>
            <p class="text-[11px] text-gray-500">Selecione o destino do paciente internado.</p>
          </div>
          <button type="button" class="inline-flex items-center justify-center rounded-full border border-gray-200 p-1.5 text-gray-500 transition hover:bg-gray-50 hover:text-gray-700" data-close-modal>
            <span class="sr-only">Fechar modal</span>
            <i class="fas fa-xmark text-sm"></i>
          </button>
        </header>
        <form class="flex flex-col" novalidate>
          <div class="space-y-4 px-4 py-4">
            <div class="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-[11px] text-gray-600" data-mover-box-summary>
              <div class="flex flex-wrap items-center gap-2 text-gray-700">
                <span class="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Paciente</span>
                <span class="text-[13px] font-semibold text-gray-900" data-mover-box-summary-name>Paciente</span>
                <span class="text-[10px] text-gray-400" data-mover-box-summary-meta>—</span>
              </div>
              <p class="mt-1 text-[11px] text-gray-500" data-mover-box-summary-tutor>—</p>
            </div>
            <div class="rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
              <p class="font-semibold">O que posso fazer aqui?</p>
              <p class="mt-1">Você pode mover o paciente para outro box disponível ou definir que ele ainda não possui box atribuído.</p>
            </div>
            <label class="block text-[11px] font-semibold uppercase tracking-wide text-gray-600">Destino
              <select name="moverBoxDestino" class="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] font-medium text-gray-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20">
                <option value="">Carregando opções...</option>
              </select>
            </label>
            <p class="hidden rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-[11px] text-gray-600" data-mover-box-empty>
              Nenhum box livre no momento. É possível manter o paciente sem box selecionando "Não atribuído".
            </p>
            <p class="hidden rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-[11px] text-red-700" data-mover-box-error></p>
          </div>
          <footer class="flex flex-col gap-3 border-t border-gray-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <span class="text-[11px] text-gray-500">A movimentação fica registrada no histórico da internação.</span>
            <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
              <button type="button" class="inline-flex items-center justify-center rounded-lg border border-gray-300 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-gray-700 transition hover:bg-gray-50" data-close-modal>Cancelar</button>
              <button type="submit" class="inline-flex items-center justify-center rounded-lg bg-primary px-5 py-2 text-[11px] font-semibold uppercase tracking-wide text-white shadow-sm transition hover:bg-primary/90" data-mover-box-submit>Salvar</button>
            </div>
          </footer>
        </form>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  moverBoxModal.overlay = overlay;
  moverBoxModal.dialog = overlay.querySelector('[data-mover-box-dialog]');
  moverBoxModal.form = overlay.querySelector('form');
  moverBoxModal.submitBtn = overlay.querySelector('[data-mover-box-submit]');
  moverBoxModal.errorEl = overlay.querySelector('[data-mover-box-error]');
  moverBoxModal.selectEl = overlay.querySelector('select[name="moverBoxDestino"]');
  moverBoxModal.noOptionsEl = overlay.querySelector('[data-mover-box-empty]');
  moverBoxModal.petSummaryEl = overlay.querySelector('[data-mover-box-summary]');
  moverBoxModal.petSummaryNameEl = overlay.querySelector('[data-mover-box-summary-name]');
  moverBoxModal.petSummaryMetaEl = overlay.querySelector('[data-mover-box-summary-meta]');
  moverBoxModal.petSummaryTutorEl = overlay.querySelector('[data-mover-box-summary-tutor]');

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) {
      closeMoverBoxModal();
      return;
    }
    const closeTrigger = event.target.closest('[data-close-modal]');
    if (closeTrigger) {
      event.preventDefault();
      closeMoverBoxModal();
    }
  });

  overlay.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !overlay.classList.contains('hidden')) {
      event.preventDefault();
      closeMoverBoxModal();
    }
  });

  if (moverBoxModal.form) {
    moverBoxModal.form.addEventListener('submit', handleMoverBoxModalSubmit);
  }

  setMoverBoxModalPetInfo(null);

  return overlay;
}

function closeMoverBoxModal() {
  if (!moverBoxModal.overlay) return;
  if (moverBoxModal.dialog) {
    moverBoxModal.dialog.classList.add('opacity-0', 'scale-95');
  }
  moverBoxModal.overlay.classList.add('hidden');
  moverBoxModal.overlay.removeAttribute('data-modal-open');
  setMoverBoxModalError('');
  setMoverBoxModalLoading(false);
  resetMoverBoxModalForm();
  setMoverBoxModalPetInfo(null);
  moverBoxModal.dataset = null;
  moverBoxModal.state = null;
  moverBoxModal.onSuccess = null;
  moverBoxModal.record = null;
  moverBoxModal.recordId = null;
}

function openMoverBoxModal(record, options = {}) {
  if (!record) {
    showToastMessage('Não foi possível carregar os dados desse paciente.', 'warning');
    return;
  }
  ensureMoverBoxModal();
  const datasetRef = options.dataset || moverBoxModal.dataset || getDataset();
  const stateRef = options.state || moverBoxModal.state || {};
  const successHandler =
    typeof options.onSuccess === 'function'
      ? options.onSuccess
      : typeof stateRef?.refreshInternacoes === 'function'
        ? stateRef.refreshInternacoes
        : null;
  const recordId = record.id || record._id || '';
  if (!recordId) {
    showToastMessage('Não foi possível identificar essa internação para mover.', 'warning');
    return;
  }

  moverBoxModal.dataset = datasetRef || null;
  moverBoxModal.state = stateRef || null;
  moverBoxModal.onSuccess = successHandler || null;
  moverBoxModal.record = record;
  moverBoxModal.recordId = recordId;

  setMoverBoxModalError('');
  setMoverBoxModalLoading(false);
  resetMoverBoxModalForm();
  setMoverBoxModalPetInfo(getPetInfoFromInternacaoRecord(record));
  updateMoverBoxOptions(record, datasetRef || {});

  moverBoxModal.overlay.classList.remove('hidden');
  moverBoxModal.overlay.dataset.modalOpen = 'true';
  if (moverBoxModal.dialog) {
    requestAnimationFrame(() => {
      moverBoxModal.dialog.classList.remove('opacity-0', 'scale-95');
      moverBoxModal.dialog.focus();
    });
  }
}

async function handleMoverBoxModalSubmit(event) {
  event.preventDefault();
  if (!moverBoxModal.form) return;
  setMoverBoxModalError('');
  const recordId = moverBoxModal.recordId;
  if (!recordId) {
    setMoverBoxModalError('Não foi possível identificar a internação selecionada.');
    return;
  }

  const selectValue = moverBoxModal.selectEl ? moverBoxModal.selectEl.value.trim() : '';
  const currentValue = typeof moverBoxModal.record?.box === 'string' ? moverBoxModal.record.box.trim() : '';
  if (selectValue === currentValue) {
    setMoverBoxModalError('Selecione um destino diferente para continuar.');
    return;
  }

  setMoverBoxModalLoading(true);
  const datasetRef = moverBoxModal.dataset || getDataset();
  const stateRef = moverBoxModal.state || {};
  try {
    const updatedRecord = await requestJson(`/internacao/registros/${encodeURIComponent(recordId)}/box`, {
      method: 'POST',
      body: { box: selectValue },
    });
    const normalized = normalizeInternacaoRecord(updatedRecord);
    if (normalized) {
      applyInternacaoRecordUpdate(normalized, datasetRef, stateRef);
    }

    let boxesRefreshPromise = null;
    try {
      if (stateRef && typeof stateRef.refreshBoxes === 'function') {
        boxesRefreshPromise = Promise.resolve(stateRef.refreshBoxes());
      } else if (datasetRef) {
        boxesRefreshPromise = fetchBoxesData(datasetRef, stateRef, { quiet: true });
      }
    } catch (refreshError) {
      console.warn('internacao: falha ao atualizar boxes após movimentação', refreshError);
    }

    showToastMessage('Box atualizado com sucesso.', 'success');
    const successCallback = moverBoxModal.onSuccess;
    closeMoverBoxModal();

    if (boxesRefreshPromise && typeof boxesRefreshPromise.catch === 'function') {
      boxesRefreshPromise.catch((error) => {
        console.warn('internacao: falha ao atualizar boxes após movimentação', error);
      });
    }

    if (typeof successCallback === 'function') {
      successCallback();
    }
  } catch (error) {
    console.error('internacao: falha ao mover paciente de box', error);
    setMoverBoxModalError(error.message || 'Não foi possível atualizar o box.');
  } finally {
    setMoverBoxModalLoading(false);
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
  const vetOptionsMarkup = ['<option value="">Selecione</option>', ...getEquipeOptions(dataset).map((opt) => `<option value="${escapeHtml(opt.value)}">${escapeHtml(opt.label)}</option>`)]
    .join('');

  if (internarModal.form) {
    const vetSelect = internarModal.form.querySelector('select[name="internarVeterinario"]');
    const boxSelect = internarModal.form.querySelector('select[name="internarBox"]');
    if (vetSelect) {
      vetSelect.innerHTML = vetOptionsMarkup;
      if (extraOptions.forceVeterinario) {
        ensureSelectOption(vetSelect, extraOptions.forceVeterinario);
        vetSelect.value = extraOptions.forceVeterinario.value || '';
      }
    }
    if (boxSelect) {
      const boxOptionsMarkup = ['<option value="">Selecione</option>', ...getBoxOptions(dataset).map((opt) => `<option value="${escapeHtml(opt.value)}">${escapeHtml(opt.label)}</option>`)]
        .join('');
      boxSelect.innerHTML = boxOptionsMarkup;
      if (extraOptions.forceBox) {
        ensureSelectOption(boxSelect, extraOptions.forceBox);
        boxSelect.value = extraOptions.forceBox.value || '';
      }
    }
  }

  if (obitoModal.form) {
    const obitoVetSelect = obitoModal.form.querySelector('select[name="obitoVeterinario"]');
    if (obitoVetSelect) {
      obitoVetSelect.innerHTML = vetOptionsMarkup;
      const forced = extraOptions.forceObitoVeterinario || extraOptions.forceVeterinario;
      if (forced) {
        ensureSelectOption(obitoVetSelect, forced);
        obitoVetSelect.value = forced.value || '';
      }
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

function renderFichaPrescricoes(record) {
  if (!fichaInternacaoModal.prescricoesListEl) return;
  const prescricoes = Array.isArray(record?.prescricoes) ? record.prescricoes : [];
  if (!prescricoes.length) {
    fichaInternacaoModal.prescricoesListEl.innerHTML =
      '<p class="text-[12px] text-gray-500">Nenhuma prescrição cadastrada para essa internação.</p>';
    return;
  }

  const cards = prescricoes
    .map((item) => {
      const tipo = escapeHtml(item.tipoLabel || 'Prescrição');
      const descricao = escapeHtml(item.descricao || 'Sem descrição');
      const freq = escapeHtml(item.frequenciaLabel || '—');
      const isQuandoNecessario = normalizeActionKey(item.frequencia) === 'necessario';
      const resumo = escapeHtml(item.resumo || '—');
      const criadoLabel = formatDateTimeLabel(item.criadoEm);
      const inicioLabel = item.inicioISO ? formatDateTimeLabel(item.inicioISO) : '';
      const prescricaoId = escapeHtml(item.id || '');
      const prescricaoAttr = prescricaoId ? ` data-prescricao-id="${prescricaoId}"` : '';
      const interrupcaoLabel = isQuandoNecessario ? 'Interromper' : 'Interromper pendentes';
      const acaoInterromper = `
            <button
              type="button"
              class="inline-flex items-center gap-1 rounded-lg border border-amber-200 px-2.5 py-1 text-amber-700 transition hover:bg-amber-50"
              data-ficha-prescricao-action="interromper"${prescricaoAttr}
            >
              <i class="fas fa-pause"></i>
              ${interrupcaoLabel}
            </button>`;
      const acaoReprogramar = !isQuandoNecessario
        ? `
            <button
              type="button"
              class="inline-flex items-center gap-1 rounded-lg border border-primary/40 px-2.5 py-1 text-primary transition hover:bg-primary/5"
              data-ficha-prescricao-action="interromperreprogramar"${prescricaoAttr}
            >
              <i class="fas fa-rotate"></i>
              Interromper e reprogramar
            </button>`
        : '';
      const acoesMarkup = `
            ${acaoReprogramar}
            ${acaoInterromper}
            <button
              type="button"
              class="inline-flex items-center gap-1 rounded-lg border border-red-200 px-2.5 py-1 text-red-700 transition hover:bg-red-50"
              data-ficha-prescricao-action="excluir"${prescricaoAttr}
            >
              <i class="fas fa-trash"></i>
              Excluir
            </button>`;
      return `
        <li class="rounded-2xl border border-gray-100 bg-white px-3 py-3 shadow-sm shadow-gray-100/60">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p class="text-[10px] font-semibold uppercase tracking-wide text-gray-500">${tipo}</p>
              <p class="text-[13px] font-semibold text-gray-900">${descricao}</p>
            </div>
            <span class="rounded-full bg-primary/5 px-2 py-0.5 text-[10px] font-semibold text-primary">${freq}</span>
          </div>
          <p class="mt-2 text-[12px] text-gray-600">${resumo}</p>
          <div class="mt-2 flex flex-wrap gap-3 text-[10px] text-gray-500">
            <span>Registrado em ${escapeHtml(criadoLabel)}</span>
            ${inicioLabel ? `<span>Início previsto: ${escapeHtml(inicioLabel)}</span>` : ''}
          </div>
          <div class="mt-3 flex flex-wrap gap-1.5 text-[10px] font-semibold">
            ${acoesMarkup}
          </div>
        </li>
      `;
    })
    .join('');

  fichaInternacaoModal.prescricoesListEl.innerHTML = `<ol class="space-y-3">${cards}</ol>`;
}

function normalizeActionKey(value) {
  if (!value) return '';
  const normalized = typeof value.normalize === 'function' ? value.normalize('NFD') : value;
  return normalized.replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function getLatestPesoHistoricoTimestamp(record) {
  if (!record || !Array.isArray(record.historico)) return '';
  const entry = record.historico.find((item) => normalizeActionKey(item.tipo).includes('peso'));
  return entry?.criadoEm || '';
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
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p class="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Prescrições médicas</p>
                    <p class="text-[11px] text-gray-500">Cadastre novas prescrições ou revise as existentes.</p>
                  </div>
                  <button
                    type="button"
                    class="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm transition hover:bg-primary/90"
                    data-ficha-prescricao-action="nova"
                  >
                    <i class="fas fa-plus"></i>
                    Prescrição médica
                  </button>
                </div>
                <div class="mt-4 space-y-3" data-ficha-prescricoes-list>
                  <p class="text-[12px] text-gray-500">Nenhuma prescrição cadastrada para essa internação.</p>
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
  fichaInternacaoModal.prescricoesListEl = overlay.querySelector('[data-ficha-prescricoes-list]');
  fichaInternacaoModal.tabButtons = Array.from(overlay.querySelectorAll('[data-ficha-tab]'));
  fichaInternacaoModal.tabPanels = Array.from(overlay.querySelectorAll('[data-ficha-panel]'));
  fichaInternacaoModal.actionsContainer = overlay.querySelector('[data-ficha-actions]');

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
      const actionType = normalizeActionKey(actionTrigger.dataset.fichaAction);
      if (actionType === 'editar') {
        await handleFichaEditarAction();
      } else if (actionType === 'obito') {
        await handleFichaObitoAction();
      } else if (actionType === 'cancelar') {
        await handleFichaCancelarAction();
      } else if (actionType === 'box') {
        await handleFichaBoxAction();
      } else {
        showToastMessage('Funcionalidade em desenvolvimento.', 'info');
      }
      return;
    }
    const quickActionTrigger = event.target.closest('[data-ficha-hist-action]');
    if (quickActionTrigger) {
      event.preventDefault();
      const actionType = normalizeActionKey(quickActionTrigger.dataset.fichaHistAction);
      if (actionType === 'ocorrencia') {
        const record = fichaInternacaoModal.record;
        const dataset = fichaInternacaoModal.dataset || getDataset();
        const state = fichaInternacaoModal.state || {};
        if (!record) {
          showToastMessage('Abra uma ficha de internação válida antes de registrar a ocorrência.', 'warning');
          return;
        }
        const reopenFicha = () => {
          const updatedRecord =
            state?.internacoes?.find(
              (item) =>
                item.id === record.id ||
                item.filterKey === record.filterKey ||
                (record.codigo !== null && item.codigo === record.codigo),
            ) || record;
          openFichaInternacaoModal(updatedRecord, { dataset, state });
        };

        closeFichaInternacaoModal();
        openOcorrenciaModal(record, {
          dataset,
          state,
          onSuccess: state.refreshInternacoes,
          onClose: reopenFicha,
        });
      } else if (actionType === 'peso') {
        await handleFichaPesoAction();
      } else {
        showToastMessage('Funcionalidade em desenvolvimento.', 'info');
      }
      return;
    }
    const prescricaoTrigger = event.target.closest('[data-ficha-prescricao-action]');
    if (prescricaoTrigger) {
      event.preventDefault();
      await handleFichaPrescricaoAction(
        prescricaoTrigger.dataset.fichaPrescricaoAction,
        prescricaoTrigger.dataset.prescricaoId,
      );
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
  renderFichaPrescricoes(null);

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

async function handleFichaPesoAction() {
  const record = fichaInternacaoModal.record;
  if (!record) {
    showToastMessage('Abra uma ficha de internação válida antes de ajustar o peso.', 'warning');
    return;
  }

  const dataset = fichaInternacaoModal.dataset || getDataset();
  const state = fichaInternacaoModal.state || {};
  const petId = record.pet?.id || record.petId || record.filterKey;

  if (!petId) {
    showToastMessage('Não foi possível identificar o pet para registrar o peso.', 'warning');
    return;
  }

  const petMatch = (dataset?.pacientes || []).find((pet) => pet.id === petId || pet.id === record.filterKey);
  const tutorId = petMatch?.tutor?.id || petMatch?.tutor?._id || petMatch?.tutorId;

  let pesoModule;
  let coreModule;
  try {
    [pesoModule, coreModule] = await Promise.all([
      import('../vet/ficha-clinica/pesos.js'),
      import('../vet/ficha-clinica/core.js'),
    ]);
  } catch (error) {
    console.error('internacao: falha ao carregar modal de peso', error);
    showToastMessage('Não foi possível abrir o modal de peso.', 'error');
    return;
  }

  const coreState = coreModule?.state || {};
  coreState.selectedPetId = petId;
  coreState.selectedCliente = tutorId
    ? { _id: tutorId }
    : { _id: record.tutor?.documento || record.tutorDocumento || record.tutor?.nome || record.tutorNome || petId };
  coreState.agendaContext = null;

  const reopenFicha = async () => {
    const refreshPromise = typeof state.refreshInternacoes === 'function'
      ? state.refreshInternacoes()
      : null;
    try {
      if (refreshPromise?.then) {
        await refreshPromise;
      }
    } catch (error) {
      console.warn('internacao: falha ao atualizar lista após ajuste de peso', error);
    }

    const updatedRecord = Array.isArray(state?.internacoes)
      ? state.internacoes.find(
          (item) =>
            item.id === record.id ||
            item.filterKey === record.filterKey ||
            (record.codigo !== null && item.codigo === record.codigo),
        ) || record
      : record;
    openFichaInternacaoModal(updatedRecord, { dataset, state });
  };

  closeFichaInternacaoModal();
  pesoModule.openPesoModal({
    context: { internacaoId: record.id || record._id, internacaoCodigo: record.codigo || null },
    onClose: reopenFicha,
  });
}

async function handleFichaObitoAction() {
  const record = fichaInternacaoModal.record;
  if (!record) {
    showToastMessage('Não foi possível carregar os dados dessa internação.', 'warning');
    return;
  }
  if (record.obitoRegistrado) {
    showToastMessage('O óbito desse paciente já foi registrado.', 'info');
    return;
  }
  const dataset = fichaInternacaoModal.dataset || getDataset();
  const state = fichaInternacaoModal.state || {};
  try {
    await fetchVeterinariosData(dataset, state, { quiet: true });
  } catch (error) {
    console.warn('internacao: falha ao atualizar veterinários antes do óbito', error);
  }
  closeFichaInternacaoModal();
  openObitoModal(record, {
    dataset,
    state,
    onSuccess: state.refreshInternacoes,
  });
}

async function handleFichaCancelarAction() {
  const record = fichaInternacaoModal.record;
  if (!record) {
    showToastMessage('Não foi possível carregar os dados dessa internação.', 'warning');
    return;
  }
  const isCancelado =
    record.cancelado || normalizeActionKey(record.situacaoCodigo) === 'cancelado';
  if (isCancelado) {
    showToastMessage('Essa internação já está cancelada.', 'info');
    return;
  }
  if (record.obitoRegistrado) {
    showToastMessage('Não é possível cancelar uma internação com óbito registrado.', 'warning');
    return;
  }
  const dataset = fichaInternacaoModal.dataset || getDataset();
  const state = fichaInternacaoModal.state || {};
  closeFichaInternacaoModal();
  openCancelarModal(record, {
    dataset,
    state,
    onSuccess: state.refreshInternacoes,
  });
}

async function handleFichaBoxAction() {
  const record = fichaInternacaoModal.record;
  if (!record) {
    showToastMessage('Não foi possível carregar os dados dessa internação.', 'warning');
    return;
  }
  if (record.obitoRegistrado) {
    showToastMessage('Não é possível alterar o box após o registro de óbito.', 'warning');
    return;
  }
  const isCancelado = record.cancelado || normalizeActionKey(record.situacaoCodigo) === 'cancelado';
  if (isCancelado) {
    showToastMessage('Essa internação está cancelada e não permite movimentação de box.', 'info');
    return;
  }
  const dataset = fichaInternacaoModal.dataset || getDataset();
  const state = fichaInternacaoModal.state || {};
  try {
    await fetchBoxesData(dataset, state, { quiet: true });
  } catch (error) {
    console.warn('internacao: falha ao atualizar boxes antes da movimentação', error);
  }
  closeFichaInternacaoModal();
  openMoverBoxModal(record, {
    dataset,
    state,
    onSuccess: state.refreshInternacoes,
  });
}

async function handleFichaPrescricaoAction(actionValue, prescricaoId) {
  const actionType = normalizeActionKey(actionValue);
  if (!actionType) {
    showToastMessage('Selecione uma ação válida para prescrição.', 'warning');
    return;
  }
  const record = fichaInternacaoModal.record;
  if (!record) {
    showToastMessage('Abra uma ficha de internação antes de gerenciar prescrições.', 'warning');
    return;
  }
  const hasObito = record.obitoRegistrado || normalizeActionKey(record.situacaoCodigo) === 'obito';
  const isCancelado = record.cancelado || normalizeActionKey(record.situacaoCodigo) === 'cancelado';

  if (actionType === 'nova' || actionType === 'prescricao' || actionType === 'novaprescricao') {
    if (hasObito) {
      showToastMessage('Não é possível registrar prescrições após o óbito.', 'warning');
      return;
    }
    if (isCancelado) {
      showToastMessage('Essa internação está cancelada e não permite novas prescrições.', 'info');
      return;
    }
    ensurePrescricaoModal();
    const dataset = fichaInternacaoModal.dataset || getDataset();
    const state = fichaInternacaoModal.state || {};
    openPrescricaoModal(record, { dataset, state });
    return;
  }

  if (hasObito) {
    showToastMessage('Atualizações de prescrição não são permitidas após o óbito.', 'warning');
    return;
  }
  if (isCancelado) {
    showToastMessage('Essa internação está cancelada e não permite alterações em prescrições.', 'info');
    return;
  }

  if (!prescricaoId) {
    showToastMessage('Não foi possível identificar a prescrição selecionada.', 'warning');
    return;
  }

  if (actionType === 'interromper') {
    await handlePrescricaoInterrupcao(prescricaoId, { reprogramar: false });
    return;
  }
  if (actionType === 'interromperreprogramar' || actionType === 'interrompereprogramar') {
    await handlePrescricaoInterrupcao(prescricaoId, { reprogramar: true });
    return;
  }
  if (actionType === 'excluir') {
    await handlePrescricaoExclusao(prescricaoId);
    return;
  }

  showToastMessage('Funcionalidade de prescrição ainda em desenvolvimento.', 'info');
}

async function handlePrescricaoInterrupcao(prescricaoId, { reprogramar = false } = {}) {
  const record = fichaInternacaoModal.record;
  if (!record || !record.id) {
    showToastMessage('Não foi possível identificar a internação selecionada.', 'warning');
    return;
  }
  const prescricaoSelecionada = reprogramar ? findPrescricaoById(record, prescricaoId) : null;
  const prescricaoParaReprogramar = prescricaoSelecionada
    ? JSON.parse(JSON.stringify(prescricaoSelecionada))
    : null;
  const confirmMessage = reprogramar
    ? 'Interromper as execuções agendadas e reabrir o modal para reagendar?'
    : 'Interromper todas as execuções agendadas desta prescrição?';
  const confirmed = typeof window?.confirm === 'function' ? window.confirm(confirmMessage) : true;
  if (!confirmed) return;
  try {
    const updated = await requestJson(
      `/internacao/registros/${encodeURIComponent(record.id)}/prescricoes/${encodeURIComponent(prescricaoId)}/interromper`,
      { method: 'POST' },
    );
    const normalized = syncInternacaoRecordState(updated);
    if (!normalized) {
      throw new Error('Não foi possível atualizar a ficha após a interrupção.');
    }
    if (fichaInternacaoModal.record && isSameInternacaoRecord(fichaInternacaoModal.record, normalized)) {
      setFichaModalTab('prescricao');
    }
    showToastMessage('Execuções agendadas interrompidas com sucesso.', 'success');
    if (reprogramar) {
      const alvo = findPrescricaoById(normalized, prescricaoId) || prescricaoParaReprogramar;
      if (!alvo) {
        showToastMessage('Prescrição interrompida, mas não foi possível carregar os dados para reprogramar.', 'warning');
        return;
      }
      ensurePrescricaoModal();
      const dataset = fichaInternacaoModal.dataset || getDataset();
      const state = fichaInternacaoModal.state || {};
      const initialValues = normalizePrescricaoItem(alvo) || alvo;
      openPrescricaoModal(normalized, { dataset, state, initialValues });
    }
  } catch (error) {
    console.error('internacao: falha ao interromper prescricao', error);
    showToastMessage(error.message || 'Não foi possível interromper essa prescrição.', 'error');
  }
}

async function handlePrescricaoExclusao(prescricaoId) {
  const record = fichaInternacaoModal.record;
  if (!record || !record.id) {
    showToastMessage('Não foi possível identificar a internação selecionada.', 'warning');
    return;
  }
  const confirmMessage =
    'Excluir essa prescrição remove todas as execuções, inclusive as já realizadas. Deseja continuar?';
  const confirmed = typeof window?.confirm === 'function' ? window.confirm(confirmMessage) : true;
  if (!confirmed) return;
  try {
    const updated = await requestJson(
      `/internacao/registros/${encodeURIComponent(record.id)}/prescricoes/${encodeURIComponent(prescricaoId)}/excluir`,
      { method: 'POST' },
    );
    const normalized = syncInternacaoRecordState(updated);
    if (!normalized) {
      throw new Error('Não foi possível atualizar a ficha após a exclusão.');
    }
    if (fichaInternacaoModal.record && isSameInternacaoRecord(fichaInternacaoModal.record, normalized)) {
      setFichaModalTab('prescricao');
    }
    showToastMessage('Prescrição excluída e mapa de execução atualizado.', 'success');
  } catch (error) {
    console.error('internacao: falha ao excluir prescricao', error);
    showToastMessage(error.message || 'Não foi possível excluir essa prescrição.', 'error');
  }
}

function handleExecucaoSubmitEvent(event) {
  const detail = event?.detail || {};
  if (!detail) return;
  detail.handled = true;
  const { recordId, execucaoId, payload, close, onError, onComplete } = detail;
  const emitError = (message) => {
    if (typeof onError === 'function') {
      onError(message);
    } else {
      showToastMessage(message, 'error');
    }
  };
  if (!recordId || !execucaoId) {
    emitError('Não foi possível identificar o procedimento selecionado.');
    if (typeof onComplete === 'function') {
      onComplete();
    }
    return;
  }
  (async () => {
    try {
      const updated = await requestJson(
        `/internacao/registros/${encodeURIComponent(recordId)}/execucoes/${encodeURIComponent(execucaoId)}/concluir`,
        {
          method: 'POST',
          body: payload,
        },
      );
      const normalized = syncInternacaoRecordState(updated);
      if (!normalized) {
        throw new Error('Não foi possível atualizar o mapa de execução.');
      }
      if (typeof close === 'function') {
        close();
      }
      showToastMessage('Procedimento concluído e mapa de execução atualizado.', 'success');
    } catch (error) {
      console.error('internacao: falha ao concluir execucao', error);
      emitError(error.message || 'Não foi possível concluir esse procedimento.');
    } finally {
      if (typeof onComplete === 'function') {
        onComplete();
      }
    }
  })();
}

function setPrescricaoModalError(message) {
  if (!prescricaoModal.errorEl) return;
  const text = String(message || '').trim();
  prescricaoModal.errorEl.textContent = text;
  prescricaoModal.errorEl.classList.toggle('hidden', !text);
}

function setPrescricaoModalLoading(isLoading) {
  if (!prescricaoModal.submitBtn) return;
  if (!prescricaoModal.submitBtn.dataset.defaultLabel) {
    prescricaoModal.submitBtn.dataset.defaultLabel = prescricaoModal.submitBtn.textContent.trim();
  }
  prescricaoModal.submitBtn.disabled = !!isLoading;
  prescricaoModal.submitBtn.classList.toggle('opacity-60', !!isLoading);
  prescricaoModal.submitBtn.textContent = isLoading
    ? 'Salvando...'
    : prescricaoModal.submitBtn.dataset.defaultLabel;
}

function togglePrescricaoRecorrenciaFields(show) {
  if (!prescricaoModal.recorrenciaFields) return;
  prescricaoModal.recorrenciaFields.classList.toggle('hidden', !show);
  prescricaoModal.recorrenciaFields.setAttribute('aria-hidden', show ? 'false' : 'true');
}

function updatePrescricaoRecorrenciaTitle(freqValue) {
  if (!prescricaoModal.recorrenciaTitleEl) return;
  const freqKey = normalizeActionKey(freqValue || getSelectedPrescricaoFrequenciaValue() || '');
  const title = freqKey === 'unica' ? 'Intervalo' : 'Intervalo recorrente';
  prescricaoModal.recorrenciaTitleEl.textContent = title;
}

function getPrescricaoCardVisualFromInput(input) {
  if (!input) return null;
  const label = input.closest('[data-prescricao-card]');
  if (!label) return null;
  return label.querySelector('[data-prescricao-card-visual]');
}

function applyPrescricaoCardVisualState(input, isChecked) {
  const visual = getPrescricaoCardVisualFromInput(input);
  if (!visual) return;
  visual.classList.toggle('bg-primary', isChecked);
  visual.classList.toggle('text-white', isChecked);
  visual.classList.toggle('border-primary', isChecked);
  visual.classList.toggle('shadow-sm', isChecked);
  visual.classList.toggle('bg-white', !isChecked);
  visual.classList.toggle('text-gray-600', !isChecked);
  visual.classList.toggle('border-gray-200', !isChecked);
}

function syncPrescricaoCardVisuals(nodeList) {
  if (!nodeList) return;
  const nodes = Array.from(nodeList);
  if (!nodes.length) return;
  nodes.forEach((input) => {
    applyPrescricaoCardVisualState(input, Boolean(input?.checked));
  });
}

function getSelectedRadioValue(nodeList) {
  if (!nodeList) return '';
  const nodes = Array.from(nodeList);
  const checked = nodes.find((input) => input.checked);
  return checked ? checked.value : '';
}

function setRadioValue(nodeList, value) {
  if (!nodeList) return;
  const nodes = Array.from(nodeList);
  if (!nodes.length) return;
  let matched = false;
  nodes.forEach((input, index) => {
    const shouldCheck = value ? input.value === value : index === 0;
    if (shouldCheck) {
      matched = true;
    }
    input.checked = shouldCheck;
    input.setAttribute('aria-checked', shouldCheck ? 'true' : 'false');
    applyPrescricaoCardVisualState(input, shouldCheck);
  });
  if (!matched) {
    nodes[0].checked = true;
    nodes[0].setAttribute('aria-checked', 'true');
    applyPrescricaoCardVisualState(nodes[0], true);
    nodes.slice(1).forEach((input) => applyPrescricaoCardVisualState(input, false));
  }
}

function getSelectedPrescricaoTipoValue() {
  return getSelectedRadioValue(prescricaoModal.tipoInputs);
}

function getSelectedPrescricaoFrequenciaValue() {
  return getSelectedRadioValue(prescricaoModal.frequenciaInputs);
}

function setPrescricaoTipoValue(value) {
  setRadioValue(prescricaoModal.tipoInputs, value);
}

function setPrescricaoFrequenciaValue(value) {
  setRadioValue(prescricaoModal.frequenciaInputs, value);
}

function togglePrescricaoIntervaloDetalhes(show) {
  const fields = prescricaoModal.intervaloDetalheFields
    ? Array.from(prescricaoModal.intervaloDetalheFields)
    : [];
  if (!fields.length) return;
  fields.forEach((field) => {
    field.classList.toggle('hidden', !show);
    field.setAttribute('aria-hidden', show ? 'false' : 'true');
  });
}

function togglePrescricaoMedicamentoFields(show) {
  if (!prescricaoModal.medicamentoFields) return;
  prescricaoModal.medicamentoFields.classList.toggle('hidden', !show);
  prescricaoModal.medicamentoFields.setAttribute('aria-hidden', show ? 'false' : 'true');
}

function togglePrescricaoFluidoterapiaFields(show) {
  if (!prescricaoModal.fluidFields) return;
  prescricaoModal.fluidFields.classList.toggle('hidden', !show);
  prescricaoModal.fluidFields.setAttribute('aria-hidden', show ? 'false' : 'true');
}

function togglePrescricaoDescricaoField(show) {
  if (!prescricaoModal.descricaoWrapper) return;
  prescricaoModal.descricaoWrapper.classList.toggle('hidden', !show);
  prescricaoModal.descricaoWrapper.setAttribute('aria-hidden', show ? 'false' : 'true');
  if (!show && prescricaoModal.descricaoField) {
    prescricaoModal.descricaoField.value = '';
  }
}

function updatePrescricaoDescricaoLabel(tipoValue) {
  if (!prescricaoModal.descricaoLabelEl) return;
  const tipoKey = normalizeActionKey(tipoValue || getSelectedPrescricaoTipoValue() || '');
  prescricaoModal.descricaoLabelEl.textContent = tipoKey === 'fluidoterapia' ? 'Fluído*' : 'Procedimento*';
}

function shouldShowMedicamentoDetails(values = {}) {
  const tipoKey = normalizeActionKey(values.tipo || '');
  const freqKey = normalizeActionKey(values.frequencia || '');
  if (tipoKey !== 'medicamento') return false;
  return freqKey === 'recorrente' || freqKey === 'unica' || freqKey === 'necessario';
}

function shouldShowFluidoterapiaDetails(values = {}) {
  const tipoKey = normalizeActionKey(values.tipo || '');
  const freqKey = normalizeActionKey(values.frequencia || '');
  if (tipoKey !== 'fluidoterapia') return false;
  return freqKey === 'recorrente' || freqKey === 'unica' || freqKey === 'necessario';
}

function shouldShowRecorrenciaFields(values = {}) {
  const freqKey = normalizeActionKey(values.frequencia || '');
  if (!freqKey) return true;
  return freqKey === 'recorrente' || freqKey === 'unica';
}

function shouldShowRecorrenciaIntervaloDetalhes(values = {}) {
  const freqKey = normalizeActionKey(values.frequencia || '');
  if (!freqKey) return true;
  return freqKey !== 'unica';
}

function shouldHidePrescricaoDescricaoField(values = {}) {
  return shouldShowFluidoterapiaDetails(values);
}

function readPrescricaoFormValues() {
  if (!prescricaoModal.form) return {};
  const formData = new FormData(prescricaoModal.form);
  const values = {
    tipo: (formData.get('prescTipo') || '').toString().trim(),
    frequencia: (formData.get('prescFrequencia') || '').toString().trim(),
    aCadaValor: (formData.get('prescACadaValor') || '').toString().trim(),
    aCadaUnidade: (formData.get('prescACadaUnidade') || '').toString().trim(),
    porValor: (formData.get('prescPorValor') || '').toString().trim(),
    porUnidade: (formData.get('prescPorUnidade') || '').toString().trim(),
    dataInicio: (formData.get('prescDataInicio') || '').toString().trim(),
    horaInicio: (formData.get('prescHoraInicio') || '').toString().trim(),
    descricao: (formData.get('prescDescricao') || '').toString().trim(),
    medUnidade: (formData.get('prescMedUnidade') || '').toString().trim(),
    medDose: (formData.get('prescMedDose') || '').toString().trim(),
    medVia: (formData.get('prescMedVia') || '').toString().trim(),
    medPeso: (formData.get('prescMedPeso') || '').toString().trim(),
    medPesoAtualizadoEm: prescricaoModal.petInfo?.petPesoAtualizadoEm || '',
    fluidFluido: (formData.get('prescFluidFluido') || '').toString().trim(),
    fluidEquipo: (formData.get('prescFluidEquipo') || '').toString().trim(),
    fluidUnidade: (formData.get('prescFluidUnidade') || '').toString().trim(),
    fluidDose: (formData.get('prescFluidDose') || '').toString().trim(),
    fluidVia: (formData.get('prescFluidVia') || '').toString().trim(),
    fluidVelocidadeValor: (formData.get('prescFluidVelocidadeValor') || '').toString().trim(),
    fluidVelocidadeUnidade: (formData.get('prescFluidVelocidadeUnidade') || '').toString().trim(),
    fluidSuplemento: (formData.get('prescFluidSuplemento') || '').toString().trim(),
  };
  const tipoKey = normalizeActionKey(values.tipo);
  if (!values.fluidFluido && tipoKey === 'fluidoterapia') {
    values.fluidFluido = values.descricao;
  }
  if (!values.descricao && values.fluidFluido) {
    values.descricao = values.fluidFluido;
  }
  return values;
}

function buildPrescricaoResumo(values = {}) {
  const { tipo, frequencia, descricao, aCadaValor, aCadaUnidade, porValor, porUnidade, dataInicio, horaInicio } = values;
  const tipoDetails = getOptionDetails(PRESCRICAO_TIPO_OPTIONS, tipo);
  const freqDetails = getOptionDetails(PRESCRICAO_FREQUENCIA_OPTIONS, frequencia);
  const intervaloDetails = getOptionDetails(PRESCRICAO_INTERVALO_OPTIONS, aCadaUnidade);
  const periodoDetails = getOptionDetails(PRESCRICAO_POR_OPTIONS, porUnidade);
  const medUnidadeDetails = getOptionDetails(PRESCRICAO_MED_UNIDADE_OPTIONS, values.medUnidade);
  const medViaDetails = getOptionDetails(PRESCRICAO_MED_VIA_OPTIONS, values.medVia);
  const inicioISO = combineDateAndTime(dataInicio, horaInicio);
  const inicioLabel = inicioISO ? formatDateTimeLabel(inicioISO) : '';
  const descricaoLabel = descricao ? ' · ' + descricao : '';
  let resumo = '';
  if (freqDetails.value === 'recorrente') {
    const intervalo = aCadaValor && intervaloDetails.label
      ? aCadaValor + ' ' + intervaloDetails.label.toLowerCase()
      : 'intervalo definido';
    const periodo = porValor && periodoDetails.label
      ? porValor + ' ' + periodoDetails.label.toLowerCase()
      : 'período informado';
    resumo = (tipoDetails.label || 'Procedimento') + descricaoLabel + ' recorrente a cada ' + intervalo + ' por ' + periodo +
      (inicioLabel ? ', iniciando em ' + inicioLabel : '') + '.';
  } else if (freqDetails.value === 'necessario') {
    resumo = (tipoDetails.label || 'Procedimento') + descricaoLabel + ' quando necessário' +
      (inicioLabel ? ', referência ' + inicioLabel : '') + '.';
  } else {
    resumo = (tipoDetails.label || 'Procedimento') + descricaoLabel + ' aplicado apenas uma vez' +
      (inicioLabel ? ' em ' + inicioLabel : '') + '.';
  }
  if (shouldShowMedicamentoDetails(values)) {
    const medParts = [];
    if (values.medDose) {
      const unidadeLabel = medUnidadeDetails.label ? medUnidadeDetails.label.toLowerCase() : '';
      medParts.push(unidadeLabel ? `${values.medDose} ${unidadeLabel}` : values.medDose);
    }
    if (medViaDetails.label) {
      medParts.push(`via ${medViaDetails.label.toLowerCase()}`);
    }
    if (values.medPeso) {
      const pesoAtualLabel = values.medPesoAtualizadoEm
        ? formatDateTimeLabel(values.medPesoAtualizadoEm)
        : '';
      const pesoDetalhe = pesoAtualLabel ? `em ${pesoAtualLabel}` : 'em —';
      medParts.push(`peso ref.: ${values.medPeso} (${pesoDetalhe})`);
    }
    if (medParts.length) {
      resumo += ' Detalhes: ' + medParts.join(' · ') + '.';
    }
  }
  if (shouldShowFluidoterapiaDetails(values)) {
    const fluidParts = [];
    if (values.fluidFluido) {
      fluidParts.push(`fluído ${values.fluidFluido}`);
    }
    if (values.fluidEquipo) {
      const equipoOption = getOptionDetails(PRESCRICAO_FLUID_EQUIPO_OPTIONS, values.fluidEquipo);
      fluidParts.push(`equipo ${equipoOption.label.toLowerCase()}`);
    }
    if (values.fluidDose) {
      const unidadeOption = getOptionDetails(PRESCRICAO_MED_UNIDADE_OPTIONS, values.fluidUnidade);
      const unidadeLabel = unidadeOption.label ? unidadeOption.label.toLowerCase() : '';
      fluidParts.push(unidadeLabel ? `${values.fluidDose} ${unidadeLabel}` : values.fluidDose);
    }
    if (values.fluidVia) {
      const viaOption = getOptionDetails(PRESCRICAO_MED_VIA_OPTIONS, values.fluidVia);
      if (viaOption.label) {
        fluidParts.push(`via ${viaOption.label.toLowerCase()}`);
      }
    }
    if (values.fluidVelocidadeValor && values.fluidVelocidadeUnidade) {
      const velocidadeOption = getOptionDetails(PRESCRICAO_FLUID_VELOCIDADE_OPTIONS, values.fluidVelocidadeUnidade);
      const velocidadeLabel = velocidadeOption.label || 'unidade';
      fluidParts.push(`velocidade ${values.fluidVelocidadeValor} ${velocidadeLabel.toLowerCase()}`);
    }
    const suplementoLabel = values.fluidSuplemento || 'Sem suplemento';
    fluidParts.push(`suplemento: ${suplementoLabel}`);
    resumo += ' Detalhes da fluidoterapia: ' + fluidParts.join(' · ') + '.';
  }
  return resumo;
}

function updatePrescricaoResumoFromForm() {
  const resumo = buildPrescricaoResumo(readPrescricaoFormValues());
  if (prescricaoModal.resumoField) {
    prescricaoModal.resumoField.value = resumo;
  }
}

function resetPrescricaoModalForm() {
  if (prescricaoModal.form) {
    prescricaoModal.form.reset();
  }
  const now = new Date();
  setPrescricaoTipoValue(PRESCRICAO_TIPO_OPTIONS[0]?.value || '');
  setPrescricaoFrequenciaValue('recorrente');
  const dataField = prescricaoModal.form?.querySelector('input[name="prescDataInicio"]');
  const horaField = prescricaoModal.form?.querySelector('input[name="prescHoraInicio"]');
  const aCadaField = prescricaoModal.form?.querySelector('input[name="prescACadaValor"]');
  const porField = prescricaoModal.form?.querySelector('input[name="prescPorValor"]');
  const aCadaSelect = prescricaoModal.form?.querySelector('select[name="prescACadaUnidade"]');
  const porSelect = prescricaoModal.form?.querySelector('select[name="prescPorUnidade"]');
  if (dataField) dataField.value = getLocalDateInputValue(now);
  if (horaField) horaField.value = getLocalTimeInputValue(now);
  if (aCadaField) aCadaField.value = '1';
  if (porField) porField.value = '6';
  if (aCadaSelect) aCadaSelect.value = PRESCRICAO_INTERVALO_OPTIONS[0]?.value || '';
  if (porSelect) porSelect.value = PRESCRICAO_POR_OPTIONS[2]?.value || '';
  const medUnidadeSelect = prescricaoModal.form?.querySelector('select[name="prescMedUnidade"]');
  const medDoseInput = prescricaoModal.form?.querySelector('input[name="prescMedDose"]');
  const medViaSelect = prescricaoModal.form?.querySelector('select[name="prescMedVia"]');
  if (medUnidadeSelect) medUnidadeSelect.value = '';
  if (medDoseInput) medDoseInput.value = '';
  if (medViaSelect) medViaSelect.value = '';
  if (prescricaoModal.medPesoField) prescricaoModal.medPesoField.value = '';
  if (prescricaoModal.medPesoMetaEl) prescricaoModal.medPesoMetaEl.textContent = 'em —';
  togglePrescricaoRecorrenciaFields(true);
  togglePrescricaoIntervaloDetalhes(true);
  updatePrescricaoRecorrenciaTitle('recorrente');
  togglePrescricaoMedicamentoFields(false);
  togglePrescricaoFluidoterapiaFields(false);
  togglePrescricaoDescricaoField(true);
  const fluidInputs = prescricaoModal.form?.querySelectorAll('[data-prescricao-fluid-input]');
  if (fluidInputs) {
    fluidInputs.forEach((input) => {
      if (input.tagName === 'SELECT') {
        input.value = '';
      } else {
        input.value = '';
      }
    });
  }
  updatePrescricaoDescricaoLabel();
  updatePrescricaoResumoFromForm();
}

function fillPrescricaoForm(values = {}) {
  if (!prescricaoModal.form || !values || typeof values !== 'object') return;
  if (values.tipo) {
    setPrescricaoTipoValue(values.tipo);
  }
  if (values.frequencia) {
    setPrescricaoFrequenciaValue(values.frequencia);
  }
  const mappings = [
    ['prescACadaValor', 'aCadaValor'],
    ['prescACadaUnidade', 'aCadaUnidade'],
    ['prescPorValor', 'porValor'],
    ['prescPorUnidade', 'porUnidade'],
    ['prescDataInicio', 'dataInicio'],
    ['prescHoraInicio', 'horaInicio'],
    ['prescDescricao', 'descricao'],
    ['prescMedUnidade', 'medUnidade'],
    ['prescMedDose', 'medDose'],
    ['prescMedVia', 'medVia'],
    ['prescMedPeso', 'medPeso'],
    ['prescFluidFluido', 'fluidFluido'],
    ['prescFluidEquipo', 'fluidEquipo'],
    ['prescFluidUnidade', 'fluidUnidade'],
    ['prescFluidDose', 'fluidDose'],
    ['prescFluidVia', 'fluidVia'],
    ['prescFluidVelocidadeValor', 'fluidVelocidadeValor'],
    ['prescFluidVelocidadeUnidade', 'fluidVelocidadeUnidade'],
    ['prescFluidSuplemento', 'fluidSuplemento'],
  ];
  mappings.forEach(([fieldName, key]) => {
    if (!(key in values)) return;
    const input = prescricaoModal.form.querySelector(`[name="${fieldName}"]`);
    if (input) {
      input.value = values[key] ?? '';
    }
  });
  if (prescricaoModal.medPesoField && values.medPeso !== undefined) {
    prescricaoModal.medPesoField.value = values.medPeso;
  }
  if (prescricaoModal.resumoField && values.resumo) {
    prescricaoModal.resumoField.value = values.resumo;
  }
  updatePrescricaoResumoFromForm();
}

function setPrescricaoModalPetInfo(info) {
  const normalized = normalizePetInfo(info);
  prescricaoModal.petInfo = normalized;
  const hasInfo = !!normalized;
  if (prescricaoModal.petSummaryEl) prescricaoModal.petSummaryEl.classList.toggle('hidden', !hasInfo);
  const petName = normalized?.petNome || 'Paciente';
  const meta = normalized
    ? [normalized.petEspecie, normalized.petRaca, normalized.petPeso || normalized.petIdade].filter(Boolean).join(' · ')
    : '';
  const tutor = normalized
    ? [normalized.tutorNome, normalized.tutorContato, normalized.tutorDocumento].filter(Boolean).join(' · ')
    : '';
  if (prescricaoModal.petSummaryNameEl) prescricaoModal.petSummaryNameEl.textContent = petName;
  if (prescricaoModal.petSummaryMetaEl) prescricaoModal.petSummaryMetaEl.textContent = meta || '—';
  if (prescricaoModal.petSummaryTutorEl) prescricaoModal.petSummaryTutorEl.textContent = tutor || 'Tutor não informado';
  if (prescricaoModal.medPesoField) {
    prescricaoModal.medPesoField.value = normalized?.petPeso || '';
  }
  if (prescricaoModal.medPesoMetaEl) {
    const pesoAtualLabel = normalized?.petPesoAtualizadoEm
      ? formatDateTimeLabel(normalized.petPesoAtualizadoEm)
      : '';
    prescricaoModal.medPesoMetaEl.textContent = pesoAtualLabel ? `em ${pesoAtualLabel}` : 'em —';
  }
}

function closePrescricaoModal() {
  if (!prescricaoModal.overlay) return;
  if (prescricaoModal.dialog) {
    prescricaoModal.dialog.classList.add('opacity-0', 'scale-95');
  }
  prescricaoModal.overlay.classList.add('hidden');
  prescricaoModal.overlay.classList.remove('flex');
  prescricaoModal.overlay.removeAttribute('data-modal-open');
  setPrescricaoModalError('');
  setPrescricaoModalLoading(false);
  resetPrescricaoModalForm();
  setPrescricaoModalPetInfo(null);
  prescricaoModal.dataset = null;
  prescricaoModal.state = null;
  prescricaoModal.record = null;
}

function handlePrescricaoFormChange(event) {
  let cachedValues = null;
  if (event && event.target && event.target.name === 'prescFrequencia') {
    cachedValues = readPrescricaoFormValues();
    togglePrescricaoRecorrenciaFields(shouldShowRecorrenciaFields(cachedValues));
    togglePrescricaoIntervaloDetalhes(shouldShowRecorrenciaIntervaloDetalhes(cachedValues));
    updatePrescricaoRecorrenciaTitle(cachedValues.frequencia);
    syncPrescricaoCardVisuals(prescricaoModal.frequenciaInputs);
  }
  const shouldToggleMedicamento =
    event &&
    event.target &&
    (event.target.name === 'prescFrequencia' || event.target.name === 'prescTipo');
  if (shouldToggleMedicamento) {
    cachedValues = cachedValues || readPrescricaoFormValues();
    togglePrescricaoMedicamentoFields(shouldShowMedicamentoDetails(cachedValues));
    togglePrescricaoFluidoterapiaFields(shouldShowFluidoterapiaDetails(cachedValues));
    togglePrescricaoDescricaoField(!shouldHidePrescricaoDescricaoField(cachedValues));
    updatePrescricaoDescricaoLabel(cachedValues.tipo);
  }
  if (event && event.target && event.target.name === 'prescTipo') {
    syncPrescricaoCardVisuals(prescricaoModal.tipoInputs);
  }
  updatePrescricaoResumoFromForm();
}

function ensurePrescricaoModal() {
  if (prescricaoModal.overlay) return prescricaoModal.overlay;

  const overlay = document.createElement('div');
  overlay.className = 'internacao-prescricao-modal fixed inset-0 z-[1050] hidden flex items-center justify-center';
  overlay.innerHTML = `
    <div class="absolute inset-0 bg-gray-900/60 backdrop-blur-sm" data-close-prescricao-modal></div>
    <div class="relative mx-auto flex min-h-full w-full items-start justify-center px-3 py-6 sm:items-start sm:pt-12">
      <div
        class="relative flex w-full max-w-3xl transform-gpu flex-col overflow-hidden rounded-2xl bg-white text-[12px] leading-[1.35] text-gray-700 shadow-2xl ring-1 ring-black/10 opacity-0 scale-95 transition-all duration-200"
        role="dialog"
        aria-modal="true"
        aria-labelledby="prescricao-modal-title"
        data-prescricao-dialog
        tabindex="-1"
      >
        <header class="flex flex-col gap-2.5 border-b border-gray-100 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <span class="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
              <i class="fas fa-prescription"></i>
              Prescrição
            </span>
            <h2 id="prescricao-modal-title" class="mt-1.5 text-lg font-semibold text-gray-900">Nova prescrição médica</h2>
            <p class="mt-1 text-[11px] text-gray-600">Registre o procedimento, medicamento ou fluidoterapia da internação.</p>
          </div>
          <button type="button" class="inline-flex items-center justify-center rounded-full border border-gray-200 p-1.5 text-gray-500 transition hover:bg-gray-50 hover:text-gray-700" data-close-prescricao-modal>
            <span class="sr-only">Fechar</span>
            <i class="fas fa-xmark text-sm"></i>
          </button>
        </header>
        <form class="flex max-h-[80vh] flex-col" novalidate>
          <div class="flex-1 space-y-4 overflow-y-auto px-4 py-4">
            <div class="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2" data-prescricao-summary>
              <p class="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Paciente</p>
              <p class="text-[13px] font-semibold text-gray-900" data-prescricao-summary-name>Paciente</p>
              <p class="text-[11px] text-gray-500" data-prescricao-summary-meta>—</p>
              <p class="text-[11px] text-gray-500" data-prescricao-summary-tutor>—</p>
            </div>
            <div class="grid gap-3 md:grid-cols-2">
              <div>
                <p class="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Tipo*</p>
                <div class="mt-2 grid grid-cols-3 gap-1.5 text-[11px]" data-prescricao-tipo-cards>
                  ${createCardOptionsMarkup('prescTipo', PRESCRICAO_TIPO_OPTIONS)}
                </div>
              </div>
              <div>
                <p class="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Frequência*</p>
                <div class="mt-2 grid grid-cols-3 gap-1.5 text-[11px]" data-prescricao-frequencia-cards>
                  ${createCardOptionsMarkup('prescFrequencia', PRESCRICAO_FREQUENCIA_OPTIONS)}
                </div>
              </div>
            </div>
            <div class="rounded-xl border border-gray-100 px-3 py-3" data-prescricao-recorrencia>
              <p class="text-[10px] font-semibold uppercase tracking-wide text-gray-500" data-prescricao-recorrencia-title>Intervalo recorrente</p>
              <div class="mt-3 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                <label class="text-[11px] font-semibold uppercase tracking-wide text-gray-500" data-prescricao-intervalo>A cada*
                  <div class="mt-1 flex items-center gap-2">
                    <input type="number" name="prescACadaValor" min="1" class="w-20 rounded-lg border border-gray-200 px-3 py-2 text-[12px] text-gray-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20" />
                    <select name="prescACadaUnidade" class="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-[12px] text-gray-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20">
                      ${createOptionsMarkup(PRESCRICAO_INTERVALO_OPTIONS)}
                    </select>
                  </div>
                </label>
                <label class="text-[11px] font-semibold uppercase tracking-wide text-gray-500" data-prescricao-intervalo>Por*
                  <div class="mt-1 flex items-center gap-2">
                    <input type="number" name="prescPorValor" min="1" class="w-20 rounded-lg border border-gray-200 px-3 py-2 text-[12px] text-gray-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20" />
                    <select name="prescPorUnidade" class="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-[12px] text-gray-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20">
                      ${createOptionsMarkup(PRESCRICAO_POR_OPTIONS)}
                    </select>
                  </div>
                </label>
                <label class="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Iniciar em*
                  <input type="date" name="prescDataInicio" class="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] text-gray-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20" />
                </label>
                <label class="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Hora*
                  <input type="time" name="prescHoraInicio" class="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] text-gray-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20" />
                </label>
              </div>
            </div>
            <label class="block text-[11px] font-semibold uppercase tracking-wide text-gray-500" data-prescricao-descricao-wrapper>
              <span data-prescricao-descricao-label>Procedimento*</span>
              <textarea name="prescDescricao" rows="1" class="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] text-gray-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20" placeholder="Descreva o procedimento, medicamento ou fluidoterapia"></textarea>
            </label>
            <div class="rounded-xl border border-gray-100 px-3 py-3 hidden" data-prescricao-medicamento>
              <p class="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Detalhes do medicamento</p>
              <div class="mt-3 grid gap-3 md:grid-cols-4">
                <label class="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Unidade*
                  <select name="prescMedUnidade" class="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] font-medium text-gray-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20">
                    <option value="">Selecione</option>
                    ${createGroupedOptionsMarkup(PRESCRICAO_MED_UNIDADE_GROUPS)}
                  </select>
                </label>
                <label class="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Dose*
                  <input type="text" name="prescMedDose" class="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] text-gray-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20" placeholder="Ex.: 5" />
                </label>
                <label class="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Via*
                  <select name="prescMedVia" class="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] font-medium text-gray-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20">
                    <option value="">Selecione</option>
                    ${createOptionsMarkup(PRESCRICAO_MED_VIA_OPTIONS)}
                  </select>
                </label>
                <label class="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Peso
                  <div class="mt-1 space-y-1">
                    <input type="text" name="prescMedPeso" class="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] text-gray-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20" placeholder="Ex.: 18,4 kg" />
                    <p class="text-[10px] text-gray-500" data-prescricao-peso-meta>em —</p>
                  </div>
                </label>
              </div>
            </div>
            <div class="rounded-xl border border-gray-100 px-3 py-3 hidden" data-prescricao-fluidoterapia>
              <p class="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Detalhes da fluidoterapia</p>
              <div class="mt-3 grid gap-3 lg:grid-cols-4">
                <label class="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Fluído*
                  <input type="text" name="prescFluidFluido" data-prescricao-fluid-input class="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] text-gray-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20" placeholder="Ex.: Ringer com lactato" />
                </label>
                <label class="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Equipo*
                  <select name="prescFluidEquipo" data-prescricao-fluid-input class="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] font-medium text-gray-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20">
                    <option value="">Selecione</option>
                    ${createOptionsMarkup(PRESCRICAO_FLUID_EQUIPO_OPTIONS)}
                  </select>
                </label>
                <label class="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Unidade*
                  <select name="prescFluidUnidade" data-prescricao-fluid-input class="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] font-medium text-gray-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20">
                    <option value="">Selecione</option>
                    ${createGroupedOptionsMarkup(PRESCRICAO_MED_UNIDADE_GROUPS)}
                  </select>
                </label>
                <label class="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Dose*
                  <input type="text" name="prescFluidDose" data-prescricao-fluid-input class="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] text-gray-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20" placeholder="Ex.: 30" />
                </label>
              </div>
              <div class="mt-3 grid gap-3 md:grid-cols-3">
                <label class="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Via*
                  <select name="prescFluidVia" data-prescricao-fluid-input class="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] font-medium text-gray-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20">
                    <option value="">Selecione</option>
                    ${createOptionsMarkup(PRESCRICAO_MED_VIA_OPTIONS)}
                  </select>
                </label>
                <label class="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Velocidade*
                  <div class="mt-1 flex items-center gap-2">
                    <input type="number" name="prescFluidVelocidadeValor" min="0" step="0.1" data-prescricao-fluid-input class="w-24 rounded-lg border border-gray-200 px-3 py-2 text-[12px] text-gray-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20" />
                    <select name="prescFluidVelocidadeUnidade" data-prescricao-fluid-input class="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-[12px] text-gray-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20">
                      <option value="">Selecione</option>
                      ${createOptionsMarkup(PRESCRICAO_FLUID_VELOCIDADE_OPTIONS)}
                    </select>
                  </div>
                </label>
                <label class="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Suplemento
                  <input type="text" name="prescFluidSuplemento" data-prescricao-fluid-input class="mt-1 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-[12px] text-gray-700 placeholder:text-gray-400 focus:border-primary focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/20" placeholder="Sem suplemento" />
                </label>
              </div>
            </div>
            <label class="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Resumo (automático)
              <textarea name="prescResumo" data-prescricao-resumo rows="3" readonly class="mt-1 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-[12px] text-gray-600"></textarea>
            </label>
            <p class="text-[11px] text-gray-500">O resumo descreve por extenso o que será aplicado.</p>
            <p class="hidden rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-[11px] text-red-700" data-prescricao-error></p>
          </div>
          <div class="flex flex-col gap-2 border-t border-gray-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-end">
            <button type="button" class="inline-flex items-center justify-center rounded-lg border border-gray-300 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-gray-700 transition hover:bg-gray-50" data-close-prescricao-modal>
              Cancelar
            </button>
            <button type="submit" class="inline-flex items-center justify-center rounded-lg bg-primary px-5 py-2 text-[11px] font-semibold uppercase tracking-wide text-white shadow-sm transition hover:bg-primary/90" data-prescricao-submit>
              Salvar
            </button>
          </div>
        </form>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  prescricaoModal.overlay = overlay;
  prescricaoModal.dialog = overlay.querySelector('[data-prescricao-dialog]');
  prescricaoModal.form = overlay.querySelector('form');
  prescricaoModal.submitBtn = overlay.querySelector('[data-prescricao-submit]');
  prescricaoModal.errorEl = overlay.querySelector('[data-prescricao-error]');
  prescricaoModal.resumoField = overlay.querySelector('[data-prescricao-resumo]');
  prescricaoModal.recorrenciaFields = overlay.querySelector('[data-prescricao-recorrencia]');
  prescricaoModal.recorrenciaTitleEl = overlay.querySelector('[data-prescricao-recorrencia-title]');
  prescricaoModal.intervaloDetalheFields = overlay.querySelectorAll('[data-prescricao-intervalo]');
  prescricaoModal.medicamentoFields = overlay.querySelector('[data-prescricao-medicamento]');
  prescricaoModal.fluidFields = overlay.querySelector('[data-prescricao-fluidoterapia]');
  prescricaoModal.tipoInputs = overlay.querySelectorAll('input[name="prescTipo"]');
  prescricaoModal.frequenciaInputs = overlay.querySelectorAll('input[name="prescFrequencia"]');
  prescricaoModal.petSummaryEl = overlay.querySelector('[data-prescricao-summary]');
  prescricaoModal.petSummaryNameEl = overlay.querySelector('[data-prescricao-summary-name]');
  prescricaoModal.petSummaryMetaEl = overlay.querySelector('[data-prescricao-summary-meta]');
  prescricaoModal.petSummaryTutorEl = overlay.querySelector('[data-prescricao-summary-tutor]');
  prescricaoModal.medPesoField = overlay.querySelector('input[name="prescMedPeso"]');
  prescricaoModal.medPesoMetaEl = overlay.querySelector('[data-prescricao-peso-meta]');
  prescricaoModal.descricaoWrapper = overlay.querySelector('[data-prescricao-descricao-wrapper]');
  prescricaoModal.descricaoField = overlay.querySelector('textarea[name="prescDescricao"]');
  prescricaoModal.descricaoLabelEl = overlay.querySelector('[data-prescricao-descricao-label]');
  syncPrescricaoCardVisuals(prescricaoModal.tipoInputs);
  syncPrescricaoCardVisuals(prescricaoModal.frequenciaInputs);

  overlay.addEventListener('click', (event) => {
    const closeTrigger = event.target.closest('[data-close-prescricao-modal]');
    if (closeTrigger) {
      event.preventDefault();
      closePrescricaoModal();
    }
  });

  if (prescricaoModal.form) {
    prescricaoModal.form.addEventListener('submit', handlePrescricaoModalSubmit);
    prescricaoModal.form.addEventListener('input', handlePrescricaoFormChange);
    prescricaoModal.form.addEventListener('change', handlePrescricaoFormChange);
  }

  return overlay;
}

function bringModalOverlayToFront(overlay) {
  if (!overlay || !overlay.parentElement) return;
  overlay.parentElement.appendChild(overlay);
}

function openPrescricaoModal(record, options = {}) {
  ensurePrescricaoModal();
  bringModalOverlayToFront(prescricaoModal.overlay);
  prescricaoModal.dataset = options.dataset || prescricaoModal.dataset || getDataset();
  prescricaoModal.state = options.state || prescricaoModal.state || {};
  prescricaoModal.record = record;
  setPrescricaoModalError('');
  resetPrescricaoModalForm();
  setPrescricaoModalPetInfo(getPetInfoFromInternacaoRecord(record));
  if (options.initialValues) {
    fillPrescricaoForm(options.initialValues);
  }
  const initialValues = readPrescricaoFormValues();
  togglePrescricaoRecorrenciaFields(shouldShowRecorrenciaFields(initialValues));
  togglePrescricaoIntervaloDetalhes(shouldShowRecorrenciaIntervaloDetalhes(initialValues));
  updatePrescricaoRecorrenciaTitle(initialValues.frequencia);
  togglePrescricaoMedicamentoFields(shouldShowMedicamentoDetails(initialValues));
  togglePrescricaoFluidoterapiaFields(shouldShowFluidoterapiaDetails(initialValues));
  togglePrescricaoDescricaoField(!shouldHidePrescricaoDescricaoField(initialValues));
  updatePrescricaoDescricaoLabel(initialValues.tipo);
  prescricaoModal.overlay.classList.remove('hidden');
  prescricaoModal.overlay.classList.add('flex');
  prescricaoModal.overlay.dataset.modalOpen = 'true';
  if (prescricaoModal.dialog) {
    requestAnimationFrame(() => {
      prescricaoModal.dialog.classList.remove('opacity-0', 'scale-95');
      prescricaoModal.dialog.focus();
    });
  }
}

async function handlePrescricaoModalSubmit(event) {
  event.preventDefault();
  setPrescricaoModalError('');
  if (!prescricaoModal.form) return;
  const values = readPrescricaoFormValues();
  if (!values.tipo) {
    setPrescricaoModalError('Selecione o tipo da prescrição.');
    return;
  }
  if (!values.frequencia) {
    setPrescricaoModalError('Informe a frequência da aplicação.');
    return;
  }
  if (values.frequencia === 'recorrente') {
    if (!values.aCadaValor) {
      setPrescricaoModalError('Preencha o intervalo "A cada".');
      return;
    }
    if (!values.aCadaUnidade) {
      setPrescricaoModalError('Selecione a unidade do intervalo.');
      return;
    }
    if (!values.porValor) {
      setPrescricaoModalError('Informe o campo "Por".');
      return;
    }
    if (!values.porUnidade) {
      setPrescricaoModalError('Selecione a unidade do campo "Por".');
      return;
    }
    if (!values.dataInicio) {
      setPrescricaoModalError('Defina a data de início.');
      return;
    }
    if (!values.horaInicio) {
      setPrescricaoModalError('Informe o horário inicial.');
      return;
    }
  } else if (values.frequencia === 'unica') {
    if (!values.dataInicio || !values.horaInicio) {
      setPrescricaoModalError('Defina a data e hora para aplicação única.');
      return;
    }
  }
  if (!values.descricao) {
    setPrescricaoModalError('Descreva o procedimento ou medicamento.');
    return;
  }
  if (shouldShowMedicamentoDetails(values)) {
    if (!values.medUnidade) {
      setPrescricaoModalError('Selecione a unidade do medicamento.');
      return;
    }
    if (!values.medDose) {
      setPrescricaoModalError('Informe a dose do medicamento.');
      return;
    }
    if (!values.medVia) {
      setPrescricaoModalError('Selecione a via de administração.');
      return;
    }
  }
  if (shouldShowFluidoterapiaDetails(values)) {
    if (!values.fluidFluido) {
      setPrescricaoModalError('Informe qual fluído será administrado.');
      return;
    }
    if (!values.descricao) {
      setPrescricaoModalError('Descreva o fluído que será aplicado.');
      return;
    }
    if (!values.fluidEquipo) {
      setPrescricaoModalError('Informe o equipo da fluidoterapia.');
      return;
    }
    if (!values.fluidUnidade) {
      setPrescricaoModalError('Selecione a unidade do fluído.');
      return;
    }
    if (!values.fluidDose) {
      setPrescricaoModalError('Informe a dose da fluidoterapia.');
      return;
    }
    if (!values.fluidVia) {
      setPrescricaoModalError('Informe a via da fluidoterapia.');
      return;
    }
    if (!values.fluidVelocidadeValor || !values.fluidVelocidadeUnidade) {
      setPrescricaoModalError('Preencha a velocidade de aplicação.');
      return;
    }
  }

  const resumo = buildPrescricaoResumo(values);
  if (prescricaoModal.resumoField) {
    prescricaoModal.resumoField.value = resumo;
  }
  const payload = {
    ...values,
    resumo,
  };
  const record = prescricaoModal.record;
  if (!record || !record.id) {
    setPrescricaoModalError('Não foi possível identificar a internação.');
    return;
  }
  try {
    setPrescricaoModalLoading(true);
    const updatedRecord = await requestJson(`/internacao/registros/${encodeURIComponent(record.id)}/prescricoes`, {
      method: 'POST',
      body: payload,
    });
    const normalized = syncInternacaoRecordState(updatedRecord);
    if (!normalized) {
      throw new Error('Não foi possível interpretar a resposta do servidor.');
    }
    if (fichaInternacaoModal.record && isSameInternacaoRecord(fichaInternacaoModal.record, normalized)) {
      setFichaModalTab('prescricao');
    }
    closePrescricaoModal();
    showToastMessage('Prescrição registrada com sucesso!', 'success');
  } catch (error) {
    console.error('internacao: falha ao salvar prescricao', error);
    setPrescricaoModalError(error.message || 'Não foi possível salvar a prescrição.');
  } finally {
    setPrescricaoModalLoading(false);
  }
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
  if (fichaInternacaoModal.boxEl) {
    fichaInternacaoModal.boxEl.textContent = record.box || 'Não atribuído';
  }
  if (fichaInternacaoModal.altaEl) fichaInternacaoModal.altaEl.textContent = formatDateTimeLabel(record.altaPrevistaISO);
  if (fichaInternacaoModal.duracaoEl) fichaInternacaoModal.duracaoEl.textContent = formatDurationSince(record.admissao);
  if (fichaInternacaoModal.vetEl) fichaInternacaoModal.vetEl.textContent = record.veterinario || '—';
  if (fichaInternacaoModal.codigoEl) fichaInternacaoModal.codigoEl.textContent = record.codigo !== null && record.codigo !== undefined ? `#${record.codigo}` : '—';
  if (fichaInternacaoModal.admissaoEl) fichaInternacaoModal.admissaoEl.textContent = formatDateTimeLabel(record.admissao);
  if (fichaInternacaoModal.actionsContainer) {
    const obitoBtn = fichaInternacaoModal.actionsContainer.querySelector('[data-ficha-action="obito"]');
    if (obitoBtn) {
      const disabled = !!record.obitoRegistrado;
      obitoBtn.disabled = disabled;
      obitoBtn.classList.toggle('opacity-60', disabled);
      obitoBtn.classList.toggle('cursor-not-allowed', disabled);
      obitoBtn.textContent = disabled ? 'Óbito registrado' : 'Óbito';
    }
    const cancelBtn = fichaInternacaoModal.actionsContainer.querySelector('[data-ficha-action="cancelar"]');
    if (cancelBtn) {
      const cancelado = record.cancelado || normalizeActionKey(record.situacaoCodigo) === 'cancelado';
      const disabled = cancelado || !!record.obitoRegistrado;
      cancelBtn.disabled = disabled;
      cancelBtn.classList.toggle('opacity-60', disabled);
      cancelBtn.classList.toggle('cursor-not-allowed', disabled);
      cancelBtn.textContent = cancelado ? 'Cancelada' : 'Cancelar';
    }
    const boxBtn = fichaInternacaoModal.actionsContainer.querySelector('[data-ficha-action="box"]');
    if (boxBtn) {
      const disabled =
        !!record.obitoRegistrado || record.cancelado || normalizeActionKey(record.situacaoCodigo) === 'cancelado';
      boxBtn.disabled = disabled;
      boxBtn.classList.toggle('opacity-60', disabled);
      boxBtn.classList.toggle('cursor-not-allowed', disabled);
      boxBtn.textContent = disabled ? 'Box indisponível' : 'Box';
    }
  }

  renderFichaTags(record.alergias || []);
  renderFichaHistorico(record);
  renderFichaPrescricoes(record);
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

async function fetchInternacoesData(dataset, state = {}, { quiet = false, onUpdate } = {}) {
  if (state) {
    state.internacoesLoading = true;
    state.internacoesError = '';
  }
  if (typeof onUpdate === 'function') onUpdate();

  try {
    const data = await requestJson('/internacao/registros');
    const normalized = Array.isArray(data) ? data.map(normalizeInternacaoRecord).filter(Boolean) : [];
    const sorted = [...normalized].sort((a, b) => {
      const aTime = new Date(a.admissao || a.createdAt || 0).getTime();
      const bTime = new Date(b.admissao || b.createdAt || 0).getTime();
      return bTime - aTime;
    });
    if (dataset) dataset.internacoes = sorted;
    if (state) {
      state.internacoes = sorted;
      state.internacoesLoading = false;
    }
    if (state && state.petId) {
      const availableKeys = new Set(sorted.map((item) => item.filterKey));
      if (availableKeys.size && !availableKeys.has(state.petId)) {
        state.petId = '';
      }
    }
    fillPetFilters(dataset, state?.petId, state);
    if (typeof onUpdate === 'function') onUpdate();
    return sorted;
  } catch (error) {
    console.error('internacao: falha ao carregar internações', error);
    if (state) {
      state.internacoesError = error.message || 'Não foi possível carregar as internações.';
      state.internacoesLoading = false;
    }
    if (typeof onUpdate === 'function') onUpdate();
    if (!quiet) {
      showToastMessage(state?.internacoesError || 'Não foi possível carregar as internações.', 'warning');
    }
    return [];
  }
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

function setupAnimaisPage(dataset, state, render, fetchInternacoes) {
  const root = document.querySelector('[data-internacao-root]');
  const loadInternacoes = (options = {}) => {
    if (typeof fetchInternacoes === 'function') {
      return fetchInternacoes(options);
    }
    return Promise.resolve([]);
  };

  if (root) {
    root.addEventListener('click', (event) => {
      if (event.target.closest('[data-internacoes-retry]')) {
        event.preventDefault();
        loadInternacoes({ quiet: false });
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

  loadInternacoes();
}

function setupMapaPage(dataset, state, render, fetchInternacoes) {
  const root = document.querySelector('[data-internacao-root]');
  const loadInternacoes = (options = {}) => {
    if (typeof fetchInternacoes === 'function') {
      return fetchInternacoes(options);
    }
    return Promise.resolve([]);
  };

  const parseLocalDate = (value) => {
    if (!value) return null;
    const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
      const parsed = new Date(year, month - 1, day);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  };

  const shiftMapaDate = (delta) => {
    const current = state.execucaoData || getLocalDateInputValue();
    const base = parseLocalDate(current) || parseLocalDate(getLocalDateInputValue());
    if (!base) {
      state.execucaoData = getLocalDateInputValue();
      if (typeof render === 'function') render();
      return;
    }

    base.setDate(base.getDate() + delta);
    state.execucaoData = getLocalDateInputValue(base);
    if (typeof render === 'function') {
      render();
    }
  };

  if (root) {
    root.addEventListener('click', (event) => {
      if (event.target.closest('[data-internacoes-retry]')) {
        event.preventDefault();
        loadInternacoes({ quiet: false });
        return;
      }
      if (event.target.closest('[data-mapa-dia-prev]')) {
        event.preventDefault();
        shiftMapaDate(-1);
        return;
      }
      if (event.target.closest('[data-mapa-dia-next]')) {
        event.preventDefault();
        shiftMapaDate(1);
      }
    });
  }

  loadInternacoes();
}

window.addEventListener('internacao:execucao:submit', handleExecucaoSubmitEvent);

document.addEventListener('DOMContentLoaded', () => {
  const root = document.querySelector('[data-internacao-root]');
  const view = document.body?.dataset?.internacaoPage || '';
  if (!root || !view) return;

  const dataset = getDataset();
  const state = {
    petId: '',
    execucaoData: getLocalDateInputValue(),
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
    render: null,
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

  state.render = render;

  const fetchInternacoes = (options = {}) =>
    fetchInternacoesData(dataset, state, { onUpdate: render, ...options });
  state.refreshInternacoes = () => fetchInternacoes({ quiet: true });

  state.refreshBoxes = () => fetchBoxesData(dataset, state, { quiet: true });

  fillPetFilters(dataset, state.petId, state);
  updateSyncInfo(dataset);
  render();

  if (view === 'animais') {
    setupAnimaisPage(dataset, state, render, fetchInternacoes);
  }
  if (view === 'mapa') {
    setupMapaPage(dataset, state, render, fetchInternacoes);
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
