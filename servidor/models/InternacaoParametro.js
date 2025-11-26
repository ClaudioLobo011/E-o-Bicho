const mongoose = require('mongoose');

const internacaoParametroSchema = new mongoose.Schema(
  {
    nome: { type: String, required: true, trim: true },
    ordem: { type: Number, required: true, unique: true },
    opcoes: [{ type: String, trim: true }],
  },
  {
    timestamps: true,
  },
);

internacaoParametroSchema.index({ ordem: 1 }, { unique: true });
internacaoParametroSchema.index({ nome: 1 });

module.exports = mongoose.model('InternacaoParametro', internacaoParametroSchema);
