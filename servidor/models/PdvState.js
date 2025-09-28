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

const saleRecordSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, trim: true },
    type: { type: String, trim: true },
    typeLabel: { type: String, trim: true },
    saleCode: { type: String, trim: true },
    saleCodeLabel: { type: String, trim: true },
    customerName: { type: String, trim: true },
    customerDocument: { type: String, trim: true },
    paymentTags: [{ type: String, trim: true }],
    items: { type: [mongoose.Schema.Types.Mixed], default: [] },
    discountValue: { type: Number, default: 0 },
    discountLabel: { type: String, trim: true },
    additionValue: { type: Number, default: 0 },
    createdAt: { type: Date },
    createdAtLabel: { type: String, trim: true },
    receiptSnapshot: { type: mongoose.Schema.Types.Mixed },
    fiscalStatus: { type: String, trim: true },
    fiscalEmittedAt: { type: Date },
    fiscalEmittedAtLabel: { type: String, trim: true },
    fiscalDriveFileId: { type: String, trim: true },
    fiscalXmlUrl: { type: String, trim: true },
    fiscalXmlName: { type: String, trim: true },
    fiscalEnvironment: { type: String, trim: true },
    fiscalSerie: { type: String, trim: true },
    fiscalNumber: { type: Number },
    expanded: { type: Boolean, default: false },
    status: { type: String, trim: true },
    cancellationReason: { type: String, trim: true },
    cancellationAt: { type: Date },
    cancellationAtLabel: { type: String, trim: true },
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
    lastMovement: { type: historyEntrySchema, default: null },
    saleCodeIdentifier: { type: String, trim: true, default: '' },
    saleCodeSequence: { type: Number, default: 1 },
    printPreferences: {
      fechamento: { type: String, trim: true, default: 'PM' },
      venda: { type: String, trim: true, default: 'PM' },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('PdvState', pdvStateSchema);
