const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const { PET_COAT_LENGTHS } = require('../utils/petAppearance');

const petSchema = new Schema({
  // Campo para associar o pet ao seu dono (o utilizador logado)
  owner: {
    type: Schema.Types.ObjectId,
    ref: 'User', // Cria uma referência ao nosso modelo 'User'
    required: true
  },
  codigoPet: { type: Number, unique: true, sparse: true, min: 1 },
  codAntigoPet: { type: String, trim: true },
  nome: { type: String, required: true },
  tipo: { type: String, required: true },
  raca: { type: String, required: true },
  porte: { type: String },
  sexo: { type: String, required: true },
  dataNascimento: { type: Date },
  microchip: { type: String },
  cor: { type: String, trim: true },
  pelagem: { type: String, enum: ['', ...PET_COAT_LENGTHS] },
  pelagemCor: { type: String },
  rga: { type: String },
  peso: { type: String },
  obito: { type: Boolean, default: false },
  castrado: { type: Boolean, default: false },
}, { timestamps: true }); // timestamps adiciona os campos createdAt e updatedAt automaticamente

petSchema.index({ owner: 1, updatedAt: 1, _id: 1 });
 
module.exports = mongoose.model('Pet', petSchema);
