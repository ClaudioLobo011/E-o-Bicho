const Store = require('../models/Store');
const WhatsappIntegration = require('../models/WhatsappIntegration');
const { decryptText } = require('../utils/certificates');

const digitsOnly = (value) => String(value || '').replace(/\D/g, '');
const clean = (value) => String(value || '').trim();
const escapeRegex = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function buildAuthenticationTemplatePayload({ destination, code, templateName, language = 'pt_BR' }) {
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: digitsOnly(destination),
    type: 'template',
    template: {
      name: clean(templateName),
      language: { code: clean(language) || 'pt_BR' },
      components: [
        {
          type: 'body',
          parameters: [{ type: 'text', text: String(code) }],
        },
        {
          type: 'button',
          sub_type: 'url',
          index: '0',
          parameters: [{ type: 'text', text: String(code) }],
        },
      ],
    },
  };
}

async function resolveVilaIsabelSender() {
  const configuredStoreId = clean(process.env.AUTH_PHONE_OTP_WHATSAPP_STORE_ID);
  const configuredStoreName = clean(process.env.AUTH_PHONE_OTP_WHATSAPP_STORE_NAME || 'Vila Isabel');
  const configuredSender = digitsOnly(process.env.AUTH_PHONE_OTP_WHATSAPP_SENDER || '5521964141210');

  const store = configuredStoreId
    ? await Store.findById(configuredStoreId).lean()
    : await Store.findOne({
      $or: [
        { nome: new RegExp(escapeRegex(configuredStoreName), 'i') },
        { nomeFantasia: new RegExp(escapeRegex(configuredStoreName), 'i') },
      ],
    }).lean();
  if (!store?._id) {
    const error = new Error('A loja de Vila Isabel não foi encontrada para enviar o código.');
    error.code = 'PHONE_OTP_WHATSAPP_STORE_NOT_FOUND';
    throw error;
  }

  const integration = await WhatsappIntegration.findOne({ store: store._id })
    .select('+accessTokenEncrypted')
    .lean();
  if (!integration) {
    const error = new Error('O WhatsApp de Vila Isabel não está configurado.');
    error.code = 'PHONE_OTP_WHATSAPP_NOT_CONFIGURED';
    throw error;
  }

  const phoneNumber = (integration.phoneNumbers || []).find((entry) => (
    digitsOnly(entry?.phoneNumber) === configuredSender
  ));
  if (!phoneNumber?.phoneNumberId) {
    const error = new Error('O número autorizado de Vila Isabel não está disponível na integração.');
    error.code = 'PHONE_OTP_WHATSAPP_SENDER_NOT_FOUND';
    throw error;
  }

  let accessToken = '';
  try {
    accessToken = integration.accessTokenStored && integration.accessTokenEncrypted
      ? decryptText(integration.accessTokenEncrypted)
      : '';
  } catch (_) {
    accessToken = '';
  }
  if (!accessToken) {
    const error = new Error('O token do WhatsApp de Vila Isabel não está disponível.');
    error.code = 'PHONE_OTP_WHATSAPP_TOKEN_NOT_AVAILABLE';
    throw error;
  }

  return {
    accessToken,
    phoneNumberId: clean(phoneNumber.phoneNumberId),
    sender: configuredSender,
    storeId: String(store._id),
    graphVersion: clean(integration.graphApiVersion || process.env.WHATSAPP_GRAPH_API_VERSION || 'v25.0'),
  };
}

async function sendWhatsappOtp({ phone, code }) {
  const templateName = clean(process.env.AUTH_PHONE_OTP_WHATSAPP_TEMPLATE || 'codigo_acesso_e_o_bicho');
  const language = clean(process.env.AUTH_PHONE_OTP_WHATSAPP_LANGUAGE || 'pt_BR');
  const sender = await resolveVilaIsabelSender();
  const graphOrigin = clean(process.env.WHATSAPP_GRAPH_ORIGIN || 'https://graph.facebook.com');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(
      `${graphOrigin}/${sender.graphVersion}/${encodeURIComponent(sender.phoneNumberId)}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${sender.accessToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(buildAuthenticationTemplatePayload({
          destination: `55${digitsOnly(phone)}`,
          code,
          templateName,
          language,
        })),
        signal: controller.signal,
      }
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(
        clean(payload?.error?.message)
        || `A Meta recusou o código de acesso (${response.status}).`
      );
      error.code = 'PHONE_OTP_SEND_FAILED';
      error.providerStatus = response.status;
      throw error;
    }
    return {
      provider: 'whatsapp',
      messageId: clean(payload?.messages?.[0]?.id),
      sender: sender.sender,
    };
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  buildAuthenticationTemplatePayload,
  resolveVilaIsabelSender,
  sendWhatsappOtp,
};
