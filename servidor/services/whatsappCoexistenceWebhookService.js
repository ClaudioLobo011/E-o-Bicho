const crypto = require('crypto');

const WhatsappContact = require('../models/WhatsappContact');
const WhatsappAutomationJob = require('../models/WhatsappAutomationJob');
const WhatsappConversation = require('../models/WhatsappConversation');
const WhatsappIntegration = require('../models/WhatsappIntegration');
const WhatsappLog = require('../models/WhatsappLog');
const WhatsappWebhookEvent = require('../models/WhatsappWebhookEvent');
const { handleHumanReply } = require('./whatsappConversationService');

const COEXISTENCE_FIELDS = new Set([
  'history',
  'smb_app_state_sync',
  'smb_message_echoes',
  'account_update',
]);

const clean = (value) => (typeof value === 'string' ? value.trim() : '');
const digitsOnly = (value) => String(value || '').replace(/\D+/g, '');

const parseTimestamp = (value) => {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    const parsed = new Date(numeric > 1000000000000 ? numeric : numeric * 1000);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const parsed = value ? new Date(value) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
};

const clamp = (value, max = 1000) => {
  const text = clean(value);
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3)}...`;
};

const extractBody = (message = {}) => {
  const type = clean(message.type);
  if (type === 'text') return clamp(message.text?.body);
  if (type === 'image') return clamp(message.image?.caption) || '[imagem]';
  if (type === 'video') return clamp(message.video?.caption) || '[vídeo]';
  if (type === 'audio') return '[áudio]';
  if (type === 'document') {
    return clamp(message.document?.caption || message.document?.filename) || '[documento]';
  }
  if (type === 'sticker') return '[figurinha]';
  if (type === 'location') return '[localização]';
  if (type === 'contacts') return '[contato]';
  if (type === 'reaction') return '[reação]';
  return clamp(message.body || message.message) || `[${type || 'mensagem'}]`;
};

const eventKey = ({ integrationId, field, value }) => crypto
  .createHash('sha256')
  .update(`${integrationId}:${field}:${JSON.stringify(value || {})}`)
  .digest('hex');

const buildRoom = (storeId, phoneNumberId) => {
  const store = clean(String(storeId || ''));
  const phone = clean(phoneNumberId);
  if (!/^[a-fA-F0-9]{24}$/.test(store) || !/^\d{6,}$/.test(phone)) return '';
  return `whatsapp:store:${store}:number:${phone}`;
};

const emitMessage = (io, payload) => {
  const room = buildRoom(payload?.storeId, payload?.phoneNumberId);
  if (io && room) io.to(room).emit('whatsapp:message', payload);
};

const resolvePhoneMeta = (integration, value = {}) => {
  const metadata = value.metadata || {};
  const phoneNumberId = clean(
    metadata.phone_number_id
    || value.phone_number_id
    || value.phoneNumberId
  );
  const configured = (integration.phoneNumbers || []).find(
    (number) => clean(number.phoneNumberId) === phoneNumberId
  );
  return {
    phoneNumberId: phoneNumberId || clean(configured?.phoneNumberId),
    phoneNumber: clean(metadata.display_phone_number) || clean(configured?.phoneNumber),
    displayName: clean(configured?.displayName),
  };
};

const upsertLogOperation = ({
  integration,
  phone,
  message,
  direction,
  customer,
  source,
  now,
}) => {
  const messageId = clean(message.id || message.message_id);
  const messageAt = parseTimestamp(message.timestamp) || now;
  const body = extractBody(message);
  const origin = direction === 'outgoing' ? phone.phoneNumber : customer;
  const destination = direction === 'outgoing' ? customer : phone.phoneNumber;
  const numberLabel = phone.displayName || phone.phoneNumber || `ID ${phone.phoneNumberId}`;
  const set = {
    status: direction === 'outgoing' ? 'Enviado' : 'Recebido',
    phoneNumberId: phone.phoneNumberId,
    phoneNumber: phone.phoneNumber,
    numberLabel,
    origin,
    destination,
    message: body,
    messageTimestamp: messageAt,
    source,
    actorType: source === 'whatsapp_business_app'
      ? 'human_mobile'
      : direction === 'incoming'
        ? 'customer'
        : 'human_mobile',
    messageType: clean(message.type) || 'text',
    meta: {
      coexistence: true,
      messageType: clean(message.type),
    },
    updatedAt: now,
  };

  return {
    operation: {
      updateOne: {
        filter: {
          store: integration.store,
          direction,
          ...(messageId ? { messageId } : {
            phoneNumberId: phone.phoneNumberId,
            destination,
            messageTimestamp: messageAt,
            message: body,
          }),
        },
        update: {
          $set: set,
          $setOnInsert: {
            store: integration.store,
            direction,
            messageId,
            createdAt: now,
          },
        },
        upsert: true,
      },
    },
    contact: customer && phone.phoneNumberId ? {
      store: integration.store,
      phoneNumberId: phone.phoneNumberId,
      waId: customer,
      lastMessage: body,
      lastMessageAt: messageAt,
      lastDirection: direction,
      lastMessageId: messageId,
      lastStatus: set.status,
    } : null,
    realtime: customer && phone.phoneNumberId ? {
      storeId: String(integration.store),
      phoneNumberId: phone.phoneNumberId,
      waId: customer,
      direction,
      status: set.status,
      message: body,
      messageId,
      origin,
      destination,
      createdAt: messageAt.toISOString(),
      source,
      actorType: set.actorType,
      messageType: set.messageType,
    } : null,
  };
};

const collectEchoes = ({ integration, value, now }) => {
  const phone = resolvePhoneMeta(integration, value);
  const echoes = [
    ...(Array.isArray(value.message_echoes) ? value.message_echoes : []),
    ...(Array.isArray(value.message_echo) ? value.message_echo : []),
    ...(Array.isArray(value.messages) ? value.messages : []),
  ];
  return echoes.map((message) => {
    const customer = digitsOnly(
      message.to
      || message.recipient_id
      || message.destination
      || message.wa_id
    );
    return upsertLogOperation({
      integration,
      phone,
      message,
      direction: 'outgoing',
      customer,
      source: 'whatsapp_business_app',
      now,
    });
  });
};

const collectHistory = ({ integration, value, now }) => {
  const phone = resolvePhoneMeta(integration, value);
  const historyEntries = Array.isArray(value.history)
    ? value.history
    : value.history && typeof value.history === 'object'
      ? [value.history]
      : [];
  const messages = [];
  let progress = 0;
  let phase = 0;
  let chunkOrder = 0;

  historyEntries.forEach((history) => {
    const metadata = history.metadata || {};
    progress = Math.max(
      progress,
      Number(metadata.progress ?? metadata.progress_percent ?? history.progress) || 0
    );
    phase = Math.max(phase, Number(metadata.phase ?? history.phase) || 0);
    chunkOrder = Math.max(
      chunkOrder,
      Number(metadata.chunk_order ?? metadata.chunkOrder ?? history.chunk_order) || 0
    );
    const threads = Array.isArray(history.threads) ? history.threads : [];
    threads.forEach((thread) => {
      const customerFromThread = digitsOnly(
        thread.id || thread.wa_id || thread.waId || thread.phone_number
      );
      (Array.isArray(thread.messages) ? thread.messages : []).forEach((message) => {
        const from = digitsOnly(message.from);
        const to = digitsOnly(message.to);
        const direction = message.from_me === true
          || (phone.phoneNumber && from === digitsOnly(phone.phoneNumber))
          ? 'outgoing'
          : 'incoming';
        const customer = customerFromThread
          || (direction === 'outgoing' ? to : from);
        messages.push(upsertLogOperation({
          integration,
          phone,
          message,
          direction,
          customer,
          source: 'coexistence_history',
          now,
        }));
      });
    });
  });

  return {
    phone,
    messages,
    progress: Math.min(100, Math.max(0, progress)),
    phase,
    chunkOrder,
    completed: phase >= 2 && progress >= 100,
  };
};

const collectSyncedContacts = ({ integration, value, now }) => {
  const phone = resolvePhoneMeta(integration, value);
  const sources = [
    value.contacts,
    value.state_sync?.contacts,
    value.smb_app_state_sync?.contacts,
  ].filter(Array.isArray);
  const operations = [];
  sources.flat().forEach((contact) => {
    const waId = digitsOnly(contact.wa_id || contact.waId || contact.phone_number);
    if (!waId || !phone.phoneNumberId) return;
    const name = clean(contact.profile?.name || contact.name || contact.full_name);
    operations.push({
      updateOne: {
        filter: {
          store: integration.store,
          phoneNumberId: phone.phoneNumberId,
          waId,
        },
        update: {
          ...(name ? { $set: { name, updatedAt: now } } : { $set: { updatedAt: now } }),
          $setOnInsert: {
            store: integration.store,
            phoneNumberId: phone.phoneNumberId,
            waId,
            createdAt: now,
          },
        },
        upsert: true,
      },
    });
  });
  return { phone, operations };
};

const processCoexistenceWebhookChanges = async ({
  entries,
  integration,
  wabaId,
  io,
}) => {
  const relevant = [];
  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    (Array.isArray(entry?.changes) ? entry.changes : []).forEach((change) => {
      const field = clean(change?.field);
      if (COEXISTENCE_FIELDS.has(field)) {
        relevant.push({ field, value: change?.value || {} });
      }
    });
  });
  if (!relevant.length) return { received: 0, processed: 0 };

  const now = new Date();
  const rawOperations = relevant.map(({ field, value }) => ({
    updateOne: {
      filter: {
        integration: integration._id,
        eventKey: eventKey({ integrationId: integration._id, field, value }),
      },
      update: {
        $setOnInsert: {
          store: integration.store,
          integration: integration._id,
          eventKey: eventKey({ integrationId: integration._id, field, value }),
          field,
          wabaId,
          phoneNumberId: resolvePhoneMeta(integration, value).phoneNumberId,
          payload: value,
          status: 'received',
          createdAt: now,
        },
      },
      upsert: true,
    },
  }));
  await WhatsappWebhookEvent.bulkWrite(rawOperations, { ordered: false });

  const logOperations = [];
  const contactOperations = [];
  const realtime = [];
  const humanActivities = [];
  const integrationOperations = [];
  let automationDisconnected = false;

  relevant.forEach(({ field, value }) => {
    if (field === 'smb_message_echoes') {
      collectEchoes({ integration, value, now }).forEach((item) => {
        logOperations.push(item.operation);
        if (item.contact) {
          contactOperations.push({
            updateOne: {
              filter: {
                store: item.contact.store,
                phoneNumberId: item.contact.phoneNumberId,
                waId: item.contact.waId,
              },
              update: {
                $set: { ...item.contact, updatedAt: now },
                $setOnInsert: { createdAt: now },
              },
              upsert: true,
            },
          });
        }
        if (item.realtime) realtime.push(item.realtime);
        if (item.contact) {
          humanActivities.push({
            storeId: item.contact.store,
            phoneNumberId: item.contact.phoneNumberId,
            waId: item.contact.waId,
            at: item.contact.lastMessageAt,
          });
        }
      });
    }

    if (field === 'history') {
      const history = collectHistory({ integration, value, now });
      history.messages.forEach((item) => {
        logOperations.push(item.operation);
        if (item.contact) {
          contactOperations.push({
            updateOne: {
              filter: {
                store: item.contact.store,
                phoneNumberId: item.contact.phoneNumberId,
                waId: item.contact.waId,
              },
              update: {
                $set: { ...item.contact, updatedAt: now },
                $setOnInsert: { createdAt: now },
              },
              upsert: true,
            },
          });
        }
      });
      if (history.phone.phoneNumberId) {
        integrationOperations.push({
          updateOne: {
            filter: {
              _id: integration._id,
              'phoneNumbers.phoneNumberId': history.phone.phoneNumberId,
            },
            update: {
              $set: {
                'phoneNumbers.$.historySyncStatus': history.completed ? 'completed' : 'processing',
                'phoneNumbers.$.historySyncProgress': history.progress,
                'phoneNumbers.$.historySyncPhase': history.phase,
                'phoneNumbers.$.historySyncChunkOrder': history.chunkOrder,
                'phoneNumbers.$.syncCompletedAt': history.completed ? now : null,
                'phoneNumbers.$.lastSyncAt': now,
                onboardingStatus: history.completed ? 'connected' : 'syncing',
              },
            },
          },
        });
      }
    }

    if (field === 'smb_app_state_sync') {
      const synced = collectSyncedContacts({ integration, value, now });
      contactOperations.push(...synced.operations);
      if (synced.phone.phoneNumberId) {
        integrationOperations.push({
          updateOne: {
            filter: {
              _id: integration._id,
              'phoneNumbers.phoneNumberId': synced.phone.phoneNumberId,
            },
            update: {
              $set: {
                'phoneNumbers.$.contactsSyncStatus': 'completed',
                'phoneNumbers.$.lastSyncAt': now,
              },
            },
          },
        });
      }
    }

    if (field === 'account_update') {
      const event = clean(value.event || value.account_update?.event).toUpperCase();
      const disconnected = ['PARTNER_REMOVED', 'ACCOUNT_OFFBOARDED'].includes(event);
      const reconnected = event === 'ACCOUNT_RECONNECTED';
      if (disconnected || reconnected) {
        automationDisconnected = automationDisconnected || disconnected;
        integrationOperations.push({
          updateOne: {
            filter: { _id: integration._id },
            update: {
              $set: {
                onboardingStatus: disconnected ? 'disconnected' : 'connected',
                onboardingEvent: event,
                lastError: disconnected
                  ? {
                      code: event,
                      message: 'A conexão de coexistência foi removida no WhatsApp Business.',
                      at: now,
                    }
                  : null,
                ...(disconnected ? { 'phoneNumbers.$[].status': 'Desconectado' } : {}),
              },
            },
          },
        });
      }
    }
  });

  if (logOperations.length) {
    await WhatsappLog.bulkWrite(logOperations, { ordered: false });
  }
  if (contactOperations.length) {
    await WhatsappContact.bulkWrite(contactOperations, { ordered: false });
  }
  if (integrationOperations.length) {
    await WhatsappIntegration.bulkWrite(integrationOperations, { ordered: false });
  }
  if (automationDisconnected) {
    await Promise.all([
      WhatsappAutomationJob.updateMany(
        {
          store: integration.store,
          status: { $in: ['pending', 'processing'] },
        },
        {
          $set: {
            status: 'cancelled',
            cancelledAt: now,
            lastError: 'Coexistência desconectada',
            leaseUntil: null,
            lockedAt: null,
            lockedBy: '',
          },
        }
      ),
      WhatsappConversation.updateMany(
        {
          store: integration.store,
          status: { $nin: ['CLOSED', 'PAUSED'] },
        },
        {
          $set: {
            status: 'PAUSED',
            serviceMode: 'paused',
            automationPauseReason: 'Coexistência desconectada',
            botEligibleAt: null,
          },
          $inc: { version: 1 },
        }
      ),
    ]);
  }
  if (humanActivities.length) {
    await Promise.all(
      humanActivities.map((activity) =>
        handleHumanReply({
          ...activity,
          source: 'human_mobile',
          io,
        }))
    );
  }
  realtime.forEach((item) => emitMessage(io, item));

  const keys = relevant.map(({ field, value }) =>
    eventKey({ integrationId: integration._id, field, value }));
  await WhatsappWebhookEvent.updateMany(
    { integration: integration._id, eventKey: { $in: keys } },
    { $set: { status: 'processed', processedAt: new Date(), error: '' } }
  );
  return { received: relevant.length, processed: relevant.length };
};

module.exports = {
  COEXISTENCE_FIELDS,
  processCoexistenceWebhookChanges,
};
