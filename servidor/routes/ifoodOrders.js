const express = require('express');
const axios = require('axios');
const mongoose = require('mongoose');
const ExternalIntegration = require('../models/ExternalIntegration');
const { decryptText } = require('../utils/certificates');
const requireAuth = require('../middlewares/requireAuth');
const authorizeRoles = require('../middlewares/authorizeRoles');
const { getAccessToken } = require('../services/ifoodClient');

const router = express.Router();

const ORDER_BASE = process.env.IFOOD_ORDER_BASE || 'https://merchant-api.ifood.com.br/order/v1.0';
const ORDER_POLL_PATH = process.env.IFOOD_ORDER_POLL_PATH || '/events:polling';
const ORDER_ACK_PATH = process.env.IFOOD_ORDER_ACK_PATH || '/events/acknowledgment';
const ORDER_DETAIL_PATH = process.env.IFOOD_ORDER_DETAIL_PATH || '/orders/{id}';

const { mergeEvents, getEvents, clearEvents } = require('../services/ifoodEventsCache');

const decryptCredentials = (encrypted) => {
  if (!encrypted) return {};
  try {
    return JSON.parse(decryptText(encrypted));
  } catch (_) {
    return {};
  }
};

const statusBuckets = {
  // inclui códigos abreviados (PLC, CON, CFM, RTP, DSP, SPS, SPE)
  awaiting: ["PLACED", "PLC"], // ainda não aceitos
  separation: [
    "SEPARATION_STARTED",
    "SPS",
    "SEPARATION_END",
    "SEPARATION_ENDED",
    "SPE",
    "CONFIRMED",
    "CFM",
  ], // em preparo/separação
  packing: ["READY_TO_PICKUP", "RTP", "DISPATCHED", "DSP"], // pronto/empacotando/saindo
  concluded: ["CONCLUDED", "CON"], // finalizados
  canceled: ["CANCELLED", "CAN"], // cancelados
};

const extractStatusCode = (evt = {}) => {
  return (
    evt?.orderStatus ||
    evt?.status ||
    evt?.code ||
    evt?.fullCode ||
    evt?.payload?.code ||
    ''
  );
};

const normalizeOrderDetail = (detail = {}, event = {}) => {
  const resolveMoneyValue = (raw) => {
    if (raw == null) return null;
    const num = Number(raw);
    if (!Number.isFinite(num)) return null;
    // valores do iFood vem em centavos; divide por 100 se for inteiro >= 100
    if (Number.isInteger(num) && Math.abs(num) >= 100) return num / 100;
    return num;
  };
  const resolveTotal = () => {
    const totals = detail?.total || {};
    const raw =
      totals?.orderAmount?.value ??
      totals?.orderAmount ??
      totals?.subTotal?.value ??
      totals?.subTotal ??
      totals?.deliveryFee?.value ??
      totals?.deliveryFee ??
      detail?.bag?.prices?.grossValue?.value ??
      detail?.payment?.total?.value ??
      detail?.payment?.total ??
      detail?.payment?.methods?.[0]?.amount?.value ??
      event?.bag?.prices?.grossValue?.value ??
      null;
    return resolveMoneyValue(raw);
  };
  const resolveItems = () => {
    const candidates = [
      detail?.items,
      detail?.orderItems,
      detail?.bag?.items,
      detail?.bag?.itens,
      detail?.basket?.items,
      detail?.basket?.itens,
    ];
    const rawItems = candidates.find((list) => Array.isArray(list) && list.length) || [];
    return rawItems
      .map((item, index) => {
        const source = item?.item || item?.product || item || {};
        const quantityRaw =
          item?.quantity ??
          source?.quantity ??
          item?.amount ??
          source?.amount ??
          item?.qty ??
          source?.qty ??
          1;
        const quantity = Number(quantityRaw);
        const normalizedQuantity = Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
        const unitPrice = resolveMoneyValue(
          item?.unitPrice?.value ??
            item?.unitPrice ??
            source?.unitPrice?.value ??
            source?.unitPrice ??
            item?.price?.value ??
            item?.price ??
            source?.price?.value ??
            source?.price ??
            item?.unitValue?.value ??
            item?.unitValue ??
            source?.unitValue?.value ??
            source?.unitValue ??
            null
        );
        const totalPrice = resolveMoneyValue(
          item?.totalPrice?.value ??
            item?.totalPrice ??
            source?.totalPrice?.value ??
            source?.totalPrice ??
            item?.total?.value ??
            item?.total ??
            item?.value ??
            source?.value ??
            null
        );
        const resolvedUnitPrice =
          unitPrice ??
          (totalPrice != null && normalizedQuantity ? totalPrice / normalizedQuantity : null);
        const resolvedTotalPrice =
          totalPrice ??
          (resolvedUnitPrice != null ? resolvedUnitPrice * normalizedQuantity : null);
        const name =
          source?.name ||
          item?.name ||
          source?.description ||
          item?.description ||
          source?.title ||
          item?.title ||
          '';
        const externalCode =
          source?.externalCode ||
          item?.externalCode ||
          source?.sku ||
          item?.sku ||
          source?.plu ||
          item?.plu ||
          source?.barcode ||
          item?.barcode ||
          source?.ean ||
          item?.ean ||
          source?.code ||
          item?.code ||
          '';
        const barcode = source?.barcode || item?.barcode || source?.ean || item?.ean || null;
        const plu = source?.plu || item?.plu || null;
        const id =
          source?.id ||
          item?.id ||
          externalCode ||
          `${detail?.id || event?.orderId || event?.id || 'ifood'}-item-${index}`;
        return {
          id,
          name,
          quantity: normalizedQuantity,
          unitPrice: resolvedUnitPrice,
          totalPrice: resolvedTotalPrice,
          externalCode,
          barcode,
          plu,
        };
      })
      .filter((item) => item && (item.name || item.externalCode));
  };
  const total = resolveTotal();
  const customerName = detail?.customer?.name || detail?.client?.name || '';
  const address =
    detail?.delivery?.deliveryAddress?.formattedAddress ||
    detail?.delivery?.deliveryAddress?.streetName ||
    detail?.delivery?.address?.formattedAddress ||
    detail?.delivery?.address?.street ||
    '';
  const statusCode = extractStatusCode(event);
  const displayCode =
    detail?.displayId ||
    detail?.shortCode ||
    detail?.shortcode ||
    event?.shortCode ||
    event?.shortcode ||
    detail?.reference ||
    detail?.shortReference ||
    detail?.code ||
    event?.reference ||
    event?.id ||
    detail?.id;
  return {
    id: detail?.id || event?.orderId || event?.resourceId || event?.id,
    code: displayCode,
    status: statusCode,
    rawStatus: statusCode,
    createdAt:
      detail?.createdAt ||
      event?.createdAt ||
      event?.created_date ||
      event?.created_at ||
      null,
    preparationStartDateTime: detail?.preparationStartDateTime || null,
    orderType: detail?.orderType || null,
    orderTiming: detail?.orderTiming || null,
    salesChannel: detail?.salesChannel || null,
    category: detail?.category || null,
    isTest: detail?.isTest ?? null,
    extraInfo: detail?.extraInfo || null,
    totalSummary: {
      subTotal: detail?.total?.subTotal ?? null,
      deliveryFee: detail?.total?.deliveryFee ?? null,
      benefits: detail?.total?.benefits ?? null,
      additionalFees: detail?.total?.additionalFees ?? null,
      orderAmount: detail?.total?.orderAmount ?? null,
    },
    merchant: {
      id: detail?.merchant?.id || null,
      name: detail?.merchant?.name || null,
    },
    customer: {
      id: detail?.customer?.id || null,
      name: customerName,
      documentNumber: detail?.customer?.documentNumber || null,
      ordersCountOnMerchant: detail?.customer?.ordersCountOnMerchant ?? null,
      phone: {
        number: detail?.customer?.phone?.number || null,
        localizer: detail?.customer?.phone?.localizer || null,
        localizerExpiration: detail?.customer?.phone?.localizerExpiration || null,
      },
      segmentation: detail?.customer?.segmentation || null,
    },
    delivery: {
      mode: detail?.delivery?.mode || null,
      description: detail?.delivery?.description || null,
      deliveredBy: detail?.delivery?.deliveredBy || null,
      pickupCode: detail?.delivery?.pickupCode || null,
      deliveryDateTime: detail?.delivery?.deliveryDateTime || null,
      observations: detail?.delivery?.observations || null,
      deliveryAddress: detail?.delivery?.deliveryAddress
        ? {
            streetName: detail?.delivery?.deliveryAddress?.streetName || null,
            streetNumber: detail?.delivery?.deliveryAddress?.streetNumber || null,
            formattedAddress: detail?.delivery?.deliveryAddress?.formattedAddress || null,
            neighborhood: detail?.delivery?.deliveryAddress?.neighborhood || null,
            complement: detail?.delivery?.deliveryAddress?.complement || null,
            reference: detail?.delivery?.deliveryAddress?.reference || null,
            postalCode: detail?.delivery?.deliveryAddress?.postalCode || null,
            city: detail?.delivery?.deliveryAddress?.city || null,
            state: detail?.delivery?.deliveryAddress?.state || null,
            country: detail?.delivery?.deliveryAddress?.country || null,
          }
        : null,
    },
    payments: {
      prepaid: detail?.payments?.prepaid ?? null,
      pending: detail?.payments?.pending ?? null,
      methods: Array.isArray(detail?.payments?.methods)
        ? detail.payments.methods.map((m) => ({
            value: m?.value ?? null,
            currency: m?.currency || null,
            type: m?.type || null,
            method: m?.method || null,
            wallet: m?.wallet ? { name: m.wallet?.name || null } : null,
            card: m?.card ? { brand: m.card?.brand || null } : null,
            cash: m?.cash ? { changeFor: m.cash?.changeFor ?? null } : null,
            transaction: m?.transaction
              ? {
                  authorizationCode: m.transaction?.authorizationCode || null,
                  acquirerDocument: m.transaction?.acquirerDocument || null,
                }
              : null,
          }))
        : [],
    },
    total,
    items: resolveItems(),
    customerName,
    address,
  };
};

const statusCodeSet = new Set([
  'PLC',
  'PLACED',
  'CFM',
  'CONFIRMED',
  'SPS',
  'SEPARATION_STARTED',
  'SPE',
  'SEPARATION_END',
  'SEPARATION_ENDED',
  'RTP',
  'READY_TO_PICKUP',
  'DSP',
  'DISPATCHED',
  'CON',
  'CONCLUDED',
  'CAN',
  'CANCELLED',
]);

function isStatusEvent(evt = {}) {
  const group = (evt?.group || '').toUpperCase();
  const code = (evt?.fullCode || evt?.code || '').toUpperCase();
  return group === 'ORDER_STATUS' || statusCodeSet.has(code);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchOrderDetailWithRetry(orderId, headers, baseUrl, detailPath) {
  const maxDurationMs = 10 * 60 * 1000; // 10 minutos
  let attempt = 0;
  const startedAt = Date.now();
  const url = `${baseUrl}${detailPath.replace('{id}', orderId)}`;

  while (Date.now() - startedAt < maxDurationMs) {
    attempt += 1;
    try {
      const resp = await axios.get(url, {
        headers,
        timeout: 10000,
        validateStatus: (s) => [200, 404].includes(s),
      });
      if (resp.status === 200) {
        console.info('[ifood:orders][detail][received]', {
          orderId,
          displayId: resp.data?.displayId,
          customer: resp.data?.customer,
          total: resp.data?.total,
        });
        return resp.data;
      }
      // 404: espera e tenta novamente
      const backoff = Math.min(1000 * 2 ** (attempt - 1), 30_000);
      await sleep(backoff);
      continue;
    } catch (err) {
      const status = err?.response?.status;
      if (status === 404) {
        const backoff = Math.min(1000 * 2 ** (attempt - 1), 30_000);
        await sleep(backoff);
        continue;
      }
      console.warn('[ifood:orders][detail][fail]', {
        orderId,
        status: err?.response?.status,
        data: err?.response?.data,
      });
      return null;
    }
  }

  console.warn('[ifood:orders][detail][fail]', { orderId, status: 404, data: 'timeout after retries' });
  return null;
}

router.get('/orders/open', requireAuth, authorizeRoles('admin', 'admin_master'), async (req, res) => {
  try {
    const storeId = req.query.storeId;
    if (!storeId || !mongoose.Types.ObjectId.isValid(storeId)) {
      return res.status(400).json({ message: 'storeId invÃ¡lido.' });
    }

    const integration = await ExternalIntegration.findOne({
      store: storeId,
      'providers.ifood.enabled': true,
      'providers.ifood.hasCredentials': true,
    }).select('+providers.ifood.encryptedCredentials');

    if (!integration) {
      return res.status(404).json({ message: 'IntegraÃ§Ã£o iFood nÃ£o encontrada ou inativa.' });
    }

    const creds = decryptCredentials(integration?.providers?.ifood?.encryptedCredentials);
    const merchantId = creds?.merchantId || creds?.merchantID;
    const clientId = creds?.clientId;
    const clientSecret = creds?.clientSecret;
    if (!merchantId || !clientId || !clientSecret) {
      return res.status(400).json({ message: 'Credenciais iFood incompletas.' });
    }

    const token = await getAccessToken({ clientId, clientSecret });
    const headers = {
      Authorization: `Bearer ${token}`,
      'x-polling-merchants': merchantId,
    };

    const cacheKey = merchantId;
    // Recupera cache de eventos pendentes
    const cachedEvents = getEvents(cacheKey);

    // Polling sem filtro de grupos para evitar perder eventos; nÃ£o damos ACK aqui
    const pollUrl = `${ORDER_BASE}${ORDER_POLL_PATH}`;
    const pollResp = await axios.get(pollUrl, {
      headers,
      timeout: 10000,
      validateStatus: (s) => [200, 204].includes(s),
    });

    const polled = pollResp.status === 204 || !Array.isArray(pollResp.data) ? [] : pollResp.data;
    console.info('[ifood:orders][poll]', {
      storeId,
      merchantId,
      status: pollResp.status,
      polled: polled.length,
      cached: cachedEvents.length,
    });

    // MantÃ©m somente eventos de status de pedido
    const statusEvents = (polled || []).filter(
      (evt) => (evt?.group || '').toUpperCase() === 'ORDER_STATUS'
    );
    const mergedEvents = mergeEvents(cacheKey, statusEvents);
    console.info('[ifood:orders][dump]', {
      storeId,
      merchantId,
      cached: JSON.parse(JSON.stringify(cachedEvents)),
      polled: JSON.parse(JSON.stringify(statusEvents)),
      merged: JSON.parse(JSON.stringify(mergedEvents)),
    });

    if (!mergedEvents.length) {
      return res.json({ awaiting: [], separation: [], packing: [], concluded: [], canceled: [], raw: [] });
    }

    // Escolhe o último status por pedido, para mover entre abas
  const statusRank = {
    PLC: 1,
    PLACED: 1,
    CFM: 2,
    CONFIRMED: 2,
    SPS: 3,
    SEPARATION_STARTED: 3,
    SPE: 4,
    SEPARATION_END: 4,
    SEPARATION_ENDED: 4,
    RTP: 5,
    READY_TO_PICKUP: 5,
      DSP: 6,
      DISPATCHED: 6,
      CON: 7,
      CONCLUDED: 7,
      CAN: 8,
      CANCELLED: 8,
    };

    const latestByOrder = mergedEvents.reduce((map, evt) => {
      const id = evt?.orderId || evt?.resourceId || evt?.id;
      if (!id) return map;
      const status = extractStatusCode(evt).toUpperCase();
      const rank = statusRank[status] || 0;
      const evtTime = new Date(
        evt?.createdAt || evt?.created_at || evt?.created_date || Date.now()
      ).getTime();
      const current = map.get(id);
      if (!current || rank > current.rank || (rank === current.rank && evtTime > current.time)) {
        map.set(id, { evt, rank, time: evtTime });
      }
      return map;
    }, new Map());

    const chosenEvents = Array.from(latestByOrder.values()).map((item) => item.evt);

    // Buscar detalhes dos pedidos com retry
    const detailPromises = chosenEvents.map(async (evt) => {
      const id = evt?.orderId || evt?.id || evt?.resourceId;
      if (!id) return normalizeOrderDetail({}, evt);
      const detail = await fetchOrderDetailWithRetry(id, headers, ORDER_BASE, ORDER_DETAIL_PATH);
      if (!detail) {
        console.warn('[ifood:orders][detail][fail]', { orderId: id, status: null, data: 'no detail' });
        return normalizeOrderDetail({}, evt);
      }
      const normalized = normalizeOrderDetail(detail, evt);
      console.info('[ifood:orders][normalized]', normalized);
      return normalized;
    });

    const detailed = await Promise.all(detailPromises);

    const bucketed = {
      awaiting: [],
      separation: [],
      packing: [],
      concluded: [],
      canceled: [],
    };

    detailed.forEach((order) => {
      const status = (order.rawStatus || order.status || '').toUpperCase();
      if (statusBuckets.awaiting.includes(status)) {
        bucketed.awaiting.push(order);
      } else if (statusBuckets.separation.includes(status)) {
        bucketed.separation.push(order);
      } else if (statusBuckets.packing.includes(status)) {
        bucketed.packing.push(order);
      } else if (statusBuckets.concluded.includes(status)) {
        bucketed.concluded.push(order);
      } else if (statusBuckets.canceled.includes(status)) {
        bucketed.canceled.push(order);
      }
    });

    return res.json({ ...bucketed, raw: detailed });
  } catch (err) {
    const status = err?.response?.status;
    const data = err?.response?.data;
    console.error('[ifood:orders][erro]', status, data || err?.message);
    return res.status(status || 500).json({ message: data?.message || err.message || 'Erro ao buscar pedidos iFood.' });
  }
});

module.exports = router;










