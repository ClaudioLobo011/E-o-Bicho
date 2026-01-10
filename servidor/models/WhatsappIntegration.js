const mongoose = require('mongoose');

const whatsappNumberSchema = new mongoose.Schema({
  phoneNumberId: { type: String, trim: true, required: true },
  phoneNumber: { type: String, trim: true, default: '' },
  displayName: { type: String, trim: true, default: '' },
  pin: { type: String, trim: true, default: '' },
  status: { type: String, trim: true, default: 'Pendente' },
  provider: { type: String, trim: true, default: 'Meta Cloud API' },
  lastSyncAt: { type: Date, default: null },
}, { _id: true });

const whatsappIntegrationSchema = new mongoose.Schema({
  store: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true, unique: true },

  appId: { type: String, trim: true, default: '' },
  wabaId: { type: String, trim: true, default: '' },

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

module.exports = mongoose.model('WhatsappIntegration', whatsappIntegrationSchema);
