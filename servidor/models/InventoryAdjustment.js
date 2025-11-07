const mongoose = require('mongoose');

const inventoryAdjustmentItemSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
    },
    sku: { type: String, trim: true, default: '' },
    barcode: { type: String, trim: true, default: '' },
    name: { type: String, trim: true, default: '' },
    quantity: { type: Number, required: true, min: 0 },
    unitValue: { type: Number, default: null },
    notes: { type: String, trim: true, default: '' },
  },
  { _id: false },
);

const inventoryAdjustmentSchema = new mongoose.Schema(
  {
    operation: {
      type: String,
      enum: ['entrada', 'saida'],
      required: true,
      lowercase: true,
      trim: true,
    },
    reason: { type: String, trim: true, required: true },
    company: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Store',
      required: true,
    },
    deposit: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Deposit',
      required: true,
    },
    movementDate: { type: Date, required: true },
    referenceDocument: { type: String, trim: true, default: '' },
    notes: { type: String, trim: true, default: '' },
    responsible: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    items: {
      type: [inventoryAdjustmentItemSchema],
      validate: {
        validator(value) {
          return Array.isArray(value) && value.length > 0;
        },
        message: 'Inclua ao menos um item na movimentação de estoque.',
      },
    },
    totalQuantity: { type: Number, default: 0 },
    totalValue: { type: Number, default: 0 },
  },
  { timestamps: true },
);

module.exports = mongoose.model('InventoryAdjustment', inventoryAdjustmentSchema);

