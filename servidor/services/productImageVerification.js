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

module.exports = {
  verifyAndLinkProductImages,
};
