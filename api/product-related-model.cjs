const U = require('../scripts/product/product-utils');
const idOf = value => String(value?._id || value || '');
const values = value => (Array.isArray(value) ? value : value == null ? [] : [value]).map(U.normalize).filter(Boolean);
const publicFields = ['_id','nome','marca','venda','stock','precoClube','promocao','promocaoCondicional','imagemPrincipal'];
function context(product, categories) {
  const nodes = new Map(categories.map(c => [idOf(c), c]));
  function chain(id) {
    const path = [], seen = new Set();
    while (nodes.has(id) && !seen.has(id)) { seen.add(id); const node = nodes.get(id); path.unshift(node); id = idOf(node.parent); }
    return path;
  }
  const assigned = new Set((product.categorias || []).map(idOf));
  const displayed = (product.breadcrumbPath || []).map(c => U.normalize(c.nome));
  const paths = [...assigned].map(chain).filter(p => p.length > 1);
  // Match the complete displayed branch, never the last item of an unordered category array.
  const matches = [...nodes.keys()].map(chain).filter(p => p.length > 1 && p.length === displayed.length && p.every((c,i) => U.normalize(c.nome) === displayed[i]));
  const leaves = paths.filter(p=>!paths.some(other=>other.length>p.length&&other.some(c=>idOf(c)===idOf(p.at(-1)))));
  let path = matches.find(p => [...assigned].some(id => chain(id).some(c => idOf(c) === idOf(p.at(-1))))) ||
    (!displayed.length && leaves.length===1 ? leaves[0] : null);
  if (!path) return null;
  const food = path.findIndex(c => /^racao (seca|umida|natural|prescrita)$/.test(U.normalize(c.nome)));
  if(food>=0)path=path.slice(0,food+1);
  const scope = path.at(-1), scopeId = idOf(scope);
  const belongs = p => (p.categorias || []).some(c => chain(idOf(c)).some(n => idOf(n) === scopeId));
  const params = new URLSearchParams({category:scope.nome});
  if(path.length>1)params.set('parent',path.at(-2).nome);
  if(path.length>2)params.set('grandparent',path.at(-3).nome);
  return {scope,path,chain,assigned,belongs,category:{nome:scope.nome,href:'/pages/menu-departments-item/search.html?'+params}};
}
function select(product, candidates, categories, limit=4) {
  const c = context(product,categories);
  if (!c) return {products:[],variants:[],category:null};
  const ancestors = new Set(c.path.map(idOf));
  const extra = new Set([...c.assigned].filter(id => !ancestors.has(id)));
  const score = p => {
    let result=0;
    for(const id of new Set((p.categorias || []).map(idOf)))if(extra.has(id))result+=100*c.chain(id).length;
    for(const [field,weight] of [['idade',30],['porteRaca',25],['castracao',15],['indicacao',15]]){
      const a=values(product.especificacoes?.[field]),b=values(p.especificacoes?.[field]);
      if(a.length&&b.length)result+=a.some(v=>b.includes(v))?weight:-Math.floor(weight/3);
    }
    if(U.normalize(product.marca)&&U.normalize(p.marca)===U.normalize(product.marca))result+=2;
    return result;
  };
  const seen=new Set([idOf(product)]);
  const eligible=candidates.filter(p=>{
    const id=idOf(p);
    if(!id || seen.has(id) || p.inativo || p.naoMostrarNoSite || !Number.isFinite(Number(p.venda)) || Number(p.venda)<=0 || !(Number(p.stock)>0) || !c.belongs(p))return false;
    seen.add(id);return true;
  });
  eligible.sort((a,b)=>score(b)-score(a)||U.normalize(a.nome).localeCompare(U.normalize(b.nome),'pt-BR')||idOf(a).localeCompare(idOf(b)));
  return {category:c.category,variants:[],products:eligible.slice(0,Math.max(0,Math.min(4,limit))).map(p=>Object.fromEntries(publicFields.filter(k=>p[k]!==undefined).map(k=>[k,p[k]])))};
}
module.exports={context,select};
