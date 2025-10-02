const mongoose = require('mongoose');

const { Schema } = mongoose;

const ACCOUNT_TYPES = ['analitica', 'sintetica'];
const ACCOUNTING_ORIGINS = ['receita', 'despesa', 'ativo', 'passivo', 'resultado', 'encerramento', 'transferencia', ''];
const COST_CLASSIFICATIONS = ['fixo', 'variavel', 'cmv', 'impostos', 'outros', ''];
const SYSTEM_ORIGINS = ['0', '1', '2', '3', '4', ''];
const PAYMENT_NATURES = ['contas_pagar', 'contas_receber', ''];
const STATUS_VALUES = ['ativa', 'inativa'];

const accountingAccountSchema = new Schema(
  {
    companies: [
      {
        type: Schema.Types.ObjectId,
        ref: 'Store',
        required: true,
      },
    ],
    name: {
      type: String,
      required: true,
      trim: true,
    },
    code: {
      type: String,
      required: true,
      trim: true,
    },
    type: {
      type: String,
      enum: ACCOUNT_TYPES,
      required: true,
    },
    accountingOrigin: {
      type: String,
      enum: ACCOUNTING_ORIGINS,
      default: '',
    },
    costClassification: {
      type: String,
      enum: COST_CLASSIFICATIONS,
      default: '',
    },
    systemOrigin: {
      type: String,
      enum: SYSTEM_ORIGINS,
      default: '',
    },
    paymentNature: {
      type: String,
      enum: PAYMENT_NATURES,
      default: '',
    },
    spedCode: {
      type: String,
      trim: true,
      default: '',
    },
    notes: {
      type: String,
      trim: true,
      default: '',
    },
    status: {
      type: String,
      enum: STATUS_VALUES,
      default: 'ativa',
    },
  },
  {
    timestamps: true,
  }
);

accountingAccountSchema.index({ code: 1 });

module.exports = mongoose.model('AccountingAccount', accountingAccountSchema);
