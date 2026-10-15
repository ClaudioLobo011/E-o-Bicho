const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const Receipt = require('../../models/ReceivingReceipt');
const Device = require('../../models/ReceivingDevice');
const User = require('../../models/User');
const Store = require('../../models/Store');
const Deposit = require('../../models/Deposit');
const Product = require('../../models/Product');
const Supplier = require('../../models/Supplier');
const Movement = require('../../models/InventoryMovementLog');
const BarcodeLink = require('../../models/ReceivingBarcodeLink');
const AccountPayable = require('../../models/AccountPayable');
const router = require('../receiving');

let replica; let fixture;
const app = express(); app.use(express.json()); app.use('/api/receiving', router);
const api = (method, url, token = fixture.token) => request(app)[method](`/api/receiving${url}`).set('Authorization', `Bearer ${token}`);
const event = (barcode = '000123', quantity = 1, rest = {}) => ({ eventId: crypto.randomUUID(), mode: 'count', barcode, quantity, createdAt: '2026-10-15T12:00:00.000Z', ...rest });
const create = async (rest = {}, token) => (await api('post', '/receipts', token).send({ companyId: String(fixture.company._id), depositId: String(fixture.deposit._id), ...rest }).expect(201)).body.receipt;
async function readyReceipt({ testMode = true, quantity = 2, factor = 1, expectedQuantity = null, supplierCode = '' } = {}) {
  let receipt = await create({ testMode, supplierId: String(fixture.supplier._id) });
  receipt = (await api('post', `/receipts/${receipt._id}/events`).send({ events: [event('000123', quantity)] }).expect(200)).body.receipt;
  const line = receipt.lines[0];
  receipt = (await api('patch', `/receipts/${receipt._id}`).send({ version: receipt.version,
    lines: [{ id: line.id, stockFactor: factor, expectedQuantity, supplierCode, reviewed: true, conversionConfirmed: true }] }).expect(200)).body.receipt;
  return receipt;
}

describe('receiving persisted integration', { concurrency: false }, () => {
  before(async () => {
    process.env.JWT_SECRET = 'receiving-test-secret-only';
    replica = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
    await mongoose.connect(replica.getUri(), { dbName: 'receiving-tests' });
    await Promise.all([Receipt.init(), Device.init(), Product.init(), Store.init(), Deposit.init(), User.init(), Supplier.init(), Movement.init(), BarcodeLink.init()]);
  });
  after(async () => { await mongoose.disconnect(); if (replica) await replica.stop(); });
  beforeEach(async () => {
    await Promise.all([Receipt, Device, Product, Store, Deposit, User, Supplier, Movement, BarcodeLink, AccountPayable].map(model => model.deleteMany({})));
    const company = await Store.create({ nome: 'Loja de teste' });
    const otherCompany = await Store.create({ nome: 'Outra loja' });
    const deposit = await Deposit.create({ codigo: 'D1', nome: 'Depósito teste', empresa: company._id });
    const otherDeposit = await Deposit.create({ codigo: 'D2', nome: 'Outro depósito', empresa: otherCompany._id });
    const admin = await User.create({ tipoConta: 'pessoa_fisica', email: 'admin@receiving.test', senha: 'hash', celular: '11999999999', nomeCompleto: 'Teste', role: 'admin' });
    const employee = await User.create({ tipoConta: 'pessoa_fisica', email: 'staff@receiving.test', senha: 'hash', celular: '11999999998', nomeCompleto: 'Operador', role: 'funcionario', empresas: [company._id] });
    const product = await Product.create({ cod: '1', codbarras: '000123', codigosComplementares: ['000456'], nome: 'Produto de teste', custo: 9, venda: 15, unidade: 'UN', estoques: [{ deposito: deposit._id, quantidade: 10, unidade: 'UN' }] });
    const otherProduct = await Product.create({ cod: '2', codbarras: '999888', nome: 'Outro produto', custo: 5, venda: 10, unidade: 'UN', estoques: [{ deposito: deposit._id, quantidade: 4, unidade: 'UN' }] });
    const supplier = await Supplier.create({ legalName: 'Fornecedor teste', fantasyName: 'Fornecedor', cnpj: '12345678000199', companies: [company._id] });
    fixture = { company, otherCompany, deposit, otherDeposit, admin, employee, product, otherProduct, supplier,
      token: jwt.sign({ id: String(admin._id) }, process.env.JWT_SECRET), employeeToken: jwt.sign({ id: String(employee._id) }, process.env.JWT_SECRET) };
  });

  test('scoped enrollment hashes credentials, rejects old sc1 and honors revocation', async () => {
    const enrolled = await api('post', '/devices', fixture.employeeToken).send({ installationId: crypto.randomUUID(), name: 'TC57' }).expect(200);
    assert.match(enrolled.body.token, /^rc1_[a-f0-9]{64}$/);
    const record = await Device.findById(enrolled.body.deviceId).select('+tokenHash').lean();
    assert.notEqual(record.tokenHash, enrolled.body.token);
    await api('get', '/catalog', `sc1_${'a'.repeat(64)}`).expect(401);
    await api('get', '/devices', enrolled.body.token).expect(401);
    const catalog = await api('get', '/catalog', enrolled.body.token).expect(200);
    assert.equal(catalog.body.products[0].codbarras, '000123');
    assert.deepEqual(catalog.body.products[0].codigosComplementares, ['000456']);
    await api('delete', `/devices/${record._id}`, fixture.employeeToken).expect(200);
    await api('get', '/catalog', enrolled.body.token).expect(401);
  });

  test('employee receipts are shared by permitted company and cannot cross companies', async () => {
    const receipt = await create();
    await api('get', `/receipts/${receipt._id}`, fixture.employeeToken).expect(200);
    const restricted = await create({ companyId: String(fixture.otherCompany._id), depositId: String(fixture.otherDeposit._id) });
    await api('get', `/receipts/${restricted._id}`, fixture.employeeToken).expect(404);
    const list = await api('get', '/receipts', fixture.employeeToken).expect(200);
    assert.equal(list.body.receipts.length, 1);
    await api('post', '/receipts', fixture.employeeToken).send({ companyId: String(fixture.otherCompany._id), depositId: String(fixture.otherDeposit._id) }).expect(403);
    const meta = await api('get', '/meta', fixture.employeeToken).expect(200);
    assert.equal(meta.body.companies.length, 1);
    await api('post', '/receipts').send({ companyId: String(fixture.company._id), depositId: String(fixture.otherDeposit._id) }).expect(400);
  });

  test('real scanner repetitions count while network retries persist once and UUID payload reuse fails', async () => {
    const receipt = await create();
    const first = event('000123', 2); const second = event('000123', 3);
    const result = await api('post', `/receipts/${receipt._id}/events`).send({ events: [first, second] }).expect(200);
    assert.equal(result.body.receipt.lines[0].receivedQuantity, 5);
    assert.equal(result.body.receipt.lines[0].productName, fixture.product.nome);
    assert.equal(result.body.receipt.lines[0].productId, String(fixture.product._id));
    assert.equal(result.body.receipt.events[0].payloadHash, undefined);
    const retry = await api('post', `/receipts/${receipt._id}/events`).send({ events: [first, second] }).expect(200);
    assert.equal(retry.body.receipt.version, result.body.receipt.version);
    assert.equal(retry.body.receipt.events.length, 2);
    await api('post', `/receipts/${receipt._id}/events`).send({ events: [{ ...first, quantity: 10 }] }).expect(409);
    assert.equal((await Receipt.findById(receipt._id).lean()).lines[0].receivedQuantity, 5);
  });

  test('concurrent batches do not lose counts or acknowledge an unpersisted scan', async () => {
    const receipt = await create();
    const responses = await Promise.all(Array.from({ length: 8 }, () => api('post', `/receipts/${receipt._id}/events`).send({ events: [event()] })));
    for (const response of responses) assert.equal(response.status, 200, JSON.stringify(response.body));
    const saved = await Receipt.findById(receipt._id).lean();
    assert.equal(saved.lines[0].receivedQuantity, 8);
    assert.equal(saved.events.length, 8);
  });

  test('unknowns persist, identification does not count and incompatible product links fail', async () => {
    let receipt = await create();
    receipt = (await api('post', `/receipts/${receipt._id}/events`).send({ events: [event('UNKNOWN', 4)] }).expect(200)).body.receipt;
    assert.equal(receipt.lines[0].productId, null);
    assert.equal(receipt.events[0].status, 'unknown');
    const lineId = receipt.lines[0].id;
    receipt = (await api('post', `/receipts/${receipt._id}/events`).send({ events: [event('000456', 99, { mode: 'identify', lineId })] }).expect(200)).body.receipt;
    assert.equal(receipt.lines[0].receivedQuantity, 4);
    assert.equal(receipt.lines[0].productName, fixture.product.nome);
    await api('patch', `/receipts/${receipt._id}`).send({ version: receipt.version, lines: [{ id: lineId, productId: String(fixture.otherProduct._id) }] }).expect(409);
    const conflict = await api('post', `/receipts/${receipt._id}/events`).send({ events: [event('999888', 1, { lineId })] }).expect(200);
    assert.equal(conflict.body.receipt.lines.length, 2);
    assert.equal(conflict.body.receipt.lines[0].receivedQuantity, 4);
    assert.equal(conflict.body.receipt.lines[1].receivedQuantity, 1);
    assert.equal(conflict.body.receipt.events.at(-1).status, 'conflict');
  });

  test('optimistic edits preserve new scans, manual corrections are audited and undo is exactly once', async () => {
    const initial = await create(); const scan = event('000123', 3);
    let receipt = (await api('post', `/receipts/${initial._id}/events`).send({ events: [scan] }).expect(200)).body.receipt;
    await api('patch', `/receipts/${initial._id}`).send({ version: initial.version, notes: 'stale' }).expect(409);
    receipt = (await api('patch', `/receipts/${initial._id}`).send({ version: receipt.version, lines: [{ id: receipt.lines[0].id, receivedQuantity: 5 }] }).expect(200)).body.receipt;
    assert.equal(receipt.events.at(-1).mode, 'adjust');
    assert.equal(receipt.events.at(-1).quantity, 2);
    const undo = { eventId: crypto.randomUUID(), undoOf: scan.eventId };
    receipt = (await api('post', `/receipts/${initial._id}/events`).send({ events: [undo] }).expect(200)).body.receipt;
    assert.equal(receipt.lines[0].receivedQuantity, 2);
    await api('post', `/receipts/${initial._id}/events`).send({ events: [undo] }).expect(200);
    receipt = (await api('post', `/receipts/${initial._id}/events`).send({ events: [{ eventId: crypto.randomUUID(), undoOf: scan.eventId }] }).expect(200)).body.receipt;
    assert.equal(receipt.lines[0].receivedQuantity, 2);
    assert.equal(receipt.events.at(-1).status, 'already_undone');
  });

  test('test approval validates but never mutates inventory, costs or supplier aliases', async () => {
    const beforeProduct = await Product.findById(fixture.product._id).lean();
    const receipt = await readyReceipt({ quantity: 2, factor: 12, supplierCode: 'REF123' });
    const result = await api('post', `/receipts/${receipt._id}/approve`).send({ version: receipt.version, learnSupplierLinks: true }).expect(200);
    assert.equal(result.body.receipt.status, 'test_approved');
    assert.equal(result.body.receipt.approval.stockApplied, false);
    const afterProduct = await Product.findById(fixture.product._id).lean();
    assert.deepEqual(afterProduct, beforeProduct);
    assert.equal(await Movement.countDocuments(), 0);
    await api('patch', `/receipts/${receipt._id}`).send({ version: result.body.receipt.version, notes: 'x' }).expect(409);
    await api('post', `/receipts/${receipt._id}/approve`).send({ version: receipt.version }).expect(200);
  });

  test('real approval applies conversion once, is retry-safe and preserves prices', async () => {
    const receipt = await readyReceipt({ testMode: false, quantity: 2, factor: 12, supplierCode: 'REF123' });
    const result = await api('post', `/receipts/${receipt._id}/approve`).send({ version: receipt.version, learnSupplierLinks: true }).expect(200);
    assert.equal(result.body.receipt.status, 'approved');
    await api('post', `/receipts/${receipt._id}/approve`).send({ version: receipt.version, learnSupplierLinks: true }).expect(200);
    const product = await Product.findById(fixture.product._id).lean();
    assert.equal(product.stock, 34); assert.equal(product.custo, 9); assert.equal(product.venda, 15);
    assert.equal(product.fornecedores[0].codigoProduto, 'REF123');
    assert.equal(product.fornecedores[0].valorCalculo, 12);
    assert.equal(await Movement.countDocuments({ referenceDocument: receipt._id }), 1);
  });

  test('parallel real approval commits inventory only once', async () => {
    const receipt = await readyReceipt({ testMode: false, quantity: 3 });
    const responses = await Promise.all(Array.from({ length: 2 }, () => api('post', `/receipts/${receipt._id}/approve`).send({ version: receipt.version })));
    assert.ok(responses.every(response => [200, 409].includes(response.status)), JSON.stringify(responses.map(response => response.body)));
    assert.ok(responses.some(response => response.status === 200));
    assert.equal((await Product.findById(fixture.product._id).lean()).stock, 13);
    assert.equal(await Movement.countDocuments(), 1);
  });

  test('supplier reference collision rolls back the entire real approval', async () => {
    await Product.updateOne({ _id: fixture.otherProduct._id }, { $push: { fornecedores: { fornecedor: 'Fornecedor', documentoFornecedor: fixture.supplier.cnpj, codigoProduto: 'REF123', unidadeEntrada: 'UN', tipoCalculo: 'multiplicar', valorCalculo: 1 } } });
    const receipt = await readyReceipt({ testMode: false, supplierCode: 'REF123' });
    await api('post', `/receipts/${receipt._id}/approve`).send({ version: receipt.version, learnSupplierLinks: true }).expect(409);
    assert.equal((await Product.findById(fixture.product._id).lean()).stock, 10);
    assert.equal((await Receipt.findById(receipt._id).lean()).status, 'draft');
    assert.equal(await Movement.countDocuments(), 0);
  });

  test('difference confirmation is mandatory and collector cannot promote or approve real stock', async () => {
    const receipt = await readyReceipt({ testMode: false, expectedQuantity: 10 });
    await api('post', `/receipts/${receipt._id}/approve`).send({ version: receipt.version }).expect(400);
    const token = (await api('post', '/devices').send({ installationId: crypto.randomUUID(), name: 'TC57' }).expect(200)).body.token;
    await api('post', `/receipts/${receipt._id}/approve`, token).send({ version: receipt.version, acceptDifferences: true }).expect(403);
    const testReceipt = await create();
    await api('patch', `/receipts/${testReceipt._id}`, token).send({ version: testReceipt.version, testMode: false }).expect(403);
    await api('post', `/receipts/${receipt._id}/approve`).send({ version: receipt.version, acceptDifferences: true }).expect(200);
  });

  test('revoked employee authorization invalidates previously enrolled collector', async () => {
    const token = (await api('post', '/devices', fixture.employeeToken).send({ installationId: crypto.randomUUID(), name: 'TC57' }).expect(200)).body.token;
    await User.updateOne({ _id: fixture.employee._id }, { $set: { dataDemissao: new Date('2026-01-01') } });
    await api('get', '/catalog', token).expect(401);
    await api('get', '/meta', fixture.employeeToken).expect(401);
  });

  test('verified supplier reference prelinks only an exact unique match and still requires review', async () => {
    await Product.updateOne({ _id: fixture.product._id }, { $push: { fornecedores: { fornecedor: 'Fornecedor', documentoFornecedor: fixture.supplier.cnpj, codigoProduto: 'REF12', unidadeEntrada: 'CX', tipoCalculo: 'Multiplicar', valorCalculo: 12 } } });
    const receipt = await create({ supplierId: String(fixture.supplier._id) });
    const result = await api('patch', `/receipts/${receipt._id}`).send({ version: receipt.version,
      lines: [{ id: crypto.randomUUID(), description: 'Descrição do fornecedor', supplierCode: 'REF12', unit: 'CX', expectedQuantity: 3, reviewed: true, conversionConfirmed: true }] }).expect(200);
    const line = result.body.receipt.lines[0];
    assert.equal(line.productId, String(fixture.product._id));
    assert.equal(line.stockFactor, 12); assert.equal(line.reviewed, false); assert.equal(line.conversionConfirmed, false);
  });

  test('remembering a barcode creates a receiving-only mapping and later catalog collisions block it', async () => {
    let receipt = await create({ testMode: false });
    receipt = (await api('post', `/receipts/${receipt._id}/events`).send({ events: [event('NEWCODE', 2)] }).expect(200)).body.receipt;
    receipt = (await api('patch', `/receipts/${receipt._id}`).send({ version: receipt.version, lines: [{ id: receipt.lines[0].id, productId: String(fixture.product._id), reviewed: true, conversionConfirmed: true }] }).expect(200)).body.receipt;
    await api('post', `/receipts/${receipt._id}/approve`).send({ version: receipt.version, learnBarcodes: true }).expect(200);
    assert.equal(await BarcodeLink.countDocuments({ barcode: 'NEWCODE', productId: fixture.product._id }), 1);
    const product = await Product.findById(fixture.product._id).lean();
    assert.equal(product.codbarras, '000123'); assert.deepEqual(product.codigosComplementares, ['000456']);
    const catalog = await api('get', '/catalog').expect(200);
    assert.ok(catalog.body.products.find(item => item._id === String(product._id)).receivingBarcodes.includes('NEWCODE'));
    let next = await create();
    next = (await api('post', `/receipts/${next._id}/events`).send({ events: [event('NEWCODE')] }).expect(200)).body.receipt;
    assert.equal(next.lines[0].productId, String(product._id));
    await Product.updateOne({ _id: fixture.otherProduct._id }, { $push: { codigosComplementares: 'NEWCODE' } });
    const conflict = await api('post', `/receipts/${next._id}/events`).send({ events: [event('NEWCODE')] }).expect(200);
    assert.equal(conflict.body.receipt.events.at(-1).status, 'conflict');
    assert.equal(conflict.body.receipt.lines[0].receivedQuantity, 1);
  });

  test('concurrent confirmations cannot remember one barcode for two products', async () => {
    const receipts = [];
    for (const product of [fixture.product, fixture.otherProduct]) {
      let receipt = await create({ testMode: false });
      receipt = (await api('post', `/receipts/${receipt._id}/events`).send({ events: [event('SHARED')] }).expect(200)).body.receipt;
      receipt = (await api('patch', `/receipts/${receipt._id}`).send({ version: receipt.version, lines: [{ id: receipt.lines[0].id, productId: String(product._id), reviewed: true, conversionConfirmed: true }] }).expect(200)).body.receipt;
      receipts.push(receipt);
    }
    const responses = await Promise.all(receipts.map(receipt => api('post', `/receipts/${receipt._id}/approve`).send({ version: receipt.version, learnBarcodes: true })));
    assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
    assert.equal(await BarcodeLink.countDocuments({ barcode: 'SHARED' }), 1);
    assert.equal(await Movement.countDocuments(), 1);
  });

  test('a barcode whose catalog identity changed never increments the formerly linked product', async () => {
    let receipt = await create();
    receipt = (await api('post', `/receipts/${receipt._id}/events`).send({ events: [event('UNASSIGNED')] }).expect(200)).body.receipt;
    receipt = (await api('patch', `/receipts/${receipt._id}`).send({ version: receipt.version, lines: [{ id: receipt.lines[0].id, productId: String(fixture.product._id) }] }).expect(200)).body.receipt;
    await Product.updateOne({ _id: fixture.otherProduct._id }, { $push: { codigosComplementares: 'UNASSIGNED' } });
    const result = await api('post', `/receipts/${receipt._id}/events`).send({ events: [event('UNASSIGNED')] }).expect(200);
    assert.equal(result.body.receipt.lines[0].receivedQuantity, 1);
    assert.equal(result.body.receipt.events.at(-1).status, 'conflict');
  });

  test('ordinary employees can confer but cannot approve a real receipt even with a JWT', async () => {
    const receipt = await readyReceipt({ testMode: false });
    await api('post', `/receipts/${receipt._id}/approve`, fixture.employeeToken).send({ version: receipt.version }).expect(403);
    assert.equal((await Product.findById(fixture.product._id).lean()).stock, 10);
  });

  test('real receipt unit cost is evidence only and never changes prices or accounts payable', async () => {
    const payable = { _id: new mongoose.Types.ObjectId(), code: 'EXISTING-TEST', company: fixture.company._id, totalValue: 123.45, status: 'pending', installments: [{ number: 1, value: 123.45 }] };
    await AccountPayable.collection.insertOne(payable);
    const beforeFinance = await AccountPayable.collection.find({}).toArray();
    const before = await Product.findById(fixture.product._id).lean();
    let receipt = await readyReceipt({ testMode: false, quantity: 7 });
    receipt = (await api('patch', `/receipts/${receipt._id}`).send({ version: receipt.version, lines: [{ id: receipt.lines[0].id, unitCost: 87.65, reviewed: true }] }).expect(200)).body.receipt;
    await api('post', `/receipts/${receipt._id}/approve`).send({ version: receipt.version }).expect(200);
    const after = await Product.findById(fixture.product._id).lean();
    assert.equal(after.stock, before.stock + 7);
    for (const field of ['custo', 'venda', 'precoClube', 'promocao', 'promocaoCondicional', 'fiscal', 'fiscalPorEmpresa']) assert.deepEqual(after[field], before[field], field);
    assert.deepEqual(await AccountPayable.collection.find({}).toArray(), beforeFinance);
    const saved = await Receipt.findById(receipt._id).lean();
    assert.equal(saved.lines[0].unitCost, 87.65);
  });
});
