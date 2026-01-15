// Core utilities and shared state for the Vet ficha clínica feature
import { confirmWithModal } from '../../shared/confirm-modal.js';

let authToken = null;
try {
  const storedUser = JSON.parse(localStorage.getItem('loggedInUser') || 'null');
  authToken = storedUser?.token || null;
} catch {
  authToken = null;
}

export function getAuthToken() {
  return authToken;
}

let verifiedRole = '';
let verifiedRolePromise = null;

async function fetchVerifiedRole() {
  const token = getAuthToken();
  if (!token) return '';
  try {
    const resp = await fetch(`${API_CONFIG.BASE_URL}/auth/check`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!resp.ok) return '';
    const data = await resp.json();
    const role = data?.role || '';
    verifiedRole = role;
    if (role) {
      const cached = JSON.parse(localStorage.getItem('loggedInUser') || 'null') || {};
      localStorage.setItem('loggedInUser', JSON.stringify({ ...cached, role }));
    }
    return verifiedRole;
  } catch (_) {
    verifiedRole = '';
    return '';
  }
}

export function ensureVerifiedRole() {
  if (verifiedRolePromise) return verifiedRolePromise;
  verifiedRolePromise = fetchVerifiedRole();
  return verifiedRolePromise;
}

export function api(path, opts = {}) {
  const token = getAuthToken();
  return fetch(`${API_CONFIG.BASE_URL}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
}

export function notify(message, type = 'info') {
  const text = String(message || '').trim();
  if (!text) return;
  if (typeof window !== 'undefined' && typeof window.showToast === 'function') {
    try {
      window.showToast(text, type);
      return;
    } catch (err) {
      console.error('notify/showToast', err);
    }
  }
  try {
    alert(text);
  } catch (_) {
    console.log(text);
  }
}

export function debounce(fn, wait) {
  let timeoutId;
  return function debounced(...args) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn.apply(this, args), wait);
  };
}

export function formatPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length >= 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7, 11)}`;
  if (digits.length >= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6, 10)}`;
  return digits || '';
}

export function getCurrentUserRole() {
  return verifiedRole || '';
}

export function getCurrentUserId() {
  try {
    const cached = JSON.parse(localStorage.getItem('loggedInUser') || 'null');
    return normalizeId(cached?.id || cached?._id || cached?.userId || cached?.usuarioId);
  } catch {
    return '';
  }
}

export function isAdminRole(role = getCurrentUserRole()) {
  const normalized = String(role || '').toLowerCase();
  return normalized === 'admin' || normalized === 'admin_master';
}

export { confirmWithModal };

export const els = {
  cliInput: document.getElementById('vet-cli-input'),
  cliSug: document.getElementById('vet-cli-sug'),
  cliClear: document.getElementById('vet-cli-clear'),
  petSelect: document.getElementById('vet-pet-select'),
  petClear: document.getElementById('vet-pet-clear'),
  cardIcon: document.getElementById('vet-info-icon'),
  cardIconSymbol: document.getElementById('vet-info-icon-symbol'),
  tutorInfo: document.getElementById('vet-tutor-info'),
  tutorNome: document.getElementById('vet-tutor-nome'),
  tutorEmail: document.getElementById('vet-tutor-email'),
  tutorTelefone: document.getElementById('vet-tutor-telefone'),
  petInfo: document.getElementById('vet-pet-info'),
  petNome: document.getElementById('vet-pet-nome'),
  petMainDetails: document.getElementById('vet-pet-main-details'),
  petTipoWrapper: document.getElementById('vet-pet-tipo-wrapper'),
  petTipo: document.getElementById('vet-pet-tipo'),
  petRacaWrapper: document.getElementById('vet-pet-raca-wrapper'),
  petRaca: document.getElementById('vet-pet-raca'),
  petNascimentoWrapper: document.getElementById('vet-pet-nascimento-wrapper'),
  petNascimento: document.getElementById('vet-pet-nascimento'),
  petPesoWrapper: document.getElementById('vet-pet-peso-wrapper'),
  petPeso: document.getElementById('vet-pet-peso'),
  petExtraContainer: document.getElementById('vet-pet-extra'),
  petCorWrapper: document.getElementById('vet-pet-cor-wrapper'),
  petCor: document.getElementById('vet-pet-cor'),
  petSexoWrapper: document.getElementById('vet-pet-sexo-wrapper'),
  petSexo: document.getElementById('vet-pet-sexo'),
  petRgaWrapper: document.getElementById('vet-pet-rga-wrapper'),
  petRga: document.getElementById('vet-pet-rga'),
  petMicrochipWrapper: document.getElementById('vet-pet-microchip-wrapper'),
  petMicrochip: document.getElementById('vet-pet-microchip'),
  toggleTutor: document.getElementById('vet-card-show-tutor'),
  togglePet: document.getElementById('vet-card-show-pet'),
  pageContent: document.getElementById('vet-ficha-content'),
  topTabs: document.getElementById('vet-top-tabs'),
  consultaArea: document.getElementById('vet-consulta-area'),
  historicoArea: document.getElementById('vet-historico-area'),
  historicoTab: document.getElementById('vet-tab-historico'),
  consultaTab: document.getElementById('vet-tab-consulta'),
  addConsultaBtn: document.getElementById('vet-add-consulta-btn'),
  reopenAgendamentoBtn: document.getElementById('vet-reopen-agendamento-btn'),
  addVacinaBtn: document.getElementById('vet-add-vacina-btn'),
  addAnexoBtn: document.getElementById('vet-add-anexo-btn'),
  addDocumentoBtn: document.getElementById('vet-add-documento-btn'),
  addReceitaBtn: document.getElementById('vet-add-receita-btn'),
  addExameBtn: document.getElementById('vet-add-exame-btn'),
  addPesoBtn: document.getElementById('vet-add-peso-btn'),
  addObservacaoBtn: document.getElementById('vet-add-observacao-btn'),
  openVendasBtn: document.getElementById('vet-open-vendas-btn'),
  openInternacaoBtn: document.getElementById('vet-open-internacao-btn'),
  colocarEmEsperaBtn: document.getElementById('vet-colocar-em-espera'),
  iniciarAtendimentoBtn: document.getElementById('vet-iniciar-atendimento'),
  finalizarAtendimentoBtn: document.getElementById('vet-finalizar-atendimento'),
  limparConsultaBtn: document.getElementById('vet-clear-consulta'),
};

export const state = {
  selectedCliente: null,
  selectedPetId: null,
  petsById: {},
  currentCardMode: 'tutor',
  agendaContext: null,
  consultas: [],
  consultasLoading: false,
  consultasLoadKey: null,
  vacinas: [],
  anexos: [],
  anexosLoading: false,
  anexosLoadKey: null,
  exames: [],
  examesLoading: false,
  examesLoadKey: null,
  pesos: [],
  pesosLoading: false,
  pesosLoadKey: null,
  observacoes: [],
  documentos: [],
  documentosLoading: false,
  documentosLoadKey: null,
  receitas: [],
  receitasLoading: false,
  receitasLoadKey: null,
  vendas: [],
  vendasLoading: false,
  vendasLoadKey: null,
  waitingAppointments: [],
  waitingAppointmentsLoading: false,
  waitingAppointmentsLoadKey: null,
  historicos: [],
  historicosLoadKey: null,
  historicosLoading: false,
  activeMainTab: 'consulta',
};

export const consultaModal = {
  overlay: null,
  dialog: null,
  form: null,
  titleEl: null,
  submitBtn: null,
  cancelBtn: null,
  fields: {},
  contextInfo: null,
  mode: 'create',
  editingId: null,
  keydownHandler: null,
  isSubmitting: false,
  activeServiceId: null,
  activeServiceName: '',
};

export const vacinaModal = {
  overlay: null,
  dialog: null,
  form: null,
  submitBtn: null,
  cancelBtn: null,
  titleEl: null,
  closeBtn: null,
  fields: {},
  suggestionsEl: null,
  priceDisplay: null,
  selectedService: null,
  isSubmitting: false,
  keydownHandler: null,
  searchAbortController: null,
  mode: 'create',
  editingId: null,
  editingRecord: null,
  submitBtnOriginalText: '',
  submitBtnEditText: '',
};

export const exameModal = {
  overlay: null,
  dialog: null,
  form: null,
  submitBtn: null,
  cancelBtn: null,
  closeBtn: null,
  titleEl: null,
  contextInfo: null,
  suggestionsEl: null,
  priceDisplay: null,
  fields: {},
  selectedService: null,
  addFileBtn: null,
  fileNameInput: null,
  fileInput: null,
  dropzone: null,
  dropzoneText: null,
  dropzoneHint: null,
  filesList: null,
  filesEmptyState: null,
  selectedFiles: [],
  pendingFile: null,
  isSubmitting: false,
  keydownHandler: null,
  searchAbortController: null,
  mode: 'create',
  editingId: null,
  editingRecord: null,
  existingFiles: [],
  removedFileIds: [],
};

export const anexoModal = {
  overlay: null,
  dialog: null,
  form: null,
  titleEl: null,
  submitBtn: null,
  submitBtnOriginalHtml: '',
  submitBtnIdleHtml: '',
  submitDefaultText: '',
  mode: 'create',
  editingId: null,
  editingRecord: null,
  existingFiles: [],
  removedFileIds: [],
  currentObservacao: '',
  cancelBtn: null,
  addBtn: null,
  nameInput: null,
  fileInput: null,
  dropzone: null,
  dropzoneText: null,
  dropzoneHint: null,
  filesList: null,
  emptyState: null,
  contextInfo: null,
  selectedFiles: [],
  pendingFile: null,
  isSubmitting: false,
  keydownHandler: null,
};

export const pesoModal = {
  overlay: null,
  dialog: null,
  form: null,
  submitBtn: null,
  submitBtnOriginalHtml: '',
  submitBtnEditHtml: '',
  cancelBtn: null,
  closeBtn: null,
  input: null,
  list: null,
  emptyState: null,
  loadingState: null,
  summary: null,
  isSubmitting: false,
  keydownHandler: null,
  mode: 'create',
  editingId: null,
  editingRecord: null,
  context: null,
  onClose: null,
};

export const STORAGE_KEYS = {
  cliente: 'vetFichaSelectedCliente',
  petId: 'vetFichaSelectedPetId',
  agenda: 'vetFichaAgendaContext',
};

export const VACINA_STORAGE_PREFIX = 'vetFichaVacinas:';
export const ANEXO_STORAGE_PREFIX = 'vetFichaAnexos:';
export const EXAME_STORAGE_PREFIX = 'vetFichaExames:';
export const OBSERVACAO_STORAGE_PREFIX = 'vetFichaObservacoes:';
export const EXAME_ATTACHMENT_OBSERVACAO_PREFIX = '__vet_exame__:';
export const HISTORICO_STORAGE_PREFIX = 'vetFichaHistorico:';
export const OBJECT_ID_REGEX = /^[0-9a-fA-F]{24}$/;

export const CARD_TUTOR_ACTIVE_CLASSES = ['bg-sky-100', 'text-sky-700'];
export const CARD_PET_ACTIVE_CLASSES = ['bg-emerald-100', 'text-emerald-700'];
export const CARD_BUTTON_INACTIVE_CLASSES = ['bg-gray-100', 'text-gray-600'];
export const CARD_BUTTON_DISABLED_CLASSES = ['opacity-50', 'cursor-not-allowed'];
export const CONSULTA_PLACEHOLDER_CLASSNAMES = 'h-[420px] rounded-lg bg-white border border-dashed border-gray-300 flex flex-col items-center justify-center text-sm text-gray-500 text-center px-6';
export const CONSULTA_CARD_CLASSNAMES = 'h-[420px] rounded-lg bg-white border border-gray-200 shadow-sm overflow-hidden';
export const CONSULTA_PLACEHOLDER_TEXT = 'Selecione um agendamento na agenda para carregar os serviços veterinários.';
export const CONSULTA_FINALIZADA_PLACEHOLDER_TEXT = 'Nenhum agendamento para iniciar uma consulta.';

export const STATUS_LABELS = {
  agendado: 'Agendado',
  em_espera: 'Em espera',
  em_atendimento: 'Em atendimento',
  finalizado: 'Finalizado',
};

export const ANEXO_ALLOWED_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.pdf'];
export const ANEXO_ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'application/pdf'];

export const PET_PLACEHOLDERS = {
  nome: 'Nome do Pet',
  tipo: '—',
  raca: '—',
  nascimento: '—',
  peso: '—',
};

export function pickFirst(...values) {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const str = String(value).trim();
    if (str) return str;
  }
  return '';
}

export function buildAbsoluteUrl(path, { fallback = '' } = {}) {
  let raw = '';
  if (typeof path === 'string') {
    raw = path;
  } else if (path && typeof path === 'object') {
    if (typeof path.url === 'string') {
      raw = path.url;
    } else if (typeof path.href === 'string') {
      raw = path.href;
    }
  }

  const trimmed = String(raw || '').trim();
  if (!trimmed) return String(fallback || '');
  if (/^(?:[a-z]+:)?\/\//i.test(trimmed) || trimmed.startsWith('data:')) {
    return trimmed;
  }

  const base = (typeof API_CONFIG === 'object' && API_CONFIG && API_CONFIG.SERVER_URL) || '';
  const normalizedBase = String(base || '').replace(/\/+$/, '');
  if (!normalizedBase) {
    const normalizedPath = trimmed.startsWith('/') ? trimmed : `/${trimmed.replace(/^\/+/, '')}`;
    return normalizedPath || String(fallback || '');
  }

  const normalizedPath = trimmed.startsWith('/') ? trimmed : `/${trimmed.replace(/^\/+/, '')}`;
  const absolute = `${normalizedBase}${normalizedPath}`;
  return absolute || String(fallback || '');
}

export function normalizeForCompare(value) {
  const str = String(value || '');
  if (typeof String.prototype.normalize === 'function') {
    return str
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  }
  return str.toLowerCase();
}

export function normalizeId(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    if (value._id) return String(value._id).trim();
    if (value.id) return String(value.id).trim();
  }
  if (typeof value === 'number') return String(value);
  return String(value).trim();
}

export function sanitizeObjectId(value) {
  const raw = normalizeId(value);
  if (!raw) return '';
  const cleaned = raw
    .replace(/^ObjectId\(["']?/, '')
    .replace(/["']?\)$/, '');
  return OBJECT_ID_REGEX.test(cleaned) ? cleaned : '';
}

export function isAgendaContextFinalizado(context = state.agendaContext) {
  const status = normalizeForCompare(context?.status);
  return status === 'finalizado';
}

export function isAgendaContextForSelection(clienteId, petId, context = state.agendaContext) {
  if (!context || typeof context !== 'object') return false;
  const appointmentId = normalizeId(context.appointmentId);
  if (!appointmentId) return false;
  const tutorId = normalizeId(context.tutorId);
  const petContextId = normalizeId(context.petId);
  const targetTutorId = normalizeId(clienteId);
  const targetPetId = normalizeId(petId);
  if (!(tutorId && petContextId && targetTutorId && targetPetId)) return false;
  return tutorId === targetTutorId && petContextId === targetPetId;
}

export function isFinalizadoSelection(clienteId, petId, context = state.agendaContext) {
  if (!isAgendaContextFinalizado(context)) return false;
  return isAgendaContextForSelection(clienteId, petId, context);
}

export function isAgendaContextPaid(context = state.agendaContext) {
  if (!context || typeof context !== 'object') return false;
  if (context.pagamentoRegistrado) return true;

  const pagoValue = context.pago;
  if (typeof pagoValue === 'boolean') {
    if (pagoValue) return true;
  } else if (typeof pagoValue === 'number') {
    if (!Number.isNaN(pagoValue) && pagoValue !== 0) return true;
  } else if (typeof pagoValue === 'string') {
    const normalized = pagoValue.trim().toLowerCase();
    if (['true', '1', 'sim', 'yes', 'y'].includes(normalized)) {
      return true;
    }
    if (['false', '0', 'nao', 'não', 'no', 'n'].includes(normalized)) {
      // explicit false
    } else if (normalized) {
      return true;
    }
  } else if (pagoValue) {
    return true;
  }

  const codigoVenda = pickFirst(
    context.codigoVenda,
    context.codigo_venda,
    context.codVenda,
    context.cod_venda,
  );
  return !!codigoVenda;
}

export function isConsultaLockedForCurrentUser(context = state.agendaContext) {
  if (!context || typeof context !== 'object') return false;
  const role = String(getCurrentUserRole() || '').trim().toLowerCase();
  if (role === 'admin_master') {
    return false;
  }
  const assignedId = normalizeId(
    context.profissionalId ||
      (context.profissional && (context.profissional._id || context.profissional.id)) ||
      context.profissionalIdCandidate,
  );
  if (!assignedId) return false;
  const currentUserId = getCurrentUserId();
  if (!currentUserId) return false;
  return assignedId !== currentUserId;
}

export function capitalize(value) {
  const str = String(value || '').trim();
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export function formatPetSex(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const normalized = normalizeForCompare(raw);
  if (['m', 'macho', 'male', 'masculino'].includes(normalized)) return 'Macho';
  if (['f', 'femea', 'female', 'feminino'].includes(normalized)) return 'Fêmea';
  return capitalize(raw);
}

export function formatPetRga(value) {
  const raw = String(value || '').trim();
  return raw ? raw.toUpperCase() : '';
}

export function formatPetMicrochip(value) {
  return String(value || '').trim();
}

export function setPetDetailField(value, valueEl, wrapperEl, { forceShow = false } = {}) {
  if (!valueEl || !wrapperEl) return false;
  const str = String(value || '').trim();
  if (str) {
    valueEl.textContent = str;
    wrapperEl.classList.remove('hidden');
    return true;
  }
  valueEl.textContent = '—';
  if (forceShow) {
    wrapperEl.classList.remove('hidden');
  } else {
    wrapperEl.classList.add('hidden');
  }
  return false;
}

export function setPetExtraField(value, valueEl, wrapperEl) {
  if (!valueEl || !wrapperEl) return false;
  const str = String(value || '').trim();
  if (str) {
    valueEl.textContent = str;
    wrapperEl.classList.remove('hidden');
    return true;
  }
  valueEl.textContent = '—';
  wrapperEl.classList.add('hidden');
  return false;
}

export function clearPetExtras() {
  if (els.petExtraContainer) {
    els.petExtraContainer.classList.add('hidden');
  }
  [els.petCorWrapper, els.petSexoWrapper, els.petRgaWrapper, els.petMicrochipWrapper].forEach((wrapper) => {
    if (wrapper) wrapper.classList.add('hidden');
  });
  if (els.petCor) els.petCor.textContent = '—';
  if (els.petSexo) els.petSexo.textContent = '—';
  if (els.petRga) els.petRga.textContent = '—';
  if (els.petMicrochip) els.petMicrochip.textContent = '—';
}

export function persistCliente(cliente) {
  try {
    const id = normalizeId(cliente?._id);
    if (id) {
      const nome = pickFirst(cliente?.nome);
      const email = pickFirst(cliente?.email);
      const primaryPhone = pickFirst(cliente?.celular, cliente?.telefone);
      const secondaryPhone = pickFirst(
        cliente?.telefone && cliente?.telefone !== primaryPhone ? cliente.telefone : '',
        cliente?.celular && cliente?.celular !== primaryPhone ? cliente.celular : '',
      );
      const cpfValue = pickFirst(cliente?.cpf);
      const cnpjValue = pickFirst(cliente?.cnpj);
      const inscricaoEstadualValue = pickFirst(cliente?.inscricaoEstadual);
      const documentValue = pickFirst(
        cliente?.documento,
        cliente?.documentoPrincipal,
        cliente?.cpfCnpj,
        cliente?.doc,
        cpfValue,
        cnpjValue,
        inscricaoEstadualValue,
      );
      const payload = {
        _id: id,
        nome,
        email,
        celular: primaryPhone,
      };
      if (secondaryPhone) {
        payload.telefone = secondaryPhone;
      }
      if (cliente?.tipoConta) {
        payload.tipoConta = cliente.tipoConta;
      }
      if (cpfValue) {
        payload.cpf = cpfValue;
      }
      if (cnpjValue) {
        payload.cnpj = cnpjValue;
      }
      if (inscricaoEstadualValue) {
        payload.inscricaoEstadual = inscricaoEstadualValue;
      }
      if (documentValue) {
        const digits = String(documentValue).replace(/\D+/g, '');
        payload.documento = documentValue;
        payload.documentoPrincipal = documentValue;
        payload.doc = documentValue;
        payload.cpfCnpj = pickFirst(cpfValue, cnpjValue, documentValue);
        if (!payload.cpf && digits.length === 11) {
          payload.cpf = documentValue;
        } else if (!payload.cnpj && digits.length === 14) {
          payload.cnpj = documentValue;
        }
      } else if (payload.cpf || payload.cnpj) {
        const principalDoc = pickFirst(payload.cpf, payload.cnpj);
        if (principalDoc) {
          payload.cpfCnpj = principalDoc;
          if (!payload.documento) payload.documento = principalDoc;
          if (!payload.documentoPrincipal) payload.documentoPrincipal = principalDoc;
          if (!payload.doc) payload.doc = principalDoc;
        }
      }
      localStorage.setItem(STORAGE_KEYS.cliente, JSON.stringify(payload));
    } else {
      localStorage.removeItem(STORAGE_KEYS.cliente);
    }
  } catch {
    // ignore persistence errors
  }
}

export function persistPetId(petId) {
  try {
    if (petId) {
      localStorage.setItem(STORAGE_KEYS.petId, petId);
    } else {
      localStorage.removeItem(STORAGE_KEYS.petId);
    }
  } catch {
    // ignore persistence errors
  }
}

export function persistAgendaContext(context) {
  try {
    if (context && typeof context === 'object') {
      localStorage.setItem(STORAGE_KEYS.agenda, JSON.stringify(context));
    } else {
      localStorage.removeItem(STORAGE_KEYS.agenda);
    }
  } catch {
    // ignore persistence errors
  }
}

export function getAgendaStoreId(options = {}) {
  const { persist = true } = options || {};
  if (!state.agendaContext || typeof state.agendaContext !== 'object') return '';

  const current = sanitizeObjectId(state.agendaContext.storeId);
  if (current) {
    state.agendaContext.storeId = current;
    if (!Array.isArray(state.agendaContext.storeIdCandidates)) {
      state.agendaContext.storeIdCandidates = [];
    }
    if (!state.agendaContext.storeIdCandidates.includes(current)) {
      state.agendaContext.storeIdCandidates.push(current);
    }
    if (persist) {
      persistAgendaContext(state.agendaContext);
    }
    return current;
  }

  const candidates = [
    state.agendaContext.store,
    state.agendaContext.store_id,
    state.agendaContext.storeID,
    state.agendaContext.empresaId,
    state.agendaContext.empresa,
    state.agendaContext.lojaId,
    state.agendaContext.loja,
    state.agendaContext.companyId,
    state.agendaContext.company,
    state.agendaContext.filialId,
    state.agendaContext.filial,
    state.agendaContext.selectedStoreId,
  ];

  if (Array.isArray(state.agendaContext.storeIdCandidates)) {
    candidates.push(...state.agendaContext.storeIdCandidates);
  }

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      for (const nested of candidate) {
        const normalizedNested = sanitizeObjectId(nested);
        if (normalizedNested) {
          state.agendaContext.storeId = normalizedNested;
          if (!Array.isArray(state.agendaContext.storeIdCandidates)) {
            state.agendaContext.storeIdCandidates = [];
          }
          if (!state.agendaContext.storeIdCandidates.includes(normalizedNested)) {
            state.agendaContext.storeIdCandidates.push(normalizedNested);
          }
          if (persist) {
            persistAgendaContext(state.agendaContext);
          }
          return normalizedNested;
        }
      }
      continue;
    }
    const normalized = sanitizeObjectId(candidate);
    if (normalized) {
      state.agendaContext.storeId = normalized;
      if (!Array.isArray(state.agendaContext.storeIdCandidates)) {
        state.agendaContext.storeIdCandidates = [];
      }
      if (!state.agendaContext.storeIdCandidates.includes(normalized)) {
        state.agendaContext.storeIdCandidates.push(normalized);
      }
      if (persist) {
        persistAgendaContext(state.agendaContext);
      }
      return normalized;
    }
  }

  return '';
}

export function getPersistedState() {
  let cliente = null;
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.cliente);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed._id) {
        cliente = parsed;
      }
    }
  } catch {
    cliente = null;
  }

  const petId = localStorage.getItem(STORAGE_KEYS.petId) || null;
  let agendaContext = null;
  try {
    const rawAgenda = localStorage.getItem(STORAGE_KEYS.agenda);
    if (rawAgenda) {
      const parsedAgenda = JSON.parse(rawAgenda);
      if (parsedAgenda && typeof parsedAgenda === 'object') {
        agendaContext = parsedAgenda;
      }
    }
  } catch {
    agendaContext = null;
  }

  return { cliente, petId, agendaContext };
}

export async function fetchClienteById(id) {
  const normalizedId = normalizeId(id);
  if (!normalizedId) return null;
  try {
    const resp = await api(`/func/clientes/${normalizedId}`);
    if (!resp.ok) return null;
    const data = await resp.json().catch(() => null);
    if (!data || !data._id) return null;
    const cpfValue = pickFirst(data.cpf);
    const cnpjValue = pickFirst(data.cnpj);
    const inscricaoEstadualValue = pickFirst(data.inscricaoEstadual);
    const documentValue = pickFirst(
      data.documento,
      data.documentoPrincipal,
      data.cpfCnpj,
      cpfValue,
      cnpjValue,
      inscricaoEstadualValue,
    );
    const payload = {
      _id: normalizeId(data._id),
      nome: pickFirst(data.nome),
      email: pickFirst(data.email),
      celular: pickFirst(data.celular, data.telefone),
      telefone: pickFirst(data.telefone, data.celular),
    };
    if (cpfValue) payload.cpf = cpfValue;
    if (cnpjValue) payload.cnpj = cnpjValue;
    if (inscricaoEstadualValue) payload.inscricaoEstadual = inscricaoEstadualValue;
    if (documentValue) {
      const digits = String(documentValue).replace(/\D+/g, '');
      payload.documento = documentValue;
      payload.documentoPrincipal = documentValue;
      payload.doc = documentValue;
      payload.cpfCnpj = pickFirst(cpfValue, cnpjValue, documentValue);
      if (!payload.cpf && digits.length === 11) {
        payload.cpf = documentValue;
      } else if (!payload.cnpj && digits.length === 14) {
        payload.cnpj = documentValue;
      }
    }
    return payload;
  } catch {
    return null;
  }
}

export function formatDateDisplay(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  try {
    return new Intl.DateTimeFormat('pt-BR').format(date);
  } catch {
    return date.toLocaleDateString('pt-BR');
  }
}

export function formatDateTimeDisplay(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  try {
    const dateStr = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
    const timeStr = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(date);
    return `${dateStr} às ${timeStr}`;
  } catch {
    const dateStr = date.toLocaleDateString('pt-BR');
    const timeStr = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    return `${dateStr} às ${timeStr}`;
  }
}

export function formatPetWeight(value) {
  if (value === null || value === undefined || value === '') return '';
  const num = Number(value);
  if (Number.isFinite(num)) {
    return `${num.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} Kg`;
  }
  const str = String(value).trim();
  if (!str) return '';
  return /kg$/i.test(str) ? str : `${str} Kg`;
}

export function parseWeightValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  const raw = String(value).trim();
  if (!raw) return null;
  const sanitized = raw.replace(/[^0-9.,]+/g, '');
  if (!sanitized) return null;
  const hasComma = sanitized.includes(',');
  let normalized = sanitized;
  if (hasComma) {
    normalized = sanitized.replace(/\./g, '').replace(',', '.');
  } else {
    const firstDot = sanitized.indexOf('.');
    if (firstDot >= 0) {
      const before = sanitized.slice(0, firstDot + 1);
      const after = sanitized.slice(firstDot + 1).replace(/\./g, '');
      normalized = `${before}${after}`;
    }
  }
  const num = Number(normalized);
  if (!Number.isFinite(num)) return null;
  return num;
}

export function computeWeightDifference(currentValue, baselineValue) {
  const current = parseWeightValue(currentValue);
  const baseline = parseWeightValue(baselineValue);
  if (current === null || baseline === null) return null;
  const diff = current - baseline;
  if (!Number.isFinite(diff)) return null;
  return Number(diff.toFixed(4));
}

export function formatWeightDelta(diff, { showZero = false } = {}) {
  const value = Number(diff);
  if (!Number.isFinite(value)) return '';
  if (Math.abs(value) < 0.005) {
    return showZero ? '0 Kg' : 'Sem variação';
  }
  const absolute = Math.abs(value);
  const formatted = absolute.toLocaleString('pt-BR', {
    minimumFractionDigits: Number.isInteger(absolute) ? 0 : 1,
    maximumFractionDigits: 2,
  });
  const sign = value > 0 ? '+' : '-';
  return `${sign}${formatted} Kg`;
}

export function formatWeightDifference(currentValue, baselineValue, options = {}) {
  const diff = computeWeightDifference(currentValue, baselineValue);
  if (diff === null) return '';
  return formatWeightDelta(diff, options);
}

export function formatMoney(value) {
  const num = Number(value || 0);
  if (Number.isNaN(num)) return 'R$ 0,00';
  try {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(num);
  } catch {
    return `R$ ${num.toFixed(2).replace('.', ',')}`;
  }
}

export function getFileExtension(filename) {
  if (!filename) return '';
  const lower = String(filename).toLowerCase();
  const dotIndex = lower.lastIndexOf('.');
  if (dotIndex < 0) return '';
  return lower.slice(dotIndex);
}

export function formatFileSize(bytes) {
  const size = Number(bytes);
  if (!Number.isFinite(size) || size < 0) return '';
  if (size === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(size) / Math.log(1024)), units.length - 1);
  const value = size / Math.pow(1024, exponent);
  const formatted = value >= 10 || exponent === 0 ? value.toFixed(0) : value.toFixed(1);
  return `${formatted} ${units[exponent]}`;
}

export function normalizeBreedName(value) {
  if (!value) return '';
  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = normalizeBreedName(item);
      if (nested) return nested;
    }
    return '';
  }
  if (typeof value === 'object') {
    if (value.nome) return String(value.nome).trim();
    if (value.name) return String(value.name).trim();
    if (value.descricao) return String(value.descricao).trim();
    if (value.label) return String(value.label).trim();
    if (value.title) return String(value.title).trim();
    return '';
  }
  return String(value || '').trim();
}

export function mapPetTipoForPrice(value) {
  const norm = normalizeForCompare(value);
  if (!norm) return '';
  if (/cachorr|cao|canin|canid|dog/.test(norm)) return 'cachorro';
  if (/gat|felin|cat/.test(norm)) return 'gato';
  if (/passar|ave|bird|galinh|periquit|papagai|canar|calops|aves/.test(norm)) return 'passaro';
  if (/peix|fish|aquat/.test(norm)) return 'peixe';
  if (/roedor|hamst|coelh|porquinho|chinchil|rat|camundong|gerbil|rodent/.test(norm)) return 'roedor';
  if (/lagart|iguana|geco|gecko|tegu/.test(norm)) return 'lagarto';
  if (/tartarug|jabuti|quelon|caga/.test(norm)) return 'tartaruga';
  if (/exot|selvag|silvest|outro/.test(norm)) return 'exotico';
  return norm;
}

export function getSelectedPet() {
  const petId = state.selectedPetId;
  if (!petId) return null;
  return (state.petsById && state.petsById[petId]) || null;
}

export function getPetPriceCriteria() {
  const pet = getSelectedPet();
  if (!pet) return { tipo: '', raca: '' };

  const tipoCandidates = [
    pet.tipo,
    pet.tipoPet,
    pet.especie,
    pet.especiePet,
    pet.categoria,
    pet.category,
    pet.porte,
    pet.tipoAnimal,
    pet.tipoEspecie,
  ];
  let tipo = '';
  for (const candidate of tipoCandidates) {
    const mapped = mapPetTipoForPrice(candidate);
    if (mapped) {
      tipo = mapped;
      break;
    }
  }

  const racaCandidates = [
    pet.raca,
    pet.breed,
    pet.racaNome,
    pet.racaDescricao,
    pet.racaPrincipal,
    pet.racaOriginal,
    pet.racaPet,
    pet.racaLabel,
    pet?.raca?.nome,
    pet?.raca?.name,
    pet?.raca?.descricao,
    pet?.raca?.label,
  ];
  let raca = '';
  for (const candidate of racaCandidates) {
    const value = normalizeBreedName(candidate);
    if (value) {
      raca = value;
      break;
    }
  }

  return { tipo, raca };
}

export function isVetCategory(value) {
  const norm = normalizeForCompare(value);
  if (!norm) return false;
  const normalized = norm.replace(/[^a-z]/g, '');
  if (!normalized) return false;
  if (normalized.includes('veterinario')) return true;
  if (normalized.includes('exame')) return true;
  if (normalized.includes('vacina')) return true;
  return false;
}

export function isVetService(service) {
  if (!service) return false;
  const categories = [];
  if (Array.isArray(service.categorias)) categories.push(...service.categorias);
  if (Array.isArray(service.category)) categories.push(...service.category);
  if (service.categoria) categories.push(service.categoria);
  if (Array.isArray(service?.servico?.categorias)) categories.push(...service.servico.categorias);
  if (service.grupoNome) categories.push(service.grupoNome);
  if (service.grupo && service.grupo.nome) categories.push(service.grupo.nome);
  if (Array.isArray(service.tiposPermitidos)) categories.push(...service.tiposPermitidos);
  if (Array.isArray(service.allowedTipos)) categories.push(...service.allowedTipos);
  if (Array.isArray(service.allowedStaffTypes)) categories.push(...service.allowedStaffTypes);
  if (Array.isArray(service.allowedStaff)) categories.push(...service.allowedStaff);
  if (Array.isArray(service.grupoTiposPermitidos)) categories.push(...service.grupoTiposPermitidos);
  if (Array.isArray(service?.grupo?.tiposPermitidos)) categories.push(...service.grupo.tiposPermitidos);
  if (Array.isArray(service?.servico?.tiposPermitidos)) categories.push(...service.servico.tiposPermitidos);
  if (Array.isArray(service?.servico?.grupo?.tiposPermitidos)) categories.push(...service.servico.grupo.tiposPermitidos);
  if (service.tipoPermitido) categories.push(service.tipoPermitido);
  if (service.staffTipo) categories.push(service.staffTipo);
  if (service.tipo) categories.push(service.tipo);
  if (categories.some(isVetCategory)) return true;
  const nomeNorm = normalizeForCompare(service.nome || service.descricao || service.titulo || '');
  if (nomeNorm.includes('veterin')) return true;
  return false;
}

export function mapServiceForDisplay(service) {
  if (!service) return null;
  const nome = pickFirst(
    service.nome,
    service.descricao,
    service.titulo,
    typeof service === 'string' ? service : '',
  );
  return {
    _id: normalizeId(service._id || service.id || service.servico || service.servicoId),
    nome: nome || '—',
    valor: Number(service.valor || 0),
  };
}

export function getVetServices(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter(isVetService)
    .map(mapServiceForDisplay)
    .filter(Boolean);
}

export function getStatusKey(status) {
  if (!status) return '';
  return String(status).trim().toLowerCase().replace(/\s+/g, '_');
}

export function getStatusLabel(status) {
  const key = getStatusKey(status);
  return STATUS_LABELS[key] || (status ? capitalize(status) : '');
}

export function toIsoOrNull(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  try {
    return date.toISOString();
  } catch (_) {
    return null;
  }
}
