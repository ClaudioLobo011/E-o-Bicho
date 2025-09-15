const mongoose = require('mongoose');

const STAFF_TYPES = ['esteticista', 'veterinario', 'vendedor', 'gerente'];

const ServiceGroupSchema = new mongoose.Schema({
  nome: {
    type: String,
    required: true,
    trim: true,
    unique: true // mantém o índice único apenas aqui (sem schema.index duplicado)
  },
  tiposPermitidos: {
    type: [String],
    enum: STAFF_TYPES,
    default: [],
    validate: {
      validator: (arr) => Array.isArray(arr) && arr.length > 0,
      message: 'Selecione ao menos um tipo de funcionário.'
    }
  },
  comissaoPercent: {
    type: Number,
    min: 0,
    max: 100,
    default: 0
  },
  ativo: {
    type: Boolean,
    default: true
  }
}, { timestamps: true });

// NÃO declarar ServiceGroupSchema.index({ nome: 1 }, { unique: true })
// para evitar o warning de índice duplicado

module.exports = mongoose.model('ServiceGroup', ServiceGroupSchema);
module.exports.STAFF_TYPES = STAFF_TYPES;
