const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  pdv: { type: mongoose.Schema.Types.ObjectId, ref: 'Pdv', required: true, index: true },
  empresa: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true, index: true },
  reason: { type: String, enum: ['convert', 'revert'], required: true },
  snapshot: { type: mongoose.Schema.Types.Mixed, required: true },
  stateSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
  createdBy: { type: String, trim: true, default: '' },
  checksum: { type: String, trim: true, required: true },
}, { timestamps: true });

schema.index({ pdv: 1, createdAt: -1 });

module.exports = mongoose.model('PdvConversionBackup', schema);
