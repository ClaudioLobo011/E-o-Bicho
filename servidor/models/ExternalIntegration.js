const mongoose = require('mongoose');

const providerSchema = new mongoose.Schema({
  enabled: { type: Boolean, default: false },
  autoAccept: { type: Boolean, default: false },
  syncMenu: { type: Boolean, default: false },
  status: { type: String, default: 'offline', trim: true },
  queue: { type: String, default: '', trim: true },
  lastSync: { type: Date, default: null },
  metrics: {
    ordersToday: { type: Number, default: 0 },
    avgPrepTime: { type: Number, default: 0 },
    rejectionRate: { type: Number, default: 0 },
  },
  encryptedCredentials: { type: String, select: false },
  hasCredentials: { type: Boolean, default: false },
}, { _id: false });

const externalIntegrationSchema = new mongoose.Schema({
  store: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true, unique: true },

  webhookSecretEncrypted: { type: String, select: false },
  webhookSecretStored: { type: Boolean, default: false },

  autoApprove: { type: Boolean, default: true },
  menuSync: { type: Boolean, default: true },
  downtimeGuard: { type: Boolean, default: true },

  providers: {
    ifood: { type: providerSchema, default: () => ({}) },
    ubereats: { type: providerSchema, default: () => ({}) },
    ninetyNineFood: { type: providerSchema, default: () => ({}) },
  },
}, {
  timestamps: true,
});

module.exports = mongoose.model('ExternalIntegration', externalIntegrationSchema);
