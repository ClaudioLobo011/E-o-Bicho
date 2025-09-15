const mongoose = require('mongoose');

const ServiceBreedPriceSchema = new mongoose.Schema({
  service: { type: mongoose.Schema.Types.ObjectId, ref: 'Service', required: true },
  store:   { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true },
  tipo:    { type: String, required: true, trim: true }, // cachorro, gato, etc
  raca:    { type: String, required: true, trim: true },
  custo:   { type: Number, min: 0, default: 0 },
  valor:   { type: Number, min: 0, default: 0 },
}, { timestamps: true });

// Garantir unicidade por service+store+tipo+raca
ServiceBreedPriceSchema.index({ service: 1, store: 1, tipo: 1, raca: 1 }, { unique: true });

module.exports = mongoose.model('ServiceBreedPrice', ServiceBreedPriceSchema);

