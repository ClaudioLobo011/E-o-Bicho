const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  receiptId: { type: mongoose.Schema.Types.ObjectId, ref: 'ReceivingReceipt', required: true, index: true },
  photoIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'ReceivingPhoto' }],
  status: { type: String, enum: ['processing', 'completed', 'failed'], default: 'processing' },
  extraction: { type: mongoose.Schema.Types.Mixed, default: null },
  message: { type: String, default: '' },
}, { timestamps: true });
module.exports = mongoose.model('ReceivingExtraction', schema);
