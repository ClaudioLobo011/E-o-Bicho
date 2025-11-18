const mongoose = require('mongoose');

const internacaoBoxSchema = new mongoose.Schema(
  {
    box: { type: String, required: true, trim: true },
    ocupante: { type: String, default: 'Livre', trim: true },
    status: { type: String, default: 'Disponível', trim: true },
    especialidade: { type: String, default: '', trim: true },
    higienizacao: { type: String, default: '—', trim: true },
    observacao: { type: String, default: '', trim: true },
  },
  {
    timestamps: true,
  },
);

module.exports = mongoose.model('InternacaoBox', internacaoBoxSchema);
