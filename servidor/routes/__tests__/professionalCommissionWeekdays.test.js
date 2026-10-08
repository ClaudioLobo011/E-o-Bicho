const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
process.env.JWT_SECRET = 'weekday-commission-test-only';
const User = require('../../models/User');
require('../../models/UserGroup');
const Group = require('../../models/ServiceGroup');
const Service = require('../../models/Service');
const Config = require('../../models/ProfessionalCommissionConfig');
const engine = require('../../../scripts/common/professional-commission-engine');
const app = express(); app.use(express.json()); app.use('/config', require('../adminProfessionalCommissions'));
let mongo, user, group, service, auth;
before(async () => { mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri()); });
after(async () => { await mongoose.disconnect(); await mongo.stop(); });
beforeEach(async () => {
  await mongoose.connection.db.dropDatabase();
  await Config.init();
  user = await User.create({ nomeCompleto: 'Teste', email: 'test@example.invalid', senha: 'hash', celular: '21900000000', tipoConta: 'pessoa_fisica', role: 'admin_master', grupos: ['esteticista'] });
  group = await Group.create({ nome: 'Grupo', tiposPermitidos: ['esteticista'], comissaoPercent: 30 });
  service = await Service.create({ nome: 'Serviço', grupo: group._id, duracaoMinutos: 30, valor: 100, porte: ['Todos'] });
  auth = { Authorization: `Bearer ${jwt.sign({ id: String(user._id) }, process.env.JWT_SECRET)}` };
});
const body = () => ({ expectedRevision: 0, professionalType: 'esteticista', effectiveFrom: '2099-01-01', groupRules: [{ group: String(group._id), percent: 30 }], serviceRules: [], weekdayRules: [{ id: 'weekend', weekdays: [0,6], defaultPercent: 50, enabled: true, groupRules: [{ group: String(group._id), percent: 55 }], serviceRules: [{ service: String(service._id), percent: 60 }] }] });
test('salva, retorna e calcula exceções semanais, preservando versão anterior', async () => {
  let res = await request(app).put(`/config/${user._id}`).set(auth).send(body());
  assert.equal(res.status, 200, res.text); assert.equal(res.body.revision, 1);
  assert.equal(res.body.weekdayRules[0].serviceRules[0].percent, 60);
  assert.equal(res.body.history.length, 1);
  assert.equal(String((await Config.findOne()).updatedBy), String(user._id));
  const old = await Config.findOne().lean();
  const next = body(); next.expectedRevision = 1; next.effectiveFrom = '2099-02-01'; next.weekdayRules[0].serviceRules[0].percent = 0;
  res = await request(app).put(`/config/${user._id}`).set(auth).send(next);
  assert.equal(res.status, 200, res.text);
  const saved = res.body;
  const options = { professionalCommission: saved, serviceId: String(service._id), groupId: String(group._id), serviceDate: '2099-02-01' };
  const sunday = Array.from({ length: 7 }, (_, i) => `2099-02-0${i + 1}`).find((d) => new Date(`${d}T12:00:00Z`).getUTCDay() === 0);
  assert.equal(engine.resolveServiceCommissionPercent({ ...options, serviceDate: sunday }), 0);
  assert.deepEqual(engine.resolveServiceCommission({ ...options, serviceDate: '2099-01-04' }), engine.resolveServiceCommission({ ...options, professionalCommission: old, serviceDate: '2099-01-04' }));
  res = await request(app).get('/config/bootstrap').set(auth);
  assert.equal(res.status, 200, res.text); assert.equal(res.body.configs[0].revision, 2);
});
test('rejeita sobreposição, referência inválida, duplicidade, percentual inválido e data inválida', async () => {
  const invalid = [];
  let b = body(); b.weekdayRules.push({ ...b.weekdayRules[0], id: 'overlap' }); invalid.push(b);
  b = body(); b.weekdayRules[0].serviceRules[0].service = new mongoose.Types.ObjectId().toString(); invalid.push(b);
  b = body(); b.groupRules.push(b.groupRules[0]); invalid.push(b);
  b = body(); b.weekdayRules[0].defaultPercent = 101; invalid.push(b);
  b = body(); b.weekdayRules[0].weekdays = []; invalid.push(b);
  b = body(); b.effectiveFrom = '2026-02-30'; invalid.push(b);
  for (const payload of invalid) { const res = await request(app).put(`/config/${user._id}`).set(auth).send(payload); assert.equal(res.status, 400, res.text); }
  assert.equal(await Config.countDocuments(), 0);
});
test('bloqueia atualização concorrente sem perder regras ou histórico', async () => {
  await request(app).put(`/config/${user._id}`).set(auth).send(body()).expect(200);
  const res = await request(app).put(`/config/${user._id}`).set(auth).send(body());
  assert.equal(res.status, 409); assert.equal((await Config.findOne()).revision, 1);
});


test('permite corrigir vigência passada sem perder auditoria nem aceitar revisão desatualizada', async () => {
  const initial = body(); initial.effectiveFrom = '2026-10-08';
  await request(app).put(`/config/${user._id}`).set(auth).send(initial).expect(200);
  const correction = { ...initial, expectedRevision: 1, effectiveFrom: '2026-10-04' };
  correction.weekdayRules[0].serviceRules[0].percent = 50;
  const res = await request(app).put(`/config/${user._id}`).set(auth).send(correction).expect(200);
  assert.equal(res.body.revision, 2);
  assert.equal(res.body.history.length, 2);
  assert.equal(res.body.history[1].effectiveFrom, '2026-10-08');
  const options = { professionalCommission: res.body, serviceId: String(service._id), groupId: String(group._id), servicePercent: 30 };
  assert.equal(engine.resolveServiceCommission({ ...options, serviceDate: '2026-10-04' }).percent, 50);
  assert.equal(engine.resolveServiceCommission({ ...options, serviceDate: '2026-10-11' }).percent, 50);
  assert.equal(engine.resolveServiceCommission({ ...options, serviceDate: '2026-09-27' }).percent, 30);
  await request(app).put(`/config/${user._id}`).set(auth).send(correction).expect(409);
});
