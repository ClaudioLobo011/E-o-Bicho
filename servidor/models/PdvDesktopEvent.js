const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  pdv: { type: mongoose.Schema.Types.ObjectId, ref: 'Pdv', required: true, index: true },
  empresa: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true, index: true },
  host: { type: mongoose.Schema.Types.ObjectId, ref: 'PdvDesktopHost', required: true, index: true },
  eventId: { type: String, required: true, trim: true },
  type: { type: String, required: true, trim: true, index: true },
  occurredAt: { type: Date, required: true },
  payload: { type: mongoose.Schema.Types.Mixed, default: {} },
  status: { type: String, enum: ['accepted', 'processed', 'failed'], default: 'accepted', index: true },
  error: { type: String, trim: true, default: '' },
}, { timestamps: true });

schema.index({ pdv: 1, eventId: 1 }, { unique: true });
schema.index({ pdv: 1, createdAt: 1 });

module.exports = mongoose.model('PdvDesktopEvent', schema);
