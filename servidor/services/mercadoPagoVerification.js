const axios = require('axios');
const crypto = require('crypto');

function timingSafeHexEqual(left = '', right = '') {
  const a = Buffer.from(String(left), 'hex');
  const b = Buffer.from(String(right), 'hex');
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

function validateMercadoPagoWebhookSignature({
  signatureHeader = '',
  requestId = '',
  dataId = '',
  secret = process.env.MERCADO_PAGO_WEBHOOK_SECRET || '',
  toleranceSeconds = 300,
} = {}) {
  if (!secret) return { ok: false, reason: 'webhook-secret-missing' };
  const parts = Object.fromEntries(
    String(signatureHeader || '')
      .split(',')
      .map((entry) => entry.trim().split('=', 2))
      .filter(([key, value]) => key && value)
  );
  const timestamp = Number(parts.ts || 0);
  const received = String(parts.v1 || '').trim().toLowerCase();
  if (!timestamp || !received) return { ok: false, reason: 'invalid-signature-header' };
  const nowSeconds = Math.floor(Date.now() / 1000);
  const normalizedTimestamp = timestamp > 10_000_000_000 ? Math.floor(timestamp / 1000) : timestamp;
  if (Math.abs(nowSeconds - normalizedTimestamp) > toleranceSeconds) {
    return { ok: false, reason: 'signature-expired' };
  }
  const template = `id:${String(dataId || '').toLowerCase()};request-id:${requestId};ts:${parts.ts};`;
  const expected = crypto.createHmac('sha256', secret).update(template).digest('hex');
  return timingSafeHexEqual(expected, received)
    ? { ok: true }
    : { ok: false, reason: 'signature-mismatch' };
}

async function fetchMercadoPagoPayment(paymentId, {
  accessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN || '',
} = {}) {
  if (!accessToken) {
    const error = new Error('MERCADO_PAGO_ACCESS_TOKEN nao configurado.');
    error.statusCode = 503;
    throw error;
  }
  const response = await axios.get(
    `https://api.mercadopago.com/v1/payments/${encodeURIComponent(String(paymentId || ''))}`,
    {
      timeout: 10_000,
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
  return response?.data || {};
}

async function verifyMercadoPagoPayment({ paymentId, expectedAmount, externalReference = '' } = {}) {
  const payment = await fetchMercadoPagoPayment(paymentId);
  const amount = Number(payment?.transaction_amount || 0);
  const expected = Number(expectedAmount || 0);
  const approved = String(payment?.status || '').toLowerCase() === 'approved';
  const amountMatches = Math.abs(amount - expected) < 0.01;
  const referenceMatches = !externalReference
    || !payment?.external_reference
    || String(payment.external_reference) === String(externalReference);
  return {
    ok: approved && amountMatches && referenceMatches,
    payment,
    reason: !approved
      ? 'payment-not-approved'
      : (!amountMatches ? 'payment-amount-mismatch' : (!referenceMatches ? 'payment-reference-mismatch' : '')),
  };
}

module.exports = {
  fetchMercadoPagoPayment,
  validateMercadoPagoWebhookSignature,
  verifyMercadoPagoPayment,
};
