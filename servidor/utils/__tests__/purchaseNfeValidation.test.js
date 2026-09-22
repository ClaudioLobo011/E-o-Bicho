const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isValidNfeAccessKey,
  validatePurchaseNfeApproval,
} = require('../purchaseNfeValidation');

const withCheckDigit = (first43Digits) => {
  let weight = 2;
  let sum = 0;
  for (let index = first43Digits.length - 1; index >= 0; index -= 1) {
    sum += Number(first43Digits.charAt(index)) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const remainder = sum % 11;
  const digit = remainder === 0 || remainder === 1 ? 0 : 11 - remainder;
  return `${first43Digits}${digit}`;
};

const accessKey = withCheckDigit('3526091234567800012355001000000123112345678');

const buildValidInput = () => ({
  draft: {
    header: {
      number: '123',
      type: 'NF',
      model: '55',
      entryType: 'revenda',
      issueDate: '2026-09-10',
      entryDate: '2026-09-11',
    },
    xml: { accessKey },
    totals: { totalValue: 150.5 },
    duplicates: [
      { value: 100 },
      { value: 50.5 },
    ],
    importedData: {
      accessKey,
      ide: { model: '55' },
      emit: { document: '12345678000123' },
      dest: { document: '98765432000145' },
      protocol: { status: '100', number: '135260000000001' },
    },
  },
  company: { cnpj: '98.765.432/0001-45' },
  supplier: { cnpj: '12.345.678/0001-23' },
  isReciboEntry: false,
});

test('aceita uma NF-e consistente e autorizada', () => {
  const input = buildValidInput();
  assert.equal(isValidNfeAccessKey(accessKey), true);
  assert.deepEqual(validatePurchaseNfeApproval(input), { valid: true, issues: [] });
});

test('bloqueia chave de acesso com dígito verificador inválido', () => {
  const input = buildValidInput();
  input.draft.xml.accessKey = `${accessKey.slice(0, -1)}${accessKey.endsWith('9') ? '8' : '9'}`;
  const result = validatePurchaseNfeApproval(input);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((issue) => issue.field === 'accessKey'));
});

test('bloqueia empresa e fornecedor divergentes do XML', () => {
  const input = buildValidInput();
  input.company.cnpj = '11111111000111';
  input.supplier.cnpj = '22222222000122';
  const result = validatePurchaseNfeApproval(input);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((issue) => issue.field === 'company'));
  assert.ok(result.issues.some((issue) => issue.field === 'supplier'));
});

test('bloqueia parcelas cuja soma difere do total oficial', () => {
  const input = buildValidInput();
  input.draft.duplicates[1].value = 49.5;
  const result = validatePurchaseNfeApproval(input);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((issue) => issue.focusTab === 'duplicatas' && issue.field === 'value'));
});

const confirmedMismatchInput = () => {
  const input = buildValidInput();
  input.company = { _id: 'company-a', cnpj: '11111111000111' };
  input.recipientMismatchConfirmation = {
    confirmed: true, companyId: 'company-a', companyDocument: '11111111000111',
    destinationDocument: input.draft.importedData.dest.document, accessKey,
  };
  return input;
};

test('permite destinatário divergente apenas com confirmação específica desta entrada', () => {
  assert.equal(validatePurchaseNfeApproval(confirmedMismatchInput()).valid, true);
});

test('rejeita confirmação antiga, genérica ou de outra empresa/documento', () => {
  for (const [field, value] of [['confirmed', 'true'], ['companyId', 'company-b'],
    ['companyDocument', '22222222000122'], ['destinationDocument', '33333333000133'], ['accessKey', '']]) {
    const input = confirmedMismatchInput();
    input.recipientMismatchConfirmation[field] = value;
    assert.equal(validatePurchaseNfeApproval(input).valid, false, field);
  }
  const input = confirmedMismatchInput();
  input.draft.metadata = { recipientMismatchConfirmation: input.recipientMismatchConfirmation };
  delete input.recipientMismatchConfirmation;
  assert.equal(validatePurchaseNfeApproval(input).valid, false);
});

test('confirmação de destinatário não libera fornecedor, documentos ausentes ou parcelas incorretas', () => {
  for (const mutate of [
    input => { input.supplier.cnpj = '22222222000122'; },
    input => { input.draft.importedData.dest.document = ''; },
    input => { input.company.cnpj = ''; },
    input => { input.draft.duplicates[0].value = 1; },
  ]) {
    const input = confirmedMismatchInput(); mutate(input);
    assert.equal(validatePurchaseNfeApproval(input).valid, false);
  }
});

test('exige tipo de entrada também para recibo', () => {
  const input = buildValidInput();
  input.isReciboEntry = true;
  input.draft.header.entryType = '';
  const result = validatePurchaseNfeApproval(input);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((issue) => issue.field === 'entryType'));
  assert.equal(result.issues.length, 1);
});
