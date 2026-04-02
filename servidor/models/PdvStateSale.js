const mongoose = require('mongoose');

const pdvStateSaleSchema = new mongoose.Schema(
  {
    pdv: { type: mongoose.Schema.Types.ObjectId, ref: 'Pdv', required: true, index: true },
    empresa: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', default: null, index: true },
    sourceState: { type: mongoose.Schema.Types.ObjectId, ref: 'PdvState', required: true, index: true },
    sourceUpdatedAt: { type: Date, default: null, index: true },
    saleId: { type: String, required: true, trim: true },
    saleCode: { type: String, trim: true, default: '', index: true },
    createdAtFromEntity: { type: Date, default: null, index: true },
    payload: { type: mongoose.Schema.Types.Mixed, required: true },
  },
  { timestamps: true }
);

pdvStateSaleSchema.index({ pdv: 1, saleId: 1 }, { unique: true });
pdvStateSaleSchema.index({ pdv: 1, createdAtFromEntity: -1 });
pdvStateSaleSchema.index({ empresa: 1, createdAtFromEntity: -1 });

module.exports = mongoose.model('PdvStateSale', pdvStateSaleSchema);
