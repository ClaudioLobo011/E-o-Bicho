const mongoose = require('mongoose');

const pdvCaixaSessionSchema = new mongoose.Schema(
  {
    pdv: { type: mongoose.Schema.Types.ObjectId, ref: 'Pdv', required: true, index: true },
    empresa: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', default: null, index: true },
    pdvNome: { type: String, trim: true, default: '' },
    pdvCodigo: { type: String, trim: true, default: '' },
    status: { type: String, enum: ['aberto', 'fechado'], default: 'fechado', index: true },
    caixaAberto: { type: Boolean, default: false, index: true },
    aberturaData: { type: Date, default: null, index: true },
    fechamentoData: { type: Date, default: null, index: true },
    fechamentoPrevisto: { type: Number, default: 0 },
    fechamentoApurado: { type: Number, default: 0 },
    summary: { type: mongoose.Schema.Types.Mixed, default: {} },
    historySnapshot: { type: [mongoose.Schema.Types.Mixed], default: [] },
    completedSalesSnapshot: { type: [mongoose.Schema.Types.Mixed], default: [] },
    pagamentosSnapshot: { type: [mongoose.Schema.Types.Mixed], default: [] },
    caixaInfoSnapshot: { type: mongoose.Schema.Types.Mixed, default: {} },
    stateUpdatedAt: { type: Date, default: null, index: true },
  },
  { timestamps: true }
);

pdvCaixaSessionSchema.index(
  { pdv: 1, aberturaData: 1 },
  {
    unique: true,
    partialFilterExpression: { aberturaData: { $type: 'date' } },
  }
);

module.exports = mongoose.model('PdvCaixaSession', pdvCaixaSessionSchema);
