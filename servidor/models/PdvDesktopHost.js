const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  pdv: { type: mongoose.Schema.Types.ObjectId, ref: 'Pdv', required: true, index: true },
  empresa: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true, index: true },
  name: { type: String, trim: true, default: '' },
  machineId: { type: String, trim: true, default: '' },
  status: { type: String, enum: ['pending', 'active', 'revoked'], default: 'pending', index: true },
  pairingCodeHash: { type: String, trim: true, default: '' },
  pairingExpiresAt: { type: Date, default: null },
  tokenHash: { type: String, trim: true, default: '' },
  localDbReady: { type: Boolean, default: false },
  initialSyncCompletedAt: { type: Date, default: null },
  lastHeartbeatAt: { type: Date, default: null, index: true },
  appVersion: { type: String, trim: true, default: '' },
  pendingEvents: { type: Number, min: 0, default: 0 },
  pendingFiscal: { type: Number, min: 0, default: 0 },
}, { timestamps: true });

schema.index({ pdv: 1, status: 1 });
schema.index({ pdv: 1, machineId: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('PdvDesktopHost', schema);
