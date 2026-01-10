const express = require('express');
const crypto = require('crypto');
const path = require('path');
const WhatsappIntegration = require('../models/WhatsappIntegration');
const WhatsappLog = require('../models/WhatsappLog');
const WhatsappContact = require('../models/WhatsappContact');
const { decryptText } = require('../utils/certificates');
const { isR2Configured, uploadBufferToR2 } = require('../utils/cloudflareR2');

const router = express.Router();

const GRAPH_BASE_URL = process.env.WHATSAPP_GRAPH_BASE_URL || 'https://graph.facebook.com/v20.0';
const AUTO_READ_ON_RECEIVE = false;

router.use(express.raw({ type: '*/*', limit: '2mb' }));

const trimValue = (value) => (typeof value === 'string' ? value.trim() : '');
const digitsOnly = (value) => String(value || '').replace(/\D+/g, '');

const MEDIA_FOLDERS = {
  image: 'images',
  audio: 'voices',
  video: 'videos',
  document: 'docs',
  sticker: 'stickers',
};

const MEDIA_MIME_EXTENSIONS = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'audio/ogg': '.ogg',
  'audio/mpeg': '.mp3',
  'audio/mp4': '.m4a',
  'audio/aac': '.aac',
  'audio/amr': '.amr',
  'video/mp4': '.mp4',
  'video/3gpp': '.3gp',
  'application/pdf': '.pdf',
};

const sanitizeKeySegment = (value, fallback = 'file') => {
  const cleaned = trimValue(value).replace(/[^0-9A-Za-z_-]+/g, '');
  const sliced = cleaned.slice(0, 120);
  return sliced || fallback;
};

const sanitizeFileName = (value, fallback = 'file') => {
  const raw = trimValue(value);
  if (!raw) return fallback;
  const base = path.basename(raw);
  const cleaned = base.replace(/[^0-9A-Za-z._-]+/g, '').slice(0, 160);
  return cleaned || fallback;
};

const resolveMediaExtension = (mimeType, filename) => {
  const safeName = sanitizeFileName(filename || '');
  const ext = safeName ? path.extname(safeName) : '';
  if (ext) return ext.toLowerCase();
  const normalized = trimValue(mimeType).toLowerCase();
  if (MEDIA_MIME_EXTENSIONS[normalized]) return MEDIA_MIME_EXTENSIONS[normalized];
  const subtype = normalized.split('/')[1] || '';
  const safe = subtype.replace(/[^0-9A-Za-z]+/g, '').slice(0, 8);
  return safe ? `.${safe}` : '.bin';
};

const resolveMediaCategory = (type) => MEDIA_FOLDERS[type] || 'files';

const resolveMediaDirectionSegment = (direction) => {
  const normalized = trimValue(direction).toLowerCase();
  if (normalized === 'outgoing' || normalized === 'sent' || normalized === 'enviado' || normalized === 'enviados') {
    return 'enviados';
  }
  return 'recebidos';
};

const buildWhatsappMediaKey = ({ storeId, waId, category, direction, fileName }) => {
  const storeSegment = sanitizeKeySegment(storeId, 'store');
  const phoneSegment = sanitizeKeySegment(waId, 'unknown');
  const folder = sanitizeKeySegment(category, 'files');
  const directionSegment = sanitizeKeySegment(resolveMediaDirectionSegment(direction), 'recebidos');
  const safeFileName = sanitizeFileName(fileName, 'file');
  return ['whatsapp', storeSegment, phoneSegment, folder, directionSegment, safeFileName].join('/');
};

const extractMediaPayload = (message = {}) => {
  const type = trimValue(message?.type);
  if (type === 'image' && message?.image?.id) {
    return {
      type,
      id: trimValue(message.image.id),
      mimeType: trimValue(message.image.mime_type),
      sha256: trimValue(message.image.sha256),
      caption: trimValue(message.image.caption),
    };
  }
  if (type === 'audio' && message?.audio?.id) {
    return {
      type,
      id: trimValue(message.audio.id),
      mimeType: trimValue(message.audio.mime_type),
      sha256: trimValue(message.audio.sha256),
      voice: Boolean(message.audio.voice),
    };
  }
  if (type === 'video' && message?.video?.id) {
    return {
      type,
      id: trimValue(message.video.id),
      mimeType: trimValue(message.video.mime_type),
      sha256: trimValue(message.video.sha256),
      caption: trimValue(message.video.caption),
    };
  }
  if (type === 'document' && message?.document?.id) {
    return {
      type,
      id: trimValue(message.document.id),
      mimeType: trimValue(message.document.mime_type),
      sha256: trimValue(message.document.sha256),
      caption: trimValue(message.document.caption),
      filename: sanitizeFileName(message.document.filename),
    };
  }
  if (type === 'sticker' && message?.sticker?.id) {
    return {
      type,
      id: trimValue(message.sticker.id),
      mimeType: trimValue(message.sticker.mime_type),
      sha256: trimValue(message.sticker.sha256),
      animated: Boolean(message.sticker.animated),
    };
  }
  return null;
};

const fetchGraphMediaInfo = async ({ mediaId, accessToken }) => {
  const id = trimValue(mediaId);
  if (!id || !accessToken) return null;
  const response = await fetch(`${GRAPH_BASE_URL}/${encodeURIComponent(id)}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch (_) {
    payload = null;
  }
  if (!response.ok || !payload) {
    return null;
  }
  return {
    url: trimValue(payload.url),
    mimeType: trimValue(payload.mime_type),
    sha256: trimValue(payload.sha256),
    fileSize: Number(payload.file_size) || null,
  };
};

const downloadGraphMedia = async ({ url, accessToken }) => {
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: '*/*',
    },
  });
  if (!response.ok) {
    throw new Error(`Falha ao baixar midia (${response.status})`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return {
    buffer: Buffer.from(arrayBuffer),
    contentType: trimValue(response.headers.get('content-type')),
  };
};

const storeWhatsappMedia = async ({ storeId, waId, messageId, media, accessToken, direction }) => {
  if (!isR2Configured()) return null;
  const info = await fetchGraphMediaInfo({ mediaId: media?.id, accessToken });
  if (!info?.url) return null;
  const download = await downloadGraphMedia({ url: info.url, accessToken });
  const mimeType = info.mimeType || media?.mimeType || download.contentType || 'application/octet-stream';
  const extension = resolveMediaExtension(mimeType, media?.filename);
  const baseName = sanitizeKeySegment(messageId || media?.id || `media-${Date.now()}`);
  const fileName = `${baseName}${extension}`;
  const category = resolveMediaCategory(media?.type || '');
  const key = buildWhatsappMediaKey({
    storeId,
    waId,
    category,
    direction,
    fileName,
  });
  const uploaded = await uploadBufferToR2(download.buffer, { key, contentType: mimeType });
  return {
    id: media?.id || '',
    type: media?.type || '',
    direction: direction || 'incoming',
    mimeType,
    caption: media?.caption || '',
    filename: media?.filename || '',
    sha256: media?.sha256 || info.sha256 || '',
    voice: Boolean(media?.voice),
    animated: Boolean(media?.animated),
    fileSize: info.fileSize || download.buffer.length || null,
    r2Key: uploaded.key,
    r2Url: uploaded.url,
  };
};

const clampText = (value, max = 1000) => {
  const text = trimValue(value);
  if (!text) return '';
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3)}...`;
};

const parseMessageTimestamp = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  const parsed = new Date(numeric * 1000);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const normalizeWebhookErrors = (errors) => {
  if (!Array.isArray(errors)) return [];
  return errors
    .filter(Boolean)
    .map((entry) => ({
      code: entry?.code ?? null,
      title: trimValue(entry?.title || entry?.message || ''),
      message: trimValue(entry?.message || ''),
      errorData: entry?.error_data || entry?.errorData || null,
    }));
};

const buildErrorSummary = (errors, fallback) => {
  const normalized = normalizeWebhookErrors(errors);
  if (!normalized.length) return fallback || 'Erro de webhook';
  const first = normalized[0];
  const code = first.code ? ` (${first.code})` : '';
  const title = first.title || first.message || fallback || 'Erro de webhook';
  return `${title}${code}`;
};

const buildNumberLabel = (displayName, phoneNumber, phoneNumberId) => {
  const name = trimValue(displayName);
  const phone = trimValue(phoneNumber);
  if (name && phone) return `${name} (${phone})`;
  if (name) return name;
  if (phone) return phone;
  if (phoneNumberId) return `ID ${phoneNumberId}`;
  return 'Numero';
};

const buildWhatsappRoomKey = (storeId, phoneNumberId) => {
  const store = trimValue(storeId);
  const phone = trimValue(phoneNumberId);
  if (!/^[a-fA-F0-9]{24}$/.test(store)) return '';
  if (!/^\d{6,}$/.test(phone)) return '';
  return `whatsapp:store:${store}:number:${phone}`;
};

const emitWhatsappMessage = (io, payload) => {
  if (!io || !payload) return;
  const room = buildWhatsappRoomKey(payload.storeId, payload.phoneNumberId);
  if (!room) return;
  io.to(room).emit('whatsapp:message', payload);
};

const resolveNumberMeta = (integration, phoneNumberId, phoneNumber) => {
  const numbers = Array.isArray(integration?.phoneNumbers) ? integration.phoneNumbers : [];
  const idText = trimValue(phoneNumberId);
  const phoneText = trimValue(phoneNumber);
  const matched = numbers.find((entry) => {
    if (!entry) return false;
    if (idText && String(entry.phoneNumberId) === idText) return true;
    if (phoneText && String(entry.phoneNumber) === phoneText) return true;
    return false;
  });

  const resolvedPhoneNumberId = trimValue(matched?.phoneNumberId) || idText;
  const resolvedPhoneNumber = trimValue(matched?.phoneNumber) || phoneText;
  const displayName = trimValue(matched?.displayName);
  const numberLabel = buildNumberLabel(displayName, resolvedPhoneNumber, resolvedPhoneNumberId);

  return {
    phoneNumberId: resolvedPhoneNumberId,
    phoneNumber: resolvedPhoneNumber,
    displayName,
    numberLabel,
  };
};

const extractMessageBody = (message = {}) => {
  if (message?.text?.body) return message.text.body;
  const type = trimValue(message?.type);

  if (type === 'image') return message?.image?.caption || '[imagem]';
  if (type === 'audio') return '[audio]';
  if (type === 'video') return message?.video?.caption || '[video]';
  if (type === 'document') return message?.document?.caption || message?.document?.filename || '[documento]';
  if (type === 'location') return '[localizacao]';
  if (type === 'contacts') return '[contato]';
  if (type === 'button') return message?.button?.text || '[botao]';
  if (type === 'interactive') {
    return (
      message?.interactive?.button_reply?.title ||
      message?.interactive?.list_reply?.title ||
      '[interativo]'
    );
  }

  return type ? `[${type}]` : '';
};

const compactObject = (data = {}) => {
  const result = {};
  Object.entries(data).forEach(([key, value]) => {
    if (value) result[key] = value;
  });
  return Object.keys(result).length > 0 ? result : null;
};

const normalizeContactList = (contacts = []) => {
  const list = Array.isArray(contacts) ? contacts : [];
  return list
    .map((contact) => {
      const name = compactObject({
        formatted_name: trimValue(contact?.name?.formatted_name || contact?.name?.formattedName),
        first_name: trimValue(contact?.name?.first_name || contact?.name?.firstName),
        last_name: trimValue(contact?.name?.last_name || contact?.name?.lastName),
        middle_name: trimValue(contact?.name?.middle_name || contact?.name?.middleName),
        suffix: trimValue(contact?.name?.suffix),
        prefix: trimValue(contact?.name?.prefix),
      });

      const phones = Array.isArray(contact?.phones)
        ? contact.phones
            .map((phone) =>
              compactObject({
                phone: trimValue(phone?.phone),
                type: trimValue(phone?.type),
                wa_id: digitsOnly(phone?.wa_id || phone?.waId || phone?.waID),
              })
            )
            .filter(Boolean)
        : [];

      const emails = Array.isArray(contact?.emails)
        ? contact.emails
            .map((email) =>
              compactObject({
                email: trimValue(email?.email),
                type: trimValue(email?.type),
              })
            )
            .filter(Boolean)
        : [];

      const addresses = Array.isArray(contact?.addresses)
        ? contact.addresses
            .map((address) =>
              compactObject({
                street: trimValue(address?.street),
                city: trimValue(address?.city),
                state: trimValue(address?.state),
                zip: trimValue(address?.zip),
                country: trimValue(address?.country),
                country_code: trimValue(address?.country_code || address?.countryCode),
                type: trimValue(address?.type),
              })
            )
            .filter(Boolean)
        : [];

      const urls = Array.isArray(contact?.urls)
        ? contact.urls
            .map((item) =>
              compactObject({
                url: trimValue(item?.url),
                type: trimValue(item?.type),
              })
            )
            .filter(Boolean)
        : [];

      const org = compactObject({
        company: trimValue(contact?.org?.company),
        department: trimValue(contact?.org?.department),
        title: trimValue(contact?.org?.title),
      });

      const payload = compactObject({
        birthday: trimValue(contact?.birthday),
      }) || {};
      if (name) payload.name = name;
      if (phones.length > 0) payload.phones = phones;
      if (emails.length > 0) payload.emails = emails;
      if (addresses.length > 0) payload.addresses = addresses;
      if (urls.length > 0) payload.urls = urls;
      if (org) payload.org = org;
      return Object.keys(payload).length > 0 ? payload : null;
    })
    .filter(Boolean);
};

const mapOutgoingStatus = (status = {}) => {
  const rawStatus = trimValue(status.status).toLowerCase();
  const errorSummary = buildErrorSummary(status.errors, 'Falha ao enviar');
  if (rawStatus === 'failed') {
    return {
      status: 'Erro',
      message: errorSummary || 'Falha ao enviar',
      rawStatus,
    };
  }
  if (rawStatus === 'delivered') {
    return { status: 'Entregue', message: 'Entregue', rawStatus };
  }
  if (rawStatus === 'read') {
    return { status: 'Lido', message: 'Lido', rawStatus };
  }
  if (rawStatus === 'sent') {
    return { status: 'Enviado', message: 'Enviado', rawStatus };
  }
  return {
    status: 'Enviado',
    message: rawStatus ? `Status ${rawStatus}` : 'Status enviado',
    rawStatus,
  };
};

const getRawBody = (req) => {
  if (req.rawBody && req.rawBody.length) return req.rawBody;
  if (Buffer.isBuffer(req.body)) return req.body;
  if (!req.body) return '';
  try {
    return Buffer.from(JSON.stringify(req.body));
  } catch (_) {
    return '';
  }
};

const parseBody = (req) => {
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

const extractPhoneNumberId = (entries = []) => {
  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      const value = change?.value || {};
      const metadata = value?.metadata || {};
      const phoneNumberId = trimValue(metadata.phone_number_id);
      if (phoneNumberId) return phoneNumberId;
    }
  }
  return '';
};

const decryptField = (encrypted, stored) => {
  if (!stored || !encrypted) return '';
  try {
    return decryptText(encrypted);
  } catch (_) {
    return '';
  }
};

const findIntegrationByVerifyToken = async (token) => {
  if (!token) return null;
  const docs = await WhatsappIntegration.find({
    verifyTokenStored: true,
  }).select('+verifyTokenEncrypted').lean();

  for (const doc of docs) {
    const current = decryptField(doc.verifyTokenEncrypted, doc.verifyTokenStored);
    if (current && current === token) {
      return doc;
    }
  }
  return null;
};

const verifySignature = (req, appSecret) => {
  const signature = trimValue(req.headers['x-hub-signature-256'] || '');
  if (!appSecret || !signature) return false;
  const rawBody = getRawBody(req);
  const expected = `sha256=${crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch (_) {
    return false;
  }
};

const sendReadReceipt = async ({ accessToken, phoneNumberId, messageId }) => {
  if (!accessToken || !phoneNumberId || !messageId) return false;
  try {
    const response = await fetch(`${GRAPH_BASE_URL}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
      }),
    });
    return response.ok;
  } catch (_) {
    return false;
  }
};

router.get('/', async (req, res) => {
  try {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    console.log('[webhook:whatsapp][received]', {
      method: req.method,
      path: req.originalUrl,
      mode,
    });

    if (mode !== 'subscribe' || !token) {
      return res.status(400).json({ message: 'Requisicao invalida.' });
    }

    const integration = await findIntegrationByVerifyToken(String(token));
    if (!integration) {
      return res.status(403).json({ message: 'Verify token invalido.' });
    }

    return res.status(200).send(challenge);
  } catch (error) {
    console.error('Erro ao validar webhook WhatsApp:', error);
    return res.status(500).json({ message: 'Erro ao validar webhook WhatsApp.' });
  }
});

router.post('/', async (req, res) => {
  try {
    const payload = parseBody(req);
    const objectType = trimValue(payload?.object);
    if (objectType && objectType !== 'whatsapp_business_account') {
      return res.status(400).json({ message: 'Objeto de webhook invalido.' });
    }
    const entries = Array.isArray(payload?.entry) ? payload.entry : [];
    const entry = entries[0] || null;
    let wabaId = entry?.id ? String(entry.id).trim() : '';
    const fallbackPhoneNumberId = extractPhoneNumberId(entries);

    console.log('[webhook:whatsapp][received]', {
      method: req.method,
      path: req.originalUrl,
      wabaId,
      entries: entries.length,
    });

    if (!wabaId && !fallbackPhoneNumberId) {
      return res.status(400).json({ message: 'WABA ID nao informado.' });
    }

    let integration = null;
    if (wabaId) {
      integration = await WhatsappIntegration.findOne({ wabaId }).select('+appSecretEncrypted +accessTokenEncrypted').lean();
    }
    if (!integration && fallbackPhoneNumberId) {
      integration = await WhatsappIntegration.findOne({ 'phoneNumbers.phoneNumberId': fallbackPhoneNumberId })
        .select('+appSecretEncrypted +accessTokenEncrypted')
        .lean();
      if (integration?.wabaId) {
        wabaId = String(integration.wabaId).trim();
      }
    }
    if (!integration) {
      console.warn('Webhook WhatsApp: integracao nao encontrada.', {
        wabaId,
        phoneNumberId: fallbackPhoneNumberId,
      });
      return res.status(404).json({ message: 'Integracao nao encontrada para este WABA.' });
    }

    const appSecret = decryptField(integration.appSecretEncrypted, integration.appSecretStored);
    if (!appSecret) {
      console.warn('Webhook WhatsApp: App Secret nao configurado.', { wabaId });
      return res.status(400).json({ message: 'App Secret nao configurado.' });
    }
    const signatureOk = verifySignature(req, appSecret);
    if (!signatureOk) {
      console.warn('Webhook WhatsApp: assinatura invalida.', { wabaId });
      return res.status(401).json({ message: 'Assinatura invalida.' });
    }

    const accessToken = decryptField(integration.accessTokenEncrypted, integration.accessTokenStored);

    const logs = [];
    const statusUpserts = [];
    const incomingUpserts = [];
    const incomingSeen = new Set();
    const realtimeEvents = [];
    const readReceipts = new Set();
    const contactUpdates = new Map();
    const statusContactOps = [];
    const touchedNumbers = new Set();
    const mediaTasks = [];
    const mediaByMessageId = new Map();
    const now = new Date();
    let incomingLogsCount = 0;
    let statusesCount = 0;
    let summaryNumberMeta = null;

    entries.forEach((entryItem) => {
      const changes = Array.isArray(entryItem?.changes) ? entryItem.changes : [];
      changes.forEach((change) => {
        const field = trimValue(change?.field);
        if (field && field !== 'messages') return;
        const value = change?.value || {};
        const contacts = Array.isArray(value?.contacts) ? value.contacts : [];
        const contactNames = new Map();
        contacts.forEach((contact) => {
          const waId = digitsOnly(contact?.wa_id || contact?.waId);
          if (!waId) return;
          const name = trimValue(contact?.profile?.name || contact?.name);
          if (name) {
            contactNames.set(waId, name);
          }
        });
        const metadata = value?.metadata || {};
        const phoneNumberId = trimValue(metadata.phone_number_id);
        const phoneNumber = trimValue(metadata.display_phone_number);
        const numberMeta = resolveNumberMeta(integration, phoneNumberId, phoneNumber);

        if (!summaryNumberMeta && (numberMeta.phoneNumberId || numberMeta.phoneNumber)) {
          summaryNumberMeta = numberMeta;
        }

        if (numberMeta.phoneNumberId) {
          touchedNumbers.add(numberMeta.phoneNumberId);
        }

        const valueErrors = Array.isArray(value?.errors) ? value.errors : [];
        if (valueErrors.length > 0) {
          logs.push({
            store: integration.store,
            direction: 'incoming',
            status: 'Erro',
            phoneNumberId: numberMeta.phoneNumberId,
            phoneNumber: numberMeta.phoneNumber,
            numberLabel: numberMeta.numberLabel,
            origin: '',
            destination: '',
            message: buildErrorSummary(valueErrors, 'Erro de webhook'),
            messageId: '',
            source: 'webhook',
            meta: {
              wabaId,
              errors: normalizeWebhookErrors(valueErrors),
            },
          });
        }

        if (Array.isArray(value.messages)) {
          value.messages.forEach((message) => {
            const origin = digitsOnly(message?.from) || trimValue(message?.from);
            const messageErrors = Array.isArray(message?.errors) ? message.errors : [];
            const messageType = trimValue(message?.type);
            const unsupported = messageType === 'unsupported';
            const hasErrors = unsupported || messageErrors.length > 0;
            const body = hasErrors
              ? buildErrorSummary(messageErrors, unsupported ? 'Mensagem nao suportada' : 'Erro na mensagem')
              : clampText(extractMessageBody(message));
            const messageId = trimValue(message?.id);
            const messageTimestamp = parseMessageTimestamp(message?.timestamp);
            const contactName = contactNames.get(origin) || '';
            const mediaPayload = extractMediaPayload(message);
            const contactPayload = messageType === 'contacts' ? normalizeContactList(message?.contacts) : [];
            if (messageId) {
              const dedupeKey = `${integration.store}:${messageId}`;
              if (incomingSeen.has(dedupeKey)) {
                return;
              }
              incomingSeen.add(dedupeKey);
            }
            const baseLog = {
              store: integration.store,
              direction: 'incoming',
              status: hasErrors ? 'Erro' : 'Recebido',
              phoneNumberId: numberMeta.phoneNumberId,
              phoneNumber: numberMeta.phoneNumber,
              numberLabel: numberMeta.numberLabel,
              origin,
              destination: numberMeta.phoneNumber,
              message: body || '[mensagem]',
              messageId,
              messageTimestamp,
              source: 'webhook',
              meta: {
                wabaId,
                messageType,
                errors: normalizeWebhookErrors(messageErrors),
                unsupported,
              },
            };
            if (mediaPayload) {
              baseLog.meta.media = mediaPayload;
            }
            if (contactPayload.length > 0) {
              baseLog.meta.contacts = contactPayload;
            }
            if (messageId) {
              incomingUpserts.push({
                updateOne: {
                  filter: { store: integration.store, direction: 'incoming', messageId },
                  update: {
                    $set: {
                      status: baseLog.status,
                      phoneNumberId: baseLog.phoneNumberId,
                      phoneNumber: baseLog.phoneNumber,
                      numberLabel: baseLog.numberLabel,
                      origin: baseLog.origin,
                      destination: baseLog.destination,
                      message: baseLog.message,
                      messageTimestamp: baseLog.messageTimestamp,
                      source: baseLog.source,
                      meta: baseLog.meta,
                      updatedAt: now,
                    },
                    $setOnInsert: {
                      store: integration.store,
                      direction: 'incoming',
                      messageId,
                      createdAt: now,
                    },
                  },
                  upsert: true,
                },
              });
            } else {
              logs.push(baseLog);
            }
            incomingLogsCount += 1;

            if (AUTO_READ_ON_RECEIVE && messageId && numberMeta.phoneNumberId && accessToken) {
              readReceipts.add(`${numberMeta.phoneNumberId}:${messageId}`);
            }

            if (origin && numberMeta.phoneNumberId) {
              realtimeEvents.push({
                storeId: String(integration.store),
                phoneNumberId: numberMeta.phoneNumberId,
                waId: origin,
                name: contactName,
                direction: 'incoming',
                status: baseLog.status,
                message: baseLog.message,
                messageId: baseLog.messageId,
                origin,
                destination: numberMeta.phoneNumber,
                createdAt: (messageTimestamp || now).toISOString(),
                contacts: contactPayload.length > 0 ? contactPayload : undefined,
                media: mediaPayload || undefined,
              });
            }

            if (origin && numberMeta.phoneNumberId) {
              const contactKey = `${numberMeta.phoneNumberId}:${origin}`;
              const messageAt = messageTimestamp || now;
              const current = contactUpdates.get(contactKey);
              const next = current
                ? { ...current }
                : {
                    store: integration.store,
                    phoneNumberId: numberMeta.phoneNumberId,
                    waId: origin,
                    name: contactName,
                    lastMessage: body || '[mensagem]',
                    lastMessageAt: messageAt,
                    lastDirection: 'incoming',
                    lastMessageId: messageId,
                    unreadIncrement: 0,
                  };

              if (!current || messageAt >= current.lastMessageAt) {
                next.lastMessage = body || '[mensagem]';
                next.lastMessageAt = messageAt;
                next.lastDirection = 'incoming';
                next.lastMessageId = messageId;
              }
              if (contactName) {
                next.name = contactName;
              }
              next.unreadIncrement = (current?.unreadIncrement || 0) + 1;
              contactUpdates.set(contactKey, next);
            }
          });
        }

        if (Array.isArray(value.statuses)) {
          statusesCount += value.statuses.length;
          value.statuses.forEach((statusItem) => {
            const statusInfo = mapOutgoingStatus(statusItem || {});
            const destination = trimValue(statusItem?.recipient_id);
            const messageId = trimValue(statusItem?.id);
            const statusTimestamp = parseMessageTimestamp(statusItem?.timestamp);
            const metaStatus = trimValue(statusItem?.status);
            const metaRawStatus = statusInfo.rawStatus || trimValue(statusItem?.status);
            const metaErrors = normalizeWebhookErrors(statusItem?.errors);

            if (messageId) {
              statusUpserts.push({
                updateOne: {
                  filter: { store: integration.store, direction: 'outgoing', messageId },
                  update: {
                    $set: {
                      status: statusInfo.status,
                      statusTimestamp,
                      phoneNumberId: numberMeta.phoneNumberId,
                      phoneNumber: numberMeta.phoneNumber,
                      numberLabel: numberMeta.numberLabel,
                      origin: numberMeta.phoneNumber,
                      destination,
                      'meta.wabaId': wabaId,
                      'meta.status': metaStatus,
                      'meta.rawStatus': metaRawStatus,
                      'meta.errors': metaErrors,
                      updatedAt: now,
                    },
                    $setOnInsert: {
                      store: integration.store,
                      direction: 'outgoing',
                      messageId,
                      message: clampText(statusInfo.message),
                      source: 'webhook',
                      createdAt: now,
                    },
                  },
                  upsert: true,
                },
              });
              if (numberMeta.phoneNumberId) {
                realtimeEvents.push({
                  storeId: String(integration.store),
                  phoneNumberId: numberMeta.phoneNumberId,
                  waId: destination,
                  direction: 'outgoing',
                  status: statusInfo.status,
                  messageId,
                  statusTimestamp: statusTimestamp ? statusTimestamp.toISOString() : null,
                });
              }
              if (numberMeta.phoneNumberId && destination) {
                statusContactOps.push({
                  updateOne: {
                    filter: {
                      store: integration.store,
                      phoneNumberId: numberMeta.phoneNumberId,
                      waId: destination,
                      lastMessageId: messageId,
                    },
                    update: {
                      $set: {
                        lastStatus: statusInfo.status,
                        updatedAt: now,
                      },
                    },
                  },
                });
              }
              return;
            }

            logs.push({
              store: integration.store,
              direction: 'outgoing',
              status: statusInfo.status,
              phoneNumberId: numberMeta.phoneNumberId,
              phoneNumber: numberMeta.phoneNumber,
              numberLabel: numberMeta.numberLabel,
              origin: numberMeta.phoneNumber,
              destination,
              message: clampText(statusInfo.message),
              messageId: '',
              statusTimestamp,
              source: 'webhook',
              meta: {
                wabaId,
                status: metaStatus,
                rawStatus: metaRawStatus,
                errors: metaErrors,
              },
            });
          });
        }
      });
    });

    if (incomingLogsCount === 0) {
      const summaryMeta = {
        wabaId,
        entries: entries.length,
        statuses: statusesCount,
      };
      logs.push({
        store: integration.store,
        direction: 'incoming',
        status: 'Recebido',
        phoneNumberId: summaryNumberMeta?.phoneNumberId || '',
        phoneNumber: summaryNumberMeta?.phoneNumber || '',
        numberLabel: summaryNumberMeta?.numberLabel || 'Webhook',
        origin: 'webhook',
        destination: summaryNumberMeta?.phoneNumber || '',
        message: 'Webhook recebido',
        messageId: '',
        source: 'webhook',
        meta: summaryMeta,
      });
    }

    if (logs.length > 0) {
      await WhatsappLog.insertMany(logs);
    }

    if (statusUpserts.length > 0) {
      await WhatsappLog.bulkWrite(statusUpserts);
    }

    if (incomingUpserts.length > 0) {
      await WhatsappLog.bulkWrite(incomingUpserts, { ordered: false });
    }

    if (mediaTasks.length > 0 && accessToken && isR2Configured()) {
      const results = await Promise.allSettled(
        mediaTasks.map((task) => storeWhatsappMedia({ ...task, accessToken }))
      );
      const mediaUpdates = [];
      results.forEach((result, index) => {
        const task = mediaTasks[index];
        if (result.status === 'fulfilled' && result.value) {
          mediaByMessageId.set(task.messageId, result.value);
          mediaUpdates.push({
            updateOne: {
              filter: { store: integration.store, direction: 'incoming', messageId: task.messageId },
              update: {
                $set: { 'meta.media': result.value, updatedAt: now },
              },
            },
          });
          return;
        }
        if (result.status === 'rejected') {
          console.error('Erro ao armazenar midia WhatsApp:', result.reason);
        }
      });
      if (mediaUpdates.length > 0) {
        await WhatsappLog.bulkWrite(mediaUpdates, { ordered: false });
      }
    }

    if (readReceipts.size > 0 && accessToken) {
      const tasks = Array.from(readReceipts).map((entry) => {
        const [phoneNumberId, messageId] = entry.split(':');
        if (!phoneNumberId || !messageId) return Promise.resolve(false);
        return sendReadReceipt({ accessToken, phoneNumberId, messageId });
      });
      await Promise.allSettled(tasks);
    }

    if (contactUpdates.size > 0) {
      const contactOps = [];
      contactUpdates.forEach((contact) => {
        if (!contact.phoneNumberId || !contact.waId) return;
        const update = {
          $set: {
            lastMessage: contact.lastMessage,
            lastMessageAt: contact.lastMessageAt,
            lastDirection: contact.lastDirection,
            lastMessageId: contact.lastMessageId,
            updatedAt: now,
          },
          $setOnInsert: {
            store: contact.store,
            phoneNumberId: contact.phoneNumberId,
            waId: contact.waId,
            createdAt: now,
          },
        };
        const unreadIncrement = Number(contact.unreadIncrement) || 0;
        if (unreadIncrement > 0) {
          update.$inc = { unreadCount: unreadIncrement };
        }
        if (contact.name) {
          update.$set.name = contact.name;
        }
        contactOps.push({
          updateOne: {
            filter: {
              store: contact.store,
              phoneNumberId: contact.phoneNumberId,
              waId: contact.waId,
            },
            update,
            upsert: true,
          },
        });
      });

      if (contactOps.length > 0) {
        await WhatsappContact.bulkWrite(contactOps, { ordered: false });
      }
    }

    if (statusContactOps.length > 0) {
      await WhatsappContact.bulkWrite(statusContactOps, { ordered: false });
    }

    if (mediaByMessageId.size > 0) {
      realtimeEvents.forEach((event) => {
        if (!event?.messageId) return;
        const media = mediaByMessageId.get(event.messageId);
        if (media) {
          event.media = media;
        }
      });
    }

    if (realtimeEvents.length > 0) {
      const io = req.app?.get('socketio');
      if (io) {
        const emitted = new Set();
        realtimeEvents.forEach((event) => {
          const direction = event.direction || 'incoming';
          const messageKey = event.messageId ? String(event.messageId) : '';
          const timeKey = event.createdAt || event.statusTimestamp || '';
          const statusKey = event.status || '';
          const key = direction === 'incoming'
            ? (messageKey ? `incoming:${messageKey}` : `incoming:${event.waId}:${timeKey}`)
            : (messageKey ? `outgoing:${messageKey}:${statusKey}` : `outgoing:${event.waId}:${timeKey}`);
          if (emitted.has(key)) return;
          emitted.add(key);
          emitWhatsappMessage(io, event);
        });
      }
    }

    if (touchedNumbers.size > 0) {
      const updates = Array.from(touchedNumbers).map((id) =>
        WhatsappIntegration.updateOne(
          { _id: integration._id, 'phoneNumbers.phoneNumberId': id },
          { $set: { 'phoneNumbers.$.lastSyncAt': now } }
        )
      );
      await Promise.all(updates);
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Erro ao processar webhook WhatsApp:', error);
    return res.status(500).json({ message: 'Erro ao processar webhook WhatsApp.' });
  }
});

module.exports = router;
