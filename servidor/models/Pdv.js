const mongoose = require('mongoose');

const ambientesPermitidos = ['homologacao', 'producao'];

const pdvSchema = new mongoose.Schema(
  {
    codigo: { type: String, required: true, trim: true, unique: true },
    nome: { type: String, required: true, trim: true },
    apelido: { type: String, trim: true },
    ativo: { type: Boolean, default: true },
    empresa: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true },
    serieNfe: { type: String, trim: true },
    serieNfce: { type: String, trim: true },
    ambientesHabilitados: {
      type: [{ type: String, enum: ambientesPermitidos }],
      default: ['homologacao'],
      validate: {
        validator(value) {
          return Array.isArray(value) && value.length > 0;
        },
        message: 'Informe ao menos um ambiente habilitado.',
      },
    },
    ambientePadrao: { type: String, enum: ambientesPermitidos, default: 'homologacao' },
    sincronizacaoAutomatica: { type: Boolean, default: true },
    permitirModoOffline: { type: Boolean, default: false },
    limiteOffline: { type: Number, min: 0, default: null },
    observacoes: { type: String, trim: true },
    ultimaSincronizacao: { type: Date, default: null },
    criadoPor: { type: String, trim: true },
    atualizadoPor: { type: String, trim: true },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Pdv', pdvSchema);
