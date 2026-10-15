const test = require('node:test');
const assert = require('node:assert/strict');
const { withPageQuality, withExtractionQuality } = require('../receivingOcrQuality');

const line = { id: 'line', description: 'RATOEIRA ADESIVA COLA RATO C/50', supplierCode: '091449', expectedQuantity: 1, unitCost: 114.99, sourcePhotoId: 'photo', warnings: [] };

test('poor-confidence OCR stays visible but is flagged for explicit manual review', () => {
  const page = withPageQuality({ photoId: 'photo', confidence: 28, rawText: 'illegible evidence', lines: [line], warnings: [] });
  assert.equal(page.quality.status, 'unusable');
  assert.equal(page.lines[0].requiresManualReview, true);
  assert.equal(page.lines[0].supplierCode, '091449');
  assert.equal(page.rawText, 'illegible evidence');
  assert.equal(line.requiresManualReview, undefined);
});

test('high OCR confidence alone cannot validate garbled product fields', () => {
  const page = withPageQuality({ confidence: 93, lines: [{ ...line, supplierCode: '', unitCost: null }], warnings: [] });
  assert.equal(page.quality.status, 'unusable');
  assert.equal(page.quality.structuredLines, 0);
});

test('empty OCR can be displayed as an unusable proposal with its raw text', () => {
  const page = withPageQuality({ confidence: 88, rawText: 'TOTAL 100,00', lines: [] });
  assert.equal(page.quality.status, 'unusable');
  assert.equal(page.rawText, 'TOTAL 100,00');
});

test('clear structured candidates still require document review and never claim approval', () => {
  const page = withPageQuality({ confidence: 88, lines: [line] });
  assert.equal(page.quality.status, 'review_required');
  assert.equal(page.lines[0].requiresManualReview, false);
  assert.equal(page.lines[0].reviewed, undefined);
});

test('legacy cached jobs gain quality flags without rewriting their source values or including duplicates', () => {
  const extraction = { pages: [{ photoId: 'photo', confidence: 28, lines: [line], warnings: [] }, { photoId: 'duplicate', selected: false, confidence: 85, lines: [{ ...line, id: 'duplicate-line' }] }], lines: [line], warnings: [] };
  const reviewed = withExtractionQuality(extraction);
  assert.equal(reviewed.quality.status, 'unusable');
  assert.equal(reviewed.lines.length, 1);
  assert.equal(reviewed.lines[0].requiresManualReview, true);
  assert.equal(reviewed.pages[1].selected, false);
  assert.deepEqual(withExtractionQuality(reviewed), reviewed);
});
