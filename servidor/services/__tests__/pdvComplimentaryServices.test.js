const test = require('node:test');
const assert = require('node:assert/strict');
const { isComplimentaryServiceItem, isComplimentaryServiceSale } = require('../../utils/pdvComplimentaryServices');

const service = { serviceId: 'servico', itemType: 'servico', quantidade: 1, valor: 0, subtotal: 0 };
const sale = (items) => ({ items, totalBruto: 0, totalLiquido: 0 });

test('gratuidade exige serviço e valores zero explícitos, preservando aliases web e desktop', () => {
  assert.equal(isComplimentaryServiceSale(sale([service])), true);
  assert.equal(isComplimentaryServiceSale(sale([{ itemType: 'service', quantity: 2, unitPrice: 0 }])), true);
  assert.equal(isComplimentaryServiceItem({ tipoItem: 'serviço', qtd: 1, total: 0 }), true);
  assert.equal(isComplimentaryServiceSale(sale([])), false);
  assert.equal(isComplimentaryServiceSale(sale([{ itemType: 'produto', quantidade: 1, valor: 0 }])), false);
  assert.equal(isComplimentaryServiceSale(sale([service, { itemType: 'produto', quantidade: 1, valor: 10 }])), false);
});

test('desconto integral, preço negativo/ausente e acréscimos não são gratuidade', () => {
  for (const invalid of [
    { ...service, valor: -1 }, { ...service, subtotal: -1 }, { ...service, quantidade: 0 },
    { ...service, valor: '' }, { ...service, valor: false }, { ...service, valor: [0] }, { ...service, valor: 'inválido' }, { serviceId: 's', quantidade: 1 },
    { ...service, valor: 20, itemDiscountValue: 20 },
    { ...service, valorSemAjuste: 20, itemDiscountValue: 20 },
    { ...service, itemAdditionValue: 1 }, { ...service, itemDiscountValue: -1 },
  ]) assert.equal(isComplimentaryServiceItem(invalid), false, JSON.stringify(invalid));
  for (const extra of [{ totalBruto: -1 }, { totalLiquido: -1 }, { totalLiquido: '' }, { totalLiquido: undefined }, { discountValue: 1 }, { additionValue: 1 }]) {
    assert.equal(isComplimentaryServiceSale({ ...sale([service]), ...extra }), false, JSON.stringify(extra));
  }
});
