// Core/shared state and helpers for Banho e Tosa agenda
// ES module used by other parts of the feature.
import { confirmWithModal } from '../shared/confirm-modal.js';

// ----- Auth/API helpers -----
const _cachedUser = (() => {
  try { return JSON.parse(localStorage.getItem('loggedInUser') || 'null') || null; } catch { return null; }
})();
export const token = _cachedUser?.token || null;

let verifiedRole = '';
let verifiedRolePromise = null;

async function fetchVerifiedRole() {
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
  return fetch(`${API_CONFIG.BASE_URL}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    }
  });
}

export function getCurrentRole() {
  return verifiedRole || 'cliente';
}
export function isPrivilegedRole() {
  const r = getCurrentRole();
  return r === 'admin' || r === 'admin_master';
}


const TOAST_DEDUP_KEY = '__agendaToastState';
const TOAST_DEDUP_WINDOW = 1200;

function getToastStore() {
  if (typeof window !== 'undefined') return window;
  if (typeof globalThis !== 'undefined') return globalThis;
  if (typeof self !== 'undefined') return self;
  return null;
}

function getLastToast() {
  const store = getToastStore();
  return store && store[TOAST_DEDUP_KEY];
}

function rememberToast(text) {
  const store = getToastStore();
  if (!store) return;
  store[TOAST_DEDUP_KEY] = { text, time: Date.now() };
}

export function notify(message, type = 'warning') {
  const text = String(message || '');
  if (!text) return;

  const last = getLastToast();
  const now = Date.now();
  if (last && last.text === text && now - last.time < TOAST_DEDUP_WINDOW) {
    return;
  }

  const hasWindow = typeof window !== 'undefined';

  if (hasWindow && typeof window.showToast === 'function') {
    try {
      window.showToast(text, type);
      rememberToast(text);
      return;
    } catch (err) {
      console.error('notify/showToast', err);
    }
  }

  if (hasWindow && typeof window.alert === 'function') {
    rememberToast(text);
    window.alert(text);
  } else if (typeof alert === 'function') {
    rememberToast(text);
    alert(text);
  } else {
    rememberToast(text);
  }
}

export { confirmWithModal };

const customerRegisterModal = document.getElementById('agenda-customer-register-modal');

// ----- Elements -----
export const els = {
  agendaList: document.getElementById('agenda-list'),
  actionsRoot: document.getElementById('agenda-wrapper') || document.body,
  dateInput: document.getElementById('agenda-date'),
  dateLabelVisible: document.getElementById('agenda-date-label-visible'),
  viewSelect: document.getElementById('agenda-view'),
  addBtn: document.getElementById('add-service-btn'),
  storeSelect: document.getElementById('agenda-store'),
  storeLabelVisible: document.getElementById('agenda-store-label-visible'),

  // Modal add/editar
  modal: document.getElementById('modal-add-servico'),
  modalClose: document.getElementById('modal-add-close'),
  modalCancel: document.getElementById('modal-add-cancel'),
  modalSave: document.getElementById('modal-add-save'),
  modalDelete: document.getElementById('modal-add-delete'),

  addStoreSelect: document.getElementById('add-store-select'),
  addDateInput: document.getElementById('add-date'),
  statusSelect: document.getElementById('add-status'),
  cliInput: document.getElementById('add-cli-input'),
  cliSug: document.getElementById('add-cli-sug'),
  petSelect: document.getElementById('add-pet-select'),
  servInput: document.getElementById('add-serv-input'),
  servSug: document.getElementById('add-serv-sug'),
  valorInput: document.getElementById('add-valor'),
  addServAddBtn: document.getElementById('add-serv-add-btn'),
  servListUL: document.getElementById('add-serv-list'),
  servTotalEl: document.getElementById('add-serv-total'),
  obsInput: document.getElementById('add-observacoes'),
  horaInput: document.getElementById('add-hora'),
  profSelect: document.getElementById('add-prof-select'),
  profLabel: document.getElementById('add-prof-label'),

  customerRegisterButton: document.getElementById('agenda-customer-register'),
  customerRegisterModal,
  customerRegisterBackdrop: customerRegisterModal?.querySelector('[data-agenda-customer-register-dismiss="backdrop"]') || null,
  customerRegisterClose: customerRegisterModal?.querySelector('[data-agenda-customer-register-dismiss="close"]') || null,
  customerRegisterFrame: customerRegisterModal?.querySelector('[data-agenda-customer-frame]') || null,
  customerRegisterLoading: customerRegisterModal?.querySelector('[data-agenda-customer-frame-loading]') || null,
};

// ----- State -----
export const FILTER_STORAGE_KEY = 'agenda_filters_v1';
export const AGENDA_NO_PREFERENCE_PROF_ID = '__SEM_PREFERENCIA__';
export const AGENDA_NO_PREFERENCE_PROF_NAME = 'Sem Preferência';
export const state = {
  stores: [],
  profissionais: [],
  agendamentos: [],
  selectedStoreId: null,
  selectedCliente: null,
  selectedServico: null,
  tempServicos: [],
  editing: null,
  lastSnapshotHash: '',
  __didInitialScroll: false,
  view: 'day',
  filters: {
    statuses: new Set(),
    profIds: new Set(),
    profTipo: '', // 'esteticista' | 'veterinario' | ''
  },
};

export function isNoPreferenceProfessionalId(value) {
  return String(value || '').trim() === AGENDA_NO_PREFERENCE_PROF_ID;
}

export function buildNoPreferenceProfessional() {
  return {
    _id: AGENDA_NO_PREFERENCE_PROF_ID,
    nome: AGENDA_NO_PREFERENCE_PROF_NAME,
    tipo: 'esteticista',
    __synthetic: true,
  };
}

// ----- Date/time utils -----
export function todayStr() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}
export function pad(n) { return n < 10 ? '0' + n : '' + n; }
export function buildLocalDateTime(dateStr, hhmm) {
  let y, m, d;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateStr)) { [d, m, y] = dateStr.split('/').map(Number); }
  else { [y, m, d] = dateStr.split('-').map(Number); }
  const [hh, mm] = (hhmm || '00:00').split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm, 0, 0);
}
export function normalizeDate(v) {
  if (!v) return todayStr();
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(v)) { const [dd, mm, yyyy] = v.split('/'); return `${yyyy}-${mm}-${dd}`; }
  return v;
}
export function startOfWeek(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const dow = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dow);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}
export function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}
export function startOfMonth(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(1);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}
export function startOfNextMonth(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(1);
  d.setMonth(d.getMonth() + 1);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}
export function updateHeaderLabel() {
  const base = normalizeDate(els.dateInput?.value || todayStr());
  if (!els.dateLabelVisible) return;
  if (state.view === 'week') {
    const ini = startOfWeek(base);
    const fim = addDays(ini, 6);
    const li = new Date(ini + 'T00:00:00').toLocaleDateString('pt-BR');
    const lf = new Date(fim + 'T00:00:00').toLocaleDateString('pt-BR');
    els.dateLabelVisible.textContent = `${li} a ${lf}`;
  } else if (state.view === 'month') {
    const m0 = startOfMonth(base);
    const dt = new Date(m0 + 'T00:00:00');
    const label = dt.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
    els.dateLabelVisible.textContent = label.charAt(0).toUpperCase() + label.slice(1);
  } else {
    els.dateLabelVisible.textContent = new Date(base + 'T00:00:00').toLocaleDateString('pt-BR');
  }
}
export function localDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

// ----- Names / text helpers -----
export function shortTutorName(name) {
  if (!name) return '';
  const parts = String(name).trim().split(/\s+/);
  const cap = s => s ? (s[0].toUpperCase() + s.slice(1).toLowerCase()) : '';
  const preps = new Set(['da','de','do','das','dos','e']);
  const first = cap(parts[0] || '');
  let second = '';
  for (let i = 1; i < parts.length; i++) {
    const w = parts[i];
    if (!preps.has(w.toLowerCase())) { second = w; break; }
  }
  const secondAbbr = second ? cap(second).slice(0, 3) : '';
  return secondAbbr ? `${first} ${secondAbbr}..` : first;
}

// ----- Generic helpers -----
export function money(v) { return (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
export function clearChildren(el) { while (el && el.firstChild) el.removeChild(el.firstChild); }
export function debounce(fn, delay = 250) { let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), delay); }; }

// ----- Filtering helpers -----
export function normalizeStatus(s) {
  return String(s || 'agendado')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .trim().toLowerCase().replace(/[-\s]+/g,'_');
}
export function getFilteredAgendamentos() {
  const hasStatus = state.filters.statuses.size > 0;
  const hasProf   = state.filters.profIds.size   > 0;
  const hasTipo   = !!state.filters.profTipo;

  // se nenhum filtro ativo, retorna tudo
  if (!hasStatus && !hasProf && !hasTipo) return state.agendamentos || [];

  // mapa nome -> id (fallback para agendamentos antigos que vêm só com nome)
  const byNameAll = new Map(
    (state.profissionais || []).map(p => [String(p.nome || '').trim().toLowerCase(), String(p._id)])
  );

  // conjunto de ids do tipo selecionado (quando houver)
  const idsTipo = hasTipo
    ? new Set(
        (state.profissionais || [])
          .filter(p => (p.tipo || 'esteticista') === state.filters.profTipo)
          .map(p => String(p._id))
      )
    : null;

  return (state.agendamentos || []).filter(a => {
    let ok = true;

    // status
    if (hasStatus) {
      ok = ok && state.filters.statuses.has(normalizeStatus(a.status));
      if (!ok) return false;
    }

    // resolve o profissional do agendamento pra um id
    const resolveProfIds = () => {
      const ids = new Set();
      const append = (value) => {
        if (!value) return;
        const str = String(value).trim();
        if (str) ids.add(str);
      };
      if (Array.isArray(a.servicos)) {
        a.servicos.forEach((svc) => {
          if (svc && svc.profissionalId) append(svc.profissionalId);
        });
      }
      if (Array.isArray(a.profissionaisServicos)) {
        a.profissionaisServicos.forEach((entry) => {
          if (entry && entry.profissionalId) append(entry.profissionalId);
        });
      }
      if (!ids.size && a.profissionalId) {
        append(a.profissionalId);
      }
      if (!ids.size) {
        let nc = '';
        if (typeof a.profissional === 'string') nc = a.profissional;
        else if (a.profissional && typeof a.profissional === 'object') {
          nc = a.profissional.nomeCompleto || a.profissional.nomeContato ||
               a.profissional.razaoSocial || a.profissional.nome || '';
        }
        const fallback = byNameAll.get(String(nc).trim().toLowerCase()) || null;
        if (fallback) append(fallback);
      }
      return ids;
    };

    // por id específico (chips de profissionais)
    if (hasProf) {
      const profIds = resolveProfIds();
      ok = ok && Array.from(profIds).some(id => state.filters.profIds.has(id));
      if (!ok) return false;
    }

    // por tipo (Esteticista, Veterinário, etc.)
    if (hasTipo) {
      const profIds = resolveProfIds();
      ok = ok && Array.from(profIds).some(id => idsTipo.has(id));
      if (!ok) return false;
    }

    return ok;
  });
}
export function getVisibleProfissionais() {
  let profs = state.profissionais || [];

  // 1) Filtra por tipo (Esteticista, Veterinário, etc.) se houver
  const tipoSel = String(state.filters.profTipo || '').trim();
  if (tipoSel) {
    profs = profs.filter(p => String(p.tipo || 'esteticista') === tipoSel);
  }

  // 2) Filtra por profissionais específicos, se houver chips selecionados
  if (state.filters.profIds && state.filters.profIds.size) {
    profs = profs.filter(p => state.filters.profIds.has(String(p._id)));
  }
  const allowNoPreference =
    (!state.filters.profIds?.size || state.filters.profIds.has(AGENDA_NO_PREFERENCE_PROF_ID));
  if (allowNoPreference) {
    profs = [buildNoPreferenceProfessional(), ...profs];
  }
  return profs;
}

// ----- Status styles -----
export function statusMeta(s) {
  const keyRaw = String(s || 'agendado')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .trim().toLowerCase().replace(/[-\s]+/g, '_');
  const allowed = ['agendado', 'em_espera', 'em_atendimento', 'finalizado', 'parcial'];
  const k = allowed.includes(keyRaw) ? keyRaw : 'agendado';
  const map = {
    agendado: {
      label: 'Agendado', short: 'Agend.', stripe: '#64748B', text: '#0F172A',
      badgeClass: 'agenda-status-badge agenda-status-badge--agendado', borderClass: 'border-slate-300'
    },
    em_espera: {
      label: 'Em espera', short: 'Espera', stripe: '#B45309', text: '#1F2937',
      badgeClass: 'agenda-status-badge agenda-status-badge--espera', borderClass: 'border-amber-400'
    },
    em_atendimento: {
      label: 'Em atendimento', short: 'Atend.', stripe: '#1D4ED8', text: '#0B1235',
      badgeClass: 'agenda-status-badge agenda-status-badge--atendimento', borderClass: 'border-blue-500'
    },
    finalizado: {
      label: 'Finalizado', short: 'Fim.', stripe: '#16A34A', text: '#052E16',
      badgeClass: 'agenda-status-badge agenda-status-badge--finalizado', borderClass: 'border-green-500'
    },
    parcial: {
      label: 'Parcial', short: 'Parc.', stripe: '#9333EA', text: '#3B0764',
      badgeClass: 'agenda-status-badge agenda-status-badge--parcial', borderClass: 'border-purple-500'
    }
  };
  return { key: k, ...map[k] };
}
export function renderStatusBadge(s) {
  const { label, badgeClass } = statusMeta(s);
  return `<span class="inline-flex items-center px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${badgeClass}">${label}</span>`;
}
