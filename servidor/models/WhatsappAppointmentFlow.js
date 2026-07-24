const mongoose = require('mongoose');

const appointmentOptionSchema = new mongoose.Schema({
  key: { type: String, trim: true, required: true },
  startAt: { type: Date, required: true },
  endAt: { type: Date, required: true },
  date: { type: String, trim: true, required: true },
  time: { type: String, trim: true, required: true },
  professional: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  professionalName: { type: String, trim: true, default: '' },
}, { _id: false });

const whatsappAppointmentFlowSchema = new mongoose.Schema({
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
  sessionId: { type: String, trim: true, required: true, unique: true },
  status: {
    type: String,
    enum: [
      'collecting',
      'awaiting_confirmation',
      'booking',
      'completed',
      'cancelled',
      'handoff',
      'expired',
      'failed',
    ],
    default: 'collecting',
    index: true,
  },
  intent: {
    type: String,
    enum: [
      'appointment_unspecified',
      'veterinary_appointment',
      'grooming_appointment',
    ],
    required: true,
  },
  step: { type: String, trim: true, required: true },
  customer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  pet: { type: mongoose.Schema.Types.ObjectId, ref: 'Pet', default: null },
  service: { type: mongoose.Schema.Types.ObjectId, ref: 'Service', default: null },
  appointment: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Appointment',
    default: null,
    index: true,
  },
  data: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  options: { type: [appointmentOptionSchema], default: [] },
  selectedOption: { type: appointmentOptionSchema, default: null },
  lastInboundMessageId: { type: String, trim: true, default: '' },
  lastInboundAt: { type: Date, default: null },
  lastPrompt: { type: String, trim: true, default: '' },
  completedAt: { type: Date, default: null },
  cancelledAt: { type: Date, default: null },
  handoffReason: { type: String, trim: true, default: '' },
  lastError: { type: String, trim: true, default: '' },
  expiresAt: { type: Date, required: true, index: true },
}, {
  timestamps: true,
});

whatsappAppointmentFlowSchema.index(
  { store: 1, phoneNumberId: 1, waId: 1, status: 1, updatedAt: -1 }
);
whatsappAppointmentFlowSchema.index(
  { conversation: 1, status: 1, updatedAt: -1 }
);

module.exports = mongoose.model('WhatsappAppointmentFlow', whatsappAppointmentFlowSchema);
