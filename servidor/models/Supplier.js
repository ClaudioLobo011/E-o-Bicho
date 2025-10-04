const mongoose = require('mongoose');

const { Schema } = mongoose;

const SUPPLIER_TYPES = ['fisico', 'juridico', 'mei', 'produtor-rural'];
const SUPPLIER_KINDS = ['fabricante', 'distribuidora', 'representante', 'servico'];
const RETENTION_TYPES = ['IR', 'CSLL', 'COFINS', 'PIS', 'ISS', 'CPRB', 'INSS'];
const ICMS_CONTRIBUTOR_TYPES = ['1', '2', '9'];

const representativeSchema = new Schema(
  {
    name: { type: String, trim: true, default: '' },
    mobile: { type: String, trim: true, default: '' },
    email: { type: String, trim: true, default: '' },
  },
  { _id: false }
);

const supplierSchema = new Schema(
  {
    codeNumber: {
      type: Number,
      unique: true,
      index: true,
    },
    code: {
      type: String,
      unique: true,
      index: true,
      trim: true,
    },
    country: {
      type: String,
      required: true,
      trim: true,
      default: 'Brasil',
    },
    legalName: {
      type: String,
      required: true,
      trim: true,
    },
    fantasyName: {
      type: String,
      trim: true,
      default: '',
    },
    cnpj: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },
    stateRegistration: {
      type: String,
      trim: true,
      default: '',
    },
    type: {
      type: String,
      enum: SUPPLIER_TYPES,
      required: true,
      default: 'juridico',
    },
    companies: [
      {
        type: Schema.Types.ObjectId,
        ref: 'Store',
      },
    ],
    flags: {
      inactive: { type: Boolean, default: false },
      ong: { type: Boolean, default: false },
      bankSupplier: { type: Boolean, default: false },
    },
    address: {
      cep: { type: String, trim: true, default: '' },
      logradouro: { type: String, trim: true, default: '' },
      numero: { type: String, trim: true, default: '' },
      complemento: { type: String, trim: true, default: '' },
      bairro: { type: String, trim: true, default: '' },
      cidade: { type: String, trim: true, default: '' },
      uf: { type: String, trim: true, default: '' },
    },
    contact: {
      email: { type: String, trim: true, default: '' },
      phone: { type: String, trim: true, default: '' },
      mobile: { type: String, trim: true, default: '' },
      secondaryPhone: { type: String, trim: true, default: '' },
      responsible: { type: String, trim: true, default: '' },
    },
    otherInfo: {
      supplierKind: {
        type: String,
        enum: SUPPLIER_KINDS,
        default: 'distribuidora',
      },
      accountingAccount: {
        type: Schema.Types.ObjectId,
        ref: 'AccountingAccount',
        default: null,
      },
      icmsContribution: {
        type: String,
        enum: ICMS_CONTRIBUTOR_TYPES,
        default: '2',
      },
      observation: {
        type: String,
        trim: true,
        default: '',
      },
      bank: {
        type: String,
        trim: true,
        default: '',
      },
      agency: {
        type: String,
        trim: true,
        default: '',
      },
      accountNumber: {
        type: String,
        trim: true,
        default: '',
      },
    },
    representatives: [representativeSchema],
    retentions: [
      {
        type: String,
        enum: RETENTION_TYPES,
      },
    ],
  },
  {
    timestamps: true,
  }
);

supplierSchema.index({ legalName: 1 });
supplierSchema.index({ fantasyName: 1 });

module.exports = mongoose.model('Supplier', supplierSchema);
