const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
require('../../models/Store');
require('../../models/User');
require('../../models/Service');
const Appointment = require('../../models/Appointment');
const { readHistory, registerPetHistory } = require('../desktopPetHistory');

test('historico ordena servicos finalizados de todas as lojas, limita quatro por pet e pagina antigos', async t => {
  const mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  t.after(async () => { await mongoose.disconnect(); await mongo.stop(); });
  const id = () => new mongoose.Types.ObjectId();
  const pet = id(), otherPet = id(), customer = id(), storeA = id(), storeB = id(), service = id();
  await mongoose.model('Store').collection.insertMany([{ _id: storeA, nomeFantasia: 'Loja A' }, { _id: storeB, nomeFantasia: 'Loja B' }]);
  await mongoose.model('Service').collection.insertOne({ _id: service, nome: 'Banho', valor: 30 });
  const items = Array.from({ length: 7 }, (_, i) => ({ _id: id(), servico: service, valor: 30 + i, data: `2026-09-0${i + 1}`, hora: '10:00', status: i === 6 ? 'agendado' : 'finalizado' }));
  await Appointment.collection.insertMany([
    { _id: id(), store: storeA, pet, cliente: customer, scheduledAt: new Date('2026-01-01'), status: 'agendado', itens: items.slice(0, 3) },
    { _id: id(), store: storeB, pet, cliente: customer, scheduledAt: new Date('2026-01-01'), status: 'finalizado', itens: items.slice(3) },
    { _id: id(), store: storeB, pet, cliente: customer, scheduledAt: new Date('2026-10-01'), status: 'finalizado', itens: [items[0]], deletedAt: new Date() },
    { _id: id(), store: storeA, pet: otherPet, cliente: customer, scheduledAt: new Date('2026-08-01'), status: 'finalizado', servico: service, valor: 15 },
  ]);
  const recent = await readHistory([pet, otherPet], { perPet: true });
  assert.equal(recent.filter(row => row.petId === String(pet)).length, 4);
  assert.equal(recent.filter(row => row.petId === String(otherPet)).length, 1);
  const all = await readHistory([pet], { limit: 50 });
  assert.deepEqual(all.map(row => row.value), [35, 34, 33, 32, 31, 30]);
  assert.deepEqual([...new Set(all.map(row => row.storeName))].sort(), ['Loja A', 'Loja B']);
  assert.ok(all.every(row => row.name === 'Banho'));
  const page = await readHistory([pet], { offset: 3, limit: 2 });
  assert.deepEqual(page.map(row => row.value), [32, 31, 30]);
  await mongoose.model('Pet').collection.insertMany([{ _id: pet, owner: customer }, { _id: otherPet, owner: customer }]);
  const app = require('express')();
  registerPetHistory(app, (req, res, next) => req.get('X-Desktop-Token') === 'test' ? next() : res.sendStatus(401));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = path => fetch(base + path, { headers: { 'X-Desktop-Token': 'test' } });
  assert.equal((await fetch(base + '/pet-history/snapshot')).status, 401);
  const snapshot = await (await get('/pet-history/snapshot')).json();
  assert.equal(snapshot.pets.find(row => row.petId === String(pet)).services.length, 4);
  const online = await (await get(`/pet-history?petId=${pet}&customerId=${customer}`)).json();
  assert.equal(online.services.length, 6);
  assert.equal(online.allStores, true);
  assert.equal((await get(`/pet-history?petId=${pet}&customerId=${id()}`)).status, 404);
  assert.equal((await get(`/pet-history?petId=${pet}&customerId=${customer}&offset=Infinity`)).status, 400);
  await Appointment.collection.updateMany({ pet }, { $set: { deletedAt: new Date(), updatedAt: new Date() } });
  const incremental = await (await get('/pet-history/snapshot?since=2026-01-01')).json();
  assert.deepEqual(incremental.pets.find(row => row.petId === String(pet)).services, []);
  // Missing pets must not prematurely end a page of changed appointment pets.
  const missing = Array.from({ length: 51 }, () => id()).sort((a,b) => String(a).localeCompare(String(b)));
  await Appointment.collection.insertMany(missing.map(missingPet => ({ pet: missingPet, updatedAt: new Date() })));
  const missingPage = await (await get(`/pet-history/snapshot?since=2026-01-01&after=${pet}`)).json();
  assert.equal(missingPage.hasMore, true);
  assert.equal(missingPage.nextCursor, String(missing[49]));
});
