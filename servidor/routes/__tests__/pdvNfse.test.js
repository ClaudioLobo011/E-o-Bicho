const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const supertest = require('supertest');
const { createPdvNfseHandlers } = require('../pdvNfse');
const browserFiscal = require('../../../scripts/admin/pdv-nfse');
const pdvId = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const storeId = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const query = (value) => ({ lean: async () => value, select() { return this; } });

function fixture({ role = 'funcionario', stores = [storeId], cancelled = false, host = null, alias = false, issuerId = storeId, companyEnvironment = 'homologacao', pdvEnvironment } = {}) {
  const calls = [];
  const sale = { id: 'canonical-sale', saleCode: 'VENDA-01', status: cancelled ? 'cancelled' : 'completed', items: [{ itemType: 'service', serviceId: 'service', total: 80 }] };
  const result = { documents: [{ id: 'doc', status: 'authorized', consultationUrl: 'https://www.nfse.gov.br/EmissorNacional/Notas/Consultar?chave=123', total: 80 }], nfseStatus: 'authorized' };
  const handlers = createPdvNfseHandlers({
    Pdv: { findById: () => query({ _id: pdvId, empresa: storeId, empresaEmitenteFiscal: issuerId, ambientePadrao: pdvEnvironment }) },
    Store: { findById: (id) => { assert.equal(String(id), issuerId); return query({ _id: issuerId, nfse: { enabled: true, environment: companyEnvironment } }); } },
    Sale: { findOne: (filter) => query(alias && !filter.saleCode ? null : { payload: sale }) },
    State: { findOne: () => query(null) },
    service: Object.fromEntries(['emitSaleNfse', 'previewSaleNfse', 'listSaleNfse'].map((operation) => [operation, async (ctx) => { calls.push({ operation, ctx }); return structuredClone(result); }])),
  });
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.user = { role, storeIds: stores }; req.desktopHost = host; next(); });
  app.post('/:id/sales/:saleId/nfse', handlers.emit);
  app.post('/:id/sales/:saleId/nfse/preview', handlers.preview);
  app.get('/:id/sales/:saleId/nfse', handlers.list);
  return { request: supertest(app), calls };
}

test('NFS-e PDV validates company access before invoking emitter', async () => {
  for (const input of [{ role: 'cliente' }, { stores: [] }, { role: 'admin', stores: [] }]) {
    const f = fixture(input); await f.request.post(`/${pdvId}/sales/sale/nfse`).send({}).expect(403); assert.equal(f.calls.length, 0);
  }
});
test('NFS-e rejects cancelled sale and environment override without emission', async () => {
  let f = fixture({ cancelled: true }); await f.request.post(`/${pdvId}/sales/sale/nfse`).send({}).expect(409); assert.equal(f.calls.length, 0);
  f = fixture(); await f.request.post(`/${pdvId}/sales/sale/nfse`).send({ environment: 'producao' }).expect(422); assert.equal(f.calls.length, 0);
});
test('GET only reads documents and creates QR; preview never transmits', async () => {
  const f = fixture(); const response = await f.request.get(`/${pdvId}/sales/sale/nfse`).expect(200);
  assert.match(response.body.documents[0].qrCodeImage, /^data:image\/png;base64,/);
  assert.equal(f.calls[0].operation, 'listSaleNfse');
  await f.request.post(`/${pdvId}/sales/sale/nfse/preview`).send({}).expect(200);
  assert.equal(f.calls[1].operation, 'previewSaleNfse');
});
test('GET não oculta homologação após ativar produção e preview delega ambiente da venda', async () => {
  const f = fixture({ companyEnvironment: 'producao', pdvEnvironment: 'producao' });
  await f.request.get(`/${pdvId}/sales/sale/nfse`).expect(200);
  assert.equal(Object.hasOwn(f.calls[0].ctx, 'environment'), false);
  await f.request.post(`/${pdvId}/sales/sale/nfse/preview`).send({}).expect(200);
  assert.equal(Object.hasOwn(f.calls[1].ctx, 'environment'), false);
});
test('empresa produtiva não autoriza pedido produção de um PDV de testes', async () => {
  const f = fixture({ companyEnvironment: 'producao', pdvEnvironment: 'homologacao' });
  await f.request.post(`/${pdvId}/sales/sale/nfse`).send({ environment: 'producao' }).expect(422);
  assert.equal(f.calls.length, 0);
  await f.request.post(`/${pdvId}/sales/sale/nfse`).send({ environment: 'homologacao' }).expect(200);
  assert.equal(f.calls[0].ctx.environment, 'homologacao');
});
test('desktop aliases use canonical sale id and reject another PDV host', async () => {
  const f = fixture({ alias: true, host: { pdv: pdvId, empresa: storeId } });
  await f.request.post(`/${pdvId}/sales/local-sale/nfse`).send({ saleCode: 'VENDA-01' }).expect(200);
  assert.equal(f.calls[0].ctx.sale.id, 'canonical-sale');
  const denied = fixture({ host: { pdv: 'cccccccccccccccccccccccc', empresa: storeId } });
  await denied.request.post(`/${pdvId}/sales/local-sale/nfse`).send({}).expect(403);
});

test('operating company keeps its PDV while NFS-e uses the NFC-e fiscal issuer', async () => {
  const issuerId = 'cccccccccccccccccccccccc';
  for (const host of [null, { pdv: pdvId, empresa: storeId }]) {
    const f = fixture({ issuerId, host });
    await f.request.post(`/${pdvId}/sales/canonical-sale/nfse`).send({}).expect(200);
    assert.equal(f.calls[0].ctx.pdv.empresa, storeId, 'caixa permanece na empresa operacional');
    assert.equal(f.calls[0].ctx.store._id, issuerId, 'certificado e dados fiscais pertencem ao emitente escolhido');
  }
});
test('mixed receipt preserves a single item list and includes only authorized documents', () => {
  const sale = { items: [{ itemType: 'product' }, { serviceId: 'service' }], fiscalStatus: 'emitted', fiscalAccessKey: 'NFC-KEY', fiscalNumber: 22, fiscalQrCodeData: 'https://nfce.fazenda.rj.gov.br/', nfseStatus: 'partial', nfseDocuments: [
    { status: 'authorized', number: 33, accessKey: 'NFS-KEY', issuerName: 'Emitente fiscal de teste', issuerCnpj: '12345678000199', consultationUrl: 'https://www.nfse.gov.br/', qrCodeImage: 'data:image/png;base64,YQ==' },
    { status: 'unknown', number: 34, consultationUrl: 'https://example.com/' },
  ], nfseError: '<script>alert(1)</script>' };
  assert.deepEqual(browserFiscal.classify(sale), { services: true, products: true });
  assert.equal(browserFiscal.receiptDocuments(sale).length, 2);
  const html = browserFiscal.receiptMarkup(sale);
  assert.match(html, /NFC-e/); assert.match(html, /NFS-e/); assert.match(html, /pendente/);
  assert.match(html, /Emitente: Emitente fiscal de teste/); assert.match(html, /CNPJ: 12345678000199/);
  assert.ok(!html.includes('<script>')); assert.ok(!html.includes('Nota 34'));
  assert.equal(browserFiscal.safeUrl('javascript:alert(1)'), '');
});

test('receipt does not claim a pending invoice for explicitly complimentary services', () => {
  const complimentary = { items: [{ itemType: 'service', unitPrice: 0, total: 0 }], nfseStatus: 'not_applicable', nfseDocuments: [] };
  const html = browserFiscal.receiptMarkup(complimentary);
  assert.doesNotMatch(html, /NFS-e pendente|<img/);
  const mixed = { ...complimentary, items: [...complimentary.items, { itemType: 'product', total: 10 }] };
  assert.match(browserFiscal.receiptMarkup(mixed), /NFC-e dos produtos pendente/);
  mixed.fiscalStatus = 'emitted'; mixed.fiscalAccessKey = 'NFC-KEY'; mixed.fiscalNumber = 9;
  assert.equal(browserFiscal.receiptDocuments(mixed).length, 1);
  assert.doesNotMatch(browserFiscal.receiptMarkup(mixed), /pendente/);
});

test('browser separates genuinely free services from missing values and full discounts', () => {
  const service = { itemType: 'service', quantity: 1, unitPrice: 0, total: 0 };
  assert.equal(browserFiscal.hasChargeableServices({items: [service]}), false);
  assert.equal(browserFiscal.hasChargeableServices({items: [{...service, unitPrice: 50, discountValue: 50}]}), true);
  assert.equal(browserFiscal.hasChargeableServices({items: [{itemType: 'service', quantity: 1}]}), true);
  assert.equal(browserFiscal.hasChargeableServices({items: [{...service, total: 'invalido'}]}), true);
  assert.equal(browserFiscal.hasChargeableServices({items: [{...service, quantity: 0}]}), true);
  assert.equal(browserFiscal.hasChargeableServices({items: [{...service, unitPrice: false}]}), true);
  assert.equal(browserFiscal.hasChargeableServices({items: [{...service, unitPrice: [0]}]}), true);
  assert.equal(browserFiscal.hasChargeableServices({items: [{...service, valorSemAjuste: 50, descontoItemValor: 50}]}), true);
  assert.equal(browserFiscal.hasChargeableServices({items: [service], additionValue: 5}), true);
  assert.equal(browserFiscal.hasChargeableServices({items: [{itemType: 'product', quantity: 1, unitPrice: 25}, service]}), false);
  assert.equal(browserFiscal.hasChargeableServices({items: [{itemType: 'product', quantity: 1, unitPrice: 25}, service], discountValue: 5}), false);
});

test('joint receipt includes immutable approximate service taxes and escapes its source', () => {
  const sale = { items: [{itemType: 'service'}], nfseStatus: 'authorized', nfseDocuments: [{status: 'authorized', number: 1,
    approximateTaxes: {mode: 'percentual', federal: 9.42, state: 0, municipal: 1.65, total: 11.07, source: '<IBPT>', version: '26.2.A'}}] };
  assert.deepEqual(browserFiscal.receiptDocuments(sale)[0].approximateTaxes, sale.nfseDocuments[0].approximateTaxes);
  const html = browserFiscal.receiptMarkup(sale);
  assert.match(html, /Tributos aproximados dos serviços/);
  assert.match(html, /11,07/); assert.match(html, /9,42/); assert.match(html, /1,65/);
  assert.match(html, /&lt;IBPT&gt;/); assert.ok(!html.includes('<IBPT>'));
  assert.equal(browserFiscal.approximateTaxesMarkup({mode: 'percentual', total: NaN}), '');
});
