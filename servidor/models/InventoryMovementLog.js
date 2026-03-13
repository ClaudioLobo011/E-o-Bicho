const mongoose = require('mongoose');

const inventoryMovementLogSchema = new mongoose.Schema(
  {
    movementDate: { type: Date, default: Date.now, index: true },
    company: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', default: null, index: true },
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    productCode: { type: String, trim: true, default: '' },
    productName: { type: String, trim: true, default: '' },
    deposit: { type: mongoose.Schema.Types.ObjectId, ref: 'Deposit', default: null, index: true },
    fromDeposit: { type: mongoose.Schema.Types.ObjectId, ref: 'Deposit', default: null },
    toDeposit: { type: mongoose.Schema.Types.ObjectId, ref: 'Deposit', default: null },
    operation: {
      type: String,
      enum: ['entrada', 'saida', 'ajuste'],
      default: 'ajuste',
      lowercase: true,
      trim: true,
      index: true,
    },
    previousStock: { type: Number, default: 0 },
    quantityDelta: { type: Number, default: 0 },
    currentStock: { type: Number, default: 0 },
    unitCost: { type: Number, default: null },
    totalValueDelta: { type: Number, default: null },
    valueDirection: {
      type: String,
      enum: ['adicionado', 'retirado', 'neutro'],
      default: 'neutro',
    },
    sourceModule: { type: String, trim: true, default: '', index: true },
    sourceScreen: { type: String, trim: true, default: '', index: true },
    sourceAction: { type: String, trim: true, default: '' },
    sourceType: { type: String, trim: true, default: '', index: true },
    referenceDocument: { type: String, trim: true, default: '' },
    notes: { type: String, trim: true, default: '' },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    userName: { type: String, trim: true, default: '' },
    userEmail: { type: String, trim: true, default: '' },
    metadata: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true },
);

inventoryMovementLogSchema.index({ createdAt: -1 });
inventoryMovementLogSchema.index({ movementDate: -1, product: 1 });
inventoryMovementLogSchema.index({ movementDate: -1, sourceScreen: 1 });

module.exports = mongoose.model('InventoryMovementLog', inventoryMovementLogSchema);
