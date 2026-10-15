const mongoose = require('mongoose');

// This mapping is specific to receiving. It never changes a Product's primary barcode or POS catalog.
const schema = new mongoose.Schema({
  barcode: { type: String, required: true, unique: true },
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  receiptId: { type: mongoose.Schema.Types.ObjectId, ref: 'ReceivingReceipt', required: true },
  confirmedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });
schema.index({ productId: 1 });
module.exports = mongoose.model('ReceivingBarcodeLink', schema);
