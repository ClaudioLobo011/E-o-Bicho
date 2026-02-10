const mongoose = require('mongoose');

const ExchangeItemSchema = new mongoose.Schema(
  {
    code: { type: String, trim: true, default: '' },
    description: { type: String, trim: true, default: '' },
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null },
    quantity: { type: Number, default: 0 },
    unitValue: { type: Number, default: 0 },
    totalValue: { type: Number, default: 0 },
    discountValue: { type: Number, default: 0 },
    depositId: { type: mongoose.Schema.Types.ObjectId, ref: 'Deposit', default: null },
    depositLabel: { type: String, trim: true, default: '' },
    sellerId: { type: String, trim: true, default: '' },
    sellerCode: { type: String, trim: true, default: '' },
    sellerName: { type: String, trim: true, default: '' },
    sourceSaleId: { type: String, trim: true, default: '' },
    sourceSaleCode: { type: String, trim: true, default: '' },
  },
  { _id: false }
);

const ExchangeSchema = new mongoose.Schema(
  {
    number: { type: Number, required: true, unique: true, index: true },
    code: { type: String, required: true, trim: true },
    date: { type: Date, required: true },
    type: { type: String, trim: true, default: 'troca' },
    company: { type: mongoose.Schema.Types.ObjectId, ref: 'Store' },
    pdv: { type: mongoose.Schema.Types.ObjectId, ref: 'Pdv' },
    seller: {
      code: { type: String, trim: true, default: '' },
      name: { type: String, trim: true, default: '' },
      id: { type: String, trim: true, default: '' },
    },
    customer: {
      code: { type: String, trim: true, default: '' },
      name: { type: String, trim: true, default: '' },
      document: { type: String, trim: true, default: '' },
      id: { type: String, trim: true, default: '' },
    },
    notes: { type: String, trim: true, default: '' },
    returnedItems: { type: [ExchangeItemSchema], default: [] },
    takenItems: { type: [ExchangeItemSchema], default: [] },
    totals: {
      returned: { type: Number, default: 0 },
      taken: { type: Number, default: 0 },
    },
    differenceValue: { type: Number, default: 0 },
    sourceSales: {
      type: [
        {
          saleId: { type: String, trim: true, default: '' },
          saleCode: { type: String, trim: true, default: '' },
          saleCodeLabel: { type: String, trim: true, default: '' },
        },
      ],
      default: [],
    },
    inventoryProcessed: { type: Boolean, default: false },
    inventoryProcessedAt: { type: Date, default: null },
    finalizedAt: { type: Date, default: null },
    finalizedBy: {
      id: { type: String, trim: true, default: '' },
      email: { type: String, trim: true, default: '' },
      role: { type: String, trim: true, default: '' },
    },
    createdBy: {
      id: { type: String, trim: true, default: '' },
      email: { type: String, trim: true, default: '' },
      role: { type: String, trim: true, default: '' },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Exchange', ExchangeSchema);
