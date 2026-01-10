const mongoose = require('mongoose');

const mercadoPagoWebhookLogSchema = new mongoose.Schema({
  store: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', default: null },
  topic: { type: String, trim: true, default: '' },
  type: { type: String, trim: true, default: '' },
  action: { type: String, trim: true, default: '' },
  eventId: { type: String, trim: true, default: '' },
  dataId: { type: String, trim: true, default: '' },
  liveMode: { type: Boolean, default: false },
  headers: { type: Object, default: {} },
  payload: { type: Object, default: {} },
}, {
  timestamps: true,
});

module.exports = mongoose.model('MercadoPagoWebhookLog', mercadoPagoWebhookLogSchema);
