const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { prepareKit, kitFormula, kitPieces, stockProjection, kitIssues, prepareScan, prepareImport, csvCell } = require('../admin-compras-romaneios.js');
const component = (label, quantityPerKit = 1, fields = {}) => ({ id: randomUUID(), label, quantityPerKit, productId: label, productName: `Cama ${label}`, barcode: `00${label}`, ...fields });
const line = (components, receivedQuantity = 2) => ({ id: randomUUID(), description: 'Kit de camas', expectedQuantity: 2, receivedQuantity, unit: 'KT', unitCost: 219.99, stockFactor: 1, kit: prepareKit(components) });

test('um kit P M G gera uma unidade de cada tamanho por kit recebido', () => {
  const row = line(['P', 'M', 'G'].map(label => component(label)));
  assert.equal(kitFormula(row), '1 P + 1 M + 1 G');
  assert.equal(kitPieces(row), 3);
  assert.deepEqual(stockProjection(row).map(part => [part.productName, part.quantity]), [['Cama P', 2], ['Cama M', 2], ['Cama G', 2]]);
  assert.deepEqual(kitIssues(row), []);
});
test('3 P, 4 G e tamanhos numéricos têm quantidades independentes por tipo', () => {
  const row = line([component('P', 3), component('G', 4), component('Tam 1', 2), component('Tam 2')], 3);
  assert.equal(kitPieces(row), 10);
  assert.deepEqual(stockProjection(row).map(part => part.quantity), [9, 12, 6, 3]);
});
test('códigos repetidos pedem quantidade por tipo e não duplicação de componentes', () => {
  assert.throws(() => prepareKit([component('P'), component('P')]), /código diferente/);
  assert.throws(() => prepareKit([component('P', 0)]), /inteira/);
  assert.throws(() => prepareKit([component('P', 1.5)]), /inteira/);
  assert.throws(() => prepareKit([component('P', 1, { barcode: 123 })]), /texto/);
});
test('rascunhos sem cadastro e código ficam pendentes; recebimento fracionário não conclui', () => {
  const row = line([component('P', 3, { productId: null, barcode: '' })], 1.5);
  assert.deepEqual(kitIssues(row), ['Peças sem cadastro vinculado', 'Peças sem código de barras', 'Quantidade de kits deve ser inteira']);
});
test('bipar peça exige seleção e identificação, sem converter bipagem em kits', () => {
  const row = line([component('P', 3)]), part = row.kit.components[0];
  assert.deepEqual(prepareScan({ lineId: row.id, componentId: part.id, barcode: '000123', quantity: 1, mode: 'identify' }, row), { lineId: row.id, componentId: part.id, barcode: '000123', quantity: 1, mode: 'identify' });
  assert.throws(() => prepareScan({ lineId: row.id, barcode: '000123', quantity: 1, mode: 'identify' }, row), /Selecione a peça/);
  assert.throws(() => prepareScan({ lineId: row.id, barcode: '000123', quantity: 1, mode: 'count' }, row), /kits completos/);
});
test('contagem de kits leva somente quantidade inteira e linha, sem código da peça', () => {
  const row = line([component('G', 4)]);
  assert.deepEqual(prepareScan({ lineId: row.id, barcode: 'ignorar', componentId: 'ignorar', quantity: 2, mode: 'kit_count' }, row), { lineId: row.id, quantity: 2, mode: 'kit_count' });
  assert.throws(() => prepareScan({ lineId: row.id, quantity: 1.5, mode: 'kit_count' }, row), /inteira/);
  assert.throws(() => prepareScan({ quantity: 1, mode: 'kit_count' }, row), /Selecione um kit/);
});
test('JSON e CSV preservam a composição e zeros nos códigos sem importar recebimento/revisão', () => {
  const row = line([component('Tam 1', 3, { barcode: '000123' }), component('Tam 2', 2, { barcode: '000456' })]);
  const json = prepareImport(JSON.stringify({ receipt: { lines: [row] } }), 'json').lines[0];
  const csv = prepareImport('description;kit\nKit de camas;' + csvCell(JSON.stringify(row.kit)), 'csv').lines[0];
  for (const result of [json, csv]) { assert.deepEqual(result.kit, row.kit); assert.equal(result.receivedQuantity, 0); assert.equal(result.reviewed, false); assert.equal(result.conversionConfirmed, false); }
});
