const Deposit = require('../models/Deposit');
const Product = require('../models/Product');
require('../models/Category');
const {
  normalizeSearchText,
  tokenizeSearchText,
} = require('../utils/productSearch');

const CACHE_TTL_MS = 60_000;
const MAX_MATCHES = 8;
const QUERY_STOP_WORDS = new Set([
  'acha', 'ai', 'algum', 'alguma', 'ainda', 'cliente', 'consegue', 'disponivel',
  'estoque', 'favor', 'gostaria', 'medicamento', 'preciso', 'produto', 'queria',
  'qual', 'quais', 'opcao', 'opcoes', 'remedio', 'saber', 'teria', 'tem', 'tenho',
  'tipo', 'tipos', 'trabalha', 'trabalham', 'vende', 'vendem', 'voce', 'voces',
]);
const QUERY_MODIFIER_TOKENS = new Set([
  'adulto', 'adultos', 'castrado', 'castrados', 'cao', 'caes', 'cachorro',
  'cachorros', 'cadela', 'cadelas', 'felino', 'felinos', 'filhote', 'filhotes',
  'gato', 'gatos', 'grande', 'grandes', 'gigante', 'gigantes', 'medio', 'medios',
  'mini', 'pequena', 'pequenas', 'pequeno', 'pequenos', 'porte', 'raca', 'racas',
  'senior', 'seniors',
]);

const catalogCache = new Map();

const TOKEN_EQUIVALENTS = new Map([
  ['adultos', 'adulto'], ['caes', 'cao'], ['cachorros', 'cachorro'],
  ['cadelas', 'cadela'], ['castrados', 'castrado'], ['felinos', 'felino'],
  ['filhotes', 'filhote'], ['gatos', 'gato'], ['gigantes', 'gigante'],
  ['grandes', 'grande'], ['medios', 'medio'], ['pequenas', 'pequena'],
  ['pequenos', 'pequeno'], ['racas', 'raca'], ['racoes', 'racao'],
  ['seniors', 'senior'],
]);

const canonicalToken = (value) => {
  const normalized = normalizeSearchText(value);
  return TOKEN_EQUIVALENTS.get(normalized) || normalized;
};

const clearProductLookupCache = () => catalogCache.clear();

const relevantQueryTokens = (value) => tokenizeSearchText(value)
  .filter((token) => !QUERY_STOP_WORDS.has(token));

const levenshteinDistance = (left, right) => {
  const a = String(left || '');
  const b = String(right || '');
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let row = 1; row <= a.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= b.length; column += 1) {
      const substitution = previous[column - 1] + (a[row - 1] === b[column - 1] ? 0 : 1);
      current[column] = Math.min(
        previous[column] + 1,
        current[column - 1] + 1,
        substitution,
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[b.length];
};

const tokenSimilarity = (left, right) => {
  const a = canonicalToken(left);
  const b = canonicalToken(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const distance = levenshteinDistance(a, b);
  const editSimilarity = 1 - (distance / Math.max(a.length, b.length));
  if (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a))) {
    return Math.max(
      editSimilarity,
      0.92 * (Math.min(a.length, b.length) / Math.max(a.length, b.length)),
    );
  }
  return editSimilarity;
};

const productTokens = (product = {}) => {
  const storedTokens = Array.isArray(product.searchTokens) ? product.searchTokens : [];
  const categoryNames = Array.isArray(product.categorias)
    ? product.categorias.map((category) => category?.nome || category?.name || '')
    : [];
  return tokenizeSearchText([
    ...storedTokens,
    product.nome,
    product.descricao,
    product.marca,
    product.referencia,
    product.tipoProduto,
    ...categoryNames,
    ...Object.values(product.especificacoes || {}).flat(),
  ].filter(Boolean).join(' '));
};

const productIdentityTokens = (product = {}) => {
  const categoryNames = Array.isArray(product.categorias)
    ? product.categorias.map((category) => category?.nome || category?.name || '')
    : [];
  return tokenizeSearchText([
    product.cod,
    product.codbarras,
    product.nome,
    product.descricao,
    product.marca,
    product.referencia,
    product.tipoProduto,
    ...categoryNames,
  ].filter(Boolean).join(' '));
};

const computeStoreStock = (product = {}, depositIds = new Set()) => (
  Array.isArray(product.estoques)
    ? product.estoques.reduce((total, entry) => {
      if (!depositIds.has(String(entry?.deposito || ''))) return total;
      const quantity = Number(entry?.quantidade);
      return total + (Number.isFinite(quantity) ? quantity : 0);
    }, 0)
    : 0
);

const loadStoreCatalog = async (storeId) => {
  const cacheKey = String(storeId || '');
  const cached = catalogCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.items;
  const [deposits, products] = await Promise.all([
    Deposit.find({ empresa: storeId }).select('_id').lean(),
    Product.find({ inativo: { $ne: true } })
      .select('cod codbarras nome descricao marca referencia venda unidade estoques tipoProduto especificacoes categorias +searchTokens')
      .populate({ path: 'categorias', select: 'nome' })
      .lean(),
  ]);
  const depositIds = new Set(deposits.map((entry) => String(entry._id)));
  const items = products.map((product) => ({
    ...product,
    tokens: productTokens(product),
    identityTokens: productIdentityTokens(product),
    storeStock: computeStoreStock(product, depositIds),
  }));
  catalogCache.set(cacheKey, { items, expiresAt: Date.now() + CACHE_TTL_MS });
  return items;
};

const matchThreshold = (left, right) => {
  const tokenLength = Math.max(String(left || '').length, String(right || '').length);
  return tokenLength >= 8 ? 0.72 : tokenLength >= 5 ? 0.8 : 0.9;
};

const bestTokenMatch = (queryToken, candidates = []) => candidates.reduce((best, candidate) => {
  const similarity = tokenSimilarity(queryToken, candidate);
  return similarity > best.similarity ? { similarity, productToken: candidate } : best;
}, { similarity: 0, productToken: '' });

const scoreProduct = (product, queryTokens) => {
  const matches = queryTokens.map((queryToken) => {
    const identity = bestTokenMatch(queryToken, product.identityTokens);
    const catalog = bestTokenMatch(queryToken, product.tokens);
    const best = identity.similarity >= catalog.similarity
      ? { ...identity, source: 'identity' }
      : { ...catalog, source: 'attribute' };
    const matched = best.similarity >= matchThreshold(queryToken, best.productToken);
    const modifier = QUERY_MODIFIER_TOKENS.has(canonicalToken(queryToken));
    const weight = modifier ? 0.45 : 1;
    return { ...best, queryToken, matched, modifier, weight };
  });
  const totalWeight = matches.reduce((total, match) => total + match.weight, 0) || 1;
  const matchedWeight = matches.reduce((total, match) => (
    total + (match.matched ? match.similarity * match.weight : 0)
  ), 0);
  const identityWeight = matches.reduce((total, match) => (
    total + (match.matched && match.source === 'identity' ? match.similarity * match.weight : 0)
  ), 0);
  const distinctiveMatches = matches.filter((match) => match.matched && !match.modifier);
  const bestDistinctive = distinctiveMatches.reduce(
    (best, match) => (match.similarity > best.similarity ? match : best),
    { similarity: 0, queryToken: '', productToken: '' },
  );
  return {
    score: (matchedWeight / totalWeight) * 0.8 + (identityWeight / totalWeight) * 0.2,
    matches,
    distinctiveMatches,
    bestDistinctive,
  };
};

const productMatchesQueryToken = (product, match) => {
  const candidates = match.source === 'identity' ? product.identityTokens : product.tokens;
  const candidate = bestTokenMatch(match.queryToken, candidates);
  return candidate.similarity >= matchThreshold(match.queryToken, candidate.productToken);
};

const resolveSearchText = (message, history = []) => {
  const currentTokens = relevantQueryTokens(message);
  const hasNamedTerm = currentTokens.some((token) => /[a-z]/.test(token) && token.length >= 4);
  if (hasNamedTerm) return message;
  const previous = [...history].reverse().find((entry) => (
    entry?.direction === 'incoming'
    && entry?.message !== message
    && relevantQueryTokens(entry?.message).some((token) => /[a-z]/.test(token) && token.length >= 4)
  ));
  return previous ? `${previous.message} ${message}` : message;
};

const readableVariantName = (name, anchor) => {
  const raw = String(name || '').trim();
  const normalized = normalizeSearchText(raw);
  const normalizedAnchor = normalizeSearchText(anchor);
  const start = normalizedAnchor ? normalized.indexOf(normalizedAnchor) : -1;
  let label = start >= 0 ? raw.slice(start) : raw;
  label = label
    .replace(/\bpara\s+c[aã]es?\s+e\s+gatos?\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  label = label.replace(
    /\s+(\d+(?:[.,]\d+)?\s*(?:comprimidos?|c[aá]psulas?|ml|kg|g|mg|unidades?))$/i,
    ' — $1',
  );
  return label;
};

const lookupProductsForMessage = async ({ storeId, message, history = [] }) => {
  const searchText = resolveSearchText(message, history);
  const queryTokens = relevantQueryTokens(searchText);
  if (!storeId || !queryTokens.length) return null;
  const catalog = await loadStoreCatalog(storeId);
  const ranked = catalog
    .map((product) => ({ product, match: scoreProduct(product, queryTokens) }))
    .filter((entry) => entry.match.distinctiveMatches.length > 0 && entry.match.score >= 0.3)
    .sort((left, right) => right.match.score - left.match.score);
  if (!ranked.length) return null;

  const best = ranked[0];
  const requiredMatches = best.match.matches.filter((match) => (
    match.matched && !/^\d+(?:[.,]\d+)?$/.test(match.queryToken)
  ));
  const anchorMatch = best.match.bestDistinctive;
  const anchor = anchorMatch.productToken;
  const familyProducts = catalog
    .filter((product) => requiredMatches.every((match) => productMatchesQueryToken(product, match)));
  const [freshProducts, deposits] = await Promise.all([
    Product.find({ _id: { $in: familyProducts.map((product) => product._id) } })
      .select('_id estoques')
      .lean(),
    Deposit.find({ empresa: storeId }).select('_id').lean(),
  ]);
  const freshById = new Map(freshProducts.map((product) => [String(product._id), product]));
  const depositIds = new Set(deposits.map((deposit) => String(deposit._id)));
  const family = familyProducts
    .map((product) => ({
      id: String(product._id),
      code: product.cod || '',
      barcode: product.codbarras || '',
      name: product.nome || '',
      label: readableVariantName(product.nome, anchor),
      stock: computeStoreStock(freshById.get(String(product._id)) || product, depositIds),
      price: Number.isFinite(Number(product.venda)) ? Number(product.venda) : null,
    }))
    .map((product) => ({ ...product, available: product.stock > 0 }))
    .sort((left, right) => Number(right.available) - Number(left.available) || left.label.localeCompare(right.label, 'pt-BR'))
    .slice(0, MAX_MATCHES);

  return {
    understoodAs: requiredMatches.map((match) => match.productToken).join(' '),
    confidence: best.match.score,
    correctedFrom: requiredMatches.map((match) => match.queryToken).join(' '),
    variants: family,
  };
};

const buildInventoryPromptContext = (lookup) => {
  if (!lookup?.variants?.length) return '';
  const rows = lookup.variants.map((variant) => (
    `- ${variant.label} | estoque nesta loja: ${variant.available ? `${variant.stock} unidade(s)` : 'SEM ESTOQUE'} | preÃ§o: ${variant.price === null ? 'nÃ£o cadastrado' : `R$ ${variant.price.toFixed(2)}`}`
  ));
  return [
    'CONSULTA DE ESTOQUE EM TEMPO REAL (fonte interna confiÃ¡vel):',
    `O nome informado foi entendido como: ${lookup.understoodAs}.`,
    ...rows,
    '',
    'Regras para responder sobre estes produtos:',
    '- Os resultados foram filtrados pela combinacao de identidade, tipo e caracteristicas pedidas. Nao acrescente produtos de outra marca, linha ou categoria.',
    '- Considere disponÃ­vel somente a variaÃ§Ã£o com estoque maior que zero.',
    '- Se houver mais de uma variaÃ§Ã£o, diga que trabalhamos com o produto, liste cada variaÃ§Ã£o disponÃ­vel em uma linha separada e pergunte qual delas o cliente precisa.',
    '- Use os nomes legÃ­veis acima. NÃ£o junte variaÃ§Ãµes na mesma linha.',
    '- Fale diretamente com a pessoa usando "vocÃª". Na pergunta final, use "Qual dessas versÃµes vocÃª precisa?".',
    '- NÃ£o revele a quantidade exata, a menos que o cliente pergunte quantas unidades existem.',
    '- Informe preÃ§o somente se o cliente pedir.',
    '- Se nenhuma variaÃ§Ã£o tiver estoque, informe com clareza que estÃ¡ indisponÃ­vel nesta loja.',
  ].join('\n');
};

module.exports = {
  buildInventoryPromptContext,
  clearProductLookupCache,
  computeStoreStock,
  levenshteinDistance,
  lookupProductsForMessage,
  readableVariantName,
  relevantQueryTokens,
  tokenSimilarity,
};
