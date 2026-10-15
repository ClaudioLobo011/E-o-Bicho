const QUALITY_VERSION = '20261015-2';

function isStructuredLine(line) {
  const description = String(line.description || '');
  const hasDescription = (description.match(/[A-Za-zÀ-ÿ]/g) || []).length >= 4;
  const quantity = Number(line.expectedQuantity);
  const cost = Number(line.unitCost);
  return hasDescription && /^\d{3,14}$/.test(String(line.supplierCode || '')) &&
    line.expectedQuantity != null && Number.isFinite(quantity) && quantity > 0 &&
    line.unitCost != null && Number.isFinite(cost) && cost >= 0;
}

function withPageQuality(page) {
  const lines = Array.isArray(page.lines) ? page.lines : [];
  const confidence = typeof page.confidence === 'number' && Number.isFinite(page.confidence) ? page.confidence : null;
  const structuredLines = lines.filter(isStructuredLine).length;
  const reasons = [];
  if (!lines.length) reasons.push('Não foi possível reconhecer linhas de produtos.');
  if (confidence != null && confidence < 55) reasons.push('A leitura tem baixa confiança e pode misturar letras, números e colunas.');
  if (lines.length && structuredLines / lines.length < 0.45) reasons.push('A maioria das linhas não tem descrição, quantidade, código e valor reconhecidos em conjunto.');
  const unusable = reasons.length > 0;
  const reason = unusable ? `${reasons.join(' ')} Confira a foto e complete ou corrija o texto antes de usar a proposta.` : 'Proposta para revisão. Confira todas as linhas e páginas com o documento original.';
  return {
    ...page,
    quality: { version: QUALITY_VERSION, status: unusable ? 'unusable' : 'review_required', reason, confidence, candidateLines: lines.length, structuredLines },
    lines: lines.map(line => ({ ...line, requiresManualReview: Boolean(line.requiresManualReview || unusable || !isStructuredLine(line) || line.warnings?.some(warning => /não confere/.test(warning))) })),
    warnings: [...new Set([...(page.warnings || []), ...(unusable ? [reason] : [])])],
  };
}

function withExtractionQuality(extraction) {
  if (!extraction || !Array.isArray(extraction.pages)) return extraction;
  const pages = extraction.pages.map(withPageQuality);
  const linesById = new Map(pages.flatMap(page => page.lines).filter(line => line.id).map(line => [String(line.id), line]));
  const pagesById = new Map(pages.map(page => [String(page.photoId), page]));
  const unusable = pages.some(page => page.quality.status === 'unusable');
  return {
    ...extraction, pages,
    quality: { version: QUALITY_VERSION, status: unusable ? 'unusable' : 'review_required', reason: unusable ? 'Uma ou mais fotos não tiveram leitura suficiente. Revise e complete o documento antes de adicionar linhas.' : 'Confira a proposta com o documento original.' },
    lines: (extraction.lines || []).map(line => {
      const candidate = linesById.get(String(line.id));
      const page = pagesById.get(String(line.sourcePhotoId));
      return { ...line, requiresManualReview: Boolean(line.requiresManualReview || candidate?.requiresManualReview || page?.quality.status === 'unusable') };
    }),
    warnings: [...new Set([...(extraction.warnings || []), ...pages.flatMap(page => page.warnings)])],
  };
}

module.exports = { QUALITY_VERSION, isStructuredLine, withPageQuality, withExtractionQuality };
