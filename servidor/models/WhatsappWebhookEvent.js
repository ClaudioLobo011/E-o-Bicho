const mongoose = require('mongoose');

const whatsappWebhookEventSchema = new mongoose.Schema({
  store: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Store',
    required: true,
    index: true,
  },
  integration: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'WhatsappIntegration',
    required: true,
    index: true,
  },
  eventKey: { type: String, required: true },
  field: { type: String, trim: true, required: true, index: true },
  wabaId: { type: String, trim: true, default: '' },
  phoneNumberId: { type: String, trim: true, default: '' },
  payload: { type: mongoose.Schema.Types.Mixed, default: null },
  status: {
    type: String,
    enum: ['received', 'processed', 'failed'],
    default: 'received',
    index: true,
  },
  error: { type: String, trim: true, default: '' },
  processedAt: { type: Date, default: null },
}, {
  timestamps: true,
});

whatsappWebhookEventSchema.index({ integration: 1, eventKey: 1 }, { unique: true });
whatsappWebhookEventSchema.index({ store: 1, field: 1, createdAt: -1 });

module.exports = mongoose.model('WhatsappWebhookEvent', whatsappWebhookEventSchema);
