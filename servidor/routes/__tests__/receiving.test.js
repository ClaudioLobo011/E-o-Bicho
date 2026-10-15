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
const receivingService = require('../../services/receivingService');

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
const component = (label, quantityPerKit = 1, product = null, barcode = product?.codbarras || '') => ({
  id: crypto.randomUUID(), label, quantityPerKit, productId: product ? String(product._id) : null, barcode,
});
const kitEvent = (lineId, quantity = 1) => ({ eventId: crypto.randomUUID(), mode: 'kit_count', lineId, quantity });
async function kitReceipt(components, { testMode = true, quantity = 0, ...lineFields } = {}) {
  let receipt = await create({ testMode });
  receipt = (await api('patch', `/receipts/${receipt._id}`).send({ version: receipt.version, lines: [{
    id: crypto.randomUUID(), description: 'Kit de camas', unit: 'KT', kit: { components }, ...lineFields,
  }] }).expect(200)).body.receipt;
  if (quantity) receipt = (await api('post', `/receipts/${receipt._id}/events`).send({ events: [kitEvent(receipt.lines[0].id, quantity)] }).expect(200)).body.receipt;
  return receipt;
}
async function reviewKit(receipt) {
  return (await api('patch', `/receipts/${receipt._id}`).send({ version: receipt.version,
    lines: receipt.lines.map(line => ({ id: line.id, reviewed: true, conversionConfirmed: true })),
  }).expect(200)).body.receipt;
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

  test('legacy event hashes stay compatible while component identity participates in new hashes', () => {
    const input = event('000123', 2, { lineId: crypto.randomUUID() });
    const legacy = crypto.createHash('sha256').update(JSON.stringify({ barcode: input.barcode, mode: input.mode, lineId: input.lineId, undoOf: '', quantity: 2 })).digest('hex');
    assert.equal(receivingService.normalizeEvent(input).payloadHash, legacy);
    assert.equal(receivingService.normalizeEvent({ ...input, componentId: '' }).payloadHash, legacy);
    const a = receivingService.normalizeEvent({ ...input, mode: 'identify', componentId: crypto.randomUUID() });
    const b = receivingService.normalizeEvent({ ...input, mode: 'identify', componentId: crypto.randomUUID() });
    assert.notEqual(a.payloadHash, b.payloadHash);
  });

  test('kits persist incomplete compositions and expose capability without assuming sizes or quantities', async () => {
    const meta = await api('get', '/meta').expect(200);
    assert.equal(meta.body.capabilities.kit, true); assert.equal(meta.body.limits.maxKitComponents, 50);
    const receipt = await kitReceipt([component('P', 3), component('G', 4), component('Tam 1', 2), component('Tam 27', 1), component('')], {
      productId: String(fixture.product._id), stockFactor: 99, reviewed: true, conversionConfirmed: true,
    });
    const line = receipt.lines[0];
    assert.equal(line.productId, null); assert.equal(line.productName, ''); assert.equal(line.stockFactor, 1);
    assert.equal(line.reviewed, false); assert.equal(line.conversionConfirmed, false); assert.equal(receipt.pendingCount, 1);
    assert.deepEqual(line.kit.components.map(item => [item.label, item.quantityPerKit]), [['P', 3], ['G', 4], ['Tam 1', 2], ['Tam 27', 1], ['', 1]]);
    const counted = await api('post', `/receipts/${receipt._id}/events`).send({ events: [kitEvent(line.id, 2)] }).expect(200);
    assert.equal(counted.body.receipt.lines[0].receivedQuantity, 2);
    await api('post', `/receipts/${receipt._id}/approve`).send({ version: counted.body.receipt.version }).expect(400);
    assert.equal(await Product.countDocuments(), 2); assert.equal(await Movement.countDocuments(), 0);
  });

  test('kit inputs reject fractional pieces, duplicated barcodes and invalid composition sizes', async () => {
    const receipt = await create(); const lineId = crypto.randomUUID();
    for (const components of [[], Array.from({ length: 51 }, () => component('P')), [component('P', 0)], [component('P', 1.5)],
      [component('P', 1, null, 'DUP'), component('M', 1, null, 'DUP')], [component('P', 1, null, 'bad\ncode')]]) {
      await api('patch', `/receipts/${receipt._id}`).send({ version: receipt.version, lines: [{ id: lineId, kit: { components } }] }).expect(400);
    }
    await api('patch', `/receipts/${receipt._id}`).send({ version: receipt.version, lines: [{ id: lineId, kit: { components: [component('P')] }, expectedQuantity: 1.5 }] }).expect(400);
    assert.equal((await Receipt.findById(receipt._id).lean()).lines.length, 0);
  });

  test('component scans identify only the selected piece and enforce conflicts without counting kits', async () => {
    let receipt = await kitReceipt([component('P'), component('M'), component('G')]);
    const lineId = receipt.lines[0].id; const [p, m, g] = receipt.lines[0].kit.components;
    const identify = event('000123', 99, { mode: 'identify', lineId, componentId: p.id });
    receipt = (await api('post', `/receipts/${receipt._id}/events`).send({ events: [identify] }).expect(200)).body.receipt;
    assert.equal(receipt.lines[0].receivedQuantity, 0); assert.equal(receipt.lines[0].productId, null);
    assert.equal(receipt.lines[0].kit.components[0].productId, String(fixture.product._id));
    assert.equal(receipt.lines[0].kit.components[0].productName, fixture.product.nome);
    assert.equal(receipt.lines[0].kit.components[1].barcode, '');
    const retry = (await api('post', `/receipts/${receipt._id}/events`).send({ events: [identify] }).expect(200)).body.receipt;
    assert.equal(retry.version, receipt.version);
    await api('post', `/receipts/${receipt._id}/events`).send({ events: [{ ...identify, componentId: m.id }] }).expect(409);
    for (const blocked of [event('000123', 1, { lineId }), event('000123', 1, { mode: 'identify', lineId }),
      event('000123', 1, { mode: 'identify', lineId, componentId: m.id }), event('999888', 1, { mode: 'identify', lineId, componentId: p.id })]) {
      await api('post', `/receipts/${receipt._id}/events`).send({ events: [blocked] }).expect(409);
    }
    receipt = (await api('post', `/receipts/${receipt._id}/events`).send({ events: [event('NEW-G', 1, { mode: 'identify', lineId, componentId: g.id })] }).expect(200)).body.receipt;
    assert.equal(receipt.lines[0].kit.components[2].barcode, 'NEW-G'); assert.equal(receipt.events.at(-1).status, 'unknown');
    assert.equal(receipt.lines[0].receivedQuantity, 0);
  });

  test('kit counts, concurrent batches, network retries and repeated undo persist exactly once', async () => {
    let receipt = await kitReceipt([component('P', 3)]); const lineId = receipt.lines[0].id;
    const counts = Array.from({ length: 8 }, () => kitEvent(lineId));
    const responses = await Promise.all(counts.map(item => api('post', `/receipts/${receipt._id}/events`).send({ events: [item] })));
    assert.ok(responses.every(response => response.status === 200), JSON.stringify(responses.map(response => response.body)));
    receipt = (await api('post', `/receipts/${receipt._id}/events`).send({ events: counts }).expect(200)).body.receipt;
    assert.equal(receipt.lines[0].receivedQuantity, 8); assert.equal(receipt.events.length, 8);
    for (const invalid of [{ ...kitEvent(lineId), barcode: '000123' }, kitEvent(lineId, 0), kitEvent(lineId, 0.5), { ...kitEvent(lineId), componentId: crypto.randomUUID() }]) {
      await api('post', `/receipts/${receipt._id}/events`).send({ events: [invalid] }).expect(400);
    }
    const undo = { eventId: crypto.randomUUID(), undoOf: counts[0].eventId };
    receipt = (await api('post', `/receipts/${receipt._id}/events`).send({ events: [undo, undo] }).expect(200)).body.receipt;
    assert.equal(receipt.lines[0].receivedQuantity, 7);
    receipt = (await api('post', `/receipts/${receipt._id}/events`).send({ events: [{ eventId: crypto.randomUUID(), undoOf: counts[0].eventId }] }).expect(200)).body.receipt;
    assert.equal(receipt.lines[0].receivedQuantity, 7); assert.equal(receipt.events.at(-1).status, 'already_undone');
    assert.equal(receipt.events[0].mode, 'kit_count');
  });

  test('a new unknown component barcode clears its prior SKU but preserves an intentional first alias', async () => {
    let receipt = await kitReceipt([component('P', 1, fixture.product)]);
    const line = receipt.lines[0]; const part = line.kit.components[0];
    const identify = barcode => event(barcode, 1, { mode: 'identify', lineId: line.id, componentId: part.id });
    receipt = (await api('post', `/receipts/${receipt._id}/events`).send({ events: [identify('NEW-UNKNOWN')] }).expect(200)).body.receipt;
    assert.equal(receipt.lines[0].kit.components[0].productId, null); assert.equal(receipt.lines[0].kit.components[0].productName, '');
    assert.equal(receipt.events.at(-1).status, 'unknown'); assert.equal(receipt.lines[0].receivedQuantity, 0);
    const explicit = [{ ...receipt.lines[0].kit.components[0], barcode: '', productId: String(fixture.product._id) }];
    receipt = (await api('patch', `/receipts/${receipt._id}`).send({ version: receipt.version, lines: [{ id: line.id, kit: { components: explicit } }] }).expect(200)).body.receipt;
    receipt = (await api('post', `/receipts/${receipt._id}/events`).send({ events: [identify('INTENDED-ALIAS'), identify('INTENDED-ALIAS')] }).expect(200)).body.receipt;
    assert.equal(receipt.lines[0].kit.components[0].productId, String(fixture.product._id));
    assert.equal(receipt.events.at(-1).status, 'identified');
    receipt = (await api('post', `/receipts/${receipt._id}/events`).send({ events: [identify('ANOTHER-UNKNOWN')] }).expect(200)).body.receipt;
    assert.equal(receipt.lines[0].kit.components[0].productId, null); assert.equal(receipt.events.at(-1).status, 'unknown');
  });

  test('composition edits reset confirmations and a counted kit cannot be reinterpreted as units', async () => {
    let receipt = await kitReceipt([component('P', 3, fixture.product)], { quantity: 1 });
    receipt = await reviewKit(receipt); const line = receipt.lines[0];
    await api('patch', `/receipts/${receipt._id}`).send({ version: receipt.version, lines: [{ id: line.id, kit: null, receivedQuantity: 0 }] }).expect(409);
    const components = line.kit.components.map(item => ({ ...item, quantityPerKit: 4, label: 'Tam 1' }));
    receipt = (await api('patch', `/receipts/${receipt._id}`).send({ version: receipt.version, lines: [{ id: line.id, kit: { components }, reviewed: true, conversionConfirmed: true }] }).expect(200)).body.receipt;
    assert.equal(receipt.lines[0].reviewed, false); assert.equal(receipt.lines[0].conversionConfirmed, false); assert.equal(receipt.lines[0].receivedQuantity, 1);
    await api('post', `/receipts/${receipt._id}/approve`).send({ version: receipt.version }).expect(400);
    receipt = (await api('patch', `/receipts/${receipt._id}`).send({ version: receipt.version, lines: [{ id: line.id, receivedQuantity: 0 }] }).expect(200)).body.receipt;
    await api('patch', `/receipts/${receipt._id}`).send({ version: receipt.version, lines: [{ id: line.id, kit: null }] }).expect(409);
    const ordinary = await readyReceipt({ quantity: 1 });
    await api('patch', `/receipts/${ordinary._id}`).send({ version: ordinary.version, lines: [{ id: ordinary.lines[0].id, kit: { components } }] }).expect(409);
  });

  test('PMG kits expand once into individual SKUs, preserve prices and never create a parent or supplier aliases', async () => {
    const large = await Product.create({ cod: '3', codbarras: 'LARGE', nome: 'Cama G', custo: 11, venda: 20, unidade: 'UN', estoques: [{ deposito: fixture.deposit._id, quantidade: 6 }] });
    let receipt = await kitReceipt([component('P', 1, fixture.product, 'PIECE-P'), component('M', 1, fixture.otherProduct, 'PIECE-M'), component('G', 1, large, 'PIECE-G')], {
      testMode: false, quantity: 2, expectedQuantity: 2, unitCost: 219.99, supplierCode: 'KITREF', barcode: 'KIT-PARENT',
    });
    receipt = await reviewKit(receipt);
    const approvals = await Promise.all(Array.from({ length: 2 }, () => api('post', `/receipts/${receipt._id}/approve`).send({ version: receipt.version, learnBarcodes: true, learnSupplierLinks: true })));
    assert.ok(approvals.every(response => [200, 409].includes(response.status)), JSON.stringify(approvals.map(response => response.body)));
    await api('post', `/receipts/${receipt._id}/approve`).send({ version: receipt.version }).expect(200);
    const products = await Product.find({}).sort({ cod: 1 }).lean();
    assert.deepEqual(products.map(item => item.stock), [12, 6, 8]);
    assert.deepEqual(products.map(item => [item.custo, item.venda]), [[9, 15], [5, 10], [11, 20]]);
    assert.ok(products.every(item => item.fornecedores.length === 0));
    assert.equal(await BarcodeLink.countDocuments(), 3); assert.equal(await BarcodeLink.countDocuments({ barcode: 'KIT-PARENT' }), 0);
    assert.equal(await Movement.countDocuments(), 3); assert.equal(await Movement.countDocuments({ 'metadata.fromKit': true }), 3);
    assert.equal(await AccountPayable.countDocuments(), 0); assert.equal(await Product.countDocuments(), 3);
    const saved = await Receipt.findById(receipt._id).lean();
    assert.equal(saved.lines[0].receivedQuantity, 2); assert.equal(saved.lines[0].productId, null); assert.equal(saved.approval.appliedProducts, 3);
  });

  test('3P, 4G and numbered aliases aggregate correctly alongside a regular line of the same SKU', async () => {
    let receipt = await kitReceipt([component('P', 3, fixture.product)], { testMode: false, quantity: 2 });
    receipt = (await api('patch', `/receipts/${receipt._id}`).send({ version: receipt.version, lines: [
      { id: crypto.randomUUID(), unit: 'KT', receivedQuantity: 2, kit: { components: [component('G', 4, fixture.otherProduct)] } },
      { id: crypto.randomUUID(), unit: 'KT', receivedQuantity: 1, kit: { components: [component('Tam 1', 1, fixture.product, '000123'), component('Tam 2', 2, fixture.product, '000456')] } },
      { id: crypto.randomUUID(), productId: String(fixture.product._id), barcode: '000123', receivedQuantity: 1, stockFactor: 1 },
    ] }).expect(200)).body.receipt;
    receipt = await reviewKit(receipt);
    const approved = await api('post', `/receipts/${receipt._id}/approve`).send({ version: receipt.version }).expect(200);
    assert.equal(approved.body.receipt.approval.appliedProducts, 2);
    assert.equal((await Product.findById(fixture.product._id).lean()).stock, 20);
    assert.equal((await Product.findById(fixture.otherProduct._id).lean()).stock, 12);
    assert.equal(await Movement.countDocuments(), 3);
    assert.equal(await Movement.countDocuments({ 'metadata.fromKit': true }), 2);
  });

  test('kit test approval checks differences but leaves inventory and barcode mappings untouched', async () => {
    const beforeProducts = await Product.find({}).sort({ _id: 1 }).lean();
    let receipt = await kitReceipt([component('Tam 1', 3, fixture.product, 'NEW-P')], { quantity: 2, expectedQuantity: 3 });
    receipt = await reviewKit(receipt);
    await api('post', `/receipts/${receipt._id}/approve`).send({ version: receipt.version }).expect(400);
    const result = await api('post', `/receipts/${receipt._id}/approve`).send({ version: receipt.version, acceptDifferences: true, learnBarcodes: true }).expect(200);
    assert.equal(result.body.receipt.status, 'test_approved');
    assert.deepEqual(await Product.find({}).sort({ _id: 1 }).lean(), beforeProducts);
    assert.equal(await Movement.countDocuments(), 0); assert.equal(await BarcodeLink.countDocuments(), 0);
  });

  test('kit components reject nested fractional products during setup, scan, review and approval', async () => {
    let receipt = await kitReceipt([component('P', 3, fixture.product)], { testMode: false, quantity: 1 });
    receipt = await reviewKit(receipt); const line = receipt.lines[0];
    await Product.updateOne({ _id: fixture.product._id }, { $set: { 'fracionado.ativo': true } });
    for (const fields of [{ kit: line.kit }, { reviewed: true, conversionConfirmed: true }]) {
      const response = await api('patch', `/receipts/${receipt._id}`).send({ version: receipt.version, lines: [{ id: line.id, ...fields }] }).expect(400);
      assert.equal(response.body.code, 'KIT_NESTED_FRACTIONAL');
    }
    const scan = await api('post', `/receipts/${receipt._id}/events`).send({ events: [event('000123', 1, { mode: 'identify', lineId: line.id, componentId: line.kit.components[0].id })] }).expect(400);
    assert.equal(scan.body.code, 'KIT_NESTED_FRACTIONAL');
    const approval = await api('post', `/receipts/${receipt._id}/approve`).send({ version: receipt.version }).expect(400);
    assert.equal(approval.body.code, 'KIT_NESTED_FRACTIONAL');
    assert.equal(await Movement.countDocuments(), 0); assert.equal((await Product.findById(fixture.product._id).lean()).stock, 10);
  });

  test('catalog changes to inactive products or conflicting barcodes block the whole kit approval', async () => {
    let receipt = await kitReceipt([component('P', 1, fixture.product), component('M', 1, fixture.otherProduct)], { testMode: false, quantity: 1 });
    receipt = await reviewKit(receipt);
    await Product.updateOne({ _id: fixture.otherProduct._id }, { $set: { inativo: true } });
    let result = await api('post', `/receipts/${receipt._id}/approve`).send({ version: receipt.version }).expect(400);
    assert.equal(result.body.code, 'PRODUCT_UNAVAILABLE');
    await Product.updateOne({ _id: fixture.otherProduct._id }, { $set: { inativo: false }, $push: { codigosComplementares: '000123' } });
    result = await api('post', `/receipts/${receipt._id}/approve`).send({ version: receipt.version }).expect(409);
    assert.equal(result.body.code, 'BARCODE_CONFLICT');
    assert.equal(await Movement.countDocuments(), 0); assert.equal(await BarcodeLink.countDocuments(), 0);
    assert.equal((await Product.findById(fixture.product._id).lean()).stock, 10); assert.equal((await Receipt.findById(receipt._id).lean()).status, 'draft');
  });

  test('a failed second component stock write rolls back first stock, audit and learned barcode', async () => {
    let receipt = await kitReceipt([component('P', 1, fixture.product, 'NEW-P'), component('M', 1, fixture.otherProduct, 'NEW-M')], { testMode: false, quantity: 1 });
    receipt = await reviewKit(receipt);
    const originalSave = Product.prototype.save; let sawFirstWrite = false;
    Product.prototype.save = async function (options) {
      if (options?.session && String(this._id) === String(fixture.otherProduct._id)) {
        const prior = await Product.findById(fixture.product._id).session(options.session).lean();
        sawFirstWrite = prior.stock === 11;
        const error = new Error('Falha controlada para testar rollback.'); error.status = 500; error.code = 'TEST_ROLLBACK'; throw error;
      }
      return originalSave.call(this, options);
    };
    try {
      await api('post', `/receipts/${receipt._id}/approve`).send({ version: receipt.version, learnBarcodes: true }).expect(500);
    } finally { Product.prototype.save = originalSave; }
    assert.equal(sawFirstWrite, true);
    assert.equal((await Product.findById(fixture.product._id).lean()).stock, 10);
    assert.equal((await Product.findById(fixture.otherProduct._id).lean()).stock, 4);
    assert.equal(await Movement.countDocuments(), 0); assert.equal(await BarcodeLink.countDocuments(), 0);
    assert.equal((await Receipt.findById(receipt._id).lean()).status, 'draft');
  });

  test('concurrent kit confirmations cannot assign a shared unknown barcode to different SKUs', async () => {
    const receipts = [];
    for (const product of [fixture.product, fixture.otherProduct]) receipts.push(await reviewKit(await kitReceipt([component('Tam 1', 3, product, 'SHARED-KIT')], { testMode: false, quantity: 1 })));
    const responses = await Promise.all(receipts.map(receipt => api('post', `/receipts/${receipt._id}/approve`).send({ version: receipt.version, learnBarcodes: true })));
    assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
    assert.equal(await BarcodeLink.countDocuments({ barcode: 'SHARED-KIT' }), 1); assert.equal(await Movement.countDocuments(), 1);
    assert.equal(await Receipt.countDocuments({ status: 'approved' }), 1); assert.equal(await Receipt.countDocuments({ status: 'draft' }), 1);
  });
});
