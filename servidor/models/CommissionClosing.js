const mongoose = require('mongoose');
const { Schema } = mongoose;

const snapshotItemSchema = new Schema(
  {
    key: { type: String, trim: true, required: true },
    source: {
      type: String,
      enum: ['appointment_service', 'pdv_product'],
      required: true,
    },
    sourceDocumentId: { type: String, trim: true, default: '' },
    sourceItemId: { type: String, trim: true, default: '' },
    date: { type: String, trim: true, required: true },
    time: { type: String, trim: true, default: '' },
    petName: { type: String, trim: true, default: '' },
    description: { type: String, trim: true, default: '' },
    saleCode: { type: String, trim: true, default: '' },
    value: { type: Number, min: 0, default: 0 },
    percent: { type: Number, min: 0, default: 0 },
    commission: { type: Number, min: 0, default: 0 },
    status: { type: String, trim: true, default: '' },
    paid: { type: Boolean, default: false },
  },
  { _id: false },
);

const auditEntrySchema = new Schema(
  {
    action: {
      type: String,
      enum: [
        'created',
        'scheduled',
        'payment_requested',
        'payment_approved',
        'payment_rejected',
        'paid',
        'cancelled',
        'reconciled',
      ],
      required: true,
    },
    at: { type: Date, required: true, default: Date.now },
    date: { type: String, trim: true, default: '' },
    time: { type: String, trim: true, default: '' },
    user: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    reason: { type: String, trim: true, default: '' },
    metadata: { type: Schema.Types.Mixed, default: null },
  },
  { _id: false },
);

const paymentApprovalSchema = new Schema(
  {
    required: { type: Boolean, default: false },
    status: {
      type: String,
      enum: ['none', 'pending', 'approved', 'rejected'],
      default: 'none',
    },
    requestedAt: { type: Date, default: null },
    requestedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    rejectionReason: { type: String, trim: true, default: '' },
    paymentDate: { type: String, trim: true, default: '' },
    paymentTime: { type: String, trim: true, default: '' },
    paymentMethod: { type: String, trim: true, default: '' },
    amount: { type: Number, min: 0, default: 0 },
    reference: { type: String, trim: true, maxlength: 180, default: '' },
    receipt: {
      type: Schema.Types.ObjectId,
      ref: 'CommissionPaymentReceipt',
      default: null,
    },
  },
  { _id: false },
);

const CommissionClosingSchema = new Schema(
  {
    profissional: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    store: { type: Schema.Types.ObjectId, ref: 'Store', default: null },
    periodoInicio: { type: Date, required: true },
    periodoFim: { type: Date, required: true },
    // Preservam literalmente os dias escolhidos no formulário, sem conversão de fuso.
    periodoInicioData: { type: String, trim: true, default: '' },
    periodoFimData: { type: String, trim: true, default: '' },
    totalPeriodo: { type: Number, default: 0 },
    totalPendente: { type: Number, default: 0 },
    totalVendas: { type: Number, default: 0 },
    totalServicos: { type: Number, default: 0 },
    pendenteVendas: { type: Number, default: 0 },
    pendenteServicos: { type: Number, default: 0 },
    totalPago: { type: Number, default: 0 },
    previsaoPagamento: { type: Date, default: null },
    previsaoPagamentoData: { type: String, trim: true, default: '' },
    previsaoPagamentoHora: { type: String, trim: true, default: '' },
    meioPagamento: { type: String, trim: true, default: '' },
    payable: { type: Schema.Types.ObjectId, ref: 'AccountPayable', default: null },
    paymentReference: { type: String, trim: true, maxlength: 180, default: '' },
    paymentReceipt: {
      type: Schema.Types.ObjectId,
      ref: 'CommissionPaymentReceipt',
      default: null,
    },
    paymentApproval: { type: paymentApprovalSchema, default: () => ({}) },
    paidAt: { type: Date, default: null },
    paidDate: { type: String, trim: true, default: '' },
    paidTime: { type: String, trim: true, default: '' },
    paidBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    cancelledAt: { type: Date, default: null },
    cancelledDate: { type: String, trim: true, default: '' },
    cancelledTime: { type: String, trim: true, default: '' },
    cancelledBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    cancellationReason: { type: String, trim: true, default: '' },
    kind: {
      type: String,
      enum: ['regular', 'adjustment'],
      default: 'regular',
    },
    snapshotVersion: { type: Number, default: 0 },
    snapshotCreatedAt: { type: Date, default: null },
    snapshotItems: { type: [snapshotItemSchema], default: [] },
    snapshotExclusions: { type: [Schema.Types.Mixed], default: [] },
    auditTrail: { type: [auditEntrySchema], default: [] },
    status: {
      type: String,
      enum: ['pendente', 'agendado', 'aguardando_aprovacao', 'pago', 'cancelado'],
      default: 'pendente',
      index: true,
    },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true, optimisticConcurrency: true },
);

CommissionClosingSchema.index({ store: 1, periodoInicio: 1, periodoFim: 1, createdAt: -1 });
CommissionClosingSchema.index({ profissional: 1, store: 1, status: 1, periodoInicio: 1, periodoFim: 1 });
CommissionClosingSchema.index({ store: 1, paidDate: 1, status: 1 });
CommissionClosingSchema.index({ profissional: 1, store: 1, periodoInicioData: 1, periodoFimData: 1 });
CommissionClosingSchema.index({ store: 1, status: 1, 'paymentApproval.status': 1, updatedAt: -1 });

module.exports = mongoose.model('CommissionClosing', CommissionClosingSchema);
