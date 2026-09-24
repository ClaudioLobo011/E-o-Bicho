const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const supertest = require('supertest');
const { createPdvFiscalConsultHandler } = require('../pdvFiscalConsult');
const pdvId = 'aaaaaaaaaaaaaaaaaaaaaaaa', storeId = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const issuerId = 'cccccccccccccccccccccccc';
const query = (value) => ({ lean: async () => value, select() { return this; } });
const keyBody = '3326091234567800019565001000000068112345678';
let sum = 0, weight = 2;
for (let i = 42; i >= 0; i--) { sum += Number(keyBody[i]) * weight; weight = weight === 9 ? 2 : weight + 1; }
const accessKey = keyBody + (sum % 11 < 2 ? 0 : 11 - sum % 11);

function fixture({ result = { status: '217', message: 'Não consta' }, sale = {}, host, missing = false, throws = false } = {}) {
  const calls = [];
  const handler = createPdvFiscalConsultHandler({
    Pdv: { findById: () => query({ _id: pdvId, empresa: storeId, empresaEmitenteFiscal: issuerId, serieNfce: '1', ambientesHabilitados: ['homologacao'] }) },
    Store: { findById: (id) => { assert.equal(String(id), issuerId); return query({ cnpj: '12.345.678/0001-95', uf: 'RJ' }); } },
    Sale: { findOne: (filter) => { assert.equal(filter.pdv, pdvId); return query(missing ? null : { payload: { id: 'sale', ...sale } }); } },
    State: { findOne: () => query(null) },
    certificatePair: () => ({ certificatePem: 'cert', privateKeyPem: 'key', certificateChain: ['cert'] }),
    consult: async (input) => { calls.push(input); if (throws) throw new Error('private internal failure'); return result; },
  });
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.desktopHost = host || { pdv: pdvId, empresa: storeId }; next(); });
  app.post('/sales/:saleId/fiscal/consult', handler);
  return { request: supertest(app), calls, body: { accessKey, environment: 'homologacao', saleCode: 'PDV001-000549' } };
}

test('consultation uses the fiscal issuer, never writes, and only 217 proves missing', async () => {
  const f = fixture(); const response = await f.request.post('/sales/sale/fiscal/consult').send(f.body).expect(200);
  assert.equal(response.body.notFound, true); assert.equal(response.body.authorized, false);
  assert.equal(response.body.accessKey, accessKey); assert.equal(response.body.cStat, '217');
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].privateKey, 'key');
  assert.equal(response.body.privateKey, undefined); assert.equal(response.body.certificate, undefined);
});

test('authorized, cancelled, unavailable and contradictory results never allow rebuilding', async () => {
  for (const result of [{ status: '100', protocol: 'p' }, { status: '101' }, { status: '108' }, { status: '999' },
    { status: '217', protocol: 'p' }, { status: '217', authorizationStatus: '100' }, { status: '217', authorizationStatus: '301' }]) {
    const f = fixture({ result });
    const { body } = await f.request.post('/sales/sale/fiscal/consult').send(f.body).expect(200);
    assert.equal(body.notFound, false, JSON.stringify(result));
  }
  const f = fixture({ sale: { fiscalStatus: 'emitted', fiscalProtocol: 'existing' } });
  const { body } = await f.request.post('/sales/sale/fiscal/consult').send(f.body).expect(200);
  assert.equal(body.notFound, false); assert.equal(body.authorized, true);
});

test('rejects wrong host, invalid key, missing sale and changed environment before consulting', async () => {
  const denied = fixture({ host: { pdv: pdvId, empresa: issuerId } });
  await denied.request.post('/sales/sale/fiscal/consult').send(denied.body).expect(403); assert.equal(denied.calls.length, 0);
  const missing = fixture({ missing: true });
  await missing.request.post('/sales/sale/fiscal/consult').send(missing.body).expect(404); assert.equal(missing.calls.length, 0);
  for (const patch of [{ accessKey: '1'.repeat(44) }, { environment: 'producao' }, { environment: '' }]) {
    const f = fixture(); const response = await f.request.post('/sales/sale/fiscal/consult').send({ ...f.body, ...patch });
    assert.ok(response.status >= 400); assert.equal(f.calls.length, 0);
  }
  const f = fixture({ sale: { fiscalAccessKey: 'another-key' } });
  await f.request.post('/sales/sale/fiscal/consult').send(f.body).expect(409); assert.equal(f.calls.length, 0);
});

test('transport errors do not masquerade as missing notes or expose credentials', async () => {
  const f = fixture({ throws: true });
  const { body } = await f.request.post('/sales/sale/fiscal/consult').send(f.body).expect(503);
  assert.equal(body.notFound, undefined); assert.ok(!JSON.stringify(body).includes('private internal'));
});
