// Atendimento actions for finalizar and reabrir fluxos
import {
  state,
  els,
  api,
  notify,
  debounce,
  persistAgendaContext,
  normalizeId,
  normalizeForCompare,
  formatMoney,
  pickFirst,
  getCurrentUserId,
  getAgendaStoreId,
  VACINA_STORAGE_PREFIX,
  ANEXO_STORAGE_PREFIX,
  EXAME_STORAGE_PREFIX,
  OBSERVACAO_STORAGE_PREFIX,
  isConsultaLockedForCurrentUser,
  isAdminRole,
  confirmWithModal,
} from './core.js';
import {
  getConsultasKey,
  updateConsultaAgendaCard,
  updateMainTabLayout,
  deleteConsulta,
  loadWaitingAppointments,
} from './consultas.js';
import {
  addHistoricoEntry,
  removeHistoricoEntry,
  renderHistoricoArea,
  getHistoricoEntryById,
  setHistoricoReopenHandler,
  setActiveMainTab,
  persistHistoricoEntry,
} from './historico.js';
import { emitFichaClinicaUpdate, updateFichaRealTimeSelection } from './real-time.js';
import { deleteVacina } from './vacinas.js';
import { deleteAnexo, isExameAttachmentRecord } from './anexos.js';
import { deleteExame } from './exames.js';
import { deletePeso } from './pesos.js';
import { deleteObservacao } from './observacoes.js';
import { deleteDocumentoRegistro } from './documentos.js';
import { deleteReceitaRegistro } from './receitas.js';
import { loadVendasFromServer } from './vendas.js';

function deepClone(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

function buildAtendimentoEventPayload(extra = {}) {
  const payload = { ...extra };
  const clienteId = normalizeId(state.selectedCliente?._id);
  const petId = normalizeId(state.selectedPetId);
  const agenda = state.agendaContext && typeof state.agendaContext === 'object' ? state.agendaContext : null;
  const appointmentId = normalizeId(agenda?.appointmentId);

  if (clienteId) payload.clienteId = clienteId;
  if (petId) payload.petId = petId;
  if (appointmentId) payload.appointmentId = appointmentId;

  if (agenda) {
    if (agenda.status) {
      payload.agendaStatus = String(agenda.status);
    }
    if (Array.isArray(agenda.servicos)) {
      payload.agendaServicos = deepClone(agenda.servicos) || [...agenda.servicos];
    }
    if (agenda.valor !== undefined) {
      const valor = Number(agenda.valor);
      if (!Number.isNaN(valor)) {
        payload.agendaValor = valor;
      }
    }
    const profissional =
      agenda.profissionalNome !== undefined
        ? agenda.profissionalNome
        : agenda.profissional !== undefined
          ? agenda.profissional
          : undefined;
    if (profissional !== undefined) {
      payload.agendaProfissional = profissional;
    }
  }

  return payload;
}

function buildHistoricoEntryFromState() {
  const clienteId = normalizeId(state.selectedCliente?._id);
  const petId = normalizeId(state.selectedPetId);
  const appointmentId = normalizeId(state.agendaContext?.appointmentId);
  if (!(clienteId && petId && appointmentId)) return null;
  const now = new Date().toISOString();
  return {
    id: `hist-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    clienteId,
    petId,
    appointmentId,
    finalizadoEm: now,
    agenda: deepClone(state.agendaContext) || {},
    consultas: deepClone(state.consultas) || [],
    vacinas: deepClone(state.vacinas) || [],
    anexos: deepClone(state.anexos) || [],
    exames: deepClone(state.exames) || [],
    pesos: deepClone(state.pesos) || [],
    observacoes: deepClone(state.observacoes) || [],
    documentos: deepClone(state.documentos) || [],
    receitas: deepClone(state.receitas) || [],
  };
}

function findHistoricoEntryByAppointmentId(appointmentId) {
  const targetId = normalizeId(appointmentId);
  if (!targetId) return null;
  const historicos = Array.isArray(state.historicos) ? state.historicos : [];
  return (
    historicos.find((item) => normalizeId(item?.appointmentId || item?.appointment) === targetId) || null
  );
}

function clearLocalStoredDataForSelection(clienteId, petId) {
  const base = getConsultasKey(clienteId, petId);
  if (!base) return;
  try {
    localStorage.removeItem(`${VACINA_STORAGE_PREFIX}${base}`);
  } catch {}
  try {
    localStorage.removeItem(`${ANEXO_STORAGE_PREFIX}${base}`);
  } catch {}
  try {
    localStorage.removeItem(`${EXAME_STORAGE_PREFIX}${base}`);
  } catch {}
  try {
    localStorage.removeItem(`${OBSERVACAO_STORAGE_PREFIX}${base}`);
  } catch {}
}

function persistLocalDataForSelection(clienteId, petId) {
  const base = getConsultasKey(clienteId, petId);
  if (!base) return;
  try {
    if (Array.isArray(state.vacinas) && state.vacinas.length) {
      localStorage.setItem(`${VACINA_STORAGE_PREFIX}${base}`, JSON.stringify(state.vacinas));
    } else {
      localStorage.removeItem(`${VACINA_STORAGE_PREFIX}${base}`);
    }
  } catch {}
  try {
    if (Array.isArray(state.anexos) && state.anexos.length) {
      localStorage.setItem(`${ANEXO_STORAGE_PREFIX}${base}`, JSON.stringify(state.anexos));
    } else {
      localStorage.removeItem(`${ANEXO_STORAGE_PREFIX}${base}`);
    }
  } catch {}
  try {
    if (Array.isArray(state.exames) && state.exames.length) {
      localStorage.setItem(`${EXAME_STORAGE_PREFIX}${base}`, JSON.stringify(state.exames));
    } else {
      localStorage.removeItem(`${EXAME_STORAGE_PREFIX}${base}`);
    }
  } catch {}
  try {
    if (Array.isArray(state.observacoes) && state.observacoes.length) {
      localStorage.setItem(`${OBSERVACAO_STORAGE_PREFIX}${base}`, JSON.stringify(state.observacoes));
    } else {
      localStorage.removeItem(`${OBSERVACAO_STORAGE_PREFIX}${base}`);
    }
  } catch {}
}

function resetConsultaState() {
  state.consultas = [];
  state.consultasLoading = false;
  state.consultasLoadKey = null;
  state.vacinas = [];
  state.vacinasLoadKey = null;
  state.anexos = [];
  state.anexosLoadKey = null;
  state.exames = [];
  state.examesLoadKey = null;
  state.pesos = [];
  state.pesosLoadKey = null;
  state.observacoes = [];
  state.observacoesLoadKey = null;
  state.documentos = [];
  state.documentosLoadKey = null;
  state.receitas = [];
  state.receitasLoadKey = null;
  state.vendas = [];
  state.vendasLoadKey = null;
  state.vendasLoading = false;
}

function setLimparConsultaProcessing(isProcessing) {
  if (!els.limparConsultaBtn) return;
  if (isProcessing) {
    els.limparConsultaBtn.setAttribute('disabled', 'disabled');
    els.limparConsultaBtn.classList.add('opacity-60', 'cursor-not-allowed');
  } else {
    els.limparConsultaBtn.removeAttribute('disabled');
    els.limparConsultaBtn.classList.remove('opacity-60', 'cursor-not-allowed');
  }
}

function setColocarEmEsperaProcessing(isProcessing) {
  const btn = els.colocarEmEsperaBtn;
  if (!btn) return;

  const currentLabel = (btn.textContent || '').trim();
  const idleLabel = btn.dataset.idleLabel || (currentLabel ? currentLabel : 'Colocar em espera');
  if (!btn.dataset.idleLabel) {
    btn.dataset.idleLabel = idleLabel;
  }

  if (isProcessing) {
    btn.dataset.processing = 'true';
    btn.setAttribute('disabled', 'disabled');
    btn.classList.remove('opacity-50');
    btn.classList.add('opacity-60', 'cursor-not-allowed');
    btn.textContent = 'Colocando...';
  } else {
    delete btn.dataset.processing;
    btn.classList.remove('opacity-60', 'opacity-50', 'cursor-not-allowed');
    btn.removeAttribute('disabled');
    btn.textContent = btn.dataset.idleLabel || 'Colocar em espera';
  }
}

const iniciarAtendimentoModal = {
  overlay: null,
  dialog: null,
  form: null,
  storeSelect: null,
  serviceInput: null,
  suggestionsEl: null,
  serviceInfo: null,
  submitBtn: null,
  cancelBtn: null,
  stores: [],
  selectedService: null,
  isSubmitting: false,
  searchAbortController: null,
  keydownHandler: null,
};

function isStartAtendimentoServiceCandidate(service) {
  if (!service) return false;
  const categories = [];
  if (Array.isArray(service.categorias)) categories.push(...service.categorias);
  if (Array.isArray(service.category)) categories.push(...service.category);
  if (service.categoria) categories.push(service.categoria);
  if (service?.grupo?.nome) categories.push(service.grupo.nome);
  const hasCategory = categories.some((cat) => {
    const normalized = normalizeForCompare(cat);
    return normalized.includes('vacina') || normalized.includes('veterinario') || normalized.includes('exame');
  });
  if (hasCategory) return true;
  const nomeNorm = normalizeForCompare(service.nome || service.descricao || '');
  return nomeNorm.includes('vacina') || nomeNorm.includes('veterin') || nomeNorm.includes('exame');
}

function setIniciarAtendimentoSubmitting(isSubmitting) {
  iniciarAtendimentoModal.isSubmitting = !!isSubmitting;
  if (iniciarAtendimentoModal.submitBtn) {
    iniciarAtendimentoModal.submitBtn.disabled = !!isSubmitting;
    iniciarAtendimentoModal.submitBtn.classList.toggle('opacity-60', !!isSubmitting);
    iniciarAtendimentoModal.submitBtn.classList.toggle('cursor-not-allowed', !!isSubmitting);
    iniciarAtendimentoModal.submitBtn.textContent = isSubmitting ? 'Iniciando...' : 'Iniciar atendimento';
  }
  if (iniciarAtendimentoModal.cancelBtn) {
    iniciarAtendimentoModal.cancelBtn.disabled = !!isSubmitting;
    iniciarAtendimentoModal.cancelBtn.classList.toggle('opacity-60', !!isSubmitting);
    iniciarAtendimentoModal.cancelBtn.classList.toggle('cursor-not-allowed', !!isSubmitting);
  }
  if (iniciarAtendimentoModal.storeSelect) {
    iniciarAtendimentoModal.storeSelect.disabled = !!isSubmitting;
  }
  if (iniciarAtendimentoModal.serviceInput) {
    iniciarAtendimentoModal.serviceInput.disabled = !!isSubmitting;
  }
}

function updateIniciarAtendimentoServiceInfo() {
  const info = iniciarAtendimentoModal.serviceInfo;
  if (!info) return;
  const service = iniciarAtendimentoModal.selectedService;
  if (!service) {
    info.textContent = 'Nenhum serviço selecionado.';
    return;
  }
  const name = service.nome || 'Serviço';
  const valor = Number(service.valor || 0);
  const priceText = valor ? formatMoney(valor) : 'Preço padrão';
  info.textContent = `${name} · ${priceText}`;
}

function hideIniciarAtendimentoSuggestions() {
  if (!iniciarAtendimentoModal.suggestionsEl) return;
  iniciarAtendimentoModal.suggestionsEl.innerHTML = '';
  iniciarAtendimentoModal.suggestionsEl.classList.add('hidden');
}

function selectIniciarAtendimentoService(service) {
  iniciarAtendimentoModal.selectedService = service;
  if (iniciarAtendimentoModal.serviceInput) {
    iniciarAtendimentoModal.serviceInput.value = service?.nome || '';
  }
  hideIniciarAtendimentoSuggestions();
  updateIniciarAtendimentoServiceInfo();
}

async function searchIniciarAtendimentoServices(term) {
  const query = String(term || '').trim();
  if (!query || query.length < 2) {
    hideIniciarAtendimentoSuggestions();
    return;
  }

  if (iniciarAtendimentoModal.searchAbortController) {
    try { iniciarAtendimentoModal.searchAbortController.abort(); } catch {}
  }
  const controller = new AbortController();
  iniciarAtendimentoModal.searchAbortController = controller;

  try {
    const params = new URLSearchParams({ q: query, limit: '10' });
    const resp = await api(`/func/servicos/buscar?${params.toString()}`, { signal: controller.signal });
    if (!resp.ok) {
      hideIniciarAtendimentoSuggestions();
      return;
    }
    const payload = await resp.json().catch(() => []);
    if (controller.signal.aborted) return;

    const list = Array.isArray(payload) ? payload : [];
    const filtered = list.filter(isStartAtendimentoServiceCandidate);
    const normalized = filtered
      .map((svc) => ({
        _id: normalizeId(svc._id),
        nome: pickFirst(svc.nome, svc.descricao) || '',
        valor: Number(svc.valor || 0),
        categorias: Array.isArray(svc.categorias) ? svc.categorias : [],
        tiposPermitidos: Array.isArray(svc?.grupo?.tiposPermitidos) ? svc.grupo.tiposPermitidos : [],
      }))
      .filter((svc) => svc._id && svc.nome);

    if (!normalized.length) {
      hideIniciarAtendimentoSuggestions();
      return;
    }

    const listEl = iniciarAtendimentoModal.suggestionsEl;
    if (!listEl) return;
    listEl.innerHTML = '';
    normalized.forEach((svc) => {
      const li = document.createElement('li');
      li.className = 'px-3 py-2 hover:bg-gray-50 cursor-pointer';
      li.dataset.serviceId = svc._id;
      const nameEl = document.createElement('div');
      nameEl.className = 'font-medium text-gray-900';
      nameEl.textContent = svc.nome;
      const priceEl = document.createElement('div');
      priceEl.className = 'text-xs text-gray-500';
      priceEl.textContent = formatMoney(Number(svc.valor || 0));
      li.appendChild(nameEl);
      li.appendChild(priceEl);
      li.addEventListener('click', () => selectIniciarAtendimentoService(svc));
      listEl.appendChild(li);
    });
    listEl.classList.remove('hidden');
  } catch (error) {
    if (error?.name === 'AbortError') return;
    console.error('searchIniciarAtendimentoServices', error);
    hideIniciarAtendimentoSuggestions();
  }
}

function renderIniciarAtendimentoStoreOptions() {
  const select = iniciarAtendimentoModal.storeSelect;
  if (!select) return;

  const stores = Array.isArray(iniciarAtendimentoModal.stores) ? iniciarAtendimentoModal.stores : [];
  const options = [];
  if (stores.length) {
    options.push('<option value="">Selecione a empresa</option>');
    stores.forEach((store) => {
      const label = store.nomeFantasia || store.nome || store.razaoSocial || 'Empresa';
      options.push(`<option value="${store._id}">${label}</option>`);
    });
  } else {
    options.push('<option value="">Nenhuma empresa vinculada</option>');
  }
  select.innerHTML = options.join('');

  const currentStoreId = normalizeId(getAgendaStoreId({ persist: false }));
  const allowedCurrent = stores.some((store) => store._id === currentStoreId);
  if (allowedCurrent) {
    select.value = currentStoreId;
  } else if (stores.length === 1) {
    select.value = stores[0]._id;
  }
}

async function loadIniciarAtendimentoStores() {
  const select = iniciarAtendimentoModal.storeSelect;
  if (!select) return;

  select.innerHTML = '<option value="">Carregando...</option>';
  select.disabled = true;

  try {
    const resp = await api('/stores/allowed');
    if (!resp.ok) throw new Error('Falha ao carregar empresas.');
    const payload = await resp.json().catch(() => ({}));
    const stores = Array.isArray(payload?.stores) ? payload.stores : Array.isArray(payload) ? payload : [];
    iniciarAtendimentoModal.stores = stores
      .map((store) => ({
        _id: normalizeId(store._id || store.id),
        nome: store.nome || '',
        nomeFantasia: store.nomeFantasia || '',
        razaoSocial: store.razaoSocial || '',
      }))
      .filter((store) => store._id);
  } catch (error) {
    console.error('loadIniciarAtendimentoStores', error);
    iniciarAtendimentoModal.stores = [];
    notify('Não foi possível carregar as empresas vinculadas ao seu usuário.', 'error');
  } finally {
    select.disabled = false;
    renderIniciarAtendimentoStoreOptions();
  }
}

function ensureIniciarAtendimentoModal() {
  if (iniciarAtendimentoModal.overlay) return iniciarAtendimentoModal;

  const overlay = document.createElement('div');
  overlay.id = 'vet-iniciar-atendimento-modal';
  overlay.className = 'hidden fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4';
  overlay.setAttribute('aria-hidden', 'true');

  const dialog = document.createElement('div');
  dialog.className = 'w-full max-w-2xl rounded-xl bg-white shadow-xl focus:outline-none';
  dialog.tabIndex = -1;
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  overlay.appendChild(dialog);

  const form = document.createElement('form');
  form.className = 'flex flex-col gap-5 p-6';
  dialog.appendChild(form);

  const header = document.createElement('div');
  header.className = 'flex items-start justify-between gap-3';
  form.appendChild(header);

  const title = document.createElement('h2');
  title.className = 'text-lg font-semibold text-gray-800';
  title.textContent = 'Iniciar atendimento';
  header.appendChild(title);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'text-gray-400 transition hover:text-gray-600';
  closeBtn.innerHTML = '<i class="fas fa-xmark"></i>';
  closeBtn.addEventListener('click', (event) => {
    event.preventDefault();
    closeIniciarAtendimentoModal();
  });
  header.appendChild(closeBtn);

  const fields = document.createElement('div');
  fields.className = 'grid gap-4';
  form.appendChild(fields);

  const storeField = document.createElement('label');
  storeField.className = 'grid gap-1';
  fields.appendChild(storeField);

  const storeLabel = document.createElement('span');
  storeLabel.className = 'text-sm font-medium text-gray-700';
  storeLabel.textContent = 'Empresa';
  storeField.appendChild(storeLabel);

  const storeSelect = document.createElement('select');
  storeSelect.className = 'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 shadow-sm focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-300';
  storeField.appendChild(storeSelect);

  const storeHelp = document.createElement('p');
  storeHelp.className = 'text-xs text-gray-500';
  storeHelp.textContent = 'Selecione a empresa onde o atendimento será iniciado.';
  storeField.appendChild(storeHelp);

  const serviceField = document.createElement('label');
  serviceField.className = 'grid gap-1';
  fields.appendChild(serviceField);

  const serviceLabel = document.createElement('span');
  serviceLabel.className = 'text-sm font-medium text-gray-700';
  serviceLabel.textContent = 'Serviço';
  serviceField.appendChild(serviceLabel);

  const serviceWrap = document.createElement('div');
  serviceWrap.className = 'relative';
  serviceField.appendChild(serviceWrap);

  const serviceInput = document.createElement('input');
  serviceInput.type = 'text';
  serviceInput.placeholder = 'Busque por vacina, exame ou consulta veterinária';
  serviceInput.autocomplete = 'off';
  serviceInput.className = 'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 shadow-sm focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-300';
  serviceWrap.appendChild(serviceInput);

  const suggestions = document.createElement('ul');
  suggestions.className = 'hidden absolute left-0 right-0 top-full mt-2 max-h-56 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg z-10';
  serviceWrap.appendChild(suggestions);

  const serviceInfo = document.createElement('p');
  serviceInfo.className = 'text-xs text-gray-500';
  serviceField.appendChild(serviceInfo);

  const footer = document.createElement('div');
  footer.className = 'flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:items-center sm:justify-end sm:gap-3';
  form.appendChild(footer);

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'w-full rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 sm:w-auto';
  cancelBtn.textContent = 'Cancelar';
  cancelBtn.addEventListener('click', (event) => {
    event.preventDefault();
    closeIniciarAtendimentoModal();
  });
  footer.appendChild(cancelBtn);

  const submitBtn = document.createElement('button');
  submitBtn.type = 'submit';
  submitBtn.className = 'w-full rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700 focus:outline-none focus:ring-2 focus:ring-sky-400 sm:w-auto';
  submitBtn.textContent = 'Iniciar atendimento';
  footer.appendChild(submitBtn);

  const debouncedSearch = debounce((value) => searchIniciarAtendimentoServices(value), 300);
  serviceInput.addEventListener('input', (event) => {
    iniciarAtendimentoModal.selectedService = null;
    updateIniciarAtendimentoServiceInfo();
    debouncedSearch(event.target.value);
  });
  serviceInput.addEventListener('focus', (event) => {
    const value = String(event.target.value || '').trim();
    if (value.length >= 2) {
      searchIniciarAtendimentoServices(value);
    }
  });
  serviceInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !iniciarAtendimentoModal.selectedService) {
      event.preventDefault();
    }
  });
  serviceInput.addEventListener('blur', () => {
    setTimeout(() => hideIniciarAtendimentoSuggestions(), 150);
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    await handleIniciarAtendimentoSubmit();
  });

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) {
      event.preventDefault();
      closeIniciarAtendimentoModal();
    }
  });

  document.body.appendChild(overlay);

  iniciarAtendimentoModal.overlay = overlay;
  iniciarAtendimentoModal.dialog = dialog;
  iniciarAtendimentoModal.form = form;
  iniciarAtendimentoModal.storeSelect = storeSelect;
  iniciarAtendimentoModal.serviceInput = serviceInput;
  iniciarAtendimentoModal.suggestionsEl = suggestions;
  iniciarAtendimentoModal.serviceInfo = serviceInfo;
  iniciarAtendimentoModal.submitBtn = submitBtn;
  iniciarAtendimentoModal.cancelBtn = cancelBtn;

  updateIniciarAtendimentoServiceInfo();

  return iniciarAtendimentoModal;
}

function closeIniciarAtendimentoModal() {
  if (!iniciarAtendimentoModal.overlay) return;
  iniciarAtendimentoModal.overlay.classList.add('hidden');
  iniciarAtendimentoModal.overlay.setAttribute('aria-hidden', 'true');
  if (iniciarAtendimentoModal.form) iniciarAtendimentoModal.form.reset();
  iniciarAtendimentoModal.selectedService = null;
  hideIniciarAtendimentoSuggestions();
  updateIniciarAtendimentoServiceInfo();
  setIniciarAtendimentoSubmitting(false);
  if (iniciarAtendimentoModal.keydownHandler) {
    document.removeEventListener('keydown', iniciarAtendimentoModal.keydownHandler);
    iniciarAtendimentoModal.keydownHandler = null;
  }
}

function openIniciarAtendimentoModal() {
  const clienteId = normalizeId(state.selectedCliente?._id);
  const petId = normalizeId(state.selectedPetId);
  if (!(clienteId && petId)) {
    notify('Selecione um tutor e um pet para iniciar o atendimento.', 'warning');
    return;
  }

  const currentStatus = normalizeForCompare(state.agendaContext?.status);
  const contextTutor = normalizeId(state.agendaContext?.tutorId);
  const contextPet = normalizeId(state.agendaContext?.petId);
  if (currentStatus === 'em_atendimento' && contextTutor === clienteId && contextPet === petId) {
    notify('O atendimento já está em andamento para este tutor e pet.', 'info');
    return;
  }

  const modal = ensureIniciarAtendimentoModal();
  modal.selectedService = null;
  if (modal.serviceInput) modal.serviceInput.value = '';
  updateIniciarAtendimentoServiceInfo();
  setIniciarAtendimentoSubmitting(false);
  loadIniciarAtendimentoStores();

  modal.overlay.classList.remove('hidden');
  modal.overlay.removeAttribute('aria-hidden');
  if (modal.dialog) {
    modal.dialog.focus();
  }

  if (modal.keydownHandler) {
    document.removeEventListener('keydown', modal.keydownHandler);
  }
  modal.keydownHandler = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeIniciarAtendimentoModal();
    }
  };
  document.addEventListener('keydown', modal.keydownHandler);
}

function applyIniciarAtendimentoContext({ appointmentId, storeId, scheduledAt, status, servico, profissionalNome, profissionalId }) {
  const clienteId = normalizeId(state.selectedCliente?._id);
  const petId = normalizeId(state.selectedPetId);
  if (!(clienteId && petId && appointmentId)) return;

  const servicos = servico ? [{
    _id: servico._id,
    nome: servico.nome,
    valor: Number(servico.valor || 0),
    categorias: Array.isArray(servico.categorias) ? servico.categorias : [],
    tiposPermitidos: Array.isArray(servico.tiposPermitidos) ? servico.tiposPermitidos : [],
  }] : [];
  const total = servicos.reduce((sum, item) => sum + Number(item.valor || 0), 0);

  state.agendaContext = {
    ...(state.agendaContext || {}),
    appointmentId,
    tutorId: clienteId,
    petId,
    status: status || 'em_atendimento',
    scheduledAt: scheduledAt || new Date().toISOString(),
    valor: total,
    servicos,
    totalServicos: servicos.length,
    profissionalId: profissionalId || null,
    profissionalNome: profissionalNome || '',
  };

  if (storeId) {
    state.agendaContext.storeId = storeId;
    if (!Array.isArray(state.agendaContext.storeIdCandidates)) {
      state.agendaContext.storeIdCandidates = [];
    }
    if (!state.agendaContext.storeIdCandidates.includes(storeId)) {
      state.agendaContext.storeIdCandidates.push(storeId);
    }
  }

  persistAgendaContext(state.agendaContext);
}

async function handleIniciarAtendimentoSubmit() {
  const modal = ensureIniciarAtendimentoModal();
  if (modal.isSubmitting) return;

  const clienteId = normalizeId(state.selectedCliente?._id);
  const petId = normalizeId(state.selectedPetId);
  if (!(clienteId && petId)) {
    notify('Selecione um tutor e um pet para iniciar o atendimento.', 'warning');
    return;
  }

  const storeId = normalizeId(modal.storeSelect?.value || '');
  if (!storeId) {
    notify('Selecione a empresa para iniciar o atendimento.', 'warning');
    return;
  }

  const service = modal.selectedService;
  if (!service || !service._id) {
    notify('Selecione o serviço que será iniciado.', 'warning');
    return;
  }

  const profissionalId = getCurrentUserId();
  if (!profissionalId) {
    notify('Não foi possível identificar o profissional logado.', 'error');
    return;
  }

  const scheduledAt = new Date().toISOString();
  const payload = {
    storeId,
    clienteId,
    petId,
    profissionalId,
    scheduledAt,
    status: 'em_atendimento',
    servicos: [{
      servicoId: service._id,
      valor: Number(service.valor || 0),
      profissionalId,
      status: 'em_atendimento',
    }],
  };

  setIniciarAtendimentoSubmitting(true);

  try {
    const response = await api('/func/agendamentos', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => (response.ok ? {} : {}));
    if (!response.ok) {
      const message = typeof data?.message === 'string' ? data.message : 'Erro ao iniciar atendimento.';
      throw new Error(message);
    }

    const appointmentId = normalizeId(data?._id || data?.id || data?.appointmentId);
    applyIniciarAtendimentoContext({
      appointmentId,
      storeId,
      scheduledAt: data?.h || scheduledAt,
      status: data?.status || 'em_atendimento',
      servico: service,
      profissionalNome: data?.profissional || '',
      profissionalId,
    });

    clearLocalStoredDataForSelection(clienteId, petId);
    resetConsultaState();
    updateConsultaAgendaCard();
    updateFichaRealTimeSelection().catch(() => {});
    await loadWaitingAppointments({ force: true });

    closeIniciarAtendimentoModal();
    notify('Atendimento iniciado com sucesso.', 'success');
  } catch (error) {
    console.error('handleIniciarAtendimentoSubmit', error);
    notify(error.message || 'Erro ao iniciar atendimento.', 'error');
  } finally {
    setIniciarAtendimentoSubmitting(false);
  }
}
let isProcessingLimpeza = false;
let isProcessingFinalizacao = false;
let isProcessingColocarEmEspera = false;

async function limparConsultaAtual() {
  if (isProcessingLimpeza) return;

  const clienteId = normalizeId(state.selectedCliente?._id);
  const petId = normalizeId(state.selectedPetId);

  const confirmed = await confirmWithModal({
    title: 'Limpar consulta',
    message: 'Limpar os registros atuais da consulta? Esta ação não altera o histórico.',
    confirmText: 'Limpar',
    cancelText: 'Cancelar',
  });
  if (!confirmed) return;

  isProcessingLimpeza = true;
  setLimparConsultaProcessing(true);

  const errorMessages = new Set();
  const recordError = (tag, error, fallbackMessage) => {
    if (error) {
      console.error(tag, error);
    }
    const message = (error && error.message) || fallbackMessage;
    if (message) {
      errorMessages.add(message);
    }
  };

  const hasSelection = !!(clienteId && petId);
  const appointmentId = normalizeId(state.agendaContext?.appointmentId);

  try {
    if (hasSelection) {
      const consultas = Array.isArray(state.consultas) ? [...state.consultas] : [];
      for (const consulta of consultas) {
        try {
          await deleteConsulta(consulta, { skipConfirm: true, suppressNotify: true });
        } catch (error) {
          recordError('limparConsultaAtual/deleteConsulta', error, 'Não foi possível remover um registro de consulta.');
        }
      }

      if (appointmentId) {
        const vacinas = Array.isArray(state.vacinas) ? [...state.vacinas] : [];
        for (const vacina of vacinas) {
          try {
            await deleteVacina(vacina, { skipConfirm: true, suppressNotify: true });
          } catch (error) {
            recordError('limparConsultaAtual/deleteVacina', error, 'Não foi possível remover uma vacina registrada.');
          }
        }

        const exames = Array.isArray(state.exames) ? [...state.exames] : [];
        for (const exame of exames) {
          try {
            await deleteExame(exame, { skipConfirm: true, suppressNotify: true });
          } catch (error) {
            recordError('limparConsultaAtual/deleteExame', error, 'Não foi possível remover um exame registrado.');
          }
        }
      }

      const documentos = Array.isArray(state.documentos) ? [...state.documentos] : [];
      for (const documento of documentos) {
        try {
          await deleteDocumentoRegistro(documento, { suppressNotify: true });
        } catch (error) {
          recordError('limparConsultaAtual/deleteDocumento', error, 'Não foi possível remover um documento salvo.');
        }
      }

      const receitas = Array.isArray(state.receitas) ? [...state.receitas] : [];
      for (const receita of receitas) {
        try {
          await deleteReceitaRegistro(receita, { suppressNotify: true });
        } catch (error) {
          recordError('limparConsultaAtual/deleteReceita', error, 'Não foi possível remover uma receita salva.');
        }
      }

      const pesos = Array.isArray(state.pesos) ? state.pesos.filter((entry) => entry && !entry.isInitial) : [];
      for (const peso of pesos) {
        try {
          await deletePeso(peso, { skipConfirm: true, suppressNotify: true, skipReload: true });
        } catch (error) {
          recordError('limparConsultaAtual/deletePeso', error, 'Não foi possível remover um registro de peso.');
        }
      }

      const anexos = Array.isArray(state.anexos)
        ? state.anexos.filter((anexo) => !isExameAttachmentRecord(anexo))
        : [];
      for (const anexo of anexos) {
        try {
          await deleteAnexo(anexo, { skipConfirm: true, suppressNotify: true, skipReload: true });
        } catch (error) {
          recordError('limparConsultaAtual/deleteAnexo', error, 'Não foi possível remover um anexo enviado.');
        }
      }

      const observacoes = Array.isArray(state.observacoes) ? [...state.observacoes] : [];
      for (const observacao of observacoes) {
        try {
          await deleteObservacao(observacao, { suppressNotify: true });
        } catch (error) {
          recordError('limparConsultaAtual/deleteObservacao', error, 'Não foi possível remover uma observação registrada.');
        }
      }
    }

    clearLocalStoredDataForSelection(clienteId, petId);
    resetConsultaState();
    updateConsultaAgendaCard();

    if (hasSelection) {
      const eventPayload = buildAtendimentoEventPayload({
        scope: 'atendimento',
        action: 'limpar',
      });
      emitFichaClinicaUpdate(eventPayload).catch(() => {});
    }

    if (errorMessages.size) {
      if (errorMessages.size === 1) {
        notify([...errorMessages][0], 'warning');
      } else {
        console.warn('limparConsultaAtual errors:', [...errorMessages]);
        notify('Alguns registros não puderam ser removidos. Verifique e tente novamente.', 'warning');
      }
    } else {
      notify('Registros da consulta atual foram limpos.', 'info');
    }
  } catch (error) {
    console.error('limparConsultaAtual', error);
    notify(error?.message || 'Erro ao limpar os registros da consulta.', 'error');
  } finally {
    isProcessingLimpeza = false;
    setLimparConsultaProcessing(false);
  }
}

export async function colocarAtendimentoEmEspera() {
  if (isProcessingColocarEmEspera) return;

  const clienteId = normalizeId(state.selectedCliente?._id);
  const petId = normalizeId(state.selectedPetId);
  const appointmentId = normalizeId(state.agendaContext?.appointmentId);

  if (!(clienteId && petId)) {
    notify('Selecione um tutor e um pet antes de colocar o atendimento em espera.', 'warning');
    return;
  }

  if (!appointmentId) {
    notify('Abra a ficha pela agenda para colocar o atendimento em espera.', 'warning');
    return;
  }

  const status = String(state.agendaContext?.status || '').toLowerCase();
  if (status !== 'em_atendimento') {
    notify('Inicie o atendimento para colocá-lo em espera.', 'warning');
    return;
  }

  if (isConsultaLockedForCurrentUser()) {
    notify('Apenas o veterinário responsável pode colocar este atendimento em espera.', 'warning');
    return;
  }

  const confirmed = await confirmWithModal({
    title: 'Colocar em espera',
    message:
      'Colocar o atendimento em espera? Ele retornará para a fila de espera e as ações ficarão bloqueadas até ser retomado.',
    confirmText: 'Colocar em espera',
    cancelText: 'Cancelar',
  });
  if (!confirmed) return;

  isProcessingColocarEmEspera = true;
  setColocarEmEsperaProcessing(true);

  try {
    const response = await api(`/func/agendamentos/${appointmentId}`, {
      method: 'PUT',
      body: JSON.stringify({ status: 'em_espera' }),
    });
    const data = await response.json().catch(() => (response.ok ? {} : {}));
    if (!response.ok) {
      const message = typeof data?.message === 'string'
        ? data.message
        : 'Erro ao atualizar status do agendamento.';
      throw new Error(message);
    }

    if (!state.agendaContext || typeof state.agendaContext !== 'object') {
      state.agendaContext = {};
    }

    state.agendaContext.status = 'em_espera';

    if (Array.isArray(data?.servicos)) {
      state.agendaContext.servicos = data.servicos;
      state.agendaContext.totalServicos = data.servicos.length;
    } else if (Array.isArray(state.agendaContext.servicos)) {
      state.agendaContext.totalServicos = state.agendaContext.servicos.length;
    } else if (state.agendaContext) {
      delete state.agendaContext.totalServicos;
    }

    if (data?.valor !== undefined) {
      const valor = Number(data.valor);
      if (!Number.isNaN(valor)) {
        state.agendaContext.valor = valor;
      }
    }

    if (typeof data?.profissional === 'string') {
      state.agendaContext.profissionalNome = data.profissional;
    } else if (typeof data?.profissionalNome === 'string') {
      state.agendaContext.profissionalNome = data.profissionalNome;
    }

    persistAgendaContext(state.agendaContext);

    await loadWaitingAppointments({ force: true });
    updateConsultaAgendaCard();

    const eventPayload = buildAtendimentoEventPayload({
      scope: 'atendimento',
      action: 'espera',
    });
    emitFichaClinicaUpdate(eventPayload).catch(() => {});

    notify('Atendimento retornou para a fila de espera.', 'success');
  } catch (error) {
    console.error('colocarAtendimentoEmEspera', error);
    notify(error.message || 'Erro ao colocar atendimento em espera.', 'error');
  } finally {
    isProcessingColocarEmEspera = false;
    setColocarEmEsperaProcessing(false);
  }
}

export async function finalizarAtendimento() {
  if (isProcessingFinalizacao) return;
  const clienteId = normalizeId(state.selectedCliente?._id);
  const petId = normalizeId(state.selectedPetId);
  const appointmentId = normalizeId(state.agendaContext?.appointmentId);
  if (!(clienteId && petId)) {
    notify('Selecione um tutor e um pet antes de finalizar o atendimento.', 'warning');
    return;
  }
  if (!appointmentId) {
    notify('Abra a ficha pela agenda para finalizar o atendimento.', 'warning');
    return;
  }

  if (isConsultaLockedForCurrentUser()) {
    notify('Apenas o veterinário responsável pode finalizar este atendimento.', 'warning');
    return;
  }

  const entry = buildHistoricoEntryFromState();
  if (!entry) {
    notify('Não foi possível coletar os dados do atendimento atual.', 'error');
    return;
  }

  const confirmed = await confirmWithModal({
    title: 'Finalizar atendimento',
    message: 'Finalizar o atendimento? Os registros serão movidos para o histórico.',
    confirmText: 'Finalizar',
    cancelText: 'Cancelar',
  });
  if (!confirmed) return;

  isProcessingFinalizacao = true;
  if (els.finalizarAtendimentoBtn) {
    els.finalizarAtendimentoBtn.disabled = true;
    els.finalizarAtendimentoBtn.classList.add('opacity-60', 'cursor-not-allowed');
  }

  try {
    const response = await api(`/func/agendamentos/${appointmentId}`, {
      method: 'PUT',
      body: JSON.stringify({ status: 'finalizado' }),
    });
    const data = await response.json().catch(() => (response.ok ? {} : {}));
    if (!response.ok) {
      const message = typeof data?.message === 'string' ? data.message : 'Erro ao atualizar status do agendamento.';
      throw new Error(message);
    }

    if (!state.agendaContext || typeof state.agendaContext !== 'object') {
      state.agendaContext = {};
    }
    state.agendaContext.status = 'finalizado';
    if (data && typeof data === 'object') {
      if (Array.isArray(data.servicos)) {
        state.agendaContext.servicos = data.servicos;
      }
      if (typeof data.valor === 'number') {
        state.agendaContext.valor = Number(data.valor);
      }
      if (data.profissional) {
        state.agendaContext.profissionalNome = data.profissional;
      }
    }
    if (entry && entry.agenda && typeof entry.agenda === 'object') {
      entry.agenda.status = data?.status || 'finalizado';
      if (Array.isArray(data?.servicos)) {
        entry.agenda.servicos = data.servicos;
      }
      if (typeof data?.valor === 'number') {
        entry.agenda.valor = Number(data.valor);
      }
      if (data?.profissional) {
        entry.agenda.profissionalNome = data.profissional;
      }
    }
    persistAgendaContext(state.agendaContext);

    let savedEntry = null;
    try {
      savedEntry = await persistHistoricoEntry(entry);
    } catch (persistError) {
      console.error('persistHistoricoEntry', persistError);
      notify(persistError.message || 'Não foi possível sincronizar o histórico do atendimento.', 'warning');
      savedEntry = entry;
    }

    addHistoricoEntry(savedEntry);

    clearLocalStoredDataForSelection(clienteId, petId);
    resetConsultaState();

    state.activeMainTab = 'historico';
    updateMainTabLayout();
    renderHistoricoArea();
    updateConsultaAgendaCard();

    const historicoId = normalizeId(
      (savedEntry && (savedEntry.id || savedEntry._id)) || (entry && (entry.id || entry._id)),
    );
    const historicoSnapshot = deepClone(savedEntry || entry) || savedEntry || entry || null;
    const eventPayload = buildAtendimentoEventPayload({
      scope: 'atendimento',
      action: 'finalizar',
      historicoId: historicoId || null,
      finalizadoEm: (savedEntry || entry)?.finalizadoEm || new Date().toISOString(),
      ...(historicoSnapshot ? { historico: historicoSnapshot } : {}),
    });
    emitFichaClinicaUpdate(eventPayload).catch(() => {});

    notify('Atendimento finalizado com sucesso.', 'success');
  } catch (error) {
    console.error('finalizarAtendimento', error);
    notify(error.message || 'Erro ao finalizar atendimento.', 'error');
  } finally {
    isProcessingFinalizacao = false;
    if (els.finalizarAtendimentoBtn) {
      els.finalizarAtendimentoBtn.disabled = false;
      els.finalizarAtendimentoBtn.classList.remove('opacity-60', 'cursor-not-allowed');
    }
  }
}

async function reopenHistoricoEntry(entry, closeModal) {
  if (!entry) return;
  const clienteId = normalizeId(entry.clienteId);
  const petId = normalizeId(entry.petId);
  const appointmentId = normalizeId(entry.appointmentId);
  const entryId = normalizeId(entry.id || entry._id || entry.key);
  if (!(clienteId && petId && appointmentId)) {
    notify('Não foi possível identificar o atendimento selecionado.', 'error');
    return;
  }

  const confirmed = await confirmWithModal({
    title: 'Reabrir atendimento',
    message: 'Reabrir o atendimento para edição? Ele retornará para a aba Consulta.',
    confirmText: 'Reabrir',
    cancelText: 'Cancelar',
  });
  if (!confirmed) return;

  let statusUpdated = false;

  try {
    const response = await api(`/func/agendamentos/${appointmentId}`, {
      method: 'PUT',
      body: JSON.stringify({ status: 'em_atendimento' }),
    });
    const data = await response.json().catch(() => (response.ok ? {} : {}));
    if (!response.ok) {
      const message = typeof data?.message === 'string' ? data.message : 'Erro ao atualizar status do agendamento.';
      throw new Error(message);
    }

    statusUpdated = true;

    if (entryId) {
      const deleteResponse = await api(`/func/vet/historicos/${entryId}`, {
        method: 'DELETE',
      });
      const deleteData = await deleteResponse.json().catch(() => (deleteResponse.ok ? {} : {}));
      if (!deleteResponse.ok && deleteResponse.status !== 404) {
        const message = typeof deleteData?.message === 'string'
          ? deleteData.message
          : 'Erro ao remover histórico do atendimento.';
        throw new Error(message);
      }
    }

    removeHistoricoEntry(entryId || entry.id);

    state.consultas = Array.isArray(entry.consultas) ? entry.consultas : [];
    state.vacinas = Array.isArray(entry.vacinas) ? entry.vacinas : [];
    state.anexos = Array.isArray(entry.anexos) ? entry.anexos : [];
    state.exames = Array.isArray(entry.exames) ? entry.exames : [];
    state.pesos = Array.isArray(entry.pesos) ? entry.pesos : [];
    state.observacoes = Array.isArray(entry.observacoes) ? entry.observacoes : [];
    state.documentos = Array.isArray(entry.documentos) ? entry.documentos : [];
    state.receitas = Array.isArray(entry.receitas) ? entry.receitas : [];

    persistLocalDataForSelection(clienteId, petId);

    const agendaSnapshot = entry.agenda && typeof entry.agenda === 'object' ? { ...entry.agenda } : {};
    if (!state.agendaContext || typeof state.agendaContext !== 'object') {
      state.agendaContext = {};
    }
    state.agendaContext = {
      ...agendaSnapshot,
      ...state.agendaContext,
      status: 'em_atendimento',
      appointmentId,
    };
    persistAgendaContext(state.agendaContext);

    state.activeMainTab = 'consulta';
    updateMainTabLayout();
    updateConsultaAgendaCard();
    renderHistoricoArea();
    await loadVendasFromServer({ force: true });

    if (typeof closeModal === 'function') {
      closeModal();
    }

    const reopenSnapshot = deepClone(entry) || entry || null;
    const eventPayload = buildAtendimentoEventPayload({
      scope: 'atendimento',
      action: 'reabrir',
      historicoId: entryId || entry.id || null,
      ...(reopenSnapshot ? { reopened: reopenSnapshot } : {}),
    });
    emitFichaClinicaUpdate(eventPayload).catch(() => {});

    notify('Atendimento reaberto para edição.', 'success');
  } catch (error) {
    if (statusUpdated) {
      try {
        await api(`/func/agendamentos/${appointmentId}`, {
          method: 'PUT',
          body: JSON.stringify({ status: 'finalizado' }),
        });
      } catch (rollbackError) {
        console.error('rollbackReopenHistoricoEntry', rollbackError);
      }
    }
    console.error('reopenHistoricoEntry', error);
    notify(error.message || 'Erro ao reabrir atendimento.', 'error');
  }
}

export async function reopenCurrentAgendamento() {
  if (!isAdminRole()) {
    notify('Apenas administradores podem reabrir atendimentos finalizados.', 'warning');
    return;
  }

  const appointmentId = normalizeId(state.agendaContext?.appointmentId);
  if (!appointmentId) {
    notify('Nenhum agendamento finalizado selecionado para reabrir.', 'warning');
    return;
  }

  const entry = findHistoricoEntryByAppointmentId(appointmentId);
  if (!entry) {
    if (state.historicosLoading) {
      notify('Aguarde o carregamento do histórico para reabrir o atendimento.', 'info');
    } else {
      notify('Não foi possível localizar o histórico deste atendimento.', 'warning');
    }
    return;
  }

  await reopenHistoricoEntry(entry);
}

setHistoricoReopenHandler((entry, closeModal) => {
  const fullEntry = typeof entry === 'string' ? getHistoricoEntryById(entry) : entry;
  return reopenHistoricoEntry(fullEntry || getHistoricoEntryById(entry?.id), closeModal);
});

export function handleAtendimentoRealTimeEvent(event = {}) {
  if (!event || typeof event !== 'object') return false;
  if (event.scope && event.scope !== 'atendimento') return false;

  const action = String(event.action || '').toLowerCase();
  if (!action) return false;

  const targetClienteId = normalizeId(event.clienteId || event.tutorId || event.cliente);
  const targetPetId = normalizeId(event.petId || event.pet);
  const targetAppointmentId = normalizeId(event.appointmentId || event.agendamentoId || event.appointment);

  const currentClienteId = normalizeId(state.selectedCliente?._id);
  const currentPetId = normalizeId(state.selectedPetId);
  const currentAppointmentId = normalizeId(state.agendaContext?.appointmentId);

  if (targetClienteId && currentClienteId && targetClienteId !== currentClienteId) return false;
  if (targetPetId && currentPetId && targetPetId !== currentPetId) return false;
  if (targetAppointmentId && currentAppointmentId && targetAppointmentId !== currentAppointmentId) return false;

  if (action === 'finalizar') {
    if (!state.agendaContext || typeof state.agendaContext !== 'object') {
      state.agendaContext = {};
    }
    if (targetAppointmentId) {
      state.agendaContext.appointmentId = targetAppointmentId;
    }
    const status = String(event.agendaStatus || 'finalizado');
    state.agendaContext.status = status;

    if (Array.isArray(event.agendaServicos)) {
      const servicos = deepClone(event.agendaServicos) || [...event.agendaServicos];
      state.agendaContext.servicos = servicos;
      state.agendaContext.totalServicos = servicos.length;
    }

    if (event.agendaValor !== undefined) {
      const valor = Number(event.agendaValor);
      if (!Number.isNaN(valor)) {
        state.agendaContext.valor = valor;
      }
    }

    if (event.agendaProfissional !== undefined) {
      state.agendaContext.profissionalNome = event.agendaProfissional || '';
    }

    if (event.finalizadoEm) {
      state.agendaContext.finalizadoEm = event.finalizadoEm;
    }

    persistAgendaContext(state.agendaContext);

    const clienteId = targetClienteId || currentClienteId;
    const petId = targetPetId || currentPetId;
    if (clienteId && petId) {
      clearLocalStoredDataForSelection(clienteId, petId);
    }
    resetConsultaState();

    const historicoEntry = event.historico || event.historicoEntry || event.historicoSnapshot;
    if (historicoEntry) {
      addHistoricoEntry(historicoEntry);
    }

    state.activeMainTab = 'historico';
    updateMainTabLayout();
    renderHistoricoArea();
    updateConsultaAgendaCard();
    notify('O atendimento foi finalizado por outro usuário.', 'info');
    return true;
  }

  if (action === 'reabrir') {
    if (!state.agendaContext || typeof state.agendaContext !== 'object') {
      state.agendaContext = {};
    }
    if (targetAppointmentId) {
      state.agendaContext.appointmentId = targetAppointmentId;
    }
    const status = String(event.agendaStatus || 'em_atendimento');
    state.agendaContext.status = status;

    if (Array.isArray(event.agendaServicos)) {
      const servicos = deepClone(event.agendaServicos) || [...event.agendaServicos];
      state.agendaContext.servicos = servicos;
      state.agendaContext.totalServicos = servicos.length;
    }

    if (event.agendaValor !== undefined) {
      const valor = Number(event.agendaValor);
      if (!Number.isNaN(valor)) {
        state.agendaContext.valor = valor;
      }
    }

    if (event.agendaProfissional !== undefined) {
      state.agendaContext.profissionalNome = event.agendaProfissional || '';
    }

    persistAgendaContext(state.agendaContext);

    const historicoId = normalizeId(event.historicoId || event.historico?.id || event.historico?._id);
    if (historicoId) {
      removeHistoricoEntry(historicoId);
    }

    const clienteId = targetClienteId || currentClienteId;
    const petId = targetPetId || currentPetId;

    const reopenedSnapshot =
      deepClone(event.reopened || event.historico || event.historicoEntry) ||
      event.reopened ||
      event.historico ||
      event.historicoEntry ||
      null;

    if (reopenedSnapshot && typeof reopenedSnapshot === 'object') {
      state.consultas = Array.isArray(reopenedSnapshot.consultas) ? reopenedSnapshot.consultas : [];
      state.vacinas = Array.isArray(reopenedSnapshot.vacinas) ? reopenedSnapshot.vacinas : [];
      state.anexos = Array.isArray(reopenedSnapshot.anexos) ? reopenedSnapshot.anexos : [];
      state.exames = Array.isArray(reopenedSnapshot.exames) ? reopenedSnapshot.exames : [];
      state.pesos = Array.isArray(reopenedSnapshot.pesos) ? reopenedSnapshot.pesos : [];
      state.observacoes = Array.isArray(reopenedSnapshot.observacoes) ? reopenedSnapshot.observacoes : [];
      state.documentos = Array.isArray(reopenedSnapshot.documentos) ? reopenedSnapshot.documentos : [];
      state.receitas = Array.isArray(reopenedSnapshot.receitas) ? reopenedSnapshot.receitas : [];

      if (clienteId && petId) {
        persistLocalDataForSelection(clienteId, petId);
      }
    } else {
      resetConsultaState();
    }

    state.activeMainTab = 'consulta';
    updateMainTabLayout();
    renderHistoricoArea();
    updateConsultaAgendaCard();
    notify('O atendimento foi reaberto por outro usuário.', 'info');
    return true;
  }

  if (action === 'espera') {
    if (!state.agendaContext || typeof state.agendaContext !== 'object') {
      state.agendaContext = targetAppointmentId ? { appointmentId: targetAppointmentId } : {};
    } else if (targetAppointmentId) {
      state.agendaContext.appointmentId = targetAppointmentId;
    }

    if (targetClienteId) {
      state.agendaContext.tutorId = targetClienteId;
    }
    if (targetPetId) {
      state.agendaContext.petId = targetPetId;
    }

    const status = String(event.agendaStatus || 'em_espera');
    state.agendaContext.status = status;

    if (Array.isArray(event.agendaServicos)) {
      const servicos = deepClone(event.agendaServicos) || [...event.agendaServicos];
      state.agendaContext.servicos = servicos;
      state.agendaContext.totalServicos = servicos.length;
    } else if (state.agendaContext) {
      if (Array.isArray(state.agendaContext.servicos)) {
        state.agendaContext.totalServicos = state.agendaContext.servicos.length;
      } else {
        delete state.agendaContext.totalServicos;
      }
    }

    if (event.agendaValor !== undefined) {
      const valor = Number(event.agendaValor);
      if (!Number.isNaN(valor)) {
        state.agendaContext.valor = valor;
      }
    }

    if (event.agendaProfissional !== undefined) {
      state.agendaContext.profissionalNome = event.agendaProfissional || '';
    }

    persistAgendaContext(state.agendaContext);

    loadWaitingAppointments({ force: true }).catch(() => {});
    updateConsultaAgendaCard();

    notify('O atendimento foi colocado em espera por outro usuário.', 'info');
    return true;
  }

  if (action === 'limpar') {
    if (!state.agendaContext || typeof state.agendaContext !== 'object') {
      state.agendaContext = targetAppointmentId ? { appointmentId: targetAppointmentId } : {};
    } else if (targetAppointmentId) {
      state.agendaContext.appointmentId = targetAppointmentId;
    }

    if (targetClienteId) {
      state.agendaContext.tutorId = targetClienteId;
    }
    if (targetPetId) {
      state.agendaContext.petId = targetPetId;
    }

    if (event.agendaStatus !== undefined) {
      state.agendaContext.status = String(event.agendaStatus);
    }

    if (Array.isArray(event.agendaServicos)) {
      const servicos = deepClone(event.agendaServicos) || [...event.agendaServicos];
      state.agendaContext.servicos = servicos;
      state.agendaContext.totalServicos = servicos.length;
    } else if (state.agendaContext) {
      if (Array.isArray(state.agendaContext.servicos)) {
        state.agendaContext.totalServicos = state.agendaContext.servicos.length;
      } else {
        delete state.agendaContext.totalServicos;
      }
    }

    if (event.agendaValor !== undefined) {
      const valor = Number(event.agendaValor);
      if (!Number.isNaN(valor)) {
        state.agendaContext.valor = valor;
      }
    }

    if (event.agendaProfissional !== undefined) {
      state.agendaContext.profissionalNome = event.agendaProfissional || '';
    }

    persistAgendaContext(state.agendaContext);

    const clienteId = targetClienteId || currentClienteId;
    const petId = targetPetId || currentPetId;
    if (clienteId && petId) {
      clearLocalStoredDataForSelection(clienteId, petId);
    }
    resetConsultaState();
    updateConsultaAgendaCard();
    notify('Os registros da consulta foram limpos por outro usuário.', 'info');
    return true;
  }

  return false;
}

export function initAtendimentoActions() {
  if (els.colocarEmEsperaBtn) {
    if (!els.colocarEmEsperaBtn.dataset.idleLabel) {
      const idleText = (els.colocarEmEsperaBtn.textContent || '').trim() || 'Colocar em espera';
      els.colocarEmEsperaBtn.dataset.idleLabel = idleText;
    }
    els.colocarEmEsperaBtn.addEventListener('click', (event) => {
      event.preventDefault();
      const result = colocarAtendimentoEmEspera();
      if (result && typeof result.then === 'function') {
        result.catch(() => {});
      }
    });
  }
  if (els.iniciarAtendimentoBtn) {
    els.iniciarAtendimentoBtn.addEventListener('click', (event) => {
      event.preventDefault();
      openIniciarAtendimentoModal();
    });
  }
  if (els.finalizarAtendimentoBtn) {
    els.finalizarAtendimentoBtn.addEventListener('click', (event) => {
      event.preventDefault();
      finalizarAtendimento();
    });
  }
  if (els.limparConsultaBtn) {
    els.limparConsultaBtn.addEventListener('click', (event) => {
      event.preventDefault();
      const result = limparConsultaAtual();
      if (result && typeof result.then === 'function') {
        result.catch(() => {});
      }
    });
  }
}

export function activateHistoricoTab() {
  setActiveMainTab('historico');
  renderHistoricoArea();
}

export function activateConsultaTab() {
  setActiveMainTab('consulta');
  updateConsultaAgendaCard();
}
