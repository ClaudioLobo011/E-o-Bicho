// Observação modal and state management for the Vet ficha clínica
import {
  state,
  notify,
  pickFirst,
  normalizeId,
  toIsoOrNull,
  OBSERVACAO_STORAGE_PREFIX,
  isFinalizadoSelection,
} from './core.js';
import { getConsultasKey, updateConsultaAgendaCard } from './consultas.js';
import { emitFichaClinicaUpdate } from './real-time.js';

const observacaoModal = {
  overlay: null,
  dialog: null,
  form: null,
  titleInput: null,
  textInput: null,
  submitBtn: null,
  cancelBtn: null,
  closeBtn: null,
  keydownHandler: null,
  submitDefaultText: '',
  mode: 'create',
  editingId: null,
};

function safeClone(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    if (Array.isArray(value)) {
      return value.map((item) => (item && typeof item === 'object' ? { ...item } : item));
    }
    if (value && typeof value === 'object') {
      return { ...value };
    }
    return value;
  }
}

function sortObservacoesByCreatedAt(list) {
  return [...list].sort((a, b) => {
    const aTime = a?.createdAt ? new Date(a.createdAt).getTime() : 0;
    const bTime = b?.createdAt ? new Date(b.createdAt).getTime() : 0;
    return bTime - aTime;
  });
}

function areObservacoesEqual(current = [], next = []) {
  if (current.length !== next.length) return false;
  for (let i = 0; i < current.length; i += 1) {
    const prev = current[i] || {};
    const nextItem = next[i] || {};
    const prevId = normalizeId(prev.id || prev._id);
    const nextId = normalizeId(nextItem.id || nextItem._id);
    if (prevId !== nextId) return false;
    const prevCreated = prev.createdAt ? new Date(prev.createdAt).getTime() : 0;
    const nextCreated = nextItem.createdAt ? new Date(nextItem.createdAt).getTime() : 0;
    if (prevCreated !== nextCreated) return false;
    if (String(prev.titulo || '') !== String(nextItem.titulo || '')) return false;
    if (String(prev.observacao || '') !== String(nextItem.observacao || '')) return false;
  }
  return true;
}

function buildObservacaoEventPayload(extra = {}) {
  const event = { ...extra };
  const clienteId = normalizeId(state.selectedCliente?._id);
  const petId = normalizeId(state.selectedPetId);
  const appointmentId = normalizeId(state.agendaContext?.appointmentId);
  if (clienteId) event.clienteId = clienteId;
  if (petId) event.petId = petId;
  if (appointmentId) event.appointmentId = appointmentId;
  return event;
}

function applyObservacoesSnapshot(rawList) {
  if (!Array.isArray(rawList)) return false;
  const normalized = rawList.map(normalizeObservacaoRecord).filter(Boolean);
  const ordered = sortObservacoesByCreatedAt(normalized);
  const current = Array.isArray(state.observacoes) ? state.observacoes : [];
  if (areObservacoesEqual(current, ordered)) return false;
  state.observacoes = ordered;
  persistObservacoesForSelection();
  updateConsultaAgendaCard();
  return true;
}

function extractObservacoesSnapshot(event = {}) {
  if (!event || typeof event !== 'object') return null;
  const candidates = [
    event.snapshot,
    event.observacoesSnapshot,
    event.records,
    event.observacoes,
    event.list,
  ];
  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    if (Array.isArray(candidate)) return candidate;
  }
  return null;
}

function hasTutorAndPetSelection() {
  const tutorId = normalizeId(state.selectedCliente?._id);
  const petId = normalizeId(state.selectedPetId);
  return !!(tutorId && petId);
}

function ensureObservacaoSelection() {
  if (hasTutorAndPetSelection()) return true;
  notify('Selecione um tutor e um pet para registrar observações.', 'warning');
  return false;
}

function getObservacaoStorageKey(clienteId, petId) {
  const base = getConsultasKey(clienteId, petId);
  return base ? `${OBSERVACAO_STORAGE_PREFIX}${base}` : null;
}

function generateObservacaoId() {
  return `obs-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

function normalizeObservacaoRecord(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = normalizeId(raw.id || raw._id || raw.uid || raw.key) || generateObservacaoId();
  const titulo = pickFirst(raw.titulo, raw.nome, raw.tituloPrincipal, raw.nomePrincipal, raw.title, raw.name);
  const texto = pickFirst(raw.observacao, raw.texto, raw.descricao, raw.description, raw.note, raw.notes);
  if (!texto) return null;
  const createdAt = toIsoOrNull(raw.createdAt || raw.criadoEm || raw.dataCriacao) || new Date().toISOString();
  const updatedAt = toIsoOrNull(raw.updatedAt || raw.atualizadoEm || raw.dataAtualizacao) || null;
  const record = {
    id,
    _id: id,
    titulo: titulo || '',
    observacao: texto,
    createdAt,
  };
  if (updatedAt) {
    record.updatedAt = updatedAt;
  }
  return record;
}

function persistObservacoesForSelection() {
  const key = getObservacaoStorageKey(state.selectedCliente?._id, state.selectedPetId);
  if (!key) return;
  try {
    if (Array.isArray(state.observacoes) && state.observacoes.length) {
      localStorage.setItem(key, JSON.stringify(state.observacoes));
    } else {
      localStorage.removeItem(key);
    }
  } catch {
    // ignore persistence errors
  }
}

export function loadObservacoesForSelection() {
  const clienteId = state.selectedCliente?._id;
  const petId = state.selectedPetId;
  const key = getObservacaoStorageKey(clienteId, petId);
  if (!key) {
    state.observacoes = [];
    return;
  }
  if (isFinalizadoSelection(clienteId, petId)) {
    state.observacoes = [];
    try {
      localStorage.removeItem(key);
    } catch {
      // ignore storage errors
    }
    return;
  }
  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      state.observacoes = [];
      return;
    }
    const parsed = JSON.parse(raw);
    const normalized = Array.isArray(parsed)
      ? parsed.map(normalizeObservacaoRecord).filter(Boolean)
      : [];
    normalized.sort((a, b) => {
      const aTime = a?.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bTime = b?.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bTime - aTime;
    });
    state.observacoes = normalized;
  } catch (error) {
    console.error('loadObservacoesForSelection', error);
    state.observacoes = [];
  }
}

function ensureObservacaoModal() {
  if (observacaoModal.overlay) return observacaoModal;

  const overlay = document.createElement('div');
  overlay.id = 'vet-observacao-modal';
  overlay.className = 'hidden fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4';
  overlay.setAttribute('aria-hidden', 'true');

  const dialog = document.createElement('div');
  dialog.className = 'w-full max-w-lg rounded-xl bg-white shadow-xl focus:outline-none';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.tabIndex = -1;
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
  title.textContent = 'Nova observação';
  titleWrap.appendChild(title);

  const subtitle = document.createElement('p');
  subtitle.className = 'text-sm text-gray-600';
  subtitle.textContent = 'Registre observações rápidas sobre o atendimento.';
  titleWrap.appendChild(subtitle);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'h-8 w-8 grid place-content-center rounded-lg bg-gray-100 text-gray-500 transition hover:text-gray-700';
  closeBtn.innerHTML = '<i class="fas fa-xmark"></i>';
  header.appendChild(closeBtn);

  const fieldsWrapper = document.createElement('div');
  fieldsWrapper.className = 'grid gap-4';
  form.appendChild(fieldsWrapper);

  const nameField = document.createElement('div');
  nameField.className = 'grid gap-2';
  fieldsWrapper.appendChild(nameField);

  const nameLabel = document.createElement('label');
  nameLabel.className = 'text-sm font-medium text-gray-700';
  nameLabel.textContent = 'Nome principal da observação';
  const nameInputId = 'vet-observacao-titulo';
  nameLabel.setAttribute('for', nameInputId);
  nameField.appendChild(nameLabel);

  const nameInput = document.createElement('input');
  nameInput.id = nameInputId;
  nameInput.type = 'text';
  nameInput.placeholder = 'Ex.: Pós-operatório';
  nameInput.className = 'rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-amber-500';
  nameField.appendChild(nameInput);

  const textField = document.createElement('div');
  textField.className = 'grid gap-2';
  fieldsWrapper.appendChild(textField);

  const textLabel = document.createElement('label');
  textLabel.className = 'text-sm font-medium text-gray-700';
  textLabel.textContent = 'Observação';
  const textInputId = 'vet-observacao-texto';
  textLabel.setAttribute('for', textInputId);
  textField.appendChild(textLabel);

  const textInput = document.createElement('textarea');
  textInput.id = textInputId;
  textInput.rows = 5;
  textInput.placeholder = 'Descreva a observação...';
  textInput.className = 'rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-amber-500';
  textField.appendChild(textInput);

  const footer = document.createElement('div');
  footer.className = 'flex items-center justify-end gap-2 border-t border-gray-200 pt-3';
  form.appendChild(footer);

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50';
  cancelBtn.innerHTML = '<i class="fas fa-xmark"></i><span>Cancelar</span>';
  footer.appendChild(cancelBtn);

  const submitBtn = document.createElement('button');
  submitBtn.type = 'submit';
  submitBtn.className = 'inline-flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-amber-700 focus:outline-none focus:ring-2 focus:ring-amber-200';
  submitBtn.innerHTML = '<i class="fas fa-save"></i><span>Salvar observação</span>';
  footer.appendChild(submitBtn);

  const handleClose = (event) => {
    event.preventDefault();
    closeObservacaoModal();
  };

  closeBtn.addEventListener('click', handleClose);
  cancelBtn.addEventListener('click', handleClose);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) {
      closeObservacaoModal();
    }
  });

  form.addEventListener('submit', handleObservacaoSubmit);

  document.body.appendChild(overlay);

  observacaoModal.overlay = overlay;
  observacaoModal.dialog = dialog;
  observacaoModal.form = form;
  observacaoModal.titleInput = nameInput;
  observacaoModal.textInput = textInput;
  observacaoModal.submitBtn = submitBtn;
  if (submitBtn && !observacaoModal.submitDefaultText) {
    observacaoModal.submitDefaultText = submitBtn.textContent || submitBtn.innerText || 'Salvar observa??o';
  }
  observacaoModal.cancelBtn = cancelBtn;
  observacaoModal.closeBtn = closeBtn;

  return observacaoModal;
}

function resetObservacaoModal() {
  if (observacaoModal.titleInput) observacaoModal.titleInput.value = '';
  if (observacaoModal.textInput) observacaoModal.textInput.value = '';
  if (observacaoModal.submitBtn) {
    observacaoModal.submitBtn.disabled = false;
    observacaoModal.submitBtn.classList.remove('opacity-60', 'cursor-not-allowed');
    const baseText = observacaoModal.submitDefaultText || 'Salvar observa??o';
    observacaoModal.submitBtn.textContent = baseText;
  }
  if (observacaoModal.cancelBtn) {
    observacaoModal.cancelBtn.disabled = false;
    observacaoModal.cancelBtn.classList.remove('opacity-50', 'cursor-not-allowed');
  }
  observacaoModal.mode = 'create';
  observacaoModal.editingId = null;
}

function setObservacaoModalSubmitting(isSubmitting) {
  if (observacaoModal.submitBtn) {
    observacaoModal.submitBtn.disabled = !!isSubmitting;
    observacaoModal.submitBtn.classList.toggle('opacity-60', !!isSubmitting);
    observacaoModal.submitBtn.classList.toggle('cursor-not-allowed', !!isSubmitting);
  }
  if (observacaoModal.cancelBtn) {
    observacaoModal.cancelBtn.disabled = !!isSubmitting;
    observacaoModal.cancelBtn.classList.toggle('opacity-50', !!isSubmitting);
    observacaoModal.cancelBtn.classList.toggle('cursor-not-allowed', !!isSubmitting);
  }
  if (observacaoModal.textInput) {
    observacaoModal.textInput.disabled = !!isSubmitting;
  }
  if (observacaoModal.titleInput) {
    observacaoModal.titleInput.disabled = !!isSubmitting;
  }
}

function focusFirstField() {
  if (observacaoModal.titleInput) {
    observacaoModal.titleInput.focus();
    observacaoModal.titleInput.setSelectionRange(0, observacaoModal.titleInput.value.length);
    return;
  }
  if (observacaoModal.textInput) {
    observacaoModal.textInput.focus();
  }
}

export function openObservacaoModal(record = null) {
  if (!ensureObservacaoSelection()) return;
  const modal = ensureObservacaoModal();
  resetObservacaoModal();

  let isEdit = false;
  const recordId = record && typeof record === 'object' ? normalizeId(record.id || record._id) : null;
  if (record && recordId) {
    isEdit = true;
    observacaoModal.mode = 'edit';
    observacaoModal.editingId = recordId;
    if (observacaoModal.titleInput) {
      observacaoModal.titleInput.value = record.titulo ? String(record.titulo) : '';
    }
    if (observacaoModal.textInput) {
      observacaoModal.textInput.value = record.observacao ? String(record.observacao) : '';
    }
    if (observacaoModal.submitBtn) {
      const baseText = observacaoModal.submitDefaultText || 'Salvar observa??o';
      observacaoModal.submitBtn.textContent = baseText.replace(/Salvar/i, 'Atualizar');
    }
  }

  if (!modal || !modal.overlay) return;
  modal.overlay.classList.remove('hidden');
  modal.overlay.setAttribute('aria-hidden', 'false');
  setTimeout(() => {
    focusFirstField();
  }, 0);
  if (modal.dialog) {
    modal.dialog.focus();
  }
  if (modal.keydownHandler) {
    document.removeEventListener('keydown', modal.keydownHandler);
  }
  modal.keydownHandler = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeObservacaoModal();
    }
  };
  document.addEventListener('keydown', modal.keydownHandler);
}

export function closeObservacaoModal() {
  if (!observacaoModal.overlay) return;
  observacaoModal.overlay.classList.add('hidden');
  observacaoModal.overlay.setAttribute('aria-hidden', 'true');
  if (observacaoModal.keydownHandler) {
    document.removeEventListener('keydown', observacaoModal.keydownHandler);
    observacaoModal.keydownHandler = null;
  }
  if (observacaoModal.titleInput) observacaoModal.titleInput.disabled = false;
  if (observacaoModal.textInput) observacaoModal.textInput.disabled = false;
  observacaoModal.mode = 'create';
  observacaoModal.editingId = null;
}

function handleObservacaoSubmit(event) {
  event.preventDefault();
  if (!ensureObservacaoSelection()) return;
  if (!observacaoModal.textInput) return;
  const titulo = observacaoModal.titleInput ? observacaoModal.titleInput.value.trim() : '';
  const texto = observacaoModal.textInput.value.trim();
  if (!texto) {
    notify('Preencha a observa??o antes de salvar.', 'warning');
    observacaoModal.textInput.focus();
    return;
  }

  setObservacaoModalSubmitting(true);
  try {
    const isEdit = observacaoModal.mode === 'edit' && observacaoModal.editingId;
    if (isEdit) {
      const targetId = observacaoModal.editingId;
      const list = Array.isArray(state.observacoes) ? [...state.observacoes] : [];
      const idx = list.findIndex((item) => normalizeId(item?.id || item?._id) === targetId);
      if (idx === -1) {
        throw new Error('N?o foi poss?vel localizar a observa??o selecionada.');
      }
      const current = list[idx] || {};
      const updated = {
        ...current,
        titulo,
        observacao: texto,
        updatedAt: new Date().toISOString(),
      };
      list[idx] = updated;
      state.observacoes = list;
      persistObservacoesForSelection();
      updateConsultaAgendaCard();
      emitFichaClinicaUpdate(
        buildObservacaoEventPayload({
          scope: 'observacao',
          action: 'update',
          observacaoId: targetId || null,
          observacao: safeClone(updated),
          snapshot: safeClone(state.observacoes),
        }),
      ).catch(() => {});
      closeObservacaoModal();
      notify('Observa??o atualizada com sucesso.', 'success');
      return;
    }

    const record = {
      id: generateObservacaoId(),
      titulo,
      observacao: texto,
      createdAt: new Date().toISOString(),
    };
    state.observacoes = [record, ...(Array.isArray(state.observacoes) ? state.observacoes : [])];
    persistObservacoesForSelection();
    updateConsultaAgendaCard();
    emitFichaClinicaUpdate(
      buildObservacaoEventPayload({
        scope: 'observacao',
        action: 'create',
        observacaoId: record.id || null,
        observacao: safeClone(record),
        snapshot: safeClone(state.observacoes),
      }),
    ).catch(() => {});
    closeObservacaoModal();
    notify('Observa??o salva com sucesso.', 'success');
  } catch (error) {
    console.error('handleObservacaoSubmit', error);
    notify(error.message || 'N?o foi poss?vel salvar a observa??o.', 'error');
  } finally {
    setObservacaoModalSubmitting(false);
  }
}

export function deleteObservacao(observacao, options = {}) {
  const { suppressNotify = false } = options || {};
  const targetId = normalizeId(observacao && typeof observacao === 'object' ? observacao.id || observacao._id : observacao);
  if (!targetId) return Promise.resolve(false);
  const current = Array.isArray(state.observacoes) ? state.observacoes : [];
  const filtered = current.filter((item) => normalizeId(item?.id || item?._id) !== targetId);
  if (filtered.length === current.length) return Promise.resolve(false);
  state.observacoes = filtered;
  persistObservacoesForSelection();
  updateConsultaAgendaCard();
  emitFichaClinicaUpdate(
    buildObservacaoEventPayload({
      scope: 'observacao',
      action: 'delete',
      observacaoId: targetId,
      snapshot: safeClone(state.observacoes),
    }),
  ).catch(() => {});
  if (!suppressNotify) {
    notify('Observação removida com sucesso.', 'success');
  }
  return Promise.resolve(true);
}

state.deleteObservacao = deleteObservacao;

export function handleObservacaoRealTimeEvent(event = {}) {
  if (!event || typeof event !== 'object') return false;
  if (event.scope && event.scope !== 'observacao') return false;

  const targetClienteId = normalizeId(event.clienteId || event.tutorId || event.cliente);
  const targetPetId = normalizeId(event.petId || event.pet);
  const targetAppointmentId = normalizeId(event.appointmentId || event.agendamentoId || event.appointment);

  const currentClienteId = normalizeId(state.selectedCliente?._id);
  const currentPetId = normalizeId(state.selectedPetId);
  const currentAppointmentId = normalizeId(state.agendaContext?.appointmentId);

  if (targetClienteId && currentClienteId && targetClienteId !== currentClienteId) return false;
  if (targetPetId && currentPetId && targetPetId !== currentPetId) return false;
  if (targetAppointmentId && currentAppointmentId && targetAppointmentId !== currentAppointmentId) return false;

  const snapshot = extractObservacoesSnapshot(event);
  if (snapshot) {
    return applyObservacoesSnapshot(snapshot);
  }

  const action = String(event.action || '').toLowerCase();

  if (action === 'delete') {
    const observacaoId = normalizeId(event.observacaoId || event.id || event.recordId);
    if (!observacaoId) return false;
    const previous = Array.isArray(state.observacoes) ? state.observacoes : [];
    const next = previous.filter((item) => normalizeId(item?.id || item?._id) !== observacaoId);
    if (next.length === previous.length) return false;
    state.observacoes = next;
    persistObservacoesForSelection();
    updateConsultaAgendaCard();
    return true;
  }

  const payload = event.observacao || event.record || event.data;
  if (!payload || typeof payload !== 'object') return false;

  const record = normalizeObservacaoRecord({
    ...payload,
    id: payload.id || payload._id || event.observacaoId || event.id || event.recordId,
  });
  if (!record) return false;

  const recordId = normalizeId(record.id || record._id);
  const list = Array.isArray(state.observacoes) ? [...state.observacoes] : [];
  let replaced = false;

  for (let i = 0; i < list.length; i += 1) {
    const entry = list[i] || {};
    const entryId = normalizeId(entry.id || entry._id);
    if (!entryId || !recordId || entryId !== recordId) continue;
    const createdAt = record.createdAt || entry.createdAt || new Date().toISOString();
    list[i] = {
      ...entry,
      ...record,
      id: recordId,
      _id: recordId,
      createdAt,
    };
    replaced = true;
    break;
  }

  if (!replaced) {
    list.unshift({ ...record, id: recordId, _id: recordId });
  }

  const ordered = sortObservacoesByCreatedAt(list);
  const current = Array.isArray(state.observacoes) ? state.observacoes : [];
  if (areObservacoesEqual(current, ordered)) return false;

  state.observacoes = ordered;
  persistObservacoesForSelection();
  updateConsultaAgendaCard();
  return true;
}
