const mongoose = require('mongoose');

const { Schema } = mongoose;

const PAYABLE_STATUSES = ['pending', 'paid', 'cancelled', 'protest'];

const installmentSchema = new Schema(
  {
    number: { type: Number, min: 1, required: true },
    issueDate: { type: Date, required: true },
    dueDate: { type: Date, required: true },
    value: { type: Number, min: 0, required: true },
    bankAccount: { type: Schema.Types.ObjectId, ref: 'BankAccount', required: true },
    accountingAccount: { type: Schema.Types.ObjectId, ref: 'AccountingAccount', required: true },
    status: { type: String, enum: PAYABLE_STATUSES, default: 'pending' },
  },
  { _id: false }
);

const accountPayableSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, trim: true },
    company: { type: Schema.Types.ObjectId, ref: 'Store', required: true },
    partyType: { type: String, enum: ['User', 'Supplier'], required: true },
    party: { type: Schema.Types.ObjectId, refPath: 'partyType', required: true },
    installmentsCount: { type: Number, min: 1, default: 1 },
    issueDate: { type: Date, required: true },
    dueDate: { type: Date, required: true },
    totalValue: { type: Number, min: 0, required: true },
    bankAccount: { type: Schema.Types.ObjectId, ref: 'BankAccount', required: true },
    accountingAccount: { type: Schema.Types.ObjectId, ref: 'AccountingAccount', required: true },
    paymentMethod: { type: Schema.Types.ObjectId, ref: 'PaymentMethod' },
    carrier: { type: String, trim: true, default: '' },
    bankDocumentNumber: { type: String, trim: true, default: '' },
    interestFeeValue: { type: Number, min: 0, default: 0 },
    monthlyInterestPercent: { type: Number, min: 0, default: 0 },
    interestPercent: { type: Number, min: 0, default: 0 },
    notes: { type: String, trim: true, default: '' },
    installments: { type: [installmentSchema], default: [] },
  },
  {
    timestamps: true,
  }
);

accountPayableSchema.index({ company: 1, createdAt: -1 });
accountPayableSchema.index({ party: 1, dueDate: 1 });

module.exports = mongoose.model('AccountPayable', accountPayableSchema);
