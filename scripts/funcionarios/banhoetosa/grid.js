import {
  state, els, api,
  normalizeDate, todayStr, pad, money, shortTutorName,
  clearChildren, getFilteredAgendamentos, getVisibleProfissionais,
  updateHeaderLabel, localDateStr, addDays, startOfWeek, startOfMonth, startOfNextMonth,
  renderStatusBadge, statusMeta
} from './core.js';
import { openAddModal } from './modal.js';

const VET_FICHA_CLIENTE_KEY = 'vetFichaSelectedCliente';
const VET_FICHA_PET_KEY = 'vetFichaSelectedPetId';
const VET_FICHA_AGENDA_CONTEXT_KEY = 'vetFichaAgendaContext';
const OBJECT_ID_REGEX = /^[0-9a-fA-F]{24}$/;
const DEFAULT_BUSINESS_START = 8;
const DEFAULT_BUSINESS_END = 19;
const WEEKDAY_KEYS = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];

function applyAgendaTextClamp(element, lines = 2) {
  if (!element) return;
  element.style.display = '-webkit-box';
  element.style.webkitBoxOrient = 'vertical';
  element.style.WebkitBoxOrient = 'vertical';
  element.style.webkitLineClamp = String(lines);
  element.style.WebkitLineClamp = String(lines);
  element.style.overflow = 'hidden';
  element.style.wordBreak = 'break-word';
}

function getAgendaServicesPreview(rawServices, maxVisible = 2) {
  const names = String(rawServices || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  if (!names.length) {
    return { preview: '', tooltip: '', names: [] };
  }

  const hiddenCount = Math.max(0, names.length - maxVisible);
  const previewNames = hiddenCount ? names.slice(0, maxVisible) : names;
  const preview = hiddenCount
    ? `${previewNames.join(', ')} +${hiddenCount}`
    : previewNames.join(', ');
  const tooltip = names.join('\n');

  return { preview, tooltip, names };
}

function pickFirst(...values) {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) return trimmed;
      continue;
    }
    if (typeof value === 'number') {
      if (!Number.isNaN(value)) {
        const numStr = String(value).trim();
        if (numStr) return numStr;
      }
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        const nested = pickFirst(item);
        if (nested) return nested;
      }
    }
  }
  return '';
}

function normalizeId(value) {
  if (!value) return '';
  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = normalizeId(item);
      if (nested) return nested;
    }
    return '';
  }
  if (typeof value === 'object') {
    if (value._id || value.id) {
      return normalizeId(value._id || value.id);
    }
    return '';
  }
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return '';
    return String(value).trim();
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed || trimmed === '[object Object]') return '';
    return trimmed;
  }
  return '';
}

function normalizeObjectId(value) {
  const normalized = normalizeId(value);
  if (!normalized) return '';
  const cleaned = normalized
    .replace(/^ObjectId\(["']?/, '')
    .replace(/["']?\)$/, '');
  return OBJECT_ID_REGEX.test(cleaned) ? cleaned : '';
}

function coerceToDate(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === 'number' && !Number.isNaN(value)) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;

    const direct = new Date(trimmed);
    if (!Number.isNaN(direct.getTime())) return direct;

    const spaceNormalized = trimmed.includes('T') ? trimmed : trimmed.replace(' ', 'T');
    const normalized = new Date(spaceNormalized);
    if (!Number.isNaN(normalized.getTime())) return normalized;

    if (!/[TZ]$/i.test(spaceNormalized)) {
      const withZ = new Date(`${spaceNormalized}Z`);
      if (!Number.isNaN(withZ.getTime())) return withZ;
    }

    if (/^\d{2}\/\d{2}\/\d{4}$/.test(trimmed)) {
      const [dd, mm, yyyy] = trimmed.split('/').map(Number);
      const date = new Date(yyyy, mm - 1, dd, 0, 0, 0, 0);
      if (!Number.isNaN(date.getTime())) return date;
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      const [yyyy, mm, dd] = trimmed.split('-').map(Number);
      const date = new Date(yyyy, mm - 1, dd, 0, 0, 0, 0);
      if (!Number.isNaN(date.getTime())) return date;
    }
  }
  return null;
}

function parseTimeToMinutes(value) {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(\d{1,2})(?::(\d{2}))?$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2] || '0');
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function getSelectedStoreHorario() {
  const store = (state.stores || []).find(s => String(s?._id) === String(state.selectedStoreId));
  return store?.horario || null;
}

function getBusinessRangeForDate(dateStr) {
  const fallback = { startHour: DEFAULT_BUSINESS_START, endHour: DEFAULT_BUSINESS_END, closed: false };
  const horario = getSelectedStoreHorario();
  if (!horario) return fallback;
  const date = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(date.getTime())) return fallback;
  const dayKey = WEEKDAY_KEYS[date.getDay()];
  const day = horario?.[dayKey];
  if (!day) return fallback;
  if (day.fechada) return { startHour: 0, endHour: 0, closed: true };

  const startMin = parseTimeToMinutes(day.abre);
  const endMin = parseTimeToMinutes(day.fecha);
  if (startMin === null || endMin === null || endMin <= startMin) {
    return fallback;
  }

  const startHour = Math.max(0, Math.min(23, Math.floor(startMin / 60)));
  const endHour = Math.max(startHour + 1, Math.min(24, Math.ceil(endMin / 60)));
  return { startHour, endHour, closed: false };
}

function buildHoursList(startHour, endHour) {
  const hours = [];
  const start = Math.max(0, Math.min(23, Number(startHour)));
  const end = Math.max(start + 1, Math.min(24, Number(endHour)));
  for (let h = start; h < end; h++) {
    hours.push(`${pad(h)}:00`);
  }
  return hours;
}

function renderClosedMessage(message) {
  const empty = document.createElement('div');
  empty.className = 'px-4 py-6 text-sm text-slate-600 bg-slate-50 border-b';
  empty.textContent = message;
  els.agendaList.appendChild(empty);
}

function getAppointmentDateKey(appointment) {
  if (!appointment) return '';
  const candidates = [
    appointment.h,
    appointment.scheduledAt,
    appointment.scheduled_at,
    appointment.dataHora,
    appointment.data,
  ];

  for (const candidate of candidates) {
    const date = coerceToDate(candidate);
    if (date) {
      return localDateStr(date);
    }
  }
  return '';
}

async function fetchAppointmentDetails(appointment) {
  const appointmentId = normalizeId(appointment?._id);
  const dateKey = getAppointmentDateKey(appointment);
  if (!appointmentId || !dateKey) return null;

  try {
    const params = new URLSearchParams({ date: dateKey });
    const storeId = normalizeObjectId(state.selectedStoreId);
    if (storeId) params.set('storeId', storeId);

    const resp = await api(`/func/agendamentos?${params.toString()}`);
    if (!resp.ok) return null;
    const list = await resp.json().catch(() => null);
    if (!Array.isArray(list) || !list.length) return null;

    const found = list.find(item => normalizeId(item?._id) === appointmentId);
    if (!found) return null;

    return { ...appointment, ...found };
  } catch (err) {
    console.error('fetchAppointmentDetails', err);
    return null;
  }
}

function extractTutorPayload(appointment) {
  if (!appointment) return null;

  const candidateObjects = [];
  if (appointment.cliente && typeof appointment.cliente === 'object') candidateObjects.push(appointment.cliente);
  if (appointment.tutor && typeof appointment.tutor === 'object') candidateObjects.push(appointment.tutor);
  if (appointment.responsavel && typeof appointment.responsavel === 'object') candidateObjects.push(appointment.responsavel);

  const primaryObj = candidateObjects.find(obj => normalizeId(obj?._id || obj?.id));
  const fallbackObj = primaryObj || candidateObjects[0] || null;

  let tutorId = normalizeId(
    appointment.clienteId ||
    appointment.clientId ||
    appointment.customerId ||
    appointment.tutorId ||
    (primaryObj && (primaryObj._id || primaryObj.id)) ||
    (appointment.cliente && typeof appointment.cliente === 'object' ? (appointment.cliente._id || appointment.cliente.id) : '') ||
    (appointment.tutor && typeof appointment.tutor === 'object' ? (appointment.tutor._id || appointment.tutor.id) : '') ||
    (appointment.responsavel && typeof appointment.responsavel === 'object' ? (appointment.responsavel._id || appointment.responsavel.id) : '')
  );

  if (!tutorId && fallbackObj) {
    tutorId = normalizeId(fallbackObj._id || fallbackObj.id);
  }

  if (!tutorId) {
    const possibleIdString = typeof appointment.cliente === 'string' ? appointment.cliente : (typeof appointment.tutor === 'string' ? appointment.tutor : '');
    if (/^[0-9a-fA-F]{24}$/.test((possibleIdString || '').trim())) {
      tutorId = possibleIdString.trim();
    }
  }

  if (!tutorId) return null;

  const nameSource = fallbackObj || {};

  const tutorNome = pickFirst(
    appointment.clienteNome,
    appointment.tutorNome,
    typeof appointment.tutor === 'string' ? appointment.tutor : '',
    typeof appointment.cliente === 'string' ? appointment.cliente : '',
    nameSource.nome,
    nameSource.nomeCompleto,
    nameSource.nomeContato,
    nameSource.razaoSocial,
    nameSource.name
  );

  const tutorEmail = pickFirst(
    appointment.clienteEmail,
    appointment.emailCliente,
    appointment.email,
    nameSource.email,
    nameSource.emailContato,
    nameSource.emailPrincipal,
    nameSource.emailSecundario,
    Array.isArray(nameSource.emails) ? nameSource.emails[0] : ''
  );

  const tutorCelular = pickFirst(
    appointment.clienteCelular,
    appointment.clienteTelefone,
    appointment.telefoneCliente,
    appointment.telefone,
    appointment.celular,
    nameSource.celular,
    nameSource.telefone,
    nameSource.telefone1,
    nameSource.telefone2,
    nameSource.phone,
    nameSource.fone,
    nameSource.whatsapp,
    nameSource.whatsApp
  );

  return {
    _id: tutorId,
    nome: tutorNome,
    email: tutorEmail,
    celular: tutorCelular,
  };
}

function extractPetId(appointment) {
  if (!appointment) return '';
  const direct = normalizeId(appointment.petId);
  if (direct) return direct;
  if (appointment.pet && typeof appointment.pet === 'object') {
    const nested = normalizeId(appointment.pet._id || appointment.pet.id || appointment.pet.petId);
    if (nested) return nested;
  }
  if (typeof appointment.pet === 'string') {
    const maybe = appointment.pet.trim();
    if (/^[0-9a-fA-F]{24}$/.test(maybe)) return maybe;
  }
  return '';
}

function normalizeCategories(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .map(item => {
        if (!item) return '';
        if (typeof item === 'object' && item.nome) return String(item.nome).trim();
        return String(item).trim();
      })
      .filter(Boolean);
  }
  if (typeof value === 'object' && value.nome) {
    return [String(value.nome).trim()].filter(Boolean);
  }
  const str = String(value || '').trim();
  return str ? [str] : [];
}

function normalizeStaffTypes(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    const arr = value
      .map(item => {
        if (!item) return '';
        if (typeof item === 'object') {
          if (item.tipo) return String(item.tipo).trim();
          if (item.nome) return String(item.nome).trim();
        }
        return String(item).trim();
      })
      .filter(Boolean);
    return Array.from(new Set(arr));
  }
  if (typeof value === 'object' && (value.tipo || value.nome)) {
    const arr = [String(value.tipo || value.nome).trim()].filter(Boolean);
    return Array.from(new Set(arr));
  }
  const str = String(value || '').trim();
  return str ? [str] : [];
}

function normalizeServiceEntry(entry, fallbackNome = '', fallbackValor = null) {
  if (!entry) return null;
  const id = normalizeId(entry._id || entry.id || entry.servico || entry.servicoId);
  const nome = pickFirst(
    entry.nome,
    entry.servicoNome,
    entry.descricao,
    typeof entry === 'string' ? entry : '',
    typeof entry.servico === 'string' ? entry.servico : '',
    entry?.servico?.nome,
    fallbackNome
  );
  const valorRaw = typeof entry.valor === 'number'
    ? entry.valor
    : (typeof entry.valor === 'string' ? Number(entry.valor.replace(',', '.')) : null);
  const valor = Number.isFinite(valorRaw) ? Number(valorRaw) : (Number(fallbackValor) || 0);
  const categorias = normalizeCategories(
    entry.categorias || entry.categoria || entry.category || entry.categoriaPrincipal || entry?.servico?.categorias
  );
  const tiposPermitidos = normalizeStaffTypes(
    entry.tiposPermitidos
      || entry.allowedTipos
      || entry.allowedStaffTypes
      || entry.allowedStaff
      || entry.grupoTiposPermitidos
      || entry?.grupo?.tiposPermitidos
      || entry?.servico?.tiposPermitidos
      || entry?.servico?.grupo?.tiposPermitidos
  );
  if (!nome && !id) return null;
  return {
    _id: id || null,
    nome,
    valor,
    categorias,
    tiposPermitidos,
  };
}

function extractAppointmentServices(appointment) {
  const services = [];
  if (!appointment) return services;
  if (Array.isArray(appointment.servicos) && appointment.servicos.length) {
    appointment.servicos.forEach((svc, index) => {
      const normalized = normalizeServiceEntry(svc, appointment.servico || '', appointment.valor);
      if (normalized) services.push(normalized);
    });
  } else {
    const fallback = normalizeServiceEntry({
      _id: appointment.servicoId || appointment.servico?._id || appointment.servico,
      nome: appointment.servico || appointment.servicoNome || appointment?.servico?.nome,
      valor: appointment.valor,
      categorias: appointment?.servico?.categorias || appointment.categorias || appointment.categoria,
      tiposPermitidos: appointment?.servico?.tiposPermitidos
        || appointment?.servico?.grupo?.tiposPermitidos
        || appointment.tiposPermitidos
    }, appointment.servico || '', appointment.valor);
    if (fallback) services.push(fallback);
  }
  const seen = new Set();
  return services.filter(svc => {
    const key = `${svc._id || ''}|${svc.nome}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractServiceHourValue(service, appointment) {
  if (!service && !appointment) return '';
  const candidates = [
    service?.hora,
    service?.horario,
    service?.h,
    service?.scheduledAt,
    service?.scheduled_at,
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (candidate instanceof Date && !Number.isNaN(candidate.getTime())) {
      return candidate.toISOString();
    }
    if (typeof candidate === 'string') {
      const trimmed = candidate.trim();
      if (!trimmed) continue;
      const dateCandidate = coerceToDate(trimmed);
      if (dateCandidate) {
        return dateCandidate.toISOString();
      }
      const hhmm = trimmed.match(/^(\d{2}):(\d{2})/);
      if (hhmm) return `${hhmm[1]}:${hhmm[2]}`;
    }
  }
  const fallbackDate = coerceToDate(appointment?.h || appointment?.scheduledAt || appointment?.scheduled_at || appointment?.dataHora);
  if (fallbackDate) {
    return `${pad(fallbackDate.getHours())}:${pad(fallbackDate.getMinutes())}`;
  }
  return '';
}

function combineAppointmentDateWithHour(appointment, hourValue) {
  const baseCandidates = [
    appointment?.h,
    appointment?.scheduledAt,
    appointment?.scheduled_at,
    appointment?.dataHora,
  ];
  let baseDate = null;
  for (const candidate of baseCandidates) {
    const parsed = coerceToDate(candidate);
    if (parsed) {
      baseDate = parsed;
      break;
    }
  }
  if (!baseDate) return null;
  const date = new Date(baseDate.getTime());
  if (typeof hourValue === 'string') {
    const trimmed = hourValue.trim();
    const overrideDate = coerceToDate(trimmed);
    if (overrideDate) {
      return overrideDate.toISOString();
    }
    const match = trimmed.match(/^(\d{2}):(\d{2})$/);
    if (match) {
      date.setHours(Number(match[1]), Number(match[2]), 0, 0);
    }
  }
  return date.toISOString();
}

function createStatusBadgeElement(appointment, options = {}) {
  const { size = 'default' } = options || {};
  const wrapper = document.createElement('div');
  wrapper.className = 'agenda-status-wrapper';
  let badgeHtml = renderStatusBadge(appointment.status);
  if (size === 'compact') {
    badgeHtml = badgeHtml.replace('text-xs', 'text-[10px]');
  }
  wrapper.insertAdjacentHTML('beforeend', badgeHtml);
  const badgeEl = wrapper.firstElementChild;
  if (badgeEl) {
    badgeEl.classList.add('agenda-status-wrapper__badge');
    if (size === 'compact') {
      badgeEl.classList.add('agenda-status-wrapper__badge--compact');
    }
  }
  return wrapper;
}

function expandAppointmentsForCards(appointments) {
  const arr = Array.isArray(appointments) ? appointments : [];
  const cards = [];
  arr.forEach((appt) => {
    const services = Array.isArray(appt.servicos) ? appt.servicos : [];
    if (!services.length) {
      cards.push({ ...appt, __serviceItemIds: [] });
      return;
    }
    const groups = new Map();
    services.forEach((svc) => {
      const profIdRaw = svc && svc.profissionalId ? String(svc.profissionalId) : (appt.profissionalId ? String(appt.profissionalId) : '');
      const horaValue = extractServiceHourValue(svc, appt);
      const key = `${profIdRaw || '__sem_prof__'}|${horaValue || '__sem_hora__'}`;
      if (!groups.has(key)) {
        groups.set(key, {
          profissionalId: profIdRaw || null,
          services: [],
          total: 0,
          itemIds: [],
          hora: horaValue || '',
          statusCounts: new Map(),
          observacoes: [],
          statusDetails: [],
        });
      }
      const bucket = groups.get(key);
      bucket.services.push(svc);
      bucket.total += Number(svc.valor || 0);
      const normalizedSvcItemId = normalizeObjectId([
        svc?.itemId,
        svc?._id,
        svc?.id,
      ]);
      if (normalizedSvcItemId) bucket.itemIds.push(normalizedSvcItemId);
      if (horaValue && !bucket.hora) bucket.hora = horaValue;
      const svcStatusMeta = statusMeta(svc?.status || svc?.situacao || appt.status || 'agendado');
      const svcStatus = svcStatusMeta.key;
      bucket.statusCounts.set(svcStatus, (bucket.statusCounts.get(svcStatus) || 0) + 1);
      const svcName = typeof svc?.nome === 'string' && svc.nome.trim() ? svc.nome.trim() : (appt.servico || '—');
      const itemId = normalizeObjectId([
        svc?.itemId,
        svc?._id,
        svc?.id,
      ]);
      bucket.statusDetails.push({
        name: svcName,
        status: svcStatus,
        label: svcStatusMeta.label,
        itemId: itemId || null,
      });
      const obs = typeof svc?.observacao === 'string' ? svc.observacao : (typeof svc?.observacoes === 'string' ? svc.observacoes : '');
      if (typeof obs === 'string') {
        const trimmed = obs.trim();
        if (trimmed) bucket.observacoes.push(trimmed);
      }
    });
    if (!groups.size) {
      cards.push({ ...appt, __serviceItemIds: [] });
      return;
    }
    groups.forEach((bucket) => {
      const clone = { ...appt };
      const names = bucket.services.map((svc) => svc.nome).filter(Boolean);
      clone.servico = names.length ? names.join(', ') : (appt.servico || '');
      clone.valor = bucket.total || Number(appt.valor || 0) || 0;
      clone.profissionalId = bucket.profissionalId || appt.profissionalId || null;
      if (bucket.itemIds.length) {
        clone.__serviceItemIds = bucket.itemIds.slice();
      } else {
        const collectedIds = bucket.services
          .map((svc) => normalizeObjectId([
            svc?.itemId,
            svc?._id,
            svc?.id,
          ]))
          .filter(Boolean);
        clone.__serviceItemIds = collectedIds;
      }
      clone.__servicesForCard = bucket.services;
      const statusKeys = Array.from(bucket.statusCounts.keys());
      if (!statusKeys.length) {
        const fallbackStatus = statusMeta(appt.status || 'agendado').key;
        bucket.statusCounts.set(fallbackStatus, 1);
        statusKeys.push(fallbackStatus);
        bucket.statusDetails.push({
          name: clone.servico || 'Serviço',
          status: fallbackStatus,
          label: statusMeta(fallbackStatus).label,
          itemId: null,
        });
      }
      const distinctStatuses = new Set(statusKeys);
      let cardStatusKey = statusKeys[0];
      if (distinctStatuses.size > 1) {
        cardStatusKey = 'parcial';
      }
      let actionStatusKey = statusKeys[0];
      let maxCount = bucket.statusCounts.get(actionStatusKey) || 0;
      bucket.statusCounts.forEach((count, key) => {
        if (count > maxCount) {
          maxCount = count;
          actionStatusKey = key;
        }
      });
      clone.status = cardStatusKey;
      clone.__statusDetails = bucket.statusDetails.slice();
      clone.__statusActionKey = actionStatusKey;
      if (bucket.hora) {
        const combined = combineAppointmentDateWithHour(appt, bucket.hora);
        if (combined) {
          clone.h = combined;
          clone.scheduledAt = combined;
        }
      }
      if (bucket.observacoes && bucket.observacoes.length) {
        const baseObs = typeof appt.observacoes === 'string' ? appt.observacoes.trim() : '';
        const combinedNotes = [baseObs, ...bucket.observacoes].filter(Boolean).join(' • ');
        clone.observacoes = combinedNotes;
      }
      cards.push(clone);
    });
  });
  return cards;
}

async function persistFichaClinicaContext(appointment) {
  try {
    let workingAppointment = appointment || null;
    let tutor = extractTutorPayload(workingAppointment);
    let petId = extractPetId(workingAppointment);

    if (!(tutor && tutor._id && petId)) {
      const detailed = await fetchAppointmentDetails(workingAppointment);
      if (detailed) {
        workingAppointment = detailed;
        tutor = extractTutorPayload(workingAppointment);
        petId = extractPetId(workingAppointment);
      }
    }

    if (!tutor || !tutor._id || !petId) return false;

    const payload = {
      _id: tutor._id,
      nome: tutor.nome || '',
      email: tutor.email || '',
      celular: tutor.celular || '',
    };
    localStorage.setItem(VET_FICHA_CLIENTE_KEY, JSON.stringify(payload));
    localStorage.setItem(VET_FICHA_PET_KEY, petId);

    const appointmentId = normalizeId(workingAppointment?._id);
    const profissionalNome = pickFirst(
      typeof workingAppointment?.profissional === 'string' ? workingAppointment.profissional : '',
      workingAppointment?.profissionalNome,
      workingAppointment?.profissional?.nome,
      workingAppointment?.profissional?.nomeCompleto,
      workingAppointment?.profissional?.nomeContato,
      workingAppointment?.profissional?.razaoSocial
    );

    const storeCandidatesRaw = [
      workingAppointment?.storeId,
      workingAppointment?.store?._id,
      workingAppointment?.store?.id,
      workingAppointment?.store?.storeId,
      workingAppointment?.store,
      workingAppointment?.store_id,
      workingAppointment?.storeID,
      workingAppointment?.empresaId,
      workingAppointment?.empresa_id,
      workingAppointment?.empresaID,
      workingAppointment?.empresa?._id,
      workingAppointment?.empresa?.id,
      workingAppointment?.empresa,
      workingAppointment?.lojaId,
      workingAppointment?.loja_id,
      workingAppointment?.lojaID,
      workingAppointment?.loja?._id,
      workingAppointment?.loja?.id,
      workingAppointment?.loja,
      workingAppointment?.filialId,
      workingAppointment?.filial_id,
      workingAppointment?.filialID,
      workingAppointment?.filial?._id,
      workingAppointment?.filial?.id,
      workingAppointment?.filial,
      state.selectedStoreId,
    ];
    const storeIdCandidates = [];
    let storeId = '';
    for (const candidate of storeCandidatesRaw) {
      const normalized = normalizeObjectId(candidate);
      if (!normalized) continue;
      if (!storeIdCandidates.includes(normalized)) {
        storeIdCandidates.push(normalized);
      }
      if (!storeId) {
        storeId = normalized;
      }
    }

    const agendaContext = {
      tutorId: tutor._id,
      petId,
      storeId: storeId || null,
      appointmentId,
      scheduledAt: workingAppointment?.h
        || workingAppointment?.scheduledAt
        || workingAppointment?.data
        || workingAppointment?.dataHora
        || '',
      profissionalId: normalizeId(workingAppointment?.profissionalId || workingAppointment?.profissional?._id),
      profissionalNome,
      status: workingAppointment?.status || 'agendado',
      valor: Number(workingAppointment?.valor || 0),
      observacoes: typeof workingAppointment?.observacoes === 'string'
        ? workingAppointment.observacoes.trim()
        : '',
      servicos: extractAppointmentServices(workingAppointment),
      totalServicos: Array.isArray(workingAppointment?.servicos)
        ? workingAppointment.servicos.length
        : (workingAppointment?.servico ? 1 : 0),
    };

    const codigoVenda = pickFirst(
      workingAppointment?.codigoVenda,
      workingAppointment?.codigo_venda,
      workingAppointment?.codVenda,
      workingAppointment?.cod_venda,
    );
    if (codigoVenda) {
      agendaContext.codigoVenda = codigoVenda;
    }

    let pagoFlag;
    if (typeof workingAppointment?.pago !== 'undefined') {
      if (typeof workingAppointment.pago === 'boolean') {
        pagoFlag = workingAppointment.pago;
      } else if (typeof workingAppointment.pago === 'number') {
        pagoFlag = !Number.isNaN(workingAppointment.pago) && workingAppointment.pago !== 0;
      } else if (typeof workingAppointment.pago === 'string') {
        const normalizedPago = workingAppointment.pago.trim().toLowerCase();
        if (['true', '1', 'sim', 'yes', 'y'].includes(normalizedPago)) {
          pagoFlag = true;
        } else if (['false', '0', 'nao', 'não', 'no', 'n'].includes(normalizedPago)) {
          pagoFlag = false;
        } else if (normalizedPago) {
          pagoFlag = true;
        }
      } else {
        pagoFlag = !!workingAppointment.pago;
      }
    }
    if (typeof pagoFlag === 'boolean') {
      agendaContext.pago = pagoFlag;
    }
    if ((agendaContext.pago === true) || codigoVenda) {
      agendaContext.pagamentoRegistrado = true;
    }
    if (storeIdCandidates.length) {
      agendaContext.storeIdCandidates = storeIdCandidates;
    }

    localStorage.setItem(VET_FICHA_AGENDA_CONTEXT_KEY, JSON.stringify(agendaContext));
    return true;
  } catch (err) {
    console.error('persistFichaClinicaContext', err);
    try {
      localStorage.removeItem(VET_FICHA_CLIENTE_KEY);
      localStorage.removeItem(VET_FICHA_PET_KEY);
      localStorage.removeItem(VET_FICHA_AGENDA_CONTEXT_KEY);
    } catch (_) {}
    return false;
  }
}

async function navigateToFichaClinica(appointment) {
  try {
    const prepared = await persistFichaClinicaContext(appointment);
    if (!prepared) {
      alert('Não foi possível preparar a ficha clínica. Tutor ou pet não encontrados.');
      return;
    }
    window.location.href = 'vet-ficha-clinica.html';
  } catch (err) {
    console.error('navigateToFichaClinica', err);
    alert('Não foi possível preparar a ficha clínica. Tutor ou pet não encontrados.');
  }
}

function createFichaClinicaChip(appointment) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'agenda-ficha-chip';
  btn.textContent = 'Ficha Clínica';
  btn.title = 'Abrir ficha clínica';
  btn.addEventListener('click', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    navigateToFichaClinica(appointment);
  });
  return btn;
}

export function renderGrid() {
  if (!els.agendaList) return;
  if (state.view === 'week')  { renderWeekGrid();  return; }
  if (state.view === 'month') { renderMonthGrid(); return; }

  const date = normalizeDate(els.dateInput?.value || todayStr());
  updateHeaderLabel();
  const businessRange = getBusinessRangeForDate(date);
  const hours = businessRange.closed ? [] : buildHoursList(businessRange.startHour, businessRange.endHour);
  clearChildren(els.agendaList);

  const profsAll  = state.profissionais || [];
  const profs     = getVisibleProfissionais();
  const byNameAll = new Map((profsAll || []).map(p => [String(p.nome || '').trim().toLowerCase(), p._id]));
  const colCount = 1 + (profs?.length || 0);

  const header = document.createElement('div');
  header.style.display = 'grid';
  header.style.gridTemplateColumns = `120px repeat(${Math.max(colCount - 1, 0)}, minmax(var(--agenda-col-w, 360px), 1fr))`;
  header.className = 'agenda-grid-header agenda-grid-header--day';
  const headLabels = ['Hora', ...profs.map(p => p.nome)];
  headLabels.forEach((label, idx) => {
    const cell = document.createElement('div');
    cell.className = 'px-3 py-2 text-xs font-medium text-slate-600 agenda-grid-header__cell';
    if (idx === 0) {
      cell.textContent = label;
    } else {
      cell.style.textAlign = 'center';
      const wrapper = document.createElement('div');
      wrapper.className = 'flex items-center justify-center gap-2 agenda-grid-header__prof';

      const span = document.createElement('span');
      span.className = 'agenda-head-label inline-block font-semibold';
      span.textContent = label || '';
      wrapper.appendChild(span);

      const prof = profs[idx - 1];
      if (prof && prof._id) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'agenda-head-add inline-flex h-7 w-7 items-center justify-center rounded-md border shadow-sm transition';
        btn.innerHTML = `
          <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" focusable="false">
            <path fill-rule="evenodd" d="M10 3a.75.75 0 0 1 .75.75v5.5h5.5a.75.75 0 0 1 0 1.5h-5.5v5.5a.75.75 0 0 1-1.5 0v-5.5h-5.5a.75.75 0 0 1 0-1.5h5.5v-5.5A.75.75 0 0 1 10 3Z" clip-rule="evenodd" />
          </svg>
        `;
        btn.setAttribute('aria-label', `Adicionar agendamento para ${label}`);
        btn.dataset.profId = String(prof._id);
        btn.addEventListener('click', (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          openAddModal(String(prof._id));
        });
        wrapper.appendChild(btn);
      }

      cell.dataset.profId = prof && prof._id ? String(prof._id) : '';
      cell.appendChild(wrapper);
    }
    header.appendChild(cell);
  });
  const counter = document.createElement('div');
  counter.className = 'agenda-grid-summary col-span-full text-right px-3 py-1 text-xs text-slate-500';
  const itemsAll = state.agendamentos || [];
  const filteredAppointments = getFilteredAgendamentos(itemsAll);
  const filtered = (state.filters.statuses.size || state.filters.profIds.size) ? ` (filtrados: ${filteredAppointments.length})` : '';
  counter.textContent = `Agendamentos: ${itemsAll.length}${filtered}`;
  header.appendChild(counter);
  els.agendaList.appendChild(header);

  if (!hours.length) {
    renderClosedMessage('Empresa fechada para esta data.');
    return;
  }

  const body = document.createElement('div');
  body.style.display = 'grid';
  body.style.gridTemplateColumns = `120px repeat(${Math.max(colCount - 1, 0)}, minmax(var(--agenda-col-w, 360px), 1fr))`;
  body.className = 'agenda-grid-body agenda-grid-body--day';
  els.agendaList.appendChild(body);

  const isToday = normalizeDate(date) === todayStr();
  const now = new Date();
  const nowHH = `${pad(now.getHours())}:00`;

  hours.forEach(hh => {
    const hourNumber = parseInt(hh.split(':')[0], 10);
    const inBusiness = hourNumber >= businessRange.startHour && hourNumber < businessRange.endHour;
    const isNowRow   = isToday && hh === nowHH;
    const timeCell = document.createElement('div');
    timeCell.className = 'agenda-time-cell';
    if (inBusiness) timeCell.classList.add('is-business'); else timeCell.classList.add('is-off');
    if (isNowRow) timeCell.classList.add('is-now');
    timeCell.textContent = hh;
    body.appendChild(timeCell);
    (profs || []).forEach(p => {
      const cell = document.createElement('div');
      cell.className = 'agenda-slot agenda-day-slot';
      if (!inBusiness) cell.classList.add('is-off');
      if (isNowRow) cell.classList.add('is-now');
      cell.dataset.profissionalId = String(p._id);
      cell.dataset.hh = hh;
      body.appendChild(cell);
    });
  });

  const cards = expandAppointmentsForCards(filteredAppointments);
  let placed = 0;
  for (const a of cards) {
    const when = a.h || a.scheduledAt;
    if (!when) continue;
    const d  = new Date(when);
    const hh = `${pad(d.getHours())}:00`;
    let profId = a.profissionalId ? String(a.profissionalId) : null;
    if (!profId) {
      let nameCandidate = '';
      if (typeof a.profissional === 'string') nameCandidate = a.profissional;
      else if (a.profissional && typeof a.profissional === 'object') nameCandidate = a.profissional.nome || '';
      const normalized = String(nameCandidate || '').trim().toLowerCase();
      if (normalized && byNameAll.has(normalized)) profId = String(byNameAll.get(normalized));
      if (!profId) {
        const fallbackVisible = (profs || []).find(p => p && p._id);
        if (fallbackVisible) {
          profId = String(fallbackVisible._id);
        } else {
          const fallbackAny = (profsAll || []).find(p => p && p._id);
          if (fallbackAny) profId = String(fallbackAny._id);
        }
      }
    }
    if (!profId) continue;
    let col = body.querySelector(`div[data-profissional-id="${profId}"][data-hh="${hh}"]`);
    if (!col && profs[0]) {
      col = body.querySelector(`div[data-profissional-id="${profs[0]._id}"][data-hh="${hh}"]`);
    }
    if (!col) continue;
    const meta = statusMeta(a.status);
    const card = document.createElement('div');
    card.setAttribute('data-appointment-id', a._id || '');
    if (Array.isArray(a.__serviceItemIds) && a.__serviceItemIds.length) {
      card.dataset.serviceItemIds = a.__serviceItemIds.join(',');
    }
    if (a.__statusActionKey) {
      card.dataset.statusActionKey = a.__statusActionKey;
    } else {
      card.dataset.statusActionKey = meta.key;
    }
    if (Array.isArray(a.__statusDetails) && a.__statusDetails.length) {
      card.dataset.statusDetails = JSON.stringify(a.__statusDetails);
    }
    card.style.setProperty('--stripe', meta.stripe);
    card.style.setProperty('--card-max-w', '320px');
    card.className = 'agenda-card cursor-move select-none';
    card.dataset.status = meta.key;
    card.setAttribute('draggable', 'true');

    const headerEl = document.createElement('div');
    headerEl.className = 'agenda-card__head flex justify-between';
    const tutorShort = shortTutorName(a.clienteNome || '');
    const headLabel  = tutorShort ? `${tutorShort} | ${a.pet || ''}` : (a.pet || '');
    const titleEl = document.createElement('div');
    titleEl.className = 'agenda-card__title font-semibold text-gray-900 truncate';
    titleEl.title = headLabel;
    titleEl.textContent = headLabel;
    headerEl.appendChild(titleEl);
    headerEl.appendChild(createStatusBadgeElement(a, { size: 'compact' }));

    const servicesInfo = getAgendaServicesPreview(a.servico);
    const bodyEl = document.createElement('div');
    bodyEl.classList.add('agenda-card__body');
    if (servicesInfo.tooltip) bodyEl.title = servicesInfo.tooltip;
    if (a.observacoes && String(a.observacoes).trim()) {
      const svc = document.createElement('div');
      svc.className = 'agenda-card__service text-gray-600 clamp-2';
      svc.textContent = servicesInfo.preview || '';
      if (servicesInfo.tooltip) svc.title = servicesInfo.tooltip;
      applyAgendaTextClamp(svc, 2);
      const obs = document.createElement('div');
      obs.className = 'agenda-card__note mt-1 text-gray-700 italic clamp-2';
      obs.textContent = String(a.observacoes).trim();
      applyAgendaTextClamp(obs, 2);
      bodyEl.appendChild(svc);
      bodyEl.appendChild(obs);
    } else {
      bodyEl.classList.add('text-gray-600', 'clamp-2');
      bodyEl.textContent = servicesInfo.preview || '';
      applyAgendaTextClamp(bodyEl, 2);
    }

    const footerEl = document.createElement('div');
    footerEl.className = 'agenda-card__footer flex items-center justify-end';
    const price = document.createElement('div');
    price.className = 'agenda-card__price text-gray-800 font-medium';
    price.textContent = money(a.valor);
    footerEl.appendChild(createFichaClinicaChip(a));
    footerEl.appendChild(price);

    card.appendChild(headerEl);
    card.appendChild(bodyEl);
    card.appendChild(footerEl);
    col.appendChild(card);
    placed++;
  }

  if (placed === 0) {
    const empty = document.createElement('div');
    empty.className = 'px-4 py-3 text-sm text-slate-600 bg-slate-50 border-b';
    empty.textContent = 'Sem agendamentos para este filtro/dia.';
    els.agendaList.insertBefore(empty, header.nextSibling);
  }
}

export function renderWeekGrid() {
  const base = normalizeDate(els.dateInput?.value || todayStr());
  const ini  = startOfWeek(base);
  const days = Array.from({ length: 7 }, (_, i) => addDays(ini, i));
  updateHeaderLabel();
  clearChildren(els.agendaList);

  const ranges = days.map(d => getBusinessRangeForDate(d));
  const openRanges = ranges.filter(r => !r.closed);
  if (!openRanges.length) {
    renderClosedMessage('Empresa fechada durante a semana selecionada.');
    return;
  }
  const startHour = Math.min(...openRanges.map(r => r.startHour));
  const endHour = Math.max(...openRanges.map(r => r.endHour));
  const hours = buildHoursList(startHour, endHour);
  const header = document.createElement('div');
  header.style.display = 'grid';
  header.style.gridTemplateColumns = `120px repeat(7, minmax(180px,1fr))`;
  header.className = 'agenda-grid-header agenda-grid-header--week';
  header.innerHTML = `
    <div class="px-2 py-2 text-xs text-slate-500">Horário</div>
    ${days.map(d=>{
      const lab = new Date(d+'T00:00:00').toLocaleDateString('pt-BR', { weekday:'short', day:'2-digit', month:'2-digit' });
      return `<div class=\"px-3 py-2 text-xs font-medium text-slate-700\">${lab}</div>`;
    }).join('')}
  `;
  els.agendaList.appendChild(header);
  const body = document.createElement('div');
  body.style.display = 'grid';
  body.style.gridTemplateColumns = `120px repeat(7, minmax(180px,1fr))`;
  body.className = 'agenda-grid-body agenda-grid-body--week';
  els.agendaList.appendChild(body);

  hours.forEach(hh => {
    const hNum = parseInt(hh.slice(0,2),10);
    const timeCell = document.createElement('div');
    timeCell.className = 'agenda-time-cell agenda-time-cell--compact';
    timeCell.classList.add('is-business');
    timeCell.textContent = hh;
    body.appendChild(timeCell);
    days.forEach((d, index) => {
      const range = ranges[index];
      const inBusiness = !range.closed && hNum >= range.startHour && hNum < range.endHour;
      const cell = document.createElement('div');
      cell.className = 'agenda-slot agenda-week-slot';
      if (!inBusiness) cell.classList.add('is-off');
      cell.dataset.day = d;
      cell.dataset.hh  = hh;
      body.appendChild(cell);
    });
  });

  const filteredWeek = getFilteredAgendamentos(state.agendamentos || []);
  const items = expandAppointmentsForCards(filteredWeek);
  let placed = 0;
  for (const a of items) {
    const when = a.h || a.scheduledAt; if (!when) continue;
    const dt     = new Date(when);
    const dayStr = localDateStr(dt);
    if (dayStr < days[0] || dayStr > days[6]) continue;
    const hh = `${pad(dt.getHours())}:00`;
    const cell = els.agendaList.querySelector(`div[data-day="${dayStr}"][data-hh="${hh}"]`);
    if (!cell) continue;
    const meta = statusMeta(a.status);
    const card = document.createElement('div');
    card.setAttribute('data-appointment-id', a._id || '');
    if (Array.isArray(a.__serviceItemIds) && a.__serviceItemIds.length) {
      card.dataset.serviceItemIds = a.__serviceItemIds.join(',');
    }
    if (a.__statusActionKey) {
      card.dataset.statusActionKey = a.__statusActionKey;
    } else {
      card.dataset.statusActionKey = meta.key;
    }
    if (Array.isArray(a.__statusDetails) && a.__statusDetails.length) {
      card.dataset.statusDetails = JSON.stringify(a.__statusDetails);
    }
    card.style.setProperty('--stripe', meta.stripe);
    card.style.setProperty('--card-max-w', '100%');
    card.className = 'agenda-card agenda-card--compact cursor-pointer select-none px-2 py-1';
    card.dataset.status = meta.key;
    card.setAttribute('draggable', 'true');
    const weekServicesInfo = getAgendaServicesPreview(a.servico);
    card.title = [
      a.pet || '',
      weekServicesInfo.tooltip ? `Serviços:\n${weekServicesInfo.tooltip}` : '',
      (a.observacoes ? `Obs: ${String(a.observacoes).trim()}` : ''),
    ].filter(Boolean).join('\n');

    const headerEl = document.createElement('div');
    headerEl.className = 'agenda-card__head flex justify-between';
    const tutorShort = shortTutorName(a.clienteNome || a.tutor || '');
    const headLabel  = tutorShort ? `${tutorShort} | ${a.pet || ''}` : (a.pet || '');
    headerEl.innerHTML = `
      <div class="agenda-card__title font-medium text-gray-900 truncate" title="${headLabel}">${headLabel}</div>
    `;

    const bodyEl = document.createElement('div');
    bodyEl.classList.add('agenda-card__body');
    const svc = document.createElement('div');
    svc.className = 'agenda-card__service text-gray-600 truncate';
    svc.textContent = weekServicesInfo.preview || '';
    if (weekServicesInfo.tooltip) svc.title = weekServicesInfo.tooltip;
    bodyEl.appendChild(svc);
    if (a.observacoes && String(a.observacoes).trim()) {
      const obs = document.createElement('div');
      obs.className = 'agenda-card__note text-gray-700 italic truncate';
      obs.textContent = String(a.observacoes).trim();
      bodyEl.appendChild(obs);
    }

    const footerEl = document.createElement('div');
    footerEl.className = 'agenda-card__footer flex items-center justify-end';
    const statusEl = createStatusBadgeElement(a, { size: 'compact' });
    const price = document.createElement('div');
    price.className = 'agenda-card__price text-gray-800 font-semibold';
    price.textContent = money(a.valor);
    footerEl.appendChild(statusEl);
    footerEl.appendChild(createFichaClinicaChip(a));
    footerEl.appendChild(price);

    card.appendChild(headerEl);
    card.appendChild(bodyEl);
    card.appendChild(footerEl);
    cell.appendChild(card);
    placed++;
  }
  if (placed === 0) {
    const empty = document.createElement('div');
    empty.className = 'p-6 text-sm text-slate-500';
    empty.textContent = 'Nenhum agendamento no intervalo.';
    els.agendaList.appendChild(empty);
  }
}

export function renderMonthGrid() {
  const base = normalizeDate(els.dateInput?.value || todayStr());
  const m0   = startOfMonth(base);
  const m1   = startOfNextMonth(base);
  updateHeaderLabel();
  clearChildren(els.agendaList);
  const weekDays = ['Seg','Ter','Qua','Qui','Sex','Sáb','Dom'];
  const header = document.createElement('div');
  header.style.display = 'grid';
  header.style.gridTemplateColumns = `repeat(7, minmax(180px,1fr))`;
  header.className = 'agenda-grid-header agenda-grid-header--month';
  header.innerHTML = weekDays.map(d=>`<div class="px-3 py-2 text-xs font-medium text-slate-700">${d}</div>`).join('');
  els.agendaList.appendChild(header);

  const startGrid = startOfWeek(m0);
  const days = Array.from({length:42},(_,i)=> addDays(startGrid,i));
  const grid = document.createElement('div');
  grid.style.display = 'grid';
  grid.style.gridTemplateColumns = `repeat(7, minmax(180px,1fr))`;
  grid.className = 'agenda-grid-body agenda-grid-body--month';
  els.agendaList.appendChild(grid);

  const filteredMonth = getFilteredAgendamentos((state.agendamentos||[]).slice().sort((a,b)=>(new Date(a.h||a.scheduledAt))-(new Date(b.h||b.scheduledAt))));
  const cards = expandAppointmentsForCards(filteredMonth);
  const byDay = new Map();
  for (const a of cards) {
    const d = localDateStr(new Date(a.h || a.scheduledAt));
    if (d >= m0 && d < m1) {
      if (!byDay.has(d)) byDay.set(d, []);
      byDay.get(d).push(a);
    }
  }

  days.forEach(d=>{
    const inMonth = (d>=m0 && d<m1);
    const cell = document.createElement('div');
    cell.className = `min-h-[140px] agenda-slot agenda-month-slot ${inMonth ? '' : 'is-off'}`;
    cell.dataset.day = d;
    const title = document.createElement('div');
    title.className = `flex items-center justify-between text-[11px] ${inMonth?'text-slate-700':'text-slate-400'} agenda-month-slot__title`;
    const dayNum = new Date(d+'T00:00:00').getDate();
    title.innerHTML = `<span class="font-semibold">${String(dayNum).padStart(2,'0')}</span>`;
    const list = document.createElement('div');
    list.className = 'mt-1 space-y-1 agenda-slot agenda-month-list';
    list.dataset.day = d;
    const itemsDay = byDay.get(d) || [];
    itemsDay.forEach((a, idx)=>{
      const meta = statusMeta(a.status);
      const when = new Date(a.h || a.scheduledAt);
      const hhmm = `${pad(when.getHours())}:${String(when.getMinutes()).padStart(2,'0')}`;
      const card = document.createElement('div');
      card.setAttribute('data-appointment-id', a._id || '');
      if (Array.isArray(a.__serviceItemIds) && a.__serviceItemIds.length) {
        card.dataset.serviceItemIds = a.__serviceItemIds.join(',');
      }
      if (a.__statusActionKey) {
        card.dataset.statusActionKey = a.__statusActionKey;
      } else {
        card.dataset.statusActionKey = meta.key;
      }
      if (Array.isArray(a.__statusDetails) && a.__statusDetails.length) {
        card.dataset.statusDetails = JSON.stringify(a.__statusDetails);
      }
      card.style.setProperty('--stripe', meta.stripe);
      card.style.setProperty('--card-max-w', '100%');
      card.className = 'agenda-card agenda-card--compact cursor-pointer select-none px-2 py-1';
      card.dataset.status = meta.key;
      card.setAttribute('draggable', 'true');
      const monthServicesInfo = getAgendaServicesPreview(a.servico);
      card.title = [
        a.pet || '',
        monthServicesInfo.tooltip ? `Serviços:\n${monthServicesInfo.tooltip}` : '',
        (a.observacoes ? `Obs: ${String(a.observacoes).trim()}` : ''),
      ].filter(Boolean).join('\n');
      const headerEl = document.createElement('div');
      headerEl.className = 'agenda-card__head flex items-center gap-2';
      const timeChip = document.createElement('span');
      timeChip.className = 'inline-flex items-center px-1.5 py-[1px] rounded bg-slate-100 text-[10px] font-medium';
      timeChip.textContent = hhmm;
      headerEl.appendChild(timeChip);
      const statusHolder = document.createElement('div');
      statusHolder.className = 'flex-1 flex items-center justify-center';
      statusHolder.appendChild(createStatusBadgeElement(a, { size: 'compact' }));
      headerEl.appendChild(statusHolder);
      const rawTutorName = a.tutor || a.tutorNome || a.clienteNome ||
        (a.cliente && (a.cliente.nomeCompleto || a.cliente.nomeContato || a.cliente.razaoSocial || a.cliente.nome || a.cliente.name)) ||
        (a.tutor && (a.tutor.nomeCompleto || a.tutor.nomeContato || a.tutor.razaoSocial || a.tutor.nome)) ||
        a.responsavelNome || (a.responsavel && (a.responsavel.nome || a.responsavel.name)) || '';
      const tutorShort = shortTutorName(rawTutorName);
      const headLabel  = [tutorShort, (a.pet || '')].filter(Boolean).join(' | ');
      const nameEl = document.createElement('div');
      nameEl.className = 'agenda-card__title font-medium text-gray-900 text-center truncate';
      nameEl.title = headLabel; nameEl.textContent = headLabel;
      const footerEl = document.createElement('div');
      footerEl.className = 'agenda-card__footer flex items-center justify-end';
      const price = document.createElement('div');
      price.className = 'agenda-card__price text-gray-800 font-semibold';
      price.textContent = money(a.valor);
      footerEl.appendChild(createFichaClinicaChip(a));
      footerEl.appendChild(price);
      card.appendChild(headerEl);
      card.appendChild(nameEl);
      card.appendChild(footerEl);
      list.appendChild(card);
      if (idx>=6 && itemsDay.length>7) {
        const more = document.createElement('div');
        more.className = 'text-[11px] text-slate-500';
        more.textContent = `+${itemsDay.length-6} itens`;
        list.appendChild(more);
        return;
      }
    });
    cell.appendChild(title);
    cell.appendChild(list);
    grid.appendChild(cell);
  });
}

