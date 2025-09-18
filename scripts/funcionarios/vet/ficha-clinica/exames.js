// Exame modal and state handling for the Vet ficha clínica
import {
  state,
  api,
  notify,
  debounce,
  pickFirst,
  normalizeId,
  normalizeForCompare,
  formatMoney,
  exameModal,
  EXAME_STORAGE_PREFIX,
  getAgendaStoreId,
  getPetPriceCriteria,
  persistAgendaContext,
} from './core.js';
import { getConsultasKey, ensureTutorAndPetSelected, updateConsultaAgendaCard } from './consultas.js';

const MIN_SEARCH_TERM_LENGTH = 2;

function generateExameId() {
  return `exm-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

function getExameStorageKey(clienteId, petId) {
  const base = getConsultasKey(clienteId, petId);
  return base ? `${EXAME_STORAGE_PREFIX}${base}` : null;
}

function normalizeExameRecord(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const servicoId = normalizeId(raw.servicoId || raw.servico || raw.serviceId);
  if (!servicoId) return null;

  const id = normalizeId(raw.id || raw._id) || generateExameId();
  const nome = pickFirst(raw.servicoNome, raw.nome, raw.serviceName) || '';
  const valorCandidate = Number(raw.valor || raw.valorUnitario || raw.valorTotal || 0);
  const valor = Number.isFinite(valorCandidate) ? valorCandidate : 0;
  const observacao = typeof raw.observacao === 'string' ? raw.observacao.trim() : '';
  let createdAt = null;
  if (raw.createdAt) {
    const date = new Date(raw.createdAt);
    if (!Number.isNaN(date.getTime())) {
      createdAt = date.toISOString();
    }
  }
  if (!createdAt) {
    createdAt = new Date().toISOString();
  }

  return {
    id,
    servicoId,
    servicoNome: nome,
    valor,
    observacao,
    createdAt,
  };
}

function persistExamesForSelection() {
  const key = getExameStorageKey(state.selectedCliente?._id, state.selectedPetId);
  if (!key) return;
  try {
    if (Array.isArray(state.exames) && state.exames.length) {
      localStorage.setItem(key, JSON.stringify(state.exames));
      state.examesLoadKey = key;
    } else {
      localStorage.removeItem(key);
      state.examesLoadKey = key;
    }
  } catch {
    // ignore persistence errors
  }
}

export function loadExamesForSelection() {
  const key = getExameStorageKey(state.selectedCliente?._id, state.selectedPetId);
  if (!key) {
    state.exames = [];
    state.examesLoadKey = null;
    return;
  }
  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      state.exames = [];
      state.examesLoadKey = key;
      return;
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      state.exames = [];
      state.examesLoadKey = key;
      return;
    }
    const normalized = parsed.map(normalizeExameRecord).filter(Boolean);
    normalized.sort((a, b) => {
      const aTime = a?.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bTime = b?.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bTime - aTime;
    });
    state.exames = normalized;
    state.examesLoadKey = key;
  } catch {
    state.exames = [];
    state.examesLoadKey = key;
  }
}

function hideExameSuggestions() {
  if (exameModal.suggestionsEl) {
    exameModal.suggestionsEl.innerHTML = '';
    exameModal.suggestionsEl.classList.add('hidden');
  }
}

function updateExamePriceDisplay() {
  if (!exameModal.priceDisplay) return;
  const service = exameModal.selectedService;
  if (!service) {
    exameModal.priceDisplay.textContent = 'Selecione um exame para ver o valor.';
    return;
  }
  const valor = Number(service.valor || 0);
  exameModal.priceDisplay.textContent = `Valor do exame: ${formatMoney(valor)}`;
}

function setExameModalSubmitting(isSubmitting) {
  exameModal.isSubmitting = !!isSubmitting;
  if (exameModal.submitBtn) {
    exameModal.submitBtn.disabled = !!isSubmitting;
    exameModal.submitBtn.classList.toggle('opacity-60', !!isSubmitting);
    exameModal.submitBtn.classList.toggle('cursor-not-allowed', !!isSubmitting);
    exameModal.submitBtn.textContent = isSubmitting ? 'Salvando...' : 'Salvar';
  }
  if (exameModal.cancelBtn) {
    exameModal.cancelBtn.disabled = !!isSubmitting;
    exameModal.cancelBtn.classList.toggle('opacity-50', !!isSubmitting);
    exameModal.cancelBtn.classList.toggle('cursor-not-allowed', !!isSubmitting);
  }
  if (exameModal.closeBtn) {
    exameModal.closeBtn.disabled = !!isSubmitting;
    exameModal.closeBtn.classList.toggle('opacity-50', !!isSubmitting);
    exameModal.closeBtn.classList.toggle('cursor-not-allowed', !!isSubmitting);
  }
}

function ensureExameModal() {
  if (exameModal.overlay) return exameModal;

  const overlay = document.createElement('div');
  overlay.id = 'vet-exame-modal';
  overlay.className = 'hidden fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4';
  overlay.setAttribute('aria-hidden', 'true');

  const dialog = document.createElement('div');
  dialog.className = 'w-full max-w-2xl rounded-xl bg-white shadow-xl focus:outline-none';
  dialog.tabIndex = -1;
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  overlay.appendChild(dialog);

  const form = document.createElement('form');
  form.className = 'flex flex-col gap-6 p-6';
  dialog.appendChild(form);

  const header = document.createElement('div');
  header.className = 'flex items-start justify-between gap-3';
  form.appendChild(header);

  const title = document.createElement('h2');
  title.className = 'text-lg font-semibold text-gray-800';
  title.textContent = 'Novo exame';
  header.appendChild(title);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'text-gray-400 transition hover:text-gray-600';
  closeBtn.innerHTML = '<i class="fas fa-xmark"></i>';
  header.appendChild(closeBtn);

  const contextInfo = document.createElement('div');
  contextInfo.className = 'hidden rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700';
  form.appendChild(contextInfo);

  const fieldsWrapper = document.createElement('div');
  fieldsWrapper.className = 'grid gap-4';
  form.appendChild(fieldsWrapper);

  const serviceWrapper = document.createElement('div');
  serviceWrapper.className = 'flex flex-col gap-2';
  fieldsWrapper.appendChild(serviceWrapper);

  const serviceLabel = document.createElement('label');
  serviceLabel.className = 'text-sm font-medium text-gray-700';
  serviceLabel.textContent = 'Exame';
  serviceWrapper.appendChild(serviceLabel);

  const serviceInputWrapper = document.createElement('div');
  serviceInputWrapper.className = 'relative';
  serviceWrapper.appendChild(serviceInputWrapper);

  const serviceInput = document.createElement('input');
  serviceInput.type = 'text';
  serviceInput.name = 'exameServico';
  serviceInput.placeholder = 'Pesquise o exame pelo nome';
  serviceInput.autocomplete = 'off';
  serviceInput.className = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:border-rose-500 focus:outline-none focus:ring-2 focus:ring-rose-200';
  serviceInputWrapper.appendChild(serviceInput);

  const suggestions = document.createElement('ul');
  suggestions.className = 'hidden absolute left-0 right-0 top-full mt-2 max-h-56 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg z-10';
  serviceInputWrapper.appendChild(suggestions);

  const priceDisplay = document.createElement('p');
  priceDisplay.className = 'text-xs text-gray-500';
  priceDisplay.textContent = 'Selecione um exame para ver o valor.';
  serviceWrapper.appendChild(priceDisplay);

  const obsWrapper = document.createElement('div');
  obsWrapper.className = 'flex flex-col gap-2';
  fieldsWrapper.appendChild(obsWrapper);

  const obsLabel = document.createElement('label');
  obsLabel.className = 'text-sm font-medium text-gray-700';
  obsLabel.textContent = 'Observações';
  obsWrapper.appendChild(obsLabel);

  const obsTextarea = document.createElement('textarea');
  obsTextarea.rows = 4;
  obsTextarea.name = 'exameObservacao';
  obsTextarea.placeholder = 'Descreva informações adicionais, se necessário';
  obsTextarea.className = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:border-rose-500 focus:outline-none focus:ring-2 focus:ring-rose-200';
  obsWrapper.appendChild(obsTextarea);

  const footer = document.createElement('div');
  footer.className = 'flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:items-center sm:justify-end sm:gap-3';
  form.appendChild(footer);

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'w-full rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 sm:w-auto';
  cancelBtn.textContent = 'Cancelar';
  footer.appendChild(cancelBtn);

  const submitBtn = document.createElement('button');
  submitBtn.type = 'submit';
  submitBtn.className = 'w-full rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700 focus:outline-none focus:ring-2 focus:ring-rose-400 sm:w-auto';
  submitBtn.textContent = 'Salvar';
  footer.appendChild(submitBtn);

  const debouncedSearch = debounce((value) => searchExameServices(value), 300);
  serviceInput.addEventListener('input', (event) => {
    debouncedSearch(event.target.value);
  });
  serviceInput.addEventListener('focus', (event) => {
    const value = String(event.target.value || '').trim();
    if (value.length >= MIN_SEARCH_TERM_LENGTH) {
      searchExameServices(value);
    }
  });
  serviceInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !exameModal.selectedService) {
      event.preventDefault();
    }
  });
  serviceInput.addEventListener('blur', () => {
    setTimeout(() => hideExameSuggestions(), 150);
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    await handleExameSubmit();
  });

  closeBtn.addEventListener('click', (event) => {
    event.preventDefault();
    closeExameModal();
  });

  cancelBtn.addEventListener('click', (event) => {
    event.preventDefault();
    closeExameModal();
  });

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) {
      event.preventDefault();
      closeExameModal();
    }
  });

  document.body.appendChild(overlay);

  exameModal.overlay = overlay;
  exameModal.dialog = dialog;
  exameModal.form = form;
  exameModal.submitBtn = submitBtn;
  exameModal.cancelBtn = cancelBtn;
  exameModal.closeBtn = closeBtn;
  exameModal.titleEl = title;
  exameModal.contextInfo = contextInfo;
  exameModal.suggestionsEl = suggestions;
  exameModal.priceDisplay = priceDisplay;
  exameModal.fields = {
    servico: serviceInput,
    observacao: obsTextarea,
  };

  return exameModal;
}

export function closeExameModal() {
  if (!exameModal.overlay) return;
  exameModal.overlay.classList.add('hidden');
  exameModal.overlay.setAttribute('aria-hidden', 'true');
  if (exameModal.form) exameModal.form.reset();
  exameModal.selectedService = null;
  updateExamePriceDisplay();
  hideExameSuggestions();
  setExameModalSubmitting(false);
  if (exameModal.searchAbortController) {
    try { exameModal.searchAbortController.abort(); } catch { }
    exameModal.searchAbortController = null;
  }
  if (exameModal.keydownHandler) {
    document.removeEventListener('keydown', exameModal.keydownHandler);
    exameModal.keydownHandler = null;
  }
}

function isExameServiceCandidate(service) {
  if (!service) return false;
  const categorias = [];
  if (Array.isArray(service.categorias)) categorias.push(...service.categorias);
  if (Array.isArray(service.category)) categorias.push(...service.category);
  if (service.categoria) categorias.push(service.categoria);
  const hasCategory = categorias.some((cat) => {
    const norm = normalizeForCompare(cat);
    return norm === 'exame' || norm === 'exames';
  });
  if (hasCategory) return true;
  const nomeNorm = normalizeForCompare(service.nome || '');
  if (nomeNorm.includes('exame')) return true;
  if (service?.grupo?.nome) {
    const groupNorm = normalizeForCompare(service.grupo.nome);
    if (groupNorm.includes('exame')) return true;
  }
  return false;
}

async function fetchServicePrice(serviceId) {
  const storeId = getAgendaStoreId();
  if (!serviceId || !storeId) return null;
  const petId = normalizeId(state.selectedPetId);
  const params = new URLSearchParams({ serviceId, storeId });
  if (petId) params.set('petId', petId);
  const { tipo, raca } = getPetPriceCriteria();
  if (tipo) params.set('tipo', tipo);
  if (raca) params.set('raca', raca);
  try {
    const resp = await api(`/func/servicos/preco?${params.toString()}`);
    if (!resp.ok) return null;
    const data = await resp.json().catch(() => null);
    if (!data || typeof data.valor !== 'number') return null;
    return Number(data.valor || 0);
  } catch {
    return null;
  }
}

async function selectExameService(service) {
  if (!service || !service._id) return;
  ensureExameModal();
  exameModal.selectedService = {
    _id: service._id,
    nome: service.nome || '',
    valor: Number(service.valor || 0),
  };
  if (exameModal.fields?.servico) {
    exameModal.fields.servico.value = service.nome || '';
  }
  hideExameSuggestions();
  updateExamePriceDisplay();
  try {
    const price = await fetchServicePrice(service._id);
    if (price != null) {
      exameModal.selectedService.valor = Number(price);
      updateExamePriceDisplay();
    }
  } catch {
    // ignore price fetch failures
  }
}

async function searchExameServices(term) {
  const query = String(term || '').trim();
  if (!exameModal.suggestionsEl) return;
  if (query.length < MIN_SEARCH_TERM_LENGTH) {
    hideExameSuggestions();
    return;
  }

  if (exameModal.searchAbortController) {
    try { exameModal.searchAbortController.abort(); } catch { }
  }
  const controller = new AbortController();
  exameModal.searchAbortController = controller;

  try {
    const params = new URLSearchParams({ q: query, limit: '8' });
    const resp = await api(`/func/servicos/buscar?${params.toString()}`, { signal: controller.signal });
    if (!resp.ok) {
      hideExameSuggestions();
      return;
    }
    const payload = await resp.json().catch(() => []);
    if (controller.signal.aborted) return;
    const list = Array.isArray(payload) ? payload : [];
    const filtered = list.filter(isExameServiceCandidate);
    const normalized = filtered
      .map((svc) => ({
        _id: normalizeId(svc._id),
        nome: pickFirst(svc.nome),
        valor: Number(svc.valor || 0),
      }))
      .filter((svc) => svc._id && svc.nome);

    if (!normalized.length) {
      hideExameSuggestions();
      return;
    }

    exameModal.suggestionsEl.innerHTML = '';
    normalized.forEach((svc) => {
      const li = document.createElement('li');
      li.className = 'px-3 py-2 hover:bg-gray-50 cursor-pointer';
      li.dataset.serviceId = svc._id;

      const nameEl = document.createElement('div');
      nameEl.className = 'font-medium text-gray-900';
      nameEl.textContent = svc.nome;
      li.appendChild(nameEl);

      const priceEl = document.createElement('div');
      priceEl.className = 'text-xs text-gray-500';
      priceEl.textContent = formatMoney(Number(svc.valor || 0));
      li.appendChild(priceEl);

      svc.priceEl = priceEl;

      li.addEventListener('click', async () => {
        await selectExameService(svc);
      });

      exameModal.suggestionsEl.appendChild(li);
    });
    exameModal.suggestionsEl.classList.remove('hidden');

    const storeId = getAgendaStoreId({ persist: false });
    if (storeId) {
      const petId = normalizeId(state.selectedPetId);
      const { tipo, raca } = getPetPriceCriteria();
      normalized.forEach((svc) => {
        const params = new URLSearchParams({ serviceId: svc._id, storeId });
        if (petId) params.set('petId', petId);
        if (tipo) params.set('tipo', tipo);
        if (raca) params.set('raca', raca);
        api(`/func/servicos/preco?${params.toString()}`, { signal: controller.signal })
          .then((res) => (res && res.ok ? res.json().catch(() => null) : null))
          .then((data) => {
            if (!data || typeof data.valor !== 'number' || controller.signal.aborted) return;
            const price = Number(data.valor || 0);
            svc.valor = price;
            if (svc.priceEl) {
              svc.priceEl.textContent = formatMoney(price);
            }
          })
          .catch((err) => {
            if (!err || err.name !== 'AbortError') {
              // ignore other failures silently
            }
          });
      });
    }
  } catch (error) {
    if (!controller.signal.aborted) {
      hideExameSuggestions();
    }
  } finally {
    if (exameModal.searchAbortController === controller) {
      exameModal.searchAbortController = null;
    }
  }
}

async function handleExameSubmit() {
  const modal = ensureExameModal();
  if (modal.isSubmitting) return;

  if (!ensureTutorAndPetSelected()) {
    return;
  }

  const appointmentId = normalizeId(state.agendaContext?.appointmentId);
  if (!appointmentId) {
    notify('Abra a ficha pela agenda para registrar exames vinculados a um agendamento.', 'warning');
    return;
  }

  const service = modal.selectedService;
  if (!service || !service._id) {
    notify('Selecione um exame para registrar.', 'warning');
    return;
  }

  const observacao = (modal.fields?.observacao?.value || '').trim();
  let valor = Number(service.valor || 0);
  if (!Number.isFinite(valor) || valor < 0) valor = 0;

  const existingServices = Array.isArray(state.agendaContext?.servicos) ? state.agendaContext.servicos : [];
  const payloadServicos = existingServices
    .map((svc) => {
      const sid = normalizeId(svc._id || svc.id || svc.servicoId || svc.servico);
      if (!sid) return null;
      const valorItem = Number(svc.valor || 0);
      return {
        servicoId: sid,
        valor: Number.isFinite(valorItem) ? valorItem : 0,
      };
    })
    .filter(Boolean);

  payloadServicos.push({ servicoId: service._id, valor });

  const record = {
    id: generateExameId(),
    servicoId: service._id,
    servicoNome: service.nome || '',
    valor,
    observacao,
    createdAt: new Date().toISOString(),
  };

  setExameModalSubmitting(true);

  try {
    const response = await api(`/func/agendamentos/${appointmentId}`, {
      method: 'PUT',
      body: JSON.stringify({ servicos: payloadServicos }),
    });
    const data = await response.json().catch(() => (response.ok ? {} : {}));
    if (!response.ok) {
      const message = typeof data?.message === 'string' ? data.message : 'Erro ao atualizar os serviços do agendamento.';
      throw new Error(message);
    }

    if (!state.agendaContext) state.agendaContext = {};
    if (Array.isArray(data?.servicos)) {
      state.agendaContext.servicos = data.servicos;
    }
    if (typeof data?.valor === 'number') {
      state.agendaContext.valor = Number(data.valor);
    }
    if (Array.isArray(state.agendaContext?.servicos)) {
      state.agendaContext.totalServicos = state.agendaContext.servicos.length;
    }
    persistAgendaContext(state.agendaContext);

    state.exames = [record, ...(Array.isArray(state.exames) ? state.exames : [])];
    persistExamesForSelection();
    updateConsultaAgendaCard();
    closeExameModal();
    notify('Exame registrado com sucesso.', 'success');
  } catch (error) {
    console.error('handleExameSubmit', error);
    notify(error.message || 'Erro ao registrar exame.', 'error');
  } finally {
    setExameModalSubmitting(false);
  }
}

export function openExameModal() {
  if (!ensureTutorAndPetSelected()) {
    return;
  }

  const appointmentId = normalizeId(state.agendaContext?.appointmentId);
  if (!appointmentId) {
    notify('Abra a ficha pela agenda para registrar exames vinculados a um agendamento.', 'warning');
    return;
  }

  const modal = ensureExameModal();
  setExameModalSubmitting(false);
  modal.selectedService = null;
  if (modal.fields?.servico) modal.fields.servico.value = '';
  if (modal.fields?.observacao) modal.fields.observacao.value = '';
  hideExameSuggestions();
  updateExamePriceDisplay();

  if (modal.contextInfo) {
    const tutorNome = pickFirst(
      state.selectedCliente?.nome,
      state.selectedCliente?.nomeCompleto,
      state.selectedCliente?.nomeContato,
      state.selectedCliente?.razaoSocial,
    );
    const petNome = pickFirst(state.petsById?.[state.selectedPetId]?.nome);
    const parts = [];
    if (tutorNome) parts.push(`Tutor: ${tutorNome}`);
    if (petNome) parts.push(`Pet: ${petNome}`);
    modal.contextInfo.textContent = parts.join(' · ');
    modal.contextInfo.classList.toggle('hidden', parts.length === 0);
  }

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
      closeExameModal();
    }
  };
  document.addEventListener('keydown', modal.keydownHandler);

  setTimeout(() => {
    if (modal.fields?.servico) {
      try { modal.fields.servico.focus(); } catch { }
    }
  }, 50);
}
