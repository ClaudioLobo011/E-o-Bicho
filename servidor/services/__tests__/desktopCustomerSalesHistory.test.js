const {test,before,after,beforeEach}=require('node:test'),assert=require('node:assert/strict');
const mongoose=require('mongoose'),express=require('express'),request=require('supertest');
const {MongoMemoryServer}=require('mongodb-memory-server');
const User=require('../../models/User'),Sale=require('../../models/PdvStateSale'),State=require('../../models/PdvState');
const history=require('../desktopCustomerSalesHistory');
let mongo,app;const oid=()=>new mongoose.Types.ObjectId();
before(async()=>{mongo=await MongoMemoryServer.create();await mongoose.connect(mongo.getUri());await Sale.init();app=express();history.registerCustomerSalesHistory(app,(req,res,next)=>req.get('x-test-host')?next():res.sendStatus(401));app.use((e,req,res,next)=>{console.error(e.message);res.status(500).json({message:e.message});});});
after(async()=>{await mongoose.disconnect();await mongo.stop();});
beforeEach(async()=>{await Promise.all([User.deleteMany({}),Sale.deleteMany({}),State.deleteMany({})]);app=express();history.registerCustomerSalesHistory(app,(req,res,next)=>req.get('x-test-host')?next():res.sendStatus(401));app.use((e,req,res,next)=>{console.error(e.message);res.status(500).json({message:e.message});});});
const get=url=>request(app).get(url).set('x-test-host','test');
test('identity is authoritative; similar names never match; document only when no explicit ID',()=>{
 const customer={_id:oid(),cpf:'12345678901',nomeCompleto:'Maria Silva'};
 assert.equal(history.matches({customerName:'Maria Silva'},customer),false);
 assert.equal(history.matches({customerId:String(oid()),customerDocument:customer.cpf},customer),false);
 assert.equal(history.matches({customerDocument:'123.456.789-01'},customer),true);
 assert.equal(history.matches({customer:{_id:customer._id}},customer),true);
});
test('snapshot gives latest ten across stores, excludes cancellation and mirrored duplicates; full query remains compatible',async()=>{
 const customer={_id:oid(),role:'cliente',cpf:'12345678901'},state=oid(),pdv=oid();await User.collection.insertOne(customer);
 const rows=Array.from({length:15},(_,i)=>({id:'s'+i,customerId:String(customer._id),saleCode:'PDV-'+i,createdAt:new Date(Date.UTC(2026,9,i+1)).toISOString(),items:[{name:'Item',quantity:1,total:20}],netTotal:20,status:i===14?'cancelled':'completed'}));
 await State.collection.insertOne({_id:state,pdv,completedSales:rows,updatedAt:new Date()});
 await Sale.insertMany(rows.map((payload,i)=>({pdv:i%2?pdv:oid(),empresa:oid(),sourceState:state,saleId:payload.id,payload,createdAtFromEntity:new Date(payload.createdAt)})));
 const response=await get('/customer-sales-history/snapshot').expect(200);assert.equal(response.body.customers.length,1);assert.deepEqual(response.body.customers[0].sales.map(s=>s.id),rows.slice(4,14).reverse().map(s=>s.id));
 const all=await get(`/customers/${customer._id}/sales-history`).expect(200);assert.equal(all.body.sales.length,14);
 const first=await get(`/customers/${customer._id}/sales-history?offset=0`).expect(200);assert.equal(first.body.sales.length,10);assert.equal(first.body.hasMore,true);
 const last=await get(`/customers/${customer._id}/sales-history?offset=10`).expect(200);assert.equal(last.body.sales.length,4);assert.equal(last.body.hasMore,false);
});
test('legacy document and nested ObjectId, receipt items fallback, unrelated same name is excluded',async()=>{
 const customer={_id:oid(),role:'cliente',cpf:'12345678901',nomeCompleto:'Maria'},state=oid(),pdv=oid();await User.collection.insertOne(customer);
 await State.collection.insertOne({_id:state,pdv,updatedAt:new Date(),completedSales:[{_id:'legacy',customerDocument:'123.456.789-01',receiptSnapshot:{itens:[{descricao:'Antigo',quantidade:2,valorUnitario:5}],totais:{total:10}}},{id:'wrong',customerName:'Maria',items:[{name:'Wrong'}]}]});
 await Sale.create({pdv,sourceState:state,saleId:'nested',payload:{id:'nested',customerId:'',customer:{_id:customer._id},items:[],receiptSnapshot:{itens:[{nome:'Recibo',qtd:1,total:3}]}}});
 const response=await get(`/customers/${customer._id}/sales-history?offset=0`).expect(200);assert.equal(response.body.sales.length,2);assert.ok(response.body.sales.some(s=>s.items[0].name==='Recibo'));assert.ok(response.body.sales.some(s=>s.items[0].name==='Antigo'));
 assert.equal(response.body.sales.find(s=>s.id==='legacy').items[0].total,10);
 const delta=await get('/customer-sales-history/snapshot?since=2026-01-01T00:00:00Z').expect(200);assert.equal(delta.body.customers.length,1);
});
test('snapshot pagination includes empty customers, delta skips unchanged, validates cursor/auth',async()=>{
 const users=Array.from({length:27},(_,i)=>({_id:oid(),role:'cliente',email:`history-test-${i}@example.invalid`,updatedAt:new Date('2025-01-01')}));await User.collection.insertMany(users);
 const first=await get('/customer-sales-history/snapshot').expect(200);assert.equal(first.body.customers.length,25);assert.equal(first.body.hasMore,true);
 const second=await get('/customer-sales-history/snapshot?after='+first.body.nextCursor).expect(200);assert.equal(second.body.customers.length,2);assert.equal(second.body.hasMore,false);
 const delta=await get('/customer-sales-history/snapshot?since=2026-01-01T00:00:00Z').expect(200);assert.equal(delta.body.customers.length,0);
 await get('/customer-sales-history/snapshot?after=bad').expect(400);await get('/customer-sales-history/snapshot?since=bad').expect(400);
 await request(app).get('/customer-sales-history/snapshot').expect(401);await get(`/customers/${users[0]._id}/sales-history?offset=-1`).expect(400);
});
test('incremental refresh includes only changed mirrored customers and removes cancelled sale despite stale legacy copy',async()=>{
 const a={_id:oid(),role:'cliente',email:'a@example.invalid',updatedAt:new Date('2025-01-01')},b={_id:oid(),role:'cliente',email:'b@example.invalid',updatedAt:new Date('2025-01-01')};
 await User.collection.insertMany([a,b]);const pdv=oid(),state=oid();
 const rows=[a,b].map((c,i)=>({id:'delta'+i,customerId:String(c._id),createdAt:'2026-10-01',status:'completed',items:[{name:'Item',quantity:1,total:10}],netTotal:10}));
 await State.collection.insertOne({_id:state,pdv,updatedAt:new Date(),completedSales:rows});
 await Sale.collection.insertMany(rows.map((payload,i)=>({pdv,sourceState:state,saleId:payload.id,payload:i?payload:{...payload,status:'cancelled'},updatedAt:new Date(i?'2025-01-01':'2026-10-17')})));
 const delta=await get('/customer-sales-history/snapshot?since=2026-10-16T00:00:00Z').expect(200);
 assert.equal(delta.body.customers.length,1);assert.equal(delta.body.customers[0].customerId,String(a._id));assert.deepEqual(delta.body.customers[0].sales,[]);
});
