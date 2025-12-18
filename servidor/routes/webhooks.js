const express = require('express');
const crypto = require('crypto');
const ExternalIntegration = require('../models/ExternalIntegration');
const { decryptText } = require('../utils/certificates');

const router = express.Router();

// Garante acesso ao corpo bruto para qualquer content-type (evita depender apenas do express.json global)
router.use(express.raw({ type: '*/*', limit: '2mb' }));

// Cache simples na memória para idempotência (X-Event-Id)
const seenEvents = new Map();
const IDEMPOTENCY_TTL_MS = 10 * 60 * 1000; // 10 minutos

const envSignatureSecret =
  process.env.IFOOD_WEBHOOK_SECRET ||
  process.env.WEBHOOK_SIGNATURE_SECRET ||
  '';

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

const getRawBody = (req) => {
  if (req.rawBody && req.rawBody.length) return req.rawBody;
  if (!req.body) return '';
  try {
    return JSON.stringify(req.body);
  } catch (_) {
    return '';
  }
};

const decryptCredentials = (encrypted) => {
  if (!encrypted) return {};
  try {
    return JSON.parse(decryptText(encrypted));
  } catch (_) {
    return {};
  }
};

const findSecretByMerchant = async (merchantId) => {
  if (!merchantId) return null;
  const docs = await ExternalIntegration.find({
    'providers.ifood.hasCredentials': true,
  }).select('+providers.ifood.encryptedCredentials').lean();

  for (const doc of docs) {
    const enc = doc?.providers?.ifood?.encryptedCredentials;
    const creds = decryptCredentials(enc);
    if (!creds || typeof creds !== 'object') continue;
    if ((creds.merchantId || '').trim() === merchantId.trim()) {
      return creds.clientSecret || null;
    }
  }
  return null;
};

const verifySignature = (req, secret) => {
  const key = secret || envSignatureSecret;
  const header =
    req.headers['x-marketplace-signature'] ||
    req.headers['x-hub-signature'] ||
    req.headers['x-signature'] ||
    req.headers['x-ifood-signature'] ||
    '';

  // Sem segredo ou sem header: não bloqueia (modo permissivo para testes).
  if (!key || !header) return true;

  const body = getRawBody(req);
  const expected = crypto.createHmac('sha256', key).update(body).digest('hex');
  return expected === header;
};

const isDuplicateEvent = (req) => {
  const eventId = req.headers['x-event-id'] || req.headers['x-request-id'];
  if (!eventId) return false;
  const now = Date.now();

  // limpa expirados
  for (const [id, ts] of seenEvents.entries()) {
    if (now - ts > IDEMPOTENCY_TTL_MS) seenEvents.delete(id);
  }

  if (seenEvents.has(eventId)) return true;
  seenEvents.set(eventId, now);
  return false;
};

// Endpoint para receber webhooks dos marketplaces (iFood, Uber Eats, 99Food)
// Inclui HEAD/GET para validações do iFood e valida assinatura + idempotência em POST.
async function handleWebhook(req, res) {
  try {
    // Validação básica (presença)
    if (req.method === 'HEAD') {
      return res.status(200).end();
    }

    if (req.method === 'GET') {
      return res.status(200).json({ ok: true, mode: 'validation' });
    }

    // POST (payload real)
    const parsedBody = getParsedBody(req);
    const merchantId =
      (parsedBody && (parsedBody.merchantId || parsedBody.merchantID)) ||
      (parsedBody && parsedBody.merchant && (parsedBody.merchant.id || parsedBody.merchant.merchantId)) ||
      '';

    const secretFromDb = await findSecretByMerchant(merchantId);
    const signatureOk = verifySignature(req, secretFromDb);
    if (!signatureOk) {
      return res.status(401).json({ message: 'Assinatura inválida.' });
    }

    if (isDuplicateEvent(req)) {
      return res.status(200).json({ ok: true, duplicate: true });
    }

    // Log leve para confirmar recebimento (evite em produção se contiver dados sensíveis)
    console.info('[webhook:marketplaces]', {
      method: req.method,
      path: req.originalUrl,
      merchantId,
      eventId: req.headers['x-event-id'] || req.headers['x-request-id'] || '',
      signature: req.headers['x-marketplace-signature'] || req.headers['x-hub-signature'] || req.headers['x-signature'] || req.headers['x-ifood-signature'] || '',
    });

    // Aqui entraria o processamento dos eventos (fila/worker etc.)
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Erro no webhook /marketplaces:', error);
    return res.status(500).json({ message: 'Erro ao processar webhook.' });
  }
}

// Responde também no path raiz do router (ex: /webhooks) para validações de presença.
router.all('/', handleWebhook);
router.all('/marketplaces', handleWebhook);
router.all('/webhook', handleWebhook);

module.exports = router;
