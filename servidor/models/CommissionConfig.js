const mongoose = require('mongoose');

const { Schema } = mongoose;

const CommissionConfigSchema = new Schema(
  {
    store: { type: Schema.Types.ObjectId, ref: 'Store', required: true, index: true, unique: true },
    accountingAccount: { type: Schema.Types.ObjectId, ref: 'AccountingAccount', default: null },
    bankAccount: { type: Schema.Types.ObjectId, ref: 'BankAccount', default: null },
    includeServices: { type: Boolean, default: true },
    includePdvSales: { type: Boolean, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  {
    timestamps: true,
  },
);

module.exports = mongoose.model('CommissionConfig', CommissionConfigSchema);
