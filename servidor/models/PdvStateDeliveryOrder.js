const mongoose = require('mongoose');

const pdvStateDeliveryOrderSchema = new mongoose.Schema(
  {
    pdv: { type: mongoose.Schema.Types.ObjectId, ref: 'Pdv', required: true, index: true },
    empresa: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', default: null, index: true },
    sourceState: { type: mongoose.Schema.Types.ObjectId, ref: 'PdvState', required: true, index: true },
    sourceUpdatedAt: { type: Date, default: null, index: true },
    deliveryId: { type: String, required: true, trim: true },
    saleId: { type: String, trim: true, default: '', index: true },
    createdAtFromEntity: { type: Date, default: null, index: true },
    payloadHash: { type: String, trim: true, default: '', index: true },
    payload: { type: mongoose.Schema.Types.Mixed, required: true },
  },
  { timestamps: true }
);

pdvStateDeliveryOrderSchema.index({ pdv: 1, deliveryId: 1 }, { unique: true });
pdvStateDeliveryOrderSchema.index({ pdv: 1, updatedAt: 1, _id: 1 });

module.exports = mongoose.model('PdvStateDeliveryOrder', pdvStateDeliveryOrderSchema);
