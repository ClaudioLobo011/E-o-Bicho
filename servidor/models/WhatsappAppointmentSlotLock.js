const mongoose = require('mongoose');

const whatsappAppointmentSlotLockSchema = new mongoose.Schema({
  store: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Store',
    required: true,
    index: true,
  },
  professional: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  slotKey: { type: String, trim: true, required: true },
  startsAt: { type: Date, required: true, index: true },
  flow: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'WhatsappAppointmentFlow',
    required: true,
    index: true,
  },
  appointment: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Appointment',
    default: null,
    index: true,
  },
  expiresAt: { type: Date, required: true },
}, {
  timestamps: true,
});

whatsappAppointmentSlotLockSchema.index(
  { store: 1, professional: 1, slotKey: 1 },
  { unique: true }
);
whatsappAppointmentSlotLockSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0 }
);

module.exports = mongoose.model(
  'WhatsappAppointmentSlotLock',
  whatsappAppointmentSlotLockSchema
);
