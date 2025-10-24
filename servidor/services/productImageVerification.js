const fs = require('fs');
const Product = require('../models/Product');
const {
  buildProductImagePublicPath,
  getProductImageFolderPath,
  getProductImagesDriveFolderPath,
  sanitizeBarcodeSegment,
} = require('../utils/productImagePath');
const { isDriveConfigured, listFilesInFolderByPath } = require('../utils/googleDrive');

const PLACEHOLDER_IMAGE = '/image/placeholder.png';
const DRIVE_FOLDER_MIME = 'application/vnd.google-apps.folder';

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

  const fallbackBarcodeSegment = sanitizeBarcodeSegment('');

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
    if (!product || typeof product.codbarras !== 'string' || !product.codbarras.trim()) {
      continue;
    }
    const key = sanitizeBarcodeSegment(product.codbarras);
    if (!key || key === fallbackBarcodeSegment) {
      continue;
    }
    if (!barcodeIndex.has(key)) {
      barcodeIndex.set(key, []);
    }
    barcodeIndex.get(key).push(product);
  }

  if (!driveAvailable) {
    meta.totalProducts = products.length;
    safeNotify(callbacks.onStart, { totalProducts: meta.totalProducts });
    emitLog(`Total de produtos carregados para análise: ${products.length}.`);

    let currentIndex = 0;

    for (const product of products) {
      currentIndex += 1;
      const barcodeSegment = sanitizeBarcodeSegment(product.codbarras || product.cod || product.id || '');
      await processProductImages({
        product,
        barcodeSegment,
        emitLog,
        driveAvailable,
        summary,
        productsResult,
        callbacks,
        progressLabel: `(${currentIndex}/${products.length || 1})`,
      });

      meta.processedProducts = currentIndex;
      emitProgress();
    }
  } else {
    const driveBaseSegments = getProductImagesDriveFolderPath('amostra-drive').slice(0, -1);
    const baseDrivePath = driveBaseSegments.join('/') || '(raiz)';
    emitLog('Integração com o Google Drive detectada. As pastas remotas serão analisadas.', 'info');
    emitLog(`Caminho base considerado no Google Drive: ${baseDrivePath}.`, 'info');

    let driveFolders = [];
    try {
      const listResult = await listFilesInFolderByPath({
        folderPath: driveBaseSegments,
        includeFiles: false,
        includeFolders: true,
      });
      if (Array.isArray(listResult?.files)) {
        driveFolders = listResult.files.filter((item) => item?.mimeType === DRIVE_FOLDER_MIME);
      }
    } catch (error) {
      emitLog(
        `Falha ao listar pastas de códigos de barras no Google Drive (${baseDrivePath}): ${error.message || error}.`,
        'error'
      );
    }

    meta.totalProducts = driveFolders.length;
    safeNotify(callbacks.onStart, { totalProducts: meta.totalProducts });
    emitLog(`Total de pastas encontradas no Google Drive para análise: ${driveFolders.length}.`);

    if (!driveFolders.length) {
      emitLog('Nenhuma pasta de código de barras encontrada no Google Drive.', 'warning');
    }

    let currentIndex = 0;

    for (const folder of driveFolders) {
      currentIndex += 1;
      const folderName = typeof folder?.name === 'string' ? folder.name.trim() : '';
      if (!folderName) {
        emitLog(`(${currentIndex}/${driveFolders.length || 1}) Pasta sem nome ignorada.`, 'warning');
        meta.processedProducts = currentIndex;
        emitProgress();
        continue;
      }

      const barcodeSegment = sanitizeBarcodeSegment(folderName);
      if (!barcodeSegment || barcodeSegment === fallbackBarcodeSegment) {
        emitLog(
          `(${currentIndex}/${driveFolders.length || 1}) Pasta ${folderName} ignorada por não representar um código de barras válido.`,
          'warning'
        );
        meta.processedProducts = currentIndex;
        emitProgress();
        continue;
      }

      const matchingProducts = barcodeIndex.get(barcodeSegment) || [];

      if (!matchingProducts.length) {
        emitLog(
          `(${currentIndex}/${driveFolders.length || 1}) Nenhum produto encontrado com o código de barras ${folderName}.`,
          'warning'
        );
        meta.processedProducts = currentIndex;
        emitProgress();
        continue;
      }

      const driveFolderSegments = [...driveBaseSegments, folderName];
      const readablePath =
        baseDrivePath === '(raiz)'
          ? folderName
          : `${baseDrivePath}/${folderName}`.replace(/\/{2,}/g, '/');

      for (const product of matchingProducts) {
        await processProductImages({
          product,
          barcodeSegment,
          emitLog,
          driveAvailable,
          summary,
          productsResult,
          callbacks,
          progressLabel: `(${currentIndex}/${driveFolders.length || 1})`,
          driveFolderId: folder.id,
          driveFolderPathSegments: driveFolderSegments,
          driveReadablePath: readablePath,
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
