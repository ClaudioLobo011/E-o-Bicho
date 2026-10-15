const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const sharp = require('sharp');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Receiving = require('../receiving');
const createDocumentsRouter = require('../receivingDocuments');
const { parseDocumentText } = require('../../services/receivingPhotoExtraction');
const Photo = require('../../models/ReceivingPhoto');
const Extraction = require('../../models/ReceivingExtraction');
const Receipt = require('../../models/ReceivingReceipt');
const User = require('../../models/User');
const Store = require('../../models/Store');
const Deposit = require('../../models/Deposit');

let mongo, image, alternateImage, fixture, extractorCalls, extractorFailure;
const sampleText = 'ORCAMENTO: 849.919\nPAG: 001\n1 2 UN PRODUTO TESTE A 12345 5,0000 10,00 S\n2 1 CX PRODUTO TESTE B C/12 67890 12,0000 12,00 S\n3 5 UN PRODUTO TESTE C 11122 2,0000 10,00 S\nTOTAL: 32,00';
const extractor = async (bytes, photoId) => {
  extractorCalls.push({ bytes: Buffer.from(bytes), photoId });
  if (extractorFailure) throw new Error('private internal OCR failure');
  return { photoId: String(photoId), ...parseDocumentText(sampleText, photoId), provider: 'test-ocr', confidence: 85, rotation: 0, reviewed: false };
};
const app = express(); app.use(express.json({ limit: '200kb' }));
app.use('/api/receiving', createDocumentsRouter({ authenticateReceiving: Receiving.authenticateReceiving, findReceipt: Receiving.findReceipt, extractor }));
app.use('/api/receiving', Receiving);
const api = (method, url, token = fixture.token) => request(app)[method](`/api/receiving${url}`).set('Authorization', `Bearer ${token}`);
const upload = (receiptId, bytes = image, token) => api('post', `/receipts/${receiptId}/photos`, token).attach('photos', bytes, { filename: 'romaneio.png', contentType: 'image/png' });
const binary = (res, done) => { const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('end', () => done(null, Buffer.concat(chunks))); };
async function awaitExtraction(receiptId, jobId) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const response = await api('get', `/receipts/${receiptId}/extractions/${jobId}`).expect(200);
    if (response.body.status !== 'processing') return response.body;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('Extraction did not finish');
}

describe('receiving document persistence and access', { concurrency: false }, () => {
  before(async () => {
    process.env.JWT_SECRET = 'receiving-documents-test-secret-only';
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri(), { dbName: 'receiving-documents-tests' });
    await Promise.all([Photo.init(), Extraction.init(), Receipt.init(), User.init(), Store.init(), Deposit.init()]);
    image = await sharp({ create: { width: 16, height: 10, channels: 3, background: '#ffffff' } }).png().toBuffer();
    alternateImage = await sharp({ create: { width: 16, height: 10, channels: 3, background: '#fefefe' } }).png().toBuffer();
  });
  after(async () => { await mongoose.disconnect(); if (mongo) await mongo.stop(); });
  beforeEach(async () => {
    await Promise.all([Photo, Extraction, Receipt, User, Store, Deposit].map(model => model.deleteMany({})));
    extractorCalls = []; extractorFailure = false;
    const company = await Store.create({ nome: 'Loja teste' });
    const otherCompany = await Store.create({ nome: 'Outra loja' });
    const deposit = await Deposit.create({ codigo: 'DOC1', nome: 'Depósito', empresa: company._id });
    const otherDeposit = await Deposit.create({ codigo: 'DOC2', nome: 'Outro depósito', empresa: otherCompany._id });
    const user = await User.create({ tipoConta: 'pessoa_fisica', email: 'doc-admin@receiving.test', senha: 'hash', celular: '11999999999', nomeCompleto: 'Admin teste', role: 'admin' });
    const employee = await User.create({ tipoConta: 'pessoa_fisica', email: 'doc-staff@receiving.test', senha: 'hash', celular: '11999999998', nomeCompleto: 'Funcionário teste', role: 'funcionario', empresas: [company._id] });
    const makeReceipt = (companyId, depositId) => Receipt.create({ code: `ROM-${crypto.randomUUID()}`, companyId, depositId, createdBy: user._id, updatedBy: user._id });
    const receipt = await makeReceipt(company._id, deposit._id);
    const otherReceipt = await makeReceipt(otherCompany._id, otherDeposit._id);
    fixture = { company, user, employee, receipt, otherReceipt,
      token: jwt.sign({ id: String(user._id) }, process.env.JWT_SECRET), employeeToken: jwt.sign({ id: String(employee._id) }, process.env.JWT_SECRET) };
  });

  test('upload validates real image metadata, stores exact bytes and deduplicates identical SHA', async () => {
    const first = await upload(fixture.receipt._id).expect(201);
    const photo = first.body.photos[0];
    assert.equal(photo.sha256, crypto.createHash('sha256').update(image).digest('hex'));
    assert.equal(photo.width, 16); assert.equal(photo.height, 10); assert.equal(photo.size, image.length);
    assert.equal(photo.url, `/api/receiving/receipts/${fixture.receipt._id}/photos/${photo.id}/content`);
    const duplicate = await upload(fixture.receipt._id).expect(201);
    assert.equal(duplicate.body.photos[0].id, photo.id);
    assert.equal(await Photo.countDocuments({ receiptId: fixture.receipt._id }), 1);
    const content = await request(app).get(photo.url).set('Authorization', `Bearer ${fixture.token}`).buffer(true).parse(binary).expect(200);
    assert.deepEqual(content.body, image);
    assert.match(content.headers['content-type'], /^image\/png/);
    assert.equal(content.headers['x-content-type-options'], 'nosniff');
    assert.match(content.headers['cache-control'], /no-store/);
    const list = await api('get', `/receipts/${fixture.receipt._id}/photos`).expect(200);
    assert.equal(list.body.photos[0].status, 'uploaded');
    assert.equal(list.body.photos[0].data, undefined);
    assert.equal(list.body.photos[0].extraction, undefined);
  });

  test('photos and OCR results require live authorization and company-scoped receipt access', async () => {
    const own = (await upload(fixture.receipt._id).expect(201)).body.photos[0];
    const other = (await upload(fixture.otherReceipt._id).expect(201)).body.photos[0];
    await request(app).get(own.url).expect(401);
    await api('get', `/receipts/${fixture.otherReceipt._id}/photos`, fixture.employeeToken).expect(404);
    await request(app).get(other.url).set('Authorization', `Bearer ${fixture.employeeToken}`).expect(404);
    await upload(fixture.otherReceipt._id, image, fixture.employeeToken).expect(404);
    await api('get', `/receipts/${fixture.receipt._id}/photos/${other.id}/content`).expect(404);
    await api('get', '/receipts/invalid/photos').expect(400);
    await api('get', `/receipts/${fixture.receipt._id}/photos/invalid/content`).expect(404);
    await api('post', `/receipts/${fixture.receipt._id}/extract`).send({ photoIds: [other.id] }).expect(404);
    await api('post', `/receipts/${fixture.receipt._id}/parse-text`).send({ text: sampleText, photoId: other.id }).expect(404);
  });

  test('a closed test receipt keeps image evidence readable but rejects additions and extraction', async () => {
    const photo = (await upload(fixture.receipt._id).expect(201)).body.photos[0];
    await Receipt.updateOne({ _id: fixture.receipt._id }, { $set: { status: 'test_approved' } });
    await upload(fixture.receipt._id, alternateImage).expect(409);
    await api('post', `/receipts/${fixture.receipt._id}/extract`).send({ photoIds: [photo.id] }).expect(409);
    await api('post', `/receipts/${fixture.receipt._id}/parse-text`).send({ text: sampleText }).expect(409);
    const result = await request(app).get(photo.url).set('Authorization', `Bearer ${fixture.token}`).buffer(true).parse(binary).expect(200);
    assert.deepEqual(result.body, image);
    assert.equal(await Photo.countDocuments(), 1);
  });

  test('async extraction persists a proposal and caches OCR without modifying receipt quantities', async () => {
    const photo = (await upload(fixture.receipt._id).expect(201)).body.photos[0];
    const beforeReceipt = await Receipt.findById(fixture.receipt._id).lean();
    const submitted = await api('post', `/receipts/${fixture.receipt._id}/extract`).send({ photoIds: [photo.id] }).expect(202);
    const completed = await awaitExtraction(fixture.receipt._id, submitted.body.jobId);
    assert.equal(completed.status, 'completed');
    assert.equal(completed.extraction.lines.length, 3);
    assert.equal(completed.extraction.lines[0].expectedQuantity, 2);
    assert.equal(completed.extraction.lines[0].supplierCode, '12345');
    assert.equal(completed.extraction.lines[0].sourcePhotoId, photo.id);
    assert.equal(completed.extraction.lines[0].receivedQuantity, 0);
    assert.equal(completed.extraction.lines[0].reviewed, false);
    assert.equal(completed.extraction.lines[0].conversionConfirmed, false);
    assert.deepEqual(extractorCalls[0].bytes, image);
    assert.deepEqual(await Receipt.findById(fixture.receipt._id).lean(), beforeReceipt);
    const listed = await api('get', `/receipts/${fixture.receipt._id}/photos`).expect(200);
    assert.equal(listed.body.photos[0].status, 'extracted');
    const second = await api('post', `/receipts/${fixture.receipt._id}/extract`).send({ photoIds: [photo.id] }).expect(202);
    await awaitExtraction(fixture.receipt._id, second.body.jobId);
    assert.equal(extractorCalls.length, 1);
    await api('get', `/receipts/${fixture.otherReceipt._id}/extractions/${submitted.body.jobId}`).expect(404);
  });

  test('different photos of the same page remain stored but duplicate proposed rows are excluded', async () => {
    const first = (await upload(fixture.receipt._id).expect(201)).body.photos[0];
    const second = (await upload(fixture.receipt._id, alternateImage).expect(201)).body.photos[0];
    const submitted = await api('post', `/receipts/${fixture.receipt._id}/extract`).send({ photoIds: [first.id, second.id] }).expect(202);
    const completed = await awaitExtraction(fixture.receipt._id, submitted.body.jobId);
    assert.equal(await Photo.countDocuments(), 2);
    assert.equal(completed.extraction.lines.length, 3);
    assert.equal(completed.extraction.pages[1].selected, false);
    assert.equal(completed.extraction.pages[1].duplicateOf, first.id);
  });

  test('parse-text supports reviewed source entry and preserves packaging separately from quantity', async () => {
    const photo = (await upload(fixture.receipt._id).expect(201)).body.photos[0];
    const parsed = await api('post', `/receipts/${fixture.receipt._id}/parse-text`).send({ text: '54 1 CX RATOEIRA ADESIVA COLA RATO C/50 91449 114,9900 114,99 S', photoId: photo.id }).expect(200);
    const line = parsed.body.extraction.lines[0];
    assert.equal(line.expectedQuantity, 1); assert.equal(line.unit, 'CX'); assert.equal(line.stockFactor, 1);
    assert.equal(line.unitCost, 114.99); assert.equal(line.supplierCode, '91449'); assert.equal(line.barcode, '');
    assert.match(line.description, /C\/50/); assert.equal(line.sourcePhotoId, photo.id);
    assert.equal(line.conversionConfirmed, false); assert.equal(line.receivedQuantity, 0);
    assert.equal((await Receipt.findById(fixture.receipt._id).lean()).lines.length, 0);
    await api('post', `/receipts/${fixture.receipt._id}/parse-text`).send({ text: 'x'.repeat(120001) }).expect(400);
  });

  test('failed OCR is visible without internal details and the original remains downloadable', async () => {
    extractorFailure = true;
    const photo = (await upload(fixture.receipt._id).expect(201)).body.photos[0];
    const submitted = await api('post', `/receipts/${fixture.receipt._id}/extract`).send({ photoIds: [photo.id] }).expect(202);
    const completed = await awaitExtraction(fixture.receipt._id, submitted.body.jobId);
    assert.equal(completed.status, 'failed');
    assert.equal(completed.message.includes('private internal'), false);
    const result = await request(app).get(photo.url).set('Authorization', `Bearer ${fixture.token}`).buffer(true).parse(binary).expect(200);
    assert.deepEqual(result.body, image);
  });

  test('upload file counts and extract ids are bounded and explicit', async () => {
    await api('post', `/receipts/${fixture.receipt._id}/photos`).expect(400);
    let tooMany = api('post', `/receipts/${fixture.receipt._id}/photos`);
    for (let i = 0; i < 9; i++) tooMany = tooMany.attach('photos', image, { filename: `photo${i}.png` });
    await tooMany.expect(400);
    assert.equal(await Photo.countDocuments(), 0);
    const photo = (await upload(fixture.receipt._id).expect(201)).body.photos[0];
    await api('post', `/receipts/${fixture.receipt._id}/extract`).send({ photoIds: [photo.id, photo.id] }).expect(400);
    await api('post', `/receipts/${fixture.receipt._id}/extract`).send({ photoIds: [] }).expect(400);
  });

  test('malformed image bytes are rejected as an input error without creating a photo', async () => {
    const response = await api('post', `/receipts/${fixture.receipt._id}/photos`)
      .attach('photos', Buffer.from('this is not a JPEG'), { filename: 'fake.jpg', contentType: 'image/jpeg' }).expect(400);
    assert.match(response.body.message, /foto.*inválida/i);
    assert.equal(await Photo.countDocuments(), 0);
  });
});
