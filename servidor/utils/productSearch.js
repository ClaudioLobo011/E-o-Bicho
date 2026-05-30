const PRODUCT_SEARCH_STOP_WORDS = new Set([
  'a',
  'as',
  'ao',
  'aos',
  'com',
  'da',
  'das',
  'de',
  'do',
  'dos',
  'e',
  'em',
  'o',
  'os',
  'para',
  'por',
  'sem',
  'um',
  'uma',
]);

function normalizeSearchText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function tokenizeSearchText(value) {
  const normalized = normalizeSearchText(value).replace(/\*/g, ' ');
  if (!normalized) return [];
  const seen = new Set();
  const tokens = [];

  normalized.split(/\s+/).forEach((token) => {
    const clean = token.trim();
    if (!clean) return;
    if (PRODUCT_SEARCH_STOP_WORDS.has(clean)) return;
    if (clean.length < 2 && !/^\d$/.test(clean)) return;
    if (seen.has(clean)) return;
    seen.add(clean);
    tokens.push(clean);
  });

  return tokens;
}

function addValue(values, value) {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    value.forEach((item) => addValue(values, item));
    return;
  }
  if (typeof value === 'object') {
    Object.values(value).forEach((item) => addValue(values, item));
    return;
  }
  const text = String(value).trim();
  if (text) values.push(text);
}

function buildTokenPrefixes(tokens) {
  const prefixes = new Set();
  tokens.forEach((token) => {
    if (!token || token.length < 2) return;
    const maxLength = Math.min(token.length, 24);
    for (let length = 2; length <= maxLength; length += 1) {
      prefixes.add(token.slice(0, length));
    }
  });
  return Array.from(prefixes);
}

function buildProductSearchData(product = {}) {
  const values = [];
  addValue(values, product.cod);
  addValue(values, product.codbarras);
  addValue(values, product.codigosComplementares);
  addValue(values, product.nome);
  addValue(values, product.descricao);
  addValue(values, product.marca);
  addValue(values, product.referencia);
  addValue(values, product.unidade);
  addValue(values, product.tipoProduto);
  addValue(values, product.ncm);
  addValue(values, product.especificacoes);
  addValue(values, product.fornecedores);

  const normalizedText = normalizeSearchText(values.join(' '));
  const tokens = tokenizeSearchText(normalizedText);

  return {
    text: normalizedText,
    tokens,
    prefixes: buildTokenPrefixes(tokens),
  };
}

function buildProductQueryTokens(rawQuery) {
  return tokenizeSearchText(rawQuery);
}

module.exports = {
  buildProductQueryTokens,
  buildProductSearchData,
  normalizeSearchText,
  tokenizeSearchText,
};
