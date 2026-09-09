const mongoose = require('mongoose');

const { Schema } = mongoose;

const CommissionPaymentReceiptSchema = new Schema(
  {
    closing: {
      type: Schema.Types.ObjectId,
      ref: 'CommissionClosing',
      required: true,
      index: true,
    },
    store: { type: Schema.Types.ObjectId, ref: 'Store', required: true, index: true },
    originalName: { type: String, trim: true, maxlength: 240, required: true },
    mimeType: {
      type: String,
      enum: ['application/pdf', 'image/jpeg', 'image/png'],
      required: true,
    },
    size: { type: Number, min: 1, max: 5 * 1024 * 1024, required: true },
    sha256: { type: String, trim: true, lowercase: true, required: true },
    data: { type: Buffer, required: true, select: false },
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

CommissionPaymentReceiptSchema.index({ closing: 1, createdAt: -1 });
CommissionPaymentReceiptSchema.index({ store: 1, createdAt: -1 });

module.exports = mongoose.model('CommissionPaymentReceipt', CommissionPaymentReceiptSchema);
