const mongoose = require('mongoose');

const sequenceCounterSchema = new mongoose.Schema(
  {
    scope: { type: String, required: true, trim: true },
    reference: { type: String, required: true, trim: true },
    seq: { type: Number, required: true, default: 0, min: 0 },
  },
  { timestamps: true }
);

sequenceCounterSchema.index({ scope: 1, reference: 1 }, { unique: true });

module.exports = mongoose.model('SequenceCounter', sequenceCounterSchema);
