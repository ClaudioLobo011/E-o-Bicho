const path = require('path');
const dotenv = require('dotenv');
const mongoose = require('mongoose');

dotenv.config({ path: path.resolve(__dirname, '..', '.env'), quiet: true });

const WhatsappIntegration = require('../models/WhatsappIntegration');
const { resolveVilaIsabelSender } = require('../services/whatsappOtpProvider');

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  const sender = await resolveVilaIsabelSender();
  const integration = await WhatsappIntegration.findOne({ store: sender.storeId }).lean();
  const templateName = process.env.AUTH_PHONE_OTP_WHATSAPP_TEMPLATE || 'codigo_acesso_e_o_bicho';
  const templateFilter = process.argv.includes('--all') ? '' : `&name=${encodeURIComponent(templateName)}`;
  const url = `https://graph.facebook.com/${sender.graphVersion}/${encodeURIComponent(integration.wabaId)}/message_templates?limit=100${templateFilter}`;
  let response = await fetch(url, {
    headers: { Authorization: `Bearer ${sender.accessToken}` },
  });
  let payload = await response.json().catch(() => ({}));
  let created = null;
  if (process.argv.includes('--create') && response.ok && !(payload.data || []).length) {
    const createResponse = await fetch(
      `https://graph.facebook.com/${sender.graphVersion}/${encodeURIComponent(integration.wabaId)}/message_templates`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${sender.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: templateName,
          language: process.env.AUTH_PHONE_OTP_WHATSAPP_LANGUAGE || 'pt_BR',
          category: 'AUTHENTICATION',
          message_send_ttl_seconds: 300,
          components: [
            { type: 'BODY', add_security_recommendation: true },
            { type: 'FOOTER', code_expiration_minutes: 5 },
            {
              type: 'BUTTONS',
              buttons: [{ type: 'OTP', otp_type: 'COPY_CODE', text: 'Copiar código' }],
            },
          ],
        }),
      }
    );
    const createPayload = await createResponse.json().catch(() => ({}));
    created = {
      status: createResponse.status,
      id: createPayload.id || '',
      templateStatus: createPayload.status || '',
      category: createPayload.category || '',
      error: createPayload.error?.message || '',
    };
    if (createResponse.ok) {
      response = await fetch(url, { headers: { Authorization: `Bearer ${sender.accessToken}` } });
      payload = await response.json().catch(() => ({}));
    }
  }
  console.log(JSON.stringify({
    configuration: {
      storeId: sender.storeId,
      sender: sender.sender,
      phoneNumberId: sender.phoneNumberId,
      graphVersion: sender.graphVersion,
      wabaConfigured: Boolean(integration.wabaId),
      tokenConfigured: Boolean(sender.accessToken),
    },
    metaStatus: response.status,
    templates: (payload.data || []).map((template) => ({
      name: template.name,
      status: template.status,
      category: template.category,
      language: template.language,
      components: (template.components || []).map((component) => component.type),
    })),
    created,
    error: payload.error?.message || '',
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(JSON.stringify({ error: error.message, code: error.code || '' }));
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect().catch(() => {}));
