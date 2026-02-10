const mongoose = require('mongoose');

const fiscalCfopSchema = new mongoose.Schema(
  {
    cfop: {
      type: String,
      required: true,
      trim: true,
    },
    descricao: {
      type: String,
      required: true,
      trim: true,
    },
    grupoCfop: {
      type: String,
      trim: true,
      default: '',
    },
    inicioVigencia: {
      type: Date,
      default: null,
    },
    tipo: {
      type: String,
      enum: ['entrada', 'saida', 'ambos'],
      required: true,
    },
    ativo: {
      type: Boolean,
      default: false,
    },
    bonificacao: {
      type: Boolean,
      default: false,
    },
    tipoMovimentacao: {
      type: String,
      enum: [
        'normal',
        'transferencia',
        'devolucao',
        'compra',
        'perda',
        'transformacao-cupom',
      ],
      default: 'normal',
    },
    precoUtilizar: {
      type: String,
      enum: ['venda', 'custo', 'medio'],
      default: 'venda',
    },
  },
  {
    timestamps: true,
  }
);

fiscalCfopSchema.index({ cfop: 1, tipo: 1 }, { unique: true });

const FiscalCfop = mongoose.model('FiscalCfop', fiscalCfopSchema);

module.exports = FiscalCfop;
