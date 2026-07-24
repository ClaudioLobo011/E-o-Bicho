const mongoose = require('mongoose');

const pilotScenarioSchema = new mongoose.Schema({
  key: { type: String, trim: true, required: true },
  category: {
    type: String,
    trim: true,
    enum: ['connection', 'operation', 'appointments', 'survey', 'safety'],
    required: true,
  },
  label: { type: String, trim: true, required: true },
  description: { type: String, trim: true, required: true },
  status: {
    type: String,
    enum: ['pending', 'passed', 'failed'],
    default: 'pending',
  },
  evidenceNote: { type: String, trim: true, default: '' },
  referenceType: {
    type: String,
    trim: true,
    enum: ['', 'message', 'appointment', 'survey', 'manual'],
    default: '',
  },
  referenceId: { type: String, trim: true, default: '' },
  verifiedAt: { type: Date, default: null },
  verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { _id: false });

const whatsappPilotRunSchema = new mongoose.Schema({
  store: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Store',
    required: true,
    index: true,
  },
  phoneNumberId: { type: String, trim: true, required: true, index: true },
  attempt: { type: Number, min: 1, required: true },
  status: {
    type: String,
    enum: ['in_progress', 'passed', 'cancelled'],
    default: 'in_progress',
    index: true,
  },
  checklistVersion: { type: String, trim: true, required: true },
  checklistFingerprintAtStart: { type: String, trim: true, required: true },
  checklistFingerprintAtCompletion: { type: String, trim: true, default: '' },
  configurationFingerprint: { type: String, trim: true, required: true },
  configurationSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
  scenarios: { type: [pilotScenarioSchema], default: [] },
  startedAt: { type: Date, default: Date.now },
  startedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  completedAt: { type: Date, default: null },
  completedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  completionNotes: { type: String, trim: true, default: '' },
  cancelledAt: { type: Date, default: null },
  cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  cancelReason: { type: String, trim: true, default: '' },
}, {
  timestamps: true,
});

whatsappPilotRunSchema.index(
  { store: 1, phoneNumberId: 1, attempt: 1 },
  { unique: true }
);
whatsappPilotRunSchema.index(
  { store: 1, phoneNumberId: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'in_progress' },
  }
);
whatsappPilotRunSchema.index({ status: 1, completedAt: -1 });

module.exports = mongoose.model('WhatsappPilotRun', whatsappPilotRunSchema);
