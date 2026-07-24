const mongoose = require('mongoose');

const whatsappOnboardingSessionSchema = new mongoose.Schema({
  store: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Store',
    required: true,
    index: true,
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  tokenHash: { type: String, required: true, unique: true, index: true },
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed'],
    default: 'pending',
    index: true,
  },
  event: { type: String, trim: true, default: '' },
  wabaId: { type: String, trim: true, default: '' },
  phoneNumberId: { type: String, trim: true, default: '' },
  businessId: { type: String, trim: true, default: '' },
  failureCode: { type: String, trim: true, default: '' },
  expiresAt: { type: Date, required: true },
  completedAt: { type: Date, default: null },
}, {
  timestamps: true,
});

whatsappOnboardingSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
whatsappOnboardingSessionSchema.index({ store: 1, user: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model('WhatsappOnboardingSession', whatsappOnboardingSessionSchema);
