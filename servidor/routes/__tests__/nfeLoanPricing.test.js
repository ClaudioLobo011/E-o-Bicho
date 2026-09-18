const test = require('node:test');
const assert = require('node:assert/strict');
const pricing = require('../../../scripts/core/nfe-loan-pricing');

test('emprestimo usa custo, conserva quantidades e recalcula totais', () => {
  const payload = { metadata: { natureza: 'Empréstimo' }, items: [{ code: '1', qty: '2,000', qtyTrib: '4,000', unit: '250,00', total: '500,00', baseIcms: '500,00' }], totals: { totalValue: 500, freight: 10 }, payments: { totalValue: '500,00' } };
  const result = pricing.pricePayload(payload, [100.25]);
  assert.equal(result.items[0].unit, '100,25');
  assert.equal(result.items[0].qty, '2,000');
  assert.equal(pricing.number(result.items[0].unitTrib), 50.125);
  assert.equal(result.items[0].baseIcms, '200,50');
  assert.equal(result.totals.totalValue, 210.5);
  assert.equal(result.payments.totalValue, '210,50');
  assert.equal(payload.items[0].unit, '250,00');
});
test('venda nao muda; finalidade emprestimo tambem aplica custo', () => {
  const sale = { metadata: { natureza: 'venda' }, items: [{ qty: 1, unit: 25 }] };
  assert.equal(pricing.pricePayload(sale, [10]), sale);
  assert.equal(pricing.pricePayload({ ...sale, metadata: { finalidade: 'emprestimo' } }, [10]).items[0].unit, '10,00');
});
test('custo ausente ou invalido bloqueia; zero explicito e custo localizado sao aceitos', () => {
  for (const cost of [null, undefined, '', '  ', NaN, -1, 'abc']) assert.throws(() => pricing.priceItem({ qty: 1 }, cost));
  assert.equal(pricing.priceItem({ qty: 1 }, 0).unit, '0,00');
  assert.equal(pricing.priceItem({ qty: 1 }, '1.234,56').unit, '1234,56');
});

test('servidor ignora preco enviado e exige correspondencia unica no cadastro', async () => {
  const Product = require('../../models/Product');
  const { applyLoanCostPricing } = require('../../utils/nfeLoanPricing');
  const originalFind = Product.find;
  const payload = { metadata: { natureza: 'emprestimo' }, items: [{ code: '5640', qty: '2', unit: '999,00' }], totals: {} };
  try {
    Product.find = (query) => {
      assert.deepEqual(query, { cod: '5640' });
      return { select() { return this; }, limit() { return this; }, async lean() { return [{ custo: 145.95 }]; } };
    };
    assert.equal((await applyLoanCostPricing(payload)).totals.totalValue, 291.9);
    Product.find = () => ({ select() { return this; }, limit() { return this; }, async lean() { return []; } });
    await assert.rejects(applyLoanCostPricing(payload), /nao encontrado/);
    await assert.rejects(applyLoanCostPricing({ ...payload, items: [{ ...payload.items[0], productId: 'invalido' }] }), /Identificador/);
  } finally { Product.find = originalFind; }
});
test('fracionamento tributavel e repeticao conservam os valores', () => {
  const item = { qty: '3,000', qtyTrib: '10,000', total: '90,00', baseIcms: '45,00', icms: '12,00' };
  const once = pricing.priceItem(item, 20);
  assert.equal(once.unitTrib, '6,0000000000');
  assert.equal(once.baseIcms, '30,00');
  assert.equal(once.valorIcms, '3,60');
  assert.deepEqual(pricing.priceItem(once, 20), once);
});
