const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const supertest = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Store = require('../../models/Store');
const Pdv = require('../../models/Pdv');
const PdvState = require('../../models/PdvState');
const PdvStateSale = require('../../models/PdvStateSale');
const PdvCodeRange = require('../../models/PdvCodeRange');
const PdvDesktopHost = require('../../models/PdvDesktopHost');
const PdvDesktopEvent = require('../../models/PdvDesktopEvent');
const SequenceCounter = require('../../models/SequenceCounter');
const { nextScopedSequence, pdvSaleSequenceKey, pdvBudgetSequenceKey } = require('../../utils/sequences');
const router = require('../pdvDesktop');
const { runPdvCommand } = require('../pdvs');
const models = [Store, Pdv, PdvState, PdvStateSale, PdvCodeRange, PdvDesktopHost, PdvDesktopEvent, SequenceCounter];
let mongo;
const application = express();
application.use(express.json());
application.use('/desktop', router);
const request = supertest(application);
const headers = { 'X-Desktop-Token': 'range-test-only' };

async function fixture() {
  const store = await Store.create({ codigo: 'TEST', nome: 'Empresa Teste', nomeFantasia: 'Empresa Teste', cnpj: '00000000000000' });
  const pdv = await Pdv.create({ codigo: 'PDV-001', nome: 'Caixa Teste', empresa: store._id, tipoUso: 'executavel', desktop: { status: 'ativo' } });
  const host = await PdvDesktopHost.create({ pdv: pdv._id, empresa: store._id, status: 'active', machineId: 'range-test', tokenHash: crypto.createHash('sha256').update(headers['X-Desktop-Token']).digest('hex') });
  const state = await PdvState.create({ pdv: pdv._id, empresa: store._id, saleCodeIdentifier: 'PDV003', saleCodeSequence: 548, budgetSequence: 7,
    completedSales: [{ id: 'cancelled-541', saleCode: 'PDV001-000541', status: 'cancelled' }], budgets: [{ id: 'b6', code: 'ORC-000006' }] });
  await PdvStateSale.create({ pdv: pdv._id, sourceState: state._id, saleId: 'historical-547', saleCode: 'PDV001-000547', payload: { id: 'historical-547', saleCode: 'PDV001-000547' } });
  await SequenceCounter.create({ ...pdvSaleSequenceKey(pdv._id), seq: 547 });
  const range = await PdvCodeRange.create({ pdv: pdv._id, host: host._id, kind: 'sale', start: 520, end: 10519, next: 520 });
  return { store, pdv, host, state, range };
}

test.describe('reservas compartilhadas e recuperação de faixas por proprietário', () => {
  test.before(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri(), { dbName: 'pdv-code-ranges-test' });
    await Promise.all(models.map((model) => model.init()));
  });
  test.after(async () => { await mongoose.disconnect(); await mongo?.stop(); });
  test.beforeEach(async () => { await Promise.all(models.map((model) => model.deleteMany({}))); });

  test('metadata é somente leitura: owner exato, cursor consumido 548 e prefixo PDV001', async () => {
    const f = await fixture();
    const otherHost = new mongoose.Types.ObjectId();
    const foreignHost = await PdvCodeRange.create({ pdv: f.pdv._id, host: otherHost, kind: 'sale', start: 20000, end: 20999, next: 20000 });
    const foreignPdv = await PdvCodeRange.create({ pdv: new mongoose.Types.ObjectId(), host: f.host._id, kind: 'sale', start: 1, end: 100, next: 1 });
    const revoked = await PdvCodeRange.create({ pdv: f.pdv._id, host: f.host._id, kind: 'sale', start: 30000, end: 30999, next: 30000, status: 'revoked' });
    const expired = await PdvCodeRange.create({ pdv: f.pdv._id, host: f.host._id, kind: 'budget', start: 1, end: 100, next: 1 });
    await PdvCodeRange.collection.updateOne({ _id: expired._id }, { $set: { expiresAt: new Date('2020-01-01') } });
    const budget = await PdvCodeRange.create({ pdv: f.pdv._id, host: f.host._id, kind: 'budget', start: 3, end: 10002, next: 3 });
    const nfce = await PdvCodeRange.create({ pdv: f.pdv._id, host: f.host._id, kind: 'nfce', start: 62, end: 10061, next: 62 });
    const ids = [f.range, foreignHost, foreignPdv, revoked, expired, budget, nfce].map((r) => String(r._id));
    const before = JSON.stringify(await PdvCodeRange.find().sort({ _id: 1 }).lean());
    const response = await request.get(`/desktop/ranges/meta?rangeIds=${ids.join(',')}`).set(headers);
    assert.equal(response.status, 200, response.text);
    assert.equal(response.body.saleCodeIdentifier, 'PDV001');
    assert.equal(response.body.pdvId, String(f.pdv._id));
    assert.equal(response.body.hostId, String(f.host._id));
    assert.equal(response.body.ranges.length, 3);
    const sale = response.body.ranges.find((r) => r.kind === 'sale');
    assert.equal(sale.minimumNext, 548);
    assert.equal(sale.next, 520);
    assert.equal(sale.end, 10519);
    assert.equal(response.body.ranges.find((r) => r.kind === 'budget').minimumNext, 7);
    assert.equal(Object.hasOwn(response.body.ranges.find((r) => r.kind === 'nfce'), 'minimumNext'), false);
    assert.equal(JSON.stringify(await PdvCodeRange.find().sort({ _id: 1 }).lean()), before);
    assert.equal((await SequenceCounter.findOne(pdvSaleSequenceKey(f.pdv._id))).seq, 547);
    assert.equal((await PdvState.findById(f.state._id)).saleCodeSequence, 548);
  });

  test('metadata exige token ativo e IDs válidos; host revogado não recupera faixa', async () => {
    const f = await fixture();
    const url = `/desktop/ranges/meta?rangeIds=${f.range._id}`;
    assert.equal((await request.get(url)).status, 401);
    assert.equal((await request.get('/desktop/ranges/meta?rangeIds=invalid').set(headers)).status, 400);
    assert.equal((await request.get('/desktop/ranges/meta').set(headers)).status, 400);
    await PdvDesktopHost.updateOne({ _id: f.host._id }, { $set: { status: 'revoked' } });
    assert.equal((await request.get(url).set(headers)).status, 401);
  });

  test('bootstrap v1/v2 corrige prefixo sem reescrever histórico', async () => {
    const f = await fixture();
    for (const url of ['/desktop/bootstrap', '/desktop/sync/v2/bootstrap']) {
      const response = await request.get(url).set(headers);
      assert.equal(response.status, 200, response.text);
      assert.equal(response.body.state.saleCodeIdentifier, 'PDV001');
    }
    assert.equal((await PdvState.findById(f.state._id)).saleCodeIdentifier, 'PDV003');
    assert.equal((await PdvStateSale.findOne({ pdv: f.pdv._id })).saleCode, 'PDV001-000547');
  });

  test('reserva Desktop concorre com alocação Web sem sobrepor faixa legada, mesmo com estado atrasado', async () => {
    const f = await fixture();
    const stateSales = JSON.stringify((await PdvState.findById(f.state._id).lean()).completedSales);
    const operations = [];
    for (let i = 0; i < 4; i += 1) operations.push(request.post('/desktop/ranges/sale/reserve').set(headers).send({ size: 100 }).then((response) => {
      assert.equal(response.status, 201, response.text);
      assert.equal(response.body.hostId, String(f.host._id));
      return { start: response.body.start, end: response.body.end };
    }));
    for (let i = 0; i < 8; i += 1) operations.push(nextScopedSequence(pdvSaleSequenceKey(f.pdv._id)).then((n) => ({ start: n, end: n })));
    const intervals = (await Promise.all(operations)).sort((a, b) => a.start - b.start);
    assert.ok(intervals[0].start > 10519);
    for (let i = 1; i < intervals.length; i += 1) assert.ok(intervals[i].start > intervals[i - 1].end, JSON.stringify(intervals));
    assert.equal((await SequenceCounter.findOne(pdvSaleSequenceKey(f.pdv._id))).seq, intervals.at(-1).end);
    assert.equal(JSON.stringify((await PdvState.findById(f.state._id).lean()).completedSales), stateSales);
    assert.equal(await PdvStateSale.countDocuments(), 1);
  });

  test('reserva orçamento usa contador compartilhado e não reutiliza faixa revogada', async () => {
    const f = await fixture();
    await PdvCodeRange.create({ pdv: f.pdv._id, host: f.host._id, kind: 'budget', start: 3, end: 10002, next: 3, status: 'revoked' });
    const [response, number] = await Promise.all([
      request.post('/desktop/ranges/budget/reserve').set(headers).send({ size: 100 }),
      nextScopedSequence(pdvBudgetSequenceKey(f.pdv._id)),
    ]);
    assert.equal(response.status, 201, response.text);
    assert.ok(response.body.start > 10002);
    assert.ok(number > 10002 && (number < response.body.start || number > response.body.end));
  });

  test('finalização Web real ignora código de prévia dentro de faixa Desktop e mantém replay', async () => {
    const f = await fixture();
    await PdvState.updateOne({ pdv: f.pdv._id }, { $set: { caixaAberto: true } });
    const command = { action: 'pdv.sale.finalize', pdvId: String(f.pdv._id), pdvDoc: f.pdv, idempotencyKey: 'web-reserved-code',
      payload: { saleId: 'new-web-sale', saleCode: 'PDV001-000548', desktopHost: f.host.toObject(),
        items: [{ nome: 'Serviço Teste', quantidade: 1, preco: 10 }], payments: [{ id: 'dinheiro', label: 'Dinheiro', type: 'avista', valor: 10 }], totalBruto: 10, totalLiquido: 10 } };
    await runPdvCommand(command);
    let state = await PdvState.findById(f.state._id).lean();
    assert.equal(state.completedSales.find((sale) => sale.id === 'new-web-sale').saleCode, 'PDV001-010520');
    assert.equal(state.completedSales.find((sale) => sale.id === 'cancelled-541').saleCode, 'PDV001-000541');
    await runPdvCommand(command);
    state = await PdvState.findById(f.state._id).lean();
    assert.equal(state.completedSales.filter((sale) => sale.id === 'new-web-sale').length, 1);
    assert.equal((await SequenceCounter.findOne(pdvSaleSequenceKey(f.pdv._id))).seq, 10520);
  });

  test('finalização Desktop preserva código reservado apenas para host autenticado proprietário', async () => {
    const f = await fixture();
    await PdvState.updateOne({ pdv: f.pdv._id }, { $set: { caixaAberto: true } });
    const command = { action: 'pdv.sale.finalize', pdvId: String(f.pdv._id), pdvDoc: f.pdv, idempotencyKey: 'desktop-reserved-code',
      desktopHost: { _id: new mongoose.Types.ObjectId(), pdv: f.pdv._id },
      payload: { saleId: 'new-desktop-sale', saleCode: 'PDV001-000548',
        items: [{ nome: 'Serviço Teste', quantidade: 1, preco: 10 }], payments: [{ id: 'dinheiro', label: 'Dinheiro', type: 'avista', valor: 10 }], totalBruto: 10, totalLiquido: 10 } };
    await assert.rejects(runPdvCommand(command), (error) => error.code === 'PDV_CODE_RANGE_OWNER_MISMATCH');
    assert.equal((await PdvState.findById(f.state._id)).completedSales.length, 1);
    await runPdvCommand({ ...command, desktopHost: f.host });
    const state = await PdvState.findById(f.state._id).lean();
    assert.equal(state.completedSales.find((sale) => sale.id === 'new-desktop-sale').saleCode, 'PDV001-000548');
  });

  test('orçamento e delivery Web não tomam códigos de faixas Desktop nem renumeram registros anteriores', async () => {
    const f = await fixture();
    await PdvState.updateOne({ pdv: f.pdv._id }, { $set: { caixaAberto: true } });
    await PdvCodeRange.create({ pdv: f.pdv._id, host: f.host._id, kind: 'budget', start: 3, end: 10002, next: 3 });
    await runPdvCommand({ action: 'pdv.budget.save', pdvId: String(f.pdv._id), pdvDoc: f.pdv, idempotencyKey: 'new-web-budget',
      payload: { id: 'new-web-budget', code: 'ORC-000007', total: 10, items: [{ nome: 'Serviço Teste', quantidade: 1, preco: 10 }] } });
    let state = await PdvState.findById(f.state._id).lean();
    assert.equal(state.budgets.find((b) => b.id === 'new-web-budget').code, 'ORC-010003');
    assert.equal(state.budgets.find((b) => b.id === 'b6').code, 'ORC-000006');
    await runPdvCommand({ action: 'pdv.delivery.register', pdvId: String(f.pdv._id), pdvDoc: f.pdv, idempotencyKey: 'new-web-delivery',
      payload: { orderId: 'new-web-delivery', saleId: 'delivery-sale', saleCode: 'PDV001-000548', customerName: 'Teste',
        items: [{ nome: 'Serviço Teste', quantidade: 1, preco: 10 }], payments: [{ id: 'dinheiro', valor: 10 }], totalBruto: 10, totalLiquido: 10 } });
    state = await PdvState.findById(f.state._id).lean();
    assert.equal(state.completedSales.find((sale) => sale.id === 'delivery-sale').saleCode, 'PDV001-010520');
    assert.equal(state.completedSales.find((sale) => sale.id === 'cancelled-541').saleCode, 'PDV001-000541');
  });

  test('estado não regride contadores ao salvar snapshot ou operação de caixa atrasada', async () => {
    const f = await fixture();
    await PdvState.updateOne({ pdv: f.pdv._id }, { $max: { saleCodeSequence: 10520, budgetSequence: 10003 } });
    await PdvState.findOneAndUpdate({ pdv: f.pdv._id }, { $set: { saleCodeSequence: 548, budgetSequence: 7, caixaAberto: false } });
    await PdvState.findOneAndUpdate({ pdv: f.pdv._id }, { saleCodeSequence: 550, budgetSequence: 8, summary: { saldo: 99 } });
    const state = await PdvState.findById(f.state._id);
    assert.equal(state.saleCodeSequence, 10520);
    assert.equal(state.budgetSequence, 10003);
    assert.equal(state.summary.saldo, 99);
    assert.equal(state.caixaAberto, false);
  });

  test('código Desktop legado sem faixa não invade reserva criada entre a leitura e a reivindicação', async (t) => {
    const f = await fixture();
    await PdvCodeRange.deleteOne({ _id: f.range._id });
    await PdvState.updateOne({ pdv: f.pdv._id }, { $set: { caixaAberto: true } });
    let reached;
    let release;
    const readReached = new Promise((resolve) => { reached = resolve; });
    const resume = new Promise((resolve) => { release = resolve; });
    const originalFind = PdvCodeRange.find;
    let paused = false;
    t.mock.method(PdvCodeRange, 'find', function (...args) {
      const query = originalFind.apply(this, args);
      if (args[0]?.start?.$lte === 548 && !paused) {
        paused = true;
        const lean = query.lean.bind(query);
        query.lean = async (...leanArgs) => {
          const result = await lean(...leanArgs);
          reached();
          await resume;
          return result;
        };
      }
      return query;
    });
    const outcome = assert.rejects(runPdvCommand({ action: 'pdv.sale.finalize', pdvId: String(f.pdv._id), pdvDoc: f.pdv,
      idempotencyKey: 'legacy-reservation-race', desktopHost: f.host,
      payload: { saleId: 'legacy-race-sale', saleCode: 'PDV001-000548', items: [{ nome: 'Teste', quantidade: 1, preco: 10 }],
        payments: [{ id: 'dinheiro', valor: 10 }], totalBruto: 10, totalLiquido: 10 } }),
    (error) => error.code === 'PDV_CODE_RESERVATION_REQUIRED');
    await readReached;
    try {
      const response = await request.post('/desktop/ranges/sale/reserve').set(headers).send({ size: 100 });
      assert.equal(response.status, 201, response.text);
      assert.equal(response.body.start, 548);
      assert.equal(response.body.end, 647);
    } finally { release(); }
    await outcome;
    assert.equal((await PdvState.findById(f.state._id)).completedSales.length, 1);
  });

  test('rejeita evento com PDV de origem diferente antes de gravar ou materializar', async () => {
    await fixture();
    const response = await request.post('/desktop/events/batch').set(headers).send({ events: [{ eventId: 'wrong-pdv', type: 'sale.finalized', payload: { pdvId: String(new mongoose.Types.ObjectId()) } }] });
    assert.equal(response.status, 200, response.text);
    assert.equal(response.body.results[0].accepted, false);
    assert.equal(response.body.results[0].code, 'PDV_CONTEXT_CHANGED');
    assert.equal(response.body.results[0].disposition, 'requires_action');
    assert.equal(response.body.results[0].retryable, false);
    assert.equal(await PdvDesktopEvent.countDocuments(), 0);
  });

  test('reserva não aceita NaN, frações ou tamanho negativo', async () => {
    await fixture();
    for (const size of ['bad', 1.5, -1]) assert.equal((await request.post('/desktop/ranges/sale/reserve').set(headers).send({ size })).status, 400);
    assert.equal(await PdvCodeRange.countDocuments(), 1);
  });
});
