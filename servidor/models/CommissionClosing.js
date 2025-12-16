const mongoose = require('mongoose');
const { Schema } = mongoose;

const CommissionClosingSchema = new Schema(
  {
    profissional: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    store: { type: Schema.Types.ObjectId, ref: 'Store', default: null },
    periodoInicio: { type: Date, required: true },
    periodoFim: { type: Date, required: true },
    totalPeriodo: { type: Number, default: 0 },
    totalPendente: { type: Number, default: 0 },
    totalVendas: { type: Number, default: 0 },
    totalServicos: { type: Number, default: 0 },
    pendenteVendas: { type: Number, default: 0 },
    pendenteServicos: { type: Number, default: 0 },
    totalPago: { type: Number, default: 0 },
    previsaoPagamento: { type: Date, default: null },
    meioPagamento: { type: String, trim: true, default: '' },
    payable: { type: Schema.Types.ObjectId, ref: 'AccountPayable', default: null },
    status: {
      type: String,
      enum: ['pendente', 'agendado', 'pago'],
      default: 'pendente',
      index: true,
    },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

module.exports = mongoose.model('CommissionClosing', CommissionClosingSchema);
