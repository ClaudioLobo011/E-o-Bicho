const mongoose = require('mongoose');

const whatsappContactPreferenceSchema = new mongoose.Schema({
  store: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Store',
    required: true,
    index: true,
  },
  waId: { type: String, trim: true, required: true, index: true },
  customer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
    index: true,
  },
  status: {
    type: String,
    enum: ['unknown', 'opted_in', 'opted_out'],
    default: 'unknown',
    index: true,
  },
  source: { type: String, trim: true, default: '' },
  proof: { type: String, trim: true, default: '' },
  optedInAt: { type: Date, default: null },
  optedOutAt: { type: Date, default: null },
  lastInboundAt: { type: Date, default: null },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
}, {
  timestamps: true,
});

whatsappContactPreferenceSchema.index(
  { store: 1, waId: 1 },
  { unique: true }
);

module.exports = mongoose.model(
  'WhatsappContactPreference',
  whatsappContactPreferenceSchema
);
