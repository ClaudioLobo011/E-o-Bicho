const mongoose = require('mongoose');

const internacaoParametroSchema = new mongoose.Schema(
  {
    nome: { type: String, required: true, trim: true },
    ordem: { type: Number, index: true, unique: true, sparse: true },
    opcoes: [{ type: String, trim: true }],
  },
  {
    timestamps: true,
  },
);

internacaoParametroSchema.index({ nome: 1 });

module.exports = mongoose.model('InternacaoParametro', internacaoParametroSchema);
