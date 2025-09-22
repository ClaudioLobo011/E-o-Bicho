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
  EXAME_ATTACHMENT_OBSERVACAO_PREFIX,
  getAuthToken,
  isFinalizadoSelection,
} from './core.js';
import { getConsultasKey, ensureTutorAndPetSelected, updateConsultaAgendaCard } from './consultas.js';
import { emitFichaClinicaUpdate } from './real-time.js';

function generateAnexoId() {
  return `anx-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

function isTemporaryAnexoId(value) {
  if (!value) return false;
  return /^anx-\d+-\d+$/i.test(String(value));
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

function resolveAnexoAttachmentNames(entry = {}) {
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

function isTemporaryAnexoFileId(value) {
  if (!value) return false;
  return /^anx-file-\d+-\d+$/i.test(String(value));
}

function normalizeFileNameForComparison(value) {
  if (value === null || value === undefined) return '';
  return sanitizeAttachmentName(value).toLowerCase();
}

function collectAnexoFileNameTokens(entry) {
  const tokens = new Set();
  const push = (raw) => {
    const normalized = normalizeFileNameForComparison(raw);
    if (!normalized) return;
    tokens.add(normalized);
    if (normalized.includes('.')) {
      const withoutExt = normalizeFileNameForComparison(normalized.replace(/\.[^.]+$/, ''));
      if (withoutExt) tokens.add(withoutExt);
    }
  };
  push(entry?.originalName);
  push(entry?.nome);
  push(entry?.name);
  push(entry?.displayName);
  push(entry?.providedName);
  push(entry?.uploadName);
  push(entry?.fileName);
  return tokens;
}

function getComparableAnexoExtension(entry) {
  const candidates = [
    entry?.extension,
    entry?.originalName ? getFileExtension(entry.originalName) : '',
    entry?.nome ? getFileExtension(entry.nome) : '',
    entry?.name ? getFileExtension(entry.name) : '',
    entry?.displayName ? getFileExtension(entry.displayName) : '',
    entry?.uploadName ? getFileExtension(entry.uploadName) : '',
    entry?.fileName ? getFileExtension(entry.fileName) : '',
  ];
  for (const candidate of candidates) {
    const normalized = normalizeAttachmentExtension(candidate);
    if (normalized) return normalized;
  }
  return '';
}

function getAnexoFileComparison(entry) {
  const id = normalizeId(entry?.id || entry?._id) || null;
  const url = typeof entry?.url === 'string' ? entry.url.trim() : '';
  const sizeValue = Number(entry?.size ?? 0);
  const size = Number.isFinite(sizeValue) && sizeValue > 0 ? sizeValue : 0;
  const extension = getComparableAnexoExtension(entry);
  const names = collectAnexoFileNameTokens(entry);
  return {
    id,
    url,
    size,
    extension,
    names,
    isTemporary: isTemporaryAnexoFileId(id),
  };
}

function shouldMergeAnexoFiles(base, candidate) {
  if (!base || !candidate) return false;
  const baseInfo = getAnexoFileComparison(base);
  const candidateInfo = getAnexoFileComparison(candidate);

  if (baseInfo.id && candidateInfo.id && baseInfo.id === candidateInfo.id) {
    return true;
  }
  if (baseInfo.url && candidateInfo.url && baseInfo.url === candidateInfo.url) {
    return true;
  }

  const allowLooseMatch =
    baseInfo.isTemporary ||
    candidateInfo.isTemporary ||
    !baseInfo.id ||
    !candidateInfo.id ||
    !baseInfo.url ||
    !candidateInfo.url;

  if (!allowLooseMatch) {
    return false;
  }

  const sizeMatches =
    baseInfo.size && candidateInfo.size ? baseInfo.size === candidateInfo.size : true;
  if (!sizeMatches) {
    return false;
  }

  const extensionMatches =
    baseInfo.extension && candidateInfo.extension ? baseInfo.extension === candidateInfo.extension : true;
  if (!extensionMatches) {
    return false;
  }

  if (baseInfo.names.size && candidateInfo.names.size) {
    for (const name of baseInfo.names) {
      if (candidateInfo.names.has(name)) {
        return true;
      }
    }
  }

  return false;
}

function mergeAnexoFileEntry(base, incoming) {
  const merged = { ...base };
  const baseId = normalizeId(base?.id || base?._id) || null;
  const incomingId = normalizeId(incoming?.id || incoming?._id) || null;
  const baseTemp = isTemporaryAnexoFileId(baseId);
  const incomingTemp = isTemporaryAnexoFileId(incomingId);

  if (incomingId && (!incomingTemp || !baseId || baseTemp)) {
    merged.id = incomingId;
    merged._id = incomingId;
  } else if (baseId) {
    merged.id = baseId;
    merged._id = baseId;
  } else if (incomingId) {
    merged.id = incomingId;
    merged._id = incomingId;
  }

  const assignString = (prop) => {
    const value = incoming?.[prop];
    if (value !== undefined && value !== null && value !== '') {
      merged[prop] = value;
    }
  };

  assignString('url');
  assignString('mimeType');
  assignString('nome');
  assignString('name');
  assignString('displayName');
  assignString('providedName');
  assignString('originalName');
  assignString('uploadName');
  assignString('fileName');

  const incomingSize = Number(incoming?.size ?? 0);
  if (incomingSize && (!merged.size || merged.size === 0)) {
    merged.size = incomingSize;
  }

  const incomingExtension = normalizeAttachmentExtension(incoming?.extension);
  if (incomingExtension && !merged.extension) {
    merged.extension = incomingExtension;
  }

  const baseCreated = toIsoOrNull(base?.createdAt);
  const incomingCreated = toIsoOrNull(incoming?.createdAt);
  if (baseCreated && incomingCreated) {
    const baseTime = new Date(baseCreated).getTime();
    const incomingTime = new Date(incomingCreated).getTime();
    if (Number.isFinite(baseTime) && Number.isFinite(incomingTime)) {
      merged.createdAt = new Date(Math.min(baseTime, incomingTime)).toISOString();
    } else if (Number.isFinite(incomingTime)) {
      merged.createdAt = new Date(incomingTime).toISOString();
    } else if (Number.isFinite(baseTime)) {
      merged.createdAt = new Date(baseTime).toISOString();
    }
  } else if (incomingCreated) {
    merged.createdAt = incomingCreated;
  } else if (baseCreated && !merged.createdAt) {
    merged.createdAt = baseCreated;
  }

  const baseUpdated = toIsoOrNull(base?.updatedAt);
  const incomingUpdated = toIsoOrNull(incoming?.updatedAt);
  if (baseUpdated && incomingUpdated) {
    const baseTime = new Date(baseUpdated).getTime();
    const incomingTime = new Date(incomingUpdated).getTime();
    if (Number.isFinite(baseTime) && Number.isFinite(incomingTime)) {
      merged.updatedAt = incomingTime > baseTime
        ? new Date(incomingTime).toISOString()
        : new Date(baseTime).toISOString();
    } else if (Number.isFinite(incomingTime)) {
      merged.updatedAt = new Date(incomingTime).toISOString();
    } else if (Number.isFinite(baseTime)) {
      merged.updatedAt = new Date(baseTime).toISOString();
    }
  } else if (incomingUpdated) {
    merged.updatedAt = incomingUpdated;
  } else if (baseUpdated && !merged.updatedAt) {
    merged.updatedAt = baseUpdated;
  } else if (!merged.updatedAt && merged.createdAt) {
    merged.updatedAt = merged.createdAt;
  }

  if (incoming?.file) {
    merged.file = incoming.file;
  } else if (!incoming?.file && merged.file && !base?.file) {
    delete merged.file;
  }

  return merged;
}

function mergeAnexoFiles(existing = [], incoming = []) {
  const list = [];
  const push = (item) => {
    const normalized = normalizeAnexoFileRecord(item);
    if (!normalized) return;
    const index = list.findIndex((entry) => shouldMergeAnexoFiles(entry, normalized));
    if (index >= 0) {
      list[index] = mergeAnexoFileEntry(list[index], normalized);
    } else {
      list.push(normalized);
    }
  };
  (Array.isArray(existing) ? existing : []).forEach(push);
  (Array.isArray(incoming) ? incoming : []).forEach(push);
  list.sort((a, b) => {
    const aTime = a?.createdAt ? new Date(a.createdAt).getTime() : 0;
    const bTime = b?.createdAt ? new Date(b.createdAt).getTime() : 0;
    return bTime - aTime;
  });
  return list;
}

function getAnexoFileSignature(entry) {
  const comparison = getAnexoFileComparison(entry);
  const nameTokens = comparison.names ? Array.from(comparison.names) : [];
  nameTokens.sort();
  const nameKey = nameTokens.join('|');
  const sizeKey = comparison.size || 0;
  const extensionKey = comparison.extension || '';
  if (!(nameKey || sizeKey || extensionKey)) {
    return null;
  }
  return `${nameKey}#${sizeKey}#${extensionKey}`;
}

function getAnexoRecordComparison(entry) {
  const id = normalizeId(entry?.id || entry?._id) || null;
  const arquivos = Array.isArray(entry?.arquivos) ? entry.arquivos : [];
  const fileSignatures = arquivos.map((file) => getAnexoFileSignature(file)).filter(Boolean);
  fileSignatures.sort();
  const hasFiles = fileSignatures.length > 0;
  const observacaoKey = typeof entry?.observacao === 'string' ? entry.observacao.trim().toLowerCase() : '';
  const signature = hasFiles ? `${observacaoKey}::${fileSignatures.join('||')}` : null;
  return {
    id,
    signature,
    hasFiles,
    isTemporary: !id || isTemporaryAnexoId(id),
  };
}

function mergeAnexoRecordEntry(base, incoming) {
  if (!base && !incoming) return null;
  if (!base) return { ...incoming };
  if (!incoming) return { ...base };

  const baseId = normalizeId(base.id || base._id) || null;
  const incomingId = normalizeId(incoming.id || incoming._id) || null;
  const baseTemp = isTemporaryAnexoId(baseId);
  const incomingTemp = isTemporaryAnexoId(incomingId);

  let resolvedId = baseId;
  if (incomingId && (!incomingTemp || !baseId || baseTemp)) {
    resolvedId = incomingId;
  } else if (!resolvedId && incomingId) {
    resolvedId = incomingId;
  }
  if (!resolvedId) {
    resolvedId = generateAnexoId();
  }

  const merged = {
    ...base,
    ...incoming,
    id: resolvedId,
    _id: resolvedId,
  };
  merged.arquivos = mergeAnexoFiles(base?.arquivos, incoming?.arquivos);

  const baseCreated = toIsoOrNull(base?.createdAt);
  const incomingCreated = toIsoOrNull(incoming?.createdAt);
  if (baseCreated && incomingCreated) {
    const baseTime = new Date(baseCreated).getTime();
    const incomingTime = new Date(incomingCreated).getTime();
    if (Number.isFinite(baseTime) && Number.isFinite(incomingTime)) {
      merged.createdAt = new Date(Math.min(baseTime, incomingTime)).toISOString();
    } else if (incomingCreated) {
      merged.createdAt = incomingCreated;
    } else if (baseCreated) {
      merged.createdAt = baseCreated;
    }
  } else if (incomingCreated) {
    merged.createdAt = incomingCreated;
  } else if (baseCreated && !merged.createdAt) {
    merged.createdAt = baseCreated;
  }

  const baseUpdated = toIsoOrNull(base?.updatedAt);
  const incomingUpdated = toIsoOrNull(incoming?.updatedAt);
  if (baseUpdated && incomingUpdated) {
    const baseTime = new Date(baseUpdated).getTime();
    const incomingTime = new Date(incomingUpdated).getTime();
    if (Number.isFinite(baseTime) && Number.isFinite(incomingTime)) {
      merged.updatedAt = incomingTime > baseTime
        ? new Date(incomingTime).toISOString()
        : new Date(baseTime).toISOString();
    } else if (incomingUpdated) {
      merged.updatedAt = incomingUpdated;
    } else if (baseUpdated) {
      merged.updatedAt = baseUpdated;
    }
  } else if (incomingUpdated) {
    merged.updatedAt = incomingUpdated;
  } else if (baseUpdated && !merged.updatedAt) {
    merged.updatedAt = baseUpdated;
  } else if (!merged.updatedAt && merged.createdAt) {
    merged.updatedAt = merged.createdAt;
  }

  const assignIdField = (prop) => {
    const incomingValue = normalizeId(incoming?.[prop]);
    const baseValue = normalizeId(base?.[prop]);
    if (incomingValue) {
      merged[prop] = incomingValue;
    } else if (baseValue) {
      merged[prop] = baseValue;
    } else if (merged[prop]) {
      merged[prop] = normalizeId(merged[prop]);
    }
    if (!merged[prop]) {
      delete merged[prop];
    }
  };
  assignIdField('clienteId');
  assignIdField('petId');
  assignIdField('appointmentId');

  if (incoming?.observacao !== undefined) {
    merged.observacao = typeof incoming.observacao === 'string' ? incoming.observacao : '';
  } else if (base?.observacao !== undefined && merged.observacao === undefined) {
    merged.observacao = typeof base.observacao === 'string' ? base.observacao : '';
  }

  return merged;
}

function mergeAnexoRecords(existing = [], incoming = []) {
  const list = [];
  const idMap = new Map();
  const signatureMap = new Map();

  const register = (record) => {
    const comparison = getAnexoRecordComparison(record);
    if (comparison.id) {
      idMap.set(comparison.id, record);
    }
    if (comparison.signature) {
      signatureMap.set(comparison.signature, record);
    }
  };

  const upsert = (entry) => {
    if (!entry || typeof entry !== 'object') return;
    const normalized = normalizeAnexoRecord(entry);
    if (!normalized) return;
    const comparison = getAnexoRecordComparison(normalized);

    let target = null;
    if (comparison.id && idMap.has(comparison.id)) {
      target = idMap.get(comparison.id);
    } else if (comparison.signature && (comparison.isTemporary || !comparison.id)) {
      const candidate = signatureMap.get(comparison.signature);
      if (candidate) {
        const candidateComparison = getAnexoRecordComparison(candidate);
        if (candidateComparison.isTemporary || comparison.isTemporary) {
          target = candidate;
        }
      }
    }

    if (target) {
      const targetComparison = getAnexoRecordComparison(target);
      const merged = mergeAnexoRecordEntry(target, normalized);
      const mergedComparison = getAnexoRecordComparison(merged);

      const index = list.indexOf(target);
      if (index >= 0) {
        list[index] = merged;
      } else {
        list.push(merged);
      }

      if (targetComparison.id && targetComparison.id !== mergedComparison.id) {
        idMap.delete(targetComparison.id);
      }
      if (comparison.id && comparison.id !== mergedComparison.id) {
        idMap.delete(comparison.id);
      }
      if (mergedComparison.id) {
        idMap.set(mergedComparison.id, merged);
      }

      if (targetComparison.signature && targetComparison.signature !== mergedComparison.signature) {
        signatureMap.delete(targetComparison.signature);
      }
      if (comparison.signature && comparison.signature !== mergedComparison.signature) {
        signatureMap.delete(comparison.signature);
      }
      if (mergedComparison.signature) {
        signatureMap.set(mergedComparison.signature, merged);
      }
    } else {
      const preparedId = comparison.id || generateAnexoId();
      const prepared = {
        ...normalized,
        id: preparedId,
        _id: preparedId,
        arquivos: mergeAnexoFiles([], normalized.arquivos || []),
      };
      list.push(prepared);
      register(prepared);
    }
  };

  (Array.isArray(existing) ? existing : []).forEach(upsert);
  (Array.isArray(incoming) ? incoming : []).forEach(upsert);

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

export function isExameAttachmentRecord(anexo) {
  if (!anexo) return false;
  const observacao = typeof anexo.observacao === 'string' ? anexo.observacao : '';
  return observacao.startsWith(EXAME_ATTACHMENT_OBSERVACAO_PREFIX);
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
  const clienteId = state.selectedCliente?._id;
  const petId = state.selectedPetId;
  const key = getAnexoStorageKey(clienteId, petId);
  if (!key) {
    state.anexos = [];
    return;
  }
  if (isFinalizadoSelection(clienteId, petId)) {
    state.anexos = [];
    try {
      localStorage.removeItem(key);
    } catch {
      // ignore storage errors
    }
    return;
  }
  const existing = Array.isArray(state.anexos) ? state.anexos : [];
  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      if (!existing.length) state.anexos = [];
      return;
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      if (!existing.length) state.anexos = [];
      return;
    }
    const normalized = parsed.map((item) => normalizeAnexoRecord(item)).filter(Boolean);
    normalized.sort((a, b) => {
      const aTime = a?.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bTime = b?.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bTime - aTime;
    });
    const filtered = normalized.filter((item) => !isExameAttachmentRecord(item));
    if (filtered.length) {
      state.anexos = existing.length ? mergeAnexoRecords(existing, filtered) : filtered;
    } else if (!existing.length) {
      state.anexos = [];
    }
  } catch {
    if (!Array.isArray(state.anexos) || !state.anexos.length) {
      state.anexos = [];
    }
  }
}

function upsertAnexoInState(record, fallbackFiles = []) {
  const normalized = normalizeAnexoRecord(record, fallbackFiles);
  if (!normalized) return null;
  if (isExameAttachmentRecord(normalized)) return null;
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

  const filtered = deduped.filter((item) => !isExameAttachmentRecord(item));
  state.anexos = filtered;
  const key = getConsultasKey(state.selectedCliente?._id, state.selectedPetId);
  if (key) state.anexosLoadKey = key;

  return filtered.find((item) => normalizeId(item?.id || item?._id) === id) || payload;
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
  if (isFinalizadoSelection(clienteId, petId)) {
    state.anexos = [];
    state.anexosLoadKey = key;
    state.anexosLoading = false;
    updateConsultaAgendaCard();
    return;
  }
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

    const filtered = normalized.filter((item) => !isExameAttachmentRecord(item));

    state.anexos = filtered;
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

export function handleAnexoRealTimeEvent(event = {}) {
  if (!event || typeof event !== 'object') return false;

  const action = typeof event.action === 'string' ? event.action.toLowerCase() : '';
  const targetId = normalizeId(event.anexoId || event.id || event._id);
  let changed = false;

  if (action === 'delete' && targetId) {
    const current = Array.isArray(state.anexos) ? state.anexos : [];
    const filtered = current.filter((item) => normalizeId(item?.id || item?._id) !== targetId);
    if (filtered.length !== current.length) {
      state.anexos = filtered;
      updateConsultaAgendaCard();
      changed = true;
    }
    persistAnexosForSelection();
    return changed;
  }

  const candidates = [];
  if (Array.isArray(event.anexos)) candidates.push(...event.anexos);
  if (event.anexo && typeof event.anexo === 'object') candidates.push(event.anexo);
  if (event.record && typeof event.record === 'object') candidates.push(event.record);

  candidates.forEach((candidate) => {
    const saved = upsertAnexoInState(candidate);
    if (saved) {
      changed = true;
    }
  });

  if (changed) {
    persistAnexosForSelection();
    updateConsultaAgendaCard();
  }

  return changed;
}

export async function deleteAnexo(anexo, options = {}) {
  const { skipConfirm = false, suppressNotify = false, skipReload = false } = options || {};
  const record = anexo && typeof anexo === 'object' ? anexo : {};
  const targetId = normalizeId(record.id || record._id);
  if (!targetId) return false;

  const arquivos = Array.isArray(record.arquivos) ? record.arquivos.filter(Boolean) : [];
  const firstFile = arquivos.length ? arquivos[0] : null;

  if (!skipConfirm && typeof window !== 'undefined' && typeof window.confirm === 'function') {
    const mainName = pickFirst(firstFile?.nome, firstFile?.originalName);
    const question = mainName
      ? `Remover o anexo "${mainName}"? O arquivo será excluído do Google Drive.`
      : 'Remover este anexo? O arquivo será excluído do Google Drive.';
    const confirmed = window.confirm(question);
    if (!confirmed) {
      return false;
    }
  }

  const clienteId = normalizeId(state.selectedCliente?._id);
  const petId = normalizeId(state.selectedPetId);
  if (!(clienteId && petId)) {
    const message = 'Selecione um tutor e um pet para remover anexos.';
    if (suppressNotify) {
      throw new Error(message);
    }
    notify(message, 'warning');
    return false;
  }

  const params = new URLSearchParams({ clienteId, petId });
  const endpoint = `/func/vet/anexos/${encodeURIComponent(targetId)}?${params.toString()}`;

  try {
    const response = await api(endpoint, { method: 'DELETE' });
    let payload = null;
    if (response.status !== 204) {
      payload = await response.json().catch(() => null);
    }
    if (!response.ok) {
      const message = typeof payload?.message === 'string' ? payload.message : 'Erro ao remover anexo.';
      throw new Error(message);
    }

    const remaining = (Array.isArray(state.anexos) ? state.anexos : []).filter(
      (item) => normalizeId(item?.id || item?._id) !== targetId,
    );
    state.anexos = remaining;
    persistAnexosForSelection();
    updateConsultaAgendaCard();
    if (!suppressNotify) {
      notify('Anexo removido com sucesso.', 'success');
    }
    emitFichaClinicaUpdate({ scope: 'anexo', action: 'delete', anexoId: targetId }).catch(() => {});
    if (!skipReload) {
      await loadAnexosFromServer({ force: true });
    }
    return true;
  } catch (error) {
    console.error('deleteAnexo', error);
    const message = error?.message || 'Erro ao remover anexo.';
    if (!suppressNotify) {
      notify(message, 'error');
    }
    throw error instanceof Error ? error : new Error(message);
  }
}

state.deleteAnexo = deleteAnexo;

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
  const selectedFiles = Array.isArray(anexoModal.selectedFiles) ? anexoModal.selectedFiles : [];
  const existingFiles = Array.isArray(anexoModal.existingFiles) ? anexoModal.existingFiles : [];
  const removedCount = existingFiles.filter((file) => file && file.markedForRemoval).length;
  const keptCount = existingFiles.filter((file) => file && !file.markedForRemoval).length;
  const hasNewFiles = selectedFiles.length > 0;
  const isEditing = anexoModal.mode === 'edit' && !!anexoModal.editingId;
  let canSubmit = false;
  if (isEditing) {
    const hasChanges = hasNewFiles || removedCount > 0;
    const resultingCount = keptCount + selectedFiles.length;
    canSubmit = hasChanges && resultingCount > 0;
  } else {
    canSubmit = hasNewFiles;
  }
  const submitDisabled = anexoModal.isSubmitting || !canSubmit;
  if (anexoModal.submitBtn) {
    anexoModal.submitBtn.disabled = submitDisabled;
    anexoModal.submitBtn.classList.toggle('opacity-60', anexoModal.isSubmitting);
    anexoModal.submitBtn.classList.toggle('cursor-not-allowed', submitDisabled);
    let submitText = 'Salvar';
    if (anexoModal.isSubmitting) {
      submitText = 'Salvando...';
    } else if (isEditing) {
      submitText = 'Salvar alterações';
    }
    anexoModal.submitBtn.textContent = submitText;
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

  const existingFiles = Array.isArray(anexoModal.existingFiles) ? anexoModal.existingFiles : [];
  const newFiles = Array.isArray(anexoModal.selectedFiles) ? anexoModal.selectedFiles : [];
  const hasExisting = existingFiles.length > 0;
  const hasNew = newFiles.length > 0;

  if (!hasExisting && !hasNew) {
    if (empty) empty.classList.remove('hidden');
    refreshAnexoModalControls();
    return;
  }

  if (empty) empty.classList.add('hidden');

  if (hasExisting) {
    const existingHeader = document.createElement('p');
    existingHeader.className = 'text-xs font-semibold uppercase tracking-wide text-indigo-500';
    existingHeader.textContent = 'Arquivos atuais';
    list.appendChild(existingHeader);

    existingFiles.forEach((entry) => {
      const row = document.createElement('div');
      row.className = 'flex flex-col gap-2 rounded-lg border border-indigo-100 bg-white px-3 py-3 shadow-sm transition sm:flex-row sm:items-center sm:justify-between';
      if (entry.markedForRemoval) {
        row.classList.add('border-rose-200', 'bg-rose-50/80');
      }
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

      const displayName = entry.name || entry.displayName || entry.nome || entry.originalName || 'Arquivo';
      const nameEl = document.createElement('p');
      nameEl.className = 'font-semibold leading-tight text-indigo-700 break-words';
      nameEl.textContent = displayName;
      if (entry.markedForRemoval) {
        nameEl.classList.add('line-through');
      }
      textWrap.appendChild(nameEl);

      const meta = document.createElement('p');
      meta.className = 'text-xs text-indigo-500';
      const metaParts = [];
      if (entry.originalName && entry.originalName !== displayName) metaParts.push(entry.originalName);
      if (entry.extension) metaParts.push(entry.extension.replace('.', '').toUpperCase());
      if (entry.size) metaParts.push(formatFileSize(entry.size));
      meta.textContent = metaParts.length ? metaParts.join(' · ') : '—';
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
        link.className = 'inline-flex items-center gap-2 rounded-md border border-indigo-300 bg-white px-3 py-1 text-xs font-semibold text-indigo-600 transition hover:bg-indigo-600 hover:text-white';
        link.innerHTML = '<i class="fas fa-arrow-up-right-from-square text-[10px]"></i><span>Abrir</span>';
        if (entry.originalName) {
          link.download = entry.originalName;
        }
        actions.appendChild(link);
      } else {
        const pending = document.createElement('span');
        pending.className = 'text-xs text-indigo-500';
        pending.textContent = 'Link disponível após sincronização.';
        actions.appendChild(pending);
      }

      const toggleBtn = document.createElement('button');
      toggleBtn.type = 'button';
      if (entry.markedForRemoval) {
        toggleBtn.className = 'inline-flex items-center gap-1 rounded-md border border-transparent px-3 py-1 text-xs font-semibold text-indigo-600 hover:bg-indigo-50';
        toggleBtn.innerHTML = '<i class="fas fa-rotate-left"></i><span>Restaurar</span>';
      } else {
        toggleBtn.className = 'inline-flex items-center gap-1 rounded-md border border-transparent px-3 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-50';
        toggleBtn.innerHTML = '<i class="fas fa-trash-can"></i><span>Remover</span>';
      }
      toggleBtn.addEventListener('click', (event) => {
        event.preventDefault();
        entry.markedForRemoval = !entry.markedForRemoval;
        const entryId = normalizeId(entry.id || entry._id);
        if (entry.markedForRemoval) {
          if (!Array.isArray(anexoModal.removedFileIds)) {
            anexoModal.removedFileIds = [];
          }
          if (entryId && !anexoModal.removedFileIds.includes(entryId)) {
            anexoModal.removedFileIds.push(entryId);
          }
        } else if (entryId && Array.isArray(anexoModal.removedFileIds)) {
          anexoModal.removedFileIds = anexoModal.removedFileIds.filter((value) => value !== entryId);
        }
        updateAnexoFilesGrid();
        refreshAnexoModalControls();
      });
      actions.appendChild(toggleBtn);
    });
  }

  if (hasNew) {
    if (hasExisting) {
      const divider = document.createElement('div');
      divider.className = 'h-px bg-indigo-100';
      list.appendChild(divider);
    }

    const newHeader = document.createElement('p');
    newHeader.className = 'text-xs font-semibold uppercase tracking-wide text-indigo-500';
    newHeader.textContent = 'Novos arquivos';
    list.appendChild(newHeader);

    newFiles.forEach((entry) => {
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
  }

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
  anexoModal.mode = 'create';
  anexoModal.editingId = null;
  anexoModal.editingRecord = null;
  anexoModal.existingFiles = [];
  anexoModal.removedFileIds = [];
  anexoModal.currentObservacao = '';

  return anexoModal;
}

export function closeAnexoModal() {
  if (!anexoModal.overlay) return;
  anexoModal.overlay.classList.add('hidden');
  anexoModal.overlay.setAttribute('aria-hidden', 'true');
  if (anexoModal.form) anexoModal.form.reset();
  anexoModal.selectedFiles = [];
  anexoModal.pendingFile = null;
  anexoModal.mode = 'create';
  anexoModal.editingId = null;
  anexoModal.editingRecord = null;
  anexoModal.existingFiles = [];
  anexoModal.removedFileIds = [];
  anexoModal.currentObservacao = '';
  setAnexoPendingFile(null);
  updateAnexoFilesGrid();
  setAnexoModalSubmitting(false);
  if (anexoModal.keydownHandler) {
    document.removeEventListener('keydown', anexoModal.keydownHandler);
    anexoModal.keydownHandler = null;
  }
}

export function openAnexoModal(options = {}) {
  if (!ensureTutorAndPetSelected()) {
    return;
  }

  const { anexo = null } = options || {};
  const modal = ensureAnexoModal();
  setAnexoModalSubmitting(false);
  if (modal.form) {
    modal.form.reset();
  }
  modal.selectedFiles = [];
  modal.pendingFile = null;
  modal.existingFiles = [];
  modal.removedFileIds = [];
  modal.mode = 'create';
  modal.editingId = null;
  modal.editingRecord = null;
  modal.currentObservacao = '';

  if (anexo) {
    modal.mode = 'edit';
    const normalized = normalizeAnexoRecord(anexo);
    modal.editingRecord = normalized;
    const editingId = normalizeId(normalized?.id || normalized?._id);
    if (editingId) {
      modal.editingId = editingId;
    }
    modal.currentObservacao = normalized?.observacao || '';
    if (modal.titleEl) {
      modal.titleEl.textContent = 'Editar anexos';
    }
    const arquivos = Array.isArray(normalized?.arquivos) ? normalized.arquivos : [];
    modal.existingFiles = arquivos
      .map((file) => {
        const record = normalizeAnexoFileRecord(file);
        if (!record) return null;
        const id = normalizeId(record.id || record._id);
        const displayName = record.nome || record.name || record.originalName || 'Arquivo';
        return {
          ...record,
          id,
          _id: id || record._id,
          name: displayName,
          displayName,
          markedForRemoval: false,
        };
      })
      .filter(Boolean);
  } else if (modal.titleEl) {
    modal.titleEl.textContent = 'Novo anexo';
  }

  setAnexoPendingFile(null);
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
  const names = resolveAnexoAttachmentNames({
    file,
    name,
    providedName: name,
    originalName: file.name,
    extension: getFileExtension(file.name),
  });
  const normalizedExtension = normalizeAttachmentExtension(names.extension || getFileExtension(file.name));
  const entry = {
    id: generateAnexoFileId(),
    name: names.displayName,
    displayName: names.displayName,
    uploadName: names.uploadName,
    providedName: name,
    originalName: file.name,
    size: Number(file.size || 0),
    mimeType: file.type || '',
    extension: normalizedExtension,
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
  const existingFiles = Array.isArray(anexoModal.existingFiles) ? anexoModal.existingFiles : [];
  const removedIds = existingFiles
    .filter((file) => file && file.markedForRemoval)
    .map((file) => normalizeId(file.id || file._id))
    .filter(Boolean);
  const keptCount = existingFiles.filter((file) => file && !file.markedForRemoval).length;

  const hasNewFiles = files.length > 0;
  const hasRemovals = removedIds.length > 0;
  const isEditing = anexoModal.mode === 'edit' && !!anexoModal.editingId;
  const editingId = isEditing ? normalizeId(anexoModal.editingId) : null;

  if (!isEditing && !hasNewFiles) {
    notify('Adicione ao menos um arquivo antes de salvar.', 'warning');
    return;
  }

  if (isEditing && !editingId) {
    notify('Não foi possível editar este anexo agora. Recarregue a página e tente novamente.', 'error');
    return;
  }

  if (isEditing && !hasNewFiles && !hasRemovals) {
    notify('Nenhuma alteração para salvar.', 'info');
    return;
  }

  if (isEditing && keptCount + files.length === 0) {
    notify('Mantenha ao menos um arquivo ou remova o anexo.', 'warning');
    return;
  }

  const formData = new FormData();
  formData.append('clienteId', clienteId);
  formData.append('petId', petId);
  const appointmentId = normalizeId(state.agendaContext?.appointmentId);
  if (appointmentId) formData.append('appointmentId', appointmentId);
  removedIds.forEach((id) => {
    formData.append('removeFileIds[]', id);
  });

  const fallbackFiles = [];
  files.forEach((entry) => {
    const file = entry.file;
    if (!file) return;
    const originalName = entry.originalName || file.name || '';
    const names = resolveAnexoAttachmentNames({
      ...entry,
      file,
      originalName,
      extension: entry.extension || getFileExtension(originalName || file.name || ''),
    });
    entry.name = names.displayName;
    entry.displayName = names.displayName;
    entry.uploadName = names.uploadName;
    entry.extension = normalizeAttachmentExtension(
      names.extension || entry.extension || getFileExtension(originalName || file.name || ''),
    );
    if (!entry.originalName) {
      entry.originalName = originalName;
    }

    const uploadName = entry.uploadName || file.name;
    const displayName = (entry.name || entry.displayName || uploadName || file.name || '').trim() || uploadName;

    formData.append('arquivos', file, uploadName);
    formData.append('nomes[]', displayName);

    const createdAt = new Date().toISOString();
    const fallbackEntry = normalizeAnexoFileRecord({
      id: entry.id,
      nome: displayName,
      name: displayName,
      displayName,
      originalName: entry.originalName,
      mimeType: entry.mimeType || file.type || '',
      size: Number(entry.size || file.size || 0),
      extension: entry.extension,
      fileName: uploadName,
      createdAt,
    });
    if (fallbackEntry) {
      fallbackFiles.push(fallbackEntry);
    }
  });

  setAnexoModalSubmitting(true);

  try {
    const token = getAuthToken();
    const url = isEditing
      ? `${API_CONFIG.BASE_URL}/func/vet/anexos/${encodeURIComponent(editingId)}`
      : `${API_CONFIG.BASE_URL}/func/vet/anexos`;
    const method = isEditing ? 'PUT' : 'POST';
    const response = await fetch(url, {
      method,
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
    notify(isEditing ? 'Anexos atualizados com sucesso.' : 'Anexos salvos com sucesso.', 'success');
    const recordId = normalizeId(record?.id || record?._id);
    emitFichaClinicaUpdate({
      scope: 'anexo',
      action: isEditing ? 'update' : 'create',
      anexoId: recordId || null,
    }).catch(() => {});
    await loadAnexosFromServer({ force: true });
  } catch (error) {
    console.error('handleAnexoSubmit', error);
    const defaultMessage = isEditing ? 'Erro ao atualizar anexos.' : 'Erro ao salvar anexos.';
    notify(error.message || defaultMessage, 'error');
  } finally {
    setAnexoModalSubmitting(false);
  }
}
