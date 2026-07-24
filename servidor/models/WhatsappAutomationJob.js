const mongoose = require('mongoose');

const whatsappAutomationJobSchema = new mongoose.Schema({
  store: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Store',
    required: true,
    index: true,
  },
  phoneNumberId: { type: String, trim: true, required: true, index: true },
  waId: { type: String, trim: true, required: true, index: true },
  conversation: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'WhatsappConversation',
    required: true,
    index: true,
  },
  type: {
    type: String,
    enum: [
      'human_grace_timeout',
      'send_template',
      'appointment_confirmation',
      'appointment_reminder',
      'appointment_flow_reply',
      'post_service_survey',
      'retry_media',
      'coexistence_sync',
    ],
    required: true,
    index: true,
  },
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'cancelled', 'failed'],
    default: 'pending',
    index: true,
  },
  runAt: { type: Date, required: true, index: true },
  payload: { type: mongoose.Schema.Types.Mixed, default: null },
  idempotencyKey: { type: String, trim: true, required: true, unique: true },
  attempts: { type: Number, min: 0, default: 0 },
  maxAttempts: { type: Number, min: 1, max: 20, default: 5 },
  lockedAt: { type: Date, default: null },
  lockedBy: { type: String, trim: true, default: '' },
  leaseUntil: { type: Date, default: null, index: true },
  lastError: { type: String, trim: true, default: '' },
  completedAt: { type: Date, default: null },
  cancelledAt: { type: Date, default: null },
}, {
  timestamps: true,
});

whatsappAutomationJobSchema.index({ status: 1, runAt: 1, leaseUntil: 1 });
whatsappAutomationJobSchema.index({ conversation: 1, status: 1, runAt: 1 });

module.exports = mongoose.model('WhatsappAutomationJob', whatsappAutomationJobSchema);
