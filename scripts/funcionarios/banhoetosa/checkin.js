import { state, api, confirmWithModal } from './core.js';

const READONLY_CLASSES = ['bg-gray-100', 'cursor-not-allowed'];
const READY_RETRY_LIMIT = 20;
const READY_RETRY_DELAY = 30; // intervalo em milissegundos entre tentativas ao aguardar o DOM

let cachedEls = null;
let isBound = false;
let currentContext = null;
let lastFocus = null;

function queryElements() {
  return {
    root: document.getElementById('checkin-modal'),
    closeBtn: document.getElementById('checkin-close-btn'),
    cancelBtn: document.getElementById('checkin-cancel-btn'),
    confirmBtn: document.getElementById('checkin-confirm-btn'),
    clienteNome: document.getElementById('checkin-cliente-nome'),
    petNome: document.getElementById('checkin-pet-nome'),
    petRaca: document.getElementById('checkin-pet-raca'),
    petTipo: document.getElementById('checkin-pet-tipo'),
    dddCel: document.getElementById('checkin-ddd-cel'),
    cel: document.getElementById('checkin-cel'),
    dddTel: document.getElementById('checkin-ddd-tel'),
    tel: document.getElementById('checkin-tel'),
    cep: document.getElementById('checkin-cep'),
    endereco: document.getElementById('checkin-endereco'),
    numero: document.getElementById('checkin-numero'),
    complemento: document.getElementById('checkin-complemento'),
    analise: document.getElementById('checkin-analise'),
    restricao: document.getElementById('checkin-restricao'),
    medicamento: document.getElementById('checkin-medicamento'),
  };
}

function getEls() {
  if (!cachedEls || !cachedEls.root || !document.body.contains(cachedEls.root)) {
    cachedEls = queryElements();
  }
  return cachedEls;
}

function wait(ms = 0) {
  return new Promise((resolve) => {
    if (ms <= 0) {
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => resolve());
        return;
      }
      setTimeout(resolve, 0);
      return;
    }
    setTimeout(resolve, ms);
  });
}

function whenDocumentReady() {
  if (typeof document === 'undefined') return Promise.resolve();
  if (document.readyState === 'loading') {
    return new Promise((resolve) => {
      document.addEventListener('DOMContentLoaded', resolve, { once: true });
    });
  }
  return Promise.resolve();
}

async function ensureCheckinModalReady() {
  if (initCheckinModal()) {
    return getEls();
  }

  await whenDocumentReady();
  if (initCheckinModal()) {
    return getEls();
  }

  for (let attempt = 0; attempt < READY_RETRY_LIMIT; attempt += 1) {
    const els = getEls();
    if (els.root) {
      initCheckinModal();
      return els;
    }
    await wait(READY_RETRY_DELAY);
  }

  return getEls();
}

function setText(el, value, fallback = '—') {
  if (!el) return;
  const text = value != null ? String(value).trim() : '';
  el.textContent = text || fallback;
}

function setReadOnlyValue(input, value) {
  if (!input) return;
  input.value = value || '';
  input.readOnly = true;
  READONLY_CLASSES.forEach((cls) => input.classList.add(cls));
}

function setEditableValue(field, value) {
  if (!field) return;
  field.value = value || '';
  field.readOnly = false;
  READONLY_CLASSES.forEach((cls) => field.classList.remove(cls));
}

function normalizeDigits(raw) {
  if (!raw) return '';
  let digits = String(raw).replace(/\D+/g, '');
  if (digits.startsWith('55') && digits.length > 11) {
    digits = digits.slice(2);
  }
  if (digits.startsWith('0') && digits.length > 2) {
    digits = digits.slice(1);
  }
  return digits;
}

function splitPhone(raw) {
  const digits = normalizeDigits(raw);
  if (!digits) return { ddd: '', number: '' };
  if (digits.length <= 2) return { ddd: '', number: digits };
  return {
    ddd: digits.slice(0, 2),
    number: digits.slice(2),
  };
}

function formatPhone(number) {
  if (!number) return '';
  const digits = normalizeDigits(number);
  if (digits.length === 9) {
    return digits.replace(/(\d{5})(\d{4})/, '$1-$2');
  }
  if (digits.length === 8) {
    return digits.replace(/(\d{4})(\d{4})/, '$1-$2');
  }
  if (digits.length > 4) {
    return `${digits.slice(0, digits.length - 4)}-${digits.slice(-4)}`;
  }
  return digits;
}

function formatCep(raw) {
  const digits = normalizeDigits(raw);
  if (digits.length === 8) {
    return digits.replace(/(\d{5})(\d{3})/, '$1-$2');
  }
  return raw || '';
}

function formatEndereco(address) {
  if (!address) return '';
  const parts = [];
  if (address.logradouro) parts.push(address.logradouro);
  const locality = [];
  if (address.bairro) locality.push(address.bairro);
  const cityUf = [address.cidade || '', address.uf || ''].filter(Boolean).join('/');
  if (cityUf) locality.push(cityUf);
  if (locality.length) parts.push(locality.join(' - '));
  return parts.join(', ');
}

async function fetchClientData(clienteId) {
  if (!clienteId) return null;
  try {
    const resp = await api(`/func/clientes/${clienteId}`);
    if (!resp.ok) return null;
    return await resp.json().catch(() => null);
  } catch (error) {
    console.error('fetchClientData', error);
    return null;
  }
}

async function fetchPetDetails(clienteId, petId) {
  if (!clienteId || !petId) return null;
  try {
    const resp = await api(`/func/clientes/${clienteId}/pets`);
    if (!resp.ok) return null;
    const list = await resp.json().catch(() => []);
    if (!Array.isArray(list)) return null;
    const pid = String(petId);
    return list.find((p) => String(p?._id || p?.id) === pid) || null;
  } catch (error) {
    console.error('fetchPetDetails', error);
    return null;
  }
}

function resetFields(appointment) {
  const els = getEls();
  setText(els.clienteNome, appointment?.clienteNome || '—');
  setText(els.petNome, appointment?.pet || '—');
  setText(els.petRaca, '—');
  setText(els.petTipo, '—');

  setReadOnlyValue(els.dddCel, '');
  setReadOnlyValue(els.cel, '');
  setReadOnlyValue(els.dddTel, '');
  setReadOnlyValue(els.tel, '');

  setReadOnlyValue(els.cep, '');
  setReadOnlyValue(els.endereco, '');
  setReadOnlyValue(els.numero, '');
  setReadOnlyValue(els.complemento, '');

  setEditableValue(els.analise, '');
  setEditableValue(els.restricao, '');
  setEditableValue(els.medicamento, '');
}

async function hydrateFields() {
  const ctx = currentContext;
  if (!ctx) return;
  const targetId = ctx.appointmentId;
  const clienteId = ctx.clienteId;
  const petId = ctx.petId;

  const [clienteData, petData] = await Promise.all([
    fetchClientData(clienteId),
    fetchPetDetails(clienteId, petId),
  ]);

  if (!currentContext || currentContext.appointmentId !== targetId) {
    return;
  }

  const els = getEls();

  if (clienteData) {
    const cel = splitPhone(clienteData.celular || clienteData.cel || clienteData.telefone);
    const tel = splitPhone(clienteData.telefone);

    setReadOnlyValue(els.dddCel, cel.ddd || '');
    setReadOnlyValue(els.cel, formatPhone(cel.number));
    setReadOnlyValue(els.dddTel, tel.ddd || '');
    setReadOnlyValue(els.tel, formatPhone(tel.number));

    if (clienteData.address) {
      setReadOnlyValue(els.cep, formatCep(clienteData.address.cep));
      setReadOnlyValue(els.endereco, formatEndereco(clienteData.address));
      setReadOnlyValue(els.numero, clienteData.address.numero || '');
      setReadOnlyValue(els.complemento, clienteData.address.complemento || '');
    }
  }

  if (petData) {
    setText(els.petRaca, petData.raca || '—');
    const tipo = petData.tipo ? String(petData.tipo).trim() : '';
    setText(els.petTipo, tipo ? tipo.charAt(0).toUpperCase() + tipo.slice(1) : '—');
  }
}

function showModal() {
  const els = getEls();
  if (!els.root) return;

  const root = els.root;

  lastFocus = document.activeElement;

  root.classList.remove('hidden');
  root.classList.add('flex');

  try {
    if (document.body && root.parentElement !== document.body) {
      document.body.appendChild(root);
    }
  } catch (error) {
    console.warn('checkin modal append', error);
  }

  try {
    root.style.display = 'flex';
    root.style.visibility = 'visible';
    root.style.opacity = '1';
    root.style.pointerEvents = 'auto';
    root.style.position = 'fixed';
    root.style.zIndex = '2147483647';
    root.removeAttribute('inert');
    root.setAttribute('aria-hidden', 'false');
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
  } catch (error) {
    console.warn('checkin modal style', error);
  }

  try {
    document.dispatchEvent(new CustomEvent('agenda:checkin:opened'));
  } catch (_) {
    // ignore dispatch failures (ex.: CustomEvent indisponível)
  }

  requestAnimationFrame(() => {
    try {
      els.analise?.focus({ preventScroll: true });
    } catch (error) {
      console.error('focus checkin modal', error);
    }
  });
}

function isModalVisible(root) {
  if (!root || root.classList.contains('hidden')) return false;
  const style = (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function')
    ? window.getComputedStyle(root)
    : root.style;

  if (!style) return true;

  const display = style.display ?? root.style.display;
  const visibility = style.visibility ?? root.style.visibility;
  const pointerEvents = style.pointerEvents ?? root.style.pointerEvents;
  const opacity = style.opacity ?? root.style.opacity;

  if (display === 'none') return false;
  if (visibility === 'hidden') return false;
  if (pointerEvents === 'none') return false;
  if (opacity === '0') return false;

  return true;
}

export function closeCheckinModal() {
  const els = getEls();
  if (!els.root) return;

  const root = els.root;
  const active = document.activeElement;
  const restore = (lastFocus && document.contains(lastFocus)) ? lastFocus : document.body;

  if (root.contains(active)) {
    try {
      restore?.focus?.();
    } catch {
      try {
        active?.blur?.();
      } catch {}
    }
  }

  root.classList.add('hidden');
  root.classList.remove('flex');
  try {
    root.style.display = 'none';
    root.style.visibility = 'hidden';
    root.style.opacity = '0';
    root.style.pointerEvents = 'none';
    root.setAttribute('aria-hidden', 'true');
    root.setAttribute('inert', '');
  } catch (error) {
    console.warn('hide checkin modal', error);
  }

  if (restore && document.contains(restore)) {
    try {
      restore.focus();
    } catch {}
  }

  lastFocus = null;
  currentContext = null;
  try {
    document.dispatchEvent(new CustomEvent('agenda:checkin:closed'));
  } catch (_) {
    // CustomEvent pode não existir em navegadores muito antigos; ignorar
  }
}

export function isCheckinModalOpen() {
  const els = getEls();
  return isModalVisible(els.root);
}

function collectPayload() {
  const els = getEls();
  return {
    appointmentId: currentContext?.appointmentId || '',
    clienteId: currentContext?.clienteId || '',
    petId: currentContext?.petId || '',
    clienteNome: currentContext?.clienteNome || '',
    petNome: currentContext?.petNome || '',
    analisePreBanho: (els.analise?.value || '').trim(),
    restricoes: (els.restricao?.value || '').trim(),
    medicamentos: (els.medicamento?.value || '').trim(),
    contato: {
      dddCelular: els.dddCel?.value || '',
      celular: els.cel?.value || '',
      dddTelefone: els.dddTel?.value || '',
      telefone: els.tel?.value || '',
    },
    endereco: {
      cep: els.cep?.value || '',
      logradouro: els.endereco?.value || '',
      numero: els.numero?.value || '',
      complemento: els.complemento?.value || '',
    },
  };
}

export async function openCheckinModal(appointment) {
  const els = await ensureCheckinModalReady();
  if (!els || !els.root) {
    console.warn('checkin modal: elemento não encontrado para abertura.');
    return;
  }

  const appointmentId = appointment?._id || appointment?.id || '';
  const clienteId = appointment?.clienteId || appointment?.cliente?.id || appointment?.cliente?._id || '';
  const petId = appointment?.petId || appointment?.pet?._id || '';

  currentContext = {
    appointmentId: appointmentId ? String(appointmentId) : '',
    clienteId: clienteId ? String(clienteId) : '',
    petId: petId ? String(petId) : '',
    clienteNome: appointment?.clienteNome || '',
    petNome: appointment?.pet || '',
  };

  resetFields(appointment);
  showModal();
  await hydrateFields();
}

export async function confirmCheckinPrompt(appointment, handlers = {}) {
  const cliente = appointment?.clienteNome ? ` do cliente ${appointment.clienteNome}` : '';
  const pet = appointment?.pet ? `${cliente ? ' e do pet ' : ' do pet '}${appointment.pet}` : '';
  const message = cliente || pet
    ? `Deseja realizar o check-in${cliente}${pet}?`
    : 'Deseja realizar o check-in agora?';

  const { onConfirm, onCancel, onFinally } = handlers || {};

  const invoke = (fn, ...args) => {
    if (typeof fn !== 'function') return;
    try {
      fn(...args);
    } catch (error) {
      console.error('confirmCheckinPrompt handler', error);
    }
  };

  try {
    return await confirmWithModal({
      title: 'Iniciar check-in',
      message,
      confirmText: 'Sim',
      cancelText: 'Agora não',
      onConfirm: () => invoke(onConfirm, appointment),
      onCancel: () => invoke(onCancel, appointment),
      onFinally: (didConfirm) => invoke(onFinally, didConfirm, appointment),
    });
  } catch (error) {
    console.error('confirmCheckinPrompt', error);
    return false;
  }
}

export function initCheckinModal() {
  if (isBound) {
    return !!getEls().root;
  }
  const els = getEls();
  if (!els.root) {
    return false;
  }

  isBound = true;

  const handleBackdrop = (ev) => {
    if (ev.target === els.root) {
      closeCheckinModal();
    }
  };

  els.closeBtn?.addEventListener('click', closeCheckinModal);
  els.cancelBtn?.addEventListener('click', closeCheckinModal);
  els.root.addEventListener('click', handleBackdrop);
  els.confirmBtn?.addEventListener('click', () => {
    const payload = collectPayload();
    try {
      document.dispatchEvent(new CustomEvent('agenda:checkin:submit', { detail: payload }));
    } catch (error) {
      console.error('dispatch agenda:checkin:submit', error);
    }
    closeCheckinModal();
  });

  try {
    document.removeEventListener('DOMContentLoaded', initCheckinModal);
  } catch (_) {
    // ignore: o listener pode não existir ou o navegador não suportar esta assinatura
  }

  return true;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initCheckinModal, { once: true });
} else {
  initCheckinModal();
}

export function findAppointmentById(id) {
  if (!id) return null;
  return (state.agendamentos || []).find((item) => String(item?._id) === String(id)) || null;
}
