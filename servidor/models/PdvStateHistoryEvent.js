const mongoose = require('mongoose');

const pdvStateHistoryEventSchema = new mongoose.Schema(
  {
    pdv: { type: mongoose.Schema.Types.ObjectId, ref: 'Pdv', required: true, index: true },
    empresa: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', default: null, index: true },
    sourceState: { type: mongoose.Schema.Types.ObjectId, ref: 'PdvState', required: true, index: true },
    sourceUpdatedAt: { type: Date, default: null, index: true },
    eventId: { type: String, required: true, trim: true },
    eventType: { type: String, trim: true, default: '', index: true },
    createdAtFromEntity: { type: Date, default: null, index: true },
    payload: { type: mongoose.Schema.Types.Mixed, required: true },
  },
  { timestamps: true }
);

pdvStateHistoryEventSchema.index({ pdv: 1, eventId: 1 }, { unique: true });

module.exports = mongoose.model('PdvStateHistoryEvent', pdvStateHistoryEventSchema);

