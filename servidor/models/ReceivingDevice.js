const mongoose = require('mongoose');

// Receiving credentials deliberately do not grant access to the existing product-write API.
const schema = new mongoose.Schema({
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  installationId: { type: String, required: true },
  name: { type: String, required: true },
  tokenHash: { type: String, required: true, select: false },
  scope: { type: String, enum: ['receiving:write'], default: 'receiving:write' },
  revokedAt: { type: Date, default: null },
}, { timestamps: true });
schema.index({ owner: 1, installationId: 1 }, { unique: true });
schema.index({ tokenHash: 1 }, { unique: true });
module.exports = mongoose.model('ReceivingDevice', schema);
