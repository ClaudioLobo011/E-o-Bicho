const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');

const {
  validateMercadoPagoWebhookSignature,
} = require('../mercadoPagoVerification');

test('valida assinatura HMAC do webhook Mercado Pago e rejeita adulteracao', () => {
  const secret = 'local-test-secret';
  const dataId = '123456';
  const requestId = 'request-local-1';
  const timestamp = Math.floor(Date.now() / 1000);
  const template = `id:${dataId};request-id:${requestId};ts:${timestamp};`;
  const signature = crypto.createHmac('sha256', secret).update(template).digest('hex');

  const valid = validateMercadoPagoWebhookSignature({
    signatureHeader: `ts=${timestamp},v1=${signature}`,
    requestId,
    dataId,
    secret,
  });
  assert.equal(valid.ok, true);

  const invalid = validateMercadoPagoWebhookSignature({
    signatureHeader: `ts=${timestamp},v1=${signature}`,
    requestId: 'request-adulterado',
    dataId,
    secret,
  });
  assert.equal(invalid.ok, false);
});
