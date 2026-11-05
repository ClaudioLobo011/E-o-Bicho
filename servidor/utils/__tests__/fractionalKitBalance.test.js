const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateKitDepositBalances: calc } = require('../fractionalKitBalance');
const items = ['P', 'M', 'G'].map(produto => ({ produto, quantidadeOrigem: 1, quantidadeFracionada: 1 }));
const children = balances => new Map(Object.entries(balances).map(([id, deposits]) => [id, { estoques: Object.entries(deposits).map(([deposito, quantidade]) => ({ deposito, quantidade })) }]));
test('two kits are two of EACH size, not six kits', () => assert.equal(calc(items, children({ P: { A: 2 }, M: { A: 2 }, G: { A: 2 } })).get('A').quantidade, 2));
test('selling one P leaves one complete kit', () => assert.equal(calc(items, children({ P: { A: 1 }, M: { A: 2 }, G: { A: 2 } })).get('A').quantidade, 1));
test('missing or negative component means no complete kit', () => {
    assert.equal(calc(items, children({ P: { A: 2 }, M: { A: 2 } })).get('A').quantidade, 0);
    assert.equal(calc(items, children({ P: { A: -1 }, M: { A: 2 }, G: { A: 2 } })).get('A').quantidade, 0);
});
test('never combines components across deposits', () => {
    const result = calc(items, children({ P: { A: 2 }, M: { B: 2 }, G: { A: 2, B: 2 } }));
    assert.equal(result.get('A').quantidade, 0); assert.equal(result.get('B').quantidade, 0);
});
test('honors multiple units required and repeated component references', () => {
    const result = calc([...items, items[0]], children({ P: { A: 4 }, M: { A: 3 }, G: { A: 3 } }));
    assert.equal(result.get('A').quantidade, 2);
});
