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
let customerRegisterPreviousFocus = null;
let customerSearchPreviousFocus = null;
let customerModalSearchTimer = null;
let agendaCustomerPetSpeciesMap = null;
let agendaCustomerPetSpeciesMapPromise = null;
let agendaCustomerPetBreedOptions = [];
let agendaCustomerPetBreedFilteredOptions = [];
let agendaCustomerPetBreedActiveIndex = -1;
let agendaCustomerCepLookupController = null;
let agendaCustomerCepLastDigits = '';
let agendaCustomerCepLastResult = null;
const customerModalState = {
  clienteId: '',
  petId: '',
  selectedCliente: null,
  selectedPet: null,
  selectedAddress: null,
  creatingNewAddress: false,
  creatingNewPet: false,
  addresses: [],
  pets: [],
  searchResults: [],
  searchLoading: false,
  searchAbort: null,
  lastDocLookup: '',
  lastPhoneLookup: '',
};

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

function agendaCustomerNormalizeId(value) {
  return String(value || '').trim();
}

function agendaCustomerDigits(value) {
  return String(value || '').replace(/\D+/g, '');
}

function agendaCustomerFormatCep(value) {
  const digits = agendaCustomerDigits(value).slice(0, 8);
  if (!digits) return '';
  if (digits.length <= 5) return digits;
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
}

function agendaCustomerSplitPhone(value) {
  const digits = agendaCustomerDigits(value);
  if (digits.length >= 10) return { ddd: digits.slice(0, 2), number: digits.slice(2) };
  return { ddd: '', number: digits };
}

function agendaCustomerJoinPhone(dddValue, phoneValue) {
  const ddd = agendaCustomerDigits(dddValue).slice(-2);
  const phoneDigits = agendaCustomerDigits(phoneValue);
  if (!phoneDigits) return '';
  if (phoneDigits.length >= 10) return phoneDigits.slice(-11);
  if ((phoneDigits.length === 8 || phoneDigits.length === 9) && ddd) return `${ddd}${phoneDigits}`;
  return phoneDigits;
}

function agendaCustomerPhoneLocalDigits(value) {
  const digits = agendaCustomerDigits(value);
  if (digits.length >= 10) return digits.slice(2);
  return digits;
}

function agendaCustomerPhoneKind(value) {
  const localDigits = agendaCustomerPhoneLocalDigits(value);
  if (localDigits.length === 9) return 'celular';
  if (localDigits.length === 8) return 'telefone';
  return '';
}

function agendaCustomerCollectFormPhones() {
  const values = [
    agendaCustomerJoinPhone(els.customerPhone1Ddd?.value, els.customerPhone1?.value),
    agendaCustomerJoinPhone(els.customerPhone2Ddd?.value, els.customerPhone2?.value),
  ].map((value) => agendaCustomerDigits(value)).filter(Boolean);

  const result = {
    celular: '',
    celular2: '',
    telefone: '',
    telefone2: '',
  };

  values.forEach((value) => {
    const kind = agendaCustomerPhoneKind(value);
    if (!kind) return;
    if (kind === 'celular') {
      if (!result.celular) result.celular = value;
      else if (!result.celular2 && value !== result.celular) result.celular2 = value;
      return;
    }
    if (!result.telefone) result.telefone = value;
    else if (!result.telefone2 && value !== result.telefone) result.telefone2 = value;
  });

  return result;
}

function agendaCustomerCollectCustomerPhones(customer) {
  if (!customer || typeof customer !== 'object') return [];
  const values = [
    customer.celular,
    customer.telefone,
    customer.celular2,
    customer.celular_2,
    customer.celularSecundario,
    customer.telefone2,
    customer.telefoneSecundario,
    customer.telefone1,
    customer.telefoneFixo,
    customer.telefone_fixo,
  ];
  const result = [];
  values.forEach((value) => {
    const digits = agendaCustomerDigits(value);
    if (!digits) return;
    if (!result.includes(digits)) result.push(digits);
  });
  return result.slice(0, 2);
}

function agendaCustomerSetValue(element, value) {
  if (element) element.value = value == null ? '' : String(value);
}

function agendaCustomerSetChecked(element, value) {
  if (element) element.checked = !!value;
}

function agendaCustomerReadErr(response, fallback) {
  return response.json().then((payload) => payload?.message || fallback).catch(() => fallback);
}

function agendaCustomerName(customer) {
  if (!customer || typeof customer !== 'object') return '';
  return customer.nome || customer.nomeCompleto || customer.razaoSocial || customer.nomeContato || customer.nomeFantasia || '';
}

function agendaCustomerDoc(customer) {
  if (!customer || typeof customer !== 'object') return '';
  return customer.cpf || customer.cnpj || '';
}

function normalizeAgendaCustomerSexo(value) {
  const normalized = normalizeAgendaCustomerPetText(value);
  if (!normalized) return '';
  if (normalized === 'm' || normalized === 'masculino' || normalized === 'macho' || normalized === 'male') return 'M';
  if (normalized === 'f' || normalized === 'feminino' || normalized === 'femea' || normalized === 'female') return 'F';
  return String(value || '').trim();
}

function agendaCustomerGender(customer) {
  return normalizeAgendaCustomerSexo(customer?.sexo || customer?.genero || '');
}

function agendaCustomerBirth(customer) {
  const raw = customer?.dataNascimento || customer?.nascimento || '';
  return raw ? toDateInputValueFromISO(raw) : '';
}

function agendaCustomerResetSearch(message = 'Digite para pesquisar clientes.') {
  customerModalState.searchResults = [];
  if (els.customerSearchModalResults) els.customerSearchModalResults.innerHTML = '';
  if (els.customerSearchModalTable) els.customerSearchModalTable.classList.add('hidden');
  if (els.customerSearchModalLoading) els.customerSearchModalLoading.classList.add('hidden');
  if (els.customerSearchModalEmpty) {
    els.customerSearchModalEmpty.textContent = message || '';
    els.customerSearchModalEmpty.classList.toggle('hidden', !message);
  }
}

function agendaCustomerFillAddress(address) {
  customerModalState.selectedAddress = address || null;
  customerModalState.creatingNewAddress = false;
  agendaCustomerSetValue(els.customerAddress, address?.logradouro || address?.endereco || '');
  agendaCustomerSetValue(els.customerNumber, address?.numero || '');
  agendaCustomerSetValue(els.customerCep, agendaCustomerFormatCep(address?.cep || ''));
  agendaCustomerSetValue(els.customerBairro, address?.bairro || '');
  agendaCustomerSetValue(els.customerCidade, address?.cidade || '');
  agendaCustomerSetValue(els.customerUf, address?.uf || '');
  agendaCustomerSetValue(els.customerComplemento, address?.complemento || '');
}

function agendaCustomerApplyCepResult(data) {
  if (!data) return;
  agendaCustomerSetValue(els.customerCep, agendaCustomerFormatCep(data.cep || ''));
  agendaCustomerSetValue(els.customerAddress, data.logradouro || '');
  agendaCustomerSetValue(els.customerBairro, data.bairro || '');
  agendaCustomerSetValue(els.customerCidade, data.cidade || data.localidade || data.city || '');
  agendaCustomerSetValue(els.customerUf, String(data.uf || '').toUpperCase());
  if (data.complemento) {
    agendaCustomerSetValue(els.customerComplemento, data.complemento || '');
  }
}

async function agendaCustomerLookupCep({ force = false } = {}) {
  if (!els.customerCep) return null;
  const digits = agendaCustomerDigits(els.customerCep.value).slice(0, 8);
  els.customerCep.value = agendaCustomerFormatCep(digits);
  if (digits.length !== 8) return null;

  if (agendaCustomerCepLastDigits === digits && agendaCustomerCepLastResult) {
    agendaCustomerApplyCepResult(agendaCustomerCepLastResult);
    if (!force) return agendaCustomerCepLastResult;
  }

  if (agendaCustomerCepLookupController) {
    agendaCustomerCepLookupController.abort();
  }

  const controller = new AbortController();
  agendaCustomerCepLookupController = controller;

  try {
    const response = await api(`/shipping/cep?cep=${encodeURIComponent(digits)}`, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(await agendaCustomerReadErr(response, 'Nao foi possivel consultar o CEP informado.'));
    }
    const data = await response.json();
    agendaCustomerCepLastDigits = digits;
    agendaCustomerCepLastResult = {
      cep: digits,
      logradouro: data.logradouro || '',
      bairro: data.bairro || '',
      cidade: data.cidade || data.localidade || data.city || '',
      uf: (data.uf || '').toUpperCase(),
      complemento: data.complemento || '',
    };
    agendaCustomerApplyCepResult(agendaCustomerCepLastResult);
    return agendaCustomerCepLastResult;
  } catch (error) {
    if (error?.name === 'AbortError') return null;
    agendaCustomerCepLastDigits = '';
    agendaCustomerCepLastResult = null;
    notify(error?.message || 'Nao foi possivel consultar o CEP informado.', 'error');
    return null;
  } finally {
    if (agendaCustomerCepLookupController === controller) {
      agendaCustomerCepLookupController = null;
    }
  }
}

function agendaCustomerStartNewAddress() {
  if (!customerModalState.clienteId) {
    notify('Selecione um cliente antes de adicionar um novo endereco.', 'warning');
    return;
  }
  customerModalState.selectedAddress = null;
  customerModalState.creatingNewAddress = true;
  agendaCustomerSetValue(els.customerAddress, '');
  agendaCustomerSetValue(els.customerNumber, '');
  agendaCustomerSetValue(els.customerCep, '');
  agendaCustomerSetValue(els.customerBairro, '');
  agendaCustomerSetValue(els.customerCidade, '');
  agendaCustomerSetValue(els.customerUf, '');
  agendaCustomerSetValue(els.customerComplemento, '');
  agendaCustomerRenderAddressCards(customerModalState.addresses);
  els.customerAddress?.focus();
}

function agendaCustomerRenderAddressCards(addresses) {
  if (!els.customerAddressCards || !els.customerAddressCardsStatus) return;
  const list = Array.isArray(addresses) ? addresses : [];
  els.customerAddressCardsStatus.textContent = list.length ? `${list.length} endereço(s)` : '';
  const cards = list.map((address) => {
    const selected = agendaCustomerNormalizeId(address?._id) === agendaCustomerNormalizeId(customerModalState.selectedAddress?._id);
    const line1 = [address?.logradouro, address?.numero].filter(Boolean).join(', ');
    const line2 = [address?.bairro, [address?.cidade, address?.uf].filter(Boolean).join(' - '), address?.cep].filter(Boolean).join(' | ');
    return `
      <button type="button" data-agenda-customer-address="${escapeHtml(address?._id || '')}"
        class="w-full rounded-lg border p-3 text-left transition ${selected ? 'border-primary bg-primary/5 text-primary' : 'border-gray-200 bg-white text-gray-700 hover:border-primary hover:bg-primary/5'}">
        <div class="flex items-center justify-between gap-2">
          <span class="font-semibold">${escapeHtml(address?.apelido || 'Endereço')}</span>
          ${address?.isDefault ? '<span class="rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">Padrão</span>' : ''}
        </div>
        <div class="mt-1 text-xs">${escapeHtml(line1 || '-')}</div>
        <div class="text-xs">${escapeHtml(line2 || '-')}</div>
      </button>
    `;
  });
  if (customerModalState.clienteId && els.customerSaveToggle?.checked) {
    cards.push(`
      <button type="button" data-agenda-customer-address-new="true"
        class="min-h-[110px] rounded-lg border border-dashed bg-white p-3 text-center transition flex flex-col items-center justify-center gap-1 ${customerModalState.creatingNewAddress ? 'border-primary text-primary ring-1 ring-primary/30' : 'border-gray-300 text-gray-400 hover:border-primary hover:text-primary'}">
        <span class="text-2xl font-semibold leading-none">+</span>
        <span class="text-[11px] font-semibold">Novo endereco</span>
      </button>
    `);
  }
  if (!cards.length) {
    els.customerAddressCards.innerHTML = '<div class="rounded-lg border border-dashed border-gray-300 bg-white px-4 py-3 text-sm text-gray-500">Nenhum endereço cadastrado.</div>';
    return;
  }
  els.customerAddressCards.innerHTML = cards.join('');
}

function agendaCustomerRenderPets() {
  if (!els.customerPets || !els.customerPetsEmpty || !els.customerPetsLoading) return;
  els.customerPetsLoading.classList.add('hidden');
  els.customerPets.innerHTML = '';
  if (!customerModalState.clienteId) {
    els.customerPetsEmpty.textContent = 'Selecione um cliente para visualizar os pets.';
    els.customerPetsEmpty.classList.remove('hidden');
    return;
  }
  if (!Array.isArray(customerModalState.pets) || !customerModalState.pets.length) {
    els.customerPetsEmpty.textContent = 'Nenhum pet cadastrado para este cliente.';
    els.customerPetsEmpty.classList.remove('hidden');
  } else {
    els.customerPetsEmpty.classList.add('hidden');
  }
  const cards = (Array.isArray(customerModalState.pets) ? customerModalState.pets : []).map((pet) => {
    const petId = agendaCustomerNormalizeId(pet?._id);
    const selected = petId && petId === customerModalState.petId;
    const details = [pet?.tipo, pet?.raca, pet?.sexo].filter(Boolean).join(' • ');
    return `
      <button type="button" data-agenda-customer-pet="${escapeHtml(petId)}"
        class="w-full rounded-lg border px-4 py-3 text-left transition flex flex-col gap-1 ${selected ? 'border-primary bg-primary/5 text-primary' : 'border-gray-200 bg-white text-gray-700 hover:border-primary hover:bg-primary/5'}">
        <span class="text-sm font-semibold">${escapeHtml(pet?.nome || 'Pet sem nome')}</span>
        <span class="text-xs">${escapeHtml(details || 'Detalhes nao informados')}</span>
      </button>
    `;
  });
  if (customerModalState.clienteId && els.customerSaveToggle?.checked) {
    cards.push(`
      <button type="button" data-agenda-customer-pet-new="true"
        class="min-h-[92px] rounded-lg border border-dashed bg-white p-3 text-center transition flex flex-col items-center justify-center gap-1 ${customerModalState.creatingNewPet ? 'border-primary text-primary ring-1 ring-primary/30' : 'border-gray-300 text-gray-400 hover:border-primary hover:text-primary'}">
        <span class="text-2xl leading-none">+</span>
        <span class="text-[11px] font-semibold">Novo pet</span>
      </button>
    `);
  }
  els.customerPets.innerHTML = cards.join('');
}

function agendaCustomerFillPet(pet) {
  customerModalState.selectedPet = pet || null;
  customerModalState.petId = agendaCustomerNormalizeId(pet?._id);
  customerModalState.creatingNewPet = false;
  agendaCustomerSetValue(els.customerPetCode, pet?.codigo || pet?.codigoPet || '');
  agendaCustomerSetValue(els.customerPetName, pet?.nome || '');
  agendaCustomerSetValue(els.customerPetTipo, pet?.tipo || '');
  agendaCustomerSetValue(els.customerPetSexo, normalizeAgendaCustomerPetSexo(pet?.sexo || ''));
  agendaCustomerSetValue(els.customerPetPorte, pet?.porte || '');
  agendaCustomerSetValue(els.customerPetRaca, pet?.raca || '');
  agendaCustomerSetValue(els.customerPetBirth, pet?.dataNascimento ? toDateInputValueFromISO(pet.dataNascimento) : (pet?.nascimento || ''));
  agendaCustomerSetValue(els.customerPetCor, pet?.pelagemCor || pet?.pelagem || pet?.cor || '');
  agendaCustomerSetValue(els.customerPetCodAnt, pet?.codAntigoPet || pet?.codigoAntigoPet || '');
  agendaCustomerSetValue(els.customerPetMicrochip, pet?.microchip || '');
  agendaCustomerSetValue(els.customerPetRga, pet?.rga || '');
  agendaCustomerSetValue(els.customerPetPeso, pet?.peso || '');
  agendaCustomerSetChecked(els.customerPetCastrado, pet?.castrado);
  agendaCustomerSetChecked(els.customerPetObito, pet?.obito);
  agendaCustomerRenderPets();
  void syncAgendaCustomerPetBreedTypePorte('raca');
}

function agendaCustomerClearPet() {
  customerModalState.selectedPet = null;
  customerModalState.petId = '';
  customerModalState.creatingNewPet = false;
  agendaCustomerSetValue(els.customerPetCode, '');
  agendaCustomerSetValue(els.customerPetName, '');
  agendaCustomerSetValue(els.customerPetTipo, '');
  agendaCustomerSetValue(els.customerPetSexo, '');
  agendaCustomerSetValue(els.customerPetPorte, '');
  agendaCustomerSetValue(els.customerPetRaca, '');
  agendaCustomerSetValue(els.customerPetBirth, '');
  agendaCustomerSetValue(els.customerPetCor, '');
  agendaCustomerSetValue(els.customerPetCodAnt, '');
  agendaCustomerSetValue(els.customerPetMicrochip, '');
  agendaCustomerSetValue(els.customerPetRga, '');
  agendaCustomerSetValue(els.customerPetPeso, '');
  agendaCustomerSetChecked(els.customerPetCastrado, false);
  agendaCustomerSetChecked(els.customerPetObito, false);
  agendaCustomerRenderPets();
}

function agendaCustomerStartNewPet() {
  if (!customerModalState.clienteId) {
    notify('Selecione um cliente antes de adicionar um novo pet.', 'warning');
    return;
  }
  agendaCustomerClearPet();
  customerModalState.creatingNewPet = true;
  els.customerPetName?.focus();
}

function normalizeAgendaCustomerPetText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function normalizeAgendaCustomerPetPorte(value) {
  const normalized = normalizeAgendaCustomerPetText(value);
  if (!normalized) return '';
  if (normalized === 'medio') return 'medio';
  return ['mini', 'pequeno', 'grande', 'gigante'].includes(normalized) ? normalized : normalized;
}

function normalizeAgendaCustomerPetSexo(value) {
  const normalized = normalizeAgendaCustomerPetText(value);
  if (!normalized) return '';
  if (normalized === 'm' || normalized === 'macho' || normalized === 'male') return 'M';
  if (normalized === 'f' || normalized === 'femea' || normalized === 'female') return 'F';
  return String(value || '').trim();
}

async function loadAgendaCustomerPetSpeciesMap() {
  if (agendaCustomerPetSpeciesMap) return agendaCustomerPetSpeciesMap;
  if (agendaCustomerPetSpeciesMapPromise) return agendaCustomerPetSpeciesMapPromise;

  const buildMap = (payload) => {
    const species = {};
    const dogMap = payload?.cachorro?.portes || {};
    const sourceMap = payload?.cachorro?.mapeamento || {};
    const dogLookup = {};
    const dogAll = Array.from(
      new Set([
        ...(Array.isArray(dogMap?.mini) ? dogMap.mini : []),
        ...(Array.isArray(dogMap?.pequeno) ? dogMap.pequeno : []),
        ...(Array.isArray(dogMap?.medio) ? dogMap.medio : []),
        ...(Array.isArray(dogMap?.grande) ? dogMap.grande : []),
        ...(Array.isArray(dogMap?.gigante) ? dogMap.gigante : []),
      ])
    );

    dogAll.forEach((breed) => {
      const key = normalizeAgendaCustomerPetText(breed);
      const porte =
        sourceMap[key] ||
        sourceMap[breed] ||
        (Array.isArray(dogMap?.mini) && dogMap.mini.includes(breed)
          ? 'mini'
          : Array.isArray(dogMap?.pequeno) && dogMap.pequeno.includes(breed)
          ? 'pequeno'
          : Array.isArray(dogMap?.medio) && dogMap.medio.includes(breed)
          ? 'medio'
          : Array.isArray(dogMap?.grande) && dogMap.grande.includes(breed)
          ? 'grande'
          : 'gigante');
      dogLookup[key] = normalizeAgendaCustomerPetPorte(porte);
    });

    species.cachorro = { all: dogAll, map: dogLookup };
    ['gato', 'passaro', 'peixe', 'roedor', 'lagarto', 'tartaruga'].forEach((tipo) => {
      species[tipo] = Array.from(new Set(Array.isArray(payload?.[tipo]) ? payload[tipo] : []));
    });
    return species;
  };

  agendaCustomerPetSpeciesMapPromise = (async () => {
    try {
      const response = await fetch('/data/racas.json', { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      agendaCustomerPetSpeciesMap = buildMap(await response.json());
      return agendaCustomerPetSpeciesMap;
    } catch (error) {
      console.warn('Nao foi possivel carregar data/racas.json para o modal da agenda.', error);
      agendaCustomerPetSpeciesMap = null;
      return null;
    } finally {
      agendaCustomerPetSpeciesMapPromise = null;
    }
  })();

  return agendaCustomerPetSpeciesMapPromise;
}

function inferAgendaCustomerPetTypeFromBreed(breedValue) {
  const speciesMap = agendaCustomerPetSpeciesMap;
  const breedKey = normalizeAgendaCustomerPetText(breedValue);
  if (!speciesMap || !breedKey) return '';
  if ((speciesMap?.cachorro?.all || []).some((item) => normalizeAgendaCustomerPetText(item) === breedKey)) return 'cachorro';
  for (const tipo of ['gato', 'passaro', 'peixe', 'roedor', 'lagarto', 'tartaruga']) {
    if ((speciesMap?.[tipo] || []).some((item) => normalizeAgendaCustomerPetText(item) === breedKey)) return tipo;
  }
  return '';
}

function setAgendaCustomerPetPorteFromBreedIfDog() {
  if (!els.customerPetTipo || !els.customerPetRaca || !els.customerPetPorte) return;
  if (normalizeAgendaCustomerPetText(els.customerPetTipo.value) !== 'cachorro') return;
  const lookup = agendaCustomerPetSpeciesMap?.cachorro?.map || null;
  if (!lookup) return;
  const porte = lookup[normalizeAgendaCustomerPetText(els.customerPetRaca.value)] || '';
  if (!porte) return;
  els.customerPetPorte.value = normalizeAgendaCustomerPetPorte(porte);
}

async function syncAgendaCustomerPetBreedTypePorte(source = '') {
  await loadAgendaCustomerPetSpeciesMap().catch(() => {});
  const tipoInput = els.customerPetTipo;
  const racaInput = els.customerPetRaca;
  if (!tipoInput || !racaInput) return;
  const breed = String(racaInput.value || '').trim();
  if (breed) {
    const inferredType = inferAgendaCustomerPetTypeFromBreed(breed);
    if (inferredType && normalizeAgendaCustomerPetText(tipoInput.value) !== inferredType) {
      tipoInput.value = inferredType;
    }
  }
  if (source !== 'tipo') {
    setAgendaCustomerPetPorteFromBreedIfDog();
  }
}

function closeAgendaCustomerPetBreedSuggestions() {
  if (!els.customerPetRacaSuggest) return;
  els.customerPetRacaSuggest.classList.add('hidden');
  els.customerPetRacaSuggest.innerHTML = '';
  agendaCustomerPetBreedFilteredOptions = [];
  agendaCustomerPetBreedActiveIndex = -1;
}

async function refreshAgendaCustomerPetBreedOptions() {
  await loadAgendaCustomerPetSpeciesMap().catch(() => {});
  const speciesMap = agendaCustomerPetSpeciesMap;
  if (!speciesMap) {
    agendaCustomerPetBreedOptions = [];
    closeAgendaCustomerPetBreedSuggestions();
    return;
  }
  const tipo = normalizeAgendaCustomerPetText(els.customerPetTipo?.value || '');
  let breeds = [];
  if (tipo === 'cachorro') breeds = (speciesMap?.cachorro?.all || []).slice();
  else if (tipo && Array.isArray(speciesMap?.[tipo])) breeds = (speciesMap?.[tipo] || []).slice();
  else {
    breeds = Array.from(
      new Set([
        ...(speciesMap?.cachorro?.all || []),
        ...(speciesMap?.gato || []),
        ...(speciesMap?.passaro || []),
        ...(speciesMap?.peixe || []),
        ...(speciesMap?.roedor || []),
        ...(speciesMap?.lagarto || []),
        ...(speciesMap?.tartaruga || []),
      ])
    );
  }
  agendaCustomerPetBreedOptions = breeds.sort((a, b) => String(a).localeCompare(String(b), 'pt-BR'));
}

async function renderAgendaCustomerPetBreedSuggestions() {
  const input = els.customerPetRaca;
  const container = els.customerPetRacaSuggest;
  if (!input || !container) return;
  await refreshAgendaCustomerPetBreedOptions();
  const term = normalizeAgendaCustomerPetText(input.value);
  agendaCustomerPetBreedFilteredOptions = (agendaCustomerPetBreedOptions || [])
    .filter((item) => !term || normalizeAgendaCustomerPetText(item).includes(term))
    .slice(0, 80);
  if (!agendaCustomerPetBreedFilteredOptions.length) {
    closeAgendaCustomerPetBreedSuggestions();
    return;
  }
  const normalizedValue = normalizeAgendaCustomerPetText(input.value);
  const exactIndex = agendaCustomerPetBreedFilteredOptions.findIndex(
    (item) => normalizeAgendaCustomerPetText(item) === normalizedValue
  );
  if (exactIndex >= 0) agendaCustomerPetBreedActiveIndex = exactIndex;
  else if (agendaCustomerPetBreedActiveIndex >= agendaCustomerPetBreedFilteredOptions.length) agendaCustomerPetBreedActiveIndex = 0;
  else if (agendaCustomerPetBreedActiveIndex < 0) agendaCustomerPetBreedActiveIndex = 0;
  container.innerHTML = agendaCustomerPetBreedFilteredOptions
    .map(
      (breed, index) =>
        `<button type="button" class="block w-full border-b border-gray-100 px-3 py-2 text-left text-[12px] ${index === agendaCustomerPetBreedActiveIndex ? 'bg-primary/10 text-primary' : 'text-gray-700 hover:bg-primary/5'} last:border-b-0" data-agenda-customer-pet-breed-option="${escapeHtml(String(breed))}" data-agenda-customer-pet-breed-index="${index}">${escapeHtml(String(breed))}</button>`
    )
    .join('');
  container.classList.remove('hidden');
  const activeButton = container.querySelector(`[data-agenda-customer-pet-breed-index="${agendaCustomerPetBreedActiveIndex}"]`);
  if (activeButton && typeof activeButton.scrollIntoView === 'function') {
    activeButton.scrollIntoView({ block: 'nearest' });
  }
}

function selectAgendaCustomerPetBreedOption(value) {
  if (!els.customerPetRaca) return;
  els.customerPetRaca.value = String(value || '');
  closeAgendaCustomerPetBreedSuggestions();
  void syncAgendaCustomerPetBreedTypePorte('raca');
}

function agendaCustomerFillForm(customer) {
  customerModalState.selectedCliente = customer || null;
  customerModalState.clienteId = agendaCustomerNormalizeId(customer?._id);
  agendaCustomerSetValue(els.customerCode, customer?.codigo || '');
  agendaCustomerSetValue(els.customerName, agendaCustomerName(customer));
  agendaCustomerSetValue(els.customerDoc, agendaCustomerDoc(customer));
  agendaCustomerSetValue(els.customerSexo, agendaCustomerGender(customer));
  agendaCustomerSetValue(els.customerBirth, agendaCustomerBirth(customer));
  agendaCustomerSetValue(els.customerEmail, customer?.email || '');
  agendaCustomerSetValue(els.customerObservacao, customer?.observacao || '');
  const [phone1Value = '', phone2Value = ''] = agendaCustomerCollectCustomerPhones(customer);
  const primaryPhone = agendaCustomerSplitPhone(phone1Value);
  const secondaryPhone = agendaCustomerSplitPhone(phone2Value);
  agendaCustomerSetValue(els.customerPhone1Ddd, primaryPhone.ddd);
  agendaCustomerSetValue(els.customerPhone1, primaryPhone.number);
  agendaCustomerSetValue(els.customerPhone2Ddd, secondaryPhone.ddd);
  agendaCustomerSetValue(els.customerPhone2, secondaryPhone.number);
}

function agendaCustomerClearContext(options = {}) {
  const { keepSearch = false } = options;
  customerModalState.clienteId = '';
  customerModalState.petId = '';
  customerModalState.selectedCliente = null;
  customerModalState.selectedPet = null;
  customerModalState.selectedAddress = null;
  customerModalState.creatingNewAddress = false;
  customerModalState.creatingNewPet = false;
  customerModalState.addresses = [];
  customerModalState.pets = [];
  customerModalState.lastDocLookup = '';
  customerModalState.lastPhoneLookup = '';
  agendaCustomerRenderAddressCards([]);
  agendaCustomerSetValue(els.customerCode, '');
  if (!keepSearch) agendaCustomerSetValue(els.customerName, '');
  agendaCustomerSetValue(els.customerDoc, '');
  agendaCustomerSetValue(els.customerSexo, '');
  agendaCustomerSetValue(els.customerBirth, '');
  agendaCustomerSetValue(els.customerEmail, '');
  agendaCustomerSetValue(els.customerAddress, '');
  agendaCustomerSetValue(els.customerNumber, '');
  agendaCustomerSetValue(els.customerCep, '');
  agendaCustomerSetValue(els.customerBairro, '');
  agendaCustomerSetValue(els.customerCidade, '');
  agendaCustomerSetValue(els.customerUf, '');
  agendaCustomerSetValue(els.customerObservacao, '');
  agendaCustomerSetValue(els.customerComplemento, '');
  agendaCustomerSetValue(els.customerPhone1Ddd, '21');
  agendaCustomerSetValue(els.customerPhone1, '');
  agendaCustomerSetValue(els.customerPhone2Ddd, '21');
  agendaCustomerSetValue(els.customerPhone2, '');
  agendaCustomerCepLastDigits = '';
  agendaCustomerCepLastResult = null;
  agendaCustomerClearPet();
  agendaCustomerRenderPets();
}

function agendaCustomerSetTab(tab) {
  state.customerModalTab = tab === 'pet' ? 'pet' : 'cliente';
  const isPet = state.customerModalTab === 'pet';
  els.customerTabCliente?.classList.toggle('hidden', isPet);
  els.customerTabPet?.classList.toggle('hidden', !isPet);
  els.customerTabBtnCliente?.classList.toggle('bg-primary', !isPet);
  els.customerTabBtnCliente?.classList.toggle('text-white', !isPet);
  els.customerTabBtnCliente?.classList.toggle('text-gray-500', isPet);
  els.customerTabBtnPet?.classList.toggle('bg-primary', isPet);
  els.customerTabBtnPet?.classList.toggle('text-white', isPet);
  els.customerTabBtnPet?.classList.toggle('text-gray-500', !isPet);
}

async function agendaCustomerLoad(customerId, options = {}) {
  const normalizedId = agendaCustomerNormalizeId(customerId);
  if (!normalizedId) {
    agendaCustomerClearContext();
    agendaCustomerResetSearch();
    return;
  }
  const { preservePetSelection = true } = options;
  const currentPetId = preservePetSelection ? customerModalState.petId : '';
  if (els.customerPetsLoading) els.customerPetsLoading.classList.remove('hidden');
  if (els.customerPetsEmpty) els.customerPetsEmpty.classList.add('hidden');
  const [customerResp, addressResp, petsResp] = await Promise.all([
    api(`/func/clientes/${normalizedId}`),
    api(`/func/clientes/${normalizedId}/enderecos`).catch(() => null),
    api(`/func/clientes/${normalizedId}/pets`).catch(() => null),
  ]);
  if (!customerResp.ok) throw new Error(await agendaCustomerReadErr(customerResp, 'Nao foi possivel carregar o cliente.'));
  const customer = await customerResp.json();
  const addresses = addressResp?.ok ? await addressResp.json().catch(() => []) : [];
  const pets = petsResp?.ok ? await petsResp.json().catch(() => []) : [];
  agendaCustomerFillForm(customer);
  customerModalState.addresses = Array.isArray(addresses) ? addresses : [];
  const defaultAddress = Array.isArray(addresses) ? addresses.find((entry) => entry?.isDefault) || addresses[0] || null : null;
  agendaCustomerFillAddress(defaultAddress);
  agendaCustomerRenderAddressCards(customerModalState.addresses);
  customerModalState.pets = Array.isArray(pets) ? pets : [];
  const matchedPet =
    customerModalState.pets.find((pet) => agendaCustomerNormalizeId(pet?._id) === agendaCustomerNormalizeId(currentPetId)) ||
    customerModalState.pets[0] ||
    null;
  if (matchedPet) agendaCustomerFillPet(matchedPet);
  else agendaCustomerClearPet();
  if (els.customerPetsLoading) els.customerPetsLoading.classList.add('hidden');
}

async function agendaCustomerSearch(term) {
  const query = String(term || '').trim();
  if (query.length < 2) {
    agendaCustomerResetSearch();
    return;
  }
  if (customerModalState.searchAbort) {
    customerModalState.searchAbort.abort();
    customerModalState.searchAbort = null;
  }
  if (els.customerSearchModalLoading) els.customerSearchModalLoading.classList.remove('hidden');
  if (els.customerSearchModalEmpty) els.customerSearchModalEmpty.classList.add('hidden');
  if (els.customerSearchModalTable) els.customerSearchModalTable.classList.add('hidden');
  const controller = new AbortController();
  customerModalState.searchAbort = controller;
  try {
    const response = await api(`/func/clientes/buscar?q=${encodeURIComponent(query)}&limit=20`, { signal: controller.signal });
    if (!response.ok) throw new Error(await agendaCustomerReadErr(response, 'Nao foi possivel buscar clientes.'));
    const payload = await response.json().catch(() => []);
    const list = Array.isArray(payload) ? payload : [];
    customerModalState.searchResults = list;
    if (!list.length) {
      agendaCustomerResetSearch('Nenhum cliente encontrado.');
      return;
    }
    if (els.customerSearchModalResults) {
      els.customerSearchModalResults.innerHTML = list.map((customer, index) => `
        <tr data-agenda-customer-search-result="${index}" class="cursor-pointer hover:bg-primary/5">
          <td class="px-3 py-2 font-semibold text-gray-700">${escapeHtml(customer?.codigo || '-')}</td>
          <td class="px-3 py-2 text-gray-700">${escapeHtml(agendaCustomerName(customer) || 'Cliente sem nome')}</td>
          <td class="px-3 py-2 text-gray-700">${escapeHtml(agendaCustomerDoc(customer) || '-')}</td>
          <td class="px-3 py-2 text-gray-600">${escapeHtml(customer?.celular || customer?.celular2 || customer?.celularSecundario || '-')}</td>
          <td class="px-3 py-2 text-gray-600">${escapeHtml(customer?.telefone || customer?.telefone2 || customer?.telefoneSecundario || '-')}</td>
        </tr>
      `).join('');
    }
    if (els.customerSearchModalLoading) els.customerSearchModalLoading.classList.add('hidden');
    if (els.customerSearchModalEmpty) els.customerSearchModalEmpty.classList.add('hidden');
    if (els.customerSearchModalTable) els.customerSearchModalTable.classList.remove('hidden');
  } catch (error) {
    if (error?.name === 'AbortError') return;
    agendaCustomerResetSearch(error?.message || 'Nao foi possivel buscar clientes.');
  } finally {
    if (customerModalState.searchAbort === controller) customerModalState.searchAbort = null;
    if (els.customerSearchModalLoading) els.customerSearchModalLoading.classList.add('hidden');
  }
}

function agendaCustomerScheduleSearch(term) {
  if (customerModalSearchTimer) clearTimeout(customerModalSearchTimer);
  customerModalSearchTimer = setTimeout(() => {
    customerModalSearchTimer = null;
    void agendaCustomerSearch(term);
  }, 220);
}

function agendaCustomerSearchHasLetters(value) {
  return /[A-Za-zÀ-ÖØ-öø-ÿ]/.test(String(value || ''));
}

function agendaCustomerOpenSearchModal(initialTerm = '') {
  if (!els.customerSearchModal) return;
  customerSearchPreviousFocus =
    document.activeElement instanceof HTMLElement ? document.activeElement : null;
  els.customerSearchModal.classList.remove('hidden');
  const term = String(initialTerm || '').trim();
  agendaCustomerSetValue(els.customerSearchModalInput, term);
  if (term.length >= 2) {
    agendaCustomerScheduleSearch(term);
  } else {
    agendaCustomerResetSearch();
  }
  window.setTimeout(() => {
    els.customerSearchModalInput?.focus();
    if (typeof els.customerSearchModalInput?.select === 'function') {
      els.customerSearchModalInput.select();
    }
  }, 80);
}

function agendaCustomerCloseSearchModal({ restoreFocus = true } = {}) {
  if (!els.customerSearchModal) return;
  els.customerSearchModal.classList.add('hidden');
  if (customerModalState.searchAbort) {
    customerModalState.searchAbort.abort();
    customerModalState.searchAbort = null;
  }
  if (customerModalSearchTimer) {
    clearTimeout(customerModalSearchTimer);
    customerModalSearchTimer = null;
  }
  if (restoreFocus && customerSearchPreviousFocus && typeof customerSearchPreviousFocus.focus === 'function') {
    try { customerSearchPreviousFocus.focus(); } catch {}
  }
  customerSearchPreviousFocus = null;
}

function agendaCustomerHandleSearchModalKeydown(event) {
  if (event.key === 'Escape') {
    event.preventDefault();
    agendaCustomerCloseSearchModal();
    return;
  }
  if (event.key === 'Enter' && event.target === els.customerSearchModalInput) {
    event.preventDefault();
    agendaCustomerScheduleSearch(els.customerSearchModalInput?.value || '');
  }
}

async function agendaCustomerSelectSearchResult(index) {
  const customer = Array.isArray(customerModalState.searchResults) ? customerModalState.searchResults[index] : null;
  if (!customer?._id) return;
  await agendaCustomerLoad(customer._id, { preservePetSelection: false });
  agendaCustomerCloseSearchModal({ restoreFocus: false });
  window.setTimeout(() => {
    els.customerCode?.focus();
  }, 40);
}

function agendaCustomerNormalizePhone(value) {
  const digits = agendaCustomerDigits(value);
  if (!digits) return '';
  if (digits.length > 11 && digits.startsWith('55')) return digits.slice(2);
  return digits;
}

function agendaCustomerBuildPhoneVariants(value) {
  const normalized = agendaCustomerNormalizePhone(value);
  const variants = new Set();
  if (!normalized) return variants;
  variants.add(normalized);
  if (normalized.length >= 11) variants.add(normalized.slice(-11));
  if (normalized.length >= 10) variants.add(normalized.slice(-10));
  if (normalized.length >= 9) variants.add(normalized.slice(-9));
  if (normalized.length >= 8) variants.add(normalized.slice(-8));
  if (normalized.length === 11 && normalized[2] === '9') {
    variants.add(`${normalized.slice(0, 2)}${normalized.slice(3)}`);
    variants.add(normalized.slice(3));
  }
  return variants;
}

function agendaCustomerPhoneCandidates(customer) {
  if (!customer || typeof customer !== 'object') return [];
  const candidates = [];
  const add = (value) => {
    const digits = agendaCustomerNormalizePhone(value);
    if (!digits) return;
    if (!candidates.includes(digits)) candidates.push(digits);
  };
  add(customer.telefone);
  add(customer.celular);
  add(customer.celular2);
  add(customer.celular_2);
  add(customer.celularSecundario);
  add(customer.telefone2);
  add(customer.telefoneSecundario);
  add(customer.telefoneFixo);
  add(customer.telefone_fixo);
  add(customer.fone);
  add(customer.fone2);
  add(customer.whatsapp);
  add(customer.telefone1);
  if (customer.contato && typeof customer.contato === 'object') {
    add(customer.contato.telefone);
    add(customer.contato.telefone2);
    add(customer.contato.telefone_2);
    add(customer.contato.celular);
    add(customer.contato.celular2);
    add(customer.contato.celular_2);
    add(customer.contato.whatsapp);
  }
  if (Array.isArray(customer.telefones)) {
    customer.telefones.forEach((entry) => {
      if (!entry) return;
      if (typeof entry === 'string') {
        add(entry);
        return;
      }
      if (typeof entry === 'object') {
        add(entry.telefone || entry.celular || entry.whatsapp || entry.numero || entry.number);
      }
    });
  }
  return candidates;
}

function agendaCustomerListHasPhoneMatch(list, targetDigits) {
  const targetVariants = agendaCustomerBuildPhoneVariants(targetDigits);
  if (!Array.isArray(list) || !list.length || !targetVariants.size) return null;
  return list.find((entry) => {
    const phones = agendaCustomerPhoneCandidates(entry);
    return phones.some((candidate) => {
      const candidateVariants = agendaCustomerBuildPhoneVariants(candidate);
      for (const cv of candidateVariants) {
        if (targetVariants.has(cv)) return true;
        for (const tv of targetVariants) {
          if (cv.endsWith(tv) || tv.endsWith(cv)) return true;
        }
      }
      return false;
    });
  }) || null;
}

function agendaCustomerFormatLocalPhoneDigits(value) {
  const digits = agendaCustomerDigits(value);
  if (digits.length === 8) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  if (digits.length === 9) return `${digits.slice(0, 5)}-${digits.slice(5)}`;
  return digits;
}

function agendaCustomerBuildPhoneSearchQueries(targetDigits) {
  const targetNormalized = agendaCustomerNormalizePhone(targetDigits);
  const local9 = targetNormalized.slice(-9);
  const local8 = targetNormalized.slice(-8);
  const dddValue = targetNormalized.length >= 10 ? targetNormalized.slice(0, 2) : '';
  const localValue = dddValue ? targetNormalized.slice(2) : targetNormalized;
  const localFormatted = agendaCustomerFormatLocalPhoneDigits(localValue);
  const formattedQueries = (() => {
    const variants = new Set();
    if (localValue) {
      variants.add(localValue);
      variants.add(localFormatted);
    }
    if (dddValue && localValue) {
      variants.add(`${dddValue}${localValue}`);
      variants.add(`${dddValue} ${localValue}`);
      variants.add(`${dddValue}-${localValue}`);
      variants.add(`(${dddValue})${localValue}`);
      variants.add(`(${dddValue}) ${localValue}`);
      variants.add(`(${dddValue}) ${localFormatted}`);
      variants.add(`${dddValue} ${localFormatted}`);
    }
    return Array.from(variants).filter(Boolean);
  })();
  return Array.from(
    new Set(
      [targetDigits, targetNormalized, local9, local8, ...formattedQueries].filter(
        (value) => value && String(value).trim().length >= 8
      )
    )
  );
}

async function agendaCustomerLookupByCode(rawValue) {
  if (agendaCustomerSearchHasLetters(rawValue)) {
    agendaCustomerOpenSearchModal(rawValue);
    return false;
  }
  const code = agendaCustomerDigits(rawValue);
  if (!code) {
    agendaCustomerClearContext();
    agendaCustomerResetSearch();
    return false;
  }
  const response = await api(`/func/clientes/buscar?q=${encodeURIComponent(code)}&limit=10`);
  if (!response.ok) {
    agendaCustomerClearContext();
    agendaCustomerResetSearch();
    return false;
  }
  const payload = await response.json().catch(() => []);
  const list = Array.isArray(payload) ? payload : [];
  const exact = list.find((customer) => {
    const itemCode = agendaCustomerDigits(customer?.codigo || '');
    return itemCode && Number.parseInt(itemCode, 10) === Number.parseInt(code, 10);
  });
  if (!exact?._id) {
    agendaCustomerClearContext({ keepSearch: true });
    agendaCustomerSetValue(els.customerCode, rawValue);
    agendaCustomerResetSearch();
    return false;
  }
  await agendaCustomerLoad(exact._id, { preservePetSelection: false });
  agendaCustomerResetSearch();
  return true;
}

async function agendaCustomerLookupByDocument(rawValue) {
  const docDigits = agendaCustomerDigits(rawValue);
  if (docDigits.length !== 11 && docDigits.length !== 14) {
    customerModalState.lastDocLookup = '';
    return false;
  }
  if (customerModalState.lastDocLookup === docDigits) return false;
  customerModalState.lastDocLookup = docDigits;
  try {
    const response = await api(`/func/clientes/buscar?q=${encodeURIComponent(docDigits)}&limit=12`);
    if (!response.ok) return false;
    const payload = await response.json().catch(() => []);
    const list = Array.isArray(payload) ? payload : [];
    const exact = list.find((customer) => {
      const cpf = agendaCustomerDigits(customer?.cpf || '');
      const cnpj = agendaCustomerDigits(customer?.cnpj || '');
      return cpf === docDigits || cnpj === docDigits;
    });
    if (!exact?._id) {
      customerModalState.lastDocLookup = '';
      return false;
    }
    await agendaCustomerLoad(exact._id, { preservePetSelection: false });
    return true;
  } catch {
    customerModalState.lastDocLookup = '';
    return false;
  }
}

async function agendaCustomerLookupByPhone() {
  const primaryPhone = agendaCustomerJoinPhone(els.customerPhone1Ddd?.value, els.customerPhone1?.value);
  const secondaryPhone = agendaCustomerJoinPhone(els.customerPhone2Ddd?.value, els.customerPhone2?.value);
  const phoneDigits = agendaCustomerNormalizePhone(primaryPhone || secondaryPhone);
  if (phoneDigits.length !== 10 && phoneDigits.length !== 11) {
    customerModalState.lastPhoneLookup = '';
    return false;
  }
  if (customerModalState.lastPhoneLookup === phoneDigits) return false;
  customerModalState.lastPhoneLookup = phoneDigits;
  try {
    const queries = agendaCustomerBuildPhoneSearchQueries(phoneDigits);
    let matched = null;

    for (const query of queries) {
      const response = await api(`/func/clientes/buscar?q=${encodeURIComponent(query)}&limit=12`);
      if (!response.ok) continue;
      const list = await response.json().catch(() => []);
      matched = agendaCustomerListHasPhoneMatch(list, phoneDigits) || (Array.isArray(list) && list.length === 1 ? list[0] : null);
      if (matched?._id) break;
    }

    if (!matched?._id) {
      for (const query of queries) {
        for (const page of [1, 2, 3]) {
          const response = await api(`/func/clientes?page=${page}&limit=50&search=${encodeURIComponent(query)}`);
          if (!response.ok) continue;
          const payload = await response.json().catch(() => ({}));
          const items = Array.isArray(payload?.items) ? payload.items : [];
          matched = agendaCustomerListHasPhoneMatch(items, phoneDigits);
          if (matched?._id) break;
          if (!items.length) break;
        }
        if (matched?._id) break;
      }
    }

    if (!matched?._id) {
      for (const query of queries) {
        const response = await api(`/func/clientes/buscar?q=${encodeURIComponent(query)}&limit=6`);
        if (!response.ok) continue;
        const list = await response.json().catch(() => []);
        if (!Array.isArray(list) || !list.length) continue;
        for (const item of list) {
          const id = agendaCustomerNormalizeId(item?._id);
          if (!id) continue;
          const detailResponse = await api(`/func/clientes/${id}`);
          if (!detailResponse.ok) continue;
          const detail = await detailResponse.json().catch(() => null);
          if (!detail) continue;
          if (agendaCustomerListHasPhoneMatch([detail], phoneDigits)) {
            matched = detail;
            break;
          }
        }
        if (matched?._id) break;
      }
    }

    if (!matched?._id) {
      customerModalState.lastPhoneLookup = '';
      return false;
    }

    await agendaCustomerLoad(matched._id, { preservePetSelection: false });
    return true;
  } catch {
    customerModalState.lastPhoneLookup = '';
    return false;
  }
}

function agendaCustomerBuildPayload() {
  const nome = String(els.customerName?.value || '').trim();
  const docDigits = agendaCustomerDigits(els.customerDoc?.value || '');
  const phones = agendaCustomerCollectFormPhones();
  const payload = {
    email: String(els.customerEmail?.value || '').trim(),
    celular: phones.celular,
    celular2: phones.celular2,
    celularSecundario: phones.celular2,
    telefone: phones.telefone,
    telefone2: phones.telefone2,
    telefoneSecundario: phones.telefone2,
    sexo: String(els.customerSexo?.value || '').trim(),
    nascimento: String(els.customerBirth?.value || '').trim(),
    apelido: nome,
  };
  if (docDigits.length === 14) {
    payload.tipoConta = 'pessoa_juridica';
    payload.razaoSocial = nome;
    payload.cnpj = docDigits;
  } else {
    payload.tipoConta = 'pessoa_fisica';
    payload.nome = nome;
    if (docDigits.length === 11) payload.cpf = docDigits;
  }
  return payload;
}

function agendaCustomerBuildAddressPayload() {
  return {
    apelido: 'Principal',
    cep: String(els.customerCep?.value || '').trim(),
    logradouro: String(els.customerAddress?.value || '').trim(),
    numero: String(els.customerNumber?.value || '').trim(),
    complemento: String(els.customerComplemento?.value || '').trim(),
    bairro: String(els.customerBairro?.value || '').trim(),
    cidade: String(els.customerCidade?.value || '').trim(),
    uf: String(els.customerUf?.value || '').trim().toUpperCase(),
  };
}

function agendaCustomerBuildPetPayload() {
  return {
    nome: String(els.customerPetName?.value || '').trim(),
    tipo: String(els.customerPetTipo?.value || '').trim(),
    sexo: String(els.customerPetSexo?.value || '').trim(),
    porte: String(els.customerPetPorte?.value || '').trim(),
    raca: String(els.customerPetRaca?.value || '').trim(),
    nascimento: String(els.customerPetBirth?.value || '').trim(),
    peso: String(els.customerPetPeso?.value || '').trim(),
    cor: String(els.customerPetCor?.value || '').trim(),
    codAntigoPet: String(els.customerPetCodAnt?.value || '').trim(),
    microchip: String(els.customerPetMicrochip?.value || '').trim(),
    rga: String(els.customerPetRga?.value || '').trim(),
    castrado: !!els.customerPetCastrado?.checked,
    obito: !!els.customerPetObito?.checked,
  };
}

function agendaCustomerHasData() {
  return Boolean(
    String(els.customerName?.value || '').trim() ||
    String(els.customerDoc?.value || '').trim() ||
    String(els.customerPhone1?.value || '').trim() ||
    String(els.customerEmail?.value || '').trim()
  );
}

function agendaCustomerHasAddressData() {
  return Boolean(
    String(els.customerAddress?.value || '').trim() ||
    String(els.customerNumber?.value || '').trim() ||
    String(els.customerCep?.value || '').trim() ||
    String(els.customerBairro?.value || '').trim() ||
    String(els.customerCidade?.value || '').trim() ||
    String(els.customerComplemento?.value || '').trim()
  );
}

function agendaCustomerHasPetData() {
  return Boolean(
    String(els.customerPetName?.value || '').trim() ||
    String(els.customerPetTipo?.value || '').trim() ||
    String(els.customerPetSexo?.value || '').trim() ||
    String(els.customerPetRaca?.value || '').trim() ||
    String(els.customerPetBirth?.value || '').trim() ||
    String(els.customerPetPeso?.value || '').trim() ||
    !!els.customerPetCastrado?.checked ||
    !!els.customerPetObito?.checked
  );
}

function agendaCustomerSyncRequiredIndicators() {
  const active = !!els.customerSaveToggle?.checked;
  els.customerRequiredName?.classList.toggle('hidden', !active);
  els.customerRequiredDoc?.classList.toggle('hidden', !active);
  els.customerRequiredSexo?.classList.toggle('hidden', !active);
  els.customerRequiredCep?.classList.toggle('hidden', !active);
  els.customerRequiredPhone1?.classList.toggle('hidden', !active);
  agendaCustomerRenderAddressCards(customerModalState.addresses);
  agendaCustomerRenderPets();
}

async function agendaCustomerSave(options = {}) {
  const { silent = false } = options;
  const existingCustomerId = agendaCustomerNormalizeId(customerModalState.clienteId);
  const payload = agendaCustomerBuildPayload();
  const docDigits = agendaCustomerDigits(els.customerDoc?.value || '');
  const cepDigits = agendaCustomerDigits(els.customerCep?.value || '');
  const hasPrimaryPhone = Boolean(
    agendaCustomerDigits(agendaCustomerJoinPhone(els.customerPhone1Ddd?.value, els.customerPhone1?.value))
  );
  if (!String(payload.nome || payload.razaoSocial || '').trim()) throw new Error('Informe o nome do cliente.');
  if (docDigits.length !== 11 && docDigits.length !== 14) throw new Error('Informe um CPF/CNPJ válido.');
  if (!String(payload.sexo || '').trim()) throw new Error('Informe o sexo do cliente.');
  if (!hasPrimaryPhone) throw new Error('Informe o telefone principal do cliente.');
  if (cepDigits.length !== 8) throw new Error('Informe um CEP válido com 8 dígitos.');
  const path = existingCustomerId ? `/func/clientes/${existingCustomerId}` : '/func/clientes';
  const method = existingCustomerId ? 'PUT' : 'POST';
  const response = await api(path, { method, body: JSON.stringify(payload) });
  if (!response.ok) throw new Error(await agendaCustomerReadErr(response, 'Nao foi possivel salvar o cliente.'));
  const savedCustomer = await response.json().catch(() => ({}));
  const resolvedCustomerId = agendaCustomerNormalizeId(savedCustomer?._id || savedCustomer?.id || existingCustomerId);
  if (!resolvedCustomerId) throw new Error('Nao foi possivel identificar o cliente salvo.');
  customerModalState.clienteId = resolvedCustomerId;
  if (agendaCustomerHasAddressData() && customerModalState.clienteId) {
    const addressPayload = agendaCustomerBuildAddressPayload();
    const addressPath = customerModalState.selectedAddress?._id
      ? `/func/clientes/${customerModalState.clienteId}/enderecos/${customerModalState.selectedAddress._id}`
      : `/func/clientes/${customerModalState.clienteId}/enderecos`;
    const addressMethod = customerModalState.selectedAddress?._id ? 'PUT' : 'POST';
    const addressResponse = await api(addressPath, { method: addressMethod, body: JSON.stringify(addressPayload) });
    if (!addressResponse.ok) throw new Error(await agendaCustomerReadErr(addressResponse, 'Nao foi possivel salvar o endereco.'));
  }
  await agendaCustomerLoad(customerModalState.clienteId, { preservePetSelection: true });
  if (!silent) notify('Cliente salvo com sucesso.', 'success');
}

async function agendaCustomerSavePet(options = {}) {
  const { silent = false } = options;
  if (!customerModalState.clienteId) throw new Error('Selecione ou cadastre um cliente antes de gravar o pet.');
  const existingPetId = agendaCustomerNormalizeId(customerModalState.petId);
  const payload = agendaCustomerBuildPetPayload();
  if (!payload.nome) throw new Error('Informe o nome do pet.');
  if (!payload.tipo) throw new Error('Informe o tipo do pet.');
  if (!payload.sexo) throw new Error('Informe o sexo do pet.');
  const path = existingPetId
    ? `/func/clientes/${customerModalState.clienteId}/pets/${existingPetId}`
    : `/func/clientes/${customerModalState.clienteId}/pets`;
  const method = existingPetId ? 'PUT' : 'POST';
  const response = await api(path, { method, body: JSON.stringify(payload) });
  if (!response.ok) throw new Error(await agendaCustomerReadErr(response, 'Nao foi possivel salvar o pet.'));
  const savedPet = await response.json().catch(() => ({}));
  const resolvedPetId = agendaCustomerNormalizeId(savedPet?._id || savedPet?.id || existingPetId);
  if (!resolvedPetId) throw new Error('Nao foi possivel identificar o pet salvo.');
  customerModalState.petId = resolvedPetId;
  await agendaCustomerLoad(customerModalState.clienteId, { preservePetSelection: true });
  if (!silent) notify('Pet salvo com sucesso.', 'success');
}

async function agendaCustomerApplySelection() {
  if (!customerModalState.clienteId || !customerModalState.selectedCliente) {
    throw new Error('Selecione um cliente para continuar.');
  }
  const pets = Array.isArray(customerModalState.pets) ? customerModalState.pets : [];
  const resolvedPetId = customerModalState.petId || (pets.length === 1 ? String(pets[0]?._id || '') : '');
  if (!resolvedPetId) {
    throw new Error('Selecione um pet para continuar.');
  }
  state.selectedCliente = {
    _id: customerModalState.clienteId,
    nome: agendaCustomerName(customerModalState.selectedCliente),
  };
  if (els.cliInput) els.cliInput.value = state.selectedCliente.nome;
  if (els.cliSug) {
    els.cliSug.innerHTML = '';
    els.cliSug.classList.add('hidden');
  }
  if (els.petSelect) {
    els.petSelect.innerHTML = pets.map((pet) => `<option value="${pet._id}">${escapeHtml(pet.nome || 'Pet')}</option>`).join('');
    els.petSelect.value = resolvedPetId;
  }
  customerModalState.petId = resolvedPetId;
  agendaCustomerCloseModal();
}

async function agendaCustomerConfirm() {
  try {
    const shouldSave = !!els.customerSaveToggle?.checked;
    const isExistingCustomer = !!(customerModalState.clienteId && customerModalState.selectedCliente);
    if (!shouldSave) {
      if (!isExistingCustomer) {
        throw new Error('Selecione um cliente existente para continuar.');
      }
      if (!customerModalState.petId) {
        throw new Error('Selecione um pet existente para continuar.');
      }
      await agendaCustomerApplySelection();
      return;
    }

    if (!isExistingCustomer) {
      if (!agendaCustomerHasData()) throw new Error('Selecione ou informe um cliente.');
      await agendaCustomerSave({ silent: true });
    } else {
      await agendaCustomerSave({ silent: true });
    }

    if (agendaCustomerHasPetData() || !customerModalState.petId) {
      await agendaCustomerSavePet({ silent: true });
    }

    await agendaCustomerApplySelection();
  } catch (error) {
    notify(error?.message || 'Nao foi possivel confirmar o cliente.', 'error');
  }
}

async function agendaCustomerOpenModal() {
  if (!els.customerRegisterModal) return;
  customerRegisterPreviousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  els.customerRegisterModal.classList.remove('hidden');
  document.body?.classList.add('overflow-hidden');
  agendaCustomerCloseSearchModal({ restoreFocus: false });
  agendaCustomerSyncRequiredIndicators();
  agendaCustomerSetTab('cliente');
  agendaCustomerResetSearch();
  const selectedCustomerId =
    state.selectedCliente?._id ||
    state.editing?.clienteId ||
    state.editing?.cliente?._id ||
    state.editing?.cliente?.id ||
    '';
  const selectedPetId =
    els.petSelect?.value ||
    state.editing?.petId ||
    state.editing?.pet?._id ||
    state.editing?.pet?.id ||
    '';
  if (selectedCustomerId) {
    try {
      customerModalState.petId = agendaCustomerNormalizeId(selectedPetId);
      await agendaCustomerLoad(selectedCustomerId, { preservePetSelection: true });
    } catch (error) {
      notify(error?.message || 'Nao foi possivel carregar o cliente selecionado.', 'error');
      agendaCustomerClearContext();
    }
  } else {
    agendaCustomerClearContext();
  }
  setTimeout(() => {
    els.customerName?.focus();
  }, 80);
}

function agendaCustomerCloseModal() {
  if (!els.customerRegisterModal) return;
  agendaCustomerCloseSearchModal({ restoreFocus: false });
  els.customerRegisterModal.classList.add('hidden');
  document.body?.classList.remove('overflow-hidden');
  if (customerModalState.searchAbort) {
    customerModalState.searchAbort.abort();
    customerModalState.searchAbort = null;
  }
  if (customerModalSearchTimer) {
    clearTimeout(customerModalSearchTimer);
    customerModalSearchTimer = null;
  }
  if (customerRegisterPreviousFocus && typeof customerRegisterPreviousFocus.focus === 'function') {
    try { customerRegisterPreviousFocus.focus(); } catch {}
  }
  customerRegisterPreviousFocus = null;
}

function agendaCustomerHandleKeydown(event) {
  if (event.key === 'Escape') {
    event.preventDefault();
    agendaCustomerCloseModal();
    return;
  }
  if (event.key === 'F5') {
    event.preventDefault();
    void agendaCustomerConfirm();
  }
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
    void agendaCustomerOpenModal();
  });
  els.customerRegisterClose?.addEventListener('click', agendaCustomerCloseModal);
  els.customerRegisterBackdrop?.addEventListener('click', agendaCustomerCloseModal);
  els.customerRegisterModal?.addEventListener('keydown', agendaCustomerHandleKeydown);
  els.customerSearchModalClose?.addEventListener('click', () => agendaCustomerCloseSearchModal());
  els.customerSearchModalBackdrop?.addEventListener('click', () => agendaCustomerCloseSearchModal());
  els.customerSearchModal?.addEventListener('keydown', agendaCustomerHandleSearchModalKeydown);
  els.customerSearchModalButton?.addEventListener('click', () => {
    agendaCustomerScheduleSearch(els.customerSearchModalInput?.value || '');
  });
  els.customerSearchModalInput?.addEventListener('input', () => {
    agendaCustomerScheduleSearch(els.customerSearchModalInput?.value || '');
  });
  els.customerSearchModalResults?.addEventListener('click', (event) => {
    const row = event.target.closest('tr[data-agenda-customer-search-result]');
    if (!row) return;
    const index = Number.parseInt(row.getAttribute('data-agenda-customer-search-result') || '-1', 10);
    if (!Number.isInteger(index) || index < 0) return;
    void agendaCustomerSelectSearchResult(index).catch((error) => {
      notify(error?.message || 'Nao foi possivel carregar o cliente.', 'error');
    });
  });
  els.customerCancelButton?.addEventListener('click', agendaCustomerCloseModal);
  els.customerClearButton?.addEventListener('click', () => {
    agendaCustomerClearContext();
    agendaCustomerResetSearch();
    agendaCustomerSyncRequiredIndicators();
    agendaCustomerSetTab('cliente');
  });
  els.customerClearSelectionButton?.addEventListener('click', () => {
    agendaCustomerClearContext();
    agendaCustomerResetSearch();
  });
  els.customerSaveToggle?.addEventListener('change', agendaCustomerSyncRequiredIndicators);
  els.customerTabBtnCliente?.addEventListener('click', () => agendaCustomerSetTab('cliente'));
  els.customerTabBtnPet?.addEventListener('click', () => agendaCustomerSetTab('pet'));
  els.customerCode?.addEventListener('input', () => {
    const code = String(els.customerCode?.value || '').trim();
    if (code.length >= 1) {
      void agendaCustomerLookupByCode(code).catch(() => {});
    } else {
      agendaCustomerCloseSearchModal({ restoreFocus: false });
    }
  });
  els.customerDoc?.addEventListener('input', () => {
    void agendaCustomerLookupByDocument(els.customerDoc?.value || '').catch(() => {});
  });
  els.customerCep?.addEventListener('input', () => {
    const digits = agendaCustomerDigits(els.customerCep?.value || '').slice(0, 8);
    if (els.customerCep) els.customerCep.value = agendaCustomerFormatCep(digits);
    if (digits.length === 8) {
      void agendaCustomerLookupCep().catch(() => {});
    }
  });
  els.customerCep?.addEventListener('blur', () => {
    void agendaCustomerLookupCep({ force: true }).catch(() => {});
  });
  els.customerPhone1Ddd?.addEventListener('blur', () => {
    void agendaCustomerLookupByPhone().catch(() => {});
  });
  els.customerPhone1?.addEventListener('input', () => {
    void agendaCustomerLookupByPhone().catch(() => {});
  });
  els.customerPhone1?.addEventListener('blur', () => {
    void agendaCustomerLookupByPhone().catch(() => {});
  });
  els.customerPhone2Ddd?.addEventListener('blur', () => {
    void agendaCustomerLookupByPhone().catch(() => {});
  });
  els.customerPhone2?.addEventListener('input', () => {
    void agendaCustomerLookupByPhone().catch(() => {});
  });
  els.customerPhone2?.addEventListener('blur', () => {
    void agendaCustomerLookupByPhone().catch(() => {});
  });
  els.customerPetTipo?.addEventListener('input', () => {
    void syncAgendaCustomerPetBreedTypePorte('tipo');
    void renderAgendaCustomerPetBreedSuggestions();
  });
  els.customerPetTipo?.addEventListener('change', () => {
    void syncAgendaCustomerPetBreedTypePorte('tipo');
    void renderAgendaCustomerPetBreedSuggestions();
  });
  els.customerPetRacaSuggest?.addEventListener('mousedown', (event) => {
    const button = event.target.closest('[data-agenda-customer-pet-breed-option]');
    if (!button || !els.customerPetRaca) return;
    event.preventDefault();
    selectAgendaCustomerPetBreedOption(button.getAttribute('data-agenda-customer-pet-breed-option') || '');
  });
  els.customerPetRaca?.addEventListener('focus', () => {
    void renderAgendaCustomerPetBreedSuggestions();
  });
  els.customerPetRaca?.addEventListener('input', () => {
    void renderAgendaCustomerPetBreedSuggestions();
    void syncAgendaCustomerPetBreedTypePorte('raca');
  });
  els.customerPetRaca?.addEventListener('change', () => {
    void renderAgendaCustomerPetBreedSuggestions();
    void syncAgendaCustomerPetBreedTypePorte('raca');
  });
  els.customerPetRaca?.addEventListener('blur', () => {
    setTimeout(() => closeAgendaCustomerPetBreedSuggestions(), 120);
    void syncAgendaCustomerPetBreedTypePorte('raca');
  });
  els.customerPetRaca?.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeAgendaCustomerPetBreedSuggestions();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!agendaCustomerPetBreedFilteredOptions.length) {
        void renderAgendaCustomerPetBreedSuggestions();
        return;
      }
      agendaCustomerPetBreedActiveIndex =
        agendaCustomerPetBreedActiveIndex >= agendaCustomerPetBreedFilteredOptions.length - 1
          ? 0
          : agendaCustomerPetBreedActiveIndex + 1;
      void renderAgendaCustomerPetBreedSuggestions();
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (!agendaCustomerPetBreedFilteredOptions.length) {
        void renderAgendaCustomerPetBreedSuggestions();
        return;
      }
      agendaCustomerPetBreedActiveIndex =
        agendaCustomerPetBreedActiveIndex <= 0
          ? agendaCustomerPetBreedFilteredOptions.length - 1
          : agendaCustomerPetBreedActiveIndex - 1;
      void renderAgendaCustomerPetBreedSuggestions();
      return;
    }
    if (event.key === 'Enter' && agendaCustomerPetBreedFilteredOptions.length) {
      event.preventDefault();
      const breed =
        agendaCustomerPetBreedFilteredOptions[
          agendaCustomerPetBreedActiveIndex >= 0 ? agendaCustomerPetBreedActiveIndex : 0
        ];
      if (breed) selectAgendaCustomerPetBreedOption(breed);
    }
  });
  els.customerConfirmButton?.addEventListener('click', () => {
    void agendaCustomerConfirm();
  });
  els.customerPets?.addEventListener('click', (event) => {
    const addButton = event.target.closest('[data-agenda-customer-pet-new="true"]');
    if (addButton) {
      agendaCustomerSetTab('pet');
      agendaCustomerStartNewPet();
      return;
    }
    const button = event.target.closest('[data-agenda-customer-pet]');
    if (!button) return;
    const petId = agendaCustomerNormalizeId(button.getAttribute('data-agenda-customer-pet'));
    const pet = customerModalState.pets.find((item) => agendaCustomerNormalizeId(item?._id) === petId);
    if (pet) agendaCustomerFillPet(pet);
  });
  els.customerAddressCards?.addEventListener('click', (event) => {
    const newCard = event.target.closest('[data-agenda-customer-address-new="true"]');
    if (newCard) {
      agendaCustomerStartNewAddress();
      return;
    }
    const button = event.target.closest('[data-agenda-customer-address]');
    if (!button) return;
    const addressId = agendaCustomerNormalizeId(button.getAttribute('data-agenda-customer-address'));
    const list = Array.isArray(customerModalState.addresses) ? customerModalState.addresses : [];
    const address =
      list.find((item) => agendaCustomerNormalizeId(item?._id) === addressId) ||
      customerModalState.selectedAddress;
    agendaCustomerFillAddress(address);
    agendaCustomerRenderAddressCards(list);
  });
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
