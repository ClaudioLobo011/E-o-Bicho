const mongoose = require('mongoose');

const specialHoursSchema = new mongoose.Schema({
  date: { type: String, trim: true, required: true },
  closed: { type: Boolean, default: false },
  open: { type: String, trim: true, default: '' },
  close: { type: String, trim: true, default: '' },
  label: { type: String, trim: true, default: '' },
}, { _id: false });

const whatsappAutomationConfigSchema = new mongoose.Schema({
  store: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Store',
    required: true,
    index: true,
  },
  phoneNumberId: { type: String, trim: true, required: true, index: true },
  enabled: { type: Boolean, default: false },
  timezone: { type: String, trim: true, default: 'America/Sao_Paulo' },
  humanGraceMinutes: { type: Number, min: 1, max: 120, default: 5 },
  afterHoursImmediate: { type: Boolean, default: true },
  humanTakeoverTimeoutMinutes: { type: Number, min: 0, max: 10080, default: 0 },
  botName: { type: String, trim: true, default: 'Assistente virtual' },
  welcomeMessage: {
    type: String,
    trim: true,
    default: 'Olá! Sou o assistente virtual. Como posso ajudar?',
  },
  afterHoursMessage: {
    type: String,
    trim: true,
    default: 'Olá! No momento estamos fora do horário de atendimento, mas posso ajudar com algumas informações e solicitações.',
  },
  fallbackMessage: {
    type: String,
    trim: true,
    default: 'Não consegui concluir sua solicitação. Vou encaminhar a conversa para nossa equipe.',
  },
  enabledFlows: {
    type: [String],
    default: ['veterinary_appointment', 'grooming_appointment'],
  },
  appointmentEnabled: { type: Boolean, default: false },
  appointmentMinLeadMinutes: { type: Number, min: 0, max: 10080, default: 60 },
  appointmentSlotIntervalMinutes: {
    type: Number,
    enum: [15, 30, 60],
    default: 30,
  },
  appointmentSearchDays: { type: Number, min: 1, max: 30, default: 14 },
  appointmentMaxOptions: { type: Number, min: 1, max: 5, default: 3 },
  surveyEnabled: { type: Boolean, default: false },
  surveyDelayMinutes: { type: Number, min: 0, max: 10080, default: 30 },
  surveyQuestion: {
    type: String,
    trim: true,
    default: 'Como foi sua experiência com o atendimento? Responda com uma nota de 1 a 5.',
  },
  surveyTemplateName: { type: String, trim: true, default: '' },
  surveyTemplateLanguage: { type: String, trim: true, default: 'pt_BR' },
  surveyTemplateApproved: { type: Boolean, default: false },
  surveyRequireOptIn: { type: Boolean, default: true },
  surveyResponseExpiresHours: { type: Number, min: 1, max: 720, default: 168 },
  surveyLowRatingThreshold: { type: Number, min: 1, max: 5, default: 3 },
  emergencyHandoffEnabled: { type: Boolean, default: true },
  paused: { type: Boolean, default: false },
  pauseReason: { type: String, trim: true, default: '' },
  specialHours: { type: [specialHoursSchema], default: [] },
  pilotAcknowledgedAt: { type: Date, default: null },
  pilotAcknowledgedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  pilotChecklistVersion: { type: String, trim: true, default: '' },
  pilotReadinessFingerprint: { type: String, trim: true, default: '' },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, {
  timestamps: true,
});

whatsappAutomationConfigSchema.index(
  { store: 1, phoneNumberId: 1 },
  { unique: true }
);

module.exports = mongoose.model('WhatsappAutomationConfig', whatsappAutomationConfigSchema);
