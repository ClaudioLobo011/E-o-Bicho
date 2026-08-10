const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  pdv: { type: mongoose.Schema.Types.ObjectId, ref: 'Pdv', required: true, index: true },
  host: { type: mongoose.Schema.Types.ObjectId, ref: 'PdvDesktopHost', required: true, index: true },
  kind: { type: String, enum: ['sale', 'budget', 'nfce'], required: true },
  start: { type: Number, required: true, min: 1 },
  end: { type: Number, required: true, min: 1 },
  next: { type: Number, required: true, min: 1 },
  status: { type: String, enum: ['active', 'exhausted', 'revoked'], default: 'active' },
}, { timestamps: true });

schema.index({ pdv: 1, kind: 1, start: 1 }, { unique: true });

module.exports = mongoose.model('PdvCodeRange', schema);
