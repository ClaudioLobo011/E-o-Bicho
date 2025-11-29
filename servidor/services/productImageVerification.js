const fs = require('fs');
const path = require('path');
const mime = require('mime-types');
const Product = require('../models/Product');
const {
  buildProductImagePublicPath,
  getProductImageFolderPath,
  getProductImagesRoot,
  getProductImagesDriveBaseSegments,
  getProductImagesDriveFolderPath,
  sanitizeBarcodeSegment,
} = require('../utils/productImagePath');
const { isR2Configured } = require('../utils/cloudflareR2');
const {
  isDriveConfigured,
  listFilesInFolderByPath,
  getDriveFolderId,
  uploadBufferToDrive,
} = require('../utils/googleDrive');

const PLACEHOLDER_IMAGE = '/image/placeholder.png';
const DRIVE_FOLDER_MIME = 'application/vnd.google-apps.folder';
const DRIVE_SHORTCUT_MIME = 'application/vnd.google-apps.shortcut';
const MAX_DRIVE_FOLDER_DEPTH = 6;
const FALLBACK_BARCODE_SEGMENT = sanitizeBarcodeSegment('');

function safeNotify(callback, payload) {
  if (typeof callback !== 'function') {
    return;
  }

  try {
    callback(payload);
  } catch (error) {
    console.error('Erro ao notificar progresso da verificação de imagens:', error);
  }
}

function listImagesFromFolder(folderPath) {
  try {
    const entries = fs.readdirSync(folderPath, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
      if (!entry || typeof entry.name !== 'string' || !entry.name.trim()) {
        continue;
      }

      let isFileEntry = typeof entry.isFile === 'function' ? entry.isFile() : false;

      if (!isFileEntry) {
        const candidatePath = path.join(folderPath, entry.name);
        try {
          const stats = fs.statSync(candidatePath);
          isFileEntry = stats.isFile();
        } catch (statError) {
          if (statError?.code !== 'ENOENT') {
            throw statError;
          }
        }
      }

      if (isFileEntry) {
        files.push(entry.name);
      }
    }

    return files.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

function describeProduct(product) {
  return product?.nome || product?.cod || product?.id || 'produto sem identificação';
}

function stripLeadingZeros(value) {
  if (typeof value !== 'string') {
    return '';
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  const withoutZeros = trimmed.replace(/^0+/, '');
  if (withoutZeros) {
    return withoutZeros;
  }

  return /0/.test(trimmed) ? '0' : '';
}

function getProductUniqueKey(product) {
  if (!product) {
    return '';
  }

  if (product._id) {
    try {
      return String(product._id);
    } catch (error) {
      return `id:${product._id}`;
    }
  }

  if (product.id) {
    return `id:${product.id}`;
  }

  if (product.cod) {
    return `cod:${product.cod}`;
  }

  if (product.codbarras) {
    return `barcode:${product.codbarras}`;
  }

  return `nome:${product.nome || 'desconhecido'}`;
}

function addBarcodeKey(keys, value) {
  if (!value) {
    return;
  }

  const sanitized = sanitizeBarcodeSegment(value);
  if (!sanitized || sanitized === FALLBACK_BARCODE_SEGMENT) {
    return;
  }

  if (!keys.has(sanitized)) {
    keys.add(sanitized);
  }

  const withoutZeros = stripLeadingZeros(sanitized);
  if (withoutZeros && withoutZeros !== sanitized && !keys.has(withoutZeros)) {
    keys.add(withoutZeros);
  }
}

function getBarcodeIndexKeys(rawValue) {
  const keys = new Set();
  const sanitized = sanitizeBarcodeSegment(rawValue || '');

  if (!sanitized || sanitized === FALLBACK_BARCODE_SEGMENT) {
    return keys;
  }

  addBarcodeKey(keys, sanitized);

  const digitsOnly = sanitized.replace(/[^0-9]/g, '');
  if (digitsOnly) {
    addBarcodeKey(keys, digitsOnly);
  }

  const numericSegments = sanitized
    .split(/[^0-9]+/g)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length >= 4);

  for (const segment of numericSegments) {
    addBarcodeKey(keys, segment);
  }

  return keys;
}

function combineDrivePath(parent, child) {
  const safeChild = typeof child === 'string' ? child.trim() : '';
  if (!parent || parent === '(raiz)') {
    return safeChild || '(raiz)';
  }
  if (!safeChild) {
    return parent;
  }
  return `${parent}/${safeChild}`.replace(/\/{2,}/g, '/');
}

function looksLikeBarcodeFolder(folderName) {
  const sanitized = sanitizeBarcodeSegment(folderName || '');
  if (!sanitized || sanitized === FALLBACK_BARCODE_SEGMENT) {
    return false;
  }

  const digitCount = sanitized.replace(/[^0-9]/g, '').length;
  if (digitCount === 0) {
    return false;
  }

  if (digitCount < 4) {
    return false;
  }

  return true;
}

function normalizeDriveFolderItem({ item, emitLog, parentPath }) {
  if (!item) {
    return null;
  }

  const mimeType = typeof item.mimeType === 'string' ? item.mimeType.trim() : '';
  const displayName = typeof item.name === 'string' ? item.name.trim() : '';

  if (mimeType === DRIVE_FOLDER_MIME) {
    const folderId = typeof item.id === 'string' ? item.id.trim() : '';
    if (!folderId) {
      emitLog(
        `Pasta ${displayName || '(sem nome)'} em ${parentPath || '(desconhecido)'} ignorada por não possuir identificador válido.`,
        'warning'
      );
      return null;
    }
    return { folderId, folderName: displayName || folderId, kind: 'folder' };
  }

  if (mimeType === DRIVE_SHORTCUT_MIME) {
    const targetId =
      typeof item?.shortcutDetails?.targetId === 'string' ? item.shortcutDetails.targetId.trim() : '';
    const targetMime =
      typeof item?.shortcutDetails?.targetMimeType === 'string'
        ? item.shortcutDetails.targetMimeType.trim()
        : '';

    if (!targetId) {
      emitLog(
        `Atalho ${displayName || '(sem nome)'} em ${parentPath || '(desconhecido)'} ignorado por não apontar para uma pasta válida.`,
        'warning'
      );
      return null;
    }

    if (targetMime && targetMime !== DRIVE_FOLDER_MIME) {
      emitLog(
        `Atalho ${displayName || '(sem nome)'} em ${parentPath || '(desconhecido)'} ignorado por não direcionar para uma pasta do Drive.`,
        'warning'
      );
      return null;
    }

    return {
      folderId: targetId,
      folderName: displayName || targetId,
      kind: 'shortcut',
    };
  }

  return null;
}

async function collectDriveBarcodeFolders({ baseSegments, emitLog }) {
  const baseSegmentsList = Array.isArray(baseSegments)
    ? baseSegments
        .map((segment) => (typeof segment === 'string' ? segment.trim() : ''))
        .filter(Boolean)
    : [];
  const baseReadableFromSegments = baseSegmentsList.length ? baseSegmentsList.join('/') : '';
  const driveBaseFolderId = typeof getDriveFolderId === 'function' ? getDriveFolderId() : null;
  let baseReadablePath = baseReadableFromSegments || (driveBaseFolderId ? `(id:${driveBaseFolderId})` : '(raiz)');
  const barcodeFolders = [];
  const pending = [];
  const visitedFolders = new Set();

  let initialListing;

  const buildListingOptions = (extraOptions = {}) => ({
    includeFiles: false,
    includeFolders: true,
    includeFolderShortcuts: true,
    orderBy: 'name_natural',
    ...extraOptions,
  });

  const listingAttempts = [];

  if (driveBaseFolderId) {
    listingAttempts.push({
      options: buildListingOptions({ folderId: driveBaseFolderId, folderPath: [] }),
      readablePath: baseReadableFromSegments ? `${baseReadableFromSegments} (id:${driveBaseFolderId})` : `(id:${driveBaseFolderId})`,
    });

    if (baseSegmentsList.length) {
      listingAttempts.push({
        options: buildListingOptions({ folderId: driveBaseFolderId, folderPath: baseSegmentsList }),
        readablePath: `${baseSegmentsList.join('/')} (id:${driveBaseFolderId})`,
      });
    }
  }

  listingAttempts.push({
    options: buildListingOptions({ folderPath: baseSegmentsList }),
    readablePath: baseReadableFromSegments || '(raiz)',
  });

  for (const attempt of listingAttempts) {
    try {
      initialListing = await listFilesInFolderByPath(attempt.options);
      baseReadablePath = attempt.readablePath;
      break;
    } catch (error) {
      emitLog(
        `Falha ao listar as pastas iniciais no Google Drive (${attempt.readablePath}): ${error.message || error}.`,
        'error'
      );
    }
  }

  if (!initialListing) {
    emitLog('Não foi possível acessar a pasta base configurada no Google Drive.', 'error');
    return { barcodeFolders, baseReadablePath };
  }

  if (!initialListing?.folderId) {
    emitLog(
      `Pasta ${baseReadablePath} não encontrada ou inacessível no Google Drive.`,
      'warning'
    );
  }

  const initialFoldersRaw = Array.isArray(initialListing?.files) ? initialListing.files : [];
  for (const item of initialFoldersRaw) {
    const normalized = normalizeDriveFolderItem({ item, emitLog, parentPath: baseReadablePath });
    if (!normalized) {
      continue;
    }

    if (normalized.kind === 'shortcut') {
      emitLog(
        `Atalho ${normalized.folderName} resolvido para análise como pasta do Drive.`,
        'info'
      );
    }

    const folderName = normalized.folderName || normalized.folderId;
    const readablePath = combineDrivePath(baseReadablePath, folderName);
    pending.push({
      folderId: normalized.folderId,
      folderName,
      pathSegments: [...baseSegmentsList, folderName].filter(Boolean),
      readablePath,
      depth: 0,
    });
  }

  if (!pending.length) {
    emitLog(`Nenhuma subpasta encontrada em ${baseReadablePath}.`, 'warning');
  }

  while (pending.length) {
    const current = pending.shift();
    const folderId = typeof current.folderId === 'string' ? current.folderId.trim() : '';
    const folderName = typeof current.folderName === 'string' ? current.folderName.trim() : '';

    if (!folderId) {
      emitLog(`Pasta ${current.readablePath} ignorada por não possuir identificador válido no Drive.`, 'warning');
      continue;
    }

    if (visitedFolders.has(folderId)) {
      continue;
    }
    visitedFolders.add(folderId);

    if (!folderName) {
      emitLog(`Pasta em ${current.readablePath} ignorada por não possuir nome.`, 'warning');
      continue;
    }

    const sanitizedSegment = sanitizeBarcodeSegment(folderName);
    const digitCount = sanitizedSegment.replace(/[^0-9]/g, '').length;
    const isLikelyBarcode = looksLikeBarcodeFolder(folderName);

    if (sanitizedSegment && sanitizedSegment !== FALLBACK_BARCODE_SEGMENT && digitCount > 0) {
      barcodeFolders.push({
        folderId,
        barcodeSegment: sanitizedSegment,
        folderName,
        pathSegments: current.pathSegments.slice(),
        readablePath: current.readablePath,
      });

      if (isLikelyBarcode) {
        continue;
      }
    }

    if (current.depth + 1 > MAX_DRIVE_FOLDER_DEPTH) {
      emitLog(
        `Limite de profundidade atingido ao analisar ${current.readablePath}. Verifique a estrutura das pastas no Drive.`,
        'warning'
      );
      continue;
    }

    emitLog(`Explorando subpastas em ${current.readablePath} para localizar códigos de barras.`, 'info');

    let listing;
    try {
      listing = await listFilesInFolderByPath({
        folderId,
        folderPath: [],
        includeFiles: false,
        includeFolders: true,
        includeFolderShortcuts: true,
        orderBy: 'name_natural',
      });
    } catch (error) {
      emitLog(
        `Falha ao listar subpastas em ${current.readablePath}: ${error.message || error}.`,
        'error'
      );
      continue;
    }

    const subfoldersRaw = Array.isArray(listing?.files) ? listing.files : [];
    const subfolders = [];

    for (const item of subfoldersRaw) {
      const normalized = normalizeDriveFolderItem({ item, emitLog, parentPath: current.readablePath });
      if (!normalized) {
        continue;
      }

      if (normalized.kind === 'shortcut') {
        emitLog(
          `Atalho ${normalized.folderName} resolvido para análise como pasta do Drive.`,
          'info'
        );
      }

      subfolders.push(normalized);
    }

    if (!subfolders.length) {
      emitLog(`Nenhuma subpasta de código de barras encontrada dentro de ${current.readablePath}.`, 'warning');
      continue;
    }

    for (const subfolder of subfolders) {
      const childName = subfolder.folderName || subfolder.folderId;
      const readablePath = combineDrivePath(current.readablePath, childName);
      pending.push({
        folderId: subfolder.folderId,
        folderName: childName,
        pathSegments: [...current.pathSegments, childName].filter(Boolean),
        readablePath,
        depth: current.depth + 1,
      });
    }
  }

  return { barcodeFolders, baseReadablePath };
}

function collectLocalBarcodeFolders({ basePath, emitLog }) {
  const resolvedBasePath = typeof basePath === 'string' && basePath.trim() ? basePath.trim() : getProductImagesRoot();
  const barcodeFolders = [];

  let entries;
  try {
    entries = fs.readdirSync(resolvedBasePath, { withFileTypes: true });
  } catch (error) {
    emitLog(
      `Falha ao ler a pasta local de imagens (${resolvedBasePath}): ${error.message || error}.`,
      'error'
    );
    return { barcodeFolders, basePath: resolvedBasePath };
  }

  if (!entries.length) {
    emitLog(`Nenhuma pasta encontrada em ${resolvedBasePath}.`, 'warning');
    return { barcodeFolders, basePath: resolvedBasePath };
  }

  for (const entry of entries) {
    if (!entry || typeof entry.name !== 'string') {
      continue;
    }

    const folderName = entry.name.trim();
    if (!folderName) {
      continue;
    }

    if (!entry.isDirectory()) {
      continue;
    }

    if (!looksLikeBarcodeFolder(folderName)) {
      emitLog(
        `Pasta ${folderName} ignorada em ${resolvedBasePath} por não corresponder a um código de barras válido.`,
        'warning'
      );
      continue;
    }

    barcodeFolders.push({
      folderName,
      barcodeSegment: sanitizeBarcodeSegment(folderName),
      folderPath: path.join(resolvedBasePath, folderName),
    });
  }

  if (!barcodeFolders.length) {
    emitLog(`Nenhuma pasta de código de barras válida encontrada em ${resolvedBasePath}.`, 'warning');
  }

  return { barcodeFolders, basePath: resolvedBasePath };
}

async function processProductImages({
  product,
  barcodeSegment,
  emitLog,
  driveAvailable,
  summary,
  productsResult,
  callbacks,
  progressLabel,
  driveFolderId,
  driveFolderPathSegments,
  driveReadablePath,
  localFolderPath,
  driveFolderName,
  driveFolderSummary,
  folderProcessingState,
}) {
  const prefix = progressLabel ? `${progressLabel} ` : '';
  const emitWithPrefix = (message, type) => emitLog(`${prefix}${message}`, type);

  emitWithPrefix(`Preparando análise do produto ${describeProduct(product)}.`);

  const sharedState = folderProcessingState && typeof folderProcessingState === 'object'
    ? folderProcessingState
    : null;

  if (sharedState && !(sharedState.uploadedFilesSet instanceof Set)) {
    sharedState.uploadedFilesSet = new Set();
  }

  const {
    fileNames,
    source,
    folderPath,
    driveFolderId: resolvedDriveFolderIdInitial,
    driveFolderName: resolvedDriveFolderNameInitial,
    driveFolderPath,
    drivePathSegments: resolvedDrivePathSegments,
    existingDriveFileNames: initialExistingDriveFileNames,
  } = await getProductImageFileNames({
    barcodeSegment,
    product,
    emitLog: emitWithPrefix,
    driveAvailable,
    driveFolderId,
    driveFolderPathSegments,
    driveReadablePath,
    localFolderPath,
    driveFolderName,
    folderProcessingState: sharedState,
  });

  let resolvedDriveFolderId = resolvedDriveFolderIdInitial;
  let resolvedDriveFolderName = resolvedDriveFolderNameInitial;

  let existingDriveFileNames = Array.isArray(initialExistingDriveFileNames)
    ? initialExistingDriveFileNames.slice()
    : [];
  let resolvedDriveFolderPathReadable = typeof driveFolderPath === 'string' && driveFolderPath.trim()
    ? driveFolderPath.trim()
    : '';

  if (sharedState) {
    sharedState.cachedFileNames = Array.isArray(fileNames) ? fileNames.slice() : [];
    sharedState.cachedSource = source;
    sharedState.cachedFolderPath = folderPath;
    sharedState.cachedDriveFolderId = resolvedDriveFolderId || null;
    sharedState.cachedDriveFolderName = resolvedDriveFolderName || null;
    sharedState.cachedDriveFolderPath = resolvedDriveFolderPathReadable || '';
    sharedState.cachedDrivePathSegments = Array.isArray(resolvedDrivePathSegments)
      ? resolvedDrivePathSegments.slice()
      : [];
    sharedState.cachedExistingDriveFiles = existingDriveFileNames.slice();
  }

  if (!fileNames.length) {
    emitWithPrefix(`Nenhuma imagem encontrada nas pastas esperadas (${folderPath}).`, 'warning');
    if (driveFolderSummary && typeof driveFolderSummary === 'object') {
      if (!driveFolderSummary.id && resolvedDriveFolderId) {
        driveFolderSummary.id = String(resolvedDriveFolderId).trim();
      }
      if (!driveFolderSummary.name && resolvedDriveFolderName) {
        driveFolderSummary.name = String(resolvedDriveFolderName).trim();
      }
      if (!driveFolderSummary.path && folderPath) {
        driveFolderSummary.path = folderPath;
      }
    }
    return;
  }

  emitWithPrefix(`${fileNames.length} imagem(ns) localizada(s) em ${folderPath} (${source}).`, 'info');

  const driveExistingNameSet = new Set(
    existingDriveFileNames.map((name) => (typeof name === 'string' ? name.trim().toLowerCase() : '')).filter(Boolean),
  );
  const uploadPathSegments = Array.isArray(resolvedDrivePathSegments) && resolvedDrivePathSegments.length
    ? resolvedDrivePathSegments.slice()
    : getProductImagesDriveFolderPath(barcodeSegment);

  if (!resolvedDriveFolderPathReadable && uploadPathSegments.length) {
    resolvedDriveFolderPathReadable = uploadPathSegments.join('/');
  }

  if (driveFolderSummary && typeof driveFolderSummary === 'object') {
    if (!driveFolderSummary.path && resolvedDriveFolderPathReadable) {
      driveFolderSummary.path = resolvedDriveFolderPathReadable;
    }
    if (driveExistingNameSet.size > 0) {
      driveFolderSummary.hasDrive = true;
    }
  }

  if (source === 'local' && driveAvailable) {
    const uploadedFilesSet = sharedState?.uploadedFilesSet instanceof Set ? sharedState.uploadedFilesSet : null;

    for (const fileName of fileNames) {
      const normalizedKey = typeof fileName === 'string' ? fileName.trim().toLowerCase() : '';
      if (!normalizedKey) {
        continue;
      }

      if (uploadedFilesSet && uploadedFilesSet.has(normalizedKey)) {
        continue;
      }

      if (driveExistingNameSet.has(normalizedKey)) {
        if (driveFolderSummary) {
          driveFolderSummary.hasDrive = true;
        }
        emitWithPrefix(`Imagem ${fileName} já está presente no Google Drive.`, 'info');
        if (uploadedFilesSet) {
          uploadedFilesSet.add(normalizedKey);
        }
        continue;
      }

      const absolutePath = path.join(folderPath, fileName);
      let buffer;
      try {
        buffer = await fs.promises.readFile(absolutePath);
      } catch (error) {
        emitWithPrefix(
          `Falha ao ler o arquivo ${fileName} em ${absolutePath}: ${error.message || error}.`,
          'error',
        );
        continue;
      }

      const mimeType = mime.lookup(fileName) || 'application/octet-stream';
      emitWithPrefix(`Enviando ${fileName} para o Google Drive...`, 'info');

      try {
        if (driveFolderSummary) {
          driveFolderSummary.status = 'uploading';
        }

        const uploadResult = await uploadBufferToDrive(buffer, {
          name: fileName,
          mimeType,
          folderId: resolvedDriveFolderId || undefined,
          folderPath: resolvedDriveFolderId ? [] : uploadPathSegments,
        });

        if (uploadResult?.parents?.length && !resolvedDriveFolderId) {
          const candidateId = uploadResult.parents.find((value) => typeof value === 'string' && value.trim());
          if (candidateId) {
            resolvedDriveFolderId = candidateId.trim();
          }
        }

        if (!resolvedDriveFolderName && uploadPathSegments.length) {
          resolvedDriveFolderName = uploadPathSegments[uploadPathSegments.length - 1] || resolvedDriveFolderName;
        }

        if (!resolvedDriveFolderPathReadable && uploadPathSegments.length) {
          resolvedDriveFolderPathReadable = uploadPathSegments.join('/');
        }

        if (uploadResult?.id) {
          emitWithPrefix(`Upload de ${fileName} concluído no Google Drive.`, 'success');
          driveExistingNameSet.add(normalizedKey);
          existingDriveFileNames.push(fileName);
          if (uploadedFilesSet) {
            uploadedFilesSet.add(normalizedKey);
          }
          if (driveFolderSummary) {
            driveFolderSummary.hasDrive = true;
            if (!driveFolderSummary.path && resolvedDriveFolderPathReadable) {
              driveFolderSummary.path = resolvedDriveFolderPathReadable;
            }
          }
        } else {
          emitWithPrefix(
            `Upload de ${fileName} concluído, mas não foi possível confirmar o arquivo no Google Drive.`,
            'warning',
          );
        }
      } catch (error) {
        emitWithPrefix(`Erro ao enviar ${fileName} para o Google Drive: ${error.message || error}`, 'error');
        continue;
      }
    }

    if (sharedState) {
      sharedState.cachedDriveFolderId = resolvedDriveFolderId || null;
      sharedState.cachedDriveFolderName = resolvedDriveFolderName || null;
      sharedState.cachedDriveFolderPath = resolvedDriveFolderPathReadable || '';
      sharedState.cachedExistingDriveFiles = existingDriveFileNames.slice();
      sharedState.cachedDrivePathSegments = uploadPathSegments.slice();
    }
  }

  const existingImages = Array.isArray(product.imagens) ? product.imagens.slice() : [];
  const existingSet = new Set(existingImages);
  const productImages = [];
  let productLinked = 0;
  let productAlready = 0;
  let hasChanges = false;

  const normalizedDriveFolderId = typeof resolvedDriveFolderId === 'string'
    ? resolvedDriveFolderId.trim()
    : resolvedDriveFolderId
      ? String(resolvedDriveFolderId).trim()
      : '';
  const normalizedDriveFolderName = typeof resolvedDriveFolderName === 'string'
    ? resolvedDriveFolderName.trim()
    : resolvedDriveFolderName
      ? String(resolvedDriveFolderName).trim()
      : (typeof driveFolderName === 'string' ? driveFolderName.trim() : '');
  const normalizedDriveFolderPath = resolvedDriveFolderPathReadable
    ? resolvedDriveFolderPathReadable
    : typeof driveReadablePath === 'string' && driveReadablePath.trim()
      ? driveReadablePath.trim()
      : '';

  const driveFolderInfo = (normalizedDriveFolderId || normalizedDriveFolderName || normalizedDriveFolderPath)
    ? {
        id: normalizedDriveFolderId || '',
        name: normalizedDriveFolderName || '',
        path: normalizedDriveFolderPath || '',
      }
    : null;

  if (driveFolderSummary && typeof driveFolderSummary === 'object') {
    if (!driveFolderSummary.id && driveFolderInfo?.id) {
      driveFolderSummary.id = driveFolderInfo.id;
    }
    if (!driveFolderSummary.name && driveFolderInfo?.name) {
      driveFolderSummary.name = driveFolderInfo.name;
    }
    if (!driveFolderSummary.path && driveFolderInfo?.path) {
      driveFolderSummary.path = driveFolderInfo.path;
    }
  }

  fileNames.forEach((fileName, index) => {
    const publicPath = buildProductImagePublicPath(barcodeSegment, fileName);
    const alreadyLinked = existingSet.has(publicPath);
    const linkedNow = !alreadyLinked;

    if (linkedNow) {
      existingImages.push(publicPath);
      existingSet.add(publicPath);
      productLinked += 1;
      hasChanges = true;
      emitWithPrefix(`Imagem ${fileName} vinculada ao produto ${product.nome || product.cod || product.id}.`, 'success');
    } else {
      productAlready += 1;
    }

    productImages.push({
      sequence: index + 1,
      linkedNow,
      alreadyLinked,
      path: publicPath,
    });
  });

  if (hasChanges) {
    product.imagens = existingImages;
  }

  if (
    existingImages.length > 0 &&
    (!product.imagemPrincipal || product.imagemPrincipal === PLACEHOLDER_IMAGE || !existingSet.has(product.imagemPrincipal))
  ) {
    product.imagemPrincipal = existingImages[0];
    hasChanges = true;
    emitWithPrefix(`Imagem principal atualizada para o produto ${product.nome || product.cod || product.id}.`, 'info');
  }

  if (hasChanges) {
    try {
      await product.save();
    } catch (error) {
      emitWithPrefix(`Erro ao salvar o produto ${product.nome || product.cod || product.id}: ${error.message || error}`, 'error');
    }
  }

  if (productImages.length > 0) {
    const productPayload = {
      id: String(product._id),
      name: product.nome || '',
      code: product.cod || '',
      barcode: product.codbarras || '',
      images: productImages,
    };
    if (driveFolderInfo) {
      productPayload.driveFolder = driveFolderInfo;
    }
    productsResult.push(productPayload);
    summary.products += 1;
    summary.images += productImages.length;
    summary.linked += productLinked;
    summary.already += productAlready;
    safeNotify(callbacks.onProduct, productPayload);

    if (driveFolderSummary && typeof driveFolderSummary === 'object') {
      driveFolderSummary.productCount = (driveFolderSummary.productCount || 0) + 1;
      driveFolderSummary.imageCount = (driveFolderSummary.imageCount || 0) + productImages.length;
      driveFolderSummary.status = 'matched';
    }
  }
}

async function getProductImageFileNames({
  barcodeSegment,
  product,
  emitLog,
  driveAvailable,
  driveFolderId,
  driveFolderPathSegments,
  driveReadablePath,
  localFolderPath,
  driveFolderName,
  folderProcessingState,
}) {
  const productLabel = describeProduct(product);
  const explicitDriveFolderName = typeof driveFolderName === 'string' && driveFolderName.trim()
    ? driveFolderName.trim()
    : '';
  const normalizeId = (value) => {
    if (value === null || value === undefined) {
      return '';
    }
    return String(value).trim();
  };

  const sharedState = folderProcessingState && typeof folderProcessingState === 'object'
    ? folderProcessingState
    : null;

  if (sharedState?.cachedFileNames) {
    return {
      fileNames: sharedState.cachedFileNames.slice(),
      source: sharedState.cachedSource || 'local',
      folderPath: sharedState.cachedFolderPath || '',
      driveFolderId: sharedState.cachedDriveFolderId || null,
      driveFolderName: sharedState.cachedDriveFolderName || null,
      driveFolderPath: sharedState.cachedDriveFolderPath || '',
      drivePathSegments: Array.isArray(sharedState.cachedDrivePathSegments)
        ? sharedState.cachedDrivePathSegments.slice()
        : [],
      existingDriveFileNames: Array.isArray(sharedState.cachedExistingDriveFiles)
        ? sharedState.cachedExistingDriveFiles.slice()
        : [],
    };
  }

  let resolvedDriveFolderId = normalizeId(driveFolderId);
  let resolvedDriveFolderName = explicitDriveFolderName;
  const initialDriveReadablePath = typeof driveReadablePath === 'string' && driveReadablePath.trim()
    ? driveReadablePath.trim()
    : '';
  let resolvedDriveFolderPath = initialDriveReadablePath;
  let drivePathSegments = Array.isArray(driveFolderPathSegments) && driveFolderPathSegments.length
    ? driveFolderPathSegments.slice()
    : [];
  const existingDriveFileNames = [];

  const defaultDriveSegments = getProductImagesDriveFolderPath(barcodeSegment);
  if (!drivePathSegments.length) {
    drivePathSegments = defaultDriveSegments.slice();
  }

  const manualPath = typeof localFolderPath === 'string' && localFolderPath.trim() ? localFolderPath.trim() : '';
  const localCandidates = [];
  if (manualPath) {
    localCandidates.push(manualPath);
  }

  const defaultFolderPath = getProductImageFolderPath(barcodeSegment);
  if (
    !localCandidates.some((candidate) => {
      try {
        return path.resolve(candidate) === path.resolve(defaultFolderPath);
      } catch (error) {
        return false;
      }
    })
  ) {
    localCandidates.push(defaultFolderPath);
  }

  if (driveAvailable) {
    const readablePath = resolvedDriveFolderPath || drivePathSegments.join('/') || '(raiz)';
    const fallbackDriveName = drivePathSegments.length
      ? drivePathSegments[drivePathSegments.length - 1]
      : readablePath;

    try {
      const { files, folderId } = await listFilesInFolderByPath({
        folderId: resolvedDriveFolderId || undefined,
        folderPath: resolvedDriveFolderId ? [] : drivePathSegments,
      });

      const effectiveFolderId = normalizeId(resolvedDriveFolderId || folderId);
      if (!effectiveFolderId) {
        emitLog(`Pasta ${readablePath} não encontrada no Google Drive para o produto ${productLabel}.`, 'warning');
      } else {
        resolvedDriveFolderId = effectiveFolderId;
      }

      if (!resolvedDriveFolderName) {
        resolvedDriveFolderName = fallbackDriveName || effectiveFolderId || readablePath;
      }

      if (!resolvedDriveFolderPath) {
        resolvedDriveFolderPath = readablePath;
      }

      if (Array.isArray(files) && files.length) {
        const names = files
          .filter((file) => file && file.mimeType !== DRIVE_FOLDER_MIME)
          .map((file) => (typeof file?.name === 'string' ? file.name.trim() : ''))
          .filter(Boolean)
          .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

        existingDriveFileNames.push(...names);
      }
    } catch (error) {
      emitLog(
        `Falha ao listar imagens no Google Drive (${readablePath}) para o produto ${productLabel}: ${error.message || error}`,
        'error'
      );
    }
  } else {
    drivePathSegments = [];
  }

  let localResult = null;

  for (const folderPath of localCandidates) {
    try {
      const names = listImagesFromFolder(folderPath);
      if (names.length) {
        localResult = { fileNames: names, folderPath };
        break;
      }

      if (folderPath === manualPath && manualPath !== defaultFolderPath) {
        emitLog(
          `Nenhuma imagem encontrada na pasta local manual (${folderPath}) para o produto ${productLabel}.`,
          'warning'
        );
      }
    } catch (error) {
      emitLog(
        `Falha ao ler a pasta de imagens em disco (${folderPath}) para o produto ${productLabel}: ${error.message || error}`,
        'warning'
      );
    }
  }

  const buildResult = ({ fileNames = [], source = 'local', folderPath = '' } = {}) => ({
    fileNames,
    source,
    folderPath,
    driveFolderId: resolvedDriveFolderId || null,
    driveFolderName: resolvedDriveFolderName || null,
    driveFolderPath: resolvedDriveFolderPath || '',
    drivePathSegments: drivePathSegments.slice(),
    existingDriveFileNames: existingDriveFileNames.slice(),
  });

  let finalResult;

  if (localResult) {
    finalResult = buildResult({
      fileNames: localResult.fileNames,
      source: 'local',
      folderPath: localResult.folderPath,
    });
  } else if (existingDriveFileNames.length) {
    finalResult = buildResult({
      fileNames: existingDriveFileNames,
      source: 'drive',
      folderPath: resolvedDriveFolderPath || drivePathSegments.join('/') || '(raiz)',
    });
  } else if (localCandidates.length) {
    const lastPath = localCandidates[localCandidates.length - 1];
    finalResult = buildResult({ fileNames: [], source: 'local', folderPath: lastPath });
  } else {
    finalResult = buildResult({ fileNames: [], source: 'local', folderPath: defaultFolderPath });
  }

  if (!resolvedDriveFolderName && finalResult.driveFolderPath) {
    finalResult.driveFolderName = finalResult.driveFolderPath.split('/').pop() || finalResult.driveFolderPath;
  }

  if (sharedState) {
    sharedState.cachedFileNames = finalResult.fileNames.slice();
    sharedState.cachedSource = finalResult.source;
    sharedState.cachedFolderPath = finalResult.folderPath;
    sharedState.cachedDriveFolderId = finalResult.driveFolderId || null;
    sharedState.cachedDriveFolderName = finalResult.driveFolderName || null;
    sharedState.cachedDriveFolderPath = finalResult.driveFolderPath || '';
    sharedState.cachedDrivePathSegments = finalResult.drivePathSegments.slice();
    sharedState.cachedExistingDriveFiles = finalResult.existingDriveFileNames.slice();
  }

  return finalResult;
}

async function verifyAndLinkProductImages(options = {}) {
  const logs = [];
  const startedAt = new Date();
  const productsResult = [];
  const driveFoldersResult = [];
  const summary = {
    linked: 0,
    already: 0,
    products: 0,
    images: 0,
  };

  const meta = {
    totalProducts: 0,
    processedProducts: 0,
  };

  const callbacks = {
    onLog: typeof options.onLog === 'function' ? options.onLog : null,
    onStart: typeof options.onStart === 'function' ? options.onStart : null,
    onProgress: typeof options.onProgress === 'function' ? options.onProgress : null,
    onProduct: typeof options.onProduct === 'function' ? options.onProduct : null,
  };

  const nextLogId = (() => {
    let counter = 0;
    return () => {
      counter += 1;
      return `log-${startedAt.getTime()}-${counter}`;
    };
  })();

  const emitLog = (message, type = 'info') => {
    const entry = {
      id: nextLogId(),
      message,
      type,
      timestamp: new Date().toISOString(),
    };
    logs.push(entry);
    safeNotify(callbacks.onLog, entry);
    return entry;
  };

  const emitProgress = () => {
    safeNotify(callbacks.onProgress, {
      summary: { ...summary },
      meta: { ...meta },
      driveFolders: driveFoldersResult.slice(),
    });
  };

  const r2Configured = typeof isR2Configured === 'function' ? isR2Configured() : false;

  if (r2Configured) {
    emitLog(
      'As imagens de produtos agora são armazenadas no Cloudflare R2. Verificações em Google Drive ou pastas locais não são mais necessárias.',
    );
    safeNotify(callbacks.onStart, { totalProducts: 0 });
    emitProgress();

    return {
      logs,
      data: {
        summary,
        products: productsResult,
        driveFolders: driveFoldersResult,
        startedAt: startedAt.toISOString(),
        finishedAt: new Date().toISOString(),
        status: 'completed',
        error: null,
      },
      meta,
    };
  }

  const driveAvailable = false;

  emitLog(
    'Cloudflare R2 não está configurado. A verificação de imagens por Google Drive ou pastas locais foi desativada para evitar usos antigos.',
    'error',
  );

  emitProgress();

  return {
    logs,
    data: {
      summary,
      products: productsResult,
      driveFolders: driveFoldersResult,
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      status: 'failed',
      error: 'Configuração do Cloudflare R2 é obrigatória para processar imagens de produtos.',
    },
    meta,
  };

  emitLog('Iniciando verificação das imagens vinculadas aos produtos.');

  const products = await Product.find({}, 'cod nome codbarras imagens imagemPrincipal').exec();

  const barcodeIndex = new Map();
  for (const product of products) {
    const keys = getBarcodeIndexKeys(product?.codbarras);
    if (!keys.size) {
      continue;
    }

    for (const key of keys) {
      if (!barcodeIndex.has(key)) {
        barcodeIndex.set(key, []);
      }
      barcodeIndex.get(key).push(product);
    }
  }

  if (!driveAvailable) {
    const localRoot = getProductImagesRoot();
    emitLog('Integração com o Google Drive não configurada. As pastas locais serão analisadas.', 'info');
    emitLog(`Diretório base considerado: ${localRoot}.`, 'info');

    const { barcodeFolders } = collectLocalBarcodeFolders({ basePath: localRoot, emitLog });
    const foldersToProcess = barcodeFolders
      .slice()
      .sort((a, b) => (a?.folderName || '').localeCompare(b?.folderName || '', undefined, { numeric: true, sensitivity: 'base' }));

    meta.totalProducts = foldersToProcess.length;
    safeNotify(callbacks.onStart, { totalProducts: meta.totalProducts });
    emitLog(`Total de pastas locais encontradas para análise: ${foldersToProcess.length}.`);

    if (!foldersToProcess.length) {
      emitProgress();
      emitLog('Nenhuma pasta local disponível para processamento.', 'warning');
    }

    let currentIndex = 0;

    for (const entry of foldersToProcess) {
      currentIndex += 1;
      const progressPrefix = `(${currentIndex}/${foldersToProcess.length || 1})`;
      const lookupKeys = Array.from(getBarcodeIndexKeys(entry.folderName || entry.barcodeSegment));
      const seenProducts = new Set();
      const matchingProducts = [];

      for (const key of lookupKeys) {
        const productsForKey = barcodeIndex.get(key);
        if (!Array.isArray(productsForKey) || !productsForKey.length) {
          continue;
        }

        for (const product of productsForKey) {
          const productKey = getProductUniqueKey(product);
          if (!productKey || seenProducts.has(productKey)) {
            continue;
          }
          seenProducts.add(productKey);
          matchingProducts.push(product);
        }
      }

      if (!matchingProducts.length) {
        emitLog(
          `${progressPrefix} Nenhum produto encontrado com o código de barras ${entry.folderName} (${entry.folderPath}).`,
          'warning'
        );
        meta.processedProducts = currentIndex;
        emitProgress();
        continue;
      }

      const folderProcessingState = {};

      for (const product of matchingProducts) {
        await processProductImages({
          product,
          barcodeSegment: entry.barcodeSegment,
          emitLog,
          driveAvailable,
          summary,
          productsResult,
          callbacks,
          progressLabel: progressPrefix,
          localFolderPath: entry.folderPath,
          driveFolderName: entry.folderName,
          folderProcessingState,
        });
      }

      meta.processedProducts = currentIndex;
      emitProgress();
    }
  } else {
    const driveBaseSegments = getProductImagesDriveBaseSegments();
    const driveBaseFolderId = getDriveFolderId();
    const baseDrivePath = driveBaseSegments.length
      ? driveBaseSegments.join('/')
      : driveBaseFolderId
        ? `(id:${driveBaseFolderId})`
        : '(raiz)';
    emitLog('Integração com o Google Drive detectada. As pastas remotas serão analisadas.', 'info');
    emitLog(`Caminho base considerado no Google Drive: ${baseDrivePath}.`, 'info');

    const { barcodeFolders } = await collectDriveBarcodeFolders({
      baseSegments: driveBaseSegments,
      emitLog,
    });

    const { barcodeFolders: localFolders } = collectLocalBarcodeFolders({ basePath: getProductImagesRoot(), emitLog });

    const totalDriveFolders = Array.isArray(barcodeFolders) ? barcodeFolders.length : 0;
    const totalLocalFolders = Array.isArray(localFolders) ? localFolders.length : 0;

    const combinedFolders = new Map();

    for (const entry of barcodeFolders) {
      if (!entry || !entry.barcodeSegment) {
        continue;
      }
      combinedFolders.set(entry.barcodeSegment, { ...entry, hasDrive: true });
    }

    for (const localEntry of localFolders) {
      if (!localEntry || !localEntry.barcodeSegment) {
        continue;
      }

      const existing = combinedFolders.get(localEntry.barcodeSegment);
      if (existing) {
        existing.localFolderPath = localEntry.folderPath;
        if (!existing.folderName) {
          existing.folderName = localEntry.folderName;
        }
        if (!Array.isArray(existing.pathSegments) || !existing.pathSegments.length) {
          existing.pathSegments = getProductImagesDriveFolderPath(localEntry.barcodeSegment);
        }
      } else {
        combinedFolders.set(localEntry.barcodeSegment, {
          barcodeSegment: localEntry.barcodeSegment,
          folderName: localEntry.folderName,
          readablePath: localEntry.folderPath,
          localFolderPath: localEntry.folderPath,
          pathSegments: getProductImagesDriveFolderPath(localEntry.barcodeSegment),
          hasDrive: false,
        });
      }
    }

    for (const entry of combinedFolders.values()) {
      if (!Array.isArray(entry.pathSegments) || !entry.pathSegments.length) {
        entry.pathSegments = getProductImagesDriveFolderPath(entry.barcodeSegment);
      }
    }

    const foldersToProcess = Array.from(combinedFolders.values()).sort((a, b) =>
      (a?.folderName || '').localeCompare(b?.folderName || '', undefined, { numeric: true, sensitivity: 'base' })
    );

    meta.totalProducts = foldersToProcess.length;
    safeNotify(callbacks.onStart, { totalProducts: meta.totalProducts });
    emitLog(
      `Total de pastas consideradas para análise: ${foldersToProcess.length} (Drive: ${totalDriveFolders}, Locais: ${totalLocalFolders}).`
    );

    if (!foldersToProcess.length) {
      emitLog(
        'Nenhuma pasta de código de barras localizada no Google Drive. Verifique se os diretórios estão dentro do caminho configurado.',
        'warning'
      );
    }

    let currentIndex = 0;

    for (const entry of foldersToProcess) {
      currentIndex += 1;
      const progressPrefix = `(${currentIndex}/${foldersToProcess.length || 1})`;
      const lookupKeys = Array.from(getBarcodeIndexKeys(entry.folderName || entry.barcodeSegment));
      const seenProducts = new Set();
      const matchingProducts = [];

      const normalizeValue = (value) => {
        if (value === null || value === undefined) {
          return '';
        }
        if (typeof value === 'string') {
          return value.trim();
        }
        try {
          return String(value).trim();
        } catch (error) {
          return '';
        }
      };

      const driveFolderSummary = {
        id: normalizeValue(entry.folderId),
        name: normalizeValue(entry.folderName),
        path: normalizeValue(entry.readablePath || entry.localFolderPath || ''),
        barcode: normalizeValue(entry.barcodeSegment),
        source: entry.hasDrive ? 'drive' : entry.localFolderPath ? 'local' : 'unknown',
        hasDrive: Boolean(entry.hasDrive),
        productCount: 0,
        imageCount: 0,
        status: entry.hasDrive ? 'pending' : 'local-only',
      };

      for (const key of lookupKeys) {
        const productsForKey = barcodeIndex.get(key);
        if (!Array.isArray(productsForKey) || !productsForKey.length) {
          continue;
        }

        for (const product of productsForKey) {
          const productKey = getProductUniqueKey(product);
          if (!productKey || seenProducts.has(productKey)) {
            continue;
          }
          seenProducts.add(productKey);
          matchingProducts.push(product);
        }
      }

      if (!matchingProducts.length) {
        emitLog(
          `${progressPrefix} Nenhum produto encontrado com o código de barras ${entry.folderName} (${entry.readablePath || entry.localFolderPath || entry.folderName}).`,
          'warning'
        );
        if (entry.hasDrive) {
          driveFolderSummary.status = 'unmatched';
          driveFoldersResult.push(driveFolderSummary);
        }
        meta.processedProducts = currentIndex;
        emitProgress();
        continue;
      }

      const folderProcessingState = {};

      for (const product of matchingProducts) {
        await processProductImages({
          product,
          barcodeSegment: entry.barcodeSegment,
          emitLog,
          driveAvailable,
          summary,
          productsResult,
          callbacks,
          progressLabel: progressPrefix,
          driveFolderId: entry.folderId,
          driveFolderPathSegments: entry.pathSegments,
          driveReadablePath: entry.readablePath,
          localFolderPath: entry.localFolderPath,
          driveFolderName: entry.folderName,
          driveFolderSummary,
          folderProcessingState,
        });
      }

      if (entry.hasDrive) {
        if (driveFolderSummary.productCount > 0) {
          if (!driveFolderSummary.status || driveFolderSummary.status === 'pending') {
            driveFolderSummary.status = 'matched';
          }
        } else if (!driveFolderSummary.status || driveFolderSummary.status === 'pending') {
          driveFolderSummary.status = 'no-images';
        }
        driveFoldersResult.push(driveFolderSummary);
      }

      meta.processedProducts = currentIndex;
      emitProgress();
    }
  }

  emitLog('Verificação concluída.');
  emitProgress();

  return {
    logs,
    data: {
      summary,
      products: productsResult,
      driveFolders: driveFoldersResult,
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      status: 'completed',
    },
    meta,
  };
}

module.exports = {
  verifyAndLinkProductImages,
};
