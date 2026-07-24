const mongoose = require('mongoose');

const whatsappNumberSchema = new mongoose.Schema({
  phoneNumberId: { type: String, trim: true, required: true },
  phoneNumber: { type: String, trim: true, default: '' },
  displayName: { type: String, trim: true, default: '' },
  status: { type: String, trim: true, default: 'Pendente' },
  provider: { type: String, trim: true, default: 'Meta Cloud API' },
  connectionMode: {
    type: String,
    trim: true,
    enum: ['', 'coexistence', 'cloud_api'],
    default: '',
  },
  isOnBizApp: { type: Boolean, default: false },
  platformType: { type: String, trim: true, default: '' },
  qualityRating: { type: String, trim: true, default: '' },
  contactsSyncRequestId: { type: String, trim: true, default: '' },
  contactsSyncStatus: { type: String, trim: true, default: '' },
  historySyncRequestId: { type: String, trim: true, default: '' },
  historySyncStatus: { type: String, trim: true, default: '' },
  historySyncProgress: { type: Number, min: 0, max: 100, default: 0 },
  historySyncPhase: { type: Number, min: 0, default: 0 },
  historySyncChunkOrder: { type: Number, min: 0, default: 0 },
  syncStartedAt: { type: Date, default: null },
  syncCompletedAt: { type: Date, default: null },
  lastSyncAt: { type: Date, default: null },
}, { _id: true });

const whatsappIntegrationSchema = new mongoose.Schema({
  store: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true, unique: true },

  appId: { type: String, trim: true, default: '' },
  embeddedSignupConfigId: { type: String, trim: true, default: '' },
  wabaId: { type: String, trim: true, default: '' },
  businessId: { type: String, trim: true, default: '' },
  graphApiVersion: { type: String, trim: true, default: 'v25.0' },
  connectionMode: {
    type: String,
    trim: true,
    enum: ['', 'coexistence', 'cloud_api'],
    default: '',
  },
  onboardingStatus: {
    type: String,
    trim: true,
    enum: [
      'not_configured',
      'ready',
      'in_progress',
      'syncing',
      'connected',
      'error',
      'disconnected',
    ],
    default: 'not_configured',
  },
  onboardingEvent: { type: String, trim: true, default: '' },
  onboardedAt: { type: Date, default: null },
  webhookSubscribedAt: { type: Date, default: null },
  syncDeadlineAt: { type: Date, default: null },
  lastHealthCheckAt: { type: Date, default: null },
  lastError: { type: mongoose.Schema.Types.Mixed, default: null },

  appSecretEncrypted: { type: String, select: false },
  appSecretStored: { type: Boolean, default: false },
  accessTokenEncrypted: { type: String, select: false },
  accessTokenStored: { type: Boolean, default: false },
  verifyTokenEncrypted: { type: String, select: false },
  verifyTokenStored: { type: Boolean, default: false },

  phoneNumbers: { type: [whatsappNumberSchema], default: [] },
}, {
  timestamps: true,
});

whatsappIntegrationSchema.index({ wabaId: 1 });
whatsappIntegrationSchema.index({ 'phoneNumbers.phoneNumberId': 1 });

module.exports = mongoose.model('WhatsappIntegration', whatsappIntegrationSchema);
