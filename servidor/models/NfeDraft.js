const mongoose = require('mongoose');

const DuplicateSchema = new mongoose.Schema(
  {
    number: { type: String, default: '' },
    dueDate: { type: String, default: '' },
    manualDueDate: { type: String, default: '' },
    originalDueDate: { type: String, default: '' },
    value: { type: Number, default: null },
    manualValue: { type: Number, default: null },
    originalValue: { type: Number, default: null },
    paymentMethod: { type: String, default: '' },
    paymentDescription: { type: String, default: '' },
    paymentType: { type: String, default: '' },
    termDays: { type: Number, default: null },
    bankAccount: { type: String, default: '' },
    bankAccountIsManual: { type: Boolean, default: false },
    accountingAccountId: { type: String, default: '' },
    accountingAccountCode: { type: String, default: '' },
    accountingAccountName: { type: String, default: '' },
  },
  { _id: false }
);

const TotalsSchema = new mongoose.Schema(
  {
    products: { type: Number, default: 0 },
    icmsBase: { type: Number, default: 0 },
    icmsValue: { type: Number, default: 0 },
    icmsSt: { type: Number, default: 0 },
    fcpSt: { type: Number, default: 0 },
    discount: { type: Number, default: 0 },
    other: { type: Number, default: 0 },
    freight: { type: Number, default: 0 },
    ipi: { type: Number, default: 0 },
    insurance: { type: Number, default: 0 },
    dollar: { type: Number, default: 0 },
    totalValue: { type: Number, default: 0 },
  },
  { _id: false }
);

const AdditionalInfoSchema = new mongoose.Schema(
  {
    observation: { type: String, default: '' },
    complementaryFiscal: { type: String, default: '' },
    paymentCondition: { type: String, default: '' },
    paymentForm: { type: String, default: '' },
  },
  { _id: false }
);

const SelectionSchema = new mongoose.Schema(
  {
    companyId: { type: String, default: '' },
    supplierId: { type: String, default: '' },
    depositId: { type: String, default: '' },
    bankAccountId: { type: String, default: '' },
    accountingAccount: { type: String, default: '' },
    duplicataEmissionDate: { type: String, default: '' },
  },
  { _id: false }
);

const TransportSchema = new mongoose.Schema(
  {
    mode: { type: String, default: '' },
    transporter: { type: mongoose.Schema.Types.Mixed, default: {} },
    vehicle: { type: mongoose.Schema.Types.Mixed, default: {} },
    volume: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { _id: false }
);

const XmlSnapshotSchema = new mongoose.Schema(
  {
    accessKey: { type: String, default: '' },
    importAccessKey: { type: String, default: '' },
    ambient: { type: String, default: '' },
  },
  { _id: false }
);

const NfeDraftSchema = new mongoose.Schema(
  {
    code: { type: Number, required: true, unique: true, index: true },
    status: { type: String, default: 'draft' },
    header: {
      code: { type: String, default: '' },
      number: { type: String, default: '' },
      serie: { type: String, default: '' },
      type: { type: String, default: '' },
      model: { type: String, default: '' },
      issueDate: { type: String, default: '' },
      entryDate: { type: String, default: '' },
    },
    companyId: { type: String, default: '' },
    supplierId: { type: String, default: '' },
    supplierName: { type: String, default: '' },
    supplierDocument: { type: String, default: '' },
    supplierStateRegistration: { type: String, default: '' },
    supplierEmail: { type: String, default: '' },
    supplierAddressText: { type: String, default: '' },
    totals: { type: TotalsSchema, default: () => ({}) },
    duplicates: { type: [DuplicateSchema], default: () => [] },
    duplicatesSummary: {
      totalAmount: { type: Number, default: 0 },
      count: { type: Number, default: 0 },
    },
    items: { type: [mongoose.Schema.Types.Mixed], default: () => [] },
    references: { type: [mongoose.Schema.Types.Mixed], default: () => [] },
    payments: { type: [mongoose.Schema.Types.Mixed], default: () => [] },
    additionalInfo: { type: AdditionalInfoSchema, default: () => ({}) },
    selection: { type: SelectionSchema, default: () => ({}) },
    transport: { type: TransportSchema, default: () => ({}) },
    xml: { type: XmlSnapshotSchema, default: () => ({}) },
    metadata: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    importedData: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    payload: { type: mongoose.Schema.Types.Mixed, required: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('NfeDraft', NfeDraftSchema);
