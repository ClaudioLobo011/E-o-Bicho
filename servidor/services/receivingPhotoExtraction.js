const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const sharp = require('sharp');
const { createWorker } = require('tesseract.js');
const localOcr = require('./receivingLocalOcr');
const EXTRACTION_VERSION = '20261015-local-v2';

const cachePath = path.resolve(process.env.RECEIVING_OCR_CACHE || path.join(__dirname, '../.receiving-ocr-cache'));
const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
const number = value => {
  const text = String(value || '').replace(/\s/g, '');
  if (!/^(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{1,4})?$/.test(text)) return null;
  const result = Number(text.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(result) ? result : null;
};

// OCR is evidence, never a product identity or approval. Unreadable fields stay null.
function parseDocumentText(text, photoId = '') {
  const lines = [];
  const warnings = ['Revise descrições, quantidades e valores com a foto antes de aplicar. O reconhecimento de texto pode errar.'];
  const rawLines = String(text || '').split(/\r?\n/).map(value => value.trim()).filter(Boolean);
  for (const raw of rawLines) {
    const match = raw.match(/^\s*(?:(\d{1,4})\s+)?(\d+(?:[.,]\d+)?)\s+(UN|UM|UND|CX|PC|PÇ|PCT|KT|KIT|KG|FD|SC|LT)\b\s*(.+)$/i);
    if (!match) continue;
    let description = match[4].trim();
    if (/^(TOTAL|VOLUME|PESO|CONTROLE|VALOR|VENCIMENTO)\b/i.test(description)) continue;
    const warningsLine = ['Identificação e embalagem ainda não confirmadas.'];
    let supplierCode = '', unitCost = null, lineTotal = null;
    const tail = description.match(/\s+(\d{3,14})\s+([\d.]+,\d{2,4})\s+([\d.]+,\d{2})(?:\s+[A-Z])?\s*$/i);
    if (tail) {
      supplierCode = tail[1]; unitCost = number(tail[2]); lineTotal = number(tail[3]);
      description = description.slice(0, tail.index).trim();
    } else {
      warningsLine.push('Código do fornecedor e/ou valores precisam ser conferidos.');
    }
    let expectedQuantity = number(match[2]);
    if (expectedQuantity == null || expectedQuantity <= 0 || expectedQuantity > 1000000) expectedQuantity = null;
    if (expectedQuantity && unitCost != null && lineTotal != null && Math.abs(expectedQuantity * unitCost - lineTotal) > 0.03) {
      warningsLine.push('Quantidade × valor unitário não confere com o total lido.');
    }
    if (description.length < 4) continue;
    lines.push({
      id: crypto.randomUUID(), description, supplierCode, expectedQuantity, receivedQuantity: 0,
      unit: match[3].toUpperCase().replace(/^UM$/, 'UN'), unitCost, lineTotal,
      productId: '', productName: '', barcode: '', stockFactor: 1, conversionConfirmed: false, reviewed: false,
      sourcePhotoId: String(photoId), sourceText: raw, sourcePage: '', warnings: warningsLine,
    });
  }
  const page = String(text || '').match(/P[ÁA]G\s*[:.\-º°]*\s*(\d{1,3})\b/i)?.[1] || '';
  const reference = String(text || '').match(/(?:OR[ÇC]AMENTO|ROMANEIO|PEDIDO)\s*[:.\-*]*\s*([\d][\d./-]{3,20})/i)?.[1] || '';
  for (const line of lines) line.sourcePage = page;
  if (!lines.length) warnings.push('Não foi possível separar linhas de produtos com segurança. Use o texto reconhecido ou importe uma lista revisada.');
  return { lines, warnings, page, reference, rawText: String(text || '').slice(0, 120000) };
}

function detectDuplicatePages(pages) {
  const included = [];
  return pages.map(page => {
    const signature = new Set(page.lines.map(line => normalize(`${line.supplierCode} ${line.description}`).split(' ').filter(token => token.length > 2).join(' ')));
    const tokens = new Set(page.lines.flatMap(line => normalize(line.description).split(' ').filter(token => token.length > 3)));
    const codes = new Set(page.lines.map(line => String(line.supplierCode || '')).filter(Boolean));
    const duplicate = included.find(previous => {
      const a = previous.signature, b = previous.tokens;
      const overlap = [...signature].filter(value => a.has(value)).length / Math.max(1, Math.min(a.size, signature.size));
      const tokenOverlap = [...tokens].filter(value => b.has(value)).length / Math.max(1, Math.min(b.size, tokens.size));
      const sharedCodes = [...codes].filter(code => previous.codes.has(code)).length;
      const similarRowCount = Math.min(page.lines.length, previous.page.lines.length) / Math.max(1, page.lines.length, previous.page.lines.length) >= 0.75;
      const compatibleReference = !page.reference || !previous.page.reference || page.reference === previous.page.reference;
      const noisyDuplicate = compatibleReference && similarRowCount && signature.size >= 20 && a.size >= 20 && sharedCodes >= 5 && tokenOverlap >= 0.55;
      return signature.size >= 3 && a.size >= 3 && (overlap >= 0.7 || noisyDuplicate || (page.page && previous.page.page === page.page && page.reference && previous.page.reference === page.reference && tokenOverlap >= 0.65));
    });
    if (duplicate) return { ...page, duplicateOf: duplicate.page.photoId, selected: false, warnings: [...page.warnings, 'Possível foto repetida da mesma página. Desmarcada da proposta; confira antes de incluir.'] };
    included.push({ page, signature, tokens, codes });
    return { ...page, selected: true, duplicateOf: null };
  });
}

function textScore(text) {
  return parseDocumentText(text).lines.length * 80 + (String(text).match(/\b(?:UN|CX|CLUB|TOTAL|SNACKS|CAMA|FRALDA|VALOR)\b/gi) || []).length * 4;
}

async function imageMetadata(buffer) {
  let metadata;
  try {
    metadata = await sharp(buffer, { limitInputPixels: 40000000 }).metadata();
  } catch (_error) {
    throw Object.assign(new Error('A foto está inválida, danificada ou excede o tamanho permitido. Envie uma foto JPG, PNG ou WebP válida.'), { status: 400 });
  }
  if (!['jpeg', 'png', 'webp'].includes(metadata.format)) throw Object.assign(new Error('Envie fotos JPG, PNG ou WebP.'), { status: 400 });
  return { width: metadata.width, height: metadata.height, contentType: `image/${metadata.format === 'jpeg' ? 'jpeg' : metadata.format}` };
}

async function extractTesseractPhoto(buffer, photoId) {
  await fs.mkdir(cachePath, { recursive: true });
  const metadata = await imageMetadata(buffer);
  let worker, timer, expired = false;
  try {
    const job = (async () => {
      const created = await createWorker('por', 1, { cachePath, errorHandler: () => {} });
      if (expired) { await created.terminate(); throw new Error('OCR initialization timed out'); }
      worker = created;
      await worker.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1', user_defined_dpi: '300' });
      const oriented = await sharp(buffer, { limitInputPixels: 40000000 }).autoOrient().png().toBuffer();
      let best = { text: '', confidence: 0, rotation: 0, score: -1 };
      // Try quarter turns for sideways photos, and stop once item rows are reliably located.
      const angles = metadata.width > metadata.height ? [270, 0, 90, 180] : [0, 270, 90, 180];
      for (const angle of angles) {
        const image = await sharp(oriented, { limitInputPixels: 40000000 }).rotate(angle)
          .resize({ width: 2000, height: 2600, fit: 'inside' }).grayscale().normalise().sharpen().png().toBuffer();
        const result = await worker.recognize(image, { rotateAuto: true }, { text: true });
        const score = textScore(result.data.text);
        if (score > best.score) best = { text: result.data.text, confidence: result.data.confidence, rotation: angle, score };
        if (parseDocumentText(best.text).lines.length >= 5) break;
      }
      const parsed = parseDocumentText(best.text, photoId);
      if (best.confidence < 65) parsed.warnings.unshift('Baixa confiança na leitura desta foto. Não use as quantidades e valores sem comparar com o documento original.');
      return { photoId: String(photoId), ...parsed, confidence: best.confidence, rotation: best.rotation, provider: 'tesseract-local', reviewed: false };
    })();
    return await Promise.race([job, new Promise((_, reject) => { timer = setTimeout(() => { expired = true; reject(Object.assign(new Error('A leitura demorou demais. Tente uma foto mais próxima, com a folha inteira e boa luz.'), { status: 422 })); }, 150000); })]);
  } finally { clearTimeout(timer); if (worker) await worker.terminate(); }
}

function extractorInfo() {
  return { provider: localOcr.available() ? 'rapidocr-local-v6' : 'tesseract-local', version: EXTRACTION_VERSION };
}

function isCurrentExtraction(page) {
  const info = extractorInfo();
  return page?.extractionVersion === info.version && page?.provider === info.provider;
}

async function extractPhoto(buffer, photoId) {
  await imageMetadata(buffer);
  if (!localOcr.available()) return { ...await extractTesseractPhoto(buffer, photoId), extractionVersion: EXTRACTION_VERSION };
  const recognized = await localOcr.recognizePhoto(buffer);
  const parsed = parseDocumentText(recognized.rawText, photoId);
  // Local OCR remains a transcription aid. High character confidence does not
  // establish product identity or verify quantities, supplier codes and costs.
  return { photoId: String(photoId), ...parsed,
    lines: parsed.lines.map(line => ({ ...line, requiresManualReview: true })),
    warnings: [...new Set([...parsed.warnings, ...(recognized.warnings || []), 'Leitura local: confira todas as descrições, códigos, quantidades e valores. Mesmo números com aparência correta podem ter sido lidos incorretamente.'])],
    confidence: recognized.confidence, rotation: recognized.rotation || 0,
    provider: 'rapidocr-local-v6', extractionVersion: EXTRACTION_VERSION, reviewed: false };
}

module.exports = { parseDocumentText, detectDuplicatePages, extractPhoto, imageMetadata, cachePath, extractorInfo, isCurrentExtraction, EXTRACTION_VERSION };
