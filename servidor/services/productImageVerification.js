const fs = require('fs');
const path = require('path');
const mime = require('mime-types');
const Product = require('../models/Product');
const {
  buildProductImageFileName,
  buildProductImageR2Key,
  sanitizeBarcodeSegment,
} = require('../utils/productImagePath');
const {
  isR2Configured,
  uploadBufferToR2,
  buildPublicUrl,
  parseKeyFromPublicUrl,
} = require('../utils/cloudflareR2');

const PLACEHOLDER_IMAGE = '/image/placeholder.svg';
const PUBLIC_DIR = path.resolve(path.join(__dirname, '..', 'public'));
const CONSOLE_LOG_LIMIT = 500;
const MAX_UPLOAD_FILES = 200;

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

function buildLogEntry(message, type = 'info') {
  return {
    id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    message,
    type,
    timestamp: new Date().toISOString(),
  };
}

function appendLog(result, entry) {
  if (!result || !entry) {
    return;
  }

  result.logs.push(entry);
  if (result.logs.length > CONSOLE_LOG_LIMIT) {
    result.logs = result.logs.slice(-CONSOLE_LOG_LIMIT);
  }
}

function createEmptyResult() {
  const startedAt = new Date().toISOString();

  return {
    logs: [],
    data: {
      summary: {
        linked: 0,
        already: 0,
        products: 0,
        images: 0,
      },
      products: [],
      startedAt,
      finishedAt: null,
      status: 'processing',
      error: null,
    },
    meta: {
      totalProducts: 0,
      processedProducts: 0,
    },
  };
}

function escapeRegExp(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeImageList(product) {
  const urls = [];
  const seen = new Set();

  const addUrl = (candidate) => {
    if (typeof candidate !== 'string') return;
    const trimmed = candidate.trim();
    if (!trimmed || trimmed === PLACEHOLDER_IMAGE) return;
    const normalized = trimmed.replace(/\s+/g, '');
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    urls.push(normalized);
  };

  if (Array.isArray(product?.imagens)) {
    product.imagens.forEach(addUrl);
  }

  if (typeof product?.imagemPrincipal === 'string') {
    addUrl(product.imagemPrincipal);
  }

  return urls;
}

async function fetchImageBuffer(url) {
  if (typeof url !== 'string' || !url.trim()) {
    throw new Error('URL de origem vazia.');
  }

  const trimmed = url.trim();

  if (/^https?:\/\//i.test(trimmed)) {
    const response = await fetch(trimmed);
    if (!response.ok) {
      throw new Error(`Falha ao baixar imagem (${response.status} ${response.statusText}).`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get('content-type') || mime.lookup(trimmed) || 'application/octet-stream';
    return { buffer, contentType };
  }

  const relativePath = trimmed.replace(/^\/+/, '');
  const absolutePath = path.resolve(path.join(PUBLIC_DIR, relativePath));
  const isInsidePublic = absolutePath.startsWith(PUBLIC_DIR);

  if (!isInsidePublic) {
    throw new Error('Caminho da imagem fora da pasta pública.');
  }

  const stats = await fs.promises.stat(absolutePath);
  if (!stats.isFile()) {
    throw new Error('Caminho informado não é um arquivo.');
  }

  const buffer = await fs.promises.readFile(absolutePath);
  const contentType = mime.lookup(absolutePath) || 'application/octet-stream';
  return { buffer, contentType };
}

function parseUploadFileName(originalname) {
  if (typeof originalname !== 'string') {
    return null;
  }

  const cleaned = originalname.trim().split(/[/\\]/).pop();
  const match = cleaned.match(/^(.+?)-(\d+)\.[^.]+$/);
  if (!match) {
    return null;
  }

  const barcode = sanitizeBarcodeSegment(match[1]);
  const sequence = parseInt(match[2], 10);

  if (!barcode || Number.isNaN(sequence) || sequence <= 0) {
    return null;
  }

  return { barcode, sequence };
}

async function processProductImages({ product, emitLog }) {
  const barcodeSegment = sanitizeBarcodeSegment(product?.codbarras || product?.barcode || '');
  const candidateUrls = normalizeImageList(product);

  const result = {
    id: String(product._id || product.id || product.cod || product.cod_produto || Date.now()),
    name: String(product.nome || product.name || 'Produto sem nome'),
    code: String(product.cod || product.codigo || product.code || ''),
    barcode: String(product.codbarras || product.barcode || ''),
    images: [],
  };

  if (!candidateUrls.length) {
    emitLog(`Produto ${result.name} não possui imagens para processar.`, 'warning');
    return { result, summary: { linked: 0, already: 0, images: 0 } };
  }

  let linked = 0;
  let already = 0;

  for (let index = 0; index < candidateUrls.length; index += 1) {
    const sourceUrl = candidateUrls[index];
    const sequence = index + 1;
    const entry = {
      sequence,
      source: sourceUrl,
      destination: '',
      status: 'failed',
      message: '',
    };

    try {
      const existingKey = parseKeyFromPublicUrl(sourceUrl);
      if (existingKey) {
        entry.destination = buildPublicUrl(existingKey) || sourceUrl;
        entry.status = 'already';
        already += 1;
        result.images.push(entry);
        continue;
      }

      const { buffer, contentType } = await fetchImageBuffer(sourceUrl);
      const ext = path.extname(sourceUrl) || mime.extension(contentType) || '.jpg';
      const fileName = buildProductImageFileName({ barcode: barcodeSegment, sequence, originalName: `imagem${ext}` });
      const r2Key = buildProductImageR2Key(barcodeSegment, fileName);

      const uploadResult = await uploadBufferToR2(buffer, {
        key: r2Key,
        contentType,
      });

      entry.destination = uploadResult?.url || buildPublicUrl(uploadResult?.key || r2Key);
      entry.status = 'uploaded';
      linked += 1;
    } catch (error) {
      entry.message = error?.message || 'Falha ao processar a imagem.';
      emitLog(`Erro ao processar imagem ${sequence} do produto ${result.name}: ${entry.message}`, 'error');
    }

    result.images.push(entry);
  }

  const newImagePaths = result.images
    .filter((image) => image.status === 'uploaded' || image.status === 'already')
    .map((image) => image.destination)
    .filter(Boolean);

  if (newImagePaths.length) {
    try {
      product.imagens = newImagePaths;
      product.imagemPrincipal = newImagePaths[0] || PLACEHOLDER_IMAGE;
      await product.save();
      emitLog(`Imagens do produto ${result.name} atualizadas com sucesso.`, 'success');
    } catch (saveError) {
      emitLog(`Falha ao salvar imagens do produto ${result.name}: ${saveError.message}`, 'error');
    }
  }

  return {
    result,
    summary: {
      linked,
      already,
      images: candidateUrls.length,
    },
  };
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

  const emitLog = (message, type = 'info') => {
    const entry = {
      id: `log-${startedAt.getTime()}-${Math.random().toString(36).slice(2, 10)}`,
      message,
      type,
      timestamp: new Date().toISOString(),
    };
    logs.push(entry);
    safeNotify(callbacks.onLog, entry);
    return entry;
  };

  const sharedResult = createEmptyResult();
  sharedResult.data.startedAt = startedAt.toISOString();

  const emitProgress = () => {
    safeNotify(callbacks.onProgress, {
      summary: { ...summary },
      meta: { ...meta },
    });
  };

  if (!isR2Configured()) {
    const message = 'Configuração do Cloudflare R2 é obrigatória para processar imagens de produtos.';
    emitLog(message, 'error');
    appendLog(sharedResult, buildLogEntry(message, 'error'));
    return {
      logs,
      data: {
        ...sharedResult.data,
        status: 'failed',
        error: message,
      },
      meta,
    };
  }

  emitLog('Iniciando verificação das imagens e envio para a Cloudflare.');

  const products = await Product.find({}, 'cod nome codbarras imagens imagemPrincipal').exec();
  meta.totalProducts = products.length;
  safeNotify(callbacks.onStart, { totalProducts: products.length });

  for (const product of products) {
    const { result, summary: productSummary } = await processProductImages({ product, emitLog });
    productsResult.push(result);
    safeNotify(callbacks.onProduct, result);

    summary.linked += productSummary.linked;
    summary.already += productSummary.already;
    summary.products += 1;
    summary.images += productSummary.images;

    meta.processedProducts += 1;
    emitProgress();
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

async function uploadLocalProductImages(files = [], options = {}) {
  const logs = [];
  const startedAt = new Date();
  const productsResult = [];
  const summary = {
    linked: 0,
    products: 0,
    images: 0,
    ignored: 0,
  };

  const meta = {
    totalProducts: 0,
    processedProducts: 0,
  };

  const callbacks = {
    onLog: typeof options.onLog === 'function' ? options.onLog : null,
  };

  const emitLog = (message, type = 'info') => {
    const entry = buildLogEntry(message, type);
    logs.push(entry);
    safeNotify(callbacks.onLog, entry);
    return entry;
  };

  if (!isR2Configured()) {
    const message = 'Configuração do Cloudflare R2 é obrigatória para enviar imagens.';
    emitLog(message, 'error');
    return {
      logs,
      data: {
        summary: { ...summary },
        products: productsResult,
        startedAt: startedAt.toISOString(),
        finishedAt: new Date().toISOString(),
        status: 'failed',
        error: message,
      },
      meta,
    };
  }

  if (!Array.isArray(files) || !files.length) {
    const message = 'Nenhum arquivo foi enviado.';
    emitLog(message, 'error');
    return {
      logs,
      data: {
        summary: { ...summary },
        products: productsResult,
        startedAt: startedAt.toISOString(),
        finishedAt: new Date().toISOString(),
        status: 'failed',
        error: message,
      },
      meta,
    };
  }

  const limitedFiles = files.slice(0, MAX_UPLOAD_FILES);
  if (files.length > MAX_UPLOAD_FILES) {
    emitLog(`Limite de ${MAX_UPLOAD_FILES} arquivos excedido. Apenas os primeiros arquivos serão processados.`, 'warning');
  }

  const groupedFiles = new Map();
  limitedFiles.forEach((file) => {
    const parsed = parseUploadFileName(file?.originalname);
    if (!parsed) {
      summary.ignored += 1;
      emitLog(`Arquivo ignorado: ${file?.originalname || 'sem nome'} (padrão esperado: codbarras-1.ext)`, 'warning');
      return;
    }

    const bucket = groupedFiles.get(parsed.barcode) || [];
    bucket.push({ ...parsed, file });
    groupedFiles.set(parsed.barcode, bucket);
  });

  meta.totalProducts = groupedFiles.size;

  if (!groupedFiles.size) {
    const message = 'Nenhum arquivo válido no padrão codbarras-1.ext foi encontrado.';
    emitLog(message, 'error');
    return {
      logs,
      data: {
        summary: { ...summary },
        products: productsResult,
        startedAt: startedAt.toISOString(),
        finishedAt: new Date().toISOString(),
        status: 'failed',
        error: message,
      },
      meta,
    };
  }

  for (const [barcode, items] of groupedFiles.entries()) {
    const product = await Product.findOne({ codbarras: new RegExp(`^${escapeRegExp(barcode)}$`, 'i') }).exec();
    if (!product) {
      emitLog(`Produto não encontrado para o código de barras ${barcode}.`, 'warning');
      continue;
    }

    const sortedItems = items.slice().sort((a, b) => a.sequence - b.sequence);
    const uploadedImages = [];

    for (const entry of sortedItems) {
      const { file, sequence } = entry;
      const contentType = file?.mimetype || mime.lookup(file?.originalname || '') || 'application/octet-stream';
      const fileName = buildProductImageFileName({ barcode, sequence, originalName: file?.originalname || 'imagem.jpg' });
      const r2Key = buildProductImageR2Key(barcode, fileName);

      try {
        const uploadResult = await uploadBufferToR2(file.buffer, { key: r2Key, contentType });
        const url = uploadResult?.url || buildPublicUrl(uploadResult?.key || r2Key);
        uploadedImages.push({
          sequence,
          status: 'uploaded',
          source: file?.originalname || '',
          destination: url,
        });
        summary.linked += 1;
        summary.images += 1;
      } catch (error) {
        uploadedImages.push({
          sequence,
          status: 'failed',
          source: file?.originalname || '',
          destination: '',
          message: error?.message || 'Falha ao enviar para a Cloudflare.',
        });
        emitLog(`Falha ao enviar ${file?.originalname || 'arquivo'}: ${error?.message || 'erro desconhecido'}`, 'error');
      }
    }

    const successfulUrls = uploadedImages
      .filter((img) => img.status === 'uploaded')
      .sort((a, b) => a.sequence - b.sequence)
      .map((img) => img.destination)
      .filter(Boolean);

    if (successfulUrls.length) {
      try {
        product.imagens = successfulUrls;
        product.imagemPrincipal = successfulUrls[0];
        await product.save();
        emitLog(`Produto ${product.nome || product.cod || product._id}: imagens atualizadas com sucesso.`, 'success');
      } catch (error) {
        emitLog(`Erro ao salvar imagens do produto ${product.nome || product.cod || product._id}: ${error.message}`, 'error');
      }
    }

    productsResult.push({
      id: String(product._id || product.id || product.cod || product.cod_produto || Date.now()),
      name: String(product.nome || product.name || 'Produto sem nome'),
      code: String(product.cod || product.codigo || ''),
      barcode: String(product.codbarras || barcode),
      images: uploadedImages,
    });

    summary.products += 1;
    meta.processedProducts += 1;
  }

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
  uploadLocalProductImages,
};
