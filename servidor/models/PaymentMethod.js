const mongoose = require('mongoose');

const creditInstallmentSchema = new mongoose.Schema(
  {
    number: { type: Number, min: 1, required: true },
    discount: { type: Number, min: 0, default: 0 },
    days: { type: Number, min: 0, default: 0 },
  },
  { _id: false }
);

const paymentMethodSchema = new mongoose.Schema(
  {
    company: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true },
    code: { type: String, trim: true },
    name: { type: String, required: true, trim: true },
    type: { type: String, enum: ['avista', 'debito', 'credito', 'crediario'], required: true },
    days: { type: Number, min: 0, default: 0 },
    discount: { type: Number, min: 0, default: 0 },
    installments: { type: Number, min: 1, default: 1 },
    installmentConfigurations: {
      type: [creditInstallmentSchema],
      default: undefined,
    },
    accountingAccount: { type: mongoose.Schema.Types.ObjectId, ref: 'AccountingAccount' },
    bankAccount: { type: mongoose.Schema.Types.ObjectId, ref: 'BankAccount' },
  },
  {
    timestamps: true,
  }
);

paymentMethodSchema.index({ company: 1, code: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('PaymentMethod', paymentMethodSchema);
