const DEFAULT_GRAPH_VERSION = 'v25.0';
const REQUIRED_WEBHOOK_FIELDS = Object.freeze([
  'messages',
  'history',
  'smb_app_state_sync',
  'smb_message_echoes',
  'account_update',
]);

class WhatsappGraphError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'WhatsappGraphError';
    this.status = options.status || 502;
    this.code = options.code || 'WHATSAPP_GRAPH_ERROR';
    this.graphCode = options.graphCode ?? null;
    this.graphSubcode = options.graphSubcode ?? null;
    this.fbtraceId = options.fbtraceId || '';
  }
}

const clean = (value) => (typeof value === 'string' ? value.trim() : '');

const normalizeGraphVersion = (value) => {
  const version = clean(value);
  return /^v\d+\.\d+$/.test(version) ? version : DEFAULT_GRAPH_VERSION;
};

const createGraphClient = ({
  fetchImpl = global.fetch,
  graphOrigin = process.env.WHATSAPP_GRAPH_ORIGIN || 'https://graph.facebook.com',
  timeoutMs = Number.parseInt(process.env.WHATSAPP_ONBOARDING_TIMEOUT_MS, 10) || 20000,
} = {}) => {
  if (typeof fetchImpl !== 'function') {
    throw new TypeError('Uma implementação de fetch é obrigatória.');
  }

  const request = async (path, options = {}) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    let payload = null;
    try {
      response = await fetchImpl(`${graphOrigin}${path}`, {
        ...options,
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          ...(options.headers || {}),
        },
      });
      payload = await response.json().catch(() => null);
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw new WhatsappGraphError('Tempo limite excedido ao comunicar com a Meta.', {
          status: 504,
          code: 'WHATSAPP_GRAPH_TIMEOUT',
        });
      }
      throw new WhatsappGraphError('Não foi possível comunicar com a Meta.', {
        code: 'WHATSAPP_GRAPH_UNAVAILABLE',
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const graphError = payload?.error || {};
      throw new WhatsappGraphError(
        clean(graphError.message) || `A Meta recusou a solicitação (${response.status}).`,
        {
          status: 502,
          graphCode: graphError.code,
          graphSubcode: graphError.error_subcode,
          fbtraceId: clean(graphError.fbtrace_id),
        }
      );
    }
    return payload || {};
  };

  const exchangeCode = async ({ code, appId, appSecret, graphVersion }) => {
    const version = normalizeGraphVersion(graphVersion);
    const query = new URLSearchParams({
      client_id: clean(appId),
      client_secret: clean(appSecret),
      code: clean(code),
    });
    const payload = await request(`/${version}/oauth/access_token?${query.toString()}`);
    const accessToken = clean(payload.access_token);
    if (!accessToken) {
      throw new WhatsappGraphError('A Meta não retornou o token de acesso.', {
        code: 'WHATSAPP_ACCESS_TOKEN_MISSING',
      });
    }
    return {
      accessToken,
      tokenType: clean(payload.token_type),
      expiresIn: Number(payload.expires_in) || null,
    };
  };

  const subscribeWaba = async ({ wabaId, accessToken, graphVersion }) => {
    const version = normalizeGraphVersion(graphVersion);
    const payload = await request(`/${version}/${encodeURIComponent(clean(wabaId))}/subscribed_apps`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${clean(accessToken)}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });
    return { success: payload.success !== false, payload };
  };

  const getPhoneStatus = async ({ phoneNumberId, accessToken, graphVersion }) => {
    const version = normalizeGraphVersion(graphVersion);
    const fields = [
      'id',
      'display_phone_number',
      'verified_name',
      'quality_rating',
      'is_on_biz_app',
      'platform_type',
    ].join(',');
    const payload = await request(
      `/${version}/${encodeURIComponent(clean(phoneNumberId))}?fields=${encodeURIComponent(fields)}`,
      {
        headers: { Authorization: `Bearer ${clean(accessToken)}` },
      }
    );
    return {
      phoneNumberId: clean(payload.id) || clean(phoneNumberId),
      phoneNumber: clean(payload.display_phone_number),
      displayName: clean(payload.verified_name),
      qualityRating: clean(payload.quality_rating),
      isOnBizApp: payload.is_on_biz_app === true,
      platformType: clean(payload.platform_type),
      raw: payload,
    };
  };

  const startAppDataSync = async ({
    phoneNumberId,
    accessToken,
    graphVersion,
    syncType,
  }) => {
    if (!['smb_app_state_sync', 'history'].includes(syncType)) {
      throw new TypeError('Tipo de sincronização de coexistência inválido.');
    }
    const version = normalizeGraphVersion(graphVersion);
    const payload = await request(
      `/${version}/${encodeURIComponent(clean(phoneNumberId))}/smb_app_data`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${clean(accessToken)}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          sync_type: syncType,
        }),
      }
    );
    return {
      requestId: clean(
        payload.request_id
        || payload.id
        || payload.sync_request_id
        || payload.messaging_product
      ),
      payload,
    };
  };

  return {
    exchangeCode,
    subscribeWaba,
    getPhoneStatus,
    startAppDataSync,
  };
};

module.exports = {
  DEFAULT_GRAPH_VERSION,
  REQUIRED_WEBHOOK_FIELDS,
  WhatsappGraphError,
  createGraphClient,
  normalizeGraphVersion,
};
