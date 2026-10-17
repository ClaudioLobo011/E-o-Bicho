const mongoose = require('mongoose');
const User = require('../models/User');
const Sale = require('../models/PdvStateSale');
const State = require('../models/PdvState');
const {createResponseCache}=require('./customerHistoryResponseCache');
const idPaths = ['customerId', 'customer.id', 'customer._id', 'snapshotCustomer.id', 'snapshotCustomer._id'];
const documentPaths = ['customerDocument', 'customer.document', 'snapshotCustomer.documento'];
const at = (obj, key) => key.split('.').reduce((v, k) => v?.[k], obj);
const digits = value => String(value || '').replace(/\D/g, '');
function documentVariants(value) {
  const d=digits(value), variants=[value,d];
  if(d.length===11)variants.push(d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/,'$1.$2.$3-$4'));
  if(d.length===14)variants.push(d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,'$1.$2.$3/$4-$5'));
  return variants.filter(Boolean);
}
const saleCustomerId = sale => String(idPaths.map(k => at(sale, k)).find(Boolean) || '');
function matches(sale, customer) {
  const id = saleCustomerId(sale);
  // An explicit different ID must never fall back to a similar name/document.
  if (id) return id === String(customer._id);
  const doc = digits(customer.cpf || customer.cnpj);
  return Boolean(doc && documentPaths.some(k => digits(at(sale, k)) === doc));
}
function compact(sale) {
  return {
    id: String(sale.id || sale._id || ''), pdvId: String(sale.pdvId || ''),
    saleCode: String(sale.saleCode || sale.saleCodeLabel || sale.receiptSnapshot?.meta?.saleCode || ''),
    createdAt: sale.createdAt || sale.date || sale.updatedAt || null,
    status: sale.status || 'completed', cancellationAt: sale.cancellationAt || sale.cancelledAt || null,
    netTotal: Number(sale.netTotal ?? sale.totalLiquido ?? sale.total ?? sale.receiptSnapshot?.totais?.total ?? 0),
    items: (sale.items?.length ? sale.items : sale.receiptSnapshot?.itens || []).map(item => {
      const quantity = Number(item.quantity ?? item.quantidade ?? item.qtd ?? 0);
      const unitPrice = Number(item.unitPrice ?? item.valorUnitario ?? item.preco ?? 0);
      return { name: item.payload?.name || item.payload?.nome || item.name || item.nome || item.descricao || item.description || item.productName || item.productId || '-', quantity, unitPrice,
        total: Number(item.total ?? item.totalValue ?? item.valorTotal ?? quantity * unitPrice) };
    }),
  };
}
function dedupe(sales) {
  const seenIds = new Set(), seenCodes = new Set(), result = [];
  for (const raw of sales) {
    const row = compact(raw), code = row.saleCode.trim().toUpperCase();
    if ((row.id && seenIds.has(row.id)) || (code && seenCodes.has(code))) continue;
    if (row.id) seenIds.add(row.id); if (code) seenCodes.add(code);
    if (!row.id && !code) continue;
    if (row.cancellationAt || ['cancelled','canceled','cancelado','cancelada','voided'].includes(String(row.status).toLowerCase())) continue;
    result.push(row);
  }
  return result.sort((a,b) => (Date.parse(b.createdAt)||0)-(Date.parse(a.createdAt)||0) || b.id.localeCompare(a.id));
}
const itemFields=['payload.name','payload.nome','name','nome','descricao','description','productName','productId','quantity','quantidade','qtd','unitPrice','valorUnitario','preco','total','totalValue','valorTotal'];
const selectedFields = [...idPaths, ...documentPaths, 'id','_id','pdvId','saleCode','saleCodeLabel','createdAt','date','updatedAt','status','cancellationAt','cancelledAt','netTotal','totalLiquido','total',...itemFields.flatMap(k=>['items.'+k,'receiptSnapshot.itens.'+k]),'receiptSnapshot.meta.saleCode','receiptSnapshot.totais.total'];
function unmirroredStages(field) {
  return [
    {$lookup:{from:Sale.collection.name,let:{pdv:'$pdv',saleId:{$ifNull:[`$${field}.id`,`$${field}._id`]}},pipeline:[{$match:{$expr:{$and:[{$eq:['$pdv','$$pdv']},{$eq:['$saleId','$$saleId']}]}}},{$limit:1},{$project:{_id:1}}],as:'__mirror'}},
    {$match:{'__mirror.0':{$exists:false}}},
  ];
}
async function readCustomers(customers, {offset=0, limit=null}={}) {
  if (!customers.length) return new Map();
  const ids = customers.flatMap(c => [String(c._id), c._id]);
  const documents = [...new Set(customers.flatMap(c => [...documentVariants(c.cpf),...documentVariants(c.cnpj)]))];
  const alternatives = [...idPaths.map(k => ({ ['payload.'+k]: { $in: ids } })), ...documentPaths.map(k => ({ ['payload.'+k]: { $in: documents } }))];
  const legacyConditions = [...idPaths.map(k => ({ $in: ['$$s.'+k, ids] })), ...documentPaths.map(k => ({ $in: ['$$s.'+k, documents] }))];
  // Identity, deduplication, cancellation and pagination all run INSIDE MongoDB.
  // In particular, old purchases and large item payloads never cross Atlas -> API.
  const legacy = [
      { $project: { pdv:1, sales: { $filter: { input: { $ifNull: ['$completedSales', []] }, as: 's', cond: { $or: legacyConditions } } } } },
      { $unwind: '$sales' },
      ...unmirroredStages('sales'),
      {$project:{payload:'$sales',priority:{$literal:1},updatedAt:1}},
  ];
  const customerId=asString(coalesce(idPaths.map(k=>'$payload.'+k)));
  const branches=customers.map(c=>({case:{$cond:[{$ne:[customerId,'']},{$eq:[customerId,String(c._id)]},{$and:[{$ne:[digits(c.cpf||c.cnpj),'']},{$or:documentPaths.map(k=>({$eq:[cleanDocument('$payload.'+k),digits(c.cpf||c.cnpj)]}))}]}]},then:String(c._id)}));
  const facets=Object.fromEntries(customers.map(c=>[String(c._id),[
    {$match:{customer:String(c._id)}},{$sort:{date:-1,id:-1}},
    ...(offset?[{$skip:offset}]:[]),...(limit===null?[]:[{$limit:limit}]),
    {$project:{_id:0,...compactProjection()}},
  ]]));
  const [result]=await Sale.aggregate([
    {$match:{$or:alternatives}},{$project:{payload:1,updatedAt:1,priority:{$literal:0}}},
    {$unionWith:{coll:State.collection.name,pipeline:legacy}},
    {$project:{priority:1,updatedAt:1,...Object.fromEntries(selectedFields.map(k=>['payload.'+k,1]))}},
    {$set:{customer:{$switch:{branches,default:''}},id:asString(coalesce(['$payload.id','$payload._id'])),code:{$toUpper:{$trim:{input:asString(coalesce(['$payload.saleCode','$payload.saleCodeLabel','$payload.receiptSnapshot.meta.saleCode']))}}}}},
    {$match:{customer:{$ne:''},$or:[{id:{$ne:''}},{code:{$ne:''}}]}},
    {$sort:{priority:1,updatedAt:-1,_id:-1}},
    {$group:{_id:{customer:'$customer',id:{$cond:[{$ne:['$id','']},{$concat:['id:','$id']},{$concat:['code:','$code']}]}},row:{$first:'$$ROOT'}}},{$replaceRoot:{newRoot:'$row'}},
    {$sort:{priority:1,updatedAt:-1,_id:-1}},
    {$group:{_id:{customer:'$customer',code:{$cond:[{$ne:['$code','']},{$concat:['code:','$code']},{$concat:['id:','$id']}]}},row:{$first:'$$ROOT'}}},{$replaceRoot:{newRoot:'$row'}},
    {$match:{$expr:{$and:[{$eq:[coalesce(['$payload.cancellationAt','$payload.cancelledAt']),'']},{$not:[{$in:[{$toLower:asString('$payload.status')},['cancelled','canceled','cancelado','cancelada','voided']]}]}]}}},
    {$set:{date:{$convert:{input:coalesce(['$payload.createdAt','$payload.date','$payload.updatedAt']),to:'date',onError:new Date(0),onNull:new Date(0)}}}},
    {$facet:facets},
  ]).option({maxTimeMS:20000,allowDiskUse:true});
  return new Map(customers.map(c=>[String(c._id),(result?.[String(c._id)]||[]).map(compact)]));
}
const coalesce = paths => paths.reduceRight((fallback, p) => ({ $let:{vars:{value:{$ifNull:[p,'']}},in:{$cond:[{$eq:['$$value','']},fallback,'$$value']}} }), '');
const asString = value => ({$convert:{input:value,to:'string',onError:'',onNull:''}});
const cleanDocument = value => ['.','-','/',' '].reduce((input,find)=>({$replaceAll:{input,find,replacement:''}}),asString(value));
function compactProjection() {
  const value = paths => paths.reduceRight((fallback,p)=>({$ifNull:[p,fallback]}),0);
  return {
    id:'$id',pdvId:asString('$payload.pdvId'),saleCode:'$code',createdAt:coalesce(['$payload.createdAt','$payload.date','$payload.updatedAt']),
    status:'$payload.status',netTotal:value(['$payload.netTotal','$payload.totalLiquido','$payload.total','$payload.receiptSnapshot.totais.total']),
    items:{$map:{input:{$cond:[{$gt:[{$size:{$ifNull:['$payload.items',[]]}},0]},'$payload.items',{$ifNull:['$payload.receiptSnapshot.itens',[]]}]},as:'i',in:{
      name:coalesce(['$$i.payload.name','$$i.payload.nome','$$i.name','$$i.nome','$$i.descricao','$$i.description','$$i.productName','$$i.productId']),
      quantity:value(['$$i.quantity','$$i.quantidade','$$i.qtd']),unitPrice:value(['$$i.unitPrice','$$i.valorUnitario','$$i.preco']),
      total:{$ifNull:['$$i.total',{$ifNull:['$$i.totalValue',{$ifNull:['$$i.valorTotal',null]}]}]},
    }}},
  };
}
async function changedCustomers(since, after) {
  const select = prefix => ({ customerId: coalesce(idPaths.map(k=>prefix+k)), document: coalesce(documentPaths.map(k=>prefix+k)) });
  return Sale.aggregate([
    {$match:{updatedAt:{$gte:since}}},{$project:select('$payload.')},
    {$unionWith:{coll:State.collection.name,pipeline:[{$match:{updatedAt:{$gte:since}}},{$project:{pdv:1,completedSales:1}},{$unwind:'$completedSales'},...unmirroredStages('completedSales'),{$project:select('$completedSales.')}] }},
    {$group:{_id:{id:asString('$customerId'),doc:cleanDocument('$document')}}},
    {$lookup:{from:User.collection.name,let:{id:'$_id.id',doc:'$_id.doc'},pipeline:[{$match:{$expr:{$cond:[{$ne:['$$id','']},{$eq:[asString('$_id'),'$$id']},{$and:[{$ne:['$$doc','']},{$or:[{$eq:[cleanDocument('$cpf'),'$$doc']},{$eq:[cleanDocument('$cnpj'),'$$doc']}]}]}]}}},{$project:{_id:1,cpf:1,cnpj:1,role:1,codigoCliente:1}}],as:'customer'}},
    {$unwind:'$customer'},{$replaceRoot:{newRoot:'$customer'}},
    {$unionWith:{coll:User.collection.name,pipeline:[{$match:{updatedAt:{$gte:since}}},{$project:{_id:1,cpf:1,cnpj:1,role:1,codigoCliente:1}}]}},
    {$match:{$or:[{role:'cliente'},{codigoCliente:{$exists:true,$ne:null}}],...(after?{_id:{$gt:new mongoose.Types.ObjectId(after)}}:{})}},
    {$group:{_id:'$_id',cpf:{$first:'$cpf'},cnpj:{$first:'$cnpj'}}},{$sort:{_id:1}},{$limit:26},
  ]).option({maxTimeMS:20000,allowDiskUse:true});
}
function registerCustomerSalesHistory(router, authenticateHost) {
  const cache=createResponseCache();
  router.get('/customer-sales-history/snapshot', authenticateHost, async(req,res,next)=>{
    try {
      const after=String(req.query.after||''), since=req.query.since?new Date(req.query.since):null;
      if ((after&&!mongoose.isValidObjectId(after)) || (since&&!Number.isFinite(since.getTime()))) return res.status(400).json({message:'Cursor de histórico inválido.'});
      // Round DOWN only: overlapping a minute is safe; never skip a change.
      const floorSince=since?new Date(Math.floor(since.getTime()/60000)*60000):null;
      const result=await cache.get(`snapshot:${after}:${floorSince?.toISOString()||''}`,async()=>{
        const generatedAt=new Date(Date.now()-5000).toISOString();
        const filters=[{$or:[{role:'cliente'},{codigoCliente:{$exists:true,$ne:null}}]}];
        if(after)filters.push({_id:{$gt:new mongoose.Types.ObjectId(after)}});
        const rows=floorSince?await changedCustomers(floorSince,after):await User.find({$and:filters}).select('_id cpf cnpj').sort({_id:1}).limit(26).lean();
        const page=rows.slice(0,25),histories=await readCustomers(page,{limit:10});
        return {customers:page.map(c=>({customerId:String(c._id),sales:histories.get(String(c._id))})),hasMore:rows.length>25,nextCursor:page.length?String(page.at(-1)._id):'',generatedAt};
      });
      res.set('Cache-Control','no-store');
      return res.json(result);
    }catch(e){next(e);}
  });
  router.get('/customers/:customerId/sales-history',authenticateHost,async(req,res,next)=>{
    try {
      const id=String(req.params.customerId), offset=Number(req.query.offset||0);
      if(!mongoose.isValidObjectId(id)||!Number.isSafeInteger(offset)||offset<0)return res.status(400).json({message:'Cliente ou página inválidos.'});
      // No query parameter preserves compatibility with older desktops.
      const paged=req.query.offset!==undefined;
      const result=await cache.get(`customer:${id}:${paged?offset:'legacy'}`,async()=>{
        const generatedAt=new Date().toISOString();
        const customer=await User.findOne({_id:id,$or:[{role:'cliente'},{codigoCliente:{$exists:true,$ne:null}}]}).select('_id cpf cnpj').lean();
        if(!customer)return null;
        const sales=(await readCustomers([customer],{offset:paged?offset:0,limit:paged?11:null})).get(id);
        return {sales:paged?sales.slice(0,10):sales,...(!paged?{total:sales.length}:{}),hasMore:paged&&sales.length>10,nextOffset:offset+10,allPdvs:true,allPeriods:!paged,generatedAt};
      });
      if(!result)return res.status(404).json({message:'Cliente não encontrado.'});
      res.set('Cache-Control','no-store');return res.json(result);
    }catch(e){next(e);}
  });
}
module.exports={registerCustomerSalesHistory,matches,compact,dedupe,readCustomers};
