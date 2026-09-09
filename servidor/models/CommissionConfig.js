const mongoose = require('mongoose');

const { Schema } = mongoose;

const COMMISSION_ACTION_ROLES = ['admin', 'admin_master'];

const CommissionConfigSchema = new Schema(
  {
    store: { type: Schema.Types.ObjectId, ref: 'Store', required: true, index: true, unique: true },
    accountingAccount: { type: Schema.Types.ObjectId, ref: 'AccountingAccount', default: null },
    bankAccount: { type: Schema.Types.ObjectId, ref: 'BankAccount', default: null },
    includeServices: { type: Boolean, default: true },
    includePdvSales: { type: Boolean, default: true },
    requireSecondApproval: { type: Boolean, default: false },
    secondApprovalThreshold: { type: Number, min: 0, default: 0 },
    notifyOverdue: { type: Boolean, default: true },
    closeRoles: {
      type: [String],
      enum: COMMISSION_ACTION_ROLES,
      default: () => [...COMMISSION_ACTION_ROLES],
    },
    payRoles: {
      type: [String],
      enum: COMMISSION_ACTION_ROLES,
      default: () => [...COMMISSION_ACTION_ROLES],
    },
    cancelRoles: {
      type: [String],
      enum: COMMISSION_ACTION_ROLES,
      default: () => [...COMMISSION_ACTION_ROLES],
    },
    configureRoles: {
      type: [String],
      enum: COMMISSION_ACTION_ROLES,
      default: () => [...COMMISSION_ACTION_ROLES],
    },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  {
    timestamps: true,
  },
);

module.exports = mongoose.model('CommissionConfig', CommissionConfigSchema);
