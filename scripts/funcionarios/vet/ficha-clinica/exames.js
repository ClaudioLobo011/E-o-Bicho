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
  formatFileSize,
  exameModal,
  EXAME_STORAGE_PREFIX,
  EXAME_ATTACHMENT_OBSERVACAO_PREFIX,
  getAgendaStoreId,
  getPetPriceCriteria,
  persistAgendaContext,
  getFileExtension,
  ANEXO_ALLOWED_EXTENSIONS,
  ANEXO_ALLOWED_MIME_TYPES,
  getAuthToken,
  isFinalizadoSelection,
} from './core.js';
import { getConsultasKey, ensureTutorAndPetSelected, updateConsultaAgendaCard } from './consultas.js';
import { loadAnexosFromServer, deleteAnexo } from './anexos.js';
import { emitFichaClinicaUpdate } from './real-time.js';

const MIN_SEARCH_TERM_LENGTH = 2;

function generateExameId() {
  return `exm-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

function generateExameFileId() {
  return `exm-file-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

const EXAME_FILE_ID_PATTERN = /^exm-file-\d+-\d+$/;

function isGeneratedExameFileId(id) {
  return EXAME_FILE_ID_PATTERN.test(String(id || ''));
}

function isAllowedExameFile(file) {
  if (!file) return false;
  const extension = getFileExtension(file.name);
  if (extension && ANEXO_ALLOWED_EXTENSIONS.includes(extension)) return true;
  const mime = String(file.type || '').toLowerCase();
  if (mime && ANEXO_ALLOWED_MIME_TYPES.some((type) => mime === type)) return true;
  return false;
}

function sanitizeAttachmentName(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeAttachmentExtension(extension) {
  if (!extension) return '';
  const str = String(extension).trim().toLowerCase();
  if (!str) return '';
  return str.startsWith('.') ? str : `.${str}`;
}

function resolveExameAttachmentNames(entry = {}) {
  const file = entry && typeof entry === 'object' ? entry.file : null;
  const fileName =
    typeof entry.originalName === 'string' && entry.originalName
      ? entry.originalName
      : (file && typeof file.name === 'string' ? file.name : '');
  const normalizedFileName = String(fileName || '');
  const extension = normalizeAttachmentExtension(entry.extension || getFileExtension(normalizedFileName));

  const nameCandidates = [entry.providedName, entry.displayName, entry.name, entry.nome];
  let displayName = '';
  for (const candidate of nameCandidates) {
    const sanitized = sanitizeAttachmentName(candidate);
    if (sanitized) {
      displayName = sanitized;
      break;
    }
  }
  if (!displayName) {
    displayName = sanitizeAttachmentName(normalizedFileName) || 'Arquivo';
  }

  const uploadCandidates = [entry.uploadName, entry.fileName, displayName, sanitizeAttachmentName(normalizedFileName)];
  let uploadBase = '';
  for (const candidate of uploadCandidates) {
    const sanitized = sanitizeAttachmentName(candidate);
    if (sanitized) {
      uploadBase = sanitized;
      break;
    }
  }
  if (extension && uploadBase && uploadBase.toLowerCase().endsWith(extension)) {
    const withoutExt = uploadBase.slice(0, -extension.length);
    uploadBase = sanitizeAttachmentName(withoutExt);
  }
  if (!uploadBase) {
    const originalBase = sanitizeAttachmentName(normalizedFileName.replace(/\.[^.]+$/, ''));
    uploadBase = originalBase || 'arquivo';
  }

  let uploadName = uploadBase;
  if (extension) {
    if (!uploadName.toLowerCase().endsWith(extension)) {
      uploadName = `${uploadName}${extension}`;
    }
  }
  uploadName = sanitizeAttachmentName(uploadName);
  if (!uploadName) {
    uploadName = extension ? `arquivo${extension}` : 'arquivo';
  } else if (extension && !uploadName.toLowerCase().endsWith(extension)) {
    uploadName = `${uploadName}${extension}`;
  }

  return { displayName, uploadName, extension };
}

function normalizeExameFileRecord(raw, fallback = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const fallbackSource = fallback && typeof fallback === 'object' ? fallback : {};

  const id = normalizeId(source.id || source._id || fallbackSource.id || fallbackSource._id) || generateExameFileId();
  const nome = pickFirst(source.nome, source.name, fallbackSource.nome, fallbackSource.name) || '';
  const originalName = pickFirst(
    source.originalName,
    source.arquivoNomeOriginal,
    source.fileName,
    fallbackSource.originalName,
    fallbackSource.fileName,
  );
  const mimeType = pickFirst(source.mimeType, source.contentType, fallbackSource.mimeType) || '';

  const sizeCandidate = Number(
    source.size ?? source.tamanho ?? source.bytes ?? source.fileSize ?? fallbackSource.size ?? fallbackSource.tamanho,
  );
  const size = Number.isFinite(sizeCandidate) && sizeCandidate >= 0 ? sizeCandidate : 0;

  let extension = pickFirst(source.extension, source.extensao, fallbackSource.extension, fallbackSource.extensao) || '';
  if (!extension && (originalName || nome)) {
    extension = getFileExtension(originalName || nome);
  }
  if (extension) {
    extension = String(extension).toLowerCase();
    if (!extension.startsWith('.')) extension = `.${extension}`;
  }

  const url = pickFirst(source.url, source.link, source.downloadUrl, source.webViewLink, fallbackSource.url) || '';

  let createdAt = source.createdAt || source.uploadedAt || fallbackSource.createdAt || fallbackSource.uploadedAt || null;
  if (createdAt) {
    const parsed = new Date(createdAt);
    createdAt = Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }

  return {
    id,
    _id: id,
    nome: nome || originalName || 'Arquivo',
    originalName: originalName || nome || '',
    mimeType,
    size,
    extension: extension || '',
    url,
    createdAt,
  };
}

function getExameFileMatchKey(file) {
  if (!file) return '';
  const nome = normalizeForCompare(file.nome || file.name || '');
  const original = normalizeForCompare(file.originalName || '');
  const size = Number(file.size || 0);
  const sizeKey = Number.isFinite(size) && size > 0 ? String(size) : '';
  if (!nome && !original && !sizeKey) return '';
  return `${nome}|${original}|${sizeKey}`;
}

function mergeNormalizedExameFileEntries(base, extra) {
  if (!base && !extra) return null;
  if (!base) return extra;
  if (!extra) return base;

  const merged = { ...base };
  const baseId = normalizeId(base.id || base._id);
  const extraId = normalizeId(extra.id || extra._id);

  if (extraId && (!baseId || isGeneratedExameFileId(baseId) || baseId === extraId)) {
    merged.id = extraId;
    merged._id = extraId;
  } else if (baseId) {
    merged.id = baseId;
    merged._id = baseId;
  }

  if (!merged.nome && extra.nome) merged.nome = extra.nome;
  if (!merged.originalName && extra.originalName) merged.originalName = extra.originalName;
  if (!merged.mimeType && extra.mimeType) merged.mimeType = extra.mimeType;
  if (!merged.extension && extra.extension) merged.extension = extra.extension;
  if ((!merged.size || merged.size <= 0) && extra.size) merged.size = extra.size;
  if (!merged.url && extra.url) merged.url = extra.url;
  if (!merged.createdAt && extra.createdAt) merged.createdAt = extra.createdAt;

  return merged;
}

function mergeExameFiles(existing = [], incoming = []) {
  const result = [];
  const byId = new Map();
  const byKey = new Map();

  const registerKeyIndex = (key, idx) => {
    if (!key) return;
    const list = byKey.get(key);
    if (list) {
      if (!list.includes(idx)) list.push(idx);
    } else {
      byKey.set(key, [idx]);
    }
  };

  const unregisterKeyIndex = (key, idx) => {
    if (!key) return;
    const list = byKey.get(key);
    if (!list) return;
    const filtered = list.filter((value) => value !== idx);
    if (filtered.length) {
      byKey.set(key, filtered);
    } else {
      byKey.delete(key);
    }
  };

  const append = (item) => {
    const normalized = normalizeExameFileRecord(item);
    if (!normalized) return;

    const id = normalizeId(normalized.id || normalized._id);
    if (id && byId.has(id)) {
      const idx = byId.get(id);
      const merged = mergeNormalizedExameFileEntries(result[idx], normalized);
      result[idx] = merged;
      const mergedId = normalizeId(merged.id || merged._id);
      if (mergedId && mergedId !== id) {
        byId.delete(id);
        byId.set(mergedId, idx);
      } else if (mergedId && !byId.has(mergedId)) {
        byId.set(mergedId, idx);
      }
      const mergedKey = getExameFileMatchKey(merged);
      if (mergedKey) registerKeyIndex(mergedKey, idx);
      return;
    }

    const key = getExameFileMatchKey(normalized);
    if (key && byKey.has(key)) {
      const indexes = byKey.get(key) || [];
      for (let i = 0; i < indexes.length; i += 1) {
        const idx = indexes[i];
        const existingEntry = result[idx];
        if (!existingEntry) continue;
        const existingId = normalizeId(existingEntry.id || existingEntry._id);
        const incomingId = id;
        const existingPending = !existingEntry.url || isGeneratedExameFileId(existingId);
        const incomingPending = !normalized.url || isGeneratedExameFileId(incomingId);
        if (existingPending || incomingPending) {
          const merged = mergeNormalizedExameFileEntries(existingEntry, normalized);
          result[idx] = merged;
          const mergedId = normalizeId(merged.id || merged._id);
          if (mergedId && mergedId !== existingId) {
            if (existingId) byId.delete(existingId);
            byId.set(mergedId, idx);
          } else if (mergedId && !byId.has(mergedId)) {
            byId.set(mergedId, idx);
          }
          const mergedKey = getExameFileMatchKey(merged);
          if (mergedKey && mergedKey !== key) {
            unregisterKeyIndex(key, idx);
            registerKeyIndex(mergedKey, idx);
          }
          return;
        }
      }
    }

    const entry = { ...normalized };
    result.push(entry);
    const idx = result.length - 1;
    if (id) {
      byId.set(id, idx);
    }
    registerKeyIndex(key, idx);
  };

  (Array.isArray(existing) ? existing : []).forEach(append);
  (Array.isArray(incoming) ? incoming : []).forEach(append);

  result.sort((a, b) => {
    const aTime = a?.createdAt ? new Date(a.createdAt).getTime() : 0;
    const bTime = b?.createdAt ? new Date(b.createdAt).getTime() : 0;
    return bTime - aTime;
  });
  return result;
}

function getExameFileIconClass(file) {
  const ext = String(file?.extension || getFileExtension(file?.originalName || file?.name || file?.nome)).toLowerCase();
  if (ext === '.pdf') return 'fas fa-file-pdf';
  if (ext === '.png' || ext === '.jpg' || ext === '.jpeg') return 'fas fa-file-image';
  return 'fas fa-file';
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
  let arquivos = mergeExameFiles([], Array.isArray(raw.arquivos) ? raw.arquivos : []);
  if (Array.isArray(raw.files)) {
    arquivos = mergeExameFiles(arquivos, raw.files);
  }
  if (Array.isArray(raw.anexos)) {
    arquivos = mergeExameFiles(arquivos, raw.anexos);
  }
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
    arquivos,
    anexoId: normalizeId(raw.anexoId || raw.anexo || raw.attachmentId || raw.attachment) || null,
    anexoObservacao: typeof raw.anexoObservacao === 'string' ? raw.anexoObservacao : '',
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

function setExamePendingFile(file) {
  exameModal.pendingFile = file || null;
  if (!exameModal.dropzoneText || !exameModal.dropzoneHint) {
    if (!file && exameModal.fileInput) {
      exameModal.fileInput.value = '';
    }
    refreshExameModalControls();
    return;
  }

  if (file) {
    exameModal.dropzoneText.textContent = file.name;
    const details = [];
    const extension = getFileExtension(file.name).replace('.', '').toUpperCase();
    if (extension) details.push(extension);
    const size = formatFileSize(file.size);
    if (size) details.push(size);
    exameModal.dropzoneHint.textContent = details.length ? details.join(' · ') : '';
    if (exameModal.fileNameInput) {
      const current = (exameModal.fileNameInput.value || '').trim();
      if (!current) {
        const base = file.name.replace(/\.[^.]+$/, '');
        exameModal.fileNameInput.value = base || file.name;
      }
    }
  } else {
    exameModal.dropzoneText.textContent = 'Arraste o arquivo aqui ou clique para selecionar';
    exameModal.dropzoneHint.textContent = 'Formatos aceitos: PNG, JPG, JPEG ou PDF.';
    if (exameModal.fileInput) {
      exameModal.fileInput.value = '';
    }
  }

  refreshExameModalControls();
}

function refreshExameModalControls() {
  const hasPendingFile = !!exameModal.pendingFile;
  const nameValue = (exameModal.fileNameInput?.value || '').trim();
  const canAdd = hasPendingFile && !!nameValue && !exameModal.isSubmitting;
  if (exameModal.addFileBtn) {
    exameModal.addFileBtn.disabled = !canAdd;
    exameModal.addFileBtn.classList.toggle('opacity-50', exameModal.addFileBtn.disabled);
    exameModal.addFileBtn.classList.toggle('cursor-not-allowed', exameModal.addFileBtn.disabled);
  }
  if (exameModal.fileNameInput) {
    exameModal.fileNameInput.disabled = !!exameModal.isSubmitting;
  }
  if (exameModal.fileInput) {
    exameModal.fileInput.disabled = !!exameModal.isSubmitting;
  }
  if (exameModal.dropzone) {
    exameModal.dropzone.classList.toggle('pointer-events-none', !!exameModal.isSubmitting);
    exameModal.dropzone.classList.toggle('opacity-60', !!exameModal.isSubmitting);
  }
  updateExameAttachmentsGrid();
}

function updateExameAttachmentsGrid() {
  const list = exameModal.filesList;
  const empty = exameModal.filesEmptyState;
  if (!list || !empty) return;

  list.innerHTML = '';

  const existingFiles = Array.isArray(exameModal.existingFiles) ? exameModal.existingFiles : [];
  const newFiles = Array.isArray(exameModal.selectedFiles) ? exameModal.selectedFiles : [];
  const hasExisting = existingFiles.length > 0;
  const hasNew = newFiles.length > 0;

  if (!hasExisting && !hasNew) {
    list.classList.add('hidden');
    empty.classList.remove('hidden');
    return;
  }

  empty.classList.add('hidden');
  list.classList.remove('hidden');

  if (hasExisting) {
    const existingHeader = document.createElement('p');
    existingHeader.className = 'text-xs font-semibold uppercase tracking-wide text-rose-500';
    existingHeader.textContent = 'Arquivos atuais';
    list.appendChild(existingHeader);

    existingFiles.forEach((entry) => {
      const row = document.createElement('div');
      row.className = 'flex flex-col gap-2 rounded-lg border border-rose-100 bg-white px-3 py-3 shadow-sm transition sm:flex-row sm:items-center sm:justify-between';
      if (entry.markedForRemoval) {
        row.classList.add('border-rose-200', 'bg-rose-50/80');
      }
      list.appendChild(row);

      const info = document.createElement('div');
      info.className = 'flex items-start gap-3 text-sm text-rose-700';
      row.appendChild(info);

      const iconWrapper = document.createElement('div');
      iconWrapper.className = 'flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-rose-200 bg-white text-rose-600';
      const icon = document.createElement('i');
      icon.className = getExameFileIconClass(entry);
      iconWrapper.appendChild(icon);
      info.appendChild(iconWrapper);

      const textWrap = document.createElement('div');
      textWrap.className = 'min-w-0';
      info.appendChild(textWrap);

      const displayName = entry.name || entry.displayName || entry.nome || entry.originalName || 'Arquivo';
      const nameEl = document.createElement('p');
      nameEl.className = 'font-semibold leading-tight text-rose-700 break-words';
      nameEl.textContent = displayName;
      if (entry.markedForRemoval) {
        nameEl.classList.add('line-through');
      }
      textWrap.appendChild(nameEl);

      const meta = document.createElement('p');
      meta.className = 'text-xs text-rose-600';
      const metaPieces = [];
      if (entry.originalName && entry.originalName !== displayName) metaPieces.push(entry.originalName);
      const ext = String(entry.extension || '').replace('.', '').toUpperCase();
      if (ext) metaPieces.push(ext);
      if (entry.size) metaPieces.push(formatFileSize(entry.size));
      meta.textContent = metaPieces.length ? metaPieces.join(' · ') : '—';
      textWrap.appendChild(meta);

      if (entry.markedForRemoval) {
        const removalBadge = document.createElement('span');
        removalBadge.className = 'mt-1 inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-600';
        removalBadge.innerHTML = '<i class="fas fa-circle-minus text-[10px]"></i><span>Marcado para remoção</span>';
        textWrap.appendChild(removalBadge);
      }

      const actions = document.createElement('div');
      actions.className = 'flex flex-wrap items-center gap-2';
      row.appendChild(actions);

      if (entry.url) {
        const link = document.createElement('a');
        link.href = entry.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.className = 'inline-flex items-center gap-2 rounded-md border border-rose-200 bg-white px-3 py-1 text-xs font-semibold text-rose-600 transition hover:bg-rose-600 hover:text-white focus:outline-none focus:ring-2 focus:ring-rose-200';
        link.innerHTML = '<i class="fas fa-arrow-up-right-from-square text-[10px]"></i><span>Abrir</span>';
        if (entry.originalName) {
          link.download = entry.originalName;
        }
        actions.appendChild(link);
      } else {
        const pending = document.createElement('span');
        pending.className = 'text-xs text-rose-500';
        pending.textContent = 'Link disponível após sincronização.';
        actions.appendChild(pending);
      }

      const toggleBtn = document.createElement('button');
      toggleBtn.type = 'button';
      const marked = !!entry.markedForRemoval;
      toggleBtn.className = marked
        ? 'inline-flex items-center gap-2 rounded-md border border-transparent px-3 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-100 focus:outline-none focus:ring-2 focus:ring-rose-200'
        : 'inline-flex items-center gap-2 rounded-md border border-transparent px-3 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-50 focus:outline-none focus:ring-2 focus:ring-rose-200';
      toggleBtn.innerHTML = marked
        ? '<i class="fas fa-rotate-left text-[10px]"></i><span>Restaurar</span>'
        : '<i class="fas fa-trash-can text-[10px]"></i><span>Remover</span>';
      toggleBtn.disabled = !!exameModal.isSubmitting;
      toggleBtn.classList.toggle('opacity-60', toggleBtn.disabled);
      toggleBtn.classList.toggle('cursor-not-allowed', toggleBtn.disabled);
      toggleBtn.addEventListener('click', (event) => {
        event.preventDefault();
        if (exameModal.isSubmitting) return;
        entry.markedForRemoval = !entry.markedForRemoval;
        const entryId = normalizeId(entry.id || entry._id);
        if (!Array.isArray(exameModal.removedFileIds)) {
          exameModal.removedFileIds = [];
        }
        if (entry.markedForRemoval) {
          if (entryId && !exameModal.removedFileIds.includes(entryId)) {
            exameModal.removedFileIds.push(entryId);
          }
        } else if (entryId) {
          exameModal.removedFileIds = exameModal.removedFileIds.filter((value) => value !== entryId);
        }
        updateExameAttachmentsGrid();
        refreshExameModalControls();
      });
      actions.appendChild(toggleBtn);
    });
  }

  if (hasExisting && hasNew) {
    const divider = document.createElement('div');
    divider.className = 'h-px bg-rose-100';
    list.appendChild(divider);
  }

  if (hasNew) {
    const newHeader = document.createElement('p');
    newHeader.className = 'text-xs font-semibold uppercase tracking-wide text-rose-500';
    newHeader.textContent = hasExisting ? 'Novos arquivos' : 'Arquivos selecionados';
    list.appendChild(newHeader);

    newFiles.forEach((entry) => {
      const item = document.createElement('div');
      item.className = 'flex flex-col gap-2 rounded-lg border border-rose-100 bg-rose-50/70 px-3 py-3 shadow-sm sm:flex-row sm:items-center sm:justify-between';
      list.appendChild(item);

      const info = document.createElement('div');
      info.className = 'flex items-start gap-3 text-sm text-rose-700';
      item.appendChild(info);

      const iconWrapper = document.createElement('div');
      iconWrapper.className = 'flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-rose-200 bg-white text-rose-600';
      const icon = document.createElement('i');
      icon.className = getExameFileIconClass(entry);
      iconWrapper.appendChild(icon);
      info.appendChild(iconWrapper);

      const textWrap = document.createElement('div');
      textWrap.className = 'min-w-0';
      info.appendChild(textWrap);

      const nameEl = document.createElement('p');
      nameEl.className = 'font-semibold leading-tight text-rose-700 break-words';
      nameEl.textContent = entry.name || entry.originalName || 'Arquivo';
      textWrap.appendChild(nameEl);

      const meta = document.createElement('p');
      meta.className = 'text-xs text-rose-600';
      const metaPieces = [];
      const ext = String(entry.extension || getFileExtension(entry.originalName || entry.name)).replace('.', '').toUpperCase();
      if (entry.originalName && entry.originalName !== entry.name) metaPieces.push(entry.originalName);
      if (ext) metaPieces.push(ext);
      const sizeText = formatFileSize(entry.size);
      if (sizeText) metaPieces.push(sizeText);
      meta.textContent = metaPieces.length ? metaPieces.join(' · ') : '—';
      textWrap.appendChild(meta);

      const actions = document.createElement('div');
      actions.className = 'flex items-center gap-2';
      item.appendChild(actions);

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'inline-flex items-center gap-2 rounded-md border border-rose-300 bg-white px-3 py-1 text-xs font-semibold text-rose-600 transition hover:bg-rose-600 hover:text-white focus:outline-none focus:ring-2 focus:ring-rose-200';
      removeBtn.innerHTML = '<i class="fas fa-trash-can text-[10px]"></i><span>Remover</span>';
      removeBtn.disabled = !!exameModal.isSubmitting;
      removeBtn.classList.toggle('opacity-60', removeBtn.disabled);
      removeBtn.classList.toggle('cursor-not-allowed', removeBtn.disabled);
      removeBtn.addEventListener('click', (event) => {
        event.preventDefault();
        if (exameModal.isSubmitting) return;
        exameModal.selectedFiles = (Array.isArray(exameModal.selectedFiles) ? exameModal.selectedFiles : []).filter(
          (file) => file !== entry,
        );
        updateExameAttachmentsGrid();
        refreshExameModalControls();
      });
      actions.appendChild(removeBtn);
    });
  }
}

function handleExameFileSelection(file) {
  if (!file) {
    setExamePendingFile(null);
    return;
  }
  if (!isAllowedExameFile(file)) {
    notify('Formato de arquivo não permitido. Use PNG, JPG, JPEG ou PDF.', 'warning');
    setExamePendingFile(null);
    return;
  }
  setExamePendingFile(file);
}

function handleExameAddFile() {
  const file = exameModal.pendingFile;
  const rawName = (exameModal.fileNameInput?.value || '').trim();
  if (!file || !rawName) {
    notify('Informe um nome e selecione um arquivo para adicionar.', 'warning');
    return;
  }

  const names = resolveExameAttachmentNames({
    file,
    name: rawName,
    providedName: rawName,
    originalName: file.name,
    extension: getFileExtension(file.name),
  });

  const normalizedExtension = normalizeAttachmentExtension(names.extension || getFileExtension(file.name));

  const entry = {
    id: generateExameFileId(),
    name: names.displayName,
    displayName: names.displayName,
    uploadName: names.uploadName,
    providedName: rawName,
    originalName: file.name,
    size: Number(file.size || 0),
    mimeType: file.type || '',
    extension: normalizedExtension,
    file,
  };

  if (!Array.isArray(exameModal.selectedFiles)) {
    exameModal.selectedFiles = [];
  }
  exameModal.selectedFiles.push(entry);

  setExamePendingFile(null);
  if (exameModal.fileNameInput) {
    exameModal.fileNameInput.value = '';
  }
  updateExameAttachmentsGrid();
  refreshExameModalControls();
}

async function uploadExameAttachments(entries, options = {}) {
  const files = Array.isArray(entries) ? entries.filter((entry) => entry && entry.file) : [];
  if (!files.length) {
    return { arquivos: [], anexoId: null, observacao: '' };
  }

  const clienteId = normalizeId(state.selectedCliente?._id);
  const petId = normalizeId(state.selectedPetId);
  if (!(clienteId && petId)) {
    throw new Error('Selecione um tutor e um pet para enviar arquivos.');
  }

  const exameId = normalizeId(options?.exameId);
  const observacaoValue = `${EXAME_ATTACHMENT_OBSERVACAO_PREFIX}${exameId || 'pending'}`;

  const formData = new FormData();
  formData.append('clienteId', clienteId);
  formData.append('petId', petId);
  const appointmentId = normalizeId(state.agendaContext?.appointmentId);
  if (appointmentId) {
    formData.append('appointmentId', appointmentId);
  }
  formData.append('observacao', observacaoValue);

  const fallbackEntries = files.map((entry) => {
    const file = entry.file;
    const originalName = entry.originalName || (file && file.name) || '';
    const names = resolveExameAttachmentNames({
      ...entry,
      file,
      originalName,
      extension: entry.extension || getFileExtension(originalName || (file && file.name) || ''),
    });
    entry.name = names.displayName;
    entry.displayName = names.displayName;
    entry.uploadName = names.uploadName;
    entry.extension = normalizeAttachmentExtension(names.extension || entry.extension || getFileExtension(originalName));
    if (!entry.originalName) entry.originalName = originalName;
    const createdAt = new Date().toISOString();
    return normalizeExameFileRecord({
      id: entry.id,
      nome: entry.name,
      originalName: entry.originalName,
      mimeType: entry.mimeType,
      size: entry.size,
      extension: entry.extension,
      fileName: entry.uploadName,
      createdAt,
    });
  });

  files.forEach((entry) => {
    const file = entry.file;
    if (!file) return;
    const uploadName = entry.uploadName || file.name;
    const displayName = (entry.name || entry.displayName || file.name || '').trim() || file.name;
    formData.append('arquivos', file, uploadName);
    formData.append('nomes[]', displayName);
  });

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
    const message = typeof data?.message === 'string' ? data.message : 'Erro ao enviar arquivos do exame.';
    throw new Error(message);
  }

  const parseRecord = (raw) => {
    if (!raw || typeof raw !== 'object') return null;
    const arquivosRaw = Array.isArray(raw.arquivos)
      ? raw.arquivos
      : (Array.isArray(raw.files) ? raw.files : []);
    const arquivos = mergeExameFiles([], arquivosRaw);
    return {
      arquivos,
      anexoId: normalizeId(raw._id || raw.id || raw.anexoId || raw.anexo) || null,
      observacao: typeof raw.observacao === 'string' ? raw.observacao : '',
    };
  };

  let parsed = parseRecord(data);
  if (!parsed || !parsed.arquivos.length) {
    if (Array.isArray(data?.anexos)) {
      parsed = data.anexos.map(parseRecord).find((item) => item && item.arquivos.length) || null;
    } else if (Array.isArray(data)) {
      parsed = data.map(parseRecord).find((item) => item && item.arquivos.length) || null;
    }
  }

  if (!parsed || !parsed.arquivos.length) {
    parsed = { arquivos: fallbackEntries, anexoId: parsed?.anexoId || null, observacao: observacaoValue };
  } else {
    parsed = {
      arquivos: mergeExameFiles(parsed.arquivos, fallbackEntries),
      anexoId: parsed.anexoId,
      observacao: parsed.observacao || observacaoValue,
    };
  }

  try {
    await loadAnexosFromServer({ force: true });
  } catch (error) {
    console.error('uploadExameAttachments loadAnexosFromServer', error);
  }

  return parsed;
}

async function updateExistingExameAttachments({
  exameId,
  anexoId,
  existingFiles = [],
  removedIds = [],
  newEntries = [],
  observacao = '',
}) {
  const clienteId = normalizeId(state.selectedCliente?._id);
  const petId = normalizeId(state.selectedPetId);
  if (!(clienteId && petId)) {
    throw new Error('Selecione um tutor e um pet para enviar arquivos.');
  }

  const sanitizedAnexoId = normalizeId(anexoId);
  if (!sanitizedAnexoId) {
    throw new Error('Não foi possível identificar os arquivos do exame para atualização.');
  }

  const appointmentId = normalizeId(state.agendaContext?.appointmentId);
  const formData = new FormData();
  formData.append('clienteId', clienteId);
  formData.append('petId', petId);
  if (appointmentId) {
    formData.append('appointmentId', appointmentId);
  }

  const observacaoValue = observacao || `${EXAME_ATTACHMENT_OBSERVACAO_PREFIX}${exameId || 'pending'}`;
  formData.append('observacao', observacaoValue);

  (Array.isArray(removedIds) ? removedIds : []).forEach((id) => {
    const normalized = normalizeId(id);
    if (normalized) {
      formData.append('removeFileIds[]', normalized);
    }
  });

  const fallbackEntries = [];
  const keptExisting = (Array.isArray(existingFiles) ? existingFiles : []).filter((file) => file && !file.markedForRemoval);
  keptExisting.forEach((entry) => {
    const normalized = normalizeExameFileRecord(entry);
    if (normalized) {
      fallbackEntries.push(normalized);
    }
  });

  (Array.isArray(newEntries) ? newEntries : []).forEach((entry) => {
    const file = entry.file;
    if (!file) return;
    const originalName = entry.originalName || file.name || '';
    const names = resolveExameAttachmentNames({
      ...entry,
      file,
      originalName,
      extension: entry.extension || getFileExtension(originalName || file.name || ''),
    });
    entry.name = names.displayName;
    entry.displayName = names.displayName;
    entry.uploadName = names.uploadName;
    entry.extension = normalizeAttachmentExtension(names.extension || entry.extension || getFileExtension(originalName));
    if (!entry.originalName) entry.originalName = originalName;

    const uploadName = entry.uploadName || file.name;
    const displayName = (entry.name || entry.displayName || uploadName || file.name || '').trim() || uploadName;

    formData.append('arquivos', file, uploadName);
    formData.append('nomes[]', displayName);

    const createdAt = new Date().toISOString();
    const fallback = normalizeExameFileRecord({
      id: entry.id,
      nome: displayName,
      originalName: entry.originalName,
      mimeType: entry.mimeType || file.type || '',
      size: Number(entry.size || file.size || 0),
      extension: entry.extension,
      fileName: uploadName,
      createdAt,
    });
    if (fallback) {
      fallbackEntries.push(fallback);
    }
  });

  const token = getAuthToken();
  const response = await fetch(`${API_CONFIG.BASE_URL}/func/vet/anexos/${encodeURIComponent(sanitizedAnexoId)}`, {
    method: 'PUT',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: formData,
  });

  const data = await response.json().catch(() => (response.ok ? {} : {}));
  if (!response.ok) {
    const message = typeof data?.message === 'string' ? data.message : 'Erro ao atualizar arquivos do exame.';
    throw new Error(message);
  }

  const parseRecord = (raw) => {
    if (!raw || typeof raw !== 'object') return null;
    const arquivosRaw = Array.isArray(raw.arquivos)
      ? raw.arquivos
      : Array.isArray(raw.files)
      ? raw.files
      : [];
    const arquivos = mergeExameFiles(fallbackEntries, arquivosRaw);
    return {
      arquivos,
      anexoId: normalizeId(raw._id || raw.id || raw.anexoId || raw.anexo) || sanitizedAnexoId,
      observacao: typeof raw.observacao === 'string' ? raw.observacao : observacaoValue,
    };
  };

  let parsed = parseRecord(data);
  if (!parsed || !parsed.arquivos.length) {
    if (Array.isArray(data?.anexos)) {
      parsed = data.anexos.map(parseRecord).find((item) => item && item.arquivos.length) || null;
    } else if (Array.isArray(data)) {
      parsed = data.map(parseRecord).find((item) => item && item.arquivos.length) || null;
    }
  }
  if (!parsed) {
    parsed = {
      arquivos: mergeExameFiles([], fallbackEntries),
      anexoId: sanitizedAnexoId,
      observacao: observacaoValue,
    };
  }

  try {
    await loadAnexosFromServer({ force: true });
  } catch (error) {
    console.error('updateExistingExameAttachments loadAnexosFromServer', error);
  }

  return parsed;
}

async function persistExameAttachmentsChanges({
  exameId,
  anexoId,
  existingFiles = [],
  removedIds = [],
  newEntries = [],
  observacao = '',
}) {
  const hasNew = Array.isArray(newEntries) && newEntries.length > 0;
  const hasRemovals = Array.isArray(removedIds) && removedIds.length > 0;

  if (!hasNew && !hasRemovals) {
    const normalizedExisting = (Array.isArray(existingFiles) ? existingFiles : [])
      .filter((file) => file && !file.markedForRemoval)
      .map((file) => normalizeExameFileRecord(file))
      .filter(Boolean);
    return {
      arquivos: mergeExameFiles([], normalizedExisting),
      anexoId: normalizeId(anexoId) || null,
      observacao: observacao || '',
    };
  }

  const sanitizedAnexoId = normalizeId(anexoId);
  if (sanitizedAnexoId) {
    return updateExistingExameAttachments({
      exameId,
      anexoId: sanitizedAnexoId,
      existingFiles,
      removedIds,
      newEntries,
      observacao,
    });
  }

  if (hasNew) {
    return uploadExameAttachments(newEntries, { exameId });
  }

  return {
    arquivos: [],
    anexoId: null,
    observacao: observacao || '',
  };
}

export function loadExamesForSelection() {
  const clienteId = state.selectedCliente?._id;
  const petId = state.selectedPetId;
  const key = getExameStorageKey(clienteId, petId);
  if (!key) {
    state.exames = [];
    state.examesLoadKey = null;
    return;
  }
  if (isFinalizadoSelection(clienteId, petId)) {
    state.exames = [];
    state.examesLoadKey = key;
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
  refreshExameModalControls();
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

  const attachmentsSection = document.createElement('div');
  attachmentsSection.className = 'grid gap-3 rounded-lg border border-rose-100 bg-rose-50/40 p-4';
  fieldsWrapper.appendChild(attachmentsSection);

  const attachmentsHeader = document.createElement('div');
  attachmentsHeader.className = 'flex flex-col gap-1';
  attachmentsSection.appendChild(attachmentsHeader);

  const attachmentsTitle = document.createElement('h3');
  attachmentsTitle.className = 'text-sm font-semibold text-rose-700';
  attachmentsTitle.textContent = 'Arquivos do exame (opcional)';
  attachmentsHeader.appendChild(attachmentsTitle);

  const attachmentsHint = document.createElement('p');
  attachmentsHint.className = 'text-xs text-rose-600';
  attachmentsHint.textContent = 'Adicione imagens ou PDFs relacionados ao exame, se necessário.';
  attachmentsHeader.appendChild(attachmentsHint);

  const attachmentsRow = document.createElement('div');
  attachmentsRow.className = 'grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]';
  attachmentsSection.appendChild(attachmentsRow);

  const nameWrapper = document.createElement('div');
  nameWrapper.className = 'flex flex-col gap-2';
  attachmentsRow.appendChild(nameWrapper);

  const nameLabel = document.createElement('label');
  nameLabel.className = 'text-sm font-medium text-gray-700';
  nameLabel.textContent = 'Nome do arquivo';
  nameWrapper.appendChild(nameLabel);

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.placeholder = 'Informe um nome para o arquivo';
  nameInput.className = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:border-rose-500 focus:outline-none focus:ring-2 focus:ring-rose-200';
  nameWrapper.appendChild(nameInput);

  const fileWrapper = document.createElement('div');
  fileWrapper.className = 'flex flex-col gap-2';
  attachmentsRow.appendChild(fileWrapper);

  const fileLabel = document.createElement('label');
  fileLabel.className = 'text-sm font-medium text-gray-700';
  fileLabel.textContent = 'Arquivo';
  fileWrapper.appendChild(fileLabel);

  const dropzone = document.createElement('label');
  dropzone.className = 'flex h-32 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-rose-300 bg-rose-50 text-sm text-rose-600 transition';
  dropzone.innerHTML = '<span id="vet-exame-dropzone-text">Arraste o arquivo aqui ou clique para selecionar</span><span id="vet-exame-dropzone-hint" class="text-xs text-rose-500">Formatos aceitos: PNG, JPG, JPEG ou PDF.</span>';
  fileWrapper.appendChild(dropzone);

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = ANEXO_ALLOWED_EXTENSIONS.join(',');
  fileInput.className = 'hidden';
  dropzone.appendChild(fileInput);

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'self-start rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700 focus:outline-none focus:ring-2 focus:ring-rose-400';
  addBtn.textContent = 'Adicionar';
  attachmentsRow.appendChild(addBtn);

  const listWrapper = document.createElement('div');
  listWrapper.className = 'grid gap-3';
  attachmentsSection.appendChild(listWrapper);

  const filesList = document.createElement('div');
  filesList.className = 'space-y-3 hidden';
  listWrapper.appendChild(filesList);

  const emptyState = document.createElement('div');
  emptyState.className = 'rounded-lg border border-rose-100 bg-white px-3 py-6 text-center text-sm text-rose-600';
  emptyState.textContent = 'Nenhum arquivo adicionado no momento.';
  listWrapper.appendChild(emptyState);

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

  nameInput.addEventListener('input', () => {
    refreshExameModalControls();
  });

  dropzone.addEventListener('dragover', (event) => {
    event.preventDefault();
    dropzone.classList.add('border-rose-500', 'bg-rose-100');
  });

  dropzone.addEventListener('dragleave', (event) => {
    event.preventDefault();
    dropzone.classList.remove('border-rose-500', 'bg-rose-100');
  });

  dropzone.addEventListener('drop', (event) => {
    event.preventDefault();
    dropzone.classList.remove('border-rose-500', 'bg-rose-100');
    const file = event.dataTransfer?.files?.[0] || null;
    if (file) {
      handleExameFileSelection(file);
    }
  });

  dropzone.addEventListener('click', (event) => {
    event.preventDefault();
    if (exameModal.fileInput) {
      exameModal.fileInput.click();
    }
  });

  fileInput.addEventListener('change', (event) => {
    const file = event.target.files?.[0] || null;
    handleExameFileSelection(file);
  });

  addBtn.addEventListener('click', (event) => {
    event.preventDefault();
    handleExameAddFile();
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
  exameModal.addFileBtn = addBtn;
  exameModal.fileNameInput = nameInput;
  exameModal.fileInput = fileInput;
  exameModal.dropzone = dropzone;
  exameModal.dropzoneText = document.getElementById('vet-exame-dropzone-text');
  exameModal.dropzoneHint = document.getElementById('vet-exame-dropzone-hint');
  exameModal.filesList = filesList;
  exameModal.filesEmptyState = emptyState;
  exameModal.selectedFiles = [];
  exameModal.pendingFile = null;
  exameModal.existingFiles = [];
  exameModal.removedFileIds = [];
  exameModal.mode = 'create';
  exameModal.editingId = null;
  exameModal.editingRecord = null;
  updateExameAttachmentsGrid();
  refreshExameModalControls();

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
  exameModal.selectedFiles = [];
  exameModal.existingFiles = [];
  exameModal.removedFileIds = [];
  exameModal.mode = 'create';
  exameModal.editingId = null;
  exameModal.editingRecord = null;
  if (exameModal.fileNameInput) {
    exameModal.fileNameInput.value = '';
  }
  setExamePendingFile(null);
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
    notify(modal.mode === 'edit' ? 'Não foi possível identificar o exame selecionado.' : 'Selecione um exame para registrar.', 'warning');
    return;
  }

  const observacao = (modal.fields?.observacao?.value || '').trim();
  let valor = Number(service.valor || 0);
  if (!Number.isFinite(valor) || valor < 0) valor = 0;

  const attachmentsEntries = Array.isArray(modal.selectedFiles) ? [...modal.selectedFiles] : [];
  const existingModalFiles = Array.isArray(modal.existingFiles) ? modal.existingFiles : [];
  const removedIds = existingModalFiles
    .filter((file) => file && file.markedForRemoval)
    .map((file) => normalizeId(file.id || file._id))
    .filter(Boolean);
  const keptExisting = existingModalFiles.filter((file) => file && !file.markedForRemoval);

  const isEditing = modal.mode === 'edit';
  const editingId = isEditing ? normalizeId(modal.editingId) : null;

  if (isEditing && !editingId) {
    notify('Não foi possível editar este exame agora. Recarregue a página e tente novamente.', 'error');
    return;
  }

  if (isEditing) {
    const originalObservacao = typeof modal.editingRecord?.observacao === 'string'
      ? modal.editingRecord.observacao.trim()
      : '';
    const hasObservacaoChange = observacao !== originalObservacao;
    const hasAttachmentChanges = attachmentsEntries.length > 0 || removedIds.length > 0;
    if (!hasObservacaoChange && !hasAttachmentChanges) {
      notify('Nenhuma alteração para salvar.', 'info');
      return;
    }
  }

  setExameModalSubmitting(true);

  try {
    if (isEditing && editingId) {
      const list = Array.isArray(state.exames) ? state.exames : [];
      const index = list.findIndex((item) => normalizeId(item?.id || item?._id) === editingId);
      if (index < 0) {
        throw new Error('Não foi possível localizar o exame selecionado. Recarregue a página e tente novamente.');
      }

      const current = { ...list[index] };
      let anexosResult = {
        arquivos: mergeExameFiles(
          [],
          keptExisting.map((file) => normalizeExameFileRecord(file)).filter(Boolean),
        ),
        anexoId: normalizeId(current.anexoId) || null,
        observacao: current.anexoObservacao || '',
      };

      if (attachmentsEntries.length || removedIds.length) {
        try {
          anexosResult = await persistExameAttachmentsChanges({
            exameId: editingId,
            anexoId: current.anexoId,
            existingFiles: existingModalFiles,
            removedIds,
            newEntries: attachmentsEntries,
            observacao: current.anexoObservacao || '',
          });
        } catch (attachmentError) {
          console.error('persistExameAttachmentsChanges', attachmentError);
          throw attachmentError;
        }
      }

      const updatedRecord = {
        ...current,
        observacao,
        valor,
        arquivos: Array.isArray(anexosResult.arquivos) ? anexosResult.arquivos : [],
        anexoId: anexosResult.anexoId || null,
        anexoObservacao:
          typeof anexosResult.observacao === 'string' && anexosResult.observacao
            ? anexosResult.observacao
            : current.anexoObservacao || '',
        updatedAt: new Date().toISOString(),
      };

      state.exames = [...list];
      state.exames[index] = updatedRecord;
      persistExamesForSelection();
      updateConsultaAgendaCard();
      const updatedRecordId = normalizeId(updatedRecord?.id || updatedRecord?._id || editingId);
      emitFichaClinicaUpdate({
        scope: 'exame',
        action: 'update',
        exameId: updatedRecordId || null,
        servicoId: normalizeId(service?._id) || null,
      }).catch(() => {});
      closeExameModal();
      notify('Exame atualizado com sucesso.', 'success');
      return;
    }

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
      arquivos: [],
      anexoId: null,
      anexoObservacao: '',
    };

    let anexosResult = { arquivos: [], anexoId: null, observacao: '' };

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

    if (attachmentsEntries.length) {
      try {
        anexosResult = await uploadExameAttachments(attachmentsEntries, { exameId: record.id });
      } catch (attachmentError) {
        console.error('uploadExameAttachments', attachmentError);
        notify('Exame registrado, mas não foi possível enviar os arquivos. Tente novamente pelo botão de anexos.', 'warning');
      }
    }

    if (Array.isArray(anexosResult.arquivos) && anexosResult.arquivos.length) {
      record.arquivos = anexosResult.arquivos;
    }
    if (anexosResult.anexoId) {
      record.anexoId = anexosResult.anexoId;
    }
    if (typeof anexosResult.observacao === 'string') {
      record.anexoObservacao = anexosResult.observacao;
    }

    state.exames = [record, ...(Array.isArray(state.exames) ? state.exames : [])];
    persistExamesForSelection();
    updateConsultaAgendaCard();
    const createdRecordId = normalizeId(record.id || record._id);
    emitFichaClinicaUpdate({
      scope: 'exame',
      action: 'create',
      exameId: createdRecordId || null,
      servicoId: normalizeId(service?._id) || null,
    }).catch(() => {});
    closeExameModal();
    notify('Exame registrado com sucesso.', 'success');
  } catch (error) {
    console.error('handleExameSubmit', error);
    const defaultMessage = isEditing ? 'Erro ao atualizar exame.' : 'Erro ao registrar exame.';
    notify(error.message || defaultMessage, 'error');
  } finally {
    setExameModalSubmitting(false);
  }
}

export async function deleteExame(exame, options = {}) {
  const { skipConfirm = false } = options || {};
  const record = exame && typeof exame === 'object' ? exame : {};
  const exameId = normalizeId(record.id || record._id);
  const servicoId = normalizeId(record.servicoId || record.servico);
  if (!servicoId) {
    notify('Não foi possível identificar o exame selecionado.', 'error');
    return false;
  }

  if (!ensureTutorAndPetSelected()) {
    return false;
  }

  const appointmentId = normalizeId(state.agendaContext?.appointmentId);
  if (!appointmentId) {
    notify('Abra a ficha pela agenda para remover exames vinculados a um agendamento.', 'warning');
    return false;
  }

  const serviceName = pickFirst(record.servicoNome);
  const hasFiles = Array.isArray(record.arquivos) && record.arquivos.length > 0;

  if (!skipConfirm && typeof window !== 'undefined' && typeof window.confirm === 'function') {
    const questionParts = [];
    if (serviceName) {
      questionParts.push(`Remover o exame "${serviceName}"?`);
    } else {
      questionParts.push('Remover este exame?');
    }
    if (hasFiles) {
      questionParts.push('Os arquivos enviados serão excluídos.');
    }
    const confirmed = window.confirm(questionParts.join('\n'));
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

  let removed = false;
  const remainingServices = [];
  normalizedServices.forEach((svc) => {
    if (!removed && svc.servicoId === servicoId) {
      removed = true;
    } else {
      remainingServices.push(svc);
    }
  });

  if (!removed) {
    notify('Não foi possível localizar o serviço do exame no agendamento.', 'error');
    return false;
  }

  state.examesLoading = true;
  updateConsultaAgendaCard();

  try {
    const response = await api(`/func/agendamentos/${appointmentId}`, {
      method: 'PUT',
      body: JSON.stringify({ servicos: remainingServices }),
    });
    const data = await response.json().catch(() => (response.ok ? {} : {}));
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
        if (sid && sid === servicoId) {
          removedFromContext = true;
          return false;
        }
        return true;
      });
    }
    if (typeof data?.valor === 'number') {
      state.agendaContext.valor = Number(data.valor);
    }
    if (Array.isArray(state.agendaContext?.servicos)) {
      state.agendaContext.totalServicos = state.agendaContext.servicos.length;
    }
    persistAgendaContext(state.agendaContext);

    const nextExames = (Array.isArray(state.exames) ? state.exames : []).filter((item) => {
      const itemId = normalizeId(item?.id || item?._id);
      if (exameId && itemId) {
        return itemId !== exameId;
      }
      return item !== record;
    });
    state.exames = nextExames;
    persistExamesForSelection();
    state.examesLoading = false;
    updateConsultaAgendaCard();

    const anexoId = normalizeId(record.anexoId);
    if (anexoId) {
      try {
        await deleteAnexo({ id: anexoId, _id: anexoId, observacao: record.anexoObservacao || '' }, {
          skipConfirm: true,
          suppressNotify: true,
        });
      } catch (attachmentError) {
        console.error('deleteExame deleteAnexo', attachmentError);
        notify('Exame removido, mas não foi possível excluir os arquivos agora. Verifique em anexos.', 'warning');
      }
    }

    emitFichaClinicaUpdate({
      scope: 'exame',
      action: 'delete',
      exameId,
      servicoId,
    }).catch(() => {});
    notify('Exame removido com sucesso.', 'success');
    return true;
  } catch (error) {
    console.error('deleteExame', error);
    notify(error.message || 'Erro ao remover exame.', 'error');
    return false;
  } finally {
    state.examesLoading = false;
    updateConsultaAgendaCard();
  }
}

state.deleteExame = deleteExame;

export function openExameModal(options = {}) {
  if (!ensureTutorAndPetSelected()) {
    return;
  }

  const appointmentId = normalizeId(state.agendaContext?.appointmentId);
  if (!appointmentId) {
    notify('Abra a ficha pela agenda para registrar exames vinculados a um agendamento.', 'warning');
    return;
  }

  const { exame = null } = options || {};
  const modal = ensureExameModal();
  setExameModalSubmitting(false);

  if (modal.form) {
    modal.form.reset();
  }

  modal.selectedService = null;
  modal.selectedFiles = [];
  modal.existingFiles = [];
  modal.removedFileIds = [];
  modal.pendingFile = null;
  modal.mode = 'create';
  modal.editingId = null;
  modal.editingRecord = null;

  if (modal.fields?.servico) {
    modal.fields.servico.value = '';
    modal.fields.servico.disabled = false;
    modal.fields.servico.classList.remove('bg-rose-50', 'cursor-not-allowed');
    modal.fields.servico.removeAttribute('aria-disabled');
  }
  if (modal.fields?.observacao) {
    modal.fields.observacao.value = '';
  }
  if (modal.fileNameInput) {
    modal.fileNameInput.value = '';
  }
  if (modal.titleEl) {
    modal.titleEl.textContent = 'Novo exame';
  }

  setExamePendingFile(null);
  hideExameSuggestions();

  let focusField = 'servico';

  if (exame && typeof exame === 'object') {
    modal.mode = 'edit';
    const editingId = normalizeId(exame.id || exame._id);
    if (editingId) {
      modal.editingId = editingId;
    }
    modal.editingRecord = { ...exame };

    const serviceId = normalizeId(exame.servicoId || exame.servico);
    const serviceNome = pickFirst(exame.servicoNome, exame.servicoNomeOriginal, exame.nome);
    const serviceValor = Number(exame.valor || 0);
    if (serviceId) {
      modal.selectedService = {
        _id: serviceId,
        nome: serviceNome || '',
        valor: Number.isFinite(serviceValor) ? serviceValor : 0,
      };
    }

    if (modal.fields?.servico) {
      modal.fields.servico.value = serviceNome || '';
      modal.fields.servico.disabled = true;
      modal.fields.servico.setAttribute('aria-disabled', 'true');
      modal.fields.servico.classList.add('bg-rose-50', 'cursor-not-allowed');
    }
    if (modal.fields?.observacao) {
      modal.fields.observacao.value = exame.observacao || '';
    }

    const arquivosExistentes = Array.isArray(exame.arquivos) ? exame.arquivos : [];
    modal.existingFiles = arquivosExistentes
      .map((file) => {
        const normalized = normalizeExameFileRecord(file, file);
        if (!normalized) return null;
        return { ...normalized, markedForRemoval: false };
      })
      .filter(Boolean);
    modal.removedFileIds = [];

    if (modal.titleEl) {
      modal.titleEl.textContent = 'Editar exame';
    }

    focusField = 'observacao';
  }

  updateExameAttachmentsGrid();
  refreshExameModalControls();
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
    if (focusField === 'observacao' && modal.fields?.observacao) {
      try { modal.fields.observacao.focus(); } catch { }
    } else if (modal.fields?.servico && !modal.fields.servico.disabled) {
      try { modal.fields.servico.focus(); } catch { }
    }
  }, 50);
}
