const test = require('node:test');
const assert = require('node:assert/strict');
const { assertProductFiscalRuleTypes } = require('../productFiscalRuleSafety');

test('product rules reject service assignments in the matching company only', async () => {
  const empresa = 'aaaaaaaaaaaaaaaaaaaaaaaa';
  let filter;
  const model = { findOne(value) { filter = value; return { select() { return this; }, lean: async () => ({ code: 5, name: 'Serviços' }) }; } };
  await assert.rejects(assertProductFiscalRuleTypes({ [empresa]: { fiscalRuleCode: '5' } }, model), error => error.statusCode === 400 && /de serviço/.test(error.message));
  assert.deepEqual(filter, { tipo: 'servico', $or: [{ empresa, code: 5 }] });
});

test('product rules accept legacy products and commercial edits without fiscal assignment', async () => {
  let queries = 0;
  const model = { findOne() { queries++; return { select() { return this; }, lean: async () => null }; } };
  await assertProductFiscalRuleTypes({}, model);
  assert.equal(queries, 0);
  await assertProductFiscalRuleTypes({ aaaaaaaaaaaaaaaaaaaaaaaa: { fiscalRuleCode: 7 } }, model);
  assert.equal(queries, 1);
});
