const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const petSchema = new Schema({
  // Campo para associar o pet ao seu dono (o utilizador logado)
  owner: {
    type: Schema.Types.ObjectId,
    ref: 'User', // Cria uma referência ao nosso modelo 'User'
    required: true
  },
  nome: { type: String, required: true },
  tipo: { type: String, required: true },
  raca: { type: String, required: true },
  porte: { type: String },
  sexo: { type: String, required: true },
  dataNascimento: { type: Date, required: true },
  microchip: { type: String },
  pelagemCor: { type: String },
  rga: { type: String },
  peso: { type: String },
}, { timestamps: true }); // timestamps adiciona os campos createdAt e updatedAt automaticamente



module.exports = mongoose.model('Pet', petSchema);