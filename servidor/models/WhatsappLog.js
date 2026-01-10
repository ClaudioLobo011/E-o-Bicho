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
  meta: { type: mongoose.Schema.Types.Mixed, default: null },
}, {
  timestamps: true,
});

whatsappLogSchema.index({ store: 1, direction: 1, createdAt: -1 });

module.exports = mongoose.model('WhatsappLog', whatsappLogSchema);
