const mongoose = require('mongoose');

const { Schema } = mongoose;

const RECEIVABLE_STATUSES = ['pending', 'received', 'cancelled'];

const installmentSchema = new Schema(
  {
    number: { type: Number, min: 1, required: true },
    issueDate: { type: Date, required: true },
    dueDate: { type: Date, required: true },
    value: { type: Number, min: 0, required: true },
    bankAccount: { type: Schema.Types.ObjectId, ref: 'BankAccount', required: true },
    accountingAccount: { type: Schema.Types.ObjectId, ref: 'AccountingAccount', required: true },
    status: { type: String, enum: RECEIVABLE_STATUSES, default: 'pending' },
  },
  { _id: false }
);

const accountReceivableSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, trim: true },
    company: { type: Schema.Types.ObjectId, ref: 'Store', required: true },
    customer: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    installmentsCount: { type: Number, min: 1, default: 1 },
    issueDate: { type: Date, required: true },
    dueDate: { type: Date, required: true },
    totalValue: { type: Number, min: 0, required: true },
    bankAccount: { type: Schema.Types.ObjectId, ref: 'BankAccount', required: true },
    accountingAccount: { type: Schema.Types.ObjectId, ref: 'AccountingAccount', required: true },
    paymentMethod: { type: Schema.Types.ObjectId, ref: 'PaymentMethod' },
    responsible: { type: Schema.Types.ObjectId, ref: 'User' },
    document: { type: String, trim: true, default: '' },
    documentNumber: { type: String, trim: true, default: '' },
    notes: { type: String, trim: true, default: '' },
    forecast: { type: Boolean, default: false },
    uncollectible: { type: Boolean, default: false },
    protest: { type: Boolean, default: false },
    installments: { type: [installmentSchema], default: [] },
  },
  {
    timestamps: true,
  }
);

accountReceivableSchema.index({ company: 1, createdAt: -1 });
accountReceivableSchema.index({ customer: 1, dueDate: 1 });

module.exports = mongoose.model('AccountReceivable', accountReceivableSchema);
