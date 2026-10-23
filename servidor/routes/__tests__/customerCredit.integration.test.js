const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
mongoose.set('transactionAsyncLocalStorage', true);
for (const [name, value] of [['requireAuth.js', (req, res, next) => { req.user = { role: 'admin' }; next(); }], ['authorizeRoles.js', () => (req, res, next) => next()]]) {
  const file = path.join(__dirname, '../../middlewares', name);
  require.cache[file] = { id: file, filename: file, loaded: true, exports: value };
}
const domain = require('../pdvs');
const Pdv = require('../../models/Pdv'), State = require('../../models/PdvState'), User = require('../../models/User');
const ledger = require('../../services/customerCreditLedger');
let mongo;
test.before(async () => { mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } }); await mongoose.connect(mongo.getUri()); await Promise.all(Object.values(mongoose.models).map(m => m.init())); });
test.after(async () => { await mongoose.disconnect(); await mongo.stop(); });
async function fixture() {
  const pdvId = new mongoose.Types.ObjectId(), customerId = new mongoose.Types.ObjectId(), empresa = new mongoose.Types.ObjectId();
  const pdv = { _id: pdvId, codigo: `C${String(pdvId).slice(-8)}`, nome: 'PDV isolado', empresa, tipoUso: 'web' };
  await Pdv.collection.insertOne(pdv);
  await User.collection.insertOne({ _id: customerId, email: `${customerId}@example.invalid`, valorPendente: 121.9, role: 'cliente' });
  await State.create({ pdv: pdvId, empresa, caixaAberto: true, completedSales: [], summary: { abertura: 0, recebido: 0, saldo: 0 }, caixaInfo: { aberturaData: new Date() } });
  const saleId = `sale-${pdvId}`;
  const payload = { customerCreditProtocolVersion: 1, saleId, customerId: String(customerId), customer: { id: String(customerId), nome: 'Cliente isolado' }, totalBruto: 60, totalLiquido: 60,
    items: [{ id: 'test-service', productId: 'test-service', itemType: 'service', name: 'Banho teste', quantity: 1, unitPrice: 60 }],
    payments: [{ id: `customer-credit:${customerId}`, label: 'Crédito do cliente', customerCreditPayment: true, type: 'customer_credit', valor: 60 }] };
  const options = { action: 'pdv.sale.finalize', pdvId: String(pdvId), pdvDoc: pdv, idempotencyKey: `event-${pdvId}`, payload, user: {} };
  return { pdvId, customerId, payload, options, saleId };
}
test('Web: venda e crédito atômicos, repetição e devolução no cancelamento real', async () => {
  const f = await fixture();
  const result = await domain.runPdvCommand(f.options);
  assert.equal((await ledger.balance(f.customerId)).balance, 61.9);
  const saved = await State.findOne({ pdv: f.pdvId }).lean();
  assert.equal(saved.completedSales[0].customerCredit.amount, 60);
  assert.equal(saved.completedSales[0].cashContributions.length, 0);
  await domain.runPdvCommand(f.options);
  assert.equal((await ledger.balance(f.customerId)).balance, 61.9);
  const cancel = { ...f.options, action: 'pdv.sale.cancel', idempotencyKey: `cancel-${f.pdvId}`, payload: { saleId: f.saleId, reason: 'Teste isolado' } };
  await domain.runPdvCommand(cancel);
  await domain.runPdvCommand(cancel);
  assert.equal((await ledger.balance(f.customerId)).balance, 121.9);
  assert.equal((await State.findOne({ pdv: f.pdvId }).lean()).completedSales[0].status, 'cancelled');
});
test('Web: falha na venda aborta débito e journal; página antiga precisa recarregar', async () => {
  const f = await fixture();
  await assert.rejects(domain.runPdvCommand({ ...f.options, payload: { ...f.payload, items: [] } }), /itens/);
  assert.equal((await ledger.balance(f.customerId)).balance, 121.9);
  assert.equal(await ledger.Ledger.countDocuments({ customerId: f.customerId }), 0);
  await assert.rejects(domain.runPdvCommand({ ...f.options, payload: { ...f.payload, customerCreditProtocolVersion: undefined } }), /Atualize/);
});
test('Desktop: importar venda após devolução não desconta crédito novamente', async () => {
  const f = await fixture();
  const intent = { scope: `pdv:${f.pdvId}`, eventId: f.options.idempotencyKey, customerId: String(f.customerId), amount: 60 };
  await ledger.use(intent); await ledger.reverse(intent);
  await domain.runPdvCommand({ ...f.options, desktopHost: { pdv: f.pdvId, empresa: f.options.pdvDoc.empresa } });
  assert.equal((await ledger.balance(f.customerId)).balance, 121.9);
  await domain.runPdvCommand({ ...f.options, action: 'pdv.sale.cancel', idempotencyKey: 'cancel-import', payload: { saleId: f.saleId, reason: 'Teste' } });
  assert.equal((await ledger.balance(f.customerId)).balance, 121.9);
});

test('Desktop real: SQLite, baixa online, envio, delivery e cancelamento repetido', async t => {
  const express = require('express'), request = require('supertest');
  require('../../models/UserGroup');
  const f = await fixture();
  await require('../../models/Store').collection.insertOne({ _id: f.options.pdvDoc.empresa, nome: 'Loja isolada', codigo: String(f.pdvId) });
  await State.updateOne({ pdv: f.pdvId }, { $set: { caixaAberto: false } });
  const app = express(); app.use(express.json()); app.use('/desktop', require('../pdvDesktop'));
  const http = request(app);
  const pairing = await http.post(`/desktop/pdvs/${f.pdvId}/pairing-code`).set('Authorization', 'Bearer test').send();
  assert.equal(pairing.status, 200, pairing.text);
  const paired = await http.post('/desktop/pair').send({ pairingCode: pairing.body.pairingCode, machineId: 'credit-isolated', name: 'Teste' });
  assert.equal(paired.status, 200, paired.text);
  await Pdv.updateOne({ _id: f.pdvId }, { $set: { tipoUso: 'executavel', 'desktop.status': 'ativo' } });
  const headers = { 'X-Desktop-Token': paired.body.token };
  const { StoreDatabase } = require(path.resolve(__dirname, '../../../../Executaveis/apps/store-service/src/database'));
  const { createCreditCoordinator } = require(path.resolve(__dirname, '../../../../Executaveis/apps/store-service/src/customerCredit'));
  const db = new StoreDatabase(':memory:'); t.after(() => db.close());
  const pdvId = String(f.pdvId), customerId = String(f.customerId);
  db.setSetting('pdv', { _id: pdvId }); db.addCodeRange({ rangeId: 'credit', kind: 'sale', start: 1, end: 10 });
  db.openCash({ eventId: 'credit-open', pdvId, openingAmount: 0 });
  const cloud = { config: () => ({ pdvId }), request: async (url, opts = {}) => {
    const response = await http[opts.method === 'POST' ? 'post' : 'get']('/desktop' + url).set(headers).send(opts.body ? JSON.parse(opts.body) : undefined);
    if (response.status !== 200) throw new Error(response.text);
    return response.body;
  } };
  const coordinator = createCreditCoordinator(db, cloud);
  const input = { eventId: 'credit-sale', pdvId, customerId, customerName: 'Teste', fiscalMode: 'matricial',
    items: [{ itemType: 'service', serviceId: String(new mongoose.Types.ObjectId()), name: 'Banho teste', quantity: 1, unitPrice: 60 }],
    payments: [{ paymentMethodId: `customer-credit:${customerId}`, type: 'customer_credit', fiscalCode: '21', amount: 60 }] };
  const sale = await coordinator.complete(input, () => db.finalizeSale(input));
  assert.equal((await ledger.balance(customerId)).balance, 61.9);
  async function send(events) {
    const response = await http.post('/desktop/events/batch').set(headers).send({ events });
    assert.equal(response.status, 200, response.text);
    for (const r of response.body.results) assert.equal(r.accepted, true, JSON.stringify(r));
  }
  await send(db.pendingOutbox()); await send(db.pendingOutbox());
  assert.equal((await State.findOne({ pdv: f.pdvId }).lean()).summary.saldo, 0);
  db.cancelSale({ eventId: 'credit-cancel', pdvId, saleId: sale.id, reason: 'Teste' });
  await coordinator.recover(); await send(db.pendingOutbox()); await coordinator.recover();
  assert.equal((await ledger.balance(customerId)).balance, 121.9);
  const delivery = db.registerDelivery({ ...input, eventId: 'delivery-register', payments: [], address: { street: 'Rua Teste', number: '1' } });
  const delivered = { ...input, eventId: 'delivery-credit', deliveryOrderId: delivery.id };
  await coordinator.complete(delivered, () => db.finalizeSale(delivered));
  await send(db.pendingOutbox());
  assert.equal((await ledger.balance(customerId)).balance, 61.9);
  const retry = { ...delivered, eventId: 'different-key' };
  await assert.rejects(coordinator.complete(retry, () => db.finalizeSale(retry)), /finalizado/);
  assert.equal((await ledger.balance(customerId)).balance, 61.9);
});
