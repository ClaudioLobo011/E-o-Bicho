const mongoose = require('mongoose');

const paymentSnapshotSchema = new mongoose.Schema(
  {
    id: { type: String, trim: true },
    label: { type: String, trim: true },
    type: { type: String, trim: true },
    aliases: [{ type: String, trim: true }],
    valor: { type: Number, default: 0 },
    parcelas: { type: Number, default: 1 },
  },
  { _id: false }
);

const historyEntrySchema = new mongoose.Schema(
  {
    id: { type: String, trim: true },
    label: { type: String, trim: true },
    amount: { type: Number, default: 0 },
    delta: { type: Number, default: 0 },
    motivo: { type: String, trim: true },
    paymentLabel: { type: String, trim: true },
    paymentId: { type: String, trim: true },
    timestamp: { type: Date, default: Date.now },
  },
  { _id: false }
);

const cashContributionSchema = new mongoose.Schema(
  {
    paymentId: { type: String, trim: true },
    paymentLabel: { type: String, trim: true },
    amount: { type: Number, default: 0 },
  },
  { _id: false }
);

const receivableSchema = new mongoose.Schema(
  {
    id: { type: String, trim: true },
    parcelNumber: { type: Number, default: 1 },
    value: { type: Number, default: 0 },
    formattedValue: { type: String, trim: true },
    dueDate: { type: Date, default: null },
    dueDateLabel: { type: String, trim: true },
    paymentMethodId: { type: String, trim: true },
    paymentMethodLabel: { type: String, trim: true },
    contaCorrente: { type: mongoose.Schema.Types.Mixed, default: null },
    contaContabil: { type: mongoose.Schema.Types.Mixed, default: null },
    saleCode: { type: String, trim: true },
    crediarioMethodId: { type: String, trim: true },
    clienteId: { type: String, trim: true },
    clienteNome: { type: String, trim: true },
    saleId: { type: String, trim: true },
  },
  { _id: false }
);

  const saleRecordSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, trim: true },
    type: { type: String, trim: true },
    typeLabel: { type: String, trim: true },
    saleCode: { type: String, trim: true },
    saleCodeLabel: { type: String, trim: true },
    customerName: { type: String, trim: true },
    customerDocument: { type: String, trim: true },
    seller: { type: mongoose.Schema.Types.Mixed, default: null },
    sellerName: { type: String, trim: true },
    sellerCode: { type: String, trim: true },
    paymentTags: [{ type: String, trim: true }],
    items: { type: [mongoose.Schema.Types.Mixed], default: [] },
    discountValue: { type: Number, default: 0 },
    discountLabel: { type: String, trim: true },
    additionValue: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    totalLiquido: { type: Number, default: 0 },
    totalBruto: { type: Number, default: 0 },
    createdAt: { type: Date },
    createdAtLabel: { type: String, trim: true },
    receiptSnapshot: { type: mongoose.Schema.Types.Mixed },
    fiscalStatus: { type: String, trim: true },
    fiscalEmittedAt: { type: Date },
    fiscalEmittedAtLabel: { type: String, trim: true },
    fiscalDriveFileId: { type: String, trim: true },
    fiscalXmlUrl: { type: String, trim: true },
    fiscalXmlName: { type: String, trim: true },
    fiscalXmlContent: { type: String },
    fiscalQrCodeData: { type: String, trim: true },
    fiscalQrCodeImage: { type: String },
    fiscalEnvironment: { type: String, trim: true },
    fiscalSerie: { type: String, trim: true },
    fiscalNumber: { type: Number },
    fiscalAccessKey: { type: String, trim: true },
    fiscalDigestValue: { type: String, trim: true },
    fiscalSignature: { type: String, trim: true },
    fiscalProtocol: { type: String, trim: true },
    fiscalReceiptNumber: { type: String, trim: true },
    fiscalSefazStatus: { type: String, trim: true },
    fiscalSefazMessage: { type: String, trim: true },
    fiscalSefazProcessedAt: { type: Date },
    fiscalSefazProcessedAtLabel: { type: String, trim: true },
    fiscalItemsSnapshot: { type: [mongoose.Schema.Types.Mixed], default: [] },
    receivables: { type: [receivableSchema], default: [] },
    expanded: { type: Boolean, default: false },
    status: { type: String, trim: true },
    cancellationReason: { type: String, trim: true },
    cancellationAt: { type: Date },
    cancellationAtLabel: { type: String, trim: true },
    inventoryProcessed: { type: Boolean, default: false },
    inventoryProcessedAt: { type: Date, default: null },
    cashContributions: { type: [cashContributionSchema], default: [] },
  },
  { _id: false }
);

const inventoryMovementSchema = new mongoose.Schema(
  {
    saleId: { type: String, trim: true, required: true },
    deposit: { type: mongoose.Schema.Types.ObjectId, ref: 'Deposit', required: true },
    processedAt: { type: Date, default: Date.now },
    items: {
      type: [
        {
          product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
          quantity: { type: Number, default: 0 },
        },
      ],
      default: [],
    },
  },
  { _id: false }
);

  const budgetRecordSchema = new mongoose.Schema(
  {
    id: { type: String, trim: true },
    code: { type: String, trim: true },
    createdAt: { type: Date, default: null },
    updatedAt: { type: Date, default: null },
    validityDays: { type: Number, default: null },
    validUntil: { type: Date, default: null },
    total: { type: Number, default: 0 },
    discount: { type: Number, default: 0 },
    addition: { type: Number, default: 0 },
    customer: { type: mongoose.Schema.Types.Mixed, default: null },
    pet: { type: mongoose.Schema.Types.Mixed, default: null },
    seller: { type: mongoose.Schema.Types.Mixed, default: null },
    sellerName: { type: String, trim: true },
    sellerCode: { type: String, trim: true },
    items: { type: [mongoose.Schema.Types.Mixed], default: [] },
    payments: { type: [mongoose.Schema.Types.Mixed], default: [] },
    paymentLabel: { type: String, trim: true, default: '' },
    status: { type: String, trim: true, default: 'aberto' },
    importedAt: { type: Date, default: null },
  },
  { _id: false }
);

const pdvStateSchema = new mongoose.Schema(
  {
    pdv: { type: mongoose.Schema.Types.ObjectId, ref: 'Pdv', required: true, unique: true },
    empresa: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true },
    caixaAberto: { type: Boolean, default: false },
    summary: {
      abertura: { type: Number, default: 0 },
      recebido: { type: Number, default: 0 },
      saldo: { type: Number, default: 0 },
    },
    caixaInfo: {
      aberturaData: { type: Date, default: null },
      fechamentoData: { type: Date, default: null },
      fechamentoPrevisto: { type: Number, default: 0 },
      fechamentoApurado: { type: Number, default: 0 },
      previstoPagamentos: { type: [paymentSnapshotSchema], default: [] },
      apuradoPagamentos: { type: [paymentSnapshotSchema], default: [] },
    },
    pagamentos: { type: [paymentSnapshotSchema], default: [] },
    history: { type: [historyEntrySchema], default: [] },
    completedSales: { type: [saleRecordSchema], default: [] },
    budgets: { type: [budgetRecordSchema], default: [] },
    lastMovement: { type: historyEntrySchema, default: null },
    saleCodeIdentifier: { type: String, trim: true, default: '' },
    saleCodeSequence: { type: Number, default: 1 },
    budgetSequence: { type: Number, default: 1 },
    printPreferences: {
      fechamento: { type: String, trim: true, default: 'PM' },
      venda: { type: String, trim: true, default: 'PM' },
    },
    inventoryMovements: { type: [inventoryMovementSchema], default: [] },
    accountsReceivable: { type: [receivableSchema], default: [] },
  },
  { timestamps: true }
);

module.exports = mongoose.model('PdvState', pdvStateSchema);
