const mongoose = require('mongoose');

const bankAccountSchema = new mongoose.Schema(
  {
    company: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true },
    bankCode: { type: String, required: true, trim: true },
    bankName: { type: String, trim: true },
    agency: { type: String, required: true, trim: true },
    accountNumber: { type: String, required: true, trim: true },
    accountDigit: { type: String, trim: true },
    accountType: {
      type: String,
      enum: ['corrente', 'conta_pagamento', 'conta_investimento'],
      required: true,
    },
    pixKey: { type: String, trim: true },
    documentNumber: { type: String, required: true, trim: true },
    alias: { type: String, trim: true },
    initialBalance: { type: Number, default: 0 },
    dailyCdi: { type: Number, default: 0 },
  },
  {
    timestamps: true,
  }
);

bankAccountSchema.index(
  { company: 1, bankCode: 1, agency: 1, accountNumber: 1, accountDigit: 1 },
  { unique: true, sparse: true }
);

module.exports = mongoose.model('BankAccount', bankAccountSchema);
