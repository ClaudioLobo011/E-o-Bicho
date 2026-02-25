import { api, els, state, money, debounce, todayStr, pad, buildLocalDateTime, isPrivilegedRole, confirmWithModal, notify, statusMeta, isNoPreferenceProfessionalId, AGENDA_NO_PREFERENCE_PROF_ID } from './core.js';
import { populateModalProfissionais, updateModalProfissionalLabel, getModalProfissionalTipo, getModalProfissionaisList } from './profissionais.js';
import { loadAgendamentos } from './agendamentos.js';
import { renderKpis, renderFilters } from './filters.js';
import { renderGrid } from './grid.js';
import { enhanceAgendaUI } from './ui.js';
import { confirmCheckinPrompt, openCheckinModal, findAppointmentById, closeCheckinModal, isCheckinModalOpen } from './checkin.js';

let __pendingCheckin = null;
let __pendingCheckinTimer = null;
let __pendingCheckinPromise = null;

const SALE_VIA_PDV_MESSAGE = 'Finalize a venda pelo PDV para gerar o código automaticamente.';
const CUSTOMER_REGISTRATION_RELATIVE_URL = './clientes.html';

let customerRegisterPreviousFocus = null;
let customerRegisterFrameUrl = '';
let customerRegisterFrameWindow = null;
let customerRegisterMessageHandlerBound = false;

function clearPendingCheckinQueue() {
  if (__pendingCheckinTimer) {
    clearTimeout(__pendingCheckinTimer);
    __pendingCheckinTimer = null;
  }
  __pendingCheckin = null;
}

function attemptOpenPendingCheckin(remainingAttempts) {
  __pendingCheckinTimer = null;
  if (!__pendingCheckin) return;

  if (__pendingCheckinPromise) {
    __pendingCheckinTimer = setTimeout(() => attemptOpenPendingCheckin(remainingAttempts), 50);
    return;
  }

  const { id, fallback } = __pendingCheckin;
  const latest = (id ? findAppointmentById(id) : null) || fallback;

  if (!latest) {
    if (remainingAttempts <= 0) {
      clearPendingCheckinQueue();
      return;
    }
    __pendingCheckinTimer = setTimeout(() => attemptOpenPendingCheckin(remainingAttempts - 1), 120);
    return;
  }

  __pendingCheckinPromise = Promise.resolve(openCheckinModal(latest))
    .catch((error) => {
      console.error('agenda check-in open', error);
    })
    .finally(() => {
      __pendingCheckinPromise = null;
    });

  __pendingCheckinPromise.then(() => {
    if (!__pendingCheckin) return;
    if (isCheckinModalOpen()) {
      clearPendingCheckinQueue();
    } else if (remainingAttempts > 0) {
      __pendingCheckinTimer = setTimeout(() => attemptOpenPendingCheckin(remainingAttempts - 1), 160);
    } else {
      clearPendingCheckinQueue();
    }
  });
}

function scheduleCheckinOpen(context, attempts = 5) {
  clearPendingCheckinQueue();

  if (!context) return;

  const fallback = context.appointment || context;
  const idCandidate = context.id ?? fallback?._id ?? fallback?.id ?? '';
  const id = idCandidate ? String(idCandidate) : '';

  if (!id && !fallback) {
    return;
  }

  const tries = Math.max(1, attempts | 0);

  __pendingCheckin = { id, fallback, attempts: tries };

  const initialAttempts = __pendingCheckin.attempts;

  __pendingCheckinTimer = setTimeout(() => {
    attemptOpenPendingCheckin(initialAttempts);
  }, 0);
}

function normalizeCheckinPayload(context) {
  if (!context) return null;

  const base = context.appointment ?? context;
  const rawId = context.id ?? base?._id ?? base?.id ?? '';
  const id = rawId ? String(rawId) : '';

  const appointment =
    base && typeof base === 'object'
      ? { ...base }
      : {};

  if (id) {
    if (!appointment._id) appointment._id = id;
    if (!appointment.id) appointment.id = id;
  }

  if (!id && !Object.keys(appointment).length) {
    return null;
  }

  return { id, appointment };
}

async function triggerCheckinOpen(context, attempts = 5) {
  const payload = normalizeCheckinPayload(context);
  if (!payload) {
    clearPendingCheckinQueue();
    return null;
  }

  let opened = false;

  try {
    await openCheckinModal(payload.appointment);
    opened = isCheckinModalOpen();
  } catch (error) {
    console.error('agenda check-in immediate open', error);
  }

  if (!opened) {
    scheduleCheckinOpen(payload, attempts);
  } else {
    clearPendingCheckinQueue();
  }

  return payload;
}

if (typeof document !== 'undefined') {
  document.addEventListener('agenda:checkin:opened', () => {
    clearPendingCheckinQueue();
  });
  document.addEventListener('agenda:checkin:closed', () => {
    clearPendingCheckinQueue();
  });
}

export function openVendaModal() {
  notify(SALE_VIA_PDV_MESSAGE, 'info');
}

export function closeVendaModal() {}

// expose for external triggers, keeping backward-compat
window.openVendaModal = openVendaModal;
window.closeVendaModal = closeVendaModal;
// Bridges globais para facilitar chamadas diretas a partir do UI sem import circular
window.__openEditFromUI = (item) => openEditModal(item);
window.__updateStatusQuick = (id, status, opts) => updateStatusQuick(id, status, opts);
window.__openAddFromUI = (opts) => openAddModal(opts);

export function openAddModal(preselectProfId) {
  let preselectedId = '';
  let prefilledDate = '';
  let prefilledHour = '';
  if (preselectProfId && typeof preselectProfId === 'object') {
    if (typeof preselectProfId.preventDefault === 'function') {
      try { preselectProfId.preventDefault(); } catch {}
    } else {
      preselectedId = String(
        preselectProfId.preselectProfId ??
        preselectProfId.profissionalId ??
        preselectProfId.profId ??
        ''
      );
      prefilledDate = String(preselectProfId.date || preselectProfId.day || '').trim();
      prefilledHour = String(preselectProfId.hour || preselectProfId.hh || '').trim();
    }
  } else if (preselectProfId != null) {
    preselectedId = String(preselectProfId);
  }
  state.editing = null;
  if (!els.modal) { console.warn('Modal #modal-add-servico nÃ£o encontrado'); return; }
  state.tempServicos = [];
  renderServicosLista();
  if (els.addServAddBtn) els.addServAddBtn.classList.remove('hidden');
  [els.cliInput, els.servInput, els.valorInput, els.petSelect].forEach(el => { if (el) el.disabled = false; });
  state.selectedCliente = null;
  state.selectedServico = null;
  if (els.cliInput) { els.cliInput.value = ''; }
  if (els.cliSug) { els.cliSug.innerHTML = ''; els.cliSug.classList.add('hidden'); }
  if (els.servInput) { els.servInput.value = ''; }
  if (els.servSug) { els.servSug.innerHTML = ''; els.servSug.classList.add('hidden'); }
  if (els.valorInput) { els.valorInput.value = ''; }
  if (els.petSelect) { els.petSelect.innerHTML = ''; }
  if (els.obsInput) { els.obsInput.value = ''; }
  if (els.addStoreSelect) {
    if (els.storeSelect && els.storeSelect.options.length) {
      els.addStoreSelect.innerHTML = els.storeSelect.innerHTML;
    } else if (state.stores?.length) {
      els.addStoreSelect.innerHTML = state.stores.map(s => `<option value="${s._id}">${s.nome}</option>`).join('');
    }
    const sid = state.selectedStoreId || els.storeSelect?.value || '';
    els.addStoreSelect.value = sid;
    try { if (sid) { populateModalProfissionais(sid, preselectedId); } } catch{}
  }
  if (els.addDateInput) {
    const date = prefilledDate || (els.dateInput?.value) || todayStr();
    els.addDateInput.value = date;
  }
  if (els.horaInput) {
    if (/^\d{2}:\d{2}$/.test(prefilledHour)) {
      els.horaInput.value = prefilledHour;
    } else {
      const now = new Date();
      const hh = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
      els.horaInput.value = hh;
    }
  }
  if (els.obsInput) { els.obsInput.value = ''; }
  if (els.statusSelect) els.statusSelect.value = 'agendado';
  if (preselectedId && els.profSelect) {
    try { els.profSelect.value = preselectedId; } catch {}
    updateModalProfissionalLabel(preselectedId);
  }
  if (els.modalDelete) els.modalDelete.classList.add('hidden');
  els.modal.classList.remove('hidden');
  els.modal.classList.add('flex');
  els.cliInput?.focus();
}

export function closeModal() {
  if (!els.modal) return;
  els.modal.classList.add('hidden');
  els.modal.classList.remove('flex');
  state.editing = null;
  [els.cliInput, els.servInput, els.valorInput, els.petSelect].forEach(el => { if (el) el.disabled = false; });
}

const buildCustomerRegistrationUrl = () => {
  const url = new URL(CUSTOMER_REGISTRATION_RELATIVE_URL, window.location.href);
  url.searchParams.set('from', 'agenda');
  const storeId = state.selectedStoreId || els.addStoreSelect?.value || '';
  if (storeId) {
    url.searchParams.set('storeId', storeId);
  }
  return url.toString();
};

const setCustomerRegistrationLoading = (loading) => {
  if (els.customerRegisterLoading) {
    els.customerRegisterLoading.classList.toggle('hidden', !loading);
  }
  if (els.customerRegisterFrame) {
    els.customerRegisterFrame.classList.toggle('hidden', loading);
  }
};

const applyCustomerRegistrationFrameHeight = (height) => {
  if (!els.customerRegisterFrame) return;
  const numericHeight = Number(height);
  if (!Number.isFinite(numericHeight) || numericHeight <= 0) return;
  const viewportLimit = Math.max(window.innerHeight - 160, 360);
  const clamped = Math.max(360, Math.min(numericHeight, viewportLimit));
  els.customerRegisterFrame.style.height = `${clamped}px`;
};

const openCustomerRegisterModal = () => {
  const url = buildCustomerRegistrationUrl();
  if (!els.customerRegisterModal || !els.customerRegisterFrame) {
    window.open(url, '_blank', 'noopener');
    return;
  }
  const shouldReload = !customerRegisterFrameUrl || customerRegisterFrameUrl !== url;
  customerRegisterPreviousFocus =
    document.activeElement instanceof HTMLElement ? document.activeElement : null;
  els.customerRegisterModal.classList.remove('hidden');
  els.customerRegisterModal.setAttribute('data-modal-open', 'true');
  document.body?.classList.add('overflow-hidden');
  if (shouldReload) {
    setCustomerRegistrationLoading(true);
    try {
      els.customerRegisterFrame.src = url;
      customerRegisterFrameUrl = url;
    } catch (error) {
      console.error('Não foi possível carregar o cadastro de cliente no iframe da agenda.', error);
      window.open(url, '_blank', 'noopener');
      closeCustomerRegisterModal();
      return;
    }
  } else {
    setCustomerRegistrationLoading(false);
  }
  window.setTimeout(() => {
    els.customerRegisterClose?.focus();
  }, 120);
};

const closeCustomerRegisterModal = () => {
  if (!els.customerRegisterModal) return;
  els.customerRegisterModal.classList.add('hidden');
  els.customerRegisterModal.removeAttribute('data-modal-open');
  document.body?.classList.remove('overflow-hidden');
  if (customerRegisterPreviousFocus && typeof customerRegisterPreviousFocus.focus === 'function') {
    try {
      customerRegisterPreviousFocus.focus();
    } catch (error) {
      console.debug('Não foi possível restaurar o foco após fechar o cadastro de cliente da agenda.', error);
    }
  }
  customerRegisterPreviousFocus = null;
};

const handleCustomerRegisterModalKeydown = (event) => {
  if (event.key === 'Escape') {
    event.preventDefault();
    closeCustomerRegisterModal();
  }
};

const handleCustomerRegisterFrameLoad = () => {
  customerRegisterFrameWindow = els.customerRegisterFrame?.contentWindow || null;
  setCustomerRegistrationLoading(false);
};

const handleCustomerRegisterIframeMessage = (event) => {
  if (!event || !event.data || event.data.source !== 'eo-bicho') return;
  if (!customerRegisterFrameWindow || event.source !== customerRegisterFrameWindow) return;
  if (!els.customerRegisterFrame) return;
  if (event.data.type === 'TAB_CONTENT_RESIZE') {
    const height = event.data.modalExtent || event.data.modalHeight || event.data.height;
    applyCustomerRegistrationFrameHeight(height);
  }
};

export function toDateInputValueFromISO(isoStr) {
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return todayStr();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function openEditModal(a) {
  state.editing = a || null;
  if (!els.modal || !state.editing) return;
  state.tempServicos = Array.isArray(a.servicos)
    ? a.servicos.map(x => {
        const obsRaw = x.observacao ?? x.observacoes ?? '';
        return {
          _id: x._id,
          nome: x.nome,
          valor: Number(x.valor || 0),
          profissionalId: x.profissionalId ? String(x.profissionalId) : '',
          profissionalNome: x.profissionalNome || '',
          itemId: x.itemId || null,
          hora: normalizeHourValue(x.hora || x.horario || x.h || x.scheduledAt || a.h || a.scheduledAt || ''),
          status: normalizeStatusValue(x.status || x.situacao || a.status || 'agendado'),
          observacao: typeof obsRaw === 'string' ? obsRaw : '',
        };
      })
    : (a.servico ? [{
        _id: null,
        nome: a.servico,
        valor: Number(a.valor || 0),
        profissionalId: a.profissionalId ? String(a.profissionalId) : '',
        profissionalNome: typeof a.profissional === 'string' ? a.profissional : (a.profissional?.nomeCompleto || a.profissional?.nomeContato || a.profissional?.razaoSocial || ''),
        itemId: null,
        hora: normalizeHourValue(a.h || a.scheduledAt || ''),
        status: normalizeStatusValue(a.status || 'agendado'),
        observacao: typeof a.observacoes === 'string' ? a.observacoes : '',
      }] : []);
  renderServicosLista();
  state.selectedServico = null;
  if (els.servInput) { els.servInput.value = ''; els.servInput.disabled = false; }
  if (els.servSug)   { els.servSug.innerHTML = ''; els.servSug.classList.add('hidden'); }
  if (els.valorInput){ els.valorInput.value = ''; els.valorInput.disabled = false; }
  if (els.addServAddBtn) els.addServAddBtn.classList.remove('hidden');
  if (els.addStoreSelect) {
    if (els.storeSelect && els.storeSelect.options.length) {
      els.addStoreSelect.innerHTML = els.storeSelect.innerHTML;
    } else if (state.stores?.length) {
      els.addStoreSelect.innerHTML = state.stores.map(s => `<option value="${s._id}">${s.nome}</option>`).join('');
    }
    els.addStoreSelect.value = a.storeId || state.selectedStoreId || els.storeSelect?.value || '';
    els.addStoreSelect.disabled = false;
  }
  if (els.addDateInput) {
    const iso = a.h || a.scheduledAt || new Date().toISOString();
    els.addDateInput.value = toDateInputValueFromISO(iso);
  }
  const d = new Date((a.h || a.scheduledAt) || new Date());
  const hh = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (els.horaInput) els.horaInput.value = hh;
  let profId = a.profissionalId ? String(a.profissionalId) : null;
  if (!profId && typeof a.profissional === 'string') {
    const key = a.profissional.trim().toLowerCase();
    const match = state.profissionais.find(p => String(p.nome || '').trim().toLowerCase() === key);
    if (match) profId = String(match._id);
  }
  if (els.profSelect) {
    els.profSelect.value = profId || AGENDA_NO_PREFERENCE_PROF_ID;
    updateModalProfissionalLabel(profId || AGENDA_NO_PREFERENCE_PROF_ID);
  }
  try {
    const sid = els.addStoreSelect?.value || a.storeId || '';
    if (sid) {
      const maybe = populateModalProfissionais(sid, profId);
      if (maybe && typeof maybe.then === 'function') {
        maybe.then(() => renderServicosLista()).catch(() => renderServicosLista());
      } else {
        renderServicosLista();
      }
    } else {
      renderServicosLista();
    }
  } catch {}
  if (els.statusSelect) {
    const keyRaw = String(a.status || 'agendado')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .trim().toLowerCase().replace(/[-\s]+/g, '_');
    const allowed = ['agendado', 'em_espera', 'em_atendimento', 'finalizado'];
    els.statusSelect.value = allowed.includes(keyRaw) ? keyRaw : 'agendado';
  }
  if (els.obsInput) { els.obsInput.value = (a.observacoes || '').trim(); }
  if (els.cliInput) { els.cliInput.value = (a.clienteNome || ''); els.cliInput.disabled = true; }
  if (els.petSelect) {
    els.petSelect.innerHTML = '';
    try {
      const clienteId = a.clienteId || (a.cliente && a.cliente._id) || null;
      if (clienteId) {
        api(`/func/clientes/${clienteId}/pets`).then(r => r.json().catch(() => []))
          .then(pets => {
            els.petSelect.innerHTML = (Array.isArray(pets) ? pets : []).map(p => `<option value="${p._id}">${p.nome}</option>`).join('');
            const currentPetId = a.petId || (a.pet && a.pet._id) || '';
            if (currentPetId) els.petSelect.value = String(currentPetId);
          });
      }
    } catch {}
  }
  if (els.servInput) { els.servInput.value = ''; els.servInput.disabled = false; }
  if (els.valorInput) { els.valorInput.value = ''; els.valorInput.disabled = false; }
  if (els.modalDelete) els.modalDelete.classList.remove('hidden');
  els.modal.classList.remove('hidden');
  els.modal.classList.add('flex');
}

export async function searchClientes(term) {
  if (!term || term.length < 2) {
    if (els.cliSug) { els.cliSug.innerHTML = ''; els.cliSug.classList.add('hidden'); }
    return;
  }
  const resp = await api(`/func/clientes/buscar?q=${encodeURIComponent(term)}&limit=8`);
  const list = await resp.json().catch(() => []);
  if (!els.cliSug) return;
  els.cliSug.innerHTML = list.map(u => `
    <li class="px-3 py-2 hover:bg-gray-50 cursor-pointer" data-id="${u._id}" data-nome="${u.nome}">
      <div class="font-medium text-gray-900">${u.nome}</div>
      <div class="text-xs text-gray-500">${u.email || ''}</div>
    </li>`).join('');
  els.cliSug.classList.remove('hidden');
  els.cliSug.querySelectorAll('li').forEach(li => {
    li.addEventListener('click', async () => {
      state.selectedCliente = { _id: li.dataset.id, nome: li.dataset.nome };
      if (els.cliInput) els.cliInput.value = li.dataset.nome;
      els.cliSug.classList.add('hidden');
      const resp = await api(`/func/clientes/${state.selectedCliente._id}/pets`);
      const pets = await resp.json().catch(() => []);
      if (els.petSelect) {
        els.petSelect.innerHTML = pets.map(p => `<option value="${p._id}">${p.nome}</option>`).join('');
      }
    });
  });
}

function normalizeProfTipo(v) {
  return String(v || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .trim().toLowerCase();
}

function filterServicesByProfTipo(list, tipo) {
  const normTipo = normalizeProfTipo(tipo);
  const arr = Array.isArray(list) ? list : [];
  if (!normTipo) return arr;
  return arr.filter((s) => {
    const tipos = Array.isArray(s?.grupo?.tiposPermitidos) ? s.grupo.tiposPermitidos : [];
    if (!tipos.length) return true;
    return tipos.some((t) => normalizeProfTipo(t) === normTipo);
  });
}

export async function searchServicos(term) {
  if (!term || term.length < 2) {
    if (els.servSug) { els.servSug.innerHTML = ''; els.servSug.classList.add('hidden'); }
    return;
  }
  const storeId = els.addStoreSelect?.value || state.selectedStoreId || '';
  const petId   = els.petSelect?.value || '';
  const profTipo = normalizeProfTipo(getModalProfissionalTipo());
  const query = new URLSearchParams({
    q: term,
    storeId: storeId || '',
    petId: petId || '',
  });
  if (profTipo) query.set('profTipo', profTipo);
  const resp = await api(`/func/servicos/buscar?${query.toString()}`);
  const listRaw = await resp.json().catch(() => []);
  const list = filterServicesByProfTipo(listRaw, profTipo);
  if (!els.servSug) return;
  els.servSug.innerHTML = list.map(s => {
    const tiposPermitidos = Array.isArray(s?.grupo?.tiposPermitidos) ? s.grupo.tiposPermitidos : [];
    const tiposAttr = tiposPermitidos
      .map(t => normalizeProfTipo(t))
      .filter(Boolean)
      .join(',');
    return `
    <li class="px-3 py-2 hover:bg-gray-50 cursor-pointer" data-id="${s._id}" data-nome="${s.nome}" data-valor="${s.valor}" data-tipos="${tiposAttr}">
      <div class="font-medium text-gray-900">${s.nome}</div>
      <div class="text-xs text-gray-500">${money(s.valor)}</div>
    </li>`;
  }).join('');
  els.servSug.classList.remove('hidden');

  // Atualiza os valores exibidos com preÃ§o por raÃ§a
  try {
    const storeId2 = els.addStoreSelect?.value || state.selectedStoreId || '';
    const petId2   = els.petSelect?.value || '';
    if (storeId2) {
      const lis = Array.from(els.servSug.querySelectorAll('li'));
      lis.forEach(async (li) => {
        const sid = li.dataset.id;
        try {
          const r = await api(`/func/servicos/preco?serviceId=${sid}&storeId=${storeId2}&petId=${petId2 || ''}`);
          if (r.ok) {
            const j = await r.json().catch(() => null);
            if (j && typeof j.valor === 'number') {
              li.dataset.valor = String(Number(j.valor || 0));
              const price = li.querySelector('.text-xs.text-gray-500');
              if (price) price.textContent = money(Number(j.valor || 0));
            }
          }
        } catch { /* ignore */ }
      });
    }
  } catch { /* ignore */ }

  els.servSug.querySelectorAll('li').forEach(li => {
    li.addEventListener('click', async () => {
      let valor = Number(li.dataset.valor || 0);
      try {
        const sid = li.dataset.id;
        const storeId = els.addStoreSelect?.value || state.selectedStoreId || '';
        const petId   = els.petSelect?.value || '';
        if (sid && storeId) {
          const r = await api(`/func/servicos/preco?serviceId=${sid}&storeId=${storeId}&petId=${petId || ''}`);
          if (r.ok) {
            const j = await r.json().catch(() => null);
            if (j && typeof j.valor === 'number') valor = Number(j.valor || 0);
          }
        }
      } catch { /* ignore */ }
      const allowedTipos = (li.dataset.tipos || '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
      state.selectedServico = { _id: li.dataset.id, nome: li.dataset.nome, valor, tiposPermitidos: allowedTipos };
      if (els.servInput) els.servInput.value = state.selectedServico.nome;
      if (els.valorInput) els.valorInput.value = state.selectedServico.valor.toFixed(2);
      els.servSug.classList.add('hidden');
    });
  });
}

// Atualiza os preÃ§os exibidos na lista de sugestÃµes conforme empresa/pet
async function updateVisibleServicePrices() {
  try {
    if (!els.servSug || els.servSug.classList.contains('hidden')) return;
    const storeId = els.addStoreSelect?.value || state.selectedStoreId || '';
    const petId   = els.petSelect?.value || '';
    if (!storeId) return;
    const lis = Array.from(els.servSug.querySelectorAll('li'));
    await Promise.all(lis.map(async (li) => {
      const sid = li.dataset.id;
      if (!sid) return;
      try {
        const r = await api(`/func/servicos/preco?serviceId=${sid}&storeId=${storeId}&petId=${petId || ''}`);
        if (r.ok) {
          const j = await r.json().catch(() => null);
          if (j && typeof j.valor === 'number') {
            li.dataset.valor = String(Number(j.valor || 0));
            const price = li.querySelector('.text-xs.text-gray-500');
            if (price) price.textContent = money(Number(j.valor || 0));
          }
        }
      } catch {}
    }));
  } catch {}
}

// Atualiza o valor do serviço já selecionado (campo de valor)
async function updateSelectedServicePrice() {
  try {
    const s = state.selectedServico;
    if (!s || !s._id) return;
    const storeId = els.addStoreSelect?.value || state.selectedStoreId || '';
    const petId   = els.petSelect?.value || '';
    if (!storeId) return;
    const r = await api(`/func/servicos/preco?serviceId=${s._id}&storeId=${storeId}&petId=${petId || ''}`);
    if (r.ok) {
      const j = await r.json().catch(() => null);
      if (j && typeof j.valor === 'number') {
        const valor = Number(j.valor || 0);
        state.selectedServico.valor = valor;
        if (els.valorInput) els.valorInput.value = valor.toFixed(2);
      }
    }
  } catch {}
}

const STATUS_OPTIONS = ['agendado', 'em_espera', 'em_atendimento', 'finalizado'];

function escapeHtml(value) {
  const replacements = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  };
  return String(value || '').replace(/[&<>"']/g, (ch) => replacements[ch] || ch);
}

function normalizeHourValue(raw) {
  if (!raw) return '';
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return `${pad(raw.getHours())}:${pad(raw.getMinutes())}`;
  }
  const str = String(raw || '').trim();
  if (!str) return '';
  const directMatch = str.match(/^(\d{2}):(\d{2})/);
  if (directMatch) {
    return `${directMatch[1]}:${directMatch[2]}`;
  }
  const asDate = new Date(str);
  if (!Number.isNaN(asDate.getTime())) {
    return `${pad(asDate.getHours())}:${pad(asDate.getMinutes())}`;
  }
  return '';
}

function normalizeStatusValue(raw) {
  return statusMeta(raw).key;
}

function buildStatusOptions(selectedKey) {
  const normalized = normalizeStatusValue(selectedKey);
  return STATUS_OPTIONS.map((value) => {
    const meta = statusMeta(value);
    const isSelected = normalized === meta.key;
    return `<option value="${meta.key}"${isSelected ? ' selected' : ''}>${escapeHtml(meta.label)}</option>`;
  }).join('');
}

export function renderServicosLista() {
  if (!els.servListUL || !els.servTotalEl) return;
  const items = state.tempServicos || [];
  const profs = getModalProfissionaisList();
  const buildOptions = (selectedId, fallbackName = '') => {
    const opts = ['<option value="">Selecione</option>'];
    let hasSelected = false;
    profs.forEach((prof) => {
      const value = String(prof._id || '');
      const isSelected = selectedId && value === String(selectedId);
      if (isSelected) hasSelected = true;
      const label = escapeHtml(prof.nome || '');
      opts.push(`<option value="${value}"${isSelected ? ' selected' : ''}>${label}</option>`);
    });
    if (selectedId && !hasSelected) {
      const safeName = escapeHtml(fallbackName || 'Profissional');
      const value = String(selectedId);
      opts.push(`<option value="${value}" selected>${safeName}</option>`);
    }
    return opts.join('');
  };
  els.servListUL.innerHTML = items.map((it, idx) => {
    const valorFmt = money(Number(it.valor || 0));
    const nomeSafe = escapeHtml(it.nome || '');
    const profId = it.profissionalId ? String(it.profissionalId) : '';
    const options = buildOptions(profId, it.profissionalNome || '');
    const horaValue = normalizeHourValue(it.hora || it.horario || it.h || '');
    const observacaoValue = escapeHtml(it.observacao || it.observacoes || '');
    const statusKey = normalizeStatusValue(it.status || it.situacao || 'agendado');
    return `
      <tr>
        <td class="px-3 py-2 align-top">
          <div class="font-medium text-gray-800">${nomeSafe}</div>
        </td>
        <td class="px-3 py-2 align-top text-right tabular-nums text-gray-700">${valorFmt}</td>
        <td class="px-3 py-2 align-top">
          <input type="time" value="${horaValue}" data-idx="${idx}" class="input-serv-hora w-28 rounded-md border-gray-300 focus:border-primary focus:ring-primary" />
        </td>
        <td class="px-3 py-2 align-top">
          <select data-idx="${idx}" class="select-serv-prof w-full rounded-md border-gray-300 focus:ring-primary focus:border-primary text-sm">
            ${options}
          </select>
        </td>
        <td class="px-3 py-2 align-top">
          <input type="text" value="${observacaoValue}" data-idx="${idx}" placeholder="Observação" class="input-serv-observacao w-full rounded-md border-gray-300 focus:border-primary focus:ring-primary" />
        </td>
        <td class="px-3 py-2 align-top">
          <select data-idx="${idx}" class="select-serv-status w-full rounded-md border-gray-300 focus:ring-primary focus:border-primary text-sm">
            ${buildStatusOptions(statusKey)}
          </select>
        </td>
        <td class="px-3 py-2 align-top text-center">
          <button type="button" data-idx="${idx}" class="remove-serv inline-flex items-center justify-center rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50">Remover</button>
        </td>
      </tr>
    `;
  }).join('');
  const total = items.reduce((s, x) => s + Number(x.valor || 0), 0);
  els.servTotalEl.textContent = money(total);
  els.servListUL.querySelectorAll('.remove-serv').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = parseInt(btn.getAttribute('data-idx'), 10);
      if (!Number.isNaN(i)) {
        state.tempServicos.splice(i, 1);
        renderServicosLista();
      }
    });
  });
  els.servListUL.querySelectorAll('.select-serv-prof').forEach((sel) => {
    sel.addEventListener('change', () => {
      const i = parseInt(sel.getAttribute('data-idx'), 10);
      if (Number.isNaN(i) || !state.tempServicos[i]) return;
      const selected = sel.value || '';
      state.tempServicos[i].profissionalId = selected;
      const option = sel.options[sel.selectedIndex];
      state.tempServicos[i].profissionalNome = option ? option.textContent.trim() : '';
    });
  });
  els.servListUL.querySelectorAll('.input-serv-hora').forEach((input) => {
    input.addEventListener('input', () => {
      const i = parseInt(input.getAttribute('data-idx'), 10);
      if (Number.isNaN(i) || !state.tempServicos[i]) return;
      state.tempServicos[i].hora = normalizeHourValue(input.value);
    });
  });
  els.servListUL.querySelectorAll('.input-serv-observacao').forEach((input) => {
    input.addEventListener('input', () => {
      const i = parseInt(input.getAttribute('data-idx'), 10);
      if (Number.isNaN(i) || !state.tempServicos[i]) return;
      state.tempServicos[i].observacao = input.value;
    });
  });
  els.servListUL.querySelectorAll('.select-serv-status').forEach((sel) => {
    sel.addEventListener('change', () => {
      const i = parseInt(sel.getAttribute('data-idx'), 10);
      if (Number.isNaN(i) || !state.tempServicos[i]) return;
      state.tempServicos[i].status = normalizeStatusValue(sel.value);
    });
  });
}

export async function saveAgendamento() {
  try {
    const dateRaw = (els.addDateInput?.value) || (els.dateInput?.value) || todayStr();
    const storeIdSelected = (els.addStoreSelect?.value) || state.selectedStoreId || els.storeSelect?.value;
    const hora = els.horaInput?.value;
    const defaultProfissionalIdRaw = (els.profSelect?.value || '').trim();
    const defaultProfissionalId = isNoPreferenceProfessionalId(defaultProfissionalIdRaw) ? '' : defaultProfissionalIdRaw;
    const status = (els.statusSelect?.value) || 'agendado';
    if (!hora) { try { els.horaInput.classList.add('border-red-500'); const p=document.createElement('p'); p.className='form-err text-xs text-red-600 mt-1'; p.textContent='Informe a hora.'; els.horaInput.parentElement.appendChild(p);} catch{}; return; }
    if (!storeIdSelected) { try { (els.addStoreSelect||els.storeSelect).classList.add('border-red-500'); const p=document.createElement('p'); p.className='form-err text-xs text-red-600 mt-1'; p.textContent='Selecione a empresa.'; (els.addStoreSelect||els.storeSelect).parentElement.appendChild(p);} catch{}; return; }

    const scheduledAt = buildLocalDateTime(dateRaw, hora).toISOString();
    const baseHora = normalizeHourValue(hora);
    const itemsRaw = Array.isArray(state.tempServicos) ? state.tempServicos : [];
    const normalizedServices = itemsRaw.map((svc) => {
      const profId = svc && svc.profissionalId ? String(svc.profissionalId).trim() : '';
      const resolvedProfRaw = profId || defaultProfissionalIdRaw;
      const resolvedProf = isNoPreferenceProfessionalId(resolvedProfRaw) ? '' : resolvedProfRaw;
      const serviceHour = normalizeHourValue((svc && (svc.hora || svc.horario)) || baseHora);
      const obsValueRaw = svc?.observacao ?? svc?.observacoes ?? '';
      const obsValue = typeof obsValueRaw === 'string' ? obsValueRaw : '';
      const statusValue = normalizeStatusValue(svc?.status || svc?.situacao || status);
      return {
        ...svc,
        profissionalId: resolvedProf ? String(resolvedProf) : '',
        profissionalSemPreferencia: Boolean(resolvedProfRaw && isNoPreferenceProfessionalId(resolvedProfRaw)),
        hora: serviceHour,
        observacao: obsValue,
        status: statusValue,
      };
    });
    const missingProfessional = normalizedServices.some((svc) => !svc.profissionalId && !svc.profissionalSemPreferencia);
    if (missingProfessional) {
      if (window.showToast) window.showToast('Defina um profissional para cada serviço adicionado.', 'warning'); else alert('Defina um profissional para cada serviço adicionado.');
      return;
    }
    const primaryProfissionalId = normalizedServices.find(svc => svc.profissionalId)?.profissionalId || defaultProfissionalId;

    if (state.editing && state.editing._id) {
      const id = state.editing._id;
      if (!normalizedServices.length) { try { els.servInput.classList.add('border-red-500'); const p=document.createElement('p'); p.className='form-err text-xs text-red-600 mt-1'; p.textContent='Adicione pelo menos 1 serviço.'; els.servInput.parentElement.appendChild(p);} catch{}; return; }
      const body = {
        storeId: storeIdSelected,
        ...(primaryProfissionalId ? { profissionalId: primaryProfissionalId } : {}),
        scheduledAt,
        status,
        observacoes: (els.obsInput?.value || '').trim(),
        servicos: normalizedServices.map(x => {
          const payload = {
            servicoId: x._id,
            valor: Number(x.valor || 0),
            status: normalizeStatusValue(x.status || status),
            ...(x.profissionalId ? { profissionalId: x.profissionalId } : {}),
            ...(x.itemId ? { itemId: x.itemId } : {}),
          };
          if (x.hora) payload.hora = x.hora;
          const obs = typeof x.observacao === 'string' ? x.observacao.trim() : '';
          if (obs) payload.observacao = obs;
          return payload;
        }),
        ...(state.editing.clienteId ? { clienteId: state.editing.clienteId } : {}),
        ...(els.petSelect?.value ? { petId: els.petSelect.value } : (state.editing.petId ? { petId: state.editing.petId } : {})),
        ...(typeof state.editing.pago !== 'undefined' ? { pago: state.editing.pago } : {})
      };
      const resp = await api(`/func/agendamentos/${id}`, { method: 'PUT', body: JSON.stringify(body) });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        if (window.showToast) window.showToast(err.message || 'Erro ao atualizar agendamento.', 'error'); else alert(err.message || 'Erro ao atualizar agendamento.');
        return;
      }
      await loadAgendamentos();
      renderKpis();
      renderFilters();
      closeModal();
      renderGrid();
      enhanceAgendaUI();
      return;
    }

    const clienteId = state.selectedCliente?._id;
    const petId = els.petSelect?.value;
    if (!(clienteId && petId && normalizedServices.length)) { try { if(!clienteId){ els.cliInput.classList.add('border-red-500'); const p1=document.createElement('p'); p1.className='form-err text-xs text-red-600 mt-1'; p1.textContent='Selecione o cliente.'; els.cliInput.parentElement.appendChild(p1);} if(!petId){ els.petSelect.classList.add('border-red-500'); const p2=document.createElement('p'); p2.className='form-err text-xs text-red-600 mt-1'; p2.textContent='Selecione o pet.'; els.petSelect.parentElement.appendChild(p2);} if(!normalizedServices.length){ els.servInput.classList.add('border-red-500'); const p3=document.createElement('p'); p3.className='form-err text-xs text-red-600 mt-1'; p3.textContent='Adicione pelo menos 1 serviço.'; els.servInput.parentElement.appendChild(p3);} } catch{}; return; }

    const body = {
      storeId: storeIdSelected,
      clienteId,
      petId,
      servicos: normalizedServices.map(x => {
        const payload = {
          servicoId: x._id,
          valor: Number(x.valor || 0),
          status: normalizeStatusValue(x.status || status),
          ...(x.profissionalId ? { profissionalId: x.profissionalId } : {}),
        };
        if (x.hora) payload.hora = x.hora;
        const obs = typeof x.observacao === 'string' ? x.observacao.trim() : '';
        if (obs) payload.observacao = obs;
        return payload;
      }),
      ...(primaryProfissionalId ? { profissionalId: primaryProfissionalId } : {}),
      scheduledAt,
      status,
      observacoes: (els.obsInput?.value || '').trim(),
      pago: false
    };
    const resp = await api('/func/agendamentos', { method: 'POST', body: JSON.stringify(body) });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.message || 'Erro ao salvar');
    }
    await loadAgendamentos();
    renderKpis();
    renderFilters();
    closeModal();
    renderGrid();
    enhanceAgendaUI();
  } catch (e) {
    console.error(e);
    if (window.showToast) {
      try { window.showToast(e.message || 'Erro ao salvar', 'error'); } catch (_) { alert(e.message || 'Erro ao salvar'); }
    } else {
      alert(e.message || 'Erro ao salvar');
    }
  }
}

export async function handleDelete() {
  const id = state.editing && state.editing._id ? String(state.editing._id) : null;
  if (!id) return;
  const ok = await confirmAsync('Excluir atendimento', 'Tem certeza que deseja excluir este atendimento? Esta aÃ§Ã£o nÃ£o pode ser desfeita.', { confirmText: 'Excluir', cancelText: 'Cancelar' });
  if (!ok) return;
  const resp = await api(`/func/agendamentos/${id}`, { method: 'DELETE' });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    alert(err.message || 'Erro ao excluir agendamento');
    return;
  }
  await loadAgendamentos();
  renderKpis();
  renderFilters();
  closeModal();
  renderGrid();
  enhanceAgendaUI();
}

export async function confirmAsync(title, message, opts = {}) {
  const confirmText = opts.confirmText || 'Excluir';
  const cancelText  = opts.cancelText  || 'Cancelar';
  const modalEl = els.modal || null;

  let prevVis;
  let prevPointerEvents;
  if (modalEl) {
    prevVis = modalEl.style.visibility;
    prevPointerEvents = modalEl.style.pointerEvents;
    modalEl.style.visibility = 'hidden';
    modalEl.style.pointerEvents = 'none';
  }

  const ensureOverlayOnTop = () => {
    try {
      const all = Array.from(document.querySelectorAll('body *'));
      const overlays = all.filter((element) => {
        const style = getComputedStyle(element);
        if (style.position !== 'fixed') return false;
        const rect = element.getBoundingClientRect();
        return rect.width >= window.innerWidth * 0.95 && rect.height >= window.innerHeight * 0.95;
      });
      const overlay = overlays.at(-1);
      if (overlay) {
        overlay.style.zIndex = '9999';
        overlay.style.pointerEvents = 'auto';
      }
    } catch (_) {}
  };

  if (typeof window !== 'undefined') {
    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(ensureOverlayOnTop);
    }
    setTimeout(ensureOverlayOnTop, 0);
  }

  try {
    return await confirmWithModal({
      title: title || 'Confirmação',
      message: message || 'Deseja prosseguir?',
      confirmText,
      cancelText,
    });
  } finally {
    if (modalEl) {
      modalEl.style.visibility = prevVis || '';
      modalEl.style.pointerEvents = prevPointerEvents || '';
    }
  }
}

export function bindModalAndActionsEvents() {
  els.customerRegisterButton?.addEventListener('click', (event) => {
    event.preventDefault();
    openCustomerRegisterModal();
  });
  els.customerRegisterClose?.addEventListener('click', closeCustomerRegisterModal);
  els.customerRegisterBackdrop?.addEventListener('click', closeCustomerRegisterModal);
  els.customerRegisterModal?.addEventListener('keydown', handleCustomerRegisterModalKeydown);
  els.customerRegisterFrame?.addEventListener('load', handleCustomerRegisterFrameLoad);
  if (!customerRegisterMessageHandlerBound && typeof window !== 'undefined') {
    window.addEventListener('message', handleCustomerRegisterIframeMessage);
    customerRegisterMessageHandlerBound = true;
  }
  // Atualiza preÃ§os da lista e do item selecionado ao mudar empresa/pet
  els.addStoreSelect?.addEventListener('change', () => { updateVisibleServicePrices(); updateSelectedServicePrice(); });
  els.petSelect?.addEventListener('change', () => { updateVisibleServicePrices(); updateSelectedServicePrice(); });
  // Limpa erros ao interagir com campos
  els.cliInput?.addEventListener('input', () => { try { els.cliInput.classList.remove('border-red-500'); const e=els.cliInput.parentElement.querySelector('.form-err'); if(e) e.remove(); } catch{} });
  els.petSelect?.addEventListener('change', () => { try { els.petSelect.classList.remove('border-red-500'); const e=els.petSelect.parentElement.querySelector('.form-err'); if(e) e.remove(); } catch{} });
  els.servInput?.addEventListener('input', () => { try { els.servInput.classList.remove('border-red-500'); const e=els.servInput.parentElement.querySelector('.form-err'); if(e) e.remove(); } catch{} });
  els.valorInput?.addEventListener('input', () => { try { els.valorInput.classList.remove('border-red-500'); const e=els.valorInput.parentElement.querySelector('.form-err'); if(e) e.remove(); } catch{} });
  els.addStoreSelect?.addEventListener('change', () => { try { els.addStoreSelect.classList.remove('border-red-500'); const e=els.addStoreSelect.parentElement.querySelector('.form-err'); if(e) e.remove(); } catch{} });
  els.horaInput?.addEventListener('input', () => { try { els.horaInput.classList.remove('border-red-500'); const e=els.horaInput.parentElement.querySelector('.form-err'); if(e) e.remove(); } catch{} });
  els.profSelect?.addEventListener('change', () => {
    try {
      els.profSelect.classList.remove('border-red-500');
      const e = els.profSelect.parentElement.querySelector('.form-err');
      if (e) e.remove();
    } catch {}
    updateModalProfissionalLabel();
    const currentTipo = normalizeProfTipo(getModalProfissionalTipo());
    if (state.selectedServico && Array.isArray(state.selectedServico.tiposPermitidos)) {
      const allowed = state.selectedServico.tiposPermitidos.map(t => normalizeProfTipo(t)).filter(Boolean);
      if (currentTipo && allowed.length && !allowed.includes(currentTipo)) {
        state.selectedServico = null;
        if (els.servInput) els.servInput.value = '';
        if (els.valorInput) els.valorInput.value = '';
      }
    }
    const term = els.servInput?.value || '';
    if (term.length >= 2) {
      searchServicos(term);
    } else if (els.servSug) {
      els.servSug.innerHTML = '';
      els.servSug.classList.add('hidden');
    }
  });
  els.addServAddBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    const s = state.selectedServico;
    const v = Number(els.valorInput?.value || 0);
    if (!s || !s._id) { try { els.servInput.classList.add('border-red-500'); const p=document.createElement('p'); p.className='form-err text-xs text-red-600 mt-1'; p.textContent='Escolha um serviço na busca.'; els.servInput.parentElement.appendChild(p);} catch{}; return; }
    if (!(v >= 0)) { try { els.valorInput.classList.add('border-red-500'); const p=document.createElement('p'); p.className='form-err text-xs text-red-600 mt-1'; p.textContent='Valor inválido.'; els.valorInput.parentElement.appendChild(p);} catch{}; return; }
    const currentProfId = s && s.profissionalId ? String(s.profissionalId) : (els.profSelect?.value || '').trim();
    const profList = getModalProfissionaisList();
    const profEntry = profList.find(p => String(p._id || '') === currentProfId);
    const profNome = profEntry ? profEntry.nome : (s?.profissionalNome || '');
    const horaDefault = normalizeHourValue(els.horaInput?.value || state.editing?.h || state.editing?.scheduledAt || '');
    const statusDefault = normalizeStatusValue((els.statusSelect?.value) || state.editing?.status || 'agendado');
    const obsDefault = typeof els.obsInput?.value === 'string' ? els.obsInput.value : '';
    state.tempServicos.push({
      _id: s._id,
      nome: s.nome,
      valor: v,
      profissionalId: currentProfId,
      profissionalNome: profNome || '',
      itemId: s.itemId || null,
      hora: horaDefault,
      status: statusDefault,
      observacao: obsDefault,
    });
    state.selectedServico = null;
    if (els.servInput)  els.servInput.value = '';
    if (els.valorInput) els.valorInput.value = '';
    renderServicosLista();
  });
  els.modalDelete?.addEventListener('click', handleDelete);
  // Use capture phase to avoid being blocked by other handlers
  if (false) els.actionsRoot?.addEventListener('click', (ev) => {
    const more = ev.target.closest?.('.agenda-card__more');
    if (more) { const holder = more.parentElement?.querySelector('.agenda-card__actions'); if (holder) holder.classList.toggle('hidden'); return; }
    const btn = ev.target.closest?.('.agenda-action');
    if (!btn) return;
    ev.preventDefault(); ev.stopPropagation();
    if (typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation();
    const id = btn.getAttribute('data-id'); if (!id) return;
    if (btn.classList.contains('edit')) {
      const item = state.agendamentos.find(x => String(x._id) === String(id));
      if (!item) return;
      if ((item.pago || item.codigoVenda) && !isPrivilegedRole()) { notify('Este agendamento já foi faturado. Apenas Admin/Admin Master podem editar.', 'warning'); return; }
      openEditModal(item);
    } else if (btn.classList.contains('status')) {
      const item = state.agendamentos.find(x => String(x._id) === String(id));
      const chain = ['agendado', 'em_espera', 'em_atendimento', 'finalizado'];
      const cur = (item && item.status) || 'agendado';
      const next = chain[(chain.indexOf(cur) + 1) % chain.length];
      updateStatusQuick(id, next);
    } else if (btn.classList.contains('cobrar')) {
      const item = state.agendamentos.find(x => String(x._id) === String(id));
      if (!item) return;
      if (item.pago || item.codigoVenda) { notify('Este agendamento já possui código de venda registrado.', 'warning'); return; }
      notify(SALE_VIA_PDV_MESSAGE, 'info');
    }
  }, true);
  // disabled: usando handlers diretos nos botÃµes em ui.js

  // Captura adicional a nÃ­vel de documento para garantir o clique no botÃ£o $
  const docChargeHandler = (ev) => { if (window.__forceDirectHandlers) return;
    const btn = ev.target?.closest?.('.agenda-action.cobrar');
    if (!btn) return;
    ev.preventDefault();
    if (typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation();
    ev.stopPropagation();
    const id = btn.getAttribute('data-id');
    if (!id) return;
    const item = state.agendamentos.find(x => String(x._id) === String(id));
    if (!item) return;
    if (item.pago || item.codigoVenda) { notify('Este agendamento já possui código de venda registrado.', 'warning'); return; }
    notify(SALE_VIA_PDV_MESSAGE, 'info');
  };
  document.addEventListener('click', docChargeHandler, true);
  els.cliInput?.addEventListener('input', debounce((e) => searchClientes(e.target.value), 300));
  els.servInput?.addEventListener('input', debounce((e) => searchServicos(e.target.value), 300));
}

export async function updateStatusQuick(id, status, options = {}) {
  const idStr = id != null ? String(id) : '';
  const opts = options || {};
  const serviceItemIds = Array.isArray(opts.serviceItemIds)
    ? opts.serviceItemIds.map((value) => String(value).trim()).filter(Boolean)
    : [];
  let shouldOpenCheckin = false;
  let checkinSource = null;
  if (status === 'em_atendimento') {
    try {
      const appointment = findAppointmentById(idStr);
      const checkinContext = appointment || { _id: idStr };
      let checkinTriggerScheduled = false;

      const ensureCheckinOpening = () => {
        if (checkinTriggerScheduled) return;
        checkinTriggerScheduled = true;
        clearPendingCheckinQueue();
        checkinSource = checkinContext;

        const payload = { id: idStr, appointment: checkinContext };
        const run = () => {
          try {
            const job = triggerCheckinOpen(payload, 8);
            if (job && typeof job.catch === 'function') {
              job.catch((error) => {
                console.error('updateStatusQuick.triggerCheckinOpen', error);
              });
            }
          } catch (error) {
            console.error('updateStatusQuick.triggerCheckinOpen', error);
          }
        };

        if (typeof requestAnimationFrame === 'function') {
          requestAnimationFrame(run);
        } else {
          setTimeout(run, 0);
        }
      };

      shouldOpenCheckin = await confirmCheckinPrompt(appointment, {
        onConfirm: () => {
          ensureCheckinOpening();
        },
        onCancel: () => {
          clearPendingCheckinQueue();
        },
      });
      if (shouldOpenCheckin) {
        ensureCheckinOpening();
      } else {
        clearPendingCheckinQueue();
      }
    } catch (error) {
      console.error('updateStatusQuick.checkinPrompt', error);
      clearPendingCheckinQueue();
    }
  } else {
    clearPendingCheckinQueue();
  }
  try {
    const bodyPayload = { status };
    if (serviceItemIds.length) {
      bodyPayload.serviceItemIds = serviceItemIds;
    }
    const resp = await api(`/func/agendamentos/${idStr}`, { method: 'PUT', body: JSON.stringify(bodyPayload) });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.message || 'Erro ao mudar status');
    }
    await loadAgendamentos();
    renderKpis();
    renderFilters();
    renderGrid();
    enhanceAgendaUI();
    if (shouldOpenCheckin && !isCheckinModalOpen()) {
      const latest = findAppointmentById(idStr) || checkinSource || { _id: idStr };
      await triggerCheckinOpen({ id: idStr, appointment: latest }, 5);
    }
  } catch (e) {
    console.error('updateStatusQuick', e);
    if (shouldOpenCheckin) {
      try {
        closeCheckinModal();
      } catch (_) {}
      clearPendingCheckinQueue();
    }
    alert(e.message || 'Erro ao mudar status');
  }
}
