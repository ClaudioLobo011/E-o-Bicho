const fs = require('fs');
const path = require('path');
const Product = require('../models/Product');
const {
  buildProductImagePublicPath,
  getProductImageFolderPath,
  getProductImagesRoot,
  getProductImagesDriveBaseSegments,
  getProductImagesDriveFolderPath,
  sanitizeBarcodeSegment,
} = require('../utils/productImagePath');
const { isDriveConfigured, listFilesInFolderByPath } = require('../utils/googleDrive');

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
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
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
  const baseReadablePath = Array.isArray(baseSegments) && baseSegments.length ? baseSegments.join('/') : '(raiz)';
  const barcodeFolders = [];
  const pending = [];
  const visitedFolders = new Set();

  let initialListing;

  try {
    initialListing = await listFilesInFolderByPath({
      folderPath: baseSegments,
      includeFiles: false,
      includeFolders: true,
      includeFolderShortcuts: true,
      orderBy: 'name_natural',
    });
  } catch (error) {
    emitLog(
      `Falha ao listar as pastas iniciais no Google Drive (${baseReadablePath}): ${error.message || error}.`,
      'error'
    );
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
      pathSegments: [...(Array.isArray(baseSegments) ? baseSegments : []), folderName].filter(Boolean),
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

    if (looksLikeBarcodeFolder(folderName)) {
      barcodeFolders.push({
        folderId,
        barcodeSegment: sanitizeBarcodeSegment(folderName),
        folderName,
        pathSegments: current.pathSegments.slice(),
        readablePath: current.readablePath,
      });
      continue;
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
}) {
  const prefix = progressLabel ? `${progressLabel} ` : '';
  const emitWithPrefix = (message, type) => emitLog(`${prefix}${message}`, type);

  emitWithPrefix(`Preparando análise do produto ${describeProduct(product)}.`);

  const { fileNames, source, folderPath } = await getProductImageFileNames({
    barcodeSegment,
    product,
    emitLog: emitWithPrefix,
    driveAvailable,
    driveFolderId,
    driveFolderPathSegments,
    driveReadablePath,
  });

  if (!fileNames.length) {
    emitWithPrefix(`Nenhuma imagem encontrada nas pastas esperadas (${folderPath}).`, 'warning');
    return;
  }

  emitWithPrefix(`${fileNames.length} imagem(ns) localizada(s) em ${folderPath} (${source}).`, 'info');

  const existingImages = Array.isArray(product.imagens) ? product.imagens.slice() : [];
  const existingSet = new Set(existingImages);
  const productImages = [];
  let productLinked = 0;
  let productAlready = 0;
  let hasChanges = false;

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
    productsResult.push(productPayload);
    summary.products += 1;
    summary.images += productImages.length;
    summary.linked += productLinked;
    summary.already += productAlready;
    safeNotify(callbacks.onProduct, productPayload);
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
}) {
  const productLabel = describeProduct(product);

  if (driveAvailable) {
    const drivePathSegments = Array.isArray(driveFolderPathSegments) && driveFolderPathSegments.length
      ? driveFolderPathSegments
      : getProductImagesDriveFolderPath(barcodeSegment);
    const readablePath = typeof driveReadablePath === 'string' && driveReadablePath.trim()
      ? driveReadablePath.trim()
      : drivePathSegments.join('/') || '(raiz)';

    try {
      const { files, folderId } = await listFilesInFolderByPath({
        folderId: driveFolderId || undefined,
        folderPath: driveFolderId ? [] : drivePathSegments,
      });

      const effectiveFolderId = driveFolderId || folderId;

      if (!effectiveFolderId) {
        emitLog(`Pasta ${readablePath} não encontrada no Google Drive para o produto ${productLabel}.`, 'warning');
      } else if (Array.isArray(files) && files.length) {
        const names = files
          .filter((file) => file && file.mimeType !== DRIVE_FOLDER_MIME)
          .map((file) => (typeof file?.name === 'string' ? file.name.trim() : ''))
          .filter(Boolean)
          .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

        if (names.length) {
          return { fileNames: names, source: 'drive', folderPath: readablePath };
        }
      }
    } catch (error) {
      emitLog(
        `Falha ao listar imagens no Google Drive (${readablePath}) para o produto ${productLabel}: ${error.message || error}`,
        'error'
      );
    }
  }

  const folderPath = getProductImageFolderPath(barcodeSegment);

  try {
    const names = listImagesFromFolder(folderPath);
    return { fileNames: names, source: 'local', folderPath };
  } catch (error) {
    emitLog(
      `Falha ao ler a pasta de imagens em disco (${folderPath}) para o produto ${productLabel}: ${error.message || error}`,
      'warning'
    );
    return { fileNames: [], source: 'local', folderPath };
  }
}

async function verifyAndLinkProductImages(options = {}) {
  const logs = [];
  const startedAt = new Date();
  const productsResult = [];
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
    });
  };

  const driveAvailable = isDriveConfigured();

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
        });
      }

      meta.processedProducts = currentIndex;
      emitProgress();
    }
  } else {
    const driveBaseSegments = getProductImagesDriveBaseSegments();
    const baseDrivePath = driveBaseSegments.join('/') || '(raiz)';
    emitLog('Integração com o Google Drive detectada. As pastas remotas serão analisadas.', 'info');
    emitLog(`Caminho base considerado no Google Drive: ${baseDrivePath}.`, 'info');

    const { barcodeFolders } = await collectDriveBarcodeFolders({
      baseSegments: driveBaseSegments,
      emitLog,
    });

    const foldersToProcess = barcodeFolders.slice().sort((a, b) =>
      (a?.folderName || '').localeCompare(b?.folderName || '', undefined, { numeric: true, sensitivity: 'base' })
    );

    meta.totalProducts = foldersToProcess.length;
    safeNotify(callbacks.onStart, { totalProducts: meta.totalProducts });
    emitLog(`Total de pastas encontradas no Google Drive para análise: ${foldersToProcess.length}.`);

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
          `${progressPrefix} Nenhum produto encontrado com o código de barras ${entry.folderName} (${entry.readablePath}).`,
          'warning'
        );
        meta.processedProducts = currentIndex;
        emitProgress();
        continue;
      }

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
        });
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
