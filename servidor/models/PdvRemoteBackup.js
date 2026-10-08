const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  host: { type: mongoose.Schema.Types.ObjectId, required: true },
  requestedBy: { type: mongoose.Schema.Types.ObjectId, required: true },
  publicKey: { type: String, required: true },
  active: { type: Boolean, default: true },
  status: { type: String, enum: ['pending','generating','ready','failed','expired','downloaded'], default: 'pending' },
  expiresAt: { type: Date, required: true, index: true },
  size: { type: Number, default: 0 }, sha256: { type: String, default: '' },
  downloadedAt: Date,
}, { timestamps: true });
schema.index({ host: 1 }, { unique: true, partialFilterExpression: { active: true } });
module.exports = mongoose.model('PdvRemoteBackup', schema);
