const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  receiptId: { type: mongoose.Schema.Types.ObjectId, ref: 'ReceivingReceipt', required: true, index: true },
  name: { type: String, required: true },
  contentType: { type: String, required: true },
  sha256: { type: String, required: true },
  size: { type: Number, required: true },
  width: Number,
  height: Number,
  data: { type: Buffer, required: true, select: false },
  uploadedBy: String,
  extraction: { type: mongoose.Schema.Types.Mixed, default: null },
}, { timestamps: true });
schema.index({ receiptId: 1, sha256: 1 }, { unique: true });
module.exports = mongoose.model('ReceivingPhoto', schema);
