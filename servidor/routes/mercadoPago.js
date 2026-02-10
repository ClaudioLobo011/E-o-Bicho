const express = require('express');
const https = require('https');
const crypto = require('crypto');
const mongoose = require('mongoose');
const ExternalIntegration = require('../models/ExternalIntegration');
const Store = require('../models/Store');
const requireAuth = require('../middlewares/requireAuth');
const { decryptText } = require('../utils/certificates');

const router = express.Router();

const SECRET_SELECT = '+providers.mercadopago.encryptedCredentials';
const MP_HOST = 'api.mercadopago.com';

const sanitizeString = (value) => (typeof value === 'string' ? value.trim() : '');

function parseCredentials(provider) {
  if (!provider || !provider.hasCredentials || !provider.encryptedCredentials) {
    return {};
  }
  try {
    return JSON.parse(decryptText(provider.encryptedCredentials));
  } catch (error) {
    return {};
  }
}

function buildNotificationUrl(webhook, storeId) {
  const raw = sanitizeString(webhook);
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (storeId && !url.searchParams.has('storeId')) {
      url.searchParams.set('storeId', storeId);
    }
    return url.toString();
  } catch (error) {
    return raw;
  }
}

function buildIdempotencyKey() {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return crypto.randomBytes(16).toString('hex');
}

function mpRequest({ method, path, accessToken, body, headers = {} }) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : '';
    const requestHeaders = {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...headers,
    };
    if (payload) {
      requestHeaders['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = https.request(
      {
        hostname: MP_HOST,
        path,
        method,
        headers: requestHeaders,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          let parsed = {};
          try {
            parsed = data ? JSON.parse(data) : {};
          } catch (error) {
            parsed = { raw: data };
          }
          resolve({ status: res.statusCode || 500, data: parsed });
        });
      }
    );

    req.on('error', reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

async function fetchIntegration(storeId) {
  const integration = await ExternalIntegration.findOne({ store: storeId }).select(SECRET_SELECT);
  const provider = integration?.providers?.mercadopago;
  const credentials = parseCredentials(provider);
  return { integration, provider, credentials };
}

router.get('/public-key', async (req, res) => {
  try {
    const storeId = sanitizeString(req.query.storeId || req.query.store || req.query.empresa);
    if (!mongoose.Types.ObjectId.isValid(storeId)) {
      return res.status(400).json({ message: 'Loja invalida.' });
    }

    const storeExists = await Store.exists({ _id: storeId });
    if (!storeExists) {
      return res.status(404).json({ message: 'Loja nao encontrada.' });
    }

    const { integration, provider, credentials } = await fetchIntegration(storeId);
    if (!integration) {
      return res.status(404).json({ message: 'Integracao nao configurada.' });
    }
    if (!provider?.enabled) {
      return res.status(404).json({ message: 'Integracao Mercado Pago desativada.' });
    }

    const publicKey = sanitizeString(credentials.publicKey);
    if (!publicKey) {
      return res.status(404).json({ message: 'Public key nao encontrada.' });
    }

    return res.json({ publicKey, enabled: true });
  } catch (error) {
    console.error('mercadopago:public-key', error);
    return res.status(500).json({ message: 'Erro ao obter a public key.' });
  }
});

router.post('/payments', requireAuth, async (req, res) => {
  try {
    const storeId = sanitizeString(req.body?.storeId || req.query?.storeId);
    if (!mongoose.Types.ObjectId.isValid(storeId)) {
      return res.status(400).json({ message: 'Loja invalida.' });
    }

    const storeExists = await Store.exists({ _id: storeId });
    if (!storeExists) {
      return res.status(404).json({ message: 'Loja nao encontrada.' });
    }

    const { integration, provider, credentials } = await fetchIntegration(storeId);
    if (!integration) {
      return res.status(404).json({ message: 'Integracao nao configurada.' });
    }
    if (!provider?.enabled) {
      return res.status(400).json({ message: 'Integracao Mercado Pago desativada.' });
    }

    const accessToken = sanitizeString(credentials.accessToken);
    if (!accessToken) {
      return res.status(400).json({ message: 'Access token nao encontrado.' });
    }

    const amount = Number(req.body?.amount ?? req.body?.transaction_amount);
    const token = sanitizeString(req.body?.token);
    const paymentMethodId = sanitizeString(req.body?.paymentMethodId || req.body?.payment_method_id);
    const installments = Number(req.body?.installments || 1);
    const description = sanitizeString(req.body?.description) || 'Compra E o Bicho';
    const payerEmail = sanitizeString(req.body?.payer?.email);
    const idType = sanitizeString(req.body?.payer?.identification?.type).toUpperCase();
    const idNumber = sanitizeString(req.body?.payer?.identification?.number);
    const delivery = req.body?.delivery && typeof req.body.delivery === 'object' ? req.body.delivery : {};

    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ message: 'Valor do pagamento invalido.' });
    }
    if (!token) {
      return res.status(400).json({ message: 'Token do cartao invalido.' });
    }
    if (!paymentMethodId) {
      return res.status(400).json({ message: 'Meio de pagamento nao informado.' });
    }
    if (!payerEmail) {
      return res.status(400).json({ message: 'Email do pagador nao informado.' });
    }
    if (!idType || !idNumber) {
      return res.status(400).json({ message: 'Documento do pagador nao informado.' });
    }

    const deliveryType = sanitizeString(delivery.type);
    const deliveryCostRaw = Number(delivery.cost);
    const metadata = {
      storeId,
      userId: req.user?.id || '',
      deliveryType: deliveryType || undefined,
      deliveryCost: Number.isFinite(deliveryCostRaw) ? deliveryCostRaw : undefined,
      channel: 'checkout',
    };

    const webhookUrl = buildNotificationUrl(credentials.webhook, storeId);

    const paymentPayload = {
      transaction_amount: Number(amount.toFixed(2)),
      token,
      description,
      installments: Number.isFinite(installments) ? installments : 1,
      payment_method_id: paymentMethodId,
      payer: {
        email: payerEmail,
        identification: {
          type: idType,
          number: idNumber,
        },
      },
      metadata,
      external_reference: sanitizeString(req.body?.externalReference) || `checkout-${Date.now()}-${req.user?.id || ''}`,
    };

    if (webhookUrl) {
      paymentPayload.notification_url = webhookUrl;
    }

    const mpResponse = await mpRequest({
      method: 'POST',
      path: '/v1/payments',
      accessToken,
      body: paymentPayload,
      headers: {
        'X-Idempotency-Key': buildIdempotencyKey(),
      },
    });

    if (mpResponse.status >= 400) {
      return res.status(400).json({
        message: mpResponse.data?.message || 'Falha ao criar pagamento.',
        details: mpResponse.data,
      });
    }

    return res.json({
      paymentId: mpResponse.data?.id,
      status: mpResponse.data?.status,
      statusDetail: mpResponse.data?.status_detail,
      transactionAmount: mpResponse.data?.transaction_amount,
    });
  } catch (error) {
    console.error('mercadopago:payments', error);
    return res.status(500).json({ message: 'Erro ao processar o pagamento.' });
  }
});

router.post('/orders', requireAuth, async (req, res) => {
  try {
    const storeId = sanitizeString(req.body?.storeId || req.query?.storeId);
    if (!mongoose.Types.ObjectId.isValid(storeId)) {
      return res.status(400).json({ message: 'Loja invalida.' });
    }

    const storeExists = await Store.exists({ _id: storeId });
    if (!storeExists) {
      return res.status(404).json({ message: 'Loja nao encontrada.' });
    }

    const { integration, provider, credentials } = await fetchIntegration(storeId);
    if (!integration) {
      return res.status(404).json({ message: 'Integracao nao configurada.' });
    }
    if (!provider?.enabled) {
      return res.status(400).json({ message: 'Integracao Mercado Pago desativada.' });
    }

    const accessToken = sanitizeString(credentials.accessToken);
    if (!accessToken) {
      return res.status(400).json({ message: 'Access token nao encontrado.' });
    }

    const rawAmount = Number(req.body?.amount ?? req.body?.total_amount);
    const payerEmail = sanitizeString(req.body?.payer?.email);
    const processingMode = sanitizeString(req.body?.processingMode || req.body?.processing_mode) || 'automatic';
    const normalizedProcessingMode = processingMode === 'manual' ? 'manual' : 'automatic';
    const expirationTime = sanitizeString(req.body?.expirationTime || req.body?.expiration_time);

    if (!Number.isFinite(rawAmount) || rawAmount <= 0) {
      return res.status(400).json({ message: 'Valor do pagamento invalido.' });
    }
    if (!payerEmail) {
      return res.status(400).json({ message: 'Email do pagador nao informado.' });
    }

    const amount = Number(rawAmount.toFixed(2));
    const amountText = amount.toFixed(2);
    const externalReference = sanitizeString(req.body?.externalReference) || `checkout-${Date.now()}-${req.user?.id || ''}`;

    console.log('[mercadopago:orders] criando order pix', {
      storeId,
      amount: amountText,
      processingMode: normalizedProcessingMode,
      expirationTime: expirationTime || null,
      payerEmail
    });

    const orderPayload = {
      type: 'online',
      total_amount: amountText,
      external_reference: externalReference,
      processing_mode: normalizedProcessingMode,
      transactions: {
        payments: [
          {
            amount: amountText,
            payment_method: {
              id: 'pix',
              type: 'bank_transfer',
            },
          },
        ],
      },
      payer: {
        email: payerEmail,
      },
    };

    if (expirationTime) {
      orderPayload.transactions.payments[0].expiration_time = expirationTime;
    }

    const mpResponse = await mpRequest({
      method: 'POST',
      path: '/v1/orders',
      accessToken,
      body: orderPayload,
      headers: {
        'X-Idempotency-Key': buildIdempotencyKey(),
      },
    });

    if (mpResponse.status >= 400) {
      console.log('[mercadopago:orders] erro mp', {
        status: mpResponse.status,
        data: mpResponse.data
      });
      return res.status(400).json({
        message: mpResponse.data?.message || 'Falha ao criar order Pix.',
        details: mpResponse.data,
      });
    }

    const payment = mpResponse.data?.transactions?.payments?.[0] || {};
    const paymentMethod = payment?.payment_method || {};

    return res.json({
      orderId: mpResponse.data?.id,
      paymentId: payment?.id,
      status: payment?.status || mpResponse.data?.status,
      statusDetail: payment?.status_detail || mpResponse.data?.status_detail,
      amount: payment?.amount || mpResponse.data?.total_amount,
      ticketUrl: paymentMethod?.ticket_url,
      qrCode: paymentMethod?.qr_code,
      qrCodeBase64: paymentMethod?.qr_code_base64,
    });
  } catch (error) {
    console.error('mercadopago:orders', error);
    return res.status(500).json({ message: 'Erro ao criar order Pix.' });
  }
});

router.get('/orders/:orderId', requireAuth, async (req, res) => {
  try {
    const storeId = sanitizeString(req.query.storeId || req.query.store || req.query.empresa);
    const orderId = sanitizeString(req.params.orderId);

    if (!mongoose.Types.ObjectId.isValid(storeId)) {
      return res.status(400).json({ message: 'Loja invalida.' });
    }
    if (!orderId) {
      return res.status(400).json({ message: 'Order invalida.' });
    }

    const { integration, provider, credentials } = await fetchIntegration(storeId);
    if (!integration) {
      return res.status(404).json({ message: 'Integracao nao configurada.' });
    }
    if (!provider?.enabled) {
      return res.status(400).json({ message: 'Integracao Mercado Pago desativada.' });
    }

    const accessToken = sanitizeString(credentials.accessToken);
    if (!accessToken) {
      return res.status(400).json({ message: 'Access token nao encontrado.' });
    }

    const mpResponse = await mpRequest({
      method: 'GET',
      path: `/v1/orders/${encodeURIComponent(orderId)}`,
      accessToken,
    });

    if (mpResponse.status >= 400) {
      return res.status(400).json({
        message: mpResponse.data?.message || 'Falha ao consultar order Pix.',
        details: mpResponse.data,
      });
    }

    const order = mpResponse.data || {};
    const payment = order?.transactions?.payments?.[0] || {};
    const paymentMethod = payment?.payment_method || {};

    return res.json({
      orderId: order?.id,
      orderStatus: order?.status,
      orderStatusDetail: order?.status_detail,
      paymentId: payment?.id,
      paymentStatus: payment?.status,
      paymentStatusDetail: payment?.status_detail,
      amount: payment?.amount || order?.total_amount,
      ticketUrl: paymentMethod?.ticket_url,
      qrCode: paymentMethod?.qr_code,
      qrCodeBase64: paymentMethod?.qr_code_base64,
    });
  } catch (error) {
    console.error('mercadopago:orders:status', error);
    return res.status(500).json({ message: 'Erro ao consultar order Pix.' });
  }
});

router.get('/payments/:paymentId', requireAuth, async (req, res) => {
  try {
    const storeId = sanitizeString(req.query.storeId || req.query.store || req.query.empresa);
    const paymentId = sanitizeString(req.params.paymentId);

    if (!mongoose.Types.ObjectId.isValid(storeId)) {
      return res.status(400).json({ message: 'Loja invalida.' });
    }
    if (!paymentId) {
      return res.status(400).json({ message: 'Pagamento invalido.' });
    }

    const { integration, provider, credentials } = await fetchIntegration(storeId);
    if (!integration) {
      return res.status(404).json({ message: 'Integracao nao configurada.' });
    }
    if (!provider?.enabled) {
      return res.status(400).json({ message: 'Integracao Mercado Pago desativada.' });
    }

    const accessToken = sanitizeString(credentials.accessToken);
    if (!accessToken) {
      return res.status(400).json({ message: 'Access token nao encontrado.' });
    }

    const mpResponse = await mpRequest({
      method: 'GET',
      path: `/v1/payments/${encodeURIComponent(paymentId)}`,
      accessToken,
    });

    if (mpResponse.status >= 400) {
      return res.status(400).json({
        message: mpResponse.data?.message || 'Falha ao consultar pagamento.',
        details: mpResponse.data,
      });
    }

    return res.json({
      paymentId: mpResponse.data?.id,
      status: mpResponse.data?.status,
      statusDetail: mpResponse.data?.status_detail,
      transactionAmount: mpResponse.data?.transaction_amount,
    });
  } catch (error) {
    console.error('mercadopago:payments:status', error);
    return res.status(500).json({ message: 'Erro ao consultar o pagamento.' });
  }
});

module.exports = router;
