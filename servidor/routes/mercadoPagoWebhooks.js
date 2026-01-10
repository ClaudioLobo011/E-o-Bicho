const express = require('express');
const mongoose = require('mongoose');
const MercadoPagoWebhookLog = require('../models/MercadoPagoWebhookLog');

const router = express.Router();

// Mantem compatibilidade com a captura do raw body
router.use(express.raw({ type: '*/*', limit: '2mb' }));

const sanitizeString = (value) => (typeof value === 'string' ? value.trim() : '');

const getParsedBody = (req) => {
  if (Buffer.isBuffer(req.body)) {
    try {
      return JSON.parse(req.body.toString('utf8') || '{}');
    } catch (_) {
      return {};
    }
  }
  if (req.body && typeof req.body === 'object') return req.body;
  return {};
};

const pickHeaders = (headers = {}) => ({
  'x-request-id': sanitizeString(headers['x-request-id']),
  'x-idempotency-key': sanitizeString(headers['x-idempotency-key']),
  'x-signature': sanitizeString(headers['x-signature']),
  'x-mp-signature': sanitizeString(headers['x-mp-signature']),
  'user-agent': sanitizeString(headers['user-agent']),
});

const resolveStoreId = (req) => {
  const candidate = sanitizeString(req.query.storeId || req.query.store || req.query.empresa);
  if (candidate && mongoose.Types.ObjectId.isValid(candidate)) return candidate;
  return null;
};

async function handleMercadoPagoWebhook(req, res) {
  try {
    if (req.method === 'HEAD') {
      return res.status(200).end();
    }

    if (req.method === 'GET') {
      return res.status(200).json({ ok: true, mode: 'validation' });
    }

    const payload = getParsedBody(req);
    const topic = sanitizeString(payload.topic || payload.type || payload.resource || '');
    const action = sanitizeString(payload.action || '');
    const dataId = sanitizeString(payload.data?.id || payload.id || '');
    const liveMode = Boolean(payload.live_mode || payload.liveMode);
    const eventId = sanitizeString(req.headers['x-request-id'] || req.headers['x-idempotency-key'] || '');
    const storeId = resolveStoreId(req);

    console.log('[webhook:mercadopago][received]', {
      method: req.method,
      path: req.originalUrl,
      topic,
      action,
      dataId,
      liveMode,
    });

    try {
      await MercadoPagoWebhookLog.create({
        store: storeId,
        topic,
        type: sanitizeString(payload.type || ''),
        action,
        eventId,
        dataId,
        liveMode,
        headers: pickHeaders(req.headers),
        payload,
      });
    } catch (dbError) {
      console.error('Erro ao salvar webhook Mercado Pago:', dbError);
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Erro no webhook Mercado Pago:', error);
    return res.status(500).json({ message: 'Erro ao processar webhook.' });
  }
}

router.all('/', handleMercadoPagoWebhook);

module.exports = router;
