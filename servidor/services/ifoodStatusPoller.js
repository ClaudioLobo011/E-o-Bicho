const axios = require('axios');
const ExternalIntegration = require('../models/ExternalIntegration');
const { decryptText } = require('../utils/certificates');
const { getAccessToken } = require('./ifoodClient');
const { mergeEvents } = require('./ifoodEventsCache');
const { broadcast } = require('./ifoodSse');
const util = require('util');

const POLL_INTERVAL_MS = 30 * 1000;
const EVENT_POLL_PATH = process.env.IFOOD_EVENTS_POLL_PATH || '/events/v1.0/events:polling';
const EVENT_ACK_PATH = process.env.IFOOD_EVENTS_ACK_PATH || '/events/v1.0/events/acknowledgment';
const ORDER_CONFIRM_PATH =
  process.env.IFOOD_ORDER_CONFIRM_PATH || '/order/v1.0/orders/{id}/confirm';

const decryptCredentials = (encrypted) => {
  if (!encrypted) return {};
  try {
    const raw = decryptText(encrypted);
    return JSON.parse(raw);
  } catch {
    return {};
  }
};

async function autoAcceptOrders(events = [], headers, baseUrl) {
  const codes = new Set(['PLC', 'PLACED']);
  const toConfirm = Array.from(
    new Set(
      events
        .filter((evt) => codes.has((evt?.code || evt?.fullCode || '').toUpperCase()))
        .map((evt) => evt?.orderId)
        .filter(Boolean)
    )
  );
  for (const orderId of toConfirm) {
    const url = `${baseUrl}${ORDER_CONFIRM_PATH.replace('{id}', orderId)}`;
    try {
      await axios.post(
        url,
        {},
        {
          headers,
          timeout: 10000,
          validateStatus: (s) => [200, 202, 204].includes(s),
        }
      );
      console.info('[ifood:autoAccept][ok]', { orderId });
    } catch (err) {
      console.warn('[ifood:autoAccept][fail]', {
        orderId,
        status: err?.response?.status,
        data: err?.response?.data,
      });
    }
  }
}

async function pollMerchant(credentials) {
  const { clientId, clientSecret, merchantId, autoAccept } = credentials || {};
  if (!clientId || !clientSecret || !merchantId) {
    throw new Error('Credenciais do iFood ausentes para polling de eventos.');
  }

  const token = await getAccessToken({ clientId, clientSecret });
  const base = process.env.IFOOD_API_BASE || 'https://merchant-api.ifood.com.br';
  const pollUrl = `${base}${EVENT_POLL_PATH}`;
  const ackUrl = `${base}${EVENT_ACK_PATH}`;

  const headers = {
    Authorization: `Bearer ${token}`,
    'x-polling-merchants': merchantId,
  };

  const resp = await axios.get(pollUrl, {
    headers,
    timeout: 10000,
    validateStatus: (status) => [200, 204].includes(status),
  });

  if (resp.status === 204 || !Array.isArray(resp.data) || resp.data.length === 0) {
    return;
  }

  const events = resp.data;
  // Guarda no cache compartilhado e faz ACK para nÃ£o repetir
  mergeEvents(merchantId, events);
  console.info(
    '[ifood:events][dump]',
    util.inspect({ merchantId, events }, { depth: null, colors: false })
  );
  if (autoAccept) {
    await autoAcceptOrders(events, headers, base);
  }
  await axios.post(ackUrl, events, { headers, timeout: 10000 });
  broadcast({ type: 'ifood-events', merchantId, events });
  console.info('[ifood:events]', { merchantId, count: events.length });
}

async function pollOnce() {
  const integrations = await ExternalIntegration.find({
    'providers.ifood.enabled': true,
    'providers.ifood.hasCredentials': true,
  }).select('+providers.ifood.encryptedCredentials');

  for (const integration of integrations) {
    const creds = decryptCredentials(integration?.providers?.ifood?.encryptedCredentials);
    const merchantId = creds?.merchantId || creds?.merchantID;
    const clientId = creds?.clientId;
    const clientSecret = creds?.clientSecret;
    const autoAccept = !!integration?.providers?.ifood?.autoAccept;

    if (!merchantId || !clientId || !clientSecret) {
      continue;
    }

    try {
      await pollMerchant({ clientId, clientSecret, merchantId, autoAccept });
    } catch (err) {
      console.warn('[ifood:events][erro]', {
        storeId: integration.store?.toString?.() || '',
        merchantId,
        message: err?.message,
        status: err?.response?.status,
        data: err?.response?.data,
      });
    }
  }
}

function startIfoodStatusPoller() {
  let inFlight = false;
  const loop = async () => {
    if (inFlight) return;
    inFlight = true;
    try {
      await pollOnce();
    } catch (err) {
      console.warn('[ifood:events][loop-error]', err?.message);
    } finally {
      inFlight = false;
      setTimeout(loop, POLL_INTERVAL_MS);
    }
  };
  loop();
}

module.exports = {
  startIfoodStatusPoller,
};

