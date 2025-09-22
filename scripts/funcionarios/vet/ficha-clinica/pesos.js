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
  sanitizeObjectId,
  isFinalizadoSelection,
} from './core.js';
import { ensureTutorAndPetSelected, updateConsultaAgendaCard } from './consultas.js';
import { emitFichaClinicaUpdate } from './real-time.js';
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

function getLatestEditablePeso() {
  const ordered = getOrderedPesos();
  for (let i = 0; i < ordered.length; i += 1) {
    const entry = ordered[i];
    if (entry && !entry.isInitial) {
      return entry;
    }
  }
  return null;
}

function setPesoModalSubmitting(isSubmitting) {
  pesoModal.isSubmitting = !!isSubmitting;
  if (pesoModal.submitBtn) {
    if (!pesoModal.submitBtnOriginalHtml) {
      pesoModal.submitBtnOriginalHtml = pesoModal.submitBtn.innerHTML;
    }
    if (!pesoModal.submitBtnEditHtml) {
      pesoModal.submitBtnEditHtml = '<i class="fas fa-floppy-disk"></i><span>Atualizar</span>';
    }
    pesoModal.submitBtn.disabled = !!isSubmitting;
    pesoModal.submitBtn.classList.toggle('opacity-60', !!isSubmitting);
    pesoModal.submitBtn.classList.toggle('cursor-not-allowed', !!isSubmitting);
    const savingHtml = pesoModal.mode === 'edit'
      ? '<i class="fas fa-spinner fa-spin"></i><span>Atualizando...</span>'
      : '<i class="fas fa-spinner fa-spin"></i><span>Salvando...</span>';
    const idleHtml = pesoModal.mode === 'edit' ? pesoModal.submitBtnEditHtml : pesoModal.submitBtnOriginalHtml;
    pesoModal.submitBtn.innerHTML = isSubmitting ? savingHtml : idleHtml;
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

function setPesoModalMode(mode, record = null) {
  const normalizedMode = mode === 'edit' ? 'edit' : 'create';
  pesoModal.mode = normalizedMode;
  pesoModal.editingId = null;
  pesoModal.editingRecord = null;

  if (normalizedMode === 'edit' && record) {
    const recordId = sanitizeObjectId(record.id || record._id) || normalizeId(record.id || record._id);
    if (recordId) {
      pesoModal.editingId = recordId;
    }
    pesoModal.editingRecord = { ...record };
    if (pesoModal.submitBtn) {
      const editHtml = pesoModal.submitBtnEditHtml || '<i class="fas fa-floppy-disk"></i><span>Atualizar</span>';
      pesoModal.submitBtnEditHtml = editHtml;
      pesoModal.submitBtn.innerHTML = editHtml;
    }
    if (pesoModal.input) {
      const value = record.peso != null ? String(record.peso) : '';
      pesoModal.input.value = value;
    }
  } else {
    if (pesoModal.submitBtn && pesoModal.submitBtnOriginalHtml) {
      pesoModal.submitBtn.innerHTML = pesoModal.submitBtnOriginalHtml;
    }
    if (pesoModal.input) {
      pesoModal.input.value = '';
    }
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
  pesoModal.submitBtnEditHtml = '<i class="fas fa-floppy-disk"></i><span>Atualizar</span>';
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

pesoModal.renderList = renderPesoList;

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
  if (isFinalizadoSelection(clienteId, petId)) {
    state.pesos = [];
    state.pesosLoadKey = key;
    state.pesosLoading = false;
    if (pesoModal.overlay && !pesoModal.overlay.classList.contains('hidden')) {
      renderPesoList();
    }
    updateConsultaAgendaCard();
    return;
  }
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

export async function deletePeso(peso, options = {}) {
  const { skipConfirm = false } = options || {};
  const record = peso && typeof peso === 'object' ? peso : {};
  const normalizedId = normalizeId(record.id || record._id);
  const targetId = sanitizeObjectId(normalizedId);

  if (!targetId) {
    notify('Este registro de peso não pode ser removido.', 'warning');
    return false;
  }

  if (!skipConfirm && typeof window !== 'undefined' && typeof window.confirm === 'function') {
    const weightText = formatPetWeight(record.peso) || 'este registro de peso';
    const question = record.isInitial
      ? `Remover o registro de peso inicial (${weightText})?`
      : `Remover o registro de peso ${weightText}?`;
    const confirmed = window.confirm(question);
    if (!confirmed) {
      return false;
    }
  }

  const clienteId = normalizeId(state.selectedCliente?._id);
  const petId = normalizeId(state.selectedPetId);
  if (!(clienteId && petId)) {
    notify('Selecione um tutor e um pet para remover registros de peso.', 'warning');
    return false;
  }

  const params = new URLSearchParams({ clienteId, petId });
  const endpoint = `/func/vet/pesos/${encodeURIComponent(targetId)}?${params.toString()}`;

  try {
    const response = await api(endpoint, { method: 'DELETE' });
    let payload = null;
    if (response.status !== 204) {
      payload = await response.json().catch(() => null);
    }
    if (!response.ok) {
      const message = typeof payload?.message === 'string' ? payload.message : 'Erro ao remover registro de peso.';
      throw new Error(message);
    }

    const remaining = (Array.isArray(state.pesos) ? state.pesos : []).filter((item) => {
      const itemId = normalizeId(item?.id || item?._id);
      if (!itemId) return true;
      const itemSanitized = sanitizeObjectId(itemId);
      if (itemSanitized) {
        return itemSanitized !== targetId;
      }
      return itemId !== normalizedId;
    });

    const hasInitial = remaining.some((entry) => entry && entry.isInitial);
    if (!hasInitial && remaining.length) {
      const orderedByDate = [...remaining].sort((a, b) => {
        const aTime = a?.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bTime = b?.createdAt ? new Date(b.createdAt).getTime() : 0;
        return aTime - bTime;
      });
      const first = orderedByDate[0];
      if (first) {
        remaining.forEach((entry) => {
          if (entry) entry.isInitial = false;
        });
        first.isInitial = true;
      }
    }

    state.pesos = remaining;

    const orderedAfterRemoval = getOrderedPesos();
    const latestAfterRemoval = orderedAfterRemoval[0] || null;
    const latestWeightValue = latestAfterRemoval ? latestAfterRemoval.peso : null;
    updatePetWeightInState(latestWeightValue);

    if (typeof pesoModal.renderList === 'function') {
      try {
        pesoModal.renderList();
      } catch (_) {
        /* ignore */
      }
    }

    updateCardDisplay();
    notify('Registro de peso removido com sucesso.', 'success');

    await loadPesosFromServer({ force: true });

    const orderedAfterReload = getOrderedPesos();
    const latestAfterReload = orderedAfterReload[0] || null;
    const syncedWeight = latestAfterReload ? latestAfterReload.peso : null;
    updatePetWeightInState(syncedWeight);
    updateCardDisplay();

    emitFichaClinicaUpdate({ scope: 'peso', action: 'delete', pesoId: targetId }).catch(() => {});

    return true;
  } catch (error) {
    console.error('deletePeso', error);
    notify(error.message || 'Erro ao remover registro de peso.', 'error');
    throw error;
  }
}

state.deletePeso = deletePeso;

export function closePesoModal() {
  if (!pesoModal.overlay) return;
  pesoModal.overlay.classList.add('hidden');
  pesoModal.overlay.setAttribute('aria-hidden', 'true');
  if (pesoModal.form) {
    try { pesoModal.form.reset(); } catch (_) { /* ignore */ }
  }
  setPesoModalMode('create');
  setPesoModalSubmitting(false);
  if (pesoModal.keydownHandler) {
    document.removeEventListener('keydown', pesoModal.keydownHandler);
    pesoModal.keydownHandler = null;
  }
}

export function openPesoModal(options = {}) {
  if (!ensureTutorAndPetSelected()) {
    return;
  }

  const modal = ensurePesoModal();
  setPesoModalSubmitting(false);
  const { peso = null } = options || {};
  if (modal.form) {
    try { modal.form.reset(); } catch (_) { /* ignore */ }
  }

  setPesoModalMode('create');
  if (peso && typeof peso === 'object' && !peso.isInitial) {
    const latest = getLatestEditablePeso();
    const latestId = latest
      ? sanitizeObjectId(latest.id || latest._id) || normalizeId(latest.id || latest._id)
      : '';
    const targetId = sanitizeObjectId(peso.id || peso._id) || normalizeId(peso.id || peso._id);

    if (latest && ((latestId && targetId && latestId === targetId) || latest === peso)) {
      setPesoModalMode('edit', peso);
    } else {
      notify('Apenas o registro de peso mais recente pode ser editado.', 'info');
    }
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

  if (pesoModal.mode === 'edit') {
    const record = pesoModal.editingRecord || {};
    const currentPeso = typeof record.peso === 'number' ? record.peso : null;
    if (currentPeso !== null && Math.abs(currentPeso - pesoValor) < 0.0001) {
      notify('Nenhuma alteração para salvar.', 'info');
      return;
    }
    await submitPesoUpdate(pesoValor);
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
    const savedRecordId = normalizeId(data?.id || data?._id);

    if (pesoModal.form) {
      try { pesoModal.form.reset(); } catch (_) { /* ignore */ }
    }
    if (pesoModal.input) {
      pesoModal.input.value = '';
    }

    updatePetWeightInState(pesoValor);
    updateCardDisplay();

    await loadPesosFromServer({ force: true });
    emitFichaClinicaUpdate({ scope: 'peso', action: 'create', pesoId: savedRecordId || null }).catch(() => {});
    notify('Peso registrado com sucesso.', 'success');
  } catch (error) {
    console.error('handlePesoSubmit', error);
    notify(error.message || 'Erro ao registrar peso.', 'error');
  } finally {
    setPesoModalSubmitting(false);
    renderPesoList();
  }
}

async function submitPesoUpdate(pesoValor) {
  const clienteId = normalizeId(state.selectedCliente?._id);
  const petId = normalizeId(state.selectedPetId);
  if (!(clienteId && petId)) {
    notify('Selecione um tutor e um pet para editar registros de peso.', 'warning');
    return;
  }

  const record = pesoModal.editingRecord || {};
  const targetId = sanitizeObjectId(pesoModal.editingId || record.id || record._id);
  if (!targetId) {
    notify('Não foi possível editar este registro de peso.', 'error');
    return;
  }

  const payload = {
    clienteId,
    petId,
    peso: pesoValor,
  };
  if (record.isInitial) {
    payload.isInitial = true;
  }

  setPesoModalSubmitting(true);

  try {
    const response = await api(`/func/vet/pesos/${encodeURIComponent(targetId)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => (response.ok ? {} : {}));
    if (!response.ok) {
      const message = typeof data?.message === 'string' ? data.message : 'Erro ao atualizar registro de peso.';
      throw new Error(message);
    }

    const updated = normalizePesoRecord(data);
    if (updated) {
      const list = Array.isArray(state.pesos) ? [...state.pesos] : [];
      const idx = list.findIndex((item) => normalizeId(item?.id || item?._id) === updated.id);
      if (idx >= 0) {
        list[idx] = updated;
      } else {
        list.unshift(updated);
      }
      state.pesos = list;
    }

    await loadPesosFromServer({ force: true });
    const updatedRecordId = normalizeId(updated?.id || updated?._id || targetId);
    emitFichaClinicaUpdate({ scope: 'peso', action: 'update', pesoId: updatedRecordId || null }).catch(() => {});
    const ordered = getOrderedPesos();
    const latest = ordered[0] || null;
    updatePetWeightInState(latest ? latest.peso : null);
    updateCardDisplay();
    renderPesoList();
    notify('Peso atualizado com sucesso.', 'success');
    setPesoModalMode('create');
    closePesoModal();
  } catch (error) {
    console.error('submitPesoUpdate', error);
    notify(error.message || 'Erro ao atualizar registro de peso.', 'error');
  } finally {
    setPesoModalSubmitting(false);
  }
}
