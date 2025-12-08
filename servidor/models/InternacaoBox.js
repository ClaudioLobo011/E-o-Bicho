const mongoose = require('mongoose');

const internacaoBoxSchema = new mongoose.Schema(
  {
    box: { type: String, required: true, trim: true },
    ocupante: { type: String, default: 'Livre', trim: true },
    status: { type: String, default: 'Disponível', trim: true },
    especialidade: { type: String, default: '', trim: true },
    higienizacao: { type: String, default: '—', trim: true },
    observacao: { type: String, default: '', trim: true },
    empresaId: { type: String, trim: true },
    empresaNome: { type: String, trim: true },
    empresaNomeFantasia: { type: String, trim: true },
    empresaRazaoSocial: { type: String, trim: true },
    empresa: {
      id: { type: String, trim: true },
      value: { type: String, trim: true },
      nome: { type: String, trim: true },
      nomeFantasia: { type: String, trim: true },
      razaoSocial: { type: String, trim: true },
      label: { type: String, trim: true },
    },
  },
  {
    timestamps: true,
  },
);

module.exports = mongoose.model('InternacaoBox', internacaoBoxSchema);
