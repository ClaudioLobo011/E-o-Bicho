const WhatsappContact = require('../models/WhatsappContact');
const WhatsappLog = require('../models/WhatsappLog');

const clean = (value) => (typeof value === 'string' ? value.trim() : '');
const digitsOnly = (value) => String(value || '').replace(/\D+/g, '');

const extractEditedBody = (message = {}) => {
  const edited = message.edit?.message || message.edited?.message || {};
  const type = clean(edited.type);
  if (type === 'text') return clean(edited.text?.body);
  if (type === 'image') return clean(edited.image?.caption) || '[imagem]';
  if (type === 'video') return clean(edited.video?.caption) || '[vídeo]';
  if (type === 'document') {
    return clean(edited.document?.caption || edited.document?.filename) || '[documento]';
  }
  return clean(edited.text?.body || edited.body || edited.message);
};

const parseWhatsappMessageMutation = ({
  message = {},
  direction = 'incoming',
  customer = '',
  source = 'webhook',
  at = new Date(),
} = {}) => {
  const type = clean(message.type).toLowerCase();
  if (type === 'edit') {
    const targetMessageId = clean(
      message.edit?.original_message_id
      || message.edited?.original_message_id
      || message.context?.id
    );
    const body = extractEditedBody(message);
    if (!targetMessageId || !body) return null;
    return {
      kind: 'edit',
      targetMessageId,
      eventMessageId: clean(message.id || message.message_id),
      body,
      editedMessageType: clean(message.edit?.message?.type || message.edited?.message?.type),
      direction,
      customer: digitsOnly(customer),
      source,
      at,
    };
  }
  if (type === 'reaction') {
    const targetMessageId = clean(message.reaction?.message_id);
    if (!targetMessageId) return null;
    return {
      kind: 'reaction',
      targetMessageId,
      eventMessageId: clean(message.id || message.message_id),
      emoji: clean(message.reaction?.emoji),
      direction,
      customer: digitsOnly(customer),
      source,
      at,
    };
  }
  return null;
};

const buildRoom = (storeId, phoneNumberId) => {
  const store = clean(String(storeId || ''));
  const phone = clean(phoneNumberId);
  if (!/^[a-fA-F0-9]{24}$/.test(store) || !/^\d{6,}$/.test(phone)) return '';
  return `whatsapp:store:${store}:number:${phone}`;
};

const emitMutation = (io, payload) => {
  const room = buildRoom(payload?.storeId, payload?.phoneNumberId);
  if (io && room) io.to(room).emit('whatsapp:message', payload);
};

const applyWhatsappMessageMutation = async ({
  storeId,
  phoneNumberId,
  mutation,
  io,
}) => {
  if (!storeId || !clean(phoneNumberId) || !mutation?.targetMessageId) {
    return { applied: false, reason: 'invalid_mutation' };
  }
  const target = await WhatsappLog.findOne({
    store: storeId,
    phoneNumberId: clean(phoneNumberId),
    messageId: mutation.targetMessageId,
    ...(mutation.kind === 'edit' ? { direction: mutation.direction } : {}),
  });
  if (!target) return { applied: false, reason: 'target_not_found' };

  const now = mutation.at instanceof Date ? mutation.at : new Date(mutation.at || Date.now());
  const customer = digitsOnly(
    mutation.customer
    || (target.direction === 'incoming' ? target.origin : target.destination)
  );
  const meta = target.meta && typeof target.meta === 'object' ? { ...target.meta } : {};
  let realtimePayload;

  if (mutation.kind === 'edit') {
    target.message = mutation.body;
    meta.edited = true;
    meta.editedAt = now;
    meta.editEventMessageId = mutation.eventMessageId || '';
    meta.editedMessageType = mutation.editedMessageType || target.messageType || 'text';
    target.meta = meta;
    await target.save();
    await WhatsappContact.updateOne(
      {
        store: storeId,
        phoneNumberId: clean(phoneNumberId),
        waId: customer,
        lastMessageId: target.messageId,
      },
      { $set: { lastMessage: target.message, updatedAt: now } }
    );
    realtimePayload = {
      mutationType: 'edit',
      message: target.message,
      edited: true,
      editedAt: now.toISOString(),
    };
  } else if (mutation.kind === 'reaction') {
    const actorKey = mutation.direction === 'incoming'
      ? `customer:${customer}`
      : 'business_mobile';
    const reactions = Array.isArray(meta.reactions) ? [...meta.reactions] : [];
    const remaining = reactions.filter((entry) => clean(entry?.actorKey) !== actorKey);
    if (mutation.emoji) {
      remaining.push({
        actorKey,
        emoji: mutation.emoji,
        direction: mutation.direction,
        source: mutation.source || '',
        eventMessageId: mutation.eventMessageId || '',
        at: now,
      });
    }
    meta.reactions = remaining;
    target.meta = meta;
    await target.save();
    realtimePayload = {
      mutationType: 'reaction',
      reactions: remaining,
    };
  } else {
    return { applied: false, reason: 'unsupported_mutation' };
  }

  emitMutation(io, {
    storeId: String(storeId),
    phoneNumberId: clean(phoneNumberId),
    waId: customer,
    direction: target.direction,
    messageId: target.messageId,
    createdAt: target.createdAt?.toISOString?.() || now.toISOString(),
    ...realtimePayload,
  });
  return { applied: true, target, mutation };
};

module.exports = {
  applyWhatsappMessageMutation,
  extractEditedBody,
  parseWhatsappMessageMutation,
};
