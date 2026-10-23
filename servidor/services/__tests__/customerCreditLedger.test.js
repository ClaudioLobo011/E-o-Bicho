const { test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const credit = require('../customerCreditLedger');
const User = require('../../models/User');

test('crédito central: concorrência, repetição, saldo parcial e cancelamento', async t => {
  const server = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  t.after(async () => { await mongoose.disconnect(); await server.stop(); });
  await mongoose.connect(server.getUri());
  await credit.Ledger.createCollection();
  const customerId = new mongoose.Types.ObjectId();
  await User.collection.insertOne({ _id: customerId, email: 'credit-fixture@example.invalid', valorPendente: 121.9 });
  const sale = { scope: 'pdv:a', eventId: 'sale1', customerId: String(customerId), amount: 60 };
  await t.test('mesma venda em paralelo desconta uma vez', async () => {
    const results = await Promise.all([credit.use(sale), credit.use(sale), credit.use(sale)]);
    assert.ok(results.every(r => r.balance === 61.9));
    assert.equal((await credit.balance(customerId)).balance, 61.9);
  });
  await t.test('outra máquina não gasta acima do saldo restante', async () => {
    await assert.rejects(credit.use({ ...sale, scope: 'pdv:b', amount: 80 }), /insuficiente/);
    assert.equal((await credit.balance(customerId)).balance, 61.9);
  });
  await t.test('cancelamento repetido devolve exatamente o utilizado', async () => {
    await Promise.all([credit.reverse(sale), credit.reverse(sale), credit.reverse(sale)]);
    assert.equal((await credit.balance(customerId)).balance, 121.9);
    await assert.rejects(credit.use(sale), /desfeita/);
  });
  await t.test('cancelamento antecipado bloqueia débito atrasado após timeout', async () => {
    const late = { ...sale, eventId: 'late' };
    await credit.reverse(late);
    await assert.rejects(credit.use(late), /desfeita/);
    assert.equal((await credit.balance(customerId)).balance, 121.9);
  });
  await t.test('valor ou cliente diferente não reutiliza chave da venda', async () => {
    await assert.rejects(credit.reverse({ ...sale, amount: 61 }), /original/);
    await assert.rejects(credit.use({ ...sale, eventId: 'bad', amount: 0.001 }), /inválido/);
  });
  await t.test('saldo integral é consumido e restaurado sem duplicar', async () => {
    const full = { ...sale, eventId: 'full', amount: 121.9 };
    assert.equal((await credit.use(full)).balance, 0);
    assert.equal((await credit.reverse(full)).balance, 121.9);
  });
  await t.test('duas máquinas disputam o saldo: apenas uma consegue usar', async () => {
    const first = { ...sale, scope: 'pdv:one', eventId: 'concurrent', amount: 100 };
    const second = { ...first, scope: 'pdv:two' };
    const results = await Promise.allSettled([credit.use(first), credit.use(second)]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal((await credit.balance(customerId)).balance, 21.9);
    await credit.reverse(results[0].status === 'fulfilled' ? first : second);
    assert.equal((await credit.balance(customerId)).balance, 121.9);
  });
  await t.test('devolução preserva outros créditos recebidos depois da venda', async () => {
    const original = { ...sale, eventId: 'refund-additive', amount: 20 };
    await credit.use(original);
    await User.updateOne({ _id: customerId }, { $inc: { valorPendente: 15 } });
    assert.equal((await credit.reverse(original)).balance, 136.9);
    assert.equal((await credit.reverse(original)).balance, 136.9);
  });
  await t.test('centavos não deixam resíduo que impeça usar o saldo inteiro', async () => {
    const pennyCustomer = new mongoose.Types.ObjectId();
    await User.collection.insertOne({ _id: pennyCustomer, email: 'penny-fixture@example.invalid', valorPendente: 0.3 });
    await credit.use({ ...sale, customerId: String(pennyCustomer), eventId: 'penny1', amount: 0.1 });
    assert.equal((await credit.use({ ...sale, customerId: String(pennyCustomer), eventId: 'penny2', amount: 0.2 })).balance, 0);
  });
});
