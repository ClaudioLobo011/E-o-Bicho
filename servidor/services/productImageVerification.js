const fs = require('fs');
const Product = require('../models/Product');
const {
  buildProductImagePublicPath,
  getProductImageFolderPath,
  sanitizeBarcodeSegment,
} = require('../utils/productImagePath');

const PLACEHOLDER_IMAGE = '/image/placeholder.png';

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

  pushLog(logs, 'Iniciando verificação das imagens vinculadas aos produtos.');

  const products = await Product.find({}, 'cod nome codbarras imagens imagemPrincipal').exec();
  pushLog(logs, `Total de produtos carregados para análise: ${products.length}.`);

  for (const product of products) {
    const barcodeSegment = sanitizeBarcodeSegment(product.codbarras || product.cod || product.id || '');
    const folderPath = getProductImageFolderPath(barcodeSegment);

    let fileNames;
    try {
      fileNames = listImagesFromFolder(folderPath);
    } catch (error) {
      pushLog(
        logs,
        `Falha ao ler a pasta de imagens para o produto ${product.nome || product.cod || product.id}: ${error.message || error}`,
        'warning'
      );
      continue;
    }

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
