const express = require('express');
const crypto = require('crypto');
const mongoose = require('mongoose');
const multer = require('multer');
const { Blob } = require('buffer');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, spawnSync } = require('child_process');
const FFMPEG_STATIC_PATH = (() => {
  try {
    const resolved = require('ffmpeg-static');
    return typeof resolved === 'string' ? resolved : '';
  } catch (_) {
    return '';
  }
})();
const router = express.Router();
const Store = require('../models/Store');
const WhatsappIntegration = require('../models/WhatsappIntegration');
const WhatsappLog = require('../models/WhatsappLog');
const WhatsappMessageHistoryEvent = require('../models/WhatsappMessageHistoryEvent');
const WhatsappContact = require('../models/WhatsappContact');
const User = require('../models/User');
const { encryptText, decryptText } = require('../utils/certificates');
const { isR2Configured, uploadBufferToR2, getObjectFromR2 } = require('../utils/cloudflareR2');
const requireAuth = require('../middlewares/requireAuth');
const authorizeRoles = require('../middlewares/authorizeRoles');

const SECRET_SELECT = '+appSecretEncrypted +accessTokenEncrypted +verifyTokenEncrypted';
const LOG_LIMIT_DEFAULT = 50;
const LOG_LIMIT_MAX = 200;
const MESSAGE_HISTORY_LIMIT_DEFAULT = 25;
const MESSAGE_HISTORY_LIMIT_MAX = 100;
const GRAPH_BASE_URL = process.env.WHATSAPP_GRAPH_BASE_URL || 'https://graph.facebook.com/v20.0';
const GRAPH_WEBHOOK_VERSION = process.env.WHATSAPP_GRAPH_WEBHOOK_VERSION || 'v24.0';
const GRAPH_WEBHOOK_BASE_URL = `https://graph.facebook.com/${GRAPH_WEBHOOK_VERSION}`;
const GRAPH_CONTACTS_BASE_URL = process.env.WHATSAPP_CONTACTS_GRAPH_URL || GRAPH_WEBHOOK_BASE_URL;
const SEND_TIMEOUT_MS = Number.parseInt(process.env.WHATSAPP_SEND_TIMEOUT_MS, 10) || 15000;
const BUSINESS_PROFILE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const IMAGE_MESSAGE_MAX_BYTES = 5 * 1024 * 1024;
const AUDIO_MESSAGE_MAX_BYTES = 16 * 1024 * 1024;
const DOCUMENT_MESSAGE_MAX_BYTES = 100 * 1024 * 1024;
const AUDIO_INPUT_MIME_TYPES = new Set([
  'audio/aac',
  'audio/amr',
  'audio/mpeg',
  'audio/mp4',
  'audio/webm',
  'audio/ogg',
  'audio/m4a',
  'audio/x-m4a',
]);
const DOCUMENT_MIME_TYPES = new Set([
  'text/plain',
  'text/csv',
  'text/xml',
  'application/pdf',
  'application/json',
  'application/xml',
  'application/msword',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/csv',
  'application/zip',
  'application/x-zip-compressed',
  'application/x-7z-compressed',
  'application/x-rar-compressed',
  'application/vnd.rar',
]);
const GRAPH_AUDIO_MIME_TYPES = new Set([
  'audio/aac',
  'audio/amr',
  'audio/mpeg',
  'audio/mp4',
  'audio/ogg',
]);
const GRAPH_DOCUMENT_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
]);
const TEXT_DOCUMENT_MIME_TYPES = new Set([
  'text/plain',
  'text/csv',
  'text/xml',
  'application/json',
  'application/xml',
  'application/csv',
]);
const TEXT_DOCUMENT_EXTENSIONS = new Set([
  '.txt',
  '.csv',
  '.xml',
  '.json',
]);
const IMAGE_INPUT_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: BUSINESS_PROFILE_IMAGE_MAX_BYTES },
});

const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: AUDIO_MESSAGE_MAX_BYTES },
});

const documentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: DOCUMENT_MESSAGE_MAX_BYTES },
});

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: IMAGE_MESSAGE_MAX_BYTES },
});

const sanitizeString = (value) => (typeof value === 'string' ? value.trim() : '');
const digitsOnly = (value) => String(value || '').replace(/\D+/g, '');
const normalizePin = (value) => {
  const digits = digitsOnly(value);
  return digits.length === 6 ? digits : '';
};
const LOCALIZATION_REGIONS = new Set([
  'APAC',
  'AU',
  'ID',
  'IN',
  'JP',
  'SG',
  'KR',
  'DE',
  'CH',
  'GB',
  'LATAM',
  'BR',
  'EMEA',
  'BH',
  'ZA',
  'AE',
  'NORAM',
  'CA',
]);
const normalizeLocalizationRegion = (value) => {
  const normalized = sanitizeString(value).toUpperCase();
  return LOCALIZATION_REGIONS.has(normalized) ? normalized : '';
};

const decryptField = (encrypted, stored) => {
  if (!stored || !encrypted) return '';
  try {
    return decryptText(encrypted);
  } catch (_) {
    return '';
  }
};

const buildResponse = (doc) => {
  return {
    storeId: String(doc.store),
    appId: doc.appId || '',
    wabaId: doc.wabaId || '',
    appSecret: decryptField(doc.appSecretEncrypted, doc.appSecretStored),
    accessToken: decryptField(doc.accessTokenEncrypted, doc.accessTokenStored),
    verifyToken: decryptField(doc.verifyTokenEncrypted, doc.verifyTokenStored),
    phoneNumbers: Array.isArray(doc.phoneNumbers)
      ? doc.phoneNumbers.map((number) => ({
          id: number._id ? String(number._id) : undefined,
          phoneNumberId: number.phoneNumberId || '',
          phoneNumber: number.phoneNumber || '',
          displayName: number.displayName || '',
          pin: number.pin || '',
          status: number.status || 'Pendente',
          provider: number.provider || 'Meta Cloud API',
          lastSyncAt: number.lastSyncAt ? number.lastSyncAt.toISOString() : null,
        }))
      : [],
  };
};

const normalizeStatus = (value) => {
  const allowed = new Set(['Conectado', 'Desconectado', 'Pendente']);
  const normalized = sanitizeString(value);
  return allowed.has(normalized) ? normalized : 'Pendente';
};

const normalizeProvider = (value) => sanitizeString(value) || 'Meta Cloud API';

const normalizeDate = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const mapPhoneNumbers = (numbers) => {
  if (!Array.isArray(numbers)) return [];
  return numbers
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const phoneNumberId = sanitizeString(entry.phoneNumberId);
      if (!phoneNumberId) return null;
      const payload = {
        phoneNumberId,
        phoneNumber: sanitizeString(entry.phoneNumber),
        displayName: sanitizeString(entry.displayName),
        pin: normalizePin(entry.pin),
        status: normalizeStatus(entry.status),
        provider: normalizeProvider(entry.provider),
        lastSyncAt: normalizeDate(entry.lastSyncAt),
      };
      if (entry.id && mongoose.Types.ObjectId.isValid(entry.id)) {
        payload._id = entry.id;
      }
      return payload;
    })
    .filter(Boolean);
};

async function findIntegration(storeId) {
  return WhatsappIntegration.findOne({ store: storeId }).select(SECRET_SELECT);
}

const normalizeDirection = (value) => {
  const direction = sanitizeString(value);
  return direction === 'incoming' || direction === 'outgoing' ? direction : '';
};

const normalizeLogStatus = (direction, value) => {
  const status = sanitizeString(value);
  const allowed = new Set(['Enviado', 'Erro', 'Recebido']);
  if (allowed.has(status)) return status;
  return direction === 'incoming' ? 'Recebido' : 'Enviado';
};

const normalizeLogText = (value, max = 1000) => {
  const text = sanitizeString(value);
  if (!text) return '';
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3)}...`;
};

const buildNumberLabel = (displayName, phoneNumber, phoneNumberId) => {
  const name = sanitizeString(displayName);
  const phone = sanitizeString(phoneNumber);
  if (name && phone) return `${name} (${phone})`;
  if (name) return name;
  if (phone) return phone;
  if (phoneNumberId) return `ID ${phoneNumberId}`;
  return 'Numero';
};

const buildWhatsappRoomKey = (storeId, phoneNumberId) => {
  const store = sanitizeString(storeId);
  const phone = sanitizeString(phoneNumberId);
  if (!/^[a-fA-F0-9]{24}$/.test(store)) return '';
  if (!/^\d{6,}$/.test(phone)) return '';
  return `whatsapp:store:${store}:number:${phone}`;
};

const emitWhatsappSocketEvent = (req, payload) => {
  const io = req.app?.get('socketio');
  if (!io || !payload) return;
  const room = buildWhatsappRoomKey(payload.storeId, payload.phoneNumberId);
  if (!room) return;
  io.to(room).emit('whatsapp:message', payload);
};

const resolveNumberMeta = (integration, payload = {}) => {
  const numbers = Array.isArray(integration?.phoneNumbers) ? integration.phoneNumbers : [];
  const payloadNumberId = sanitizeString(payload.numberId);
  const payloadPhoneNumberId = sanitizeString(payload.phoneNumberId);
  const payloadPhoneNumber = sanitizeString(payload.phoneNumber);

  let matched = null;
  if (payloadNumberId && mongoose.Types.ObjectId.isValid(payloadNumberId)) {
    matched = numbers.find((entry) => entry?._id && String(entry._id) === payloadNumberId);
  }

  if (!matched && payloadPhoneNumberId) {
    matched = numbers.find((entry) => String(entry?.phoneNumberId || '') === payloadPhoneNumberId);
  }

  if (!matched && payloadPhoneNumber) {
    matched = numbers.find((entry) => String(entry?.phoneNumber || '') === payloadPhoneNumber);
  }

  const resolvedPhoneNumberId = sanitizeString(matched?.phoneNumberId) || payloadPhoneNumberId;
  const resolvedPhoneNumber = sanitizeString(matched?.phoneNumber) || payloadPhoneNumber;
  const displayName = sanitizeString(matched?.displayName);
  const customLabel = sanitizeString(payload.numberLabel);
  const numberLabel = customLabel || buildNumberLabel(displayName, resolvedPhoneNumber, resolvedPhoneNumberId);

  return {
    phoneNumberId: resolvedPhoneNumberId,
    phoneNumber: resolvedPhoneNumber,
    displayName,
    numberLabel,
  };
};

const resolveLimit = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return LOG_LIMIT_DEFAULT;
  return Math.min(Math.floor(parsed), LOG_LIMIT_MAX);
};

const inferMediaTypeFromLog = (log) => {
  const message = sanitizeString(log?.message).toLowerCase();
  if (message === '[voz]' || message === '[audio]') return 'audio';
  if (message === '[imagem]') return 'image';
  if (message === '[video]') return 'video';
  if (message === '[documento]') return 'document';
  if (message === '[sticker]') return 'sticker';
  return '';
};

const buildMediaResponse = (log) => {
  if (!log || typeof log !== 'object') return null;
  const meta = log.meta && typeof log.meta === 'object' ? log.meta : {};
  const mediaMeta = meta.media && typeof meta.media === 'object' ? { ...meta.media } : null;
  const mediaId = sanitizeString(mediaMeta?.id || meta.mediaId);
  if (!mediaMeta && !mediaId) return null;
  const type = mediaMeta?.type || sanitizeString(meta.mediaType) || inferMediaTypeFromLog(log);
  const direction = mediaMeta?.direction || log.direction || '';
  const media = mediaMeta ? { ...mediaMeta } : {};
  if (mediaId) media.id = mediaId;
  if (type) media.type = type;
  if (direction) media.direction = direction;
  return media;
};

const resolveMediaOwnerFromLog = (log) => {
  const direction = sanitizeString(log?.direction).toLowerCase();
  if (direction === 'outgoing') {
    return digitsOnly(log?.destination || log?.origin || '');
  }
  return digitsOnly(log?.origin || log?.destination || '');
};

const buildContactsResponse = (log) => {
  if (!log || typeof log !== 'object') return null;
  const meta = log.meta && typeof log.meta === 'object' ? log.meta : {};
  const contacts = Array.isArray(meta.contacts) ? meta.contacts : null;
  if (!contacts || contacts.length === 0) return null;
  return contacts;
};

const mapLogResponse = (log) => ({
  id: log?._id ? String(log._id) : undefined,
  createdAt: log?.createdAt ? log.createdAt.toISOString() : null,
  numberLabel: log?.numberLabel || '',
  phoneNumberId: log?.phoneNumberId || '',
  phoneNumber: log?.phoneNumber || '',
  origin: log?.origin || '',
  destination: log?.destination || '',
  message: log?.message || '',
  messageId: log?.messageId || '',
  status: log?.status || '',
  direction: log?.direction || '',
  source: log?.source || '',
  media: buildMediaResponse(log),
  contacts: buildContactsResponse(log),
});

const resolveMessageHistoryLimit = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return MESSAGE_HISTORY_LIMIT_DEFAULT;
  return Math.min(Math.floor(parsed), MESSAGE_HISTORY_LIMIT_MAX);
};

const escapeRegex = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const normalizeWaId = (value) => digitsOnly(value);

const buildPhoneMatchRegex = (digits) => {
  if (!digits) return null;
  const pattern = `^\\D*${digits.split('').join('\\D*')}\\D*$`;
  return new RegExp(pattern);
};

const buildPhoneVariants = (value) => {
  const digits = digitsOnly(value);
  if (!digits) return [];
  const variants = new Set([digits]);
  if (digits.startsWith('55') && digits.length > 11) {
    variants.add(digits.slice(2));
  }
  if (!digits.startsWith('55') && digits.length >= 10 && digits.length <= 11) {
    variants.add(`55${digits}`);
  }
  if (digits.startsWith('0') && digits.length > 10) {
    variants.add(digits.slice(1));
  }
  return Array.from(variants);
};

const pickUserShortName = (user = {}) => {
  const raw =
    sanitizeString(user?.nomeCompleto) ||
    sanitizeString(user?.nomeContato) ||
    sanitizeString(user?.nomeFantasia) ||
    sanitizeString(user?.razaoSocial) ||
    sanitizeString(user?.apelido);
  if (!raw) return '';
  const parts = raw.split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).join(' ');
};

const collectUserPhones = (user = {}) => {
  return [
    ...buildPhoneVariants(user?.celular),
    ...buildPhoneVariants(user?.telefone),
    ...buildPhoneVariants(user?.celularSecundario),
    ...buildPhoneVariants(user?.telefoneSecundario),
  ].filter(Boolean);
};

const CONTACTS_VERIFY_LIMIT = 60;
const CONTACTS_VERIFY_BATCH = 40;

const normalizeContactDigits = (value) => digitsOnly(value);

const normalizeToE164 = (digits) => {
  const value = digitsOnly(digits);
  if (!value) return '';
  if (value.startsWith('55') && value.length >= 12) return `+${value}`;
  if (!value.startsWith('55') && value.length >= 10 && value.length <= 11) {
    return `+55${value}`;
  }
  return `+${value}`;
};

const normalizeToWaId = (digits) => {
  const value = digitsOnly(digits);
  if (!value) return '';
  if (value.startsWith('55') && value.length >= 12) return value;
  if (!value.startsWith('55') && value.length >= 10 && value.length <= 11) {
    return `55${value}`;
  }
  return value;
};

const resolveValidWaId = (digits, validSet) => {
  const variants = buildPhoneVariants(digits);
  const match = variants.find((variant) => validSet.has(variant));
  return match || '';
};

const chunkArray = (items, size) => {
  const batches = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
};

const buildUserNameMap = async (waIds = []) => {
  const uniqueIds = Array.from(new Set(waIds.map(digitsOnly).filter(Boolean)));
  if (!uniqueIds.length) return new Map();
  const or = [];
  uniqueIds.forEach((digits) => {
    buildPhoneVariants(digits).forEach((variant) => {
      const regex = buildPhoneMatchRegex(variant);
      if (!regex) return;
      or.push({ celular: regex }, { telefone: regex }, { celularSecundario: regex }, { telefoneSecundario: regex });
    });
  });
  if (!or.length) return new Map();
  const users = await User.find({ $or: or })
    .select('nomeCompleto nomeContato nomeFantasia razaoSocial apelido celular telefone celularSecundario telefoneSecundario')
    .lean();
  const nameMap = new Map();
  users.forEach((user) => {
    const name = pickUserShortName(user);
    if (!name) return;
    collectUserPhones(user).forEach((phone) => {
      if (!nameMap.has(phone)) {
        nameMap.set(phone, name);
      }
    });
  });
  return nameMap;
};

const applyUserNamesToConversations = async (conversations = []) => {
  const ids = conversations.map((entry) => digitsOnly(entry?.waId)).filter(Boolean);
  if (!ids.length) return conversations;
  const nameMap = await buildUserNameMap(ids);
  if (nameMap.size === 0) return conversations;
  return conversations.map((entry) => {
    const waId = digitsOnly(entry?.waId);
    const variants = waId ? buildPhoneVariants(waId) : [];
    const name = variants.map((variant) => nameMap.get(variant)).find(Boolean) || '';
    if (!name) return entry;
    return { ...entry, name, isKnownUser: true };
  });
};

const mapConversationResponse = (contact) => {
  const unreadCount = Number(contact?.unreadCount);
  return {
    id: contact?._id ? String(contact._id) : undefined,
    waId: normalizeWaId(contact?.waId || contact?.id || ''),
    name: contact?.name || '',
    phoneNumberId: contact?.phoneNumberId || '',
    lastMessage: contact?.lastMessage || '',
    lastMessageAt: contact?.lastMessageAt ? contact.lastMessageAt.toISOString() : null,
    lastDirection: contact?.lastDirection || '',
    lastMessageId: contact?.lastMessageId || '',
    lastStatus: contact?.lastStatus || '',
    unreadCount: Number.isFinite(unreadCount) ? unreadCount : 0,
    lastReadAt: contact?.lastReadAt ? contact.lastReadAt.toISOString() : null,
  };
};

const mapConversationFromLog = (entry) => ({
  id: undefined,
  waId: normalizeWaId(entry?.contact || ''),
  name: '',
  phoneNumberId: entry?.phoneNumberId || '',
  lastMessage: entry?.lastMessage || '',
  lastMessageAt: entry?.lastMessageAt ? new Date(entry.lastMessageAt).toISOString() : null,
  lastDirection: entry?.lastDirection || '',
  lastMessageId: entry?.lastMessageId || '',
  lastStatus: entry?.lastDirection === 'outgoing' ? entry?.lastStatus || '' : '',
  unreadCount: 0,
  lastReadAt: null,
});

const mergeConversations = (conversations = []) => {
  const merged = new Map();

  conversations.forEach((entry) => {
    const waId = normalizeWaId(entry?.waId || '');
    if (!waId) return;
    const current = merged.get(waId);
    const entryTime = entry?.lastMessageAt ? new Date(entry.lastMessageAt).getTime() : 0;
    const currentTime = current?.lastMessageAt ? new Date(current.lastMessageAt).getTime() : 0;

    if (!current || entryTime >= currentTime) {
      merged.set(waId, {
        ...entry,
        waId,
        name: entry.name || current?.name || '',
      });
      return;
    }

    if (current && !current.name && entry.name) {
      current.name = entry.name;
      merged.set(waId, current);
    }
  });

  return Array.from(merged.values()).sort((a, b) => {
    const aTime = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
    const bTime = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
    return bTime - aTime;
  });
};

const mapMessageResponse = (log) => ({
  id: log?._id ? String(log._id) : undefined,
  direction: log?.direction || '',
  status: log?.status || '',
  message: log?.message || '',
  origin: log?.origin || '',
  destination: log?.destination || '',
  messageId: log?.messageId || '',
  createdAt: log?.createdAt ? log.createdAt.toISOString() : null,
  media: buildMediaResponse(log),
  contacts: buildContactsResponse(log),
});

const resolvePhoneNumberIdFromQuery = (integration, query = {}) => {
  const phoneNumberId = sanitizeString(query.phoneNumberId);
  if (phoneNumberId) return phoneNumberId;
  const numberId = sanitizeString(query.numberId);
  if (!numberId) return '';
  if (!mongoose.Types.ObjectId.isValid(numberId)) {
    const numeric = digitsOnly(numberId);
    return numeric || '';
  }
  const numbers = Array.isArray(integration?.phoneNumbers) ? integration.phoneNumbers : [];
  const matched = numbers.find((entry) => entry?._id && String(entry._id) === numberId);
  return sanitizeString(matched?.phoneNumberId);
};

const upsertContact = async ({
  storeId,
  phoneNumberId,
  waId,
  name,
  lastMessage,
  lastMessageAt,
  lastDirection,
  lastMessageId,
  lastStatus,
}) => {
  if (!storeId || !phoneNumberId || !waId) return;
  const now = new Date();
  const update = {
    $set: {
      lastMessage: normalizeLogText(lastMessage, 1000),
      lastMessageAt: lastMessageAt || now,
      lastDirection: lastDirection || '',
      lastMessageId: lastMessageId || '',
      ...(lastStatus ? { lastStatus: lastStatus || '' } : {}),
      updatedAt: now,
    },
    $setOnInsert: {
      store: storeId,
      phoneNumberId,
      waId,
      name: name || '',
      createdAt: now,
    },
  };
  if (name) {
    update.$set.name = name;
  }
  await WhatsappContact.updateOne(
    { store: storeId, phoneNumberId, waId },
    update,
    { upsert: true }
  );
};

const clampKey = (value, max = 200) => {
  const text = sanitizeString(value);
  if (!text) return '';
  if (text.length <= max) return text;
  return text.slice(0, max);
};

const parseTimestamp = (value) => {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    const ms = numeric > 1000000000000 ? numeric : numeric * 1000;
    const parsed = new Date(ms);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const extractMessageHistoryEntries = (payload = {}) => {
  const sources = [];
  if (payload?.message_history_events?.value?.data) {
    sources.push(payload.message_history_events.value.data);
  }
  if (payload?.filtered_by_status?.value?.data) {
    sources.push(payload.filtered_by_status.value.data);
  }
  if (payload?.data) {
    sources.push(payload.data);
  }

  const entries = [];
  sources.forEach((source) => {
    if (Array.isArray(source)) {
      entries.push(...source);
      return;
    }
    if (source && typeof source === 'object') {
      entries.push(...Object.values(source));
    }
  });

  return entries;
};

const hashPayload = (value) => {
  try {
    return crypto.createHash('sha1').update(JSON.stringify(value)).digest('hex');
  } catch (_) {
    return '';
  }
};

const buildMessageHistoryEventKey = ({
  eventId,
  cursor,
  deliveryStatus,
  occurrenceTimestamp,
  statusTimestamp,
  entry,
}) => {
  if (eventId) return clampKey(`id:${eventId}`);
  if (cursor) return clampKey(`cursor:${cursor}`);
  const stamp = [
    deliveryStatus,
    occurrenceTimestamp ? occurrenceTimestamp.toISOString() : '',
    statusTimestamp ? statusTimestamp.toISOString() : '',
  ]
    .filter(Boolean)
    .join('|');
  if (stamp) return clampKey(`status:${stamp}`);
  const hash = hashPayload(entry);
  return hash ? clampKey(`hash:${hash}`) : `unknown:${Date.now()}`;
};

const mapMessageHistoryEventResponse = (event) => ({
  id: event?._id ? String(event._id) : undefined,
  messageHistoryId: event?.messageHistoryId || '',
  eventKey: event?.eventKey || '',
  eventId: event?.eventId || '',
  cursor: event?.cursor || '',
  deliveryStatus: event?.deliveryStatus || '',
  errorDescription: event?.errorDescription || '',
  occurrenceTimestamp: event?.occurrenceTimestamp ? event.occurrenceTimestamp.toISOString() : null,
  statusTimestamp: event?.statusTimestamp ? event.statusTimestamp.toISOString() : null,
  eventTimestamp: event?.eventTimestamp ? event.eventTimestamp.toISOString() : null,
  application: {
    id: event?.applicationId || '',
    name: event?.applicationName || '',
  },
  createdAt: event?.createdAt ? event.createdAt.toISOString() : null,
  updatedAt: event?.updatedAt ? event.updatedAt.toISOString() : null,
  raw: event?.raw ?? null,
});

const persistMessageHistoryEvents = async ({ storeId, messageHistoryId, payload }) => {
  const storeRef = mongoose.Types.ObjectId.isValid(storeId)
    ? new mongoose.Types.ObjectId(storeId)
    : storeId;
  const entries = extractMessageHistoryEntries(payload);
  if (!entries.length) {
    return { inserted: 0, updated: 0, matched: 0 };
  }

  const now = new Date();
  const operations = [];
  const seen = new Set();

  entries.forEach((entry) => {
    const node = entry?.node && typeof entry.node === 'object' ? entry.node : entry;
    if (!node || typeof node !== 'object') return;

    const cursor = sanitizeString(entry?.cursor);
    const eventId = sanitizeString(node?.id);
    const deliveryStatus = sanitizeString(node?.delivery_status || node?.deliveryStatus);
    const errorDescription = sanitizeString(node?.error_description || node?.errorDescription);
    const occurrenceTimestamp = parseTimestamp(node?.occurrence_timestamp ?? node?.occurrenceTimestamp);
    const statusTimestamp = parseTimestamp(node?.status_timestamp ?? node?.statusTimestamp);
    const eventTimestamp = statusTimestamp || occurrenceTimestamp || now;
    const application = node?.application || {};
    const applicationId = sanitizeString(application?.id);
    const applicationName = sanitizeString(application?.name);
    const eventKey = buildMessageHistoryEventKey({
      eventId,
      cursor,
      deliveryStatus,
      occurrenceTimestamp,
      statusTimestamp,
      entry,
    });

    if (!eventKey || seen.has(eventKey)) return;
    seen.add(eventKey);

    operations.push({
      updateOne: {
        filter: { store: storeRef, messageHistoryId, eventKey },
        update: {
          $set: {
            eventId,
            cursor,
            deliveryStatus,
            errorDescription,
            occurrenceTimestamp,
            statusTimestamp,
            eventTimestamp,
            applicationId,
            applicationName,
            raw: { cursor, node },
            updatedAt: now,
          },
          $setOnInsert: {
            store: storeRef,
            messageHistoryId,
            eventKey,
            createdAt: now,
          },
        },
        upsert: true,
      },
    });
  });

  if (!operations.length) {
    return { inserted: 0, updated: 0, matched: 0 };
  }

  const result = await WhatsappMessageHistoryEvent.bulkWrite(operations, { ordered: false });
  return {
    inserted: result.upsertedCount || 0,
    updated: result.modifiedCount || 0,
    matched: result.matchedCount || 0,
  };
};

const buildMessageHistoryQuery = (query = {}) => {
  const params = new URLSearchParams();
  const statusFilter = sanitizeString(query.status_filter || query.statusFilter);
  if (statusFilter) {
    params.set('status_filter', statusFilter);
  }
  const fields = sanitizeString(query.fields);
  if (fields) {
    params.set('fields', fields);
  }
  if (query.limit !== undefined) {
    params.set('limit', String(resolveMessageHistoryLimit(query.limit)));
  }
  const after = sanitizeString(query.after);
  if (after) params.set('after', after);
  const before = sanitizeString(query.before);
  if (before) params.set('before', before);
  return params.toString();
};

const buildTimeoutController = (timeoutMs = SEND_TIMEOUT_MS) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    dispose: () => clearTimeout(timeout),
  };
};

const parseGraphResponse = async (response) => {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (_) {
    return text;
  }
};

const extractGraphError = (payload) => {
  if (!payload || typeof payload !== 'object') return '';
  const error = payload.error || payload.errors || null;
  if (!error) return '';
  if (Array.isArray(error) && error.length > 0) {
    return sanitizeString(error[0]?.message || '');
  }
  return sanitizeString(error.message || '');
};

const extractGraphErrorDetails = (payload) => {
  if (!payload || typeof payload !== 'object') return null;
  const error = payload.error || payload.errors || null;
  const entry = Array.isArray(error) ? error[0] : error;
  if (!entry || typeof entry !== 'object') return null;
  return {
    code: entry.code ?? null,
    subcode: entry.error_subcode ?? null,
    fbtrace_id: entry.fbtrace_id ?? null,
  };
};

const sendWhatsappText = async ({ url, accessToken, body }) => {
  const controller = buildTimeoutController();
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const payload = await parseGraphResponse(response);
    return { response, payload };
  } finally {
    controller.dispose();
  }
};

const BUSINESS_PROFILE_FIELDS = [
  'about',
  'address',
  'description',
  'email',
  'profile_picture_url',
  'websites',
  'vertical',
];

const sendWhatsappGet = async ({ url, accessToken }) => {
  const controller = buildTimeoutController();
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
    const payload = await parseGraphResponse(response);
    return { response, payload };
  } finally {
    controller.dispose();
  }
};

const normalizeWebsites = (value) => {
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeString(entry)).filter(Boolean);
  }
  const text = sanitizeString(value);
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parsed.map((entry) => sanitizeString(entry)).filter(Boolean);
    }
  } catch (_) {
    // ignore
  }
  return text
    .split(/[\n,]+/)
    .map((entry) => sanitizeString(entry))
    .filter(Boolean);
};

const mapBusinessProfileResponse = (profile = {}) => ({
  about: sanitizeString(profile.about),
  address: sanitizeString(profile.address),
  description: sanitizeString(profile.description),
  email: sanitizeString(profile.email),
  profile_picture_url: sanitizeString(profile.profile_picture_url),
  websites: normalizeWebsites(profile.websites),
  vertical: sanitizeString(profile.vertical),
  messaging_product: sanitizeString(profile.messaging_product),
});

const buildBusinessProfileUpdateBody = (payload = {}) => {
  const body = { messaging_product: 'whatsapp' };
  if (Object.prototype.hasOwnProperty.call(payload, 'about')) {
    const value = sanitizeString(payload.about);
    if (value) body.about = value;
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'address')) {
    const value = sanitizeString(payload.address);
    if (value) body.address = value;
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'description')) {
    const value = sanitizeString(payload.description);
    if (value) body.description = value;
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'email')) {
    const value = sanitizeString(payload.email);
    if (value) body.email = value;
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'websites')) {
    const websites = normalizeWebsites(payload.websites);
    if (websites.length > 0) {
      body.websites = websites;
    }
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'vertical')) {
    const value = sanitizeString(payload.vertical);
    if (value) body.vertical = value;
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'profile_picture_handle')) {
    const value = sanitizeString(payload.profile_picture_handle);
    if (value) body.profile_picture_handle = value;
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'profilePictureHandle')) {
    const value = sanitizeString(payload.profilePictureHandle);
    if (value) body.profile_picture_handle = value;
  }
  return body;
};

const normalizeAudioMime = (value) => {
  const base = sanitizeString(value).toLowerCase().split(';')[0];
  if (base === 'audio/m4a' || base === 'audio/x-m4a') return 'audio/mp4';
  return base;
};

const normalizeImageMime = (value) => {
  const base = sanitizeString(value).toLowerCase().split(';')[0];
  if (base === 'image/jpg') return 'image/jpeg';
  if (base === 'image/pjpeg') return 'image/jpeg';
  return base;
};

const resolveFfmpegBinary = () => sanitizeString(process.env.FFMPEG_PATH) || FFMPEG_STATIC_PATH || 'ffmpeg';

const resolveAudioExtension = (mimeType) => {
  if (mimeType === 'audio/ogg') return 'ogg';
  if (mimeType === 'audio/mp4') return 'm4a';
  if (mimeType === 'audio/mpeg') return 'mp3';
  if (mimeType === 'audio/aac') return 'aac';
  if (mimeType === 'audio/amr') return 'amr';
  if (mimeType === 'audio/webm') return 'webm';
  return 'audio';
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

const MEDIA_FOLDERS = {
  audio: 'voices',
  image: 'images',
  video: 'videos',
  document: 'docs',
};

const sanitizeKeySegment = (value, fallback = 'file') => {
  const cleaned = sanitizeString(value).replace(/[^0-9A-Za-z_-]+/g, '');
  const sliced = cleaned.slice(0, 120);
  return sliced || fallback;
};

const sanitizeFileName = (value, fallback = 'file') => {
  const raw = sanitizeString(value);
  if (!raw) return fallback;
  const base = path.basename(raw);
  const cleaned = base.replace(/[^0-9A-Za-z._-]+/g, '').slice(0, 160);
  return cleaned || fallback;
};

const resolveMediaExtension = (mimeType, filename) => {
  const safeName = sanitizeFileName(filename || '');
  const ext = safeName ? path.extname(safeName) : '';
  if (ext) return ext.toLowerCase();
  const normalized = sanitizeString(mimeType).toLowerCase();
  if (MEDIA_MIME_EXTENSIONS[normalized]) return MEDIA_MIME_EXTENSIONS[normalized];
  if (normalized.startsWith('audio/')) return `.${resolveAudioExtension(normalized)}`;
  const subtype = normalized.split('/')[1] || '';
  const safe = subtype.replace(/[^0-9A-Za-z]+/g, '').slice(0, 8);
  return safe ? `.${safe}` : '.bin';
};

const resolveGraphDocumentMimeType = (mimeType, filename) => {
  const normalized = sanitizeString(mimeType).toLowerCase();
  if (GRAPH_DOCUMENT_MIME_TYPES.has(normalized)) return normalized;
  const ext = path.extname(sanitizeFileName(filename || '')).toLowerCase();
  if (TEXT_DOCUMENT_MIME_TYPES.has(normalized) || TEXT_DOCUMENT_EXTENSIONS.has(ext)) {
    return 'text/plain';
  }
  return '';
};

const resolveMediaCategory = (type) => MEDIA_FOLDERS[type] || 'files';

const buildWhatsappMediaKey = ({ storeId, waId, category, direction, fileName }) => {
  const storeSegment = sanitizeKeySegment(storeId, 'store');
  const phoneSegment = sanitizeKeySegment(waId, 'unknown');
  const folder = sanitizeKeySegment(category, 'files');
  const directionSegment = direction === 'outgoing' ? 'enviados' : 'recebidos';
  const safeFileName = sanitizeFileName(fileName, 'file');
  return ['whatsapp', storeSegment, phoneSegment, folder, directionSegment, safeFileName].join('/');
};

const storeWhatsappMedia = async ({
  storeId,
  waId,
  mediaId,
  messageId,
  mediaType,
  buffer,
  mimeType,
  filename,
  direction,
  voice,
}) => {
  if (!isR2Configured() || !buffer) return null;
  const extension = resolveMediaExtension(mimeType, filename);
  const baseName = sanitizeKeySegment(messageId || mediaId || `${mediaType || 'media'}-${Date.now()}`);
  let safeName = sanitizeFileName(filename || '');
  if (!safeName || safeName === 'file') {
    safeName = `${baseName}${extension}`;
  } else if (!path.extname(safeName)) {
    safeName = `${safeName}${extension}`;
  }
  const category = resolveMediaCategory(mediaType || '');
  const key = buildWhatsappMediaKey({
    storeId,
    waId,
    category,
    direction: direction || 'incoming',
    fileName: safeName,
  });
  const uploaded = await uploadBufferToR2(buffer, {
    key,
    contentType: mimeType || 'application/octet-stream',
  });
  return {
    id: sanitizeString(mediaId),
    type: mediaType || '',
    direction: direction || 'incoming',
    mimeType: mimeType || '',
    filename: sanitizeFileName(safeName || filename || ''),
    voice: Boolean(voice),
    fileSize: buffer.length || null,
    r2Key: uploaded.key,
    r2Url: uploaded.url,
    messageId: messageId || '',
  };
};

const storeOutgoingWhatsappMedia = async (payload) => storeWhatsappMedia({ ...payload, direction: 'outgoing' });

const ensureFfmpegAvailable = (() => {
  let cached = null;
  return () => {
    if (cached !== null) return cached;
    try {
      const binary = resolveFfmpegBinary();
      const result = spawnSync(binary, ['-version'], { stdio: 'ignore', windowsHide: true });
      cached = result.status === 0;
    } catch (_) {
      cached = false;
    }
    return cached;
  };
})();

const safeUnlink = async (filePath) => {
  if (!filePath) return;
  try {
    await fs.promises.unlink(filePath);
  } catch (_) {
    // ignore
  }
};

const convertAudioBufferToOgg = async (buffer, inputExt) => {
  const baseName = `whatsapp-audio-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const inputPath = path.join(os.tmpdir(), `${baseName}.${inputExt}`);
  const outputPath = path.join(os.tmpdir(), `${baseName}.ogg`);
  await fs.promises.writeFile(inputPath, buffer);

  return new Promise((resolve, reject) => {
    const ffmpegBinary = resolveFfmpegBinary();
    const args = ['-y', '-i', inputPath, '-ac', '1', '-c:a', 'libopus', '-b:a', '24k', outputPath];
    const processRef = spawn(ffmpegBinary, args, { windowsHide: true });
    let stderr = '';

    processRef.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    processRef.on('error', async (error) => {
      await safeUnlink(inputPath);
      await safeUnlink(outputPath);
      reject(error);
    });

    processRef.on('close', async (code) => {
      await safeUnlink(inputPath);
      if (code !== 0) {
        await safeUnlink(outputPath);
        reject(new Error(stderr || 'ffmpeg failed'));
        return;
      }
      try {
        const outputBuffer = await fs.promises.readFile(outputPath);
        await safeUnlink(outputPath);
        resolve(outputBuffer);
      } catch (error) {
        await safeUnlink(outputPath);
        reject(error);
      }
    });
  });
};

router.get('/:storeId/logs', requireAuth, authorizeRoles('admin', 'admin_master'), async (req, res) => {
  try {
    const { storeId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(storeId)) {
      return res.status(400).json({ message: 'Identificador de loja invalido.' });
    }

    const storeExists = await Store.exists({ _id: storeId });
    if (!storeExists) {
      return res.status(404).json({ message: 'Loja nao encontrada.' });
    }

    const limit = resolveLimit(req.query.limit);
    const [outgoing, incoming] = await Promise.all([
      WhatsappLog.find({ store: storeId, direction: 'outgoing' }).sort({ createdAt: -1 }).limit(limit).lean(),
      WhatsappLog.find({ store: storeId, direction: 'incoming' }).sort({ createdAt: -1 }).limit(limit).lean(),
    ]);

    return res.json({
      outgoing: outgoing.map(mapLogResponse),
      incoming: incoming.map(mapLogResponse),
    });
  } catch (error) {
    console.error('Erro ao buscar logs do WhatsApp:', error);
    return res.status(500).json({ message: 'Erro ao buscar logs do WhatsApp.' });
  }
});

router.post('/:storeId/logs', requireAuth, authorizeRoles('admin', 'admin_master'), async (req, res) => {
  try {
    const { storeId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(storeId)) {
      return res.status(400).json({ message: 'Identificador de loja invalido.' });
    }

    const storeExists = await Store.exists({ _id: storeId });
    if (!storeExists) {
      return res.status(404).json({ message: 'Loja nao encontrada.' });
    }

    const payload = req.body || {};
    const direction = normalizeDirection(payload.direction);
    if (!direction) {
      return res.status(400).json({ message: 'Direcao invalida.' });
    }

    const integration = await WhatsappIntegration.findOne({ store: storeId }).lean();
    const numberMeta = resolveNumberMeta(integration, payload);
    const status = normalizeLogStatus(direction, payload.status);

    const log = await WhatsappLog.create({
      store: storeId,
      direction,
      status,
      phoneNumberId: numberMeta.phoneNumberId,
      phoneNumber: numberMeta.phoneNumber,
      numberLabel: numberMeta.numberLabel,
      origin: normalizeLogText(payload.origin, 80),
      destination: normalizeLogText(payload.destination, 80),
      message: normalizeLogText(payload.message, 1000),
      messageId: sanitizeString(payload.messageId),
      source: sanitizeString(payload.source) || 'manual',
    });

    if (numberMeta.phoneNumberId && integration?._id) {
      await WhatsappIntegration.updateOne(
        { _id: integration._id, 'phoneNumbers.phoneNumberId': numberMeta.phoneNumberId },
        { $set: { 'phoneNumbers.$.lastSyncAt': new Date() } }
      );
    }

    return res.json({ log: mapLogResponse(log) });
  } catch (error) {
    console.error('Erro ao salvar log do WhatsApp:', error);
    return res.status(500).json({ message: 'Erro ao salvar log do WhatsApp.' });
  }
});

router.get('/:storeId/media/:mediaId', requireAuth, authorizeRoles('admin', 'admin_master'), async (req, res) => {
  try {
    const { storeId, mediaId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(storeId)) {
      return res.status(400).json({ message: 'Identificador de loja invalido.' });
    }

    const mediaKey = sanitizeString(mediaId);
    if (!mediaKey) {
      return res.status(400).json({ message: 'Midia invalida.' });
    }

    const storeExists = await Store.exists({ _id: storeId });
    if (!storeExists) {
      return res.status(404).json({ message: 'Loja nao encontrada.' });
    }

    const log = await WhatsappLog.findOne({
      store: storeId,
      $or: [{ 'meta.media.id': mediaKey }, { 'meta.mediaId': mediaKey }],
    }).lean();

    if (!log) {
      return res.status(404).json({ message: 'Midia nao encontrada.' });
    }

    const mediaMeta = buildMediaResponse(log);
    if (mediaMeta?.r2Key && isR2Configured()) {
      try {
        const r2Object = await getObjectFromR2(mediaMeta.r2Key);
        if (r2Object?.buffer) {
          res.setHeader('Content-Type', r2Object.contentType || mediaMeta.mimeType || 'application/octet-stream');
          res.setHeader('Cache-Control', 'private, max-age=300');
          return res.send(r2Object.buffer);
        }
      } catch (r2Error) {
        console.error('Erro ao carregar midia do R2:', r2Error);
      }
    }

    const integration = await findIntegration(storeId);
    if (!integration) {
      return res.status(404).json({ message: 'Integracao do WhatsApp nao configurada.' });
    }

    const accessToken = decryptField(integration.accessTokenEncrypted, integration.accessTokenStored);
    if (!accessToken) {
      return res.status(400).json({ message: 'Token de acesso nao informado.' });
    }

    const infoResponse = await fetch(`${GRAPH_BASE_URL}/${encodeURIComponent(mediaKey)}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    });
    const infoPayload = await parseGraphResponse(infoResponse);

    if (!infoResponse.ok) {
      const errorMessage = extractGraphError(infoPayload);
      return res.status(infoResponse.status || 502).json({
        message: errorMessage || 'Falha ao carregar midia.',
      });
    }

    const mediaUrl = sanitizeString(infoPayload?.url);
    if (!mediaUrl) {
      return res.status(502).json({ message: 'URL da midia nao encontrado.' });
    }

    const mediaResponse = await fetch(mediaUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: '*/*',
      },
    });

    if (!mediaResponse.ok) {
      return res.status(mediaResponse.status || 502).json({ message: 'Falha ao baixar midia.' });
    }

    const contentType = sanitizeString(infoPayload?.mime_type) || mediaResponse.headers.get('content-type') || 'application/octet-stream';
    const arrayBuffer = await mediaResponse.arrayBuffer();
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'private, max-age=300');
    return res.send(Buffer.from(arrayBuffer));
  } catch (error) {
    console.error('Erro ao carregar midia WhatsApp:', error);
    return res.status(500).json({ message: 'Erro ao carregar midia do WhatsApp.' });
  }
});

router.post('/:storeId/media/:mediaId/store', requireAuth, authorizeRoles('admin', 'admin_master'), async (req, res) => {
  try {
    const { storeId, mediaId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(storeId)) {
      return res.status(400).json({ message: 'Identificador de loja invalido.' });
    }

    const mediaKey = sanitizeString(mediaId);
    if (!mediaKey) {
      return res.status(400).json({ message: 'Midia invalida.' });
    }

    if (!isR2Configured()) {
      return res.status(400).json({ message: 'R2 nao configurado.' });
    }

    const storeExists = await Store.exists({ _id: storeId });
    if (!storeExists) {
      return res.status(404).json({ message: 'Loja nao encontrada.' });
    }

    const log = await WhatsappLog.findOne({
      store: storeId,
      $or: [{ 'meta.media.id': mediaKey }, { 'meta.mediaId': mediaKey }],
    }).lean();

    if (!log) {
      return res.status(404).json({ message: 'Midia nao encontrada.' });
    }

    const mediaMeta = buildMediaResponse(log);
    if (mediaMeta?.r2Key || mediaMeta?.r2Url) {
      return res.json({ media: mediaMeta });
    }

    const integration = await findIntegration(storeId);
    if (!integration) {
      return res.status(404).json({ message: 'Integracao do WhatsApp nao configurada.' });
    }

    const accessToken = decryptField(integration.accessTokenEncrypted, integration.accessTokenStored);
    if (!accessToken) {
      return res.status(400).json({ message: 'Token de acesso nao informado.' });
    }

    const infoResponse = await fetch(`${GRAPH_BASE_URL}/${encodeURIComponent(mediaKey)}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    });
    const infoPayload = await parseGraphResponse(infoResponse);

    if (!infoResponse.ok) {
      const errorMessage = extractGraphError(infoPayload);
      return res.status(infoResponse.status || 502).json({
        message: errorMessage || 'Falha ao carregar midia.',
      });
    }

    const mediaUrl = sanitizeString(infoPayload?.url);
    if (!mediaUrl) {
      return res.status(502).json({ message: 'URL da midia nao encontrado.' });
    }

    const mediaResponse = await fetch(mediaUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: '*/*',
      },
    });

    if (!mediaResponse.ok) {
      return res.status(mediaResponse.status || 502).json({ message: 'Falha ao baixar midia.' });
    }

    const contentType = sanitizeString(infoPayload?.mime_type) || mediaResponse.headers.get('content-type') || 'application/octet-stream';
    const arrayBuffer = await mediaResponse.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const waId = resolveMediaOwnerFromLog(log);
    const mediaType = sanitizeString(mediaMeta?.type || log?.meta?.mediaType || inferMediaTypeFromLog(log));
    const fileName = sanitizeFileName(mediaMeta?.filename || mediaMeta?.fileName || '');
    const stored = await storeWhatsappMedia({
      storeId,
      waId: waId || 'unknown',
      mediaId: mediaKey,
      messageId: sanitizeString(log?.messageId || mediaKey),
      mediaType,
      buffer,
      mimeType: contentType,
      filename: fileName,
      direction: sanitizeString(mediaMeta?.direction || log?.direction || 'incoming') || 'incoming',
      voice: Boolean(mediaMeta?.voice),
    });

    if (!stored) {
      return res.status(500).json({ message: 'Nao foi possivel salvar no R2.' });
    }

    const mergedMedia = {
      ...(mediaMeta || {}),
      ...stored,
      id: stored.id || mediaKey,
      type: stored.type || mediaType,
    };

    await WhatsappLog.updateOne(
      { _id: log._id },
      {
        $set: {
          'meta.media': mergedMedia,
          'meta.mediaId': mergedMedia.id,
          'meta.mediaType': mergedMedia.type,
          updatedAt: new Date(),
        },
      }
    );

    return res.json({ media: mergedMedia });
  } catch (error) {
    console.error('Erro ao salvar midia no R2:', error);
    return res.status(500).json({ message: 'Erro ao salvar midia no R2.' });
  }
});

router.get('/:storeId/business-profile', requireAuth, authorizeRoles('admin', 'admin_master'), async (req, res) => {
  try {
    const { storeId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(storeId)) {
      return res.status(400).json({ message: 'Identificador de loja invalido.' });
    }

    const storeExists = await Store.exists({ _id: storeId });
    if (!storeExists) {
      return res.status(404).json({ message: 'Loja nao encontrada.' });
    }

    const integration = await findIntegration(storeId);
    if (!integration) {
      return res.status(404).json({ message: 'Integracao do WhatsApp nao configurada.' });
    }

    const phoneNumberId = resolvePhoneNumberIdFromQuery(integration, req.query);
    if (!phoneNumberId) {
      return res.status(400).json({ message: 'Phone Number ID nao informado.' });
    }

    const accessToken = decryptField(integration.accessTokenEncrypted, integration.accessTokenStored);
    if (!accessToken) {
      return res.status(400).json({ message: 'Token de acesso nao informado.' });
    }

    const fields = BUSINESS_PROFILE_FIELDS.join(',');
    const url = `${GRAPH_WEBHOOK_BASE_URL}/${phoneNumberId}/whatsapp_business_profile?fields=${fields}`;
    const { response, payload: graphPayload } = await sendWhatsappGet({ url, accessToken });

    if (!response.ok) {
      const errorMessage = extractGraphError(graphPayload);
      const details = extractGraphErrorDetails(graphPayload);
      const detailSuffix = details
        ? ` (code ${details.code ?? '-'}, subcode ${details.subcode ?? '-'}, trace ${details.fbtrace_id ?? '-'})`
        : '';
      return res.status(response.status || 502).json({
        message: `${errorMessage || 'Falha ao buscar perfil empresarial.'}${detailSuffix}`,
        error: details,
      });
    }

    const profile = Array.isArray(graphPayload?.data) ? graphPayload.data[0] || {} : {};
    const mapped = mapBusinessProfileResponse(profile);
    const numberMeta = resolveNumberMeta(integration, { phoneNumberId });

    return res.json({
      profile: mapped,
      phoneNumberId,
      phoneNumber: numberMeta.phoneNumber,
      numberLabel: numberMeta.numberLabel,
    });
  } catch (error) {
    console.error('Erro ao buscar perfil empresarial WhatsApp:', error);
    return res.status(500).json({ message: 'Erro ao buscar perfil empresarial.' });
  }
});

router.post('/:storeId/business-profile', requireAuth, authorizeRoles('admin', 'admin_master'), async (req, res) => {
  try {
    const { storeId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(storeId)) {
      return res.status(400).json({ message: 'Identificador de loja invalido.' });
    }

    const storeExists = await Store.exists({ _id: storeId });
    if (!storeExists) {
      return res.status(404).json({ message: 'Loja nao encontrada.' });
    }

    const integration = await findIntegration(storeId);
    if (!integration) {
      return res.status(404).json({ message: 'Integracao do WhatsApp nao configurada.' });
    }

    const payload = req.body || {};
    const phoneNumberId = sanitizeString(payload.phoneNumberId);
    if (!phoneNumberId) {
      return res.status(400).json({ message: 'Phone Number ID nao informado.' });
    }

    const accessToken = decryptField(integration.accessTokenEncrypted, integration.accessTokenStored);
    if (!accessToken) {
      return res.status(400).json({ message: 'Token de acesso nao informado.' });
    }

    const body = buildBusinessProfileUpdateBody(payload);
    if (Object.keys(body).length <= 1) {
      return res.status(400).json({ message: 'Nenhum campo informado para atualizar.' });
    }

    const url = `${GRAPH_WEBHOOK_BASE_URL}/${phoneNumberId}/whatsapp_business_profile`;
    const { response, payload: graphPayload } = await sendWhatsappText({
      url,
      accessToken,
      body,
    });

    if (!response.ok) {
      const errorMessage = extractGraphError(graphPayload);
      const details = extractGraphErrorDetails(graphPayload);
      const detailSuffix = details
        ? ` (code ${details.code ?? '-'}, subcode ${details.subcode ?? '-'}, trace ${details.fbtrace_id ?? '-'})`
        : '';
      return res.status(response.status || 502).json({
        message: `${errorMessage || 'Falha ao atualizar perfil empresarial.'}${detailSuffix}`,
        error: details,
      });
    }

    return res.json({ success: true });
  } catch (error) {
    console.error('Erro ao atualizar perfil empresarial WhatsApp:', error);
    return res.status(500).json({ message: 'Erro ao atualizar perfil empresarial.' });
  }
});

router.post('/:storeId/business-profile/picture', requireAuth, authorizeRoles('admin', 'admin_master'), upload.single('file'), async (req, res) => {
  try {
    const { storeId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(storeId)) {
      return res.status(400).json({ message: 'Identificador de loja invalido.' });
    }

    const storeExists = await Store.exists({ _id: storeId });
    if (!storeExists) {
      return res.status(404).json({ message: 'Loja nao encontrada.' });
    }

    const integration = await findIntegration(storeId);
    if (!integration) {
      return res.status(404).json({ message: 'Integracao do WhatsApp nao configurada.' });
    }

    const phoneNumberId = sanitizeString(req.body?.phoneNumberId) || resolvePhoneNumberIdFromQuery(integration, req.query);
    if (!phoneNumberId) {
      return res.status(400).json({ message: 'Phone Number ID nao informado.' });
    }

    const file = req.file;
    if (!file || !file.buffer) {
      return res.status(400).json({ message: 'Imagem nao informada.' });
    }
    if (!file.mimetype || !file.mimetype.startsWith('image/')) {
      return res.status(400).json({ message: 'Formato de imagem invalido.' });
    }

    const accessToken = decryptField(integration.accessTokenEncrypted, integration.accessTokenStored);
    if (!accessToken) {
      return res.status(400).json({ message: 'Token de acesso nao informado.' });
    }

    const form = new FormData();
    const imageBlob = new Blob([file.buffer], { type: file.mimetype });
    form.append('messaging_product', 'whatsapp');
    form.append('type', file.mimetype);
    form.append('file', imageBlob, sanitizeString(file.originalname) || 'profile.jpg');

    const controller = buildTimeoutController();
    let uploadPayload = null;
    try {
      const uploadResponse = await fetch(`${GRAPH_WEBHOOK_BASE_URL}/${phoneNumberId}/media?messaging_product=whatsapp`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        body: form,
        duplex: 'half',
        signal: controller.signal,
      });
      uploadPayload = await parseGraphResponse(uploadResponse);

      if (!uploadResponse.ok) {
        const errorMessage = extractGraphError(uploadPayload);
        const details = extractGraphErrorDetails(uploadPayload);
        const detailSuffix = details
          ? ` (code ${details.code ?? '-'}, subcode ${details.subcode ?? '-'}, trace ${details.fbtrace_id ?? '-'})`
          : '';
        return res.status(uploadResponse.status || 502).json({
          message: `${errorMessage || 'Falha ao enviar imagem.'}${detailSuffix}`,
          error: details,
        });
      }

      const handle = sanitizeString(uploadPayload?.id || uploadPayload?.media?.[0]?.id || uploadPayload?.handle || '');
      if (!handle) {
        return res.status(502).json({ message: 'Nao foi possivel obter o handle da imagem.' });
      }

      const { response: updateResponse, payload: updatePayload } = await sendWhatsappText({
        url: `${GRAPH_WEBHOOK_BASE_URL}/${phoneNumberId}/whatsapp_business_profile`,
        accessToken,
        body: {
          messaging_product: 'whatsapp',
          profile_picture_handle: handle,
        },
      });

      if (!updateResponse.ok) {
        const errorMessage = extractGraphError(updatePayload);
        const details = extractGraphErrorDetails(updatePayload);
        const detailSuffix = details
          ? ` (code ${details.code ?? '-'}, subcode ${details.subcode ?? '-'}, trace ${details.fbtrace_id ?? '-'})`
          : '';
        return res.status(updateResponse.status || 502).json({
          message: `${errorMessage || 'Falha ao atualizar imagem do perfil.'}${detailSuffix}`,
          error: details,
        });
      }

      return res.json({ success: true, handle });
    } finally {
      controller.dispose();
    }
  } catch (error) {
    console.error('Erro ao atualizar imagem do perfil WhatsApp:', error);
    return res.status(500).json({ message: 'Erro ao atualizar imagem do perfil.' });
  }
});

router.get('/:storeId/conversations', requireAuth, authorizeRoles('admin', 'admin_master'), async (req, res) => {
  try {
    const { storeId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(storeId)) {
      return res.status(400).json({ message: 'Identificador de loja invalido.' });
    }

    const storeExists = await Store.exists({ _id: storeId });
    if (!storeExists) {
      return res.status(404).json({ message: 'Loja nao encontrada.' });
    }

    const integration = await WhatsappIntegration.findOne({ store: storeId }).lean();
    const phoneNumberId = resolvePhoneNumberIdFromQuery(integration, req.query);
    if (!phoneNumberId) {
      return res.status(400).json({ message: 'Phone Number ID nao informado.' });
    }

    const limit = resolveLimit(req.query.limit);
    const search = sanitizeString(req.query.search);
    const query = { store: storeId, phoneNumberId };

    if (search) {
      const regex = new RegExp(escapeRegex(search), 'i');
      query.$or = [{ name: regex }, { waId: regex }];
    }

    const contacts = await WhatsappContact.find(query)
      .sort({ lastMessageAt: -1 })
      .limit(limit)
      .lean();

    if (contacts.length > 0) {
      const mapped = contacts.map(mapConversationResponse);
      const merged = mergeConversations(mapped);
      const enriched = await applyUserNamesToConversations(merged);
      return res.json({ conversations: enriched });
    }

    const logs = await WhatsappLog.aggregate([
      {
        $match: {
          store: new mongoose.Types.ObjectId(storeId),
          phoneNumberId,
        },
      },
      { $sort: { createdAt: -1 } },
      {
        $addFields: {
          contact: {
            $cond: [{ $eq: ['$direction', 'incoming'] }, '$origin', '$destination'],
          },
        },
      },
      { $match: { contact: { $ne: '' } } },
      {
        $group: {
          _id: '$contact',
          lastMessageAt: { $first: '$createdAt' },
          lastMessage: { $first: '$message' },
          lastDirection: { $first: '$direction' },
          lastMessageId: { $first: '$messageId' },
          lastStatus: { $first: '$status' },
        },
      },
      { $sort: { lastMessageAt: -1 } },
      { $limit: limit },
    ]);

    let conversations = logs.map((entry) =>
      mapConversationFromLog({
        contact: entry._id,
        phoneNumberId,
        lastMessageAt: entry.lastMessageAt,
        lastMessage: entry.lastMessage,
        lastDirection: entry.lastDirection,
        lastMessageId: entry.lastMessageId,
        lastStatus: entry.lastStatus,
      })
    );

    if (search) {
      const searchDigits = digitsOnly(search);
      conversations = conversations.filter((entry) => {
        if (!entry.waId) return false;
        if (searchDigits) return entry.waId.includes(searchDigits);
        return entry.waId.toLowerCase().includes(search.toLowerCase());
      });
    }

    conversations = mergeConversations(conversations);
    const enriched = await applyUserNamesToConversations(conversations);
    return res.json({ conversations: enriched });
  } catch (error) {
    console.error('Erro ao buscar conversas do WhatsApp:', error);
    return res.status(500).json({ message: 'Erro ao buscar conversas do WhatsApp.' });
  }
});

router.get('/:storeId/contacts/whatsapp', requireAuth, authorizeRoles('admin', 'admin_master'), async (req, res) => {
  try {
    const { storeId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(storeId)) {
      return res.status(400).json({ message: 'Identificador de loja invalido.' });
    }

    const storeExists = await Store.exists({ _id: storeId });
    if (!storeExists) {
      return res.status(404).json({ message: 'Loja nao encontrada.' });
    }

    const integration = await WhatsappIntegration.findOne({ store: storeId }).select(SECRET_SELECT).lean();
    if (!integration) {
      return res.status(404).json({ message: 'Integracao nao encontrada.' });
    }

    const phoneNumberId = resolvePhoneNumberIdFromQuery(integration, req.query);
    if (!phoneNumberId) {
      return res.status(400).json({ message: 'Phone Number ID nao informado.' });
    }

    const accessToken = decryptField(integration.accessTokenEncrypted, integration.accessTokenStored);
    if (!accessToken) {
      return res.status(400).json({ message: 'Token de acesso nao configurado.' });
    }

    const search = sanitizeString(req.query.q);
    const limitRaw = Number(req.query.limit);
    const limit = Number.isFinite(limitRaw)
      ? Math.min(Math.max(Math.floor(limitRaw), 1), CONTACTS_VERIFY_LIMIT)
      : CONTACTS_VERIFY_LIMIT;
    const searchLimit = Math.min(limit * 3, 200);

    const phoneFilter = [
      { celular: { $exists: true, $ne: '' } },
      { celularSecundario: { $exists: true, $ne: '' } },
      { telefone: { $exists: true, $ne: '' } },
      { telefoneSecundario: { $exists: true, $ne: '' } },
    ];

    const query = { $and: [{ $or: phoneFilter }] };
    if (search) {
      const regex = new RegExp(escapeRegex(search), 'i');
      const digits = normalizeContactDigits(search);
      const or = [
        { nomeCompleto: regex },
        { nomeContato: regex },
        { razaoSocial: regex },
        { apelido: regex },
        { email: regex },
      ];
      if (digits.length >= 3) {
        const phoneRegex = new RegExp(digits);
        or.push({ celular: phoneRegex });
        or.push({ celularSecundario: phoneRegex });
        or.push({ telefone: phoneRegex });
        or.push({ telefoneSecundario: phoneRegex });
      }
      query.$and.push({ $or: or });
    }

    const users = await User.find(query)
      .select('nomeCompleto nomeContato razaoSocial apelido email celular celularSecundario telefone telefoneSecundario')
      .sort({ nomeCompleto: 1, nomeContato: 1, razaoSocial: 1, apelido: 1 })
      .limit(searchLimit)
      .lean();

    const seen = new Set();
    const candidates = [];
    users.forEach((user) => {
      const name = pickUserShortName(user);
      [user.celular, user.celularSecundario, user.telefone, user.telefoneSecundario].forEach((raw) => {
        const digits = normalizeContactDigits(raw);
        if (!digits || digits.length < 8) return;
        if (seen.has(digits)) return;
        seen.add(digits);
        candidates.push({
          waId: digits,
          name,
          phone: digits,
          isKnownUser: Boolean(name),
        });
      });
    });

    if (candidates.length === 0) {
      return res.json([]);
    }

    const contactsPayload = candidates
      .map((entry) => normalizeToE164(entry.waId))
      .filter(Boolean);

    const batches = chunkArray(contactsPayload, CONTACTS_VERIFY_BATCH);
    const validDigits = new Set();

    for (const batch of batches) {
      const { response, payload } = await sendWhatsappText({
        url: `${GRAPH_CONTACTS_BASE_URL}/${phoneNumberId}/contacts`,
        accessToken,
        body: {
          messaging_product: 'whatsapp',
          contacts: batch,
        },
      });
      if (!response.ok) {
        const errorMessage = extractGraphError(payload);
        const details = extractGraphErrorDetails(payload);
        const detailSuffix = details
          ? ` (code ${details.code ?? '-'}, subcode ${details.subcode ?? '-'}, trace ${details.fbtrace_id ?? '-'})`
          : '';
        if (details?.code === 100 && details?.subcode === 33) {
          return res.status(response.status || 502).json({
            message:
              `Phone Number ID invalido ou sem permissao. ` +
              `Confirme se o numero pertence ao WABA e se o token possui whatsapp_business_management.` +
              detailSuffix,
            error: details,
          });
        }
        return res.status(response.status || 502).json({
          message: `${errorMessage || 'Falha ao validar contatos.'}${detailSuffix}`,
          error: details,
        });
      }

      const contacts = Array.isArray(payload?.contacts) ? payload.contacts : [];
      contacts.forEach((entry) => {
        const status = sanitizeString(entry?.status).toLowerCase();
        const waId = normalizeContactDigits(entry?.wa_id || entry?.waId);
        const inputDigits = normalizeContactDigits(entry?.input);
        if (status === 'valid' || waId) {
          if (waId) validDigits.add(waId);
          if (inputDigits) validDigits.add(inputDigits);
        }
      });
    }

    const results = candidates
      .map((entry) => {
        const waId = resolveValidWaId(entry.waId, validDigits);
        if (!waId) return null;
        return {
          waId,
          name: entry.name,
          phone: waId,
          isKnownUser: true,
        };
      })
      .filter(Boolean)
      .slice(0, limit);

    return res.json(results);
  } catch (error) {
    console.error('Erro ao buscar contatos WhatsApp:', error);
    return res.status(500).json({ message: 'Erro ao buscar contatos WhatsApp.' });
  }
});

router.get('/:storeId/conversations/:waId/messages', requireAuth, authorizeRoles('admin', 'admin_master'), async (req, res) => {
  try {
    const { storeId, waId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(storeId)) {
      return res.status(400).json({ message: 'Identificador de loja invalido.' });
    }

    const storeExists = await Store.exists({ _id: storeId });
    if (!storeExists) {
      return res.status(404).json({ message: 'Loja nao encontrada.' });
    }

    const integration = await WhatsappIntegration.findOne({ store: storeId }).lean();
    const phoneNumberId = resolvePhoneNumberIdFromQuery(integration, req.query);
    if (!phoneNumberId) {
      return res.status(400).json({ message: 'Phone Number ID nao informado.' });
    }

    const contactId = normalizeWaId(waId);
    if (!contactId) {
      return res.status(400).json({ message: 'Contato invalido.' });
    }

    const limit = resolveLimit(req.query.limit);
    const before = parseTimestamp(req.query.before);
    const contactRegex = buildPhoneMatchRegex(contactId);
    const contactMatch = contactRegex
      ? [{ origin: contactId }, { destination: contactId }, { origin: contactRegex }, { destination: contactRegex }]
      : [{ origin: contactId }, { destination: contactId }];
    const filter = {
      store: storeId,
      phoneNumberId,
      $or: contactMatch,
    };
    if (before) {
      filter.createdAt = { $lt: before };
    }

    const logs = await WhatsappLog.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    const seenMessages = new Set();
    const filtered = logs.filter((entry) => {
      const messageId = sanitizeString(entry?.messageId);
      if (!messageId) return true;
      const key = `${sanitizeString(entry?.direction)}:${messageId}`;
      if (seenMessages.has(key)) return false;
      seenMessages.add(key);
      return true;
    });

    const messages = filtered.map(mapMessageResponse).reverse();
    return res.json({ messages });
  } catch (error) {
    console.error('Erro ao buscar mensagens do WhatsApp:', error);
    return res.status(500).json({ message: 'Erro ao buscar mensagens do WhatsApp.' });
  }
});

router.delete('/:storeId/conversations/:waId', requireAuth, authorizeRoles('admin', 'admin_master'), async (req, res) => {
  try {
    const { storeId, waId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(storeId)) {
      return res.status(400).json({ message: 'Identificador de loja invalido.' });
    }

    const storeExists = await Store.exists({ _id: storeId });
    if (!storeExists) {
      return res.status(404).json({ message: 'Loja nao encontrada.' });
    }

    const integration = await WhatsappIntegration.findOne({ store: storeId }).lean();
    const phoneNumberId = resolvePhoneNumberIdFromQuery(integration, req.query);
    if (!phoneNumberId) {
      return res.status(400).json({ message: 'Phone Number ID nao informado.' });
    }

    const contactId = normalizeWaId(waId);
    if (!contactId) {
      return res.status(400).json({ message: 'Contato invalido.' });
    }

    const variants = buildPhoneVariants(contactId);
    if (!variants.length) {
      return res.status(400).json({ message: 'Contato invalido.' });
    }

    const or = [];
    variants.forEach((variant) => {
      or.push({ origin: variant }, { destination: variant });
      const regex = buildPhoneMatchRegex(variant);
      if (regex) {
        or.push({ origin: regex }, { destination: regex });
      }
    });

    const logResult = await WhatsappLog.deleteMany({
      store: storeId,
      phoneNumberId,
      $or: or,
    });

    const contactResult = await WhatsappContact.deleteMany({
      store: storeId,
      phoneNumberId,
      waId: { $in: variants },
    });

    return res.json({
      message: 'Conversa removida.',
      logsDeleted: logResult?.deletedCount || 0,
      contactsDeleted: contactResult?.deletedCount || 0,
    });
  } catch (error) {
    console.error('Erro ao apagar conversa do WhatsApp:', error);
    return res.status(500).json({ message: 'Erro ao apagar conversa do WhatsApp.' });
  }
});

router.post('/:storeId/mark-read', requireAuth, authorizeRoles('admin', 'admin_master'), async (req, res) => {
  try {
    const { storeId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(storeId)) {
      return res.status(400).json({ message: 'Identificador de loja invalido.' });
    }

    const storeExists = await Store.exists({ _id: storeId });
    if (!storeExists) {
      return res.status(404).json({ message: 'Loja nao encontrada.' });
    }

    const payload = req.body || {};
    const phoneNumberId = sanitizeString(payload.phoneNumberId);
    const contactId = normalizeWaId(payload.waId || payload.contactId || payload.contact || '');
    const messageIds = Array.isArray(payload.messageIds)
      ? payload.messageIds.map(sanitizeString)
      : [sanitizeString(payload.messageId)];
    const uniqueIds = Array.from(new Set(messageIds.filter(Boolean)));

    if (!phoneNumberId) {
      return res.status(400).json({ message: 'Phone Number ID nao informado.' });
    }
    if (!uniqueIds.length) {
      return res.status(400).json({ message: 'Message ID nao informado.' });
    }

    const integration = await findIntegration(storeId);
    if (!integration) {
      return res.status(404).json({ message: 'Integracao do WhatsApp nao configurada.' });
    }

    const accessToken = decryptField(integration.accessTokenEncrypted, integration.accessTokenStored);
    if (!accessToken) {
      return res.status(400).json({ message: 'Token de acesso nao informado.' });
    }

    const requestUrl = `${GRAPH_BASE_URL}/${phoneNumberId}/messages`;
    const results = [];
    for (const messageId of uniqueIds) {
      const { response, payload: graphPayload } = await sendWhatsappText({
        url: requestUrl,
        accessToken,
        body: {
          messaging_product: 'whatsapp',
          status: 'read',
          message_id: messageId,
        },
      });
      results.push({
        messageId,
        ok: response.ok,
        status: response.status,
        error: response.ok ? '' : extractGraphError(graphPayload),
      });
    }

    if (contactId && phoneNumberId) {
      const now = new Date();
      try {
        await WhatsappContact.updateOne(
          { store: storeId, phoneNumberId, waId: contactId },
          { $set: { unreadCount: 0, lastReadAt: now, updatedAt: now } }
        );
      } catch (updateError) {
        console.error('Erro ao atualizar leitura do contato WhatsApp:', updateError);
      }
    }

    const ok = results.every((entry) => entry.ok);
    if (!ok) {
      return res.status(502).json({ ok, results, message: 'Falha ao marcar mensagem como lida.' });
    }

    return res.json({ ok: true, results });
  } catch (error) {
    console.error('Erro ao marcar mensagem como lida:', error);
    return res.status(500).json({ message: 'Erro ao marcar mensagem como lida.' });
  }
});

router.post('/:storeId/send-audio', requireAuth, authorizeRoles('admin', 'admin_master'), audioUpload.single('file'), async (req, res) => {
  try {
    const { storeId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(storeId)) {
      return res.status(400).json({ message: 'Identificador de loja invalido.' });
    }

    const storeExists = await Store.exists({ _id: storeId });
    if (!storeExists) {
      return res.status(404).json({ message: 'Loja nao encontrada.' });
    }

    const payload = req.body || {};
    const clientId = sanitizeString(payload.clientId);
    const destination = digitsOnly(payload.destination || payload.waId);
    if (!destination) {
      return res.status(400).json({ message: 'Destino nao informado.' });
    }

    const integration = await findIntegration(storeId);
    if (!integration) {
      return res.status(404).json({ message: 'Integracao do WhatsApp nao configurada.' });
    }

    const accessToken = decryptField(integration.accessTokenEncrypted, integration.accessTokenStored);
    if (!accessToken) {
      return res.status(400).json({ message: 'Token de acesso nao informado.' });
    }

    const numberMeta = resolveNumberMeta(integration, payload);
    if (!numberMeta.phoneNumberId) {
      return res.status(400).json({ message: 'Numero de origem nao encontrado.' });
    }

    const file = req.file;
    if (!file || !file.buffer) {
      return res.status(400).json({ message: 'Arquivo de audio nao informado.' });
    }
    const rawMimeType = sanitizeString(file.mimetype);
    const normalizedMimeType = normalizeAudioMime(rawMimeType);
    if (!normalizedMimeType || !AUDIO_INPUT_MIME_TYPES.has(normalizedMimeType)) {
      return res.status(400).json({ message: 'Formato de audio invalido.' });
    }

    const voiceParam = sanitizeString(payload.voice).toLowerCase();
    let voice = voiceParam === 'true' || voiceParam === '1' || (!voiceParam && normalizedMimeType === 'audio/ogg');

    let uploadBuffer = file.buffer;
    let uploadMimeType = normalizedMimeType;
    const requiresConversion = (voice && normalizedMimeType !== 'audio/ogg') || !GRAPH_AUDIO_MIME_TYPES.has(normalizedMimeType);

    if (requiresConversion) {
      if (!ensureFfmpegAvailable()) {
        return res.status(500).json({ message: 'FFmpeg nao disponivel para converter o audio.' });
      }
      try {
        const inputExt = resolveAudioExtension(normalizedMimeType);
        uploadBuffer = await convertAudioBufferToOgg(file.buffer, inputExt);
        uploadMimeType = 'audio/ogg';
      } catch (convertError) {
        console.error('Erro ao converter audio:', convertError);
        return res.status(500).json({ message: 'Erro ao converter o audio para OGG.' });
      }
    }

    const form = new FormData();
    const audioBlob = new Blob([uploadBuffer], { type: uploadMimeType });
    form.append('messaging_product', 'whatsapp');
    form.append('type', uploadMimeType);
    form.append('file', audioBlob, sanitizeString(file.originalname) || `audio.${resolveAudioExtension(uploadMimeType)}`);

    const controller = buildTimeoutController();
    let uploadPayload = null;
    try {
      const uploadResponse = await fetch(`${GRAPH_WEBHOOK_BASE_URL}/${numberMeta.phoneNumberId}/media?messaging_product=whatsapp`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        body: form,
        duplex: 'half',
        signal: controller.signal,
      });
      uploadPayload = await parseGraphResponse(uploadResponse);

      if (!uploadResponse.ok) {
        const errorMessage = extractGraphError(uploadPayload);
        const details = extractGraphErrorDetails(uploadPayload);
        const detailSuffix = details
          ? ` (code ${details.code ?? '-'}, subcode ${details.subcode ?? '-'}, trace ${details.fbtrace_id ?? '-'})`
          : '';
        return res.status(uploadResponse.status || 502).json({
          message: `${errorMessage || 'Falha ao enviar audio.'}${detailSuffix}`,
          error: details,
        });
      }

      const mediaId = sanitizeString(uploadPayload?.id || uploadPayload?.media?.[0]?.id || uploadPayload?.handle || '');
      if (!mediaId) {
        return res.status(502).json({ message: 'Nao foi possivel obter o id da midia.' });
      }

      const requestBody = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: destination,
        type: 'audio',
        audio: {
          id: mediaId,
          ...(voice ? { voice: true } : {}),
        },
      };

      const { response, payload: graphPayload } = await sendWhatsappText({
        url: `${GRAPH_BASE_URL}/${numberMeta.phoneNumberId}/messages`,
        accessToken,
        body: requestBody,
      });

      const messageId = sanitizeString(graphPayload?.messages?.[0]?.id);
      const status = response.ok ? 'Enviado' : 'Erro';
      const errorMessage = !response.ok ? extractGraphError(graphPayload) : '';
      const label = voice ? '[voz]' : '[audio]';
      let mediaMeta = null;
      if (isR2Configured()) {
        try {
          mediaMeta = await storeOutgoingWhatsappMedia({
            storeId,
            waId: destination,
            mediaId,
            messageId: messageId || mediaId,
            mediaType: 'audio',
            buffer: uploadBuffer,
            mimeType: uploadMimeType,
            filename: file.originalname,
            voice,
          });
        } catch (r2Error) {
          console.error('Erro ao salvar audio no R2:', r2Error);
        }
      }

      const log = await WhatsappLog.create({
        store: storeId,
        direction: 'outgoing',
        status,
        phoneNumberId: numberMeta.phoneNumberId,
        phoneNumber: numberMeta.phoneNumber,
        numberLabel: numberMeta.numberLabel,
        origin: numberMeta.phoneNumber,
        destination,
        message: label,
        messageId,
        source: 'web',
        meta: response.ok
          ? {
              graphStatus: response.status,
              mediaId,
              voice,
              mimeType: uploadMimeType,
              originalMimeType: rawMimeType,
              media: mediaMeta,
              clientId,
            }
          : {
              graphStatus: response.status,
              graphError: errorMessage,
              mediaId,
              voice,
              mimeType: uploadMimeType,
              originalMimeType: rawMimeType,
              media: mediaMeta,
              clientId,
            },
      });

      await upsertContact({
        storeId,
        phoneNumberId: numberMeta.phoneNumberId,
        waId: destination,
        lastMessage: label,
        lastMessageAt: new Date(),
        lastDirection: 'outgoing',
        lastMessageId: messageId,
        lastStatus: status,
      });

      emitWhatsappSocketEvent(req, {
        storeId,
        phoneNumberId: numberMeta.phoneNumberId,
        waId: destination,
        direction: 'outgoing',
        status,
        message: label,
        messageId,
        media: mediaMeta,
        origin: numberMeta.phoneNumber,
        destination,
        clientId,
        createdAt: log?.createdAt ? log.createdAt.toISOString() : new Date().toISOString(),
      });

      if (numberMeta.phoneNumberId) {
        const updateFields = {
          'phoneNumbers.$.lastSyncAt': new Date(),
        };
        if (response.ok) {
          updateFields['phoneNumbers.$.status'] = 'Conectado';
        }
        await WhatsappIntegration.updateOne(
          { _id: integration._id, 'phoneNumbers.phoneNumberId': numberMeta.phoneNumberId },
          { $set: updateFields }
        );
      }

      if (!response.ok) {
        return res.status(502).json({
        message: errorMessage || 'Falha ao enviar audio via WhatsApp.',
        log: mapLogResponse(log),
      });
      }

      return res.json({ log: mapLogResponse(log) });
    } finally {
      controller.dispose();
    }
  } catch (error) {
    const message = error.name === 'AbortError'
      ? 'Tempo limite excedido ao enviar audio.'
      : 'Erro ao enviar audio do WhatsApp.';
    console.error('Erro ao enviar audio WhatsApp:', error);
    return res.status(500).json({ message });
  }
});

router.post('/:storeId/send-image', requireAuth, authorizeRoles('admin', 'admin_master'), imageUpload.single('file'), async (req, res) => {
  try {
    const { storeId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(storeId)) {
      return res.status(400).json({ message: 'Identificador de loja invalido.' });
    }

    const storeExists = await Store.exists({ _id: storeId });
    if (!storeExists) {
      return res.status(404).json({ message: 'Loja nao encontrada.' });
    }

    const payload = req.body || {};
    const clientId = sanitizeString(payload.clientId);
    const destination = digitsOnly(payload.destination || payload.waId);
    if (!destination) {
      return res.status(400).json({ message: 'Destino nao informado.' });
    }
    const destinationPhone = normalizeToE164(destination);
    if (!destinationPhone) {
      return res.status(400).json({ message: 'Destino invalido.' });
    }

    const integration = await findIntegration(storeId);
    if (!integration) {
      return res.status(404).json({ message: 'Integracao do WhatsApp nao configurada.' });
    }

    const accessToken = decryptField(integration.accessTokenEncrypted, integration.accessTokenStored);
    if (!accessToken) {
      return res.status(400).json({ message: 'Token de acesso nao informado.' });
    }

    const numberMeta = resolveNumberMeta(integration, payload);
    if (!numberMeta.phoneNumberId) {
      return res.status(400).json({ message: 'Numero de origem nao encontrado.' });
    }

    const file = req.file;
    if (!file || !file.buffer) {
      return res.status(400).json({ message: 'Imagem nao informada.' });
    }

    const rawMimeType = sanitizeString(file.mimetype);
    const normalizedMimeType = normalizeImageMime(rawMimeType);
    if (!normalizedMimeType || !IMAGE_INPUT_MIME_TYPES.has(normalizedMimeType)) {
      return res.status(400).json({ message: 'Formato de imagem invalido.' });
    }

    const caption = sanitizeString(payload.caption);
    const fileName = sanitizeFileName(payload.filename || file.originalname || 'imagem');

    const form = new FormData();
    const imageBlob = new Blob([file.buffer], { type: normalizedMimeType });
    form.append('messaging_product', 'whatsapp');
    form.append('type', normalizedMimeType);
    form.append('file', imageBlob, fileName);

    const controller = buildTimeoutController();
    let uploadPayload = null;
    try {
      const uploadResponse = await fetch(
        `${GRAPH_WEBHOOK_BASE_URL}/${numberMeta.phoneNumberId}/media?messaging_product=whatsapp`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
          body: form,
          duplex: 'half',
          signal: controller.signal,
        }
      );
      uploadPayload = await parseGraphResponse(uploadResponse);

      if (!uploadResponse.ok) {
        const errorMessage = extractGraphError(uploadPayload);
        const details = extractGraphErrorDetails(uploadPayload);
        const detailSuffix = details
          ? ` (code ${details.code ?? '-'}, subcode ${details.subcode ?? '-'}, trace ${details.fbtrace_id ?? '-'})`
          : '';
        return res.status(uploadResponse.status || 502).json({
          message: `${errorMessage || 'Falha ao enviar imagem.'}${detailSuffix}`,
          error: details,
        });
      }

      const mediaId = sanitizeString(uploadPayload?.id || uploadPayload?.media?.[0]?.id || uploadPayload?.handle || '');
      if (!mediaId) {
        return res.status(502).json({ message: 'Nao foi possivel obter o id da midia.' });
      }

      const requestBody = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: destinationPhone,
        type: 'image',
        image: {
          id: mediaId,
          ...(caption ? { caption } : {}),
        },
      };

      const { response, payload: graphPayload } = await sendWhatsappText({
        url: `${GRAPH_BASE_URL}/${numberMeta.phoneNumberId}/messages`,
        accessToken,
        body: requestBody,
      });

      const messageId = sanitizeString(graphPayload?.messages?.[0]?.id);
      const status = response.ok ? 'Enviado' : 'Erro';
      const errorMessage = !response.ok ? extractGraphError(graphPayload) : '';
      const label = caption || '[imagem]';
      let mediaMeta = null;
      if (isR2Configured()) {
        try {
          mediaMeta = await storeOutgoingWhatsappMedia({
            storeId,
            waId: destination,
            mediaId,
            messageId: messageId || mediaId,
            mediaType: 'image',
            buffer: file.buffer,
            mimeType: normalizedMimeType,
            filename: fileName,
          });
        } catch (r2Error) {
          console.error('Erro ao salvar imagem no R2:', r2Error);
        }
      }

      const fallbackMedia = {
        id: mediaId,
        type: 'image',
        direction: 'outgoing',
        mimeType: normalizedMimeType,
        filename: fileName,
        caption,
      };
      const logMedia = mediaMeta || fallbackMedia;

      const log = await WhatsappLog.create({
        store: storeId,
        direction: 'outgoing',
        status,
        phoneNumberId: numberMeta.phoneNumberId,
        phoneNumber: numberMeta.phoneNumber,
        numberLabel: numberMeta.numberLabel,
        origin: numberMeta.phoneNumber,
        destination,
        message: label,
        messageId,
        source: 'web',
        meta: response.ok
          ? {
              graphStatus: response.status,
              mediaId,
              mimeType: normalizedMimeType,
              filename: fileName,
              caption,
              mediaType: 'image',
              media: logMedia,
              clientId,
            }
          : {
              graphStatus: response.status,
              graphError: errorMessage,
              mediaId,
              mimeType: normalizedMimeType,
              filename: fileName,
              caption,
              mediaType: 'image',
              media: logMedia,
              clientId,
            },
      });

      await upsertContact({
        storeId,
        phoneNumberId: numberMeta.phoneNumberId,
        waId: destination,
        lastMessage: label,
        lastMessageAt: new Date(),
        lastDirection: 'outgoing',
        lastMessageId: messageId,
        lastStatus: status,
      });

      emitWhatsappSocketEvent(req, {
        storeId,
        phoneNumberId: numberMeta.phoneNumberId,
        waId: destination,
        direction: 'outgoing',
        status,
        message: label,
        messageId,
        media: logMedia,
        origin: numberMeta.phoneNumber,
        destination,
        clientId,
        createdAt: log?.createdAt ? log.createdAt.toISOString() : new Date().toISOString(),
      });

      if (numberMeta.phoneNumberId) {
        const updateFields = {
          'phoneNumbers.$.lastSyncAt': new Date(),
        };
        if (response.ok) {
          updateFields['phoneNumbers.$.status'] = 'Conectado';
        }
        await WhatsappIntegration.updateOne(
          { _id: integration._id, 'phoneNumbers.phoneNumberId': numberMeta.phoneNumberId },
          { $set: updateFields }
        );
      }

      if (!response.ok) {
        const details = extractGraphErrorDetails(graphPayload);
        const detailSuffix = details
          ? ` (code ${details.code ?? '-'}, subcode ${details.subcode ?? '-'}, trace ${details.fbtrace_id ?? '-'})`
          : '';
        return res.status(502).json({
          message: `${errorMessage || 'Falha ao enviar imagem via WhatsApp.'}${detailSuffix}`,
          log: mapLogResponse(log),
        });
      }

      return res.json({ log: mapLogResponse(log) });
    } finally {
      controller.dispose();
    }
  } catch (error) {
    const message = error.name === 'AbortError'
      ? 'Tempo limite excedido ao enviar imagem.'
      : 'Erro ao enviar imagem do WhatsApp.';
    console.error('Erro ao enviar imagem WhatsApp:', error);
    return res.status(500).json({ message });
  }
});

router.post('/:storeId/send-document', requireAuth, authorizeRoles('admin', 'admin_master'), documentUpload.single('file'), async (req, res) => {
  try {
    const { storeId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(storeId)) {
      return res.status(400).json({ message: 'Identificador de loja invalido.' });
    }

    const storeExists = await Store.exists({ _id: storeId });
    if (!storeExists) {
      return res.status(404).json({ message: 'Loja nao encontrada.' });
    }

    const payload = req.body || {};
    const clientId = sanitizeString(payload.clientId);
    const destination = digitsOnly(payload.destination || payload.waId);
    if (!destination) {
      return res.status(400).json({ message: 'Destino nao informado.' });
    }
    const destinationPhone = normalizeToE164(destination);
    if (!destinationPhone) {
      return res.status(400).json({ message: 'Destino invalido.' });
    }

    const integration = await findIntegration(storeId);
    if (!integration) {
      return res.status(404).json({ message: 'Integracao do WhatsApp nao configurada.' });
    }

    const accessToken = decryptField(integration.accessTokenEncrypted, integration.accessTokenStored);
    if (!accessToken) {
      return res.status(400).json({ message: 'Token de acesso nao informado.' });
    }

    const numberMeta = resolveNumberMeta(integration, payload);
    if (!numberMeta.phoneNumberId) {
      return res.status(400).json({ message: 'Numero de origem nao encontrado.' });
    }

    const file = req.file;
    if (!file || !file.buffer) {
      return res.status(400).json({ message: 'Arquivo de documento nao informado.' });
    }

    const rawMimeType = sanitizeString(file.mimetype);
    const caption = sanitizeString(payload.caption);
    const fileName = sanitizeFileName(payload.filename || file.originalname || 'documento');
    const uploadMimeType = resolveGraphDocumentMimeType(rawMimeType, fileName);
    if (!uploadMimeType) {
      return res.status(400).json({ message: 'Formato de documento invalido.' });
    }

    const form = new FormData();
    const fileBlob = new Blob([file.buffer], { type: uploadMimeType });
    form.append('messaging_product', 'whatsapp');
    form.append('type', uploadMimeType);
    form.append('file', fileBlob, fileName);

    const controller = buildTimeoutController();
    let uploadPayload = null;
    try {
      const uploadResponse = await fetch(
        `${GRAPH_WEBHOOK_BASE_URL}/${numberMeta.phoneNumberId}/media?messaging_product=whatsapp`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
          body: form,
          duplex: 'half',
          signal: controller.signal,
        }
      );
      uploadPayload = await parseGraphResponse(uploadResponse);

      if (!uploadResponse.ok) {
        const errorMessage = extractGraphError(uploadPayload);
        const details = extractGraphErrorDetails(uploadPayload);
        const detailSuffix = details
          ? ` (code ${details.code ?? '-'}, subcode ${details.subcode ?? '-'}, trace ${details.fbtrace_id ?? '-'})`
          : '';
        return res.status(uploadResponse.status || 502).json({
          message: `${errorMessage || 'Falha ao enviar documento.'}${detailSuffix}`,
          error: details,
        });
      }

      const mediaId = sanitizeString(uploadPayload?.id || uploadPayload?.media?.[0]?.id || uploadPayload?.handle || '');
      if (!mediaId) {
        return res.status(502).json({ message: 'Nao foi possivel obter o id da midia.' });
      }

      const requestBody = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: destinationPhone,
        type: 'document',
        document: {
          id: mediaId,
          filename: fileName,
          ...(caption ? { caption } : {}),
        },
      };

      const { response, payload: graphPayload } = await sendWhatsappText({
        url: `${GRAPH_BASE_URL}/${numberMeta.phoneNumberId}/messages`,
        accessToken,
        body: requestBody,
      });

      const messageId = sanitizeString(graphPayload?.messages?.[0]?.id);
      const status = response.ok ? 'Enviado' : 'Erro';
      const errorMessage = !response.ok ? extractGraphError(graphPayload) : '';
      const label = caption || fileName || '[documento]';
      let mediaMeta = null;
      if (isR2Configured()) {
        try {
          mediaMeta = await storeOutgoingWhatsappMedia({
            storeId,
            waId: destination,
            mediaId,
            messageId: messageId || mediaId,
            mediaType: 'document',
            buffer: file.buffer,
            mimeType: rawMimeType,
            filename: fileName,
          });
        } catch (r2Error) {
          console.error('Erro ao salvar documento no R2:', r2Error);
        }
      }
      const fallbackMedia = {
        id: mediaId,
        type: 'document',
        direction: 'outgoing',
        mimeType: rawMimeType,
        filename: fileName,
        caption,
      };
      const logMedia = mediaMeta || fallbackMedia;

      const log = await WhatsappLog.create({
        store: storeId,
        direction: 'outgoing',
        status,
        phoneNumberId: numberMeta.phoneNumberId,
        phoneNumber: numberMeta.phoneNumber,
        numberLabel: numberMeta.numberLabel,
        origin: numberMeta.phoneNumber,
        destination,
        message: label,
        messageId,
        source: 'web',
        meta: response.ok
          ? {
              graphStatus: response.status,
              mediaId,
              mimeType: rawMimeType,
              filename: fileName,
              caption,
              mediaType: 'document',
              media: logMedia,
              clientId,
            }
          : {
              graphStatus: response.status,
              graphError: errorMessage,
              mediaId,
              mimeType: rawMimeType,
              filename: fileName,
              caption,
              mediaType: 'document',
              media: logMedia,
              clientId,
            },
      });

      await upsertContact({
        storeId,
        phoneNumberId: numberMeta.phoneNumberId,
        waId: destination,
        lastMessage: label,
        lastMessageAt: new Date(),
        lastDirection: 'outgoing',
        lastMessageId: messageId,
        lastStatus: status,
      });

      emitWhatsappSocketEvent(req, {
        storeId,
        phoneNumberId: numberMeta.phoneNumberId,
        waId: destination,
        direction: 'outgoing',
        status,
        message: label,
        messageId,
        media: logMedia,
        origin: numberMeta.phoneNumber,
        destination,
        clientId,
        createdAt: log?.createdAt ? log.createdAt.toISOString() : new Date().toISOString(),
      });

      if (numberMeta.phoneNumberId) {
        const updateFields = {
          'phoneNumbers.$.lastSyncAt': new Date(),
        };
        if (response.ok) {
          updateFields['phoneNumbers.$.status'] = 'Conectado';
        }
        await WhatsappIntegration.updateOne(
          { _id: integration._id, 'phoneNumbers.phoneNumberId': numberMeta.phoneNumberId },
          { $set: updateFields }
        );
      }

      if (!response.ok) {
        const details = extractGraphErrorDetails(graphPayload);
        const detailSuffix = details
          ? ` (code ${details.code ?? '-'}, subcode ${details.subcode ?? '-'}, trace ${details.fbtrace_id ?? '-'})`
          : '';
        return res.status(502).json({
          message: `${errorMessage || 'Falha ao enviar documento via WhatsApp.'}${detailSuffix}`,
          log: mapLogResponse(log),
        });
      }

      return res.json({ log: mapLogResponse(log) });
    } finally {
      controller.dispose();
    }
  } catch (error) {
    const message = error.name === 'AbortError'
      ? 'Tempo limite excedido ao enviar documento.'
      : 'Erro ao enviar documento do WhatsApp.';
    console.error('Erro ao enviar documento WhatsApp:', error);
    return res.status(500).json({ message });
  }
});

router.post('/:storeId/send-contacts', requireAuth, authorizeRoles('admin', 'admin_master'), async (req, res) => {
  try {
    const { storeId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(storeId)) {
      return res.status(400).json({ message: 'Identificador de loja invalido.' });
    }

    const storeExists = await Store.exists({ _id: storeId });
    if (!storeExists) {
      return res.status(404).json({ message: 'Loja nao encontrada.' });
    }

    const payload = req.body || {};
    const destination = digitsOnly(payload.destination || payload.waId);
    const contactsInput = Array.isArray(payload.contacts) ? payload.contacts : [];
    if (!destination || contactsInput.length === 0) {
      return res.status(400).json({ message: 'Destino e contatos sao obrigatorios.' });
    }
    const destinationPhone = normalizeToE164(destination);
    if (!destinationPhone) {
      return res.status(400).json({ message: 'Destino invalido.' });
    }

    const integration = await findIntegration(storeId);
    if (!integration) {
      return res.status(404).json({ message: 'Integracao do WhatsApp nao configurada.' });
    }

    const accessToken = decryptField(integration.accessTokenEncrypted, integration.accessTokenStored);
    if (!accessToken) {
      return res.status(400).json({ message: 'Token de acesso nao informado.' });
    }

    const numberMeta = resolveNumberMeta(integration, payload);
    if (!numberMeta.phoneNumberId) {
      return res.status(400).json({ message: 'Numero de origem nao encontrado.' });
    }

    const invalidPhones = [];
    const normalizedContacts = contactsInput
      .map((entry) => {
        const rawName = sanitizeString(entry?.name || entry?.nome || entry?.label);
        const rawPhone = sanitizeString(entry?.phone || entry?.celular || entry?.waId || entry?.whatsapp);
        const digits = digitsOnly(rawPhone);
        if (!digits) {
          invalidPhones.push(rawPhone || '');
          return null;
        }

        const isBrazilWithCountry = digits.startsWith('55') && digits.length === 13;
        const isBrazilLocal = !digits.startsWith('55') && digits.length === 11;
        const isInternational = digits.length >= 12 && digits.length <= 15;
        if (!isBrazilWithCountry && !isBrazilLocal && !isInternational) {
          invalidPhones.push(rawPhone || digits);
          return null;
        }

        const formattedName = rawName || digits;
        const nameParts = formattedName.split(/\s+/).filter(Boolean);
        const namePayload = { formatted_name: formattedName };
        if (nameParts.length > 0) {
          namePayload.first_name = nameParts[0];
          if (nameParts.length > 1) {
            namePayload.last_name = nameParts.slice(1).join(' ');
          }
        } else {
          namePayload.first_name = formattedName;
        }
        const phone = normalizeToE164(digits);
        const waId = normalizeToWaId(digits);
        return {
          name: namePayload,
          phones: [
            {
              phone,
              wa_id: waId || undefined,
            },
          ],
        };
      })
      .filter(Boolean);

    if (normalizedContacts.length > 10) {
      return res.status(400).json({ message: 'Selecione no maximo 10 contatos.' });
    }

    const contactsPayload = normalizedContacts.slice(0, 10);

    if (!contactsPayload.length) {
      const detail = invalidPhones.length ? ` Numeros invalidos: ${invalidPhones.filter(Boolean).slice(0, 5).join(', ')}` : '';
      return res.status(400).json({ message: `Selecione contatos validos para enviar.${detail}` });
    }

    const requestBody = {
      messaging_product: 'whatsapp',
      to: destinationPhone,
      type: 'contacts',
      contacts: contactsPayload,
    };

    console.log('[whatsapp:send-contacts] request', JSON.stringify({
      phoneNumberId: numberMeta.phoneNumberId,
      to: requestBody.to,
      contacts: requestBody.contacts,
    }, null, 2));

    const { response, payload: graphPayload } = await sendWhatsappText({
      url: `${GRAPH_BASE_URL}/${numberMeta.phoneNumberId}/messages`,
      accessToken,
      body: requestBody,
    });

    const messageId = sanitizeString(graphPayload?.messages?.[0]?.id);
    const status = response.ok ? 'Enviado' : 'Erro';
    const errorMessage = !response.ok ? extractGraphError(graphPayload) : '';
    if (!response.ok) {
      console.log('[whatsapp:send-contacts] response', JSON.stringify(graphPayload || {}, null, 2));
    }
    const messageLabel = contactsPayload.length === 1
      ? 'Contato compartilhado'
      : `${contactsPayload.length} contatos compartilhados`;

    const log = await WhatsappLog.create({
      store: storeId,
      direction: 'outgoing',
      status,
      phoneNumberId: numberMeta.phoneNumberId,
      phoneNumber: numberMeta.phoneNumber,
      numberLabel: numberMeta.numberLabel,
      origin: numberMeta.phoneNumber,
      destination,
      message: messageLabel,
      messageId,
      source: 'web',
      meta: response.ok
        ? { graphStatus: response.status, contacts: contactsPayload }
        : { graphStatus: response.status, graphError: errorMessage, contacts: contactsPayload },
    });

    await upsertContact({
      storeId,
      phoneNumberId: numberMeta.phoneNumberId,
      waId: destination,
      lastMessage: messageLabel,
      lastMessageAt: new Date(),
      lastDirection: 'outgoing',
      lastMessageId: messageId,
      lastStatus: status,
    });

    emitWhatsappSocketEvent(req, {
      storeId,
      phoneNumberId: numberMeta.phoneNumberId,
      waId: destination,
      direction: 'outgoing',
      status,
      message: messageLabel,
      messageId,
      contacts: contactsPayload,
      origin: numberMeta.phoneNumber,
      destination,
      createdAt: log?.createdAt ? log.createdAt.toISOString() : new Date().toISOString(),
    });

    if (numberMeta.phoneNumberId) {
      const updateFields = {
        'phoneNumbers.$.lastSyncAt': new Date(),
      };
      if (response.ok) {
        updateFields['phoneNumbers.$.status'] = 'Conectado';
      }
      await WhatsappIntegration.updateOne(
        { _id: integration._id, 'phoneNumbers.phoneNumberId': numberMeta.phoneNumberId },
        { $set: updateFields }
      );
    }

    if (!response.ok) {
      const details = extractGraphErrorDetails(graphPayload);
      const errorDetails = sanitizeString(graphPayload?.error?.error_data?.details || '');
      const detailExtra = errorDetails ? ` ${errorDetails}` : '';
      const detailSuffix = details
        ? ` (code ${details.code ?? '-'}, subcode ${details.subcode ?? '-'}, trace ${details.fbtrace_id ?? '-'})`
        : '';
      return res.status(502).json({
        message: `${errorMessage || 'Falha ao enviar contatos via WhatsApp.'}${detailExtra}${detailSuffix}`,
        log: mapLogResponse(log),
      });
    }

    return res.json({ log: mapLogResponse(log) });
  } catch (error) {
    const message = error.name === 'AbortError'
      ? 'Tempo limite excedido ao enviar contatos.'
      : 'Erro ao enviar contatos do WhatsApp.';
    console.error('Erro ao enviar contatos WhatsApp:', error);
    return res.status(500).json({ message });
  }
});

router.post('/:storeId/send-message', requireAuth, authorizeRoles('admin', 'admin_master'), async (req, res) => {
  try {
    const { storeId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(storeId)) {
      return res.status(400).json({ message: 'Identificador de loja invalido.' });
    }

    const storeExists = await Store.exists({ _id: storeId });
    if (!storeExists) {
      return res.status(404).json({ message: 'Loja nao encontrada.' });
    }

    const payload = req.body || {};
    const destination = digitsOnly(payload.destination || payload.waId);
    const message = sanitizeString(payload.message);
    if (!destination || !message) {
      return res.status(400).json({ message: 'Destino e mensagem sao obrigatorios.' });
    }

    const integration = await findIntegration(storeId);
    if (!integration) {
      return res.status(404).json({ message: 'Integracao do WhatsApp nao configurada.' });
    }

    const accessToken = decryptField(integration.accessTokenEncrypted, integration.accessTokenStored);
    if (!accessToken) {
      return res.status(400).json({ message: 'Token de acesso nao informado.' });
    }

    const numberMeta = resolveNumberMeta(integration, payload);
    if (!numberMeta.phoneNumberId) {
      return res.status(400).json({ message: 'Numero de origem nao encontrado.' });
    }

    const requestBody = {
      messaging_product: 'whatsapp',
      to: destination,
      type: 'text',
      text: { body: message },
    };

    const { response, payload: graphPayload } = await sendWhatsappText({
      url: `${GRAPH_BASE_URL}/${numberMeta.phoneNumberId}/messages`,
      accessToken,
      body: requestBody,
    });

    const messageId = sanitizeString(graphPayload?.messages?.[0]?.id);
    const status = response.ok ? 'Enviado' : 'Erro';
    const errorMessage = !response.ok ? extractGraphError(graphPayload) : '';

    const log = await WhatsappLog.create({
      store: storeId,
      direction: 'outgoing',
      status,
      phoneNumberId: numberMeta.phoneNumberId,
      phoneNumber: numberMeta.phoneNumber,
      numberLabel: numberMeta.numberLabel,
      origin: numberMeta.phoneNumber,
      destination,
      message,
      messageId,
      source: 'web',
      meta: response.ok
        ? { graphStatus: response.status }
        : { graphStatus: response.status, graphError: errorMessage },
    });

    await upsertContact({
      storeId,
      phoneNumberId: numberMeta.phoneNumberId,
      waId: destination,
      lastMessage: message,
      lastMessageAt: new Date(),
      lastDirection: 'outgoing',
      lastMessageId: messageId,
      lastStatus: status,
    });

    emitWhatsappSocketEvent(req, {
      storeId,
      phoneNumberId: numberMeta.phoneNumberId,
      waId: destination,
      direction: 'outgoing',
      status,
      message,
      messageId,
      origin: numberMeta.phoneNumber,
      destination,
      createdAt: log?.createdAt ? log.createdAt.toISOString() : new Date().toISOString(),
    });

    if (numberMeta.phoneNumberId) {
      const updateFields = {
        'phoneNumbers.$.lastSyncAt': new Date(),
      };
      if (response.ok) {
        updateFields['phoneNumbers.$.status'] = 'Conectado';
      }
      await WhatsappIntegration.updateOne(
        { _id: integration._id, 'phoneNumbers.phoneNumberId': numberMeta.phoneNumberId },
        { $set: updateFields }
      );
    }

    if (!response.ok) {
      return res.status(502).json({
        message: errorMessage || 'Falha ao enviar mensagem via WhatsApp.',
        log: mapLogResponse(log),
      });
    }

    return res.json({ log: mapLogResponse(log) });
  } catch (error) {
    const message = error.name === 'AbortError'
      ? 'Tempo limite excedido ao enviar mensagem.'
      : 'Erro ao enviar mensagem do WhatsApp.';
    console.error('Erro ao enviar mensagem WhatsApp:', error);
    return res.status(500).json({ message });
  }
});

router.post('/:storeId/send-test', requireAuth, authorizeRoles('admin', 'admin_master'), async (req, res) => {
  try {
    const { storeId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(storeId)) {
      return res.status(400).json({ message: 'Identificador de loja invalido.' });
    }

    const storeExists = await Store.exists({ _id: storeId });
    if (!storeExists) {
      return res.status(404).json({ message: 'Loja nao encontrada.' });
    }

    const payload = req.body || {};
    const destination = digitsOnly(payload.destination);
    const message = sanitizeString(payload.message);
    if (!destination || !message) {
      return res.status(400).json({ message: 'Destino e mensagem sao obrigatorios.' });
    }

    const integration = await findIntegration(storeId);
    if (!integration) {
      return res.status(404).json({ message: 'Integracao do WhatsApp nao configurada.' });
    }

    const accessToken = decryptField(integration.accessTokenEncrypted, integration.accessTokenStored);
    if (!accessToken) {
      return res.status(400).json({ message: 'Token de acesso nao informado.' });
    }

    const numberMeta = resolveNumberMeta(integration, payload);
    if (!numberMeta.phoneNumberId) {
      return res.status(400).json({ message: 'Numero de origem nao encontrado.' });
    }

    const requestUrl = `${GRAPH_BASE_URL}/${numberMeta.phoneNumberId}/messages`;
    const requestBody = {
      messaging_product: 'whatsapp',
      to: destination,
      type: 'text',
      text: { body: message },
    };

    console.log('[whatsapp:send-test] request', {
      url: requestUrl,
      json: JSON.stringify(requestBody),
    });

    const { response, payload: graphPayload } = await sendWhatsappText({
      url: requestUrl,
      accessToken,
      body: requestBody,
    });

    const messageId = sanitizeString(graphPayload?.messages?.[0]?.id);
    const status = response.ok ? 'Enviado' : 'Erro';
    const errorMessage = !response.ok ? extractGraphError(graphPayload) : '';

    const log = await WhatsappLog.create({
      store: storeId,
      direction: 'outgoing',
      status,
      phoneNumberId: numberMeta.phoneNumberId,
      phoneNumber: numberMeta.phoneNumber,
      numberLabel: numberMeta.numberLabel,
      origin: numberMeta.phoneNumber,
      destination,
      message,
      messageId,
      source: 'manual',
      meta: response.ok
        ? { graphStatus: response.status }
        : { graphStatus: response.status, graphError: errorMessage },
    });

    if (numberMeta.phoneNumberId) {
      const updateFields = {
        'phoneNumbers.$.lastSyncAt': new Date(),
      };
      if (response.ok) {
        updateFields['phoneNumbers.$.status'] = 'Conectado';
      }
      await WhatsappIntegration.updateOne(
        { _id: integration._id, 'phoneNumbers.phoneNumberId': numberMeta.phoneNumberId },
        { $set: updateFields }
      );
    }

    if (!response.ok) {
      return res.status(502).json({
        message: errorMessage || 'Falha ao enviar mensagem via WhatsApp.',
        log: mapLogResponse(log),
      });
    }

    return res.json({ log: mapLogResponse(log) });
  } catch (error) {
    const message = error.name === 'AbortError'
      ? 'Tempo limite excedido ao enviar mensagem.'
      : 'Erro ao enviar mensagem do WhatsApp.';
    console.error('Erro ao enviar mensagem WhatsApp:', error);
    return res.status(500).json({ message });
  }
});

router.post('/:storeId/webhook/verify', requireAuth, authorizeRoles('admin', 'admin_master'), async (req, res) => {
  try {
    const { storeId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(storeId)) {
      return res.status(400).json({ message: 'Identificador de loja invalido.' });
    }

    const storeExists = await Store.exists({ _id: storeId });
    if (!storeExists) {
      return res.status(404).json({ message: 'Loja nao encontrada.' });
    }

    const integration = await findIntegration(storeId);
    if (!integration) {
      return res.status(404).json({ message: 'Integracao do WhatsApp nao configurada.' });
    }

    const accessToken = decryptField(integration.accessTokenEncrypted, integration.accessTokenStored);
    if (!accessToken) {
      return res.status(400).json({ message: 'Token de acesso nao informado.' });
    }

    const wabaId = sanitizeString(integration.wabaId);
    if (!wabaId) {
      return res.status(400).json({ message: 'WABA ID nao informado.' });
    }

    const controller = buildTimeoutController();
    let subscribeResponse;
    let subscribePayload;
    let checkResponse;
    let checkPayload;

    try {
      subscribeResponse = await fetch(`${GRAPH_WEBHOOK_BASE_URL}/${wabaId}/subscribed_apps`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ data: ['messages'] }),
        signal: controller.signal,
      });
      subscribePayload = await parseGraphResponse(subscribeResponse);

      checkResponse = await fetch(`${GRAPH_WEBHOOK_BASE_URL}/${wabaId}/subscribed_apps`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
        signal: controller.signal,
      });
      checkPayload = await parseGraphResponse(checkResponse);
    } finally {
      controller.dispose();
    }

    const subscribeMessage = subscribeResponse?.ok
      ? 'OK'
      : extractGraphError(subscribePayload) || 'Falha ao assinar webhook.';
    const checkMessage = checkResponse?.ok
      ? 'OK'
      : extractGraphError(checkPayload) || 'Falha ao consultar assinatura.';

    return res.json({
      subscribe: {
        ok: Boolean(subscribeResponse?.ok),
        status: subscribeResponse?.status ?? 0,
        message: subscribeMessage,
        payload: subscribePayload ?? null,
      },
      check: {
        ok: Boolean(checkResponse?.ok),
        status: checkResponse?.status ?? 0,
        message: checkMessage,
        payload: checkPayload ?? null,
      },
    });
  } catch (error) {
    const message = error.name === 'AbortError'
      ? 'Tempo limite excedido ao verificar webhook.'
      : 'Erro ao verificar webhook do WhatsApp.';
    console.error('Erro ao verificar webhook WhatsApp:', error);
    return res.status(500).json({ message });
  }
});

router.post('/:storeId/register-number', requireAuth, authorizeRoles('admin', 'admin_master'), async (req, res) => {
  try {
    const { storeId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(storeId)) {
      return res.status(400).json({ message: 'Identificador de loja invalido.' });
    }

    const storeExists = await Store.exists({ _id: storeId });
    if (!storeExists) {
      return res.status(404).json({ message: 'Loja nao encontrada.' });
    }

    const payload = req.body || {};
    const numberId = sanitizeString(payload.numberId);
    const phoneNumberIdInput = sanitizeString(payload.phoneNumberId);
    const dataLocalizationRegion = normalizeLocalizationRegion(
      payload.data_localization_region || payload.dataLocalizationRegion
    );

    if ((payload.data_localization_region || payload.dataLocalizationRegion) && !dataLocalizationRegion) {
      return res.status(400).json({ message: 'data_localization_region invalido.' });
    }

    const integration = await findIntegration(storeId);
    if (!integration) {
      return res.status(404).json({ message: 'Integracao do WhatsApp nao configurada.' });
    }

    const accessToken = decryptField(integration.accessTokenEncrypted, integration.accessTokenStored);
    if (!accessToken) {
      return res.status(400).json({ message: 'Token de acesso nao informado.' });
    }

    const numbers = Array.isArray(integration.phoneNumbers) ? integration.phoneNumbers : [];
    let number = null;
    if (numberId && mongoose.Types.ObjectId.isValid(numberId)) {
      number = numbers.find((entry) => entry?._id && String(entry._id) === numberId);
    }

    if (!number && phoneNumberIdInput) {
      number = numbers.find((entry) => String(entry?.phoneNumberId || '') === phoneNumberIdInput);
    }

    const phoneNumberId = sanitizeString(number?.phoneNumberId || phoneNumberIdInput);
    if (!phoneNumberId) {
      return res.status(400).json({ message: 'Phone Number ID nao informado.' });
    }

    const pin = normalizePin(payload.pin || number?.pin);
    if (!pin) {
      return res.status(400).json({ message: 'PIN de 6 digitos nao informado.' });
    }

    const requestBody = {
      messaging_product: 'whatsapp',
      pin,
    };

    if (dataLocalizationRegion) {
      requestBody.data_localization_region = dataLocalizationRegion;
    }

    const { response, payload: graphPayload } = await sendWhatsappText({
      url: `${GRAPH_BASE_URL}/${phoneNumberId}/register`,
      accessToken,
      body: requestBody,
    });

    if (!response.ok) {
      const errorMessage = extractGraphError(graphPayload);
      const details = extractGraphErrorDetails(graphPayload);
      console.error('Erro ao registrar numero WhatsApp (Graph API):', {
        status: response.status,
        payload: graphPayload,
      });
      const detailSuffix = details
        ? ` (code ${details.code ?? '-'}, subcode ${details.subcode ?? '-'}, trace ${details.fbtrace_id ?? '-'})`
        : '';
      return res.status(response.status || 502).json({
        message: `${errorMessage || 'Falha ao registrar numero.'}${detailSuffix}`,
        error: details,
      });
    }

    if (integration._id) {
      await WhatsappIntegration.updateOne(
        { _id: integration._id, 'phoneNumbers.phoneNumberId': phoneNumberId },
        {
          $set: {
            'phoneNumbers.$.lastSyncAt': new Date(),
            'phoneNumbers.$.status': 'Conectado',
            'phoneNumbers.$.pin': pin,
          },
        }
      );
    }

    return res.json({ message: 'Numero registrado com sucesso.', phoneNumberId });
  } catch (error) {
    console.error('Erro ao registrar numero WhatsApp:', error);
    return res.status(500).json({ message: 'Erro ao registrar numero do WhatsApp.' });
  }
});

router.get('/:storeId/message-history/:messageHistoryId/events', requireAuth, authorizeRoles('admin', 'admin_master'), async (req, res) => {
  try {
    const { storeId, messageHistoryId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(storeId)) {
      return res.status(400).json({ message: 'Identificador de loja invalido.' });
    }

    const historyId = sanitizeString(messageHistoryId);
    if (!historyId) {
      return res.status(400).json({ message: 'Message History ID invalido.' });
    }

    const storeExists = await Store.exists({ _id: storeId });
    if (!storeExists) {
      return res.status(404).json({ message: 'Loja nao encontrada.' });
    }

    const integration = await findIntegration(storeId);
    if (!integration) {
      return res.status(404).json({ message: 'Integracao do WhatsApp nao configurada.' });
    }

    const accessToken = decryptField(integration.accessTokenEncrypted, integration.accessTokenStored);
    if (!accessToken) {
      return res.status(400).json({ message: 'Token de acesso nao informado.' });
    }

    const query = buildMessageHistoryQuery(req.query);
    const url = `${GRAPH_BASE_URL}/${encodeURIComponent(historyId)}/events${query ? `?${query}` : ''}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    });
    const graphPayload = await parseGraphResponse(response);

    if (!response.ok) {
      const errorMessage = extractGraphError(graphPayload);
      const details = extractGraphErrorDetails(graphPayload);
      const detailSuffix = details
        ? ` (code ${details.code ?? '-'}, subcode ${details.subcode ?? '-'}, trace ${details.fbtrace_id ?? '-'})`
        : '';
      return res.status(response.status || 502).json({
        message: `${errorMessage || 'Falha ao buscar historico.'}${detailSuffix}`,
        error: details,
      });
    }

    let persisted = null;
    try {
      persisted = await persistMessageHistoryEvents({
        storeId,
        messageHistoryId: historyId,
        payload: graphPayload,
      });
    } catch (persistError) {
      console.error('Erro ao salvar historico de mensagens WhatsApp:', persistError);
      return res.status(500).json({ message: 'Erro ao salvar historico de mensagens.' });
    }

    if (graphPayload && typeof graphPayload === 'object') {
      return res.json({ ...graphPayload, persisted });
    }
    return res.json({ data: graphPayload, persisted });
  } catch (error) {
    console.error('Erro ao buscar historico de mensagens WhatsApp:', error);
    return res.status(500).json({ message: 'Erro ao buscar historico de mensagens.' });
  }
});

router.get('/:storeId/message-history/:messageHistoryId/events/local', requireAuth, authorizeRoles('admin', 'admin_master'), async (req, res) => {
  try {
    const { storeId, messageHistoryId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(storeId)) {
      return res.status(400).json({ message: 'Identificador de loja invalido.' });
    }

    const historyId = sanitizeString(messageHistoryId);
    if (!historyId) {
      return res.status(400).json({ message: 'Message History ID invalido.' });
    }

    const storeExists = await Store.exists({ _id: storeId });
    if (!storeExists) {
      return res.status(404).json({ message: 'Loja nao encontrada.' });
    }

    const limit = resolveMessageHistoryLimit(req.query.limit);
    const statusFilter = sanitizeString(req.query.status_filter || req.query.statusFilter);
    const before = parseTimestamp(req.query.before);
    const after = parseTimestamp(req.query.after);

    const query = { store: storeId, messageHistoryId: historyId };
    if (statusFilter) {
      query.deliveryStatus = statusFilter;
    }
    if (before || after) {
      query.eventTimestamp = {};
      if (before) query.eventTimestamp.$lt = before;
      if (after) query.eventTimestamp.$gt = after;
    }

    const events = await WhatsappMessageHistoryEvent.find(query)
      .sort({ eventTimestamp: -1, _id: -1 })
      .limit(limit)
      .lean();

    return res.json({ data: events.map(mapMessageHistoryEventResponse) });
  } catch (error) {
    console.error('Erro ao buscar historico local de mensagens WhatsApp:', error);
    return res.status(500).json({ message: 'Erro ao buscar historico local de mensagens.' });
  }
});

router.get('/:storeId', requireAuth, authorizeRoles('admin', 'admin_master'), async (req, res) => {
  try {
    const { storeId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(storeId)) {
      return res.status(400).json({ message: 'Identificador de loja invalido.' });
    }

    const storeExists = await Store.exists({ _id: storeId });
    if (!storeExists) {
      return res.status(404).json({ message: 'Loja nao encontrada.' });
    }

    const integration = await findIntegration(storeId);
    const doc = integration || new WhatsappIntegration({ store: storeId });
    return res.json(buildResponse(doc));
  } catch (error) {
    console.error('Erro ao buscar integracao WhatsApp:', error);
    return res.status(500).json({ message: 'Erro ao buscar integracao WhatsApp.' });
  }
});

router.put('/:storeId', requireAuth, authorizeRoles('admin', 'admin_master'), async (req, res) => {
  try {
    const { storeId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(storeId)) {
      return res.status(400).json({ message: 'Identificador de loja invalido.' });
    }

    const storeExists = await Store.exists({ _id: storeId });
    if (!storeExists) {
      return res.status(404).json({ message: 'Loja nao encontrada.' });
    }

    const payload = req.body || {};
    const integration = await findIntegration(storeId) || new WhatsappIntegration({ store: storeId });

    if (Object.prototype.hasOwnProperty.call(payload, 'appId')) {
      integration.appId = sanitizeString(payload.appId);
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'wabaId')) {
      integration.wabaId = sanitizeString(payload.wabaId);
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'appSecret')) {
      const value = sanitizeString(payload.appSecret);
      if (value) {
        integration.appSecretEncrypted = encryptText(value);
        integration.appSecretStored = true;
      } else {
        integration.appSecretEncrypted = null;
        integration.appSecretStored = false;
      }
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'accessToken')) {
      const value = sanitizeString(payload.accessToken);
      if (value) {
        integration.accessTokenEncrypted = encryptText(value);
        integration.accessTokenStored = true;
      } else {
        integration.accessTokenEncrypted = null;
        integration.accessTokenStored = false;
      }
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'verifyToken')) {
      const value = sanitizeString(payload.verifyToken);
      if (value) {
        integration.verifyTokenEncrypted = encryptText(value);
        integration.verifyTokenStored = true;
      } else {
        integration.verifyTokenEncrypted = null;
        integration.verifyTokenStored = false;
      }
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'phoneNumbers')) {
      integration.phoneNumbers = mapPhoneNumbers(payload.phoneNumbers);
    }

    await integration.save();
    const response = buildResponse(integration);
    return res.json(response);
  } catch (error) {
    console.error('Erro ao salvar integracao WhatsApp:', error);
    return res.status(500).json({ message: 'Erro ao salvar integracao WhatsApp.' });
  }
});

module.exports = router;
