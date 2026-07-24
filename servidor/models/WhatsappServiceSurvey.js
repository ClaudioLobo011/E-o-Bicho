const mongoose = require('mongoose');

const whatsappServiceSurveySchema = new mongoose.Schema({
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
  appointment: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Appointment',
    required: true,
    index: true,
  },
  customer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  pet: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Pet',
    default: null,
  },
  idempotencyKey: {
    type: String,
    trim: true,
    required: true,
    unique: true,
  },
  status: {
    type: String,
    enum: [
      'scheduled',
      'sent',
      'responded',
      'escalated',
      'skipped',
      'cancelled',
      'failed',
    ],
    default: 'scheduled',
    index: true,
  },
  source: { type: String, trim: true, default: 'appointment_finalized' },
  serviceCompletedAt: { type: Date, required: true, index: true },
  scheduledAt: { type: Date, required: true, index: true },
  sentAt: { type: Date, default: null },
  sentMode: {
    type: String,
    enum: ['', 'text', 'template'],
    default: '',
  },
  messageId: { type: String, trim: true, default: '', index: true },
  deliveryStatus: { type: String, trim: true, default: '' },
  questionSnapshot: { type: String, trim: true, default: '' },
  templateName: { type: String, trim: true, default: '' },
  templateLanguage: { type: String, trim: true, default: 'pt_BR' },
  lowRatingThreshold: { type: Number, min: 1, max: 5, default: 3 },
  responseExpiresAt: { type: Date, default: null, index: true },
  respondedAt: { type: Date, default: null },
  responseMessageId: { type: String, trim: true, default: '' },
  rating: { type: Number, min: 1, max: 5, default: null },
  feedback: { type: String, trim: true, default: '' },
  skipReason: { type: String, trim: true, default: '' },
  lastError: { type: String, trim: true, default: '' },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
}, {
  timestamps: true,
});

whatsappServiceSurveySchema.index({
  store: 1,
  phoneNumberId: 1,
  waId: 1,
  status: 1,
  sentAt: -1,
});
whatsappServiceSurveySchema.index(
  { store: 1, appointment: 1 },
  { unique: true }
);

module.exports = mongoose.model('WhatsappServiceSurvey', whatsappServiceSurveySchema);
