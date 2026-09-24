const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const https = require('node:https');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const mongoose = require('mongoose');
const forge = require('node-forge');
const xpath = require('xpath');
const { SignedXml } = require('xml-crypto');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Model = require('../../models/NfseDocument');
const { createNfseService, _test, NfseValidationError, publicDocument } = require('../nfseService');
const { buildDpsXml, buildDpsId, signXml, parseAuthorizedXml, parseXml, buildCancellationXml } = require('../nfseXml');
const { createTransport, request, compressXml, decompressXml, NfseApiError, ENDPOINTS } = require('../nfseTransport');

const STORE_ID = '640000000000000000000001';
const PDV_ID = '640000000000000000000002';
const SERVICE_ID = '640000000000000000000003';
const SERVICE2_ID = '640000000000000000000004';
const KEY = '3304557211222333000181'.padEnd(50, '0');
const date = new Date('2026-09-23T15:00:00.000Z');
let pair; let mongo; let sequence;
let store; let services; let rules; let fake; let engine; let engineOptions;
const clone = (value) => JSON.parse(JSON.stringify(value));
const query = (value) => ({ select() { return this; }, lean: async () => clone(value) });
const saleInput = (overrides = {}) => ({ sale: { id: 'test-sale', saleCode: 'PDV001-TEST', createdAt: date, status: 'completed', customerName: 'Cliente de teste', customerDocument: '52998224725', total: 180, discountValue: 0, additionValue: 0, items: [{ id: 'p1', itemType: 'produto', quantity: 1, unitValue: 100, totalValue: 100, product: 'Produto de teste' }, { serviceId: SERVICE_ID, itemType: 'servico', quantity: 1, unitValue: 80, totalValue: 80, product: 'Banho de teste' }], ...overrides }, pdv: { _id: PDV_ID, empresa: STORE_ID }, store: { _id: STORE_ID } });
function authorized(xml, key = KEY) { return `<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01"><infNFSe Id="NFS${key}"><nNFSe>123</nNFSe><cStat>100</cStat><dhProc>2026-09-23T15:00:05+00:00</dhProc>${xml.replace(/<\?xml[^>]*>/, '')}</infNFSe></NFSe>`; }

before(async () => {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey; cert.serialNumber = '01';
  cert.validity.notBefore = new Date('2020-01-01'); cert.validity.notAfter = new Date('2030-01-01');
  const attrs = [{ name: 'commonName', value: 'NFS-e TESTE LOCAL' }]; cert.setSubject(attrs); cert.setIssuer(attrs);
  cert.setExtensions([{ name: 'basicConstraints', cA: true }, { name: 'keyUsage', digitalSignature: true, keyCertSign: true, keyEncipherment: true }, { name: 'extKeyUsage', serverAuth: true, clientAuth: true }, { name: 'subjectAltName', altNames: [{ type: 7, ip: '127.0.0.1' }] }]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  pair = { certificatePem: forge.pki.certificateToPem(cert), privateKeyPem: forge.pki.privateKeyToPem(keys.privateKey) };
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri(), { dbName: 'nfse_automated_tests' });
  await Model.init();
});
after(async () => { await mongoose.disconnect(); await mongo?.stop(); });
beforeEach(async () => {
  await Model.deleteMany({}); sequence = 0;
  store = { _id: STORE_ID, cnpj: '11222333000181', codigoIbgeMunicipio: '3304557', razaoSocial: 'Empresa fictícia de testes', inscricaoMunicipal: '123', nfse: { enabled: true, environment: 'homologacao', serieDps: '1', opSimpNac: '3', regApTribSN: '1', regimeEspecialTributacao: '0' } };
  services = [{ _id: SERVICE_ID, nome: 'Banho de teste', fiscalPorEmpresa: { [STORE_ID]: { fiscalRuleCode: '1', descricao: 'Banho & secagem' } } }];
  rules = [{ empresa: STORE_ID, code: 1, tipo: 'servico', fiscal: { nfse: { codigoTributacaoNacional: '050801', tributacaoIss: '1', tipoRetencaoIss: '1', totalTributosModo: 'simples', pTotTribSN: 6 } } }];
  fake = { calls: [], issued: new Map(),
    async emit(env, xml) { this.calls.push('POST'); const dpsId = xpath.select1("string(//*[local-name()='infDPS']/@Id)", parseXml(xml)); const content = authorized(xml); this.issued.set(dpsId, content); return { nfseXmlGZipB64: compressXml(content) }; },
    async queryDps(env, dpsId) { this.calls.push('GET DPS'); if (!this.issued.has(dpsId)) throw new NfseApiError('Não encontrada', { statusCode: 404, codes: ['E2404'] }); return { chaveAcesso: KEY }; },
    async queryNfse() { this.calls.push('GET NFSE'); return { nfseXmlGZipB64: compressXml([...this.issued.values()].at(-1)) }; },
    async events() { return { eventos: [] }; },
  };
  engineOptions = { Model, now: () => new Date(date), reloadSale: async ({ sale }) => sale, certificateLoader: async () => pair, nextNumber: async () => ++sequence, transportFactory: () => fake, models: { Store: { findById: () => query(store) }, Service: { find: () => query(services) }, FiscalDefaultRule: { find: () => query(rules) }, User: { findById: () => query({}) } } };
  engine = createNfseService(engineOptions);
});

test('projeção NFS-e rateia descontos e acréscimos sem depender de pagamentos NFC-e', () => {
  const input = saleInput({ total: 175, discountValue: 10, additionValue: 5 });
  const projected = _test.projectItems(input.sale);
  assert.deepEqual(projected.map(item => item.netTotal), [97.22, 77.78]);
  const withUnrelatedPayment = _test.projectItems({ ...input.sale, payments: [{ forma: 'inválida para NFC-e', valor: 999 }] });
  assert.deepEqual(withUnrelatedPayment.map(item => item.netTotal), projected.map(item => item.netTotal));
});

test('prévia identifica somente serviços, emite com o valor correto e preserva uma venda mista', async () => {
  const input = saleInput();
  assert.equal(Object.hasOwn(input.sale, 'payments'), false);
  const preview = await engine.previewSaleNfse(input);
  assert.equal(preview.ready, true, preview.issues.join('; ')); assert.equal(preview.documentCount, 1); assert.equal(preview.serviceTotal, 80);
  const result = await engine.emitSaleNfse(input);
  assert.equal(result.nfseStatus, 'authorized'); assert.equal(result.documents[0].total, 80); assert.equal(result.documents[0].number, '123');
  assert.match(result.documents[0].consultationUrl, /producaorestrita/);
  assert.equal(input.sale.items.length, 2); assert.equal(input.sale.total, 180);
  const issuedXmlTime = xpath.select1("string(//*[local-name()='dhEmi'])", parseXml(result.documents[0].xmlContent));
  assert.equal(issuedXmlTime, '2026-09-23T12:00:00-03:00'); assert.equal(new Date(issuedXmlTime).getTime(), date.getTime());
  assert.deepEqual(fake.calls, ['POST']);
});

test('PDV de outra empresa usa certificado, regra e identificação congelada do emitente fiscal escolhido', async () => {
  const businessId = '640000000000000000000099';
  const input = saleInput();
  input.pdv.empresa = businessId;
  input.pdv.empresaEmitenteFiscal = STORE_ID;
  input.sale.empresa = businessId;
  delete input.store;
  const originalName = store.razaoSocial; const originalCnpj = store.cnpj;
  services[0].fiscalPorEmpresa[businessId] = { fiscalRuleCode: '999', descricao: 'Não usar a regra da empresa comercial' };
  const lookedUp = []; const certificateStores = [];
  engine = createNfseService({ ...engineOptions,
    models: { ...engineOptions.models, Store: { findById: (value) => { lookedUp.push(value); return query(store); } } },
    certificateLoader: async (issuerStore) => { certificateStores.push(issuerStore._id); return pair; },
  });
  const preview = await engine.previewSaleNfse(input);
  assert.equal(preview.ready, true, preview.issues.join('; '));
  assert.match(preview.groups[0].description, /Banho & secagem/);
  assert.equal(preview.groups[0].codigoTributacaoNacional, rules[0].fiscal.nfse.codigoTributacaoNacional);
  const document = (await engine.emitSaleNfse(input)).documents[0];
  assert.equal(document.status, 'authorized'); assert.equal(document.store, STORE_ID);
  assert.equal(document.issuerName, originalName); assert.equal(document.issuerCnpj, originalCnpj);
  assert.match(document.xmlContent, new RegExp(`<prest><CNPJ>${originalCnpj}</CNPJ>`));
  assert.equal(input.pdv.empresa, businessId); assert.equal(input.sale.empresa, businessId);
  assert.deepEqual(lookedUp, [STORE_ID, STORE_ID]); assert.deepEqual(certificateStores, [STORE_ID, STORE_ID]);
  store.razaoSocial = 'Cadastro alterado depois da emissão'; store.cnpj = '00000000000000';
  const historic = (await engine.listSaleNfse(input)).documents[0];
  assert.equal(historic.issuerName, originalName); assert.equal(historic.issuerCnpj, originalCnpj);
});

test('cliques repetidos não reservam outra DPS nem retransmitem', async () => {
  const input = saleInput(); const first = await engine.emitSaleNfse(input); const second = await engine.emitSaleNfse(input);
  assert.equal(first.documents[0].id, second.documents[0].id); assert.equal(sequence, 1); assert.deepEqual(fake.calls, ['POST']); assert.equal(await Model.countDocuments(), 1);
});

test('concorrência entre dois emissores mantém um documento e apenas um POST', async () => {
  const results = await Promise.allSettled([engine.emitSaleNfse(saleInput()), engine.emitSaleNfse(saleInput())]);
  assert.equal(await Model.countDocuments(), 1); assert.equal(fake.calls.filter((v) => v === 'POST').length, 1);
  assert.ok(results.some((result) => result.status === 'fulfilled' && result.value.nfseStatus === 'authorized'));
  assert.ok(results.every((result) => result.status === 'fulfilled' || result.reason.code === 'NFSE_SALE_BUSY'));
});

test('renova a trava do documento durante transporte demorado e impede consulta concorrente', async () => {
  let currentTime = new Date(date);
  engine = createNfseService({ ...engineOptions, now: () => new Date(currentTime), documentHeartbeatMs: 5 });
  let releaseTransport;
  const waiting = new Promise((resolve) => { releaseTransport = resolve; });
  let enteredTransport;
  const entered = new Promise((resolve) => { enteredTransport = resolve; });
  const emit = fake.emit.bind(fake);
  fake.emit = async (...args) => { enteredTransport(); await waiting; return emit(...args); };
  const emission = engine.emitSaleNfse(saleInput());
  try {
    await entered;
    const document = await Model.findOne().lean();
    currentTime = new Date(date.getTime() + 120000);
    let renewed;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      renewed = await Model.findById(document._id).lean();
      if (new Date(renewed.lockUntil).getTime() > date.getTime() + 180000) break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.ok(new Date(renewed.lockUntil).getTime() > date.getTime() + 180000);
    currentTime = new Date(date.getTime() + 240000);
    assert.equal((await engine.consultDocument(document._id)).status, 'processing');
    assert.deepEqual(fake.calls, []);
  } finally { releaseTransport(); }
  assert.equal((await emission).nfseStatus, 'authorized');
  assert.equal((await Model.findOne().lean()).lockUntil, null);
});

test('perda de propriedade da trava bloqueia retransmissão e cancelamento antes do POST', async () => {
  const emit = fake.emit.bind(fake);
  fake.emit = async () => { fake.calls.push('POST'); throw new NfseApiError('timeout', { uncertain: true }); };
  const first = await engine.emitSaleNfse(saleInput());
  fake.queryDps = async () => {
    await Model.updateOne({ _id: first.documents[0].id }, { $set: { lockToken: 'another-process' } });
    throw new NfseApiError('Ausente', { statusCode: 404, codes: ['E2404'] });
  };
  await assert.rejects(engine.emitSaleNfse(saleInput()), (error) => error.statusCode === 409);
  assert.deepEqual(fake.calls, ['POST']);
  await Model.deleteMany({});
  fake.emit = emit;
  const issued = await engine.emitSaleNfse(saleInput({ id: 'test-cancellation-lock' }));
  fake.events = async () => {
    await Model.updateOne({ _id: issued.documents[0].id }, { $set: { lockToken: 'another-process' } });
    return { eventos: [] };
  };
  let cancelled = false;
  fake.cancel = async () => { cancelled = true; };
  await assert.rejects(engine.cancelDocument({ documentId: issued.documents[0].id, reasonCode: '2', reason: 'Serviço não prestado ao cliente' }), (error) => error.statusCode === 409);
  assert.equal(cancelled, false);
});

test('timeout após autorização recupera pela DPS antes de qualquer retransmissão', async () => {
  const emit = fake.emit.bind(fake); fake.emit = async (...args) => { await emit(...args); throw new NfseApiError('timeout', { uncertain: true }); };
  const first = await engine.emitSaleNfse(saleInput()); assert.equal(first.nfseStatus, 'unknown');
  const second = await engine.emitSaleNfse(saleInput()); assert.equal(second.nfseStatus, 'authorized');
  assert.deepEqual(fake.calls, ['POST', 'GET DPS', 'GET NFSE']); assert.equal(sequence, 1);
});

test('consulta DPS indisponível nunca permite novo POST', async () => {
  fake.emit = async () => { fake.calls.push('POST'); throw new NfseApiError('timeout', { uncertain: true }); };
  await engine.emitSaleNfse(saleInput());
  fake.queryDps = async () => { fake.calls.push('GET DPS'); throw new NfseApiError('indisponível', { statusCode: 503, uncertain: true }); };
  const result = await engine.emitSaleNfse(saleInput()); assert.equal(result.nfseStatus, 'unknown'); assert.deepEqual(fake.calls, ['POST', 'GET DPS']);
});

test('rejeição fiscal preserva XML e gera revisão rastreável após correção', async () => {
  const emit = fake.emit.bind(fake);
  fake.emit = async () => { fake.calls.push('POST rejeitado'); throw new NfseApiError('Código municipal inválido', { statusCode: 400, codes: ['E0314'] }); };
  const first = await engine.emitSaleNfse(saleInput()); assert.equal(first.nfseStatus, 'rejected');
  services[0].fiscalPorEmpresa[STORE_ID].descricao = 'Descrição fiscal corrigida'; fake.emit = emit;
  const second = await engine.emitSaleNfse(saleInput()); assert.equal(second.nfseStatus, 'authorized'); assert.notEqual(first.documents[0].dpsId, second.documents[0].dpsId);
  const old = await Model.findById(first.documents[0].id).select('+dpsXml').lean(); assert.equal(old.status, 'superseded'); assert.match(old.dpsXml, /Banho &amp; secagem/);
  assert.equal((await engine.listSaleNfse(saleInput())).documents.length, 1);
});

test('alteração de venda já autorizada é bloqueada sem duplicar nota', async () => {
  await engine.emitSaleNfse(saleInput());
  const input = saleInput({ total: 190 }); input.sale.items[1].unitValue = 90; input.sale.items[1].totalValue = 90;
  await assert.rejects(engine.emitSaleNfse(input), /dados da venda/); assert.deepEqual(fake.calls, ['POST']);
});

test('desconto e acréscimo são rateados nos mesmos centavos da NFC-e', async () => {
  const input = saleInput({ discountValue: 18, additionValue: 9, total: 171 });
  const result = await engine.emitSaleNfse(input); assert.equal(result.documents[0].total, 76);
  assert.match(result.documents[0].xmlContent, /<vServ>84.00<\/vServ>/); assert.match(result.documents[0].xmlContent, /<vDescIncond>8.00<\/vDescIncond>/);
});

test('snapshot legado usa os mesmos aliases e prioridade de descontos da NFC-e', async () => {
  const input = saleInput({ total: 171, discountValue: 0, receiptSnapshot: { totais: { descontoValor: 18, acrescimoValor: 9 } } });
  const result = await engine.emitSaleNfse(input); assert.equal(result.documents[0].total, 76);
  const rounded = await engine.previewSaleNfse(saleInput({ discountValue: 10, total: 170 })); assert.equal(rounded.serviceTotal, 75.56); assert.equal(rounded.ready, true);
});

test('404 genérico não comprova ausência da DPS e bloqueia retransmissão', async () => {
  fake.emit = async () => { fake.calls.push('POST'); throw new NfseApiError('timeout', { uncertain: true }); };
  await engine.emitSaleNfse(saleInput());
  fake.queryDps = async () => { fake.calls.push('GET DPS'); throw new NfseApiError('rota inexistente', { statusCode: 404 }); };
  const result = await engine.emitSaleNfse(saleInput()); assert.equal(result.nfseStatus, 'unknown'); assert.deepEqual(fake.calls, ['POST', 'GET DPS']);
});

test('datas inexistentes não passam na prévia', async () => {
  const preview = await engine.previewSaleNfse(saleInput({ serviceDate: '2026-02-31' })); assert.equal(preview.ready, false); assert.match(preview.issues.join(), /data válida/);
  assert.equal(_test.literalDate('2024-02-29'), '2024-02-29'); assert.equal(_test.literalDate('2025-02-29'), '');
});

test('o próprio emitente não pode ser identificado como tomador do serviço', async () => {
  const input = saleInput({ customerDocument: store.cnpj, customerName: store.razaoSocial });
  const preview = await engine.previewSaleNfse(input); assert.equal(preview.ready, false); assert.match(preview.issues.join('; '), /E0202/);
  await assert.rejects(engine.emitSaleNfse(input), /E0202/); assert.equal(sequence, 0); assert.deepEqual(fake.calls, []);
});

test('colisão com DPS existente de outro conteúdo é bloqueada', async () => {
  fake.emit = async (env, xml) => ({ nfseXmlGZipB64: compressXml(authorized(xml.replace('Banho &amp; secagem', 'Outro serviço'))) });
  const result = await engine.emitSaleNfse(saleInput()); assert.equal(result.nfseStatus, 'unknown'); assert.match(result.documents[0].error, /conteúdo da DPS/);
});

test('cancelamento externo é recuperado pela consulta de eventos', async () => {
  const emitted = await engine.emitSaleNfse(saleInput());
  const event = `<evento xmlns="http://www.sped.fazenda.gov.br/nfse"><infEvento><dhProc>2026-09-23T15:05:00+00:00</dhProc><pedRegEvento><infPedReg><tpAmb>2</tpAmb><chNFSe>${KEY}</chNFSe><e101101><xDesc>Cancelamento de NFS-e</xDesc></e101101></infPedReg></pedRegEvento></infEvento></evento>`;
  fake.events = async () => ({ eventos: [{ eventoXmlGZipB64: compressXml(event) }] });
  const consulted = await engine.consultDocument(emitted.documents[0].id); assert.equal(consulted.status, 'cancelled');
  assert.equal(_test.findCancellationEvent({ eventoXmlGZipB64: compressXml(event) }, KEY, 'producao'), null);
});

test('cancelamento com resposta perdida é recuperado antes de outro pedido', async () => {
  const emitted = await engine.emitSaleNfse(saleInput()); let event; let postCount = 0;
  fake.cancel = async (env, accessKey, xml) => { postCount += 1; event = `<evento xmlns="http://www.sped.fazenda.gov.br/nfse"><infEvento><dhProc>2026-09-23T15:05:00+00:00</dhProc>${xml.replace(/<\?xml[^>]*>/, '')}</infEvento></evento>`; throw new NfseApiError('timeout', { uncertain: true }); };
  fake.events = async () => ({ eventos: event ? [{ eventoXmlGZipB64: compressXml(event) }] : [] });
  const request = { documentId: emitted.documents[0].id, reasonCode: '2', reason: 'Serviço não foi prestado ao cliente' };
  await assert.rejects(engine.cancelDocument(request), /timeout/);
  const recovered = await engine.cancelDocument(request); assert.equal(recovered.status, 'cancelled'); assert.equal(postCount, 1);
  assert.equal((await engine.consultDocument(emitted.documents[0].id)).status, 'cancelled');
});

test('produtos sem serviços dispensam NFS-e', async () => {
  const input = saleInput(); input.sale.items.pop(); const result = await engine.emitSaleNfse(input);
  assert.equal(result.nfseStatus, 'not_applicable'); assert.equal(sequence, 0); assert.deepEqual(fake.calls, []);
});

test('consulta de venda cobrada sem DPS ainda não é dispensa fiscal', async () => {
  const input = saleInput();
  assert.equal((await engine.listSaleNfse(input)).nfseStatus, 'not_requested');
  assert.equal((await engine.listSaleNfse({ ...input, sale: input.sale.id })).nfseStatus, 'not_requested');
  assert.equal((await engine.emitSaleNfse(input)).nfseStatus, 'authorized');
  const products = saleInput({ id: 'only-products' }); products.sale.items.pop();
  assert.equal((await engine.listSaleNfse(products)).nfseStatus, 'not_applicable');
});

test('venda web mista usa total canônico e aceita recibo com moeda formatada sem alterar centavos', async () => {
  const input = saleInput({ totalLiquido: 180, receiptSnapshot: { totais: { liquido: 'R$ 180,00', descontoValor: 0, acrescimoValor: 0 } } });
  assert.equal((await engine.previewSaleNfse(input)).ready, true);
  assert.equal((await engine.emitSaleNfse(input)).documents[0].total, 80);
  delete input.sale.totalLiquido; delete input.sale.total;
  assert.equal((await engine.previewSaleNfse(input)).ready, true);
  input.sale.receiptSnapshot.totais.liquido = 'R$ 179,99';
  const invalid = await engine.previewSaleNfse(input); assert.equal(invalid.ready, false); assert.match(invalid.issues.join(), /total da venda/);
  const free = saleInput({ totalLiquido: 0, total: 0, items: [{ serviceId: SERVICE_ID, itemType: 'servico', quantity: 1, unitValue: 0, totalValue: 0 }], receiptSnapshot: { totais: { liquido: 'R$ 0,00' } } });
  assert.equal((await engine.previewSaleNfse(free)).ready, true);
});

test('fixture capturada do getSaleReceiptSnapshot real no navegador autoriza somente os serviços', async () => {
  const sale = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/nfse/web-sale.json'), 'utf8'));
  sale.items[1].serviceId = SERVICE_ID; sale.items[1].id = SERVICE_ID;
  sale.nfseCustomerIdentification = 'not_informed';
  const original = clone(sale);
  const input = { ...saleInput(), sale };
  const preview = await engine.previewSaleNfse(input);
  assert.equal(preview.ready, true, preview.issues.join('; ')); assert.equal(preview.serviceTotal, 80);
  const emitted = await engine.emitSaleNfse(input);
  assert.equal(emitted.nfseStatus, 'authorized'); assert.equal(emitted.documents[0].total, 80);
  assert.doesNotMatch(emitted.documents[0].xmlContent, /Produto de teste/);
  assert.deepEqual(sale, original); assert.equal(sale.fiscalStatus, 'emitted'); assert.equal(sale.total, 180);
});

test('tomador não informado exige escolha explícita, omite XML fiscal e preserva cliente comercial', async () => {
  const input = saleInput({ customerDocument: '', nfseCustomerIdentification: 'not_informed' });
  const original = clone(input.sale);
  assert.equal((await engine.previewSaleNfse(input)).ready, true);
  const document = (await engine.emitSaleNfse(input)).documents[0];
  assert.equal(document.status, 'authorized'); assert.doesNotMatch(document.xmlContent, /<toma>/);
  assert.deepEqual(clone(input.sale), original);
  assert.equal((await engine.emitSaleNfse(input)).documents[0].id, document.id);
  assert.equal((await engine.previewSaleNfse(saleInput({ customerDocument: '' }))).ready, false);
  if (process.platform === 'win32') {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'nfse-anonymous-')); const xmlPath = path.join(folder, 'dps.xml');
    const saved = await Model.findById(document.id).select('+dpsXml').lean(); fs.writeFileSync(xmlPath, saved.dpsXml);
    try { assert.match(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', path.join(__dirname, 'fixtures/nfse/validate-xsd.ps1'), '-XmlPath', xmlPath, '-SchemaPath', path.join(__dirname, 'fixtures/nfse/xsd/DPS_v1.01.xsd')], { encoding: 'utf8' }), /XSD OK/); } finally { fs.rmSync(folder, { recursive: true, force: true }); }
  }
});

test('tomador não informado é recusado para incidência não confirmada, retenção e operação IBS que exige tomador', async () => {
  const original = clone(rules[0].fiscal.nfse);
  const input = saleInput({ nfseCustomerIdentification: 'not_informed' });
  for (const patch of [{ codigoTributacaoNacional: '170501' }, { tipoRetencaoIss: '2', aliquotaIss: 2 }, { tributacaoIss: '4' }, { codigoNbs: '114056000', ibsCbs: { enabled: true, finNFSe: '0', indFinal: '1', cIndOp: '050102', indDest: '0', CST: '000', cClassTrib: '000001' } }]) {
    rules[0].fiscal.nfse = { ...clone(original), ...patch };
    const preview = await engine.previewSaleNfse(input); assert.equal(preview.ready, false); assert.match(preview.issues.join(), /exige tomador identificado/);
  }
  rules[0].fiscal.nfse.ibsCbs.cIndOp = '050101';
  assert.equal((await engine.previewSaleNfse(input)).ready, true);
});

test('tributos aproximados são congelados, arredondados e expõem fonte sem dados privados', async () => {
  store.nfse.opSimpNac = '1';
  rules[0].fiscal.nfse = { ...rules[0].fiscal.nfse, totalTributosModo: 'percentual', pTotTribFed: 13.45, pTotTribEst: 0, pTotTribMun: 2.36, tributosFonte: 'IBPT', tributosVersao: '26.2.A', tributosCodigoReferencia: 'A906AF', tributosVigenciaInicio: '2026-08-20', tributosVigenciaFim: '2026-09-30' };
  const input = saleInput({ discountValue: 10, total: 170 });
  const document = (await engine.emitSaleNfse(input)).documents[0];
  assert.equal(document.total, 75.56);
  assert.deepEqual(document.approximateTaxes, { mode: 'percentual', federal: 10.16, state: 0, municipal: 1.78, total: 11.94, source: 'IBPT', version: '26.2.A', referenceCode: 'A906AF', validFrom: '2026-08-20', validUntil: '2026-09-30' });
  assert.match(document.xmlContent, /fonte IBPT; versão 26.2.A; referência A906AF/);
  rules[0].fiscal.nfse.pTotTribFed = 99; rules[0].fiscal.nfse.tributosVersao = 'NOVA';
  assert.deepEqual((await engine.listSaleNfse(input)).documents[0].approximateTaxes, document.approximateTaxes);
});

test('vigência de tributos usa data da emissão e bloqueia tabela vencida ou futura', async () => {
  for (const [start, end] of [['2026-08-01', '2026-09-22'], ['2026-09-24', '2026-10-30']]) {
    Object.assign(rules[0].fiscal.nfse, { tributosVigenciaInicio: start, tributosVigenciaFim: end });
    const preview = await engine.previewSaleNfse(saleInput({ createdAt: '2026-08-15' }));
    assert.equal(preview.ready, false); assert.match(preview.issues.join(), /vigente na data da emissão/);
  }
  assert.deepEqual(fake.calls, []); assert.equal(sequence, 0);
});

test('serviço gratuito acompanha o serviço cobrado sem aumentar base nem exigir regra para o gratuito', async () => {
  const input = saleInput();
  input.sale.items.push({ serviceId: SERVICE2_ID, itemType: 'servico', quantity: 1, unitValue: 0, totalValue: 0, product: 'Revisão sem cobrança', appointmentId: 'old-free-appointment' });
  const beforeSale = clone(input.sale);
  const preview = await engine.previewSaleNfse(input);
  assert.equal(preview.ready, true, preview.issues.join('; ')); assert.equal(preview.documentCount, 1); assert.equal(preview.freeServiceCount, 1); assert.equal(preview.serviceTotal, 80);
  const result = await engine.emitSaleNfse(input);
  assert.equal(result.nfseStatus, 'authorized'); assert.equal(result.documents[0].total, 80);
  assert.match(result.documents[0].xmlContent, /Itens gratuitos da venda, sem compor o valor desta NFS-e: Revisão sem cobrança/);
  assert.match(result.documents[0].xmlContent, /<vServ>80.00<\/vServ>/);
  assert.deepEqual(clone(input.sale), beforeSale);
});

test('somente serviços gratuitos dispensa DPS, tomador fiscal e certificado; mensagem persiste na consulta', async () => {
  const input = saleInput({ total: 0, customerName: '', customerDocument: '', items: [{ serviceId: SERVICE2_ID, itemType: 'servico', quantity: 1, unitValue: 0, totalValue: 0, product: 'Retirada de ponto' }] });
  engine = createNfseService({ ...engineOptions, certificateLoader: async () => { throw new Error('Não carregar certificado para documento dispensado'); } });
  const preview = await engine.previewSaleNfse(input);
  assert.equal(preview.ready, true); assert.equal(preview.documentCount, 0); assert.equal(preview.freeServiceCount, 1); assert.match(preview.warning, /gratuitos/);
  for (const result of [await engine.emitSaleNfse(input), await engine.listSaleNfse(input)]) {
    assert.equal(result.nfseStatus, 'not_applicable'); assert.deepEqual(result.documents, []); assert.equal(result.freeServiceCount, 1); assert.match(result.warning, /gratuitos/);
  }
  assert.equal(sequence, 0); assert.equal(await Model.countDocuments(), 0); assert.deepEqual(fake.calls, []);
});

test('valor ausente ou inválido não é convertido em serviço gratuito', async () => {
  for (const money of [{}, { unitValue: 'inválido', totalValue: 0 }, { unitValue: -10, totalValue: -10 }, { unitValue: 0, totalValue: 'inválido' }, { unitValue: 0, totalValue: '' }, { unitValue: false, totalValue: 0 }, { unitValue: 0, totalValue: 0, itemDiscountValue: -1 }, { unitValue: 0, totalValue: 0, additionValue: 'inválido' }, { unitValue: 0, totalValue: 0, quantity: true }, { unitValue: 0, totalValue: 0, baseUnitPrice: 100 }, { valor: 0, subtotal: 0, valorSemAjuste: 100 }]) {
    const input = saleInput({ total: 0, items: [{ serviceId: SERVICE_ID, itemType: 'servico', quantity: 1, ...money, product: 'Serviço sem valor válido' }] });
    const preview = await engine.previewSaleNfse(input); assert.equal(preview.ready, false); assert.equal(preview.freeServiceCount, 0);
  }
  assert.equal(sequence, 0); assert.deepEqual(fake.calls, []);
});

test('alterar serviço já emitido para gratuito não apaga a emissão histórica', async () => {
  const input = saleInput(); const first = await engine.emitSaleNfse(input);
  input.sale.items[1].unitValue = 0; input.sale.items[1].totalValue = 0; input.sale.total = 100;
  await assert.rejects(engine.emitSaleNfse(input), /Já existe uma DPS/);
  const listed = await engine.listSaleNfse(input); assert.equal(listed.nfseStatus, 'authorized'); assert.equal(listed.documents[0].id, first.documents[0].id);
});

test('cadastros incompletos e agregados da Agenda bloqueiam antes de reservar numeração', async () => {
  services[0].fiscalPorEmpresa = {};
  let preview = await engine.previewSaleNfse(saleInput()); assert.equal(preview.ready, false); assert.match(preview.issues.join(), /regra fiscal/);
  const input = saleInput({ customerDocument: '' }); input.sale.items[1].serviceId = 'atendimento-nao-e-servico';
  preview = await engine.previewSaleNfse(input); assert.match(preview.issues.join(), /CPF ou CNPJ/); assert.match(preview.issues.join(), /serviço cadastrado/);
  await assert.rejects(engine.emitSaleNfse(input), NfseValidationError); assert.equal(sequence, 0);
});

test('classificações diferentes geram documentos separados; iguais são agrupadas', async () => {
  services.push({ _id: SERVICE2_ID, nome: 'Consulta', fiscalPorEmpresa: { [STORE_ID]: { fiscalRuleCode: '1' } } });
  const input = saleInput({ total: 200 }); input.sale.items.push({ serviceId: SERVICE2_ID, itemType: 'servico', quantity: 1, unitPrice: 20, total: 20 });
  let preview = await engine.previewSaleNfse(input); assert.equal(preview.documentCount, 1); assert.equal(preview.serviceTotal, 100);
  rules.push({ ...clone(rules[0]), code: 2, fiscal: { nfse: { ...rules[0].fiscal.nfse, codigoTributacaoNacional: '050101' } } }); services[1].fiscalPorEmpresa[STORE_ID].fiscalRuleCode = '2';
  preview = await engine.previewSaleNfse(input); assert.equal(preview.documentCount, 2);
});

test('correção após rejeição pode mudar o agrupamento sem perder o histórico', async () => {
  services.push({ _id: SERVICE2_ID, nome: 'Consulta', fiscalPorEmpresa: { [STORE_ID]: { fiscalRuleCode: '1' } } });
  const input = saleInput({ total: 200 }); input.sale.items.push({ serviceId: SERVICE2_ID, itemType: 'servico', quantity: 1, unitPrice: 20, total: 20 });
  const emit = fake.emit.bind(fake); fake.emit = async () => { throw new NfseApiError('Regra inválida', { statusCode: 400, codes: ['E0314'] }); };
  const rejected = await engine.emitSaleNfse(input); assert.equal(rejected.documents.length, 1); assert.equal(rejected.nfseStatus, 'rejected');
  rules.push({ ...clone(rules[0]), code: 2, fiscal: { nfse: { ...rules[0].fiscal.nfse, codigoTributacaoNacional: '050101' } } }); services[1].fiscalPorEmpresa[STORE_ID].fiscalRuleCode = '2'; fake.emit = emit;
  const corrected = await engine.emitSaleNfse(input); assert.equal(corrected.nfseStatus, 'authorized'); assert.equal(corrected.documents.length, 2);
  assert.equal(await Model.countDocuments({ status: 'superseded' }), 1); assert.equal(await Model.countDocuments(), 3);
});

test('representações de itens web e desktop produzem o mesmo total', () => {
  const web = _test.projectItems(saleInput().sale);
  const desktop = _test.projectItems({ ...saleInput().sale, items: [{ itemType: 'produto', quantity: 1, unitPrice: 100, total: 100 }, { itemType: 'servico', serviceId: SERVICE_ID, quantity: 1, unitPrice: 80, total: 80 }] });
  assert.deepEqual(web.map((i) => i.netTotal), desktop.map((i) => i.netTotal)); assert.equal(web[1].serviceId, SERVICE_ID);
});

test('snapshot e XML da DPS são imutáveis no banco', async () => {
  const result = await engine.emitSaleNfse(saleInput()); const identifier = result.documents[0].id;
  await Model.updateOne({ _id: identifier }, { $set: { dpsXml: '<alterado/>', snapshot: { alterado: true }, total: 0 } });
  const persisted = await Model.findById(identifier).select('+dpsXml').lean(); assert.match(persisted.dpsXml, /<DPS /); assert.equal(persisted.snapshot.customer.document, '52998224725'); assert.equal(persisted.total, 80);
});

test('DPS assinada usa Id oficial, assinatura verificável e XSD v1.01', async (t) => {
  await engine.emitSaleNfse(saleInput());
  const document = await Model.findOne().select('+dpsXml').lean(); const xml = document.dpsXml;
  assert.equal(document.dpsId.length, 45); assert.match(document.dpsId, /^DPS33045572/);
  const parsed = parseXml(xml); const signature = xpath.select1("//*[local-name()='Signature']", parsed);
  const verifier = new SignedXml({ publicCert: pair.certificatePem, getCertFromKeyInfo: () => null }); verifier.loadSignature(signature); assert.equal(verifier.checkSignature(xml), true);
  if (process.platform !== 'win32') return t.diagnostic('XSD .NET executado somente no Windows; assinatura validada em todas as plataformas.');
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'nfse-xsd-')); const xmlPath = path.join(folder, 'dps.xml'); fs.writeFileSync(xmlPath, xml);
  try { const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', path.join(__dirname, 'fixtures/nfse/validate-xsd.ps1'), '-XmlPath', xmlPath, '-SchemaPath', path.join(__dirname, 'fixtures/nfse/xsd/DPS_v1.01.xsd')], { encoding: 'utf8' }); assert.match(out, /XSD OK/); } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});

test('IBS/CBS é emitido com NBS e validado no XSD atual sem inventar classificação', async () => {
  rules[0].fiscal.nfse.codigoNbs = '123456789'; rules[0].fiscal.nfse.ibsCbs = { enabled: true, finNFSe: '0', cIndOp: '010101', indFinal: '1', indDest: '0', CST: '000', cClassTrib: '000001' };
  const result = await engine.emitSaleNfse(saleInput()); assert.match(result.documents[0].xmlContent, /<IBSCBS>/); assert.match(result.documents[0].xmlContent, /<cNBS>123456789/);
  const doc = await Model.findOne().select('+dpsXml').lean();
  if (process.platform === 'win32') {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'nfse-ibs-xsd-')); const xmlPath = path.join(folder, 'dps.xml'); fs.writeFileSync(xmlPath, doc.dpsXml);
    try { assert.match(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', path.join(__dirname, 'fixtures/nfse/validate-xsd.ps1'), '-XmlPath', xmlPath, '-SchemaPath', path.join(__dirname, 'fixtures/nfse/xsd/DPS_v1.01.xsd')], { encoding: 'utf8' }), /XSD OK/); } finally { fs.rmSync(folder, { recursive: true, force: true }); }
  }
});

test('resposta de outra DPS, outro ambiente e XML com entidades nunca autoriza', () => {
  const xml = '<NFSe><infNFSe Id="NFS' + KEY + '"><nNFSe>1</nNFSe><cStat>100</cStat><DPS><infDPS Id="DPS000"><tpAmb>2</tpAmb></infDPS></DPS></infNFSe></NFSe>';
  assert.throws(() => parseAuthorizedXml(xml, { dpsId: 'DPS999' }), /outra DPS/);
  assert.throws(() => parseAuthorizedXml(xml, { environment: 'producao' }), /outro ambiente/);
  assert.throws(() => parseXml('<!DOCTYPE x [<!ENTITY y SYSTEM "file:///secret">]><x>&y;</x>'), /não permitida/);
});

test('evento de cancelamento respeita XSD oficial e exige motivo explícito', () => {
  assert.throws(() => buildCancellationXml({ accessKey: KEY, environment: 'homologacao', cnpj: store.cnpj, reason: 'Serviço não prestado ao cliente', issuedAt: date }), /motivo/);
  const xml = signXml(buildCancellationXml({ accessKey: KEY, environment: 'homologacao', cnpj: store.cnpj, reasonCode: '2', reason: 'Serviço não prestado ao cliente', issuedAt: date }), pair, 'infPedReg');
  if (process.platform === 'win32') {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'nfse-event-xsd-')); const xmlPath = path.join(folder, 'event.xml'); fs.writeFileSync(xmlPath, xml);
    try { assert.match(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', path.join(__dirname, 'fixtures/nfse/validate-xsd.ps1'), '-XmlPath', xmlPath, '-SchemaPath', path.join(__dirname, 'fixtures/nfse/xsd/pedRegEvento_v1.01.xsd')], { encoding: 'utf8' }), /XSD OK/); } finally { fs.rmSync(folder, { recursive: true, force: true }); }
  }
});

test('transporte HTTPS real de teste exige certificado cliente, gzip/base64 e não usa endpoint externo', async () => {
  let received; let clientAuthorized = false;
  const server = https.createServer({ key: pair.privateKeyPem, cert: pair.certificatePem, ca: pair.certificatePem, requestCert: true, rejectUnauthorized: true }, (req, res) => {
    clientAuthorized = req.socket.authorized; const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk)); req.on('end', () => { received = JSON.parse(Buffer.concat(chunks)); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ nfseXmlGZipB64: compressXml('<NFSe>teste</NFSe>') })); });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const transport = createTransport(pair, { requestImpl: (url, options, callback) => { assert.equal(url.origin, new URL(ENDPOINTS.homologacao).origin); assert.equal(options.rejectUnauthorized, true); return https.request(new URL(`https://127.0.0.1:${server.address().port}/nfse`), { ...options, ca: pair.certificatePem }, callback); } });
  try { const response = await transport.emit('homologacao', '<DPS>teste</DPS>'); assert.equal(clientAuthorized, true); assert.equal(decompressXml(received.dpsXmlGZipB64), '<DPS>teste</DPS>'); assert.equal(decompressXml(response.nfseXmlGZipB64), '<NFSe>teste</NFSe>'); } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('parser de HTTP reconhece erro singular E2404 e consulta os endpoints oficiais de eventos', async () => {
  const seen = [];
  let eventError = false;
  const server = https.createServer({ key: pair.privateKeyPem, cert: pair.certificatePem }, (req, res) => {
    seen.push(req.url); res.statusCode = 404; res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ tipoAmbiente: 2, versaoAplicativo: 'SefinNacional_1.6.0', dataHoraProcessamento: '2026-09-23T15:00:00-03:00', ...(req.url.includes('/eventos/') ? (eventError ? { erro: { codigo: 'E9999', descricao: 'Erro de consulta, não ausência de evento' } } : {}) : { erro: { codigo: 'E2404', descricao: 'Não foi gerada uma NFS-e com o identificador de DPS informado' } }) }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const transport = createTransport(pair, { requestImpl: (url, options, callback) => https.request(new URL(`https://127.0.0.1:${server.address().port}${url.pathname}`), { ...options, ca: pair.certificatePem }, callback) });
  try {
    await assert.rejects(transport.queryDps('homologacao', 'DPS123'), (error) => error.statusCode === 404 && error.codes.includes('E2404'));
    await transport.events('homologacao', KEY);
    assert.ok(seen.some((value) => value.endsWith('/eventos/101101/1'))); assert.ok(seen.some((value) => value.endsWith('/eventos/305101/1')));
    assert.ok(seen.every((value) => value.startsWith('/SefinNacional/')));
    eventError = true;
    await assert.rejects(transport.events('homologacao', KEY), (error) => error.codes.includes('E9999'));
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('erro fiscal da consulta nunca transforma uma emissão incerta em rejeitada', async () => {
  fake.emit = async () => { throw new NfseApiError('timeout', { uncertain: true }); };
  await engine.emitSaleNfse(saleInput());
  fake.queryDps = async () => { throw new NfseApiError('Erro na consulta', { statusCode: 400, codes: ['E0001'] }); };
  const result = await engine.emitSaleNfse(saleInput()); assert.equal(result.nfseStatus, 'unknown');
});

test('prévia bloqueia divergência monetária e competência ausente de atendimento histórico', async () => {
  const wrongTotal = await engine.previewSaleNfse(saleInput({ total: 179.99 })); assert.equal(wrongTotal.ready, false); assert.match(wrongTotal.issues.join(), /total da venda/);
  const input = saleInput({ appointmentId: 'appointment-test' });
  let preview = await engine.previewSaleNfse(input); assert.equal(preview.ready, false); assert.match(preview.issues.join(), /data da prestação ausente/);
  input.sale.items[1].serviceDate = '2026-08-15'; preview = await engine.previewSaleNfse(input); assert.equal(preview.ready, true); assert.equal(preview.groups[0].competence, '2026-08-15');
});

test('resposta pública não inclui chave privada, senha, certificado cifrado, snapshot ou trava', () => {
  const data = publicDocument({ _id: SERVICE_ID, store: STORE_ID, pdv: PDV_ID, total: 80, dpsXml: 'SENSITIVE_DPS', snapshot: { issuer: { name: 'Emitente de teste', cnpj: '11.222.333/0001-81', certificatePassword: 'SECRET_PASSWORD' }, customer: { name: 'SECRET_CUSTOMER' } }, privateKeyPem: 'SECRET_PRIVATE_KEY', certificadoArquivoCriptografado: 'SECRET_CIPHER', lockToken: 'SECRET_LOCK' });
  const json = JSON.stringify(data); assert.doesNotMatch(json, /SECRET_|SENSITIVE_DPS|snapshot|lockToken|privateKey/);
  assert.equal(data.issuerName, 'Emitente de teste'); assert.equal(data.issuerCnpj, '11222333000181');
});

test('nome do emitente no XML oficial prevalece sobre cadastro antigo sem alterar snapshot', async () => {
  const baseEmit = fake.emit.bind(fake);
  fake.emit = async (...args) => {
    const response = await baseEmit(...args);
    const xml = decompressXml(response.nfseXmlGZipB64).replace('<nNFSe>', '<emit><CNPJ>11222333000181</CNPJ><xNome>Nome registrado no documento autorizado</xNome></emit><nNFSe>');
    return { nfseXmlGZipB64: compressXml(xml) };
  };
  const input = saleInput(); const issued = (await engine.emitSaleNfse(input)).documents[0];
  assert.equal(issued.issuerName, 'Nome registrado no documento autorizado');
  assert.equal((await Model.findById(issued.id).lean()).snapshot.issuer.name, store.razaoSocial);
  assert.equal((await engine.listSaleNfse(input)).documents[0].issuerName, issued.issuerName);
  assert.throws(() => parseAuthorizedXml(issued.xmlContent.replace('<emit><CNPJ>11222333000181', '<emit><CNPJ>00000000000000')), /emitente da NFS-e difere/);
});

test('API central exige autenticação e limita documentos à empresa autorizada', async () => {
  const express = require('express'); const supertest = require('supertest'); const jwt = require('jsonwebtoken'); const User = require('../../models/User');
  process.env.JWT_SECRET = 'isolated-nfse-route-tests-only';
  const document = (await engine.emitSaleNfse(saleInput())).documents[0];
  const user = await User.create({ tipoConta: 'pessoa_fisica', email: 'nfse-route-test@example.invalid', senha: 'not-a-real-password', celular: '21900000001', role: 'funcionario', empresas: [STORE_ID] });
  const outsider = await User.create({ tipoConta: 'pessoa_fisica', email: 'nfse-outsider-test@example.invalid', senha: 'not-a-real-password', celular: '21900000002', role: 'funcionario', empresas: ['640000000000000000000099'] });
  const app = express(); app.use(express.json()); app.use('/nfse', require('../../routes/nfse'));
  await supertest(app).get('/nfse').expect(401);
  const token = jwt.sign({ id: String(user._id) }, process.env.JWT_SECRET); const otherToken = jwt.sign({ id: String(outsider._id) }, process.env.JWT_SECRET);
  const listed = await supertest(app).get('/nfse?environment=homologacao').set('Authorization', `Bearer ${token}`).expect(200); assert.equal(listed.body.documents.length, 1); assert.equal(listed.body.documents[0].xmlContent, '');
  assert.equal(listed.body.documents[0].issuerName, store.razaoSocial); assert.equal(listed.body.documents[0].issuerCnpj, store.cnpj);
  assert.equal(listed.body.documents[0].snapshot, undefined);
  const detail = await supertest(app).get(`/nfse/${document.id}`).set('Authorization', `Bearer ${token}`).expect(200);
  assert.equal(detail.body.document.issuerName, store.razaoSocial); assert.equal(detail.body.document.issuerCnpj, store.cnpj);
  await supertest(app).get(`/nfse/${document.id}`).set('Authorization', `Bearer ${otherToken}`).expect(403);
  const empty = await supertest(app).get('/nfse').set('Authorization', `Bearer ${otherToken}`).expect(200); assert.equal(empty.body.documents.length, 0);
  await supertest(app).post(`/nfse/${document.id}/cancel`).set('Authorization', `Bearer ${token}`).send({ reasonCode: '2', reason: 'Serviço não foi prestado ao cliente' }).expect(403);
  const production = await supertest(app).get('/nfse?environment=producao').set('Authorization', `Bearer ${token}`).expect(200); assert.equal(production.body.documents.length, 0);
});

test('trava compartilhada impede cancelar comercialmente enquanto a emissão está ativa', async () => {
  const input = saleInput();
  await engine.withSaleFiscalLock({ pdv: input.pdv, sale: input.sale }, async () => {
    await assert.rejects(engine.emitSaleNfse(input), (error) => error.code === 'NFSE_SALE_BUSY' && error.statusCode === 409);
    await assert.rejects(engine.withSaleFiscalLock({ pdvId: PDV_ID, saleId: input.sale.id }, async () => {}), (error) => error.statusCode === 409);
  });
  assert.deepEqual(fake.calls, []);
  assert.equal((await engine.emitSaleNfse(input)).nfseStatus, 'authorized');
});

test('emissor recarrega a venda dentro da trava e bloqueia cancelamento posterior ao request', async () => {
  const input = saleInput(); let reloaded = false;
  engine = createNfseService({ ...engineOptions, reloadSale: async ({ sale }) => {
    const lock = await Model.SaleLock.findById(`${PDV_ID}:${sale.id}`).lean(); assert.ok(lock); reloaded = true;
    return { ...sale, status: 'cancelled' };
  } });
  await assert.rejects(engine.emitSaleNfse(input), /venda está cancelada/); assert.equal(reloaded, true); assert.equal(sequence, 0); assert.deepEqual(fake.calls, []);
});

test('estado canônico cancelado vence espelho atrasado, inclusive com updatedAt posterior do espelho', async () => {
  const input = saleInput();
  const state = { updatedAt: '2026-09-23T15:10:00Z', completedSales: [{ ...input.sale, status: 'cancelled' }] };
  const record = { saleId: input.sale.id, sourceUpdatedAt: '2026-09-23T15:00:00Z', updatedAt: '2026-09-23T15:20:00Z', payload: input.sale };
  const result = await _test.reloadCanonicalSale(input, { Sale: { findOne: () => query(record) }, State: { findOne: () => query(state) } }); assert.equal(result.status, 'cancelled');
});

test('trocar emitente atual não oculta histórico nem emite novamente a mesma venda', async () => {
  const input = saleInput(); const emitted = await engine.emitSaleNfse(input);
  const listed = await engine.listSaleNfse({ ...input, store: { _id: '640000000000000000000099' } }); assert.equal(listed.documents[0].id, emitted.documents[0].id);
});
