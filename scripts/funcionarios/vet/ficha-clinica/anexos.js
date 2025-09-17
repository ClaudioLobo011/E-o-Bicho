// Anexo modal and storage handling for the Vet ficha clínica
import {
  state,
  api,
  notify,
  pickFirst,
  normalizeId,
  toIsoOrNull,
  getFileExtension,
  formatFileSize,
  anexoModal,
  ANEXO_ALLOWED_EXTENSIONS,
  ANEXO_ALLOWED_MIME_TYPES,
  ANEXO_STORAGE_PREFIX,
  getAuthToken,
} from './core.js';
import { getConsultasKey, ensureTutorAndPetSelected, updateConsultaAgendaCard } from './consultas.js';

function generateAnexoId() {
  return `anx-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

function generateAnexoFileId() {
  return `anx-file-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

function isAllowedAnexoFile(file) {
  if (!file) return false;
  const extension = getFileExtension(file.name);
  if (extension && ANEXO_ALLOWED_EXTENSIONS.includes(extension)) return true;
  const mime = String(file.type || '').toLowerCase();
  if (mime && ANEXO_ALLOWED_MIME_TYPES.some((type) => mime === type)) return true;
  return false;
}

function normalizeAnexoFileRecord(raw, fallback = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const fallbackSource = fallback && typeof fallback === 'object' ? fallback : {};
  const id = normalizeId(source.id || source._id || fallbackSource.id || fallbackSource._id) || generateAnexoFileId();
  const nome = pickFirst(
    source.nome,
    source.name,
    fallbackSource.nome,
    fallbackSource.name,
    fallbackSource.displayName,
  );
  const originalName = pickFirst(
    source.originalName,
    source.arquivoNomeOriginal,
    source.fileName,
    source.filename,
    fallbackSource.originalName,
  );
  const mimeType = pickFirst(source.mimeType, source.contentType, source.tipo, fallbackSource.mimeType);
  const sizeCandidate = Number(source.tamanho ?? source.size ?? source.bytes ?? fallbackSource.size);
  const size = Number.isFinite(sizeCandidate) && sizeCandidate >= 0 ? sizeCandidate : 0;
  const url = pickFirst(source.url, source.link, source.downloadUrl, source.webViewLink, fallbackSource.url);
  let extension = pickFirst(source.extensao, source.extension, fallbackSource.extension);
  if (!extension && (originalName || nome)) {
    extension = getFileExtension(originalName || nome);
  }
  if (extension) {
    extension = String(extension).toLowerCase();
    if (extension && !extension.startsWith('.')) extension = `.${extension}`;
  }
  const createdAt = toIsoOrNull(source.createdAt || source.uploadedAt || fallbackSource.createdAt);

  return {
    id,
    _id: id,
    nome: nome || originalName || 'Arquivo',
    originalName: originalName || nome || '',
    mimeType: mimeType || '',
    size,
    url: url || '',
    extension: extension || '',
    createdAt,
  };
}

function mergeAnexoFiles(existing = [], incoming = []) {
  const list = [];
  const map = new Map();
  const push = (item) => {
    const normalized = normalizeAnexoFileRecord(item);
    if (!normalized) return;
    const key = normalizeId(normalized.id || normalized._id) || `${normalized.nome}|${normalized.originalName}|${normalized.url}`;
    const previous = map.get(key);
    if (previous) {
      const merged = {
        ...previous,
        ...normalized,
      };
      if (!merged.url && normalized.url) merged.url = normalized.url;
      if (!merged.mimeType && normalized.mimeType) merged.mimeType = normalized.mimeType;
      if (!merged.size && normalized.size) merged.size = normalized.size;
      if (!merged.extension && normalized.extension) merged.extension = normalized.extension;
      if (!merged.createdAt) merged.createdAt = normalized.createdAt;
      map.set(key, merged);
    } else {
      map.set(key, normalized);
    }
  };
  (Array.isArray(existing) ? existing : []).forEach(push);
  (Array.isArray(incoming) ? incoming : []).forEach(push);
  map.forEach((value) => list.push(value));
  list.sort((a, b) => {
    const aTime = a?.createdAt ? new Date(a.createdAt).getTime() : 0;
    const bTime = b?.createdAt ? new Date(b.createdAt).getTime() : 0;
    return bTime - aTime;
  });
  return list;
}

function normalizeAnexoRecord(raw, fallbackFiles = []) {
  if (!raw && (!fallbackFiles || !fallbackFiles.length)) return null;
  const source = raw && typeof raw === 'object' ? raw : {};
  const arquivosRaw = Array.isArray(source.arquivos)
    ? source.arquivos
    : (Array.isArray(source.files) ? source.files : (Array.isArray(source.anexos) ? source.anexos : []));
  const fallbackList = Array.isArray(fallbackFiles) ? fallbackFiles : [];
  const arquivos = mergeAnexoFiles(arquivosRaw, fallbackList);
  if (!arquivos.length && !fallbackList.length) return null;

  const id = normalizeId(source.id || source._id || source.uid || source.key) || generateAnexoId();
  const createdAt = toIsoOrNull(source.createdAt || source.criadoEm || source.dataCriacao) || new Date().toISOString();
  const updatedAt = toIsoOrNull(source.updatedAt || source.atualizadoEm || source.dataAtualizacao) || createdAt;

  return {
    id,
    _id: id,
    clienteId: normalizeId(source.clienteId || source.cliente),
    petId: normalizeId(source.petId || source.pet),
    appointmentId: normalizeId(source.appointmentId || source.appointment),
    observacao: typeof source.observacao === 'string' ? source.observacao.trim() : '',
    createdAt,
    updatedAt,
    arquivos,
  };
}

function getAnexoStorageKey(clienteId, petId) {
  const base = getConsultasKey(clienteId, petId);
  return base ? `${ANEXO_STORAGE_PREFIX}${base}` : null;
}

function persistAnexosForSelection() {
  const key = getAnexoStorageKey(state.selectedCliente?._id, state.selectedPetId);
  if (!key) return;
  try {
    if (Array.isArray(state.anexos) && state.anexos.length) {
      localStorage.setItem(key, JSON.stringify(state.anexos));
    } else {
      localStorage.removeItem(key);
    }
  } catch {
    // ignore persistence errors
  }
}

export function loadAnexosForSelection() {
  const key = getAnexoStorageKey(state.selectedCliente?._id, state.selectedPetId);
  if (!key) {
    state.anexos = [];
    return;
  }
  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      state.anexos = [];
      return;
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      state.anexos = [];
      return;
    }
    const normalized = parsed.map((item) => normalizeAnexoRecord(item)).filter(Boolean);
    normalized.sort((a, b) => {
      const aTime = a?.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bTime = b?.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bTime - aTime;
    });
    state.anexos = normalized;
  } catch {
    state.anexos = [];
  }
}

function upsertAnexoInState(record, fallbackFiles = []) {
  const normalized = normalizeAnexoRecord(record, fallbackFiles);
  if (!normalized) return null;
  const id = normalizeId(normalized.id || normalized._id);
  if (!id) return null;

  const next = Array.isArray(state.anexos) ? [...state.anexos] : [];
  const idx = next.findIndex((item) => normalizeId(item?.id || item?._id) === id);
  const incomingFiles = Array.isArray(normalized.arquivos) ? mergeAnexoFiles([], normalized.arquivos) : [];
  const payload = {
    ...normalized,
    id,
    _id: id,
    createdAt: toIsoOrNull(normalized.createdAt) || new Date().toISOString(),
    arquivos: incomingFiles,
  };

  if (idx >= 0) {
    const existing = next[idx];
    payload.arquivos = mergeAnexoFiles(existing?.arquivos, incomingFiles);
    next[idx] = { ...existing, ...payload };
  } else {
    next.unshift(payload);
  }

  const deduped = [];
  const seen = new Set();
  next.forEach((item) => {
    const itemId = normalizeId(item?.id || item?._id);
    if (!itemId || seen.has(itemId)) return;
    seen.add(itemId);
    const createdAt = toIsoOrNull(item.createdAt) || new Date().toISOString();
    deduped.push({
      ...item,
      id: itemId,
      _id: itemId,
      createdAt,
      arquivos: mergeAnexoFiles([], item.arquivos || []),
    });
  });

  deduped.sort((a, b) => {
    const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return bTime - aTime;
  });

  state.anexos = deduped;
  const key = getConsultasKey(state.selectedCliente?._id, state.selectedPetId);
  if (key) state.anexosLoadKey = key;

  return deduped.find((item) => normalizeId(item?.id || item?._id) === id) || payload;
}

export async function loadAnexosFromServer(options = {}) {
  const { force = false } = options || {};
  const clienteId = normalizeId(state.selectedCliente?._id);
  const petId = normalizeId(state.selectedPetId);

  if (!(clienteId && petId)) {
    state.anexos = [];
    state.anexosLoadKey = null;
    state.anexosLoading = false;
    updateConsultaAgendaCard();
    return;
  }

  const key = getConsultasKey(clienteId, petId);
  if (!force && key && state.anexosLoadKey === key) return;

  state.anexosLoading = true;
  updateConsultaAgendaCard();

  try {
    const params = new URLSearchParams({ clienteId, petId });
    const appointmentId = normalizeId(state.agendaContext?.appointmentId);
    if (appointmentId) params.set('appointmentId', appointmentId);

    const resp = await api(`/func/vet/anexos?${params.toString()}`);
    const payload = await resp.json().catch(() => (resp.ok ? [] : {}));
    if (!resp.ok) {
      const message = typeof payload?.message === 'string' ? payload.message : 'Erro ao carregar anexos.';
      throw new Error(message);
    }

    const data = Array.isArray(payload) ? payload : [];
    const normalized = data.map((item) => normalizeAnexoRecord(item)).filter(Boolean);
    normalized.sort((a, b) => {
      const aTime = a?.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bTime = b?.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bTime - aTime;
    });

    state.anexos = normalized;
    state.anexosLoadKey = key;
  } catch (error) {
    console.error('loadAnexosFromServer', error);
    state.anexos = [];
    state.anexosLoadKey = null;
    notify(error.message || 'Erro ao carregar anexos.', 'error');
  } finally {
    state.anexosLoading = false;
    updateConsultaAgendaCard();
  }
}

function updateAnexoDropzoneText() {
  if (!anexoModal.dropzoneText || !anexoModal.dropzoneHint) return;
  if (anexoModal.pendingFile) {
    anexoModal.dropzoneText.textContent = anexoModal.pendingFile.name;
    const details = [];
    const extension = getFileExtension(anexoModal.pendingFile.name).replace('.', '').toUpperCase();
    if (extension) details.push(extension);
    const size = formatFileSize(anexoModal.pendingFile.size);
    if (size) details.push(size);
    anexoModal.dropzoneHint.textContent = details.length ? details.join(' · ') : '';
  } else {
    anexoModal.dropzoneText.textContent = 'Arraste o arquivo aqui ou clique para selecionar';
    anexoModal.dropzoneHint.textContent = 'Formatos aceitos: PNG, JPG, JPEG ou PDF.';
  }
}

function refreshAnexoModalControls() {
  const hasPendingFile = !!anexoModal.pendingFile;
  const nameValue = (anexoModal.nameInput?.value || '').trim();
  const canAdd = hasPendingFile && !!nameValue && !anexoModal.isSubmitting;
  if (anexoModal.addBtn) {
    anexoModal.addBtn.disabled = !canAdd;
    anexoModal.addBtn.classList.toggle('opacity-50', anexoModal.addBtn.disabled);
    anexoModal.addBtn.classList.toggle('cursor-not-allowed', anexoModal.addBtn.disabled);
  }
  const hasSelected = Array.isArray(anexoModal.selectedFiles) && anexoModal.selectedFiles.length > 0;
  const submitDisabled = anexoModal.isSubmitting || !hasSelected;
  if (anexoModal.submitBtn) {
    anexoModal.submitBtn.disabled = submitDisabled;
    anexoModal.submitBtn.classList.toggle('opacity-60', anexoModal.isSubmitting);
    anexoModal.submitBtn.classList.toggle('cursor-not-allowed', submitDisabled);
    anexoModal.submitBtn.textContent = anexoModal.isSubmitting ? 'Salvando...' : 'Salvar';
  }
  if (anexoModal.cancelBtn) {
    anexoModal.cancelBtn.disabled = anexoModal.isSubmitting;
    anexoModal.cancelBtn.classList.toggle('opacity-50', anexoModal.isSubmitting);
    anexoModal.cancelBtn.classList.toggle('cursor-not-allowed', anexoModal.isSubmitting);
  }
  if (anexoModal.nameInput) anexoModal.nameInput.disabled = anexoModal.isSubmitting;
  if (anexoModal.fileInput) anexoModal.fileInput.disabled = anexoModal.isSubmitting;
}

function setAnexoModalSubmitting(isSubmitting) {
  anexoModal.isSubmitting = !!isSubmitting;
  refreshAnexoModalControls();
}

function setAnexoPendingFile(file) {
  anexoModal.pendingFile = file || null;
  if (!file && anexoModal.fileInput) {
    anexoModal.fileInput.value = '';
  }
  if (file && anexoModal.nameInput) {
    const current = anexoModal.nameInput.value.trim();
    if (!current) {
      const ext = getFileExtension(file.name);
      const base = ext ? file.name.slice(0, -ext.length) : file.name;
      anexoModal.nameInput.value = base || file.name;
    }
  }
  updateAnexoDropzoneText();
  refreshAnexoModalControls();
}

function updateAnexoFilesGrid() {
  const list = anexoModal.filesList;
  const empty = anexoModal.emptyState;
  if (!list) return;
  list.innerHTML = '';
  const files = Array.isArray(anexoModal.selectedFiles) ? anexoModal.selectedFiles : [];
  if (!files.length) {
    if (empty) empty.classList.remove('hidden');
    refreshAnexoModalControls();
    return;
  }
  if (empty) empty.classList.add('hidden');

  files.forEach((entry) => {
    const row = document.createElement('div');
    row.className = 'flex flex-col gap-2 rounded-lg border border-indigo-100 bg-white px-3 py-3 shadow-sm sm:flex-row sm:items-center sm:justify-between';
    list.appendChild(row);

    const info = document.createElement('div');
    info.className = 'flex items-start gap-3 text-sm text-indigo-700';
    row.appendChild(info);

    const icon = document.createElement('div');
    icon.className = 'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-indigo-200 bg-indigo-50 text-indigo-600';
    icon.innerHTML = '<i class="fas fa-file"></i>';
    info.appendChild(icon);

    const textWrap = document.createElement('div');
    textWrap.className = 'min-w-0';
    info.appendChild(textWrap);

    const nameEl = document.createElement('p');
    nameEl.className = 'font-semibold leading-tight text-indigo-700 break-words';
    nameEl.textContent = entry.name;
    textWrap.appendChild(nameEl);

    const meta = document.createElement('p');
    meta.className = 'text-xs text-indigo-500';
    const parts = [];
    if (entry.originalName && entry.originalName !== entry.name) parts.push(entry.originalName);
    if (entry.extension) parts.push(entry.extension.replace('.', '').toUpperCase());
    if (entry.size) parts.push(formatFileSize(entry.size));
    meta.textContent = parts.length ? parts.join(' · ') : '—';
    textWrap.appendChild(meta);

    const actions = document.createElement('div');
    actions.className = 'flex items-center gap-2';
    row.appendChild(actions);

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'inline-flex items-center gap-1 rounded-md border border-transparent px-3 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-50';
    removeBtn.innerHTML = '<i class="fas fa-trash-can"></i><span>Remover</span>';
    removeBtn.addEventListener('click', (event) => {
      event.preventDefault();
      anexoModal.selectedFiles = anexoModal.selectedFiles.filter((file) => file.id !== entry.id);
      updateAnexoFilesGrid();
      refreshAnexoModalControls();
    });
    actions.appendChild(removeBtn);
  });

  refreshAnexoModalControls();
}

export function ensureAnexoModal() {
  if (anexoModal.overlay) return anexoModal;

  const overlay = document.createElement('div');
  overlay.id = 'vet-anexo-modal';
  overlay.className = 'hidden fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4';
  overlay.setAttribute('aria-hidden', 'true');

  const dialog = document.createElement('div');
  dialog.className = 'w-full max-w-3xl rounded-xl bg-white shadow-xl focus:outline-none';
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
  title.textContent = 'Novo anexo';
  header.appendChild(title);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'text-gray-400 transition hover:text-gray-600';
  closeBtn.innerHTML = '<i class="fas fa-xmark"></i>';
  closeBtn.addEventListener('click', (event) => {
    event.preventDefault();
    closeAnexoModal();
  });
  header.appendChild(closeBtn);

  const fieldsWrapper = document.createElement('div');
  fieldsWrapper.className = 'grid gap-4';
  form.appendChild(fieldsWrapper);

  const contextInfo = document.createElement('div');
  contextInfo.className = 'hidden rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm text-indigo-700';
  fieldsWrapper.appendChild(contextInfo);

  const row = document.createElement('div');
  row.className = 'grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]';
  fieldsWrapper.appendChild(row);

  const nameWrapper = document.createElement('div');
  nameWrapper.className = 'flex flex-col gap-2';
  row.appendChild(nameWrapper);

  const nameLabel = document.createElement('label');
  nameLabel.className = 'text-sm font-medium text-gray-700';
  nameLabel.textContent = 'Nome do arquivo';
  nameWrapper.appendChild(nameLabel);

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.placeholder = 'Informe um nome para o arquivo';
  nameInput.className = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200';
  nameWrapper.appendChild(nameInput);

  const fileWrapper = document.createElement('div');
  fileWrapper.className = 'flex flex-col gap-2';
  row.appendChild(fileWrapper);

  const fileLabel = document.createElement('label');
  fileLabel.className = 'text-sm font-medium text-gray-700';
  fileLabel.textContent = 'Arquivo';
  fileWrapper.appendChild(fileLabel);

  const dropzone = document.createElement('label');
  dropzone.className = 'flex h-32 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-indigo-300 bg-indigo-50 text-sm text-indigo-600';
  dropzone.innerHTML = '<span id="vet-anexo-dropzone-text">Arraste o arquivo aqui ou clique para selecionar</span><span id="vet-anexo-dropzone-hint" class="text-xs text-indigo-500">Formatos aceitos: PNG, JPG, JPEG ou PDF.</span>';
  fileWrapper.appendChild(dropzone);

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = ANEXO_ALLOWED_EXTENSIONS.join(',');
  fileInput.className = 'hidden';
  dropzone.appendChild(fileInput);

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'self-start rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-400';
  addBtn.textContent = 'Adicionar';
  row.appendChild(addBtn);

  const listWrapper = document.createElement('div');
  listWrapper.className = 'grid gap-4';
  fieldsWrapper.appendChild(listWrapper);

  const filesList = document.createElement('div');
  filesList.className = 'space-y-3';
  listWrapper.appendChild(filesList);

  const emptyState = document.createElement('div');
  emptyState.className = 'rounded-lg border border-indigo-100 bg-indigo-50 px-3 py-6 text-center text-sm text-indigo-600';
  emptyState.textContent = 'Nenhum arquivo selecionado ainda.';
  listWrapper.appendChild(emptyState);

  const footer = document.createElement('div');
  footer.className = 'flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:items-center sm:justify-end sm:gap-3';
  form.appendChild(footer);

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'w-full rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 sm:w-auto';
  cancelBtn.textContent = 'Cancelar';
  cancelBtn.addEventListener('click', (event) => {
    event.preventDefault();
    closeAnexoModal();
  });
  footer.appendChild(cancelBtn);

  const submitBtn = document.createElement('button');
  submitBtn.type = 'submit';
  submitBtn.className = 'w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-400 sm:w-auto';
  submitBtn.textContent = 'Salvar';
  footer.appendChild(submitBtn);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    await handleAnexoSubmit();
  });

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) {
      event.preventDefault();
      closeAnexoModal();
    }
  });

  dropzone.addEventListener('dragover', (event) => {
    event.preventDefault();
    dropzone.classList.add('border-indigo-500', 'bg-indigo-100');
  });
  dropzone.addEventListener('dragleave', (event) => {
    event.preventDefault();
    dropzone.classList.remove('border-indigo-500', 'bg-indigo-100');
  });
  dropzone.addEventListener('drop', (event) => {
    event.preventDefault();
    dropzone.classList.remove('border-indigo-500', 'bg-indigo-100');
    const file = event.dataTransfer?.files?.[0] || null;
    if (file) {
      handleAnexoFileSelection(file);
    }
  });

  dropzone.addEventListener('click', (event) => {
    event.preventDefault();
    if (anexoModal.fileInput) {
      anexoModal.fileInput.click();
    }
  });

  fileInput.addEventListener('change', (event) => {
    const file = event.target.files?.[0] || null;
    handleAnexoFileSelection(file);
  });

  addBtn.addEventListener('click', (event) => {
    event.preventDefault();
    handleAnexoAdd();
  });

  document.body.appendChild(overlay);

  anexoModal.overlay = overlay;
  anexoModal.dialog = dialog;
  anexoModal.form = form;
  anexoModal.titleEl = title;
  anexoModal.submitBtn = submitBtn;
  anexoModal.cancelBtn = cancelBtn;
  anexoModal.addBtn = addBtn;
  anexoModal.nameInput = nameInput;
  anexoModal.fileInput = fileInput;
  anexoModal.dropzone = dropzone;
  anexoModal.dropzoneText = document.getElementById('vet-anexo-dropzone-text');
  anexoModal.dropzoneHint = document.getElementById('vet-anexo-dropzone-hint');
  anexoModal.filesList = filesList;
  anexoModal.emptyState = emptyState;
  anexoModal.contextInfo = contextInfo;
  anexoModal.selectedFiles = [];
  anexoModal.pendingFile = null;

  return anexoModal;
}

export function closeAnexoModal() {
  if (!anexoModal.overlay) return;
  anexoModal.overlay.classList.add('hidden');
  anexoModal.overlay.setAttribute('aria-hidden', 'true');
  if (anexoModal.form) anexoModal.form.reset();
  anexoModal.selectedFiles = [];
  anexoModal.pendingFile = null;
  setAnexoPendingFile(null);
  updateAnexoFilesGrid();
  setAnexoModalSubmitting(false);
  if (anexoModal.keydownHandler) {
    document.removeEventListener('keydown', anexoModal.keydownHandler);
    anexoModal.keydownHandler = null;
  }
}

export function openAnexoModal() {
  if (!ensureTutorAndPetSelected()) {
    return;
  }

  const modal = ensureAnexoModal();
  setAnexoModalSubmitting(false);
  modal.selectedFiles = [];
  modal.pendingFile = null;
  updateAnexoDropzoneText();
  updateAnexoFilesGrid();

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
      closeAnexoModal();
    }
  };
  document.addEventListener('keydown', modal.keydownHandler);

  setTimeout(() => {
    if (modal.nameInput) {
      try { modal.nameInput.focus(); } catch { }
    }
  }, 50);
}

function handleAnexoFileSelection(file) {
  if (!file) {
    setAnexoPendingFile(null);
    return;
  }
  if (!isAllowedAnexoFile(file)) {
    notify('Formato de arquivo não permitido. Use PNG, JPG, JPEG ou PDF.', 'warning');
    setAnexoPendingFile(null);
    return;
  }
  setAnexoPendingFile(file);
}

function handleAnexoAdd() {
  const file = anexoModal.pendingFile;
  const name = (anexoModal.nameInput?.value || '').trim();
  if (!file || !name) {
    notify('Informe um nome e selecione um arquivo para adicionar.', 'warning');
    return;
  }
  const entry = {
    id: generateAnexoFileId(),
    name,
    originalName: file.name,
    size: Number(file.size || 0),
    mimeType: file.type || '',
    extension: getFileExtension(file.name),
    file,
  };
  if (!Array.isArray(anexoModal.selectedFiles)) {
    anexoModal.selectedFiles = [];
  }
  anexoModal.selectedFiles.push(entry);
  setAnexoPendingFile(null);
  updateAnexoFilesGrid();
  refreshAnexoModalControls();
}

async function handleAnexoSubmit() {
  const modal = ensureAnexoModal();
  if (modal.isSubmitting) return;

  if (!ensureTutorAndPetSelected()) {
    return;
  }

  const clienteId = normalizeId(state.selectedCliente?._id);
  const petId = normalizeId(state.selectedPetId);
  if (!(clienteId && petId)) {
    notify('Selecione um tutor e um pet para registrar anexos.', 'warning');
    return;
  }

  const files = Array.isArray(anexoModal.selectedFiles) ? anexoModal.selectedFiles : [];
  if (!files.length) {
    notify('Adicione ao menos um arquivo antes de salvar.', 'warning');
    return;
  }

  const formData = new FormData();
  formData.append('clienteId', clienteId);
  formData.append('petId', petId);
  const appointmentId = normalizeId(state.agendaContext?.appointmentId);
  if (appointmentId) formData.append('appointmentId', appointmentId);

  const fallbackFiles = [];
  files.forEach((entry) => {
    const file = entry.file;
    if (!file) return;
    const displayName = (entry.name || file.name || '').trim();
    formData.append('arquivos', file, file.name);
    formData.append('nomes[]', displayName || file.name);
    fallbackFiles.push({
      nome: displayName || file.name,
      originalName: entry.originalName || file.name,
      size: Number(entry.size || file.size || 0),
      mimeType: entry.mimeType || file.type || '',
      extension: entry.extension || getFileExtension(file.name),
    });
  });

  setAnexoModalSubmitting(true);

  try {
    const token = getAuthToken();
    const response = await fetch(`${API_CONFIG.BASE_URL}/func/vet/anexos`, {
      method: 'POST',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: formData,
    });
    const data = await response.json().catch(() => (response.ok ? {} : {}));
    if (!response.ok) {
      const message = typeof data?.message === 'string' ? data.message : 'Erro ao salvar anexos.';
      throw new Error(message);
    }

    let record = null;
    if (Array.isArray(data?.anexos)) {
      record = data.anexos.map((item) => normalizeAnexoRecord(item, fallbackFiles)).find(Boolean) || null;
    } else if (Array.isArray(data)) {
      record = data.map((item) => normalizeAnexoRecord(item, fallbackFiles)).find(Boolean) || null;
    } else {
      record = normalizeAnexoRecord(data, fallbackFiles);
    }
    if (!record && fallbackFiles.length) {
      record = normalizeAnexoRecord({ arquivos: fallbackFiles }, fallbackFiles);
    }

    const saved = upsertAnexoInState(record, fallbackFiles);
    if (!saved && fallbackFiles.length) {
      upsertAnexoInState({ arquivos: fallbackFiles }, fallbackFiles);
    }
    persistAnexosForSelection();
    updateConsultaAgendaCard();
    closeAnexoModal();
    notify('Anexos salvos com sucesso.', 'success');
    await loadAnexosFromServer({ force: true });
  } catch (error) {
    console.error('handleAnexoSubmit', error);
    notify(error.message || 'Erro ao salvar anexos.', 'error');
  } finally {
    setAnexoModalSubmitting(false);
  }
}
