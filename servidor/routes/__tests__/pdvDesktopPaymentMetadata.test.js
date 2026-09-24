'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const paymentMetadata = require('../../utils/pdvPaymentMetadata');
const source = fs.readFileSync(path.join(__dirname, '../pdvDesktop.js'), 'utf8');
const { sefazFailureMetadata } = require('../../services/nfceEmitter');

test('catch fiscal mantém rejeição SEFAZ estruturada do XML pré-assinado ou reconstruído para desktop', () => {
  const route = fs.readFileSync(path.join(__dirname, '../pdvs.js'), 'utf8').replace(/\r\n/g, '\n');
  const start = route.indexOf('    const failureMetadata ='); const end = route.indexOf('\n  }\n};', start);
  for (const withXml of [false, true]) {
    const error = Object.assign(new Error('Rejeição 391'), { details: { protocolStatus: '391' }, ...(withXml ? { xmlContent: '<NFe>xml-assinado</NFe>' } : {}) });
    const captured = {}; const res = { status: code => { captured.status = code; return res; }, json: body => { captured.body = body; return res; } };
    const context = vm.createContext({ error, message: error.message, req: { desktopHost: { _id: 'host' } }, res, sefazFailureMetadata });
    vm.runInContext(`(()=>{${route.slice(start, end)}})()`, context);
    assert.equal(captured.status, 422); assert.equal(captured.body.sefazStatus, '391'); assert.equal(captured.body.retryable, false); assert.equal(captured.body.permanent, true);
    assert.equal(captured.body.xmlContent, undefined);
  }
});

test('materialização mantém dados de cartão e parcelas da transação sobre cadastro alterado', async () => {
  const start = source.indexOf('  const hydratePayments = async ('); const end = source.indexOf('  const hydrateSaleItems = async (', start);
  const context = vm.createContext({ paymentMetadata, host: { empresa: 'empresa' }, mongoose: { Types: { ObjectId: { isValid: () => true } } },
    PaymentMethod: { find: () => ({ lean: async () => [{ _id: 'card', name: 'Crédito atual', type: 'credito', installments: 12, fiscalCode: '03', card: { tpIntegra: 1, cAut: 'ATUAL' } }] }) } });
  vm.runInContext(`${source.slice(start, end)};this.hydrate=hydratePayments;`, context);
  const result = await context.hydrate([{ paymentMethodId: 'card', label: 'Crédito original', amount: 19.9, installments: 2, tPag: '04', card: { tpIntegra: 2, cAut: 'ORIGINAL' }, tenderedAmount: 19.9, change: 0 }]);
  const payment = result[0]; assert.equal(payment.label, 'Crédito original'); assert.equal(payment.parcelas, 2);
  assert.equal(payment.card.cAut, 'ORIGINAL'); assert.equal(payment.card.tpIntegra, 2); assert.equal(payment.fiscalCode, '04');
  assert.equal(payment.amount, 19.9); assert.equal(payment.valor, 19.9); assert.equal(payment.tenderedAmount, 19.9);
});

test('sale.completed e delivery.finalized guardam snapshot fiscal com pagamentos separados e troco líquido', async () => {
  const start = source.indexOf("  if (event.type === 'cash.opened')", source.indexOf('async function materializeDesktopEvent('));
  const end = source.indexOf('  await pdvDomain.enqueuePdvStateWrite(', start);
  for (const type of ['sale.completed', 'delivery.finalized']) {
    const input = { id: 'sale', orderId: 'order', saleCode: 'PDV001-000549', grossTotal: 349.9, netTotal: 349.9, change: 0.1,
      items: [{ productId: 'p', quantity: 1, unitPrice: 219.9 }, { serviceId: 's', itemType: 'service', quantity: 1, unitPrice: 130 }],
      payments: [{ id: 'cash', amount: 49.9, valor: 49.9, tenderedAmount: 50, change: 0.1, fiscalCode: '01' }, { id: 'pix', amount: 300, valor: 300, fiscalCode: '17', card: { tpIntegra: 2 } }] };
    const context = vm.createContext({ source: input, event: { type }, clean: value => String(value || '').trim(), hydratePayments: async value => value, hydrateSaleItems: async value => value });
    const payload = await vm.runInContext(`(async()=>{let action,payload;${source.slice(start, end)};return payload;})()`, context);
    const snapshot = payload.receiptSnapshot; assert.equal(snapshot.totais.totalLiquido, 349.9); assert.equal(snapshot.totais.trocoValor, 0.1);
    assert.equal(snapshot.pagamentos.items.length, 2); assert.equal(snapshot.pagamentos.items[0].amount, 49.9);
    assert.equal(snapshot.pagamentos.items[0].tenderedAmount, 50); assert.equal(snapshot.pagamentos.items[1].card.tpIntegra, 2);
    assert.equal(snapshot.items[1].serviceId, 's');
  }
});
