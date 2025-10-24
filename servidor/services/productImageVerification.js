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

function pushLog(logs, message, type = 'info') {
  logs.push({
    message,
    type,
    timestamp: new Date().toISOString(),
  });
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

async function getProductImageFileNames({ barcodeSegment, product, logs, driveAvailable }) {
  const productLabel = describeProduct(product);

  if (driveAvailable) {
    const drivePathSegments = getProductImagesDriveFolderPath(barcodeSegment);
    const readablePath = drivePathSegments.join('/') || '(raiz)';

    try {
      const { files, folderId } = await listFilesInFolderByPath({ folderPath: drivePathSegments });

      if (!folderId) {
        pushLog(
          logs,
          `Pasta ${readablePath} não encontrada no Google Drive para o produto ${productLabel}.`,
          'warning'
        );
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
      pushLog(
        logs,
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
    pushLog(
      logs,
      `Falha ao ler a pasta de imagens em disco (${folderPath}) para o produto ${productLabel}: ${error.message || error}`,
      'warning'
    );
    return { fileNames: [], source: 'local', folderPath };
  }
}

async function verifyAndLinkProductImages() {
  const logs = [];
  const startedAt = new Date();
  const productsResult = [];
  const summary = {
    linked: 0,
    already: 0,
    products: 0,
    images: 0,
  };

  const driveAvailable = isDriveConfigured();

  pushLog(logs, 'Iniciando verificação das imagens vinculadas aos produtos.');
  if (driveAvailable) {
    const previewSegments = getProductImagesDriveFolderPath('amostra-drive').slice(0, -1);
    const baseDrivePath = previewSegments.join('/') || '(raiz)';
    pushLog(logs, 'Integração com o Google Drive detectada. As pastas remotas serão analisadas.', 'info');
    pushLog(logs, `Caminho base considerado no Google Drive: ${baseDrivePath}.`, 'info');
  }

  const products = await Product.find({}, 'cod nome codbarras imagens imagemPrincipal').exec();
  pushLog(logs, `Total de produtos carregados para análise: ${products.length}.`);

  for (const product of products) {
    const barcodeSegment = sanitizeBarcodeSegment(product.codbarras || product.cod || product.id || '');
    const { fileNames } = await getProductImageFileNames({
      barcodeSegment,
      product,
      logs,
      driveAvailable,
    });

    if (!fileNames.length) {
      continue;
    }

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
        pushLog(
          logs,
          `Imagem ${fileName} vinculada ao produto ${product.nome || product.cod || product.id}.`,
          'success'
        );
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
      pushLog(logs, `Imagem principal atualizada para o produto ${product.nome || product.cod || product.id}.`, 'info');
    }

    if (hasChanges) {
      try {
        await product.save();
      } catch (error) {
        pushLog(
          logs,
          `Erro ao salvar o produto ${product.nome || product.cod || product.id}: ${error.message || error}`,
          'error'
        );
      }
    }

    if (productImages.length > 0) {
      productsResult.push({
        id: String(product._id),
        name: product.nome || '',
        code: product.cod || '',
        barcode: product.codbarras || '',
        images: productImages,
      });
      summary.products += 1;
      summary.images += productImages.length;
      summary.linked += productLinked;
      summary.already += productAlready;
    }
  }

  pushLog(logs, 'Verificação concluída.');

  return {
    logs,
    data: {
      summary,
      products: productsResult,
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
    },
  };
}

module.exports = {
  verifyAndLinkProductImages,
};
