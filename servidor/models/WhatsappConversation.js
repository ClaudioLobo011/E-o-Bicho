const mongoose = require('mongoose');

const whatsappConversationSchema = new mongoose.Schema({
  store: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Store',
    required: true,
    index: true,
  },
  phoneNumberId: { type: String, trim: true, required: true, index: true },
  waId: { type: String, trim: true, required: true, index: true },
  contact: { type: mongoose.Schema.Types.ObjectId, ref: 'WhatsappContact', default: null },
  customer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  status: {
    type: String,
    enum: ['WAITING_HUMAN', 'BOT_ACTIVE', 'HUMAN_ACTIVE', 'NEEDS_HUMAN', 'PAUSED', 'CLOSED'],
    default: 'WAITING_HUMAN',
    index: true,
  },
  serviceMode: {
    type: String,
    enum: ['waiting', 'automation', 'human', 'paused', 'closed'],
    default: 'waiting',
  },
  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  lastInboundMessageId: { type: String, trim: true, default: '' },
  lastInboundAt: { type: Date, default: null },
  lastHumanAt: { type: Date, default: null },
  lastHumanSource: {
    type: String,
    enum: ['', 'human_mobile', 'human_web', 'manual_takeover'],
    default: '',
  },
  lastBotAt: { type: Date, default: null },
  lastMessageAt: { type: Date, default: null, index: true },
  lastActorType: {
    type: String,
    enum: ['', 'customer', 'human_mobile', 'human_web', 'bot', 'system'],
    default: '',
  },
  botEligibleAt: { type: Date, default: null, index: true },
  automationPausedUntil: { type: Date, default: null },
  automationPauseReason: { type: String, trim: true, default: '' },
  customerServiceWindowExpiresAt: { type: Date, default: null },
  intent: { type: String, trim: true, default: '' },
  flow: { type: String, trim: true, default: '' },
  flowState: { type: String, trim: true, default: '' },
  flowData: { type: mongoose.Schema.Types.Mixed, default: null },
  unreadCount: { type: Number, min: 0, default: 0 },
  priority: { type: Number, min: 0, default: 0 },
  labels: { type: [String], default: [] },
  version: { type: Number, min: 0, default: 0 },
  closedAt: { type: Date, default: null },
}, {
  timestamps: true,
});

whatsappConversationSchema.index(
  { store: 1, phoneNumberId: 1, waId: 1 },
  { unique: true }
);
whatsappConversationSchema.index({ store: 1, phoneNumberId: 1, status: 1, lastMessageAt: -1 });

module.exports = mongoose.model('WhatsappConversation', whatsappConversationSchema);
