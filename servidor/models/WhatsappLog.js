const mongoose = require('mongoose');

const whatsappLogSchema = new mongoose.Schema({
  store: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true, index: true },
  direction: { type: String, trim: true, enum: ['outgoing', 'incoming'], required: true, index: true },
  status: { type: String, trim: true, default: '' },
  phoneNumberId: { type: String, trim: true, default: '' },
  phoneNumber: { type: String, trim: true, default: '' },
  numberLabel: { type: String, trim: true, default: '' },
  origin: { type: String, trim: true, default: '' },
  destination: { type: String, trim: true, default: '' },
  message: { type: String, trim: true, default: '' },
  messageId: { type: String, trim: true, default: '' },
  messageTimestamp: { type: Date, default: null },
  statusTimestamp: { type: Date, default: null },
  source: { type: String, trim: true, default: 'webhook' },
  actorType: {
    type: String,
    trim: true,
    enum: ['', 'customer', 'human_mobile', 'human_web', 'bot', 'system'],
    default: '',
  },
  actorUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  messageType: { type: String, trim: true, default: 'text' },
  idempotencyKey: { type: String, trim: true, default: '' },
  correlationId: { type: String, trim: true, default: '' },
  conversationWindowExpiresAt: { type: Date, default: null },
  meta: { type: mongoose.Schema.Types.Mixed, default: null },
}, {
  timestamps: true,
});

whatsappLogSchema.index({ store: 1, direction: 1, createdAt: -1 });
whatsappLogSchema.index({ store: 1, phoneNumberId: 1, direction: 1, createdAt: -1 });
whatsappLogSchema.index({ store: 1, phoneNumberId: 1, messageId: 1 });
whatsappLogSchema.index(
  { store: 1, phoneNumberId: 1, idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: { idempotencyKey: { $type: 'string', $gt: '' } },
  }
);

module.exports = mongoose.model('WhatsappLog', whatsappLogSchema);
