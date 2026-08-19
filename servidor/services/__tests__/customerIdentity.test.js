const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeBrazilPhone,
  isBrazilianMobile,
  effectiveWebAccountStatus,
  phoneLookupQuery,
} = require('../../utils/customerIdentity');

test('normaliza celulares brasileiros com ou sem DDI e formatação', () => {
  assert.equal(normalizeBrazilPhone('+55 (21) 98675-4310'), '21986754310');
  assert.equal(normalizeBrazilPhone('(21) 98675-4310'), '21986754310');
  assert.equal(isBrazilianMobile('21986754310'), true);
  assert.equal(isBrazilianMobile('2133334444'), false);
});

test('classifica cadastros técnicos como exclusivos da loja', () => {
  assert.equal(effectiveWebAccountStatus({ role: 'cliente', email: 'cadastro.desktop+abc@eobicho.local' }), 'store_only');
  assert.equal(effectiveWebAccountStatus({ role: 'cliente', email: 'cliente@exemplo.com' }), 'active');
  assert.equal(effectiveWebAccountStatus({ role: 'cliente', email: 'cliente@exemplo.com', webAccountStatus: 'blocked' }), 'blocked');
});

test('gera consulta compatível com celulares antigos e normalizados', () => {
  const query = phoneLookupQuery('21986754310');
  assert.equal(query.$or[0].celularNormalizado, '21986754310');
  assert.ok(query.$or[1].celular.$in.includes('+5521986754310'));
});
