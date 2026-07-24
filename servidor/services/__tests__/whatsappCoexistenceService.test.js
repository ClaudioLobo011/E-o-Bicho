const test = require('node:test');
const assert = require('node:assert/strict');

const {
  WhatsappGraphError,
  createGraphClient,
  normalizeGraphVersion,
} = require('../whatsappCoexistenceService');

const jsonResponse = (payload, status = 200) => new Response(
  JSON.stringify(payload),
  {
    status,
    headers: { 'content-type': 'application/json' },
  }
);

test('normaliza a versão Graph e usa v25.0 como padrão seguro', () => {
  assert.equal(normalizeGraphVersion('v25.0'), 'v25.0');
  assert.equal(normalizeGraphVersion('versao-invalida'), 'v25.0');
});

test('executa troca de código, assinatura, diagnóstico e sincronizações da coexistência', async () => {
  const calls = [];
  const responses = [
    jsonResponse({ access_token: 'business-token', token_type: 'bearer' }),
    jsonResponse({ success: true }),
    jsonResponse({
      id: '109876543210',
      display_phone_number: '+55 11 99999-0001',
      verified_name: 'Loja A',
      quality_rating: 'GREEN',
      is_on_biz_app: true,
      platform_type: 'CLOUD_API',
    }),
    jsonResponse({ request_id: 'contacts-request' }),
    jsonResponse({ request_id: 'history-request' }),
  ];
  const graph = createGraphClient({
    graphOrigin: 'https://graph.test',
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      return responses.shift();
    },
  });

  const token = await graph.exchangeCode({
    code: 'temporary-code',
    appId: 'app-id',
    appSecret: 'app-secret',
    graphVersion: 'v25.0',
  });
  await graph.subscribeWaba({
    wabaId: 'waba-id',
    accessToken: token.accessToken,
    graphVersion: 'v25.0',
  });
  const status = await graph.getPhoneStatus({
    phoneNumberId: '109876543210',
    accessToken: token.accessToken,
    graphVersion: 'v25.0',
  });
  const contacts = await graph.startAppDataSync({
    phoneNumberId: status.phoneNumberId,
    accessToken: token.accessToken,
    graphVersion: 'v25.0',
    syncType: 'smb_app_state_sync',
  });
  const history = await graph.startAppDataSync({
    phoneNumberId: status.phoneNumberId,
    accessToken: token.accessToken,
    graphVersion: 'v25.0',
    syncType: 'history',
  });

  assert.equal(token.accessToken, 'business-token');
  assert.equal(status.isOnBizApp, true);
  assert.equal(status.platformType, 'CLOUD_API');
  assert.equal(contacts.requestId, 'contacts-request');
  assert.equal(history.requestId, 'history-request');
  assert.match(calls[0].url, /\/v25\.0\/oauth\/access_token\?/);
  assert.equal(calls[1].options.headers.Authorization, 'Bearer business-token');
  assert.deepEqual(JSON.parse(calls[3].options.body), {
    messaging_product: 'whatsapp',
    sync_type: 'smb_app_state_sync',
  });
  assert.deepEqual(JSON.parse(calls[4].options.body), {
    messaging_product: 'whatsapp',
    sync_type: 'history',
  });
});

test('erro da Meta é exposto sem devolver token ou App Secret', async () => {
  const graph = createGraphClient({
    graphOrigin: 'https://graph.test',
    fetchImpl: async () => jsonResponse({
      error: {
        message: 'Código expirado',
        code: 190,
        error_subcode: 123,
        fbtrace_id: 'trace-id',
      },
    }, 400),
  });

  await assert.rejects(
    graph.exchangeCode({
      code: 'temporary-code',
      appId: 'app-id',
      appSecret: 'segredo-que-nao-pode-vazar',
      graphVersion: 'v25.0',
    }),
    (error) => {
      assert.equal(error instanceof WhatsappGraphError, true);
      assert.equal(error.graphCode, 190);
      assert.equal(error.graphSubcode, 123);
      assert.equal(error.message.includes('segredo-que-nao-pode-vazar'), false);
      return true;
    }
  );
});
