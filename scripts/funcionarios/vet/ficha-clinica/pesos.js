// Peso modal and histórico management for the Vet ficha clínica
import {
  state,
  api,
  notify,
  normalizeId,
  toIsoOrNull,
  formatPetWeight,
  formatDateTimeDisplay,
  formatWeightDifference,
  computeWeightDifference,
  parseWeightValue,
  formatWeightDelta,
  pesoModal,
} from './core.js';
import { ensureTutorAndPetSelected, updateConsultaAgendaCard } from './consultas.js';
import { updateCardDisplay } from './ui.js';

function getPesosKey(clienteId, petId) {
  const tutor = normalizeId(clienteId);
  const pet = normalizeId(petId);
  if (!(tutor && pet)) return null;
  return `${tutor}|${pet}`;
}

function normalizePesoRecord(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const petId = normalizeId(raw.petId || raw.pet);
  const clienteId = normalizeId(raw.clienteId || raw.cliente);
  const fallbackId = raw.isInitial ? `initial-${petId || 'pet'}` : null;
  const id = normalizeId(raw.id || raw._id) || fallbackId;
  if (!id) return null;
  const peso = parseWeightValue(raw.peso);
  if (peso === null) return null;
  return {
    id,
    _id: id,
    petId,
    clienteId,
    peso,
    isInitial: !!raw.isInitial,
    registradoPor: normalizeId(raw.registradoPor || raw.registradoPorId) || null,
    createdAt: toIsoOrNull(raw.createdAt || raw.created_at || raw.createdEm || raw.registradoEm) || null,
  };
}

function getOrderedPesos() {
  const entries = Array.isArray(state.pesos) ? state.pesos.slice() : [];
  entries.sort((a, b) => {
    const aTime = a?.createdAt ? new Date(a.createdAt).getTime() : 0;
    const bTime = b?.createdAt ? new Date(b.createdAt).getTime() : 0;
    return bTime - aTime;
  });
  return entries;
}

function setPesoModalSubmitting(isSubmitting) {
  pesoModal.isSubmitting = !!isSubmitting;
  if (pesoModal.submitBtn) {
    if (!pesoModal.submitBtnOriginalHtml) {
      pesoModal.submitBtnOriginalHtml = pesoModal.submitBtn.innerHTML;
    }
    pesoModal.submitBtn.disabled = !!isSubmitting;
    pesoModal.submitBtn.classList.toggle('opacity-60', !!isSubmitting);
    pesoModal.submitBtn.classList.toggle('cursor-not-allowed', !!isSubmitting);
    pesoModal.submitBtn.innerHTML = isSubmitting
      ? '<i class="fas fa-spinner fa-spin"></i><span>Salvando...</span>'
      : pesoModal.submitBtnOriginalHtml;
  }
  if (pesoModal.cancelBtn) {
    pesoModal.cancelBtn.disabled = !!isSubmitting;
    pesoModal.cancelBtn.classList.toggle('opacity-50', !!isSubmitting);
    pesoModal.cancelBtn.classList.toggle('cursor-not-allowed', !!isSubmitting);
  }
  if (pesoModal.input) {
    pesoModal.input.disabled = !!isSubmitting;
  }
}

function ensurePesoModal() {
  if (pesoModal.overlay) return pesoModal;

  const overlay = document.createElement('div');
  overlay.id = 'vet-peso-modal';
  overlay.className = 'hidden fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4';
  overlay.setAttribute('aria-hidden', 'true');

  const dialog = document.createElement('div');
  dialog.className = 'w-full max-w-xl rounded-xl bg-white shadow-xl focus:outline-none';
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

  const titleWrap = document.createElement('div');
  header.appendChild(titleWrap);

  const title = document.createElement('h2');
  title.className = 'text-lg font-semibold text-gray-800';
  title.textContent = 'Histórico de peso';
  titleWrap.appendChild(title);

  const subtitle = document.createElement('p');
  subtitle.className = 'text-sm text-gray-600';
  subtitle.textContent = 'Registre novas pesagens e acompanhe a evolução do pet.';
  titleWrap.appendChild(subtitle);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'h-8 w-8 grid place-content-center rounded-lg bg-gray-100 text-gray-500 transition hover:text-gray-700';
  closeBtn.innerHTML = '<i class="fas fa-xmark"></i>';
  header.appendChild(closeBtn);

  const fieldset = document.createElement('div');
  fieldset.className = 'grid gap-2';
  form.appendChild(fieldset);

  const label = document.createElement('label');
  label.className = 'text-sm font-medium text-gray-700';
  label.textContent = 'Novo peso (Kg)';
  fieldset.appendChild(label);

  const inputRow = document.createElement('div');
  inputRow.className = 'flex items-center gap-3';
  fieldset.appendChild(inputRow);

  const input = document.createElement('input');
  input.type = 'number';
  input.step = '0.01';
  input.min = '0';
  input.placeholder = 'Ex.: 12,5';
  input.className = 'flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-primary';
  inputRow.appendChild(input);

  const submitBtn = document.createElement('button');
  submitBtn.type = 'submit';
  submitBtn.className = 'inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700';
  submitBtn.innerHTML = '<i class="fas fa-plus"></i><span>Adicionar</span>';
  inputRow.appendChild(submitBtn);

  const historySection = document.createElement('div');
  historySection.className = 'grid gap-3';
  form.appendChild(historySection);

  const historyHeader = document.createElement('div');
  historyHeader.className = 'flex items-center justify-between';
  historySection.appendChild(historyHeader);

  const historyTitle = document.createElement('h3');
  historyTitle.className = 'text-sm font-semibold uppercase tracking-wide text-gray-700';
  historyTitle.textContent = 'Histórico registrado';
  historyHeader.appendChild(historyTitle);

  const summary = document.createElement('p');
  summary.className = 'text-sm text-gray-600';
  summary.textContent = 'Acompanhe os registros de peso do pet.';
  historySection.appendChild(summary);

  const list = document.createElement('div');
  list.className = 'max-h-80 space-y-3 overflow-y-auto';
  historySection.appendChild(list);

  const loadingState = document.createElement('div');
  loadingState.className = 'hidden rounded-lg border border-dashed border-gray-300 bg-white px-4 py-6 text-center text-sm text-gray-500';
  loadingState.textContent = 'Carregando registros de peso...';
  historySection.appendChild(loadingState);

  const emptyState = document.createElement('div');
  emptyState.className = 'hidden rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-center text-sm text-gray-500';
  emptyState.textContent = 'Nenhum peso registrado até o momento.';
  historySection.appendChild(emptyState);

  const footer = document.createElement('div');
  footer.className = 'flex items-center justify-end gap-2 border-t border-gray-200 pt-3';
  form.appendChild(footer);

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50';
  cancelBtn.innerHTML = '<i class="fas fa-xmark"></i><span>Fechar</span>';
  footer.appendChild(cancelBtn);

  form.addEventListener('submit', handlePesoSubmit);
  closeBtn.addEventListener('click', (event) => {
    event.preventDefault();
    closePesoModal();
  });
  cancelBtn.addEventListener('click', (event) => {
    event.preventDefault();
    closePesoModal();
  });
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) {
      closePesoModal();
    }
  });

  document.body.appendChild(overlay);

  pesoModal.overlay = overlay;
  pesoModal.dialog = dialog;
  pesoModal.form = form;
  pesoModal.closeBtn = closeBtn;
  pesoModal.cancelBtn = cancelBtn;
  pesoModal.submitBtn = submitBtn;
  pesoModal.submitBtnOriginalHtml = submitBtn.innerHTML;
  pesoModal.input = input;
  pesoModal.list = list;
  pesoModal.summary = summary;
  pesoModal.emptyState = emptyState;
  pesoModal.loadingState = loadingState;

  return pesoModal;
}

function renderPesoList() {
  if (!pesoModal.list) return;

  const ordered = getOrderedPesos();
  const listEl = pesoModal.list;
  const emptyEl = pesoModal.emptyState;
  const loadingEl = pesoModal.loadingState;
  const summaryEl = pesoModal.summary;

  if (loadingEl) {
    loadingEl.classList.toggle('hidden', !state.pesosLoading);
  }

  const hasItems = ordered.length > 0;
  if (listEl) {
    listEl.classList.toggle('hidden', state.pesosLoading || !hasItems);
  }
  if (emptyEl) {
    emptyEl.classList.toggle('hidden', state.pesosLoading || hasItems);
  }

  if (summaryEl) {
    if (!hasItems) {
      summaryEl.textContent = 'Nenhum peso registrado até o momento.';
    }
  }

  if (state.pesosLoading) {
    listEl.innerHTML = '';
    return;
  }

  listEl.innerHTML = '';
  if (!hasItems) {
    return;
  }

  const baseline = ordered.find((entry) => entry && entry.isInitial) || ordered[ordered.length - 1] || null;
  const latest = ordered[0] || null;

  if (summaryEl && latest) {
    const weightText = formatPetWeight(latest.peso) || '';
    const diffText = baseline ? formatWeightDifference(latest.peso, baseline.peso) : '';
    if (weightText) {
      if (diffText && diffText !== 'Sem variação') {
        summaryEl.textContent = `Peso atual: ${weightText} · Diferença desde o primeiro registro: ${diffText}`;
      } else if (diffText === 'Sem variação') {
        summaryEl.textContent = `Peso atual: ${weightText} · Sem variação desde o primeiro registro.`;
      } else {
        summaryEl.textContent = `Peso atual: ${weightText}`;
      }
    } else {
      summaryEl.textContent = 'Acompanhe os registros de peso do pet.';
    }
  }

  ordered.forEach((entry, index) => {
    const item = document.createElement('div');
    item.className = 'rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-sm';

    const header = document.createElement('div');
    header.className = 'flex items-center justify-between gap-2';
    item.appendChild(header);

    const valueEl = document.createElement('p');
    valueEl.className = 'text-sm font-semibold text-gray-800';
    valueEl.textContent = formatPetWeight(entry.peso) || '—';
    header.appendChild(valueEl);

    if (entry.isInitial) {
      const badge = document.createElement('span');
      badge.className = 'inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-700';
      badge.innerHTML = '<i class="fas fa-flag"></i><span>Peso inicial</span>';
      header.appendChild(badge);
    } else if (index === 0) {
      const badge = document.createElement('span');
      badge.className = 'inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700';
      badge.innerHTML = '<i class="fas fa-weight-hanging"></i><span>Registro mais recente</span>';
      header.appendChild(badge);
    }

    const details = document.createElement('div');
    details.className = 'mt-1 space-y-1';
    item.appendChild(details);

    if (entry.createdAt) {
      const dateEl = document.createElement('p');
      dateEl.className = 'text-xs text-gray-500';
      dateEl.textContent = `Registrado em ${formatDateTimeDisplay(entry.createdAt)}`;
      details.appendChild(dateEl);
    }

    if (baseline && !entry.isInitial) {
      const diffText = formatWeightDifference(entry.peso, baseline.peso);
      const diffEl = document.createElement('p');
      diffEl.className = 'text-xs font-medium';
      if (!diffText || diffText === 'Sem variação') {
        diffEl.classList.add('text-gray-600');
        diffEl.textContent = 'Sem variação desde o primeiro registro.';
      } else {
        const diffValue = computeWeightDifference(entry.peso, baseline.peso) || 0;
        diffEl.classList.add(diffValue > 0 ? 'text-emerald-600' : 'text-rose-600');
        diffEl.textContent = `Diferença desde o primeiro registro: ${diffText}`;
      }
      details.appendChild(diffEl);
    } else if (entry.isInitial) {
      const infoEl = document.createElement('p');
      infoEl.className = 'text-xs text-gray-600';
      infoEl.textContent = 'Registro inicial cadastrado para o pet.';
      details.appendChild(infoEl);
    }

    const previous = ordered[index + 1] || null;
    if (previous && !entry.isInitial) {
      const diffPrevValue = computeWeightDifference(entry.peso, previous.peso);
      if (diffPrevValue !== null) {
        const diffPrevText = formatWeightDelta(diffPrevValue, { showZero: true });
        const diffPrevEl = document.createElement('p');
        diffPrevEl.className = 'text-xs text-gray-500';
        if (!diffPrevText || diffPrevText === '0 Kg') {
          diffPrevEl.textContent = 'Sem variação em relação ao registro anterior.';
        } else {
          diffPrevEl.textContent = `Comparado ao registro anterior: ${diffPrevText}`;
        }
        details.appendChild(diffPrevEl);
      }
    }

    listEl.appendChild(item);
  });
}

function updatePetWeightInState(newPeso) {
  const petId = normalizeId(state.selectedPetId);
  if (!petId) return;
  if (state.petsById && state.petsById[petId]) {
    state.petsById[petId] = {
      ...state.petsById[petId],
      peso: newPeso,
      pesoAtual: newPeso,
    };
  }
}

export async function loadPesosFromServer(options = {}) {
  const { force = false } = options || {};
  const clienteId = normalizeId(state.selectedCliente?._id);
  const petId = normalizeId(state.selectedPetId);

  if (!(clienteId && petId)) {
    state.pesos = [];
    state.pesosLoadKey = null;
    state.pesosLoading = false;
    if (pesoModal.overlay && !pesoModal.overlay.classList.contains('hidden')) {
      renderPesoList();
    }
    updateConsultaAgendaCard();
    return;
  }

  const key = getPesosKey(clienteId, petId);
  if (!force && key && state.pesosLoadKey === key && Array.isArray(state.pesos) && state.pesos.length) {
    return;
  }

  state.pesosLoading = true;
  if (pesoModal.overlay && !pesoModal.overlay.classList.contains('hidden')) {
    renderPesoList();
  }

  try {
    const params = new URLSearchParams({ clienteId, petId });
    const resp = await api(`/func/vet/pesos?${params.toString()}`);
    const payload = await resp.json().catch(() => (resp.ok ? [] : {}));
    if (!resp.ok) {
      const message = typeof payload?.message === 'string' ? payload.message : 'Erro ao carregar pesos.';
      throw new Error(message);
    }
    const list = Array.isArray(payload) ? payload : [];
    const normalized = list.map(normalizePesoRecord).filter(Boolean);
    normalized.sort((a, b) => {
      const aTime = a?.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bTime = b?.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bTime - aTime;
    });
    state.pesos = normalized;
    state.pesosLoadKey = key;
  } catch (error) {
    console.error('loadPesosFromServer', error);
    state.pesos = [];
    state.pesosLoadKey = null;
    notify(error.message || 'Erro ao carregar pesos.', 'error');
  } finally {
    state.pesosLoading = false;
    if (pesoModal.overlay && !pesoModal.overlay.classList.contains('hidden')) {
      renderPesoList();
    }
    updateConsultaAgendaCard();
  }
}

export function closePesoModal() {
  if (!pesoModal.overlay) return;
  pesoModal.overlay.classList.add('hidden');
  pesoModal.overlay.setAttribute('aria-hidden', 'true');
  if (pesoModal.form) {
    try { pesoModal.form.reset(); } catch (_) { /* ignore */ }
  }
  setPesoModalSubmitting(false);
  if (pesoModal.keydownHandler) {
    document.removeEventListener('keydown', pesoModal.keydownHandler);
    pesoModal.keydownHandler = null;
  }
}

export function openPesoModal() {
  if (!ensureTutorAndPetSelected()) {
    return;
  }

  const modal = ensurePesoModal();
  setPesoModalSubmitting(false);
  if (modal.form) {
    try { modal.form.reset(); } catch (_) { /* ignore */ }
  }
  if (pesoModal.input) {
    pesoModal.input.value = '';
  }

  renderPesoList();

  pesoModal.overlay.classList.remove('hidden');
  pesoModal.overlay.removeAttribute('aria-hidden');
  if (pesoModal.dialog) {
    pesoModal.dialog.focus();
  }

  if (pesoModal.keydownHandler) {
    document.removeEventListener('keydown', pesoModal.keydownHandler);
  }
  pesoModal.keydownHandler = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closePesoModal();
    }
  };
  document.addEventListener('keydown', pesoModal.keydownHandler);

  setTimeout(() => {
    if (pesoModal.input) {
      try { pesoModal.input.focus(); } catch (_) { /* ignore */ }
    }
  }, 50);

  const promise = loadPesosFromServer();
  if (promise && typeof promise.then === 'function') {
    promise.catch(() => {});
  }
}

async function handlePesoSubmit(event) {
  event.preventDefault();
  if (!ensureTutorAndPetSelected()) {
    return;
  }

  const clienteId = normalizeId(state.selectedCliente?._id);
  const petId = normalizeId(state.selectedPetId);
  const raw = pesoModal.input ? pesoModal.input.value : '';
  const pesoValor = parseWeightValue(raw);

  if (pesoValor === null || pesoValor <= 0) {
    notify('Informe um peso válido (maior que zero).', 'warning');
    if (pesoModal.input) {
      try { pesoModal.input.focus(); } catch (_) { /* ignore */ }
    }
    return;
  }

  const payload = {
    clienteId,
    petId,
    peso: pesoValor,
  };

  setPesoModalSubmitting(true);

  try {
    const response = await api('/func/vet/pesos', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => (response.ok ? {} : {}));
    if (!response.ok) {
      const message = typeof data?.message === 'string' ? data.message : 'Erro ao registrar peso.';
      throw new Error(message);
    }

    if (pesoModal.form) {
      try { pesoModal.form.reset(); } catch (_) { /* ignore */ }
    }
    if (pesoModal.input) {
      pesoModal.input.value = '';
    }

    updatePetWeightInState(pesoValor);
    updateCardDisplay();

    await loadPesosFromServer({ force: true });
    notify('Peso registrado com sucesso.', 'success');
  } catch (error) {
    console.error('handlePesoSubmit', error);
    notify(error.message || 'Erro ao registrar peso.', 'error');
  } finally {
    setPesoModalSubmitting(false);
    renderPesoList();
  }
}
