const test = require('node:test');
const assert = require('node:assert/strict');
const { prepareImport, prepareImportProposal, importSelectionState, parseChatGptResponse, assertImportReceipt, chatGptReceivingPrompt } = require('../admin-compras-romaneios.js');

const line = (fields = {}) => ({ description: 'Produto de teste', supplierCode: '00123', expectedQuantity: 2, unit: 'UN', unitCost: 4.5, ...fields });

test('leitura inutilizável permanece consultável mesmo sem linhas de produto', () => {
  const result = prepareImportProposal([], [], { pages: [{ photoId: 'photo-1', rawText: 'texto ilegível', quality: { status: 'unusable' } }] });
  assert.deepEqual(result.proposal, []);
  assert.equal(result.hasUnusablePages, true);
  assert.equal(result.needsManualReview, true);
  assert.equal(importSelectionState(result.proposal, true).canApply, false);
});

test('somente as linhas da foto incerta começam desmarcadas quando a origem é conhecida', () => {
  const result = prepareImportProposal([
    line({ sourcePhotoId: 'clear' }),
    line({ description: 'Outro produto', sourcePhotoId: 'uncertain' }),
  ], [], { pages: [{ photoId: 'clear', quality: { status: 'usable' } }, { photoId: 'uncertain', quality: { status: 'unusable' } }] });
  assert.deepEqual(result.proposal.map((row) => row.selected), [true, false]);
  assert.deepEqual(result.proposal.map((row) => row.requiresManualReview), [false, true]);
  assert.equal(result.proposal[1].line.requiresManualReview, true);
});

test('página incerta também é reconhecida pelo número de página ou pela falta de origem', () => {
  const quality = { pages: [{ quality: { status: 'usable' } }, { quality: { status: 'review_required' } }] };
  assert.equal(prepareImportProposal([line({ sourcePage: '2' })], [], quality).proposal[0].selected, false);
  assert.equal(prepareImportProposal([line()], [], quality).proposal[0].selected, false);
  assert.equal(prepareImportProposal([line({ sourcePage: '1' })], [], quality).proposal[0].selected, true);
});

test('marcação de revisão manual sobrevive à preparação repetida de JSON e CSV', () => {
  const json = prepareImport(JSON.stringify([line({ requiresManualReview: true })]), 'json');
  const twice = prepareImportProposal(json.lines);
  assert.equal(twice.proposal[0].requiresManualReview, true);
  assert.equal(twice.proposal[0].selected, false);
  const csv = prepareImport('description;requiresManualReview\nProduto;true', 'csv');
  assert.equal(prepareImportProposal(csv.lines).proposal[0].selected, false);
});

test('selecionar uma linha incerta exige confirmação explícita antes de adicionar', () => {
  const result = prepareImportProposal([line({ requiresManualReview: true })]);
  result.proposal[0].selected = true;
  assert.deepEqual(importSelectionState(result.proposal, false), { count: 1, needsReview: true, canApply: false });
  assert.deepEqual(importSelectionState(result.proposal, true), { count: 1, needsReview: true, canApply: true });
  assert.equal(importSelectionState(result.proposal, 'true').canApply, false);
});

test('texto corrigido com nova análise não herda a falha de leitura da foto original', () => {
  const original = { pages: [{ photoId: 'photo-1', quality: { status: 'unusable' } }] };
  const corrected = { lines: [line({ sourcePhotoId: 'photo-1' })] };
  assert.equal(prepareImportProposal(corrected.lines, [], original).proposal[0].selected, false);
  const result = prepareImportProposal(corrected.lines, [], corrected);
  assert.equal(result.proposal[0].selected, true);
  assert.equal(result.needsManualReview, false);
  assert.equal(importSelectionState(result.proposal, false).canApply, true);
});

test('importações manuais preservam seleção normal, zeros nos códigos e proteção contra duplicatas', () => {
  const imported = prepareImport('description;supplierCode;expectedQuantity;unitCost\nProduto;00123;2;4,50\nProduto;00123;2;4,50', 'csv');
  const result = prepareImportProposal(imported.lines);
  assert.equal(result.proposal[0].line.supplierCode, '00123');
  assert.deepEqual(result.proposal.map((row) => row.selected), [true, false]);
  assert.equal(result.proposal[1].duplicate, true);
  assert.equal(importSelectionState(result.proposal, false).canApply, true);
  assert.equal(prepareImportProposal(imported.lines, imported.lines).proposal[0].selected, false);
});

test('resposta colada da conversa aceita JSON com cerca Markdown e preserva dúvidas sem inferir recebimento', () => {
  const result = parseChatGptResponse('```json\n' + JSON.stringify({ lines: [line({ receivedQuantity: 99, requiresManualReview: true, warnings: ['Conferir a embalagem'] })], warnings: ['Página repetida omitida'] }) + '\n```');
  assert.equal(result.lines[0].supplierCode, '00123');
  assert.equal(result.lines[0].receivedQuantity, 0);
  assert.equal(result.lines[0].reviewed, false);
  assert.equal(result.lines[0].conversionConfirmed, false);
  assert.equal(result.lines[0].requiresManualReview, true);
  assert.deepEqual(result.lines[0].warnings, ['Conferir a embalagem']);
  assert.ok(result.warnings.includes('Página repetida omitida'));
});

test('colagem rejeita resposta inválida, vazia ou maior que 5 MB em bytes', () => {
  assert.throws(() => parseChatGptResponse(''), /Cole o JSON/);
  assert.throws(() => parseChatGptResponse('Aqui está: {}'), /Não foi possível ler o JSON/);
  assert.throws(() => parseChatGptResponse('{}'), /Não há linhas/);
  assert.throws(() => parseChatGptResponse('é'.repeat(3 * 1024 * 1024)), /excede 5 MB/);
});

test('resposta da conversa exige conferência mesmo quando omite ou nega a marcação de revisão', () => {
  const parsed = parseChatGptResponse(JSON.stringify({ lines: [
    line({ warnings: ['Texto ilegível'] }),
    line({ description: 'Segundo produto', requiresManualReview: false }),
  ] }));
  const { proposal } = prepareImportProposal(parsed.lines);
  assert.deepEqual(proposal.map((row) => row.selected), [false, false]);
  assert.deepEqual(proposal.map((row) => row.requiresManualReview), [true, true]);
  proposal.forEach((row) => { row.selected = true; });
  assert.equal(importSelectionState(proposal, false).canApply, false);
  assert.equal(importSelectionState(proposal, true).canApply, true);
});

test('importação pertence ao mesmo recebimento em conferência, inclusive após abertura da prévia', () => {
  assert.doesNotThrow(() => assertImportReceipt('a', { _id: 'a', status: 'draft' }));
  assert.throws(() => assertImportReceipt('a', { _id: 'b', status: 'draft' }), /recebimento aberto mudou/);
  assert.throws(() => assertImportReceipt('a', null), /recebimento aberto mudou/);
  for (const status of ['approved', 'test_approved', 'cancelled']) {
    assert.throws(() => assertImportReceipt('a', { _id: 'a', status }), /já foi encerrado/);
  }
});

test('pedido copiável exige documento único, valores originais e revisão sem inventar cadastro', () => {
  assert.match(chatGptReceivingPrompt, /não duplique os produtos/);
  assert.match(chatGptReceivingPrompt, /não são códigos de barras nem EAN/);
  assert.match(chatGptReceivingPrompt, /Campo ausente ou ilegível deve ser null/);
  assert.match(chatGptReceivingPrompt, /Não deduza preços, quantidades ou códigos/);
  assert.match(chatGptReceivingPrompt, /requiresManualReview: true/);
});
