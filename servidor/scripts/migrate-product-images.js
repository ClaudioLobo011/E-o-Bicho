#!/usr/bin/env node

const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const Product = require('../models/Product');
const {
  buildProductImageFileName,
  buildProductImagePublicPath,
  buildProductImageStoragePath,
  ensureProductImageFolder,
  getLegacyUploadsDir,
  getLegacyUrlPrefix,
  listProductImageFiles,
  moveFile,
  resolveDiskPathFromPublicPath,
  sanitizeBarcodeSegment,
} = require('../utils/productImagePath');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const isDryRun = process.argv.includes('--dry-run');
const legacyPrefix = getLegacyUrlPrefix();
const legacyUploadsDir = getLegacyUploadsDir();

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function log(message) {
  // eslint-disable-next-line no-console
  console.log(message);
}

async function migrateProductImages(product) {
  const barcodeBase = product.codbarras || product.cod || product._id;
  const barcodeSegment = sanitizeBarcodeSegment(barcodeBase);

  if (!isDryRun) {
    await ensureProductImageFolder(barcodeSegment);
  }

  const existingFiles = new Set(listProductImageFiles(barcodeSegment));
  let sequence = existingFiles.size;
  const imageUpdates = new Map();
  const missingFiles = [];
  const movedFiles = [];

  const updateImage = async (imageUrl, index) => {
    if (typeof imageUrl !== 'string' || !imageUrl.startsWith(legacyPrefix)) {
      return imageUrl;
    }

    const sourcePath = resolveDiskPathFromPublicPath(imageUrl);
    if (!sourcePath || !fs.existsSync(sourcePath)) {
      missingFiles.push({ imageUrl, sourcePath });
      return imageUrl;
    }

    sequence += 1;
    let newFilename = buildProductImageFileName({
      barcode: barcodeSegment,
      sequence,
      originalName: path.basename(sourcePath),
    });
    let targetPath = buildProductImageStoragePath(barcodeSegment, newFilename);

    while (!isDryRun && fs.existsSync(targetPath)) {
      sequence += 1;
      newFilename = buildProductImageFileName({
        barcode: barcodeSegment,
        sequence,
        originalName: path.basename(sourcePath),
      });
      targetPath = buildProductImageStoragePath(barcodeSegment, newFilename);
    }

    const newPublicPath = buildProductImagePublicPath(barcodeSegment, newFilename);

    if (!isDryRun) {
      await moveFile(sourcePath, targetPath);
    }

    imageUpdates.set(imageUrl, newPublicPath);
    movedFiles.push({ from: sourcePath, to: targetPath });
    return newPublicPath;
  };

  const originalImages = Array.isArray(product.imagens) ? product.imagens : [];
  const updatedImages = [];
  for (let index = 0; index < originalImages.length; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    const updated = await updateImage(originalImages[index], index);
    updatedImages.push(updated);
  }

  let updatedMainImage = product.imagemPrincipal;
  if (typeof updatedMainImage === 'string' && imageUpdates.has(updatedMainImage)) {
    updatedMainImage = imageUpdates.get(updatedMainImage);
  }

  const changed =
    movedFiles.length > 0 ||
    originalImages.length !== updatedImages.length ||
    originalImages.some((image, index) => image !== updatedImages[index]) ||
    product.imagemPrincipal !== updatedMainImage;

  if (changed && !isDryRun) {
    product.imagens = updatedImages;
    product.imagemPrincipal = updatedMainImage;
    await product.save();
  }

  return {
    barcodeSegment,
    changed,
    movedFiles,
    missingFiles,
    updatedImages,
    updatedMainImage,
  };
}

async function moveRemainingLegacyFiles() {
  if (!fs.existsSync(legacyUploadsDir)) {
    return [];
  }

  const entries = fs.readdirSync(legacyUploadsDir);
  const moved = [];

  for (const fileName of entries) {
    const [rawBarcode] = fileName.split('-');
    const barcodeSegment = sanitizeBarcodeSegment(rawBarcode);
    if (!barcodeSegment) {
      continue;
    }

    const sourcePath = path.join(legacyUploadsDir, fileName);
    let stats = null;
    try {
      stats = fs.statSync(sourcePath);
    } catch (error) {
      continue;
    }

    if (!stats.isFile()) {
      continue;
    }

    if (!isDryRun) {
      await ensureProductImageFolder(barcodeSegment);
    }

    let sequence = Date.now();
    let newFilename = buildProductImageFileName({
      barcode: barcodeSegment,
      sequence,
      originalName: fileName,
    });
    let targetPath = buildProductImageStoragePath(barcodeSegment, newFilename);

    while (!isDryRun && fs.existsSync(targetPath)) {
      sequence += 1;
      newFilename = buildProductImageFileName({
        barcode: barcodeSegment,
        sequence,
        originalName: fileName,
      });
      targetPath = buildProductImageStoragePath(barcodeSegment, newFilename);
    }

    if (!isDryRun) {
      await moveFile(sourcePath, targetPath);
    }

    moved.push({ from: sourcePath, to: targetPath });
  }

  return moved;
}

async function main() {
  try {
    await connectDB();

    if (!legacyPrefix) {
      log('Prefixo legado não configurado. Nenhuma ação necessária.');
      process.exit(0);
    }

    const legacyRegex = new RegExp(`^${escapeRegex(legacyPrefix)}`);
    const products = await Product.find({
      $or: [
        { imagemPrincipal: { $regex: legacyRegex } },
        { imagens: { $elemMatch: { $regex: legacyRegex } } },
      ],
    });

    log(`Encontrados ${products.length} produtos com imagens legadas.`);

    let updatedProducts = 0;
    let migratedFiles = 0;
    const missingFiles = [];

    for (const product of products) {
      // eslint-disable-next-line no-await-in-loop
      const result = await migrateProductImages(product);
      if (result.changed) {
        updatedProducts += 1;
        migratedFiles += result.movedFiles.length;
      }
      result.missingFiles.forEach((item) => missingFiles.push({ productId: product._id, ...item }));
    }

    const remainingMoves = await moveRemainingLegacyFiles();
    migratedFiles += remainingMoves.length;

    log(`Produtos atualizados: ${updatedProducts}`);
    log(`Imagens migradas: ${migratedFiles}`);

    if (missingFiles.length > 0) {
      log('Algumas imagens não foram encontradas:');
      missingFiles.forEach((item) => {
        log(`- Produto ${item.productId}: ${item.imageUrl} (arquivo não encontrado: ${item.sourcePath || 'desconhecido'})`);
      });
    }

    if (isDryRun) {
      log('Execução em modo de teste (--dry-run). Nenhuma alteração permanente foi realizada.');
    }

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('Erro ao migrar imagens de produtos:', error);
    try {
      await mongoose.disconnect();
    } catch (disconnectError) {
      console.error('Erro ao finalizar conexão com o banco:', disconnectError);
    }
    process.exit(1);
  }
}

main();
