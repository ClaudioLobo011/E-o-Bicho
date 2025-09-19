// Vacina modal and state handling for the Vet ficha clínica
import {
  state,
  api,
  notify,
  debounce,
  pickFirst,
  normalizeId,
  normalizeForCompare,
  toIsoOrNull,
  formatMoney,
  vacinaModal,
  VACINA_STORAGE_PREFIX,
  getAgendaStoreId,
  getPetPriceCriteria,
  persistAgendaContext,
} from './core.js';
import { getConsultasKey, ensureTutorAndPetSelected, updateConsultaAgendaCard } from './consultas.js';

function getVacinaStorageKey(clienteId, petId) {
  const base = getConsultasKey(clienteId, petId);
  return base ? `${VACINA_STORAGE_PREFIX}${base}` : null;
}

function generateVacinaId() {
  return `vac-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

function normalizeDateInputValue(value) {
  if (!value) return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    try {
      return value.toISOString().slice(0, 10);
    } catch {
      return '';
    }
  }
  const str = String(value || '').trim();
  if (!str) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  const date = new Date(str);
  if (Number.isNaN(date.getTime())) return '';
  try {
    return date.toISOString().slice(0, 10);
  } catch {
    return '';
  }
}

function normalizeVacinaRecord(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const servicoId = normalizeId(raw.servicoId || raw.servico || raw.serviceId);
  if (!servicoId) return null;
  const id = normalizeId(raw.id || raw._id || raw.uid || raw.key) || generateVacinaId();
  const nome = pickFirst(raw.servicoNome, raw.nome, raw.serviceName) || '';
  const quantidadeRaw = Number(raw.quantidade || raw.qty || raw.quant || 0);
  const quantidade = Number.isFinite(quantidadeRaw) && quantidadeRaw > 0
    ? Math.max(1, Math.round(quantidadeRaw))
    : 1;
  let valorUnitario = 0;
  const unitCandidates = [raw.valorUnitario, raw.valorUnit, raw.valor];
  for (const candidate of unitCandidates) {
    const num = Number(candidate);
    if (!Number.isNaN(num) && num > 0) {
      valorUnitario = Number(num);
      break;
    }
  }
  let valorTotal = Number(raw.valorTotal);
  if (!Number.isFinite(valorTotal) || valorTotal <= 0) {
    valorTotal = valorUnitario * quantidade;
  }
  const validade = normalizeDateInputValue(raw.validade || raw.dataValidade);
  const aplicacao = normalizeDateInputValue(raw.aplicacao || raw.dataAplicacao);
  const renovacao = normalizeDateInputValue(raw.renovacao || raw.dataRenovacao);
  const lote = String(raw.lote || raw.loteNumero || '').trim();
  const createdAt = toIsoOrNull(raw.createdAt) || new Date().toISOString();

  return {
    id,
    servicoId,
    servicoNome: nome,
    quantidade,
    valorUnitario,
    valorTotal,
    validade,
    aplicacao,
    renovacao,
    lote,
    createdAt,
  };
}

function persistVacinasForSelection() {
  const key = getVacinaStorageKey(state.selectedCliente?._id, state.selectedPetId);
  if (!key) return;
  try {
    if (Array.isArray(state.vacinas) && state.vacinas.length) {
      localStorage.setItem(key, JSON.stringify(state.vacinas));
    } else {
      localStorage.removeItem(key);
    }
  } catch {
    // ignore persistence errors
  }
}

export function loadVacinasForSelection() {
  const key = getVacinaStorageKey(state.selectedCliente?._id, state.selectedPetId);
  if (!key) {
    state.vacinas = [];
    return;
  }
  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      state.vacinas = [];
      return;
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      state.vacinas = [];
      return;
    }
    const normalized = parsed.map(normalizeVacinaRecord).filter(Boolean);
    normalized.sort((a, b) => {
      const aTime = a?.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bTime = b?.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bTime - aTime;
    });
    state.vacinas = normalized;
  } catch {
    state.vacinas = [];
  }
}

function hideVacinaSuggestions() {
  if (vacinaModal.suggestionsEl) {
    vacinaModal.suggestionsEl.innerHTML = '';
    vacinaModal.suggestionsEl.classList.add('hidden');
  }
}

function setVacinaModalSubmitting(isSubmitting) {
  vacinaModal.isSubmitting = !!isSubmitting;
  if (vacinaModal.submitBtn) {
    vacinaModal.submitBtn.disabled = !!isSubmitting;
    vacinaModal.submitBtn.classList.toggle('opacity-60', !!isSubmitting);
    vacinaModal.submitBtn.classList.toggle('cursor-not-allowed', !!isSubmitting);
    vacinaModal.submitBtn.textContent = isSubmitting ? 'Salvando...' : 'Adicionar';
  }
  if (vacinaModal.cancelBtn) {
    vacinaModal.cancelBtn.disabled = !!isSubmitting;
    vacinaModal.cancelBtn.classList.toggle('opacity-50', !!isSubmitting);
    vacinaModal.cancelBtn.classList.toggle('cursor-not-allowed', !!isSubmitting);
  }
}

function updateVacinaPriceSummary() {
  if (!vacinaModal.priceDisplay) return;
  const service = vacinaModal.selectedService;
  if (!service) {
    vacinaModal.priceDisplay.textContent = 'Selecione uma vacina para ver o valor.';
    return;
  }
  const quantityInput = vacinaModal.fields?.quantidade;
  let quantidade = Number(quantityInput?.value || 0);
  if (!Number.isFinite(quantidade) || quantidade <= 0) quantidade = 1;
  quantidade = Math.max(1, Math.round(quantidade));
  if (quantityInput) quantityInput.value = String(quantidade);
  const unit = Number(service.valor || 0);
  const total = unit * quantidade;
  vacinaModal.priceDisplay.textContent = `Valor unitário: ${formatMoney(unit)} · Total (${quantidade}×): ${formatMoney(total)}`;
}

function ensureVacinaModal() {
  if (vacinaModal.overlay) return vacinaModal;

  const overlay = document.createElement('div');
  overlay.id = 'vet-vacina-modal';
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
  title.textContent = 'Nova vacina';
  header.appendChild(title);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'text-gray-400 transition hover:text-gray-600';
  closeBtn.innerHTML = '<i class="fas fa-xmark"></i>';
  closeBtn.addEventListener('click', (event) => {
    event.preventDefault();
    closeVacinaModal();
  });
  header.appendChild(closeBtn);

  const fieldsWrapper = document.createElement('div');
  fieldsWrapper.className = 'grid gap-4';
  form.appendChild(fieldsWrapper);

  const serviceWrapper = document.createElement('div');
  serviceWrapper.className = 'flex flex-col gap-2';
  fieldsWrapper.appendChild(serviceWrapper);

  const serviceLabel = document.createElement('label');
  serviceLabel.className = 'text-sm font-medium text-gray-700';
  serviceLabel.textContent = 'Vacina';
  serviceWrapper.appendChild(serviceLabel);

  const serviceInputWrapper = document.createElement('div');
  serviceInputWrapper.className = 'relative';
  serviceWrapper.appendChild(serviceInputWrapper);

  const serviceInput = document.createElement('input');
  serviceInput.type = 'text';
  serviceInput.name = 'vacinaServico';
  serviceInput.placeholder = 'Pesquise a vacina pelo nome';
  serviceInput.autocomplete = 'off';
  serviceInput.className = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200';
  serviceInputWrapper.appendChild(serviceInput);

  const suggestions = document.createElement('ul');
  suggestions.className = 'hidden absolute left-0 right-0 top-full mt-2 max-h-56 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg z-10';
  serviceInputWrapper.appendChild(suggestions);

  const priceDisplay = document.createElement('p');
  priceDisplay.className = 'text-xs text-gray-500';
  priceDisplay.textContent = 'Selecione uma vacina para ver o valor.';
  serviceWrapper.appendChild(priceDisplay);

  const quantityWrapper = document.createElement('div');
  quantityWrapper.className = 'grid gap-2 sm:grid-cols-2';
  fieldsWrapper.appendChild(quantityWrapper);

  const quantityLabel = document.createElement('label');
  quantityLabel.className = 'text-sm font-medium text-gray-700';
  quantityLabel.textContent = 'Quantidade';
  quantityWrapper.appendChild(quantityLabel);

  const quantityInput = document.createElement('input');
  quantityInput.type = 'number';
  quantityInput.name = 'quantidade';
  quantityInput.min = '1';
  quantityInput.value = '1';
  quantityInput.className = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200';
  quantityWrapper.appendChild(quantityInput);

  const validadeLabel = document.createElement('label');
  validadeLabel.className = 'text-sm font-medium text-gray-700';
  validadeLabel.textContent = 'Validade';
  fieldsWrapper.appendChild(validadeLabel);

  const validadeInput = document.createElement('input');
  validadeInput.type = 'date';
  validadeInput.name = 'validade';
  validadeInput.className = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200';
  fieldsWrapper.appendChild(validadeInput);

  const loteWrapper = document.createElement('div');
  loteWrapper.className = 'grid gap-2 sm:grid-cols-2';
  fieldsWrapper.appendChild(loteWrapper);

  const loteLabel = document.createElement('label');
  loteLabel.className = 'text-sm font-medium text-gray-700';
  loteLabel.textContent = 'Lote';
  loteWrapper.appendChild(loteLabel);

  const loteInput = document.createElement('input');
  loteInput.type = 'text';
  loteInput.name = 'lote';
  loteInput.placeholder = 'Informe o lote da vacina';
  loteInput.className = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200';
  loteWrapper.appendChild(loteInput);

  const aplicacaoLabel = document.createElement('label');
  aplicacaoLabel.className = 'text-sm font-medium text-gray-700';
  aplicacaoLabel.textContent = 'Data de aplicação';
  fieldsWrapper.appendChild(aplicacaoLabel);

  const aplicacaoInput = document.createElement('input');
  aplicacaoInput.type = 'date';
  aplicacaoInput.name = 'aplicacao';
  aplicacaoInput.className = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200';
  fieldsWrapper.appendChild(aplicacaoInput);

  const renovacaoLabel = document.createElement('label');
  renovacaoLabel.className = 'text-sm font-medium text-gray-700';
  renovacaoLabel.textContent = 'Data de renovação';
  fieldsWrapper.appendChild(renovacaoLabel);

  const renovacaoInput = document.createElement('input');
  renovacaoInput.type = 'date';
  renovacaoInput.name = 'renovacao';
  renovacaoInput.className = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200';
  fieldsWrapper.appendChild(renovacaoInput);

  const footer = document.createElement('div');
  footer.className = 'flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:items-center sm:justify-end sm:gap-3';
  form.appendChild(footer);

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'w-full rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 sm:w-auto';
  cancelBtn.textContent = 'Cancelar';
  cancelBtn.addEventListener('click', (event) => {
    event.preventDefault();
    closeVacinaModal();
  });
  footer.appendChild(cancelBtn);

  const submitBtn = document.createElement('button');
  submitBtn.type = 'submit';
  submitBtn.className = 'w-full rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-400 sm:w-auto';
  submitBtn.textContent = 'Adicionar';
  footer.appendChild(submitBtn);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    await handleVacinaSubmit();
  });

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) {
      event.preventDefault();
      closeVacinaModal();
    }
  });

  document.body.appendChild(overlay);

  vacinaModal.overlay = overlay;
  vacinaModal.dialog = dialog;
  vacinaModal.form = form;
  vacinaModal.submitBtn = submitBtn;
  vacinaModal.cancelBtn = cancelBtn;
  vacinaModal.titleEl = title;
  vacinaModal.closeBtn = closeBtn;
  vacinaModal.fields = {
    servico: serviceInput,
    quantidade: quantityInput,
    validade: validadeInput,
    lote: loteInput,
    aplicacao: aplicacaoInput,
    renovacao: renovacaoInput,
    servicoWrapper: serviceInputWrapper,
  };
  vacinaModal.suggestionsEl = suggestions;
  vacinaModal.priceDisplay = priceDisplay;

  const debouncedSearch = debounce((value) => searchVacinaServices(value), 300);
  serviceInput.addEventListener('input', (event) => {
    vacinaModal.selectedService = null;
    updateVacinaPriceSummary();
    debouncedSearch(event.target.value);
  });
  serviceInput.addEventListener('focus', () => {
    if (vacinaModal.suggestionsEl && vacinaModal.suggestionsEl.children.length) {
      vacinaModal.suggestionsEl.classList.remove('hidden');
    }
  });

  quantityInput.addEventListener('input', updateVacinaPriceSummary);

  document.addEventListener('click', (event) => {
    if (!vacinaModal.overlay || vacinaModal.overlay.classList.contains('hidden')) return;
    const container = vacinaModal.fields?.servicoWrapper;
    if (!container) return;
    if (container.contains(event.target)) return;
    hideVacinaSuggestions();
  });

  return vacinaModal;
}

export function closeVacinaModal() {
  if (!vacinaModal.overlay) return;
  vacinaModal.overlay.classList.add('hidden');
  vacinaModal.overlay.setAttribute('aria-hidden', 'true');
  if (vacinaModal.form) vacinaModal.form.reset();
  vacinaModal.selectedService = null;
  hideVacinaSuggestions();
  setVacinaModalSubmitting(false);
  if (vacinaModal.priceDisplay) {
    vacinaModal.priceDisplay.textContent = 'Selecione uma vacina para ver o valor.';
  }
  if (vacinaModal.keydownHandler) {
    document.removeEventListener('keydown', vacinaModal.keydownHandler);
    vacinaModal.keydownHandler = null;
  }
  if (vacinaModal.searchAbortController) {
    try { vacinaModal.searchAbortController.abort(); } catch { }
    vacinaModal.searchAbortController = null;
  }
}

export function openVacinaModal() {
  if (!ensureTutorAndPetSelected()) {
    return;
  }
  const appointmentId = normalizeId(state.agendaContext?.appointmentId);
  if (!appointmentId) {
    notify('Abra a ficha pela agenda para registrar vacinas vinculadas a um agendamento.', 'warning');
    return;
  }

  const modal = ensureVacinaModal();
  setVacinaModalSubmitting(false);
  if (modal.form) modal.form.reset();
  if (modal.fields.quantidade) modal.fields.quantidade.value = '1';
  vacinaModal.selectedService = null;
  hideVacinaSuggestions();
  if (vacinaModal.priceDisplay) {
    vacinaModal.priceDisplay.textContent = 'Selecione uma vacina para ver o valor.';
  }

  vacinaModal.overlay.classList.remove('hidden');
  vacinaModal.overlay.removeAttribute('aria-hidden');
  if (vacinaModal.dialog) {
    vacinaModal.dialog.focus();
  }

  if (vacinaModal.keydownHandler) {
    document.removeEventListener('keydown', vacinaModal.keydownHandler);
  }
  vacinaModal.keydownHandler = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeVacinaModal();
    }
  };
  document.addEventListener('keydown', vacinaModal.keydownHandler);

  setTimeout(() => {
    if (vacinaModal.fields.servico) {
      try { vacinaModal.fields.servico.focus(); } catch { }
    }
  }, 50);

  const storeId = getAgendaStoreId();
  if (!storeId) {
    notify('Não foi possível identificar a empresa do agendamento. Os valores podem considerar apenas o preço padrão do serviço.', 'warning');
  }
}

function isVacinaServiceCandidate(service) {
  if (!service) return false;
  const categorias = [];
  if (Array.isArray(service.categorias)) categorias.push(...service.categorias);
  if (Array.isArray(service.category)) categorias.push(...service.category);
  if (service.categoria) categorias.push(service.categoria);
  if (categorias.some((cat) => normalizeForCompare(cat) === 'vacina')) return true;
  const nomeNorm = normalizeForCompare(service.nome || '');
  if (nomeNorm.includes('vacina')) return true;
  if (service?.grupo?.nome) {
    const groupNorm = normalizeForCompare(service.grupo.nome);
    if (groupNorm.includes('vacina')) return true;
  }
  return false;
}

async function searchVacinaServices(term) {
  const query = String(term || '').trim();
  if (!query || query.length < 2) {
    hideVacinaSuggestions();
    return;
  }

  if (vacinaModal.searchAbortController) {
    try { vacinaModal.searchAbortController.abort(); } catch { }
  }
  const controller = new AbortController();
  vacinaModal.searchAbortController = controller;

  try {
    const params = new URLSearchParams({ q: query, limit: '8' });
    const resp = await api(`/func/servicos/buscar?${params.toString()}`, { signal: controller.signal });
    if (!resp.ok) {
      hideVacinaSuggestions();
      return;
    }
    const payload = await resp.json().catch(() => []);
    if (controller.signal.aborted) return;
    const list = Array.isArray(payload) ? payload : [];
    const filtered = list.filter(isVacinaServiceCandidate);
    const normalized = filtered
      .map((svc) => ({
        _id: normalizeId(svc._id),
        nome: pickFirst(svc.nome),
        valor: Number(svc.valor || 0),
      }))
      .filter((svc) => svc._id && svc.nome);
    if (!normalized.length) {
      hideVacinaSuggestions();
      return;
    }
    if (vacinaModal.suggestionsEl) {
      vacinaModal.suggestionsEl.innerHTML = '';
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
        svc.priceEl = priceEl;
        li.appendChild(nameEl);
        li.appendChild(priceEl);
        li.addEventListener('click', async () => {
          await selectVacinaService(svc);
        });
        vacinaModal.suggestionsEl.appendChild(li);
      });
      vacinaModal.suggestionsEl.classList.remove('hidden');

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
              if (controller.signal.aborted) return;
              if (err && err.name === 'AbortError') return;
            });
        });
      }
    }
  } catch (error) {
    if (controller.signal.aborted) return;
    hideVacinaSuggestions();
  } finally {
    if (vacinaModal.searchAbortController === controller) {
      vacinaModal.searchAbortController = null;
    }
  }
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

async function selectVacinaService(service) {
  if (!service || !service._id) return;
  ensureVacinaModal();
  vacinaModal.selectedService = {
    _id: service._id,
    nome: service.nome || '',
    valor: Number(service.valor || 0),
  };
  if (vacinaModal.fields?.servico) {
    vacinaModal.fields.servico.value = service.nome || '';
  }
  hideVacinaSuggestions();
  updateVacinaPriceSummary();

  try {
    const price = await fetchServicePrice(service._id);
    if (price != null) {
      vacinaModal.selectedService.valor = Number(price);
      updateVacinaPriceSummary();
    }
  } catch (error) {
    // silent
  }
}

async function handleVacinaSubmit() {
  const modal = ensureVacinaModal();
  if (modal.isSubmitting) return;

  if (!ensureTutorAndPetSelected()) {
    return;
  }

  const appointmentId = normalizeId(state.agendaContext?.appointmentId);
  if (!appointmentId) {
    notify('Abra a ficha pela agenda para registrar vacinas vinculadas a um agendamento.', 'warning');
    return;
  }

  const service = vacinaModal.selectedService;
  if (!service || !service._id) {
    notify('Selecione uma vacina para registrar.', 'warning');
    return;
  }

  let quantidade = Number(vacinaModal.fields?.quantidade?.value || 0);
  if (!Number.isFinite(quantidade) || quantidade <= 0) {
    notify('Informe uma quantidade válida para a vacina.', 'warning');
    return;
  }
  quantidade = Math.max(1, Math.round(quantidade));
  if (vacinaModal.fields?.quantidade) {
    vacinaModal.fields.quantidade.value = String(quantidade);
  }

  const validade = normalizeDateInputValue(vacinaModal.fields?.validade?.value);
  const lote = String(vacinaModal.fields?.lote?.value || '').trim();
  const aplicacao = normalizeDateInputValue(vacinaModal.fields?.aplicacao?.value);
  const renovacao = normalizeDateInputValue(vacinaModal.fields?.renovacao?.value);

  let valorUnitario = Number(service.valor || 0);
  if (!Number.isFinite(valorUnitario) || valorUnitario < 0) {
    valorUnitario = 0;
  }
  const valorTotal = valorUnitario * quantidade;

  const record = {
    id: generateVacinaId(),
    servicoId: service._id,
    servicoNome: service.nome || '',
    quantidade,
    valorUnitario,
    valorTotal,
    validade,
    aplicacao,
    renovacao,
    lote,
    createdAt: new Date().toISOString(),
  };

  const existingServices = Array.isArray(state.agendaContext?.servicos) ? state.agendaContext.servicos : [];
  const payloadServicos = existingServices
    .map((svc) => {
      const sid = normalizeId(svc._id || svc.id || svc.servicoId || svc.servico);
      if (!sid) return null;
      const valor = Number(svc.valor || 0);
      return {
        servicoId: sid,
        valor: Number.isFinite(valor) ? valor : 0,
      };
    })
    .filter(Boolean);

  payloadServicos.push({ servicoId: service._id, valor: valorTotal });

  setVacinaModalSubmitting(true);

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

    state.vacinas = [record, ...(Array.isArray(state.vacinas) ? state.vacinas : [])];
    persistVacinasForSelection();
    updateConsultaAgendaCard();
    closeVacinaModal();
    notify('Vacina registrada com sucesso.', 'success');
  } catch (error) {
    console.error('handleVacinaSubmit', error);
    notify(error.message || 'Erro ao registrar vacina.', 'error');
  } finally {
    setVacinaModalSubmitting(false);
  }
}

export async function deleteVacina(vacina, options = {}) {
  const { skipConfirm = false } = options || {};
  const record = vacina && typeof vacina === 'object' ? vacina : {};
  const recordId = normalizeId(record.id || record._id);
  const servicoId = normalizeId(record.servicoId || record.servico);
  if (!servicoId) {
    notify('Não foi possível identificar a vacina selecionada.', 'error');
    return false;
  }

  if (!ensureTutorAndPetSelected()) {
    return false;
  }

  const appointmentId = normalizeId(state.agendaContext?.appointmentId);
  if (!appointmentId) {
    notify('Abra a ficha pela agenda para remover vacinas vinculadas a um agendamento.', 'warning');
    return false;
  }

  const serviceName = pickFirst(record.servicoNome);
  if (!skipConfirm && typeof window !== 'undefined' && typeof window.confirm === 'function') {
    const question = serviceName
      ? `Remover a aplicação da vacina "${serviceName}"?`
      : 'Remover esta aplicação de vacina?';
    const confirmed = window.confirm(question);
    if (!confirmed) {
      return false;
    }
  }

  const existingServices = Array.isArray(state.agendaContext?.servicos) ? state.agendaContext.servicos : [];
  const normalizedServices = existingServices
    .map((svc) => {
      const sid = normalizeId(svc?._id || svc?.id || svc?.servicoId || svc?.servico);
      if (!sid) return null;
      const valorItem = Number(svc?.valor || 0);
      return {
        servicoId: sid,
        valor: Number.isFinite(valorItem) ? valorItem : 0,
      };
    })
    .filter(Boolean);

  const rawTotal = Number(record.valorTotal);
  const fallbackTotal = Number(record.valorUnitario || 0) * (Number(record.quantidade || 0) || 0);
  let targetValor = null;
  if (Number.isFinite(rawTotal) && rawTotal > 0) {
    targetValor = Number(rawTotal);
  } else if (Number.isFinite(fallbackTotal) && fallbackTotal > 0) {
    targetValor = Number(fallbackTotal);
  }

  let removed = false;
  const remainingServices = [];
  normalizedServices.forEach((svc) => {
    if (removed) {
      remainingServices.push(svc);
      return;
    }

    if (svc.servicoId !== servicoId) {
      remainingServices.push(svc);
      return;
    }

    const valorItem = Number(svc.valor || 0);
    if (targetValor != null && Math.abs(valorItem - targetValor) > 0.01) {
      remainingServices.push(svc);
      return;
    }

    removed = true;
  });

  if (!removed) {
    notify('Não foi possível localizar a vacina no agendamento.', 'error');
    return false;
  }

  try {
    const response = await api(`/func/agendamentos/${appointmentId}`, {
      method: 'PUT',
      body: JSON.stringify({ servicos: remainingServices }),
    });

    let data = null;
    if (response.status !== 204) {
      data = await response.json().catch(() => (response.ok ? {} : {}));
    }

    if (!response.ok) {
      const message = typeof data?.message === 'string' ? data.message : 'Erro ao atualizar os serviços do agendamento.';
      throw new Error(message);
    }

    if (!state.agendaContext) state.agendaContext = {};
    if (Array.isArray(data?.servicos)) {
      state.agendaContext.servicos = data.servicos;
    } else {
      let removedFromContext = false;
      state.agendaContext.servicos = existingServices.filter((svc) => {
        if (removedFromContext) return true;
        const sid = normalizeId(svc?._id || svc?.id || svc?.servicoId || svc?.servico);
        if (!sid || sid !== servicoId) return true;
        const valorItem = Number(svc?.valor || 0);
        if (targetValor != null && Math.abs(valorItem - targetValor) > 0.01) {
          return true;
        }
        removedFromContext = true;
        return false;
      });
    }
    if (typeof data?.valor === 'number') {
      state.agendaContext.valor = Number(data.valor);
    }
    if (Array.isArray(state.agendaContext?.servicos)) {
      state.agendaContext.totalServicos = state.agendaContext.servicos.length;
    }
    persistAgendaContext(state.agendaContext);

    const nextVacinas = (Array.isArray(state.vacinas) ? state.vacinas : []).filter((item) => {
      const itemId = normalizeId(item?.id || item?._id);
      if (recordId && itemId) {
        return itemId !== recordId;
      }
      return item !== record;
    });
    state.vacinas = nextVacinas;
    persistVacinasForSelection();
    updateConsultaAgendaCard();
    notify('Vacina removida com sucesso.', 'success');
    return true;
  } catch (error) {
    console.error('deleteVacina', error);
    notify(error.message || 'Erro ao remover vacina.', 'error');
    return false;
  }
}

state.deleteVacina = deleteVacina;
