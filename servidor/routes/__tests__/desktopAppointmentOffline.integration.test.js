const test=require('node:test'),assert=require('node:assert/strict');
const mongoose=require('mongoose'),{MongoMemoryReplSet}=require('mongodb-memory-server');
mongoose.set('transactionAsyncLocalStorage',true);
const {processAppointmentEvent}=require('../../services/desktopAppointmentTransaction');
const Event=require('../../models/PdvDesktopEvent'),Appointment=require('../../models/Appointment');
const Pdv=require('../../models/Pdv'),User=require('../../models/User'),Pet=require('../../models/Pet');
const router=require('../pdvDesktop');
const handler=router.stack.find(l=>l.route?.path==='/events/batch').route.stack.at(-1).handle;
let mongo;
test.before(async()=>{mongo=await MongoMemoryReplSet.create({replSet:{count:1}});await mongoose.connect(mongo.getUri());await Event.init();await Appointment.init();});
test.after(async()=>{await mongoose.disconnect();await mongo?.stop();});
const oid=()=>new mongoose.Types.ObjectId();
async function fixture(){
 const host={_id:oid(),pdv:oid(),empresa:oid()},id=oid(),customer=oid(),pet=oid(),service=oid();
 await Pdv.collection.insertOne({_id:host.pdv,codigo:String(host.pdv),tipoUso:'executavel',desktop:{status:'ativo'},empresa:host.empresa});
 await User.collection.insertOne({_id:customer,email:`${customer}@example.invalid`});await Pet.collection.insertOne({_id:pet,owner:customer});
 await Appointment.create({_id:id,store:host.empresa,cliente:customer,pet,servico:service,scheduledAt:new Date('2026-10-24T12:00:00Z'),valor:50,version:1,itens:[{servico:service,valor:50,data:'2026-10-24',hora:'09:00',status:'agendado'}]});
 const payload={appointmentId:String(id),sourceAppointmentId:String(id),customerId:String(customer),petId:String(pet),expectedVersion:1,sourceOccurrenceKey:'2026-10-24T12:00:00.000Z',scheduledAt:'2026-10-24T13:00:00.000Z',status:'em_espera',services:[{serviceId:String(service),unitPrice:50,date:'2026-10-24',time:'10:00',status:'em_espera'}]};
 return {host,id,payload,event:{eventId:String(oid()),type:'appointment.updated',occurredAt:new Date(),payload}};
}
async function send(f,events){let result;await handler({desktopHost:f.host,body:{events}},{json:x=>(result=x),status(){return this}});return result.results;}
test('interruption after appointment save rolls back domain and receipt; retry commits once',async()=>{
 const f=await fixture();
 const mutate=async(e,h,session)=>{await Appointment.updateOne({_id:f.id},{$set:{status:'finalizado'},$inc:{version:1}},{session});};
 await assert.rejects(processAppointmentEvent(f.event,f.host,async(...args)=>{await mutate(...args);throw Error('simulated process interruption');}),/interruption/);
 assert.equal((await Appointment.findById(f.id)).version,1);assert.equal(await Event.countDocuments({eventId:f.event.eventId}),0);
 await processAppointmentEvent(f.event,f.host,mutate);await processAppointmentEvent(f.event,f.host,async()=>{throw Error('must not reapply')});
 assert.equal((await Appointment.findById(f.id)).version,2);assert.equal((await Event.findOne({eventId:f.event.eventId})).status,'processed');
});
test('actual route: 60 offline moves/status edits, lost responses and repeated delivery preserve order',async()=>{
 const f=await fixture();let previous=f.payload.sourceOccurrenceKey;
 for(let i=0;i<60;i++){
  const at=new Date(Date.parse('2026-10-24T12:00:00Z')+(i+1)*60000).toISOString();
  const hhmm=new Date(Date.parse(at)-3*3600000).toISOString().slice(11,16);
  const status=['agendado','em_espera','em_atendimento','finalizado'][i%4];
  const event={...f.event,eventId:String(oid()),payload:{...f.payload,expectedVersion:i+1,sourceOccurrenceKey:previous,scheduledAt:at,status,services:[{...f.payload.services[0],time:hhmm,status}]}};
  const first=await send(f,[event]);assert.equal(first[0].status,'processed',JSON.stringify(first));
  // Simulate commit whose HTTP response is lost and is delivered again.
  if(i%3===0){const replay=await send(f,[event]);assert.equal(replay[0].status,'processed');assert.equal(replay[0].replayed,true);}
  assert.equal((await Appointment.findById(f.id)).version,i+2);previous=at;
 }
 const final=await Appointment.findById(f.id);assert.equal(final.version,61);assert.equal(final.status,'finalizado');assert.equal(final.itens[0].hora,'10:00');
 assert.equal(await Event.countDocuments({pdv:f.host.pdv,status:'processed'}),60);
});
test('actual concurrent terminals: same base version does not silently overwrite winner',async()=>{
 const f=await fixture();
 const other={...f.event,eventId:String(oid()),payload:{...f.payload,status:'finalizado',services:f.payload.services.map(s=>({...s,status:'finalizado'}))}};
 const replies=await Promise.all([send(f,[f.event]),send(f,[other])]);
 assert.equal(replies.flat().filter(r=>r.status==='processed').length,1);
 assert.equal(replies.flat().filter(r=>r.code==='APPOINTMENT_VERSION_CONFLICT').length,1);
 assert.equal((await Appointment.findById(f.id)).version,2);
});
test('same event concurrently and again after reconnect only increments once',async()=>{
 const f=await fixture();await Promise.all([send(f,[f.event]),send(f,[f.event])]);
 assert.equal((await send(f,[f.event]))[0].status,'processed');assert.equal((await Appointment.findById(f.id)).version,2);
 assert.equal(await Event.countDocuments({pdv:f.host.pdv,status:'processed'}),1);
});
test('actual SQLite offline queue reconnects through real API after rapid moves, without conflicts',async()=>{
 const path=require('node:path');
 const {StoreDatabase}=require(path.resolve(__dirname,'../../../../Executaveis/apps/store-service/src/database'));
 const {CloudClient}=require(path.resolve(__dirname,'../../../../Executaveis/apps/store-service/src/cloudClient'));
 const f=await fixture(),db=new StoreDatabase(':memory:'),client=new CloudClient(db);
 try{
  const id=String(f.id)+':occurrence:'+f.payload.sourceOccurrenceKey;
  db.replaceAppointments([{...f.payload,id,sourceOccurrenceKey:f.payload.sourceOccurrenceKey,scheduledAt:f.payload.sourceOccurrenceKey,version:1,status:'agendado',total:50}]);
  client.request=async()=>{throw Error('Internet unavailable')};
  for(let i=0;i<30;i++){
   const at=new Date(Date.parse(f.payload.sourceOccurrenceKey)+(i+1)*60000).toISOString(),time=new Date(Date.parse(at)-3*3600000).toISOString().slice(11,16);
   db.updateAppointment({id,eventId:'offline-'+f.id+'-'+i,scheduledAt:at,status:'em_atendimento',services:[{...f.payload.services[0],time,status:'em_atendimento'}]});
   if(i===0)await assert.rejects(client.push(),/Internet/);
  }
  db.db.prepare('UPDATE outbox SET next_retry_at=NULL').run();
  client.request=async(url,options)=>({results:await send(f,JSON.parse(options.body).events)});
  for(let i=0;i<30;i++){const result=await client.push();assert.equal(result.sent,1,JSON.stringify(result));assert.equal(result.failed,0);}
  assert.equal(db.status().pendingEvents,0);assert.equal(db.status().conflictEvents,0);assert.equal((await Appointment.findById(f.id)).version,31);
 }finally{db.close();}
});
test('approved recovery is scoped to host/store/PDV and invalidated by a newer cloud edit',async()=>{
 const f=await fixture(),a=await Appointment.findById(f.id).lean();
 const recover=router.stack.find(l=>l.route?.path==='/appointments/recovery-plans').route.stack.at(-1).handle;
 await mongoose.connection.db.collection('pdvdesktoprecoveryplans').insertOne({_id:String(oid()),source:f.id,host:f.host._id,pdv:f.host.pdv,empresa:f.host.empresa,approved:true,version:1,cloudUpdatedAt:a.updatedAt.toISOString(),eventIds:[f.event.eventId],eventsHash:'test',cacheHash:'test'});
 async function query(host){let value;await recover({desktopHost:host,body:{eventIds:[f.event.eventId]}},{json:x=>{value=x}});return value.plans;}
 assert.equal((await query({...f.host,_id:oid()})).length,0);
 assert.equal((await query({...f.host,empresa:oid()})).length,0);
 assert.equal((await query({...f.host,pdv:oid()})).length,0);
 assert.equal((await query(f.host)).length,1);
 await Appointment.updateOne({_id:f.id},{$inc:{version:1}});
 assert.equal((await query(f.host)).length,0);
});
