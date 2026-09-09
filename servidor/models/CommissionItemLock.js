const mongoose = require('mongoose');

const { Schema } = mongoose;

const commissionItemLockSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, trim: true },
    closing: { type: Schema.Types.ObjectId, ref: 'CommissionClosing', required: true, index: true },
    profissional: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    store: { type: Schema.Types.ObjectId, ref: 'Store', default: null, index: true },
    source: {
      type: String,
      enum: ['appointment_service', 'pdv_product'],
      required: true,
    },
    date: { type: String, required: true, trim: true, index: true },
  },
  { timestamps: true },
);

commissionItemLockSchema.index({ profissional: 1, store: 1, date: 1 });

module.exports = mongoose.model('CommissionItemLock', commissionItemLockSchema);
