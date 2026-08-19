const test = require('node:test');
const assert = require('node:assert/strict');
const { buildAuthenticationTemplatePayload } = require('../whatsappOtpProvider');

test('monta o template de autenticação com código no corpo e botão', () => {
  const payload = buildAuthenticationTemplatePayload({
    destination: '+55 (21) 98675-4310',
    code: '123456',
    templateName: 'codigo_acesso_e_o_bicho',
    language: 'pt_BR',
  });
  assert.equal(payload.to, '5521986754310');
  assert.equal(payload.template.name, 'codigo_acesso_e_o_bicho');
  assert.equal(payload.template.components[0].parameters[0].text, '123456');
  assert.equal(payload.template.components[1].parameters[0].text, '123456');
});
