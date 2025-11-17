const mongoose = require('mongoose');

const internacaoRegistroSchema = new mongoose.Schema(
  {
    codigo: { type: Number, required: true, unique: true, index: true },
    petId: { type: String, trim: true },
    petNome: { type: String, required: true, trim: true },
    petEspecie: { type: String, trim: true },
    petRaca: { type: String, trim: true },
    petPeso: { type: String, trim: true },
    petIdade: { type: String, trim: true },
    tutorNome: { type: String, trim: true },
    tutorDocumento: { type: String, trim: true },
    tutorContato: { type: String, trim: true },
    situacao: { type: String, trim: true },
    situacaoCodigo: { type: String, trim: true },
    risco: { type: String, trim: true },
    riscoCodigo: { type: String, trim: true },
    veterinario: { type: String, trim: true },
    box: { type: String, trim: true },
    altaPrevistaData: { type: String, trim: true },
    altaPrevistaHora: { type: String, trim: true },
    queixa: { type: String, trim: true },
    diagnostico: { type: String, trim: true },
    prognostico: { type: String, trim: true },
    alergias: [{ type: String, trim: true }],
    acessorios: { type: String, trim: true },
    observacoes: { type: String, trim: true },
  },
  {
    timestamps: true,
  },
);

module.exports = mongoose.model('InternacaoRegistro', internacaoRegistroSchema);
