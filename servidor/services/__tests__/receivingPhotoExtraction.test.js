const test = require('node:test');
const assert = require('node:assert/strict');
const { parseDocumentText, detectDuplicatePages, imageMetadata } = require('../receivingPhotoExtraction');

test('OCR preserves package unit, supplier reference and leading zeros without claiming catalog identity', () => {
  const result = parseDocumentText('PAG: 001\nORCAMENTO: 849.919\n54 1 CX RATOEIRA ADESIVA COLA RATO C/50 091449 114,9900 114,99 S\n1 120 UN TAPETE HIG 60X60CM C/30 CLUB PET 86014 36,9900 4.438,80 S', 'photo');
  assert.equal(result.lines.length, 2);
  const [box, pack] = result.lines;
  assert.equal(box.supplierCode, '091449'); assert.equal(box.expectedQuantity, 1); assert.equal(box.unit, 'CX');
  assert.equal(pack.expectedQuantity, 120); assert.equal(pack.unitCost, 36.99);
  assert.equal(pack.stockFactor, 1); assert.equal(pack.productId, ''); assert.equal(pack.reviewed, false);
  assert.equal(pack.conversionConfirmed, false); assert.equal(box.sourcePhotoId, 'photo');
});
test('unreadable prices are pending; financial footer does not become a product', () => {
  const result = parseDocumentText('1 12 UN SNACKS ORELHA BOVINA ?? 9?,??\nTOTAL DE 45 VOLUMES\n849.919/01 911,85 04/11/2026');
  assert.equal(result.lines.length, 1); assert.equal(result.lines[0].unitCost, null); assert.equal(result.lines[0].supplierCode, '');
});
test('arithmetic disagreement is visible and never silently corrected', () => {
  const line = parseDocumentText('3 2 UN PRODUTO EXEMPLO 12345 10,0000 30,00 S').lines[0];
  assert.equal(line.expectedQuantity, 2); assert.equal(line.lineTotal, 30);
  assert.ok(line.warnings.some(w => w.includes('não confere')));
});
test('duplicate pages are excluded from default proposal, but evidence stays available', () => {
  const lines = ['PRODUTO AZUL', 'PRODUTO VERDE', 'PRODUTO AMARELO'].map(description => ({ description, supplierCode: '' }));
  const pages = detectDuplicatePages([{ photoId: 'a', lines, warnings: [] }, { photoId: 'b', lines, warnings: [] }]);
  assert.equal(pages[0].selected, true); assert.equal(pages[1].selected, false); assert.equal(pages[1].duplicateOf, 'a');
  assert.equal(pages[1].lines.length, 3);
});
test('invalid upload bytes are rejected by actual image decoder', async () => {
  await assert.rejects(() => imageMetadata(Buffer.from('<svg>not a photo</svg>')));
});
