const mongoose = require('mongoose');

const userAddressSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

  // Identificação / apelido do endereço (ex: "Principal", "Casa", "Trabalho")
  apelido: { type: String, default: 'Principal' },

  // Dados básicos do endereço
  cep:        { type: String, required: true },
  logradouro: { type: String, default: '' },
  numero:     { type: String, default: '' },
  complemento:{ type: String, default: '' },
  bairro:     { type: String, default: '' },
  cidade:     { type: String, default: '' },
  uf:         { type: String, default: '' },
  ibge:       { type: String, default: '' },

  // Marcação de endereço principal
  isDefault: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model('UserAddress', userAddressSchema);
