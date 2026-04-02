const mongoose = require('mongoose');

const pdvStateInventoryMovementSchema = new mongoose.Schema(
  {
    pdv: { type: mongoose.Schema.Types.ObjectId, ref: 'Pdv', required: true, index: true },
    empresa: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', default: null, index: true },
    sourceState: { type: mongoose.Schema.Types.ObjectId, ref: 'PdvState', required: true, index: true },
    sourceUpdatedAt: { type: Date, default: null, index: true },
    movementId: { type: String, required: true, trim: true },
    saleId: { type: String, trim: true, default: '', index: true },
    deposit: { type: mongoose.Schema.Types.ObjectId, ref: 'Deposit', default: null, index: true },
    createdAtFromEntity: { type: Date, default: null, index: true },
    payload: { type: mongoose.Schema.Types.Mixed, required: true },
  },
  { timestamps: true }
);

pdvStateInventoryMovementSchema.index({ pdv: 1, movementId: 1 }, { unique: true });

module.exports = mongoose.model('PdvStateInventoryMovement', pdvStateInventoryMovementSchema);

