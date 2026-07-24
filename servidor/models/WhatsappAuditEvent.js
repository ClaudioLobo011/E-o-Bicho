const mongoose = require('mongoose');

const whatsappAuditEventSchema = new mongoose.Schema({
  store: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Store',
    required: true,
    index: true,
  },
  phoneNumberId: { type: String, trim: true, default: '', index: true },
  waId: { type: String, trim: true, default: '', index: true },
  conversation: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'WhatsappConversation',
    default: null,
    index: true,
  },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  action: { type: String, trim: true, required: true, index: true },
  previousState: { type: mongoose.Schema.Types.Mixed, default: null },
  nextState: { type: mongoose.Schema.Types.Mixed, default: null },
  correlationId: { type: String, trim: true, default: '' },
  ip: { type: String, trim: true, default: '' },
  userAgent: { type: String, trim: true, default: '' },
}, {
  timestamps: true,
});

whatsappAuditEventSchema.index({ store: 1, phoneNumberId: 1, createdAt: -1 });

module.exports = mongoose.model('WhatsappAuditEvent', whatsappAuditEventSchema);
