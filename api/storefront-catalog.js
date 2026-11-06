// Public read-only catalogue adapter. Account credentials never reach this function.
const { catalogue } = require('./storefront-catalog-model.cjs');
const API = 'https://api.peteobicho.com.br/api';
const cache = new Map();
const TTL = 60000;
const fields = ['_id','nome','venda','precoClube','stock','marca','imagemPrincipal','categorias','especificacoes','inativo','naoMostrarNoSite','promocao','promocaoCondicional','peso'];
const sanitize = p => Object.fromEntries(fields.filter(k => p[k] !== undefined).map(k => [k,p[k]]));
async function json(path) {
  const response = await fetch(API + path, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw Error('Não foi possível consultar os produtos. Tente novamente.');
  return response.json();
}
async function cached(key, load) {
  const previous = cache.get(key);
  if (previous && previous.until > Date.now()) return previous.value;
  // Bound warm-instance memory even when customers search many different terms.
  if (cache.size >= 30) cache.delete(cache.keys().next().value);
  const value = Promise.resolve().then(load);
  const entry = { value, until: Date.now() + TTL };
  cache.set(key, entry);
  try { return await value; }
  catch (error) { if (cache.get(key) === entry) cache.delete(key); throw error; }
}
async function source(query) {
  const params = new URLSearchParams();
  for (const key of ['category','parent','grandparent','search']) if (query[key]) params.set(key, query[key]);
  if (!params.has('category') && !params.has('search')) params.set('category','Cachorro');
  return cached('products:' + params, async () => {
    if (params.has('search') && !params.has('category')) {
      const products = [];
      let page = 1, pages = 1;
      do {
        const data = await json('/products?' + new URLSearchParams({search:params.get('search'),limit:'60',page:String(page)}));
        if (!Array.isArray(data.products)) throw Error('Resposta de produtos inválida.');
        products.push(...data.products.map(sanitize));
        pages = Number(data.pages) || 1;
        if (pages > 200) throw Error('Refine sua busca para encontrar os produtos.');
        page++;
      } while (page <= pages);
      return products;
    }
    params.set('name', params.get('category'));
    params.delete('category');
    const data = await json('/products/by-category?' + params);
    if (!Array.isArray(data.products)) throw Error('Resposta da categoria inválida.');
    return data.products.map(sanitize);
  });
}
module.exports = async function storefrontCatalog(req,res) {
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('X-Content-Type-Options','nosniff');
  if (!['GET','HEAD'].includes(req.method)) {
    res.setHeader('Allow','GET, HEAD');
    res.statusCode = 405;
    return res.end(JSON.stringify({message:'Método não permitido.'}));
  }
  try {
    const params = new URL(req.url,'https://www.peteobicho.com.br').searchParams;
    const query = {};
    for (const key of new Set(params.keys())) {
      const values = params.getAll(key);
      if (key.length > 40 || values.length > 40 || values.some(v => v.length > 200)) {
        res.statusCode = 400;
        return res.end(JSON.stringify({message:'Confira os filtros da busca.'}));
      }
      query[key] = values.length === 1 ? values[0] : values;
    }
    for (const key of ['category','parent','grandparent','search']) if (Array.isArray(query[key])) throw Error('Confira a categoria da busca.');
    const [products, categories] = await Promise.all([
      source(query), cached('categories', () => json('/categories')),
    ]);
    if (!Array.isArray(categories)) throw Error('Resposta de categorias inválida.');
    const result = catalogue(products, categories, query);
    res.setHeader('Cache-Control','public, max-age=0, s-maxage=15, stale-while-revalidate=30');
    return res.end(req.method === 'HEAD' ? '' : JSON.stringify(result));
  } catch(error) {
    res.statusCode = error.status || 503;
    res.setHeader('Cache-Control','no-store');
    return res.end(JSON.stringify({message:error.message || 'Não foi possível carregar o catálogo.'}));
  }
};
