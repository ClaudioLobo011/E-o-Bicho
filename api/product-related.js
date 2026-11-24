// Read-only recommendations. Rank only inside the product's actual displayed category.
const {context,select}=require('./product-related-model.cjs');
const { resolveSiteCompany } = require('../scripts/core/site-company.cjs');
const cache = new Map();
async function cached(key,ttl,load){const old=cache.get(key);if(old&&old.until>Date.now())return old.value;if(cache.size>=40)cache.delete(cache.keys().next().value);const entry={until:Date.now()+ttl,value:Promise.resolve().then(load)};cache.set(key,entry);try{return await entry.value;}catch(e){if(cache.get(key)===entry)cache.delete(key);throw e;}}
module.exports=async function related(req,res){
  res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('X-Content-Type-Options','nosniff');
  if(!['GET','HEAD'].includes(req.method)){res.statusCode=405;res.setHeader('Allow','GET, HEAD');return res.end(JSON.stringify({message:'Método não permitido.'}));}
  const id=new URL(req.url,'http://localhost').searchParams.get('id')||'';
  if(!/^[a-f0-9]{24}$/i.test(id)){res.statusCode=400;return res.end(JSON.stringify({message:'Produto inválido.'}));}
  try{
    const company = req.siteCompany || resolveSiteCompany({ published: true });
    const api = company.apiUrl + '/api';
    const json = async (path, ttl) => cached(api + path, ttl, async () => {
      const response = await fetch(api + path, { signal: AbortSignal.timeout(12000) });
      if (!response.ok) {
        const error = Error('Produtos relacionados indisponíveis.');
        error.status = response.status === 404 ? 404 : 503;
        throw error;
      }
      return response.json();
    });
    const [product,categories]=await Promise.all([json('/products/'+id,30000),json('/categories',300000)]);
    if(product.inativo||product.naoMostrarNoSite){res.statusCode=404;return res.end(JSON.stringify({message:'Produto indisponível.'}));}
    if(!Array.isArray(categories))throw Error('Categorias indisponíveis.');
    const scope=context(product,categories);let result={products:[],variants:[],category:null};
    if(scope){
      const query=new URLSearchParams({name:scope.scope.nome});
      if(scope.path.length>1)query.set('parent',scope.path.at(-2).nome);
      if(scope.path.length>2)query.set('grandparent',scope.path.at(-3).nome);
      const data = await json('/products/by-category?'+query,60000);
      if (!Array.isArray(data.products)) throw Error('Produtos indisponíveis.');
      const fields = ['_id','nome','marca','venda','stock','precoClube','promocao','promocaoCondicional','imagemPrincipal','categorias','especificacoes','inativo','naoMostrarNoSite'];
      const candidates = data.products.map(p => Object.fromEntries(fields.filter(key => p[key] !== undefined).map(key => [key, p[key]])));
      result=select(product,candidates,categories);
    }
    res.setHeader('Cache-Control','public, max-age=0, s-maxage=30, stale-while-revalidate=30');return res.end(req.method==='HEAD'?'':JSON.stringify(result));
  }catch(error){res.statusCode=error.status||503;res.setHeader('Cache-Control','no-store');return res.end(JSON.stringify({message:'Não foi possível consultar produtos semelhantes.'}));}
};
