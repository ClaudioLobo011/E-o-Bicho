const {test}=require('node:test'),assert=require('node:assert/strict');
const mongoose=require('mongoose'),express=require('express'),request=require('supertest');
const {MongoMemoryServer}=require('mongodb-memory-server');
const User=require('../../models/User'),Sale=require('../../models/PdvStateSale'),State=require('../../models/PdvState');
const {registerCustomerSalesHistory}=require('../desktopCustomerSalesHistory');
const oid=()=>new mongoose.Types.ObjectId();
test('Mongo transfer stays bounded with 2000 sales; repeated hosts share cache; empty delta sends no histories',async t=>{
 const mongo=await MongoMemoryServer.create();await mongoose.connect(mongo.getUri(),{monitorCommands:true});
 t.after(async()=>{await mongoose.disconnect();await mongo.stop();});await Promise.all([Sale.init(),User.init()]);
 const customers=Array.from({length:10},(_,i)=>({_id:oid(),email:`load-${i}@example.invalid`,role:'cliente',updatedAt:new Date('2025-01-01')}));
 await User.collection.insertMany(customers);const pdv=oid(),state=oid();
 const rows=customers.flatMap((c,j)=>Array.from({length:200},(_,i)=>({pdv,sourceState:state,saleId:`s-${j}-${i}`,updatedAt:new Date('2025-01-01'),createdAtFromEntity:new Date(Date.UTC(2025,0,i+1)),payload:{
   id:`s-${j}-${i}`,saleCode:`PDV-${j}-${i}`,customerId:String(c._id),createdAt:new Date(Date.UTC(2025,0,i+1)).toISOString(),status:'completed',netTotal:30,
   items:[{name:'Synthetic product',quantity:2,unitPrice:15,total:30,payload:{internalUnusedData:'x'.repeat(4096)}}],fiscalXmlContent:'PRIVATE-FISCAL-XML-NOT-FOR-HISTORY',
 }})));
 await Sale.collection.insertMany(rows);
 await State.collection.insertOne({_id:state,pdv,updatedAt:new Date('2025-01-01'),completedSales:rows.slice(0,100).map(x=>x.payload)});
 const app=express();registerCustomerSalesHistory(app,(req,res,next)=>next());app.use((e,req,res,next)=>res.status(500).json({message:e.message}));
 let measured=[];mongoose.connection.getClient().on('commandSucceeded',event=>{if(['find','aggregate','getMore'].includes(event.commandName))measured.push({command:event.commandName,bytes:mongoose.mongo.BSON.calculateObjectSize(event.reply),documents:event.reply.cursor?.firstBatch?.length??event.reply.cursor?.nextBatch?.length??0});});
 const measure=async action=>{measured=[];const result=await action();return {result,bytes:measured.reduce((sum,x)=>sum+x.bytes,0),commands:measured.length,documents:measured.reduce((sum,x)=>sum+x.documents,0)};};
 // Same normalized payload projection used before optimization (items included full payload).
 const baseline=await measure(()=>Sale.find({'payload.customerId':{$in:customers.map(x=>String(x._id))}}).select('payload.id payload.customerId payload.createdAt payload.status payload.netTotal payload.items').lean());
 const initial=await measure(()=>request(app).get('/customer-sales-history/snapshot').expect(200));
 assert.equal(initial.result.body.customers.length,10);assert.ok(initial.result.body.customers.every(c=>c.sales.length===10));
 assert.ok(initial.bytes<baseline.bytes*.05,`unexpected transfer ${initial.bytes}/${baseline.bytes}`);
 assert.ok(!JSON.stringify(initial.result.body).includes('internalUnusedData'));assert.ok(!JSON.stringify(initial.result.body).includes('PRIVATE-FISCAL'));
 const repeated=await measure(()=>Promise.all(Array.from({length:8},()=>request(app).get('/customer-sales-history/snapshot').expect(200))));assert.equal(repeated.commands,0);
 const empty=await measure(()=>request(app).get('/customer-sales-history/snapshot?since=2026-01-01T00:00:00Z').expect(200));assert.deepEqual(empty.result.body.customers,[]);assert.ok(empty.bytes<2048);
 const older=await measure(()=>request(app).get(`/customers/${customers[0]._id}/sales-history?offset=10`).expect(200));assert.equal(older.result.body.sales.length,10);assert.ok(older.bytes<15000);
 // Repeat with lean items too, so the improvement is not just oversized payload removal.
 await Sale.collection.updateMany({},{$unset:{'payload.items.0.payload.internalUnusedData':''}});
 const leanBaseline=await measure(()=>Sale.find({'payload.customerId':{$in:customers.map(x=>String(x._id))}}).select('payload.id payload.customerId payload.createdAt payload.status payload.netTotal payload.items').lean());
 const freshApp=express();registerCustomerSalesHistory(freshApp,(req,res,next)=>next());
 const leanInitial=await measure(()=>request(freshApp).get('/customer-sales-history/snapshot').expect(200));
 assert.ok(leanInitial.bytes<leanBaseline.bytes*.15);assert.deepEqual(leanInitial.result.body.customers,initial.result.body.customers);
 const newest=rows.find(r=>r.saleId==='s-0-199');await Sale.collection.updateOne({_id:newest._id},{$set:{'payload.status':'cancelled',updatedAt:new Date('2026-10-17')}});
 const changed=await measure(()=>request(app).get('/customer-sales-history/snapshot?since=2026-10-16T00:00:00Z').expect(200));
 assert.equal(changed.result.body.customers.length,1);assert.equal(changed.result.body.customers[0].sales.length,10);assert.ok(!changed.result.body.customers[0].sales.some(s=>s.id==='s-0-199'));
 console.log('CUSTOMER_HISTORY_TRANSFER_BENCHMARK',JSON.stringify({syntheticSales:rows.length,customers:customers.length,unit:'uncompressed BSON response bytes (not Atlas billed traffic; auth/transport overhead excluded)',before:baseline.bytes,initial:initial.bytes,reductionPercent:Number((100*(1-initial.bytes/baseline.bytes)).toFixed(2)),leanBefore:leanBaseline.bytes,leanAfter:leanInitial.bytes,leanReductionPercent:Number((100*(1-leanInitial.bytes/leanBaseline.bytes)).toFixed(2)),eightRepeatedHosts:repeated.bytes,unchangedDelta:empty.bytes,oneChangedCustomer:changed.bytes,olderPage:older.bytes}));
});
