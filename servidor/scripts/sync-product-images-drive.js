#!/usr/bin/env node

const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const Product = require('../models/Product');
const {
  getProductImagesDriveFolderPath,
  getProductImagesRoot,
  parseProductImagePublicPath,
  resolveDiskPathFromPublicPath,
  sanitizeBarcodeSegment,
} = require('../utils/productImagePath');
const {
  findDriveFileByPath,
  isDriveConfigured,
  uploadBufferToDrive,
} = require('../utils/googleDrive');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const isDryRun = process.argv.includes('--dry-run');

function log(message) {
  // eslint-disable-next-line no-console
  console.log(message);
}

const MIME_TYPES = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

function inferMimeTypeFromName(fileName) {
  if (typeof fileName !== 'string') return 'application/octet-stream';
  const extension = path.extname(fileName).toLowerCase();
  return MIME_TYPES[extension] || 'application/octet-stream';
}

const driveConfigured = isDriveConfigured();

if (!driveConfigured && !isDryRun) {
  log('ERRO: Credenciais do Google Drive não configuradas. Configure GOOGLE_DRIVE_CLIENT_ID, GOOGLE_DRIVE_CLIENT_SECRET, GOOGLE_DRIVE_REFRESH_TOKEN e GOOGLE_DRIVE_FOLDER_ID antes de executar.');
  process.exit(1);
}

if (!driveConfigured && isDryRun) {
  log('AVISO: Credenciais do Google Drive não foram encontradas. A execução em modo de teste prosseguirá sem enviar arquivos.');
}

const summary = {
  productsScanned: 0,
  imageReferencesFound: 0,
  invalidReferences: 0,
  uniqueImages: 0,
  duplicates: 0,
  missingLocal: 0,
  uploads: 0,
  alreadyPresent: 0,
  simulatedUploads: 0,
  driveUnavailable: 0,
  uploadErrors: 0,
  lookupWarnings: 0,
  localFilesProcessed: 0,
  issues: [],
};

const processedKeys = new Set();

async function ensureDriveUpload({ barcodeSegment, fileName, filePath }) {
  if (!driveConfigured) {
    return { status: 'drive-not-configured' };
  }

  if (isDryRun) {
    return { status: 'dry-run' };
  }

  const folderPath = getProductImagesDriveFolderPath(barcodeSegment);
  let existing = null;
  try {
    existing = await findDriveFileByPath({ folderPath, fileName });
  } catch (lookupError) {
    summary.lookupWarnings += 1;
    summary.issues.push({
      type: 'lookup',
      barcode: barcodeSegment,
      fileName,
      message: lookupError?.message || String(lookupError),
    });
    log(`Aviso: falha ao verificar arquivo no Drive (${barcodeSegment}/${fileName}): ${lookupError.message || lookupError}`);
  }

  if (existing?.id) {
    return { status: 'already-exists', id: existing.id };
  }

  try {
    const buffer = await fs.promises.readFile(filePath);
    const uploadResult = await uploadBufferToDrive(buffer, {
      mimeType: inferMimeTypeFromName(fileName),
      name: fileName,
      folderPath,
    });
    return { status: 'uploaded', id: uploadResult?.id || null };
  } catch (uploadError) {
    return { status: 'error', error: uploadError };
  }
}

async function processImageEntry({ barcodeSegment, fileName, filePath, source }) {
  const sanitizedBarcode = sanitizeBarcodeSegment(barcodeSegment);
  const key = `${sanitizedBarcode}::${fileName}`;

  if (processedKeys.has(key)) {
    summary.duplicates += 1;
    return;
  }

  processedKeys.add(key);
  summary.uniqueImages += 1;

  if (!filePath || !fs.existsSync(filePath)) {
    summary.missingLocal += 1;
    summary.issues.push({
      type: 'missing',
      barcode: sanitizedBarcode,
      fileName,
      source,
      path: filePath || 'desconhecido',
    });
    log(`Aviso: arquivo não encontrado (${sanitizedBarcode}/${fileName}) registrado em ${source}.`);
    return;
  }

  const result = await ensureDriveUpload({ barcodeSegment: sanitizedBarcode, fileName, filePath });

  if (result.status === 'dry-run') {
    summary.simulatedUploads += 1;
    log(`[DRY-RUN] Enviaria ${sanitizedBarcode}/${fileName} (${source}).`);
    return;
  }

  if (result.status === 'drive-not-configured') {
    summary.driveUnavailable += 1;
    log(`Aviso: Drive não configurado. ${sanitizedBarcode}/${fileName} (${source}) não foi enviado.`);
    return;
  }

  if (result.status === 'already-exists') {
    summary.alreadyPresent += 1;
    return;
  }

  if (result.status === 'uploaded') {
    summary.uploads += 1;
    log(`Upload concluído: ${sanitizedBarcode}/${fileName}`);
    return;
  }

  summary.uploadErrors += 1;
  summary.issues.push({
    type: 'upload',
    barcode: sanitizedBarcode,
    fileName,
    source,
    message: result.error?.message || String(result.error || 'Erro desconhecido'),
  });
  log(`ERRO: falha ao enviar ${sanitizedBarcode}/${fileName}: ${result.error?.message || result.error}`);
}

async function processImageReference(imagePath, source) {
  if (typeof imagePath !== 'string' || !imagePath.trim()) {
    return;
  }

  summary.imageReferencesFound += 1;

  const parsed = parseProductImagePublicPath(imagePath);
  if (!parsed) {
    summary.invalidReferences += 1;
    return;
  }

  const diskPath = resolveDiskPathFromPublicPath(imagePath);
  await processImageEntry({
    barcodeSegment: parsed.barcodeSegment,
    fileName: parsed.fileName,
    filePath: diskPath,
    source,
  });
}

async function processProducts() {
  const projection = { imagens: 1, imagemPrincipal: 1 };
  const products = await Product.find({}, projection).lean();
  summary.productsScanned = products.length;

  for (const product of products) {
    const productId = product?._id ? String(product._id) : 'desconhecido';
    const baseSource = `produto ${productId}`;
    const images = Array.isArray(product?.imagens) ? product.imagens : [];

    for (const image of images) {
      // eslint-disable-next-line no-await-in-loop
      await processImageReference(image, `${baseSource} (galeria)`);
    }

    if (product?.imagemPrincipal) {
      // eslint-disable-next-line no-await-in-loop
      await processImageReference(product.imagemPrincipal, `${baseSource} (principal)`);
    }
  }
}

async function processLocalFolders() {
  const rootDir = getProductImagesRoot();
  if (!rootDir || !fs.existsSync(rootDir)) {
    log(`Aviso: diretório local de imagens não encontrado (${rootDir || 'não configurado'}).`);
    return;
  }

  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const folderName = entry.name;
    if (!folderName || folderName.startsWith('.')) {
      continue;
    }

    const folderPath = path.join(rootDir, folderName);
    let files = [];
    try {
      files = fs.readdirSync(folderPath, { withFileTypes: true });
    } catch (error) {
      summary.issues.push({
        type: 'read-dir',
        barcode: folderName,
        message: error?.message || String(error),
      });
      log(`Aviso: não foi possível ler a pasta ${folderPath}: ${error.message || error}`);
      continue;
    }

    for (const fileEntry of files) {
      if (!fileEntry.isFile()) {
        continue;
      }

      summary.localFilesProcessed += 1;
      const fileName = fileEntry.name;
      const filePath = path.join(folderPath, fileName);
      // eslint-disable-next-line no-await-in-loop
      await processImageEntry({
        barcodeSegment: folderName,
        fileName,
        filePath,
        source: `arquivo local ${filePath}`,
      });
    }
  }
}

async function main() {
  try {
    await connectDB();
    log('Conexão com o banco estabelecida. Iniciando verificação das imagens...');

    await processProducts();
    await processLocalFolders();

    log('--- Resumo da sincronização ---');
    log(`Produtos analisados: ${summary.productsScanned}`);
    log(`Referências de imagens analisadas: ${summary.imageReferencesFound}`);
    if (summary.invalidReferences > 0) {
      log(`Referências ignoradas (fora do padrão atual): ${summary.invalidReferences}`);
    }
    log(`Arquivos únicos considerados: ${summary.uniqueImages}`);
    if (summary.duplicates > 0) {
      log(`Arquivos ignorados por duplicidade: ${summary.duplicates}`);
    }
    log(`Arquivos verificados diretamente na pasta: ${summary.localFilesProcessed}`);
    log(`Uploads realizados: ${summary.uploads}`);
    log(`Arquivos já presentes no Drive: ${summary.alreadyPresent}`);
    if (summary.simulatedUploads > 0) {
      log(`Uploads simulados (dry-run): ${summary.simulatedUploads}`);
    }
    if (summary.missingLocal > 0) {
      log(`Arquivos ausentes localmente: ${summary.missingLocal}`);
    }
    if (summary.lookupWarnings > 0) {
      log(`Avisos durante a verificação no Drive: ${summary.lookupWarnings}`);
    }
    if (summary.uploadErrors > 0) {
      log(`Falhas de upload: ${summary.uploadErrors}`);
    }

    if (summary.issues.length > 0) {
      log('--- Detalhes das ocorrências ---');
      summary.issues.forEach((issue) => {
        if (issue.type === 'missing') {
          log(`Faltando: ${issue.barcode}/${issue.fileName} (${issue.source}) - caminho: ${issue.path}`);
        } else if (issue.type === 'upload') {
          log(`Erro de upload: ${issue.barcode}/${issue.fileName} (${issue.source}) - ${issue.message}`);
        } else if (issue.type === 'lookup') {
          log(`Aviso Drive: ${issue.barcode}/${issue.fileName} - ${issue.message}`);
        } else if (issue.type === 'read-dir') {
          log(`Aviso leitura de pasta (${issue.barcode}): ${issue.message}`);
        }
      });
    }

    if (isDryRun) {
      log('Execução em modo de teste concluída. Nenhum arquivo foi enviado ao Google Drive.');
    }

    await mongoose.disconnect();
    const exitCode = summary.uploadErrors > 0 ? 1 : 0;
    process.exit(exitCode);
  } catch (error) {
    console.error('Erro ao sincronizar imagens com o Google Drive:', error);
    try {
      await mongoose.disconnect();
    } catch (disconnectError) {
      console.error('Erro ao encerrar conexão com o banco:', disconnectError);
    }
    process.exit(1);
  }
}

main();
