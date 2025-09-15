const mongoose = require('mongoose');
const { Schema } = mongoose;

const PORTES = ['Todos', 'Mini', 'Pequeno', 'Médio', 'Grande', 'Gigante'];

/**
 * Normaliza o campo "porte":
 * - aceita string ou array;
 * - remove duplicados;
 * - se incluir "Todos" ou ficar vazio, vira ["Todos"].
 */
function normalizePorte(value) {
  let arr = Array.isArray(value) ? value : (value != null ? [value] : []);
  arr = arr.map(v => String(v)).filter(Boolean);
  // dedup
  arr = [...new Set(arr)];
  if (arr.length === 0) return ['Todos'];
  if (arr.includes('Todos')) return ['Todos'];
  return arr;
}

const ServiceSchema = new Schema({
  nome: {
    type: String,
    required: true,
    trim: true,
  },
  grupo: {
    type: Schema.Types.ObjectId,
    ref: 'ServiceGroup',
    required: true
  },
  duracaoMinutos: {
    type: Number,
    min: 1,
    max: 600,
    required: true
  },
  custo: {
    type: Number,
    min: 0,
    default: 0
  },
  valor: {
    type: Number,
    min: 0,
    required: true
  },
  // AGORA: array de portes
  porte: {
    type: [String],
    enum: PORTES,
    default: ['Todos'],
    set: normalizePorte
  },
  ativo: {
    type: Boolean,
    default: true
  }
}, { timestamps: true });

// Nome único dentro do mesmo grupo
ServiceSchema.index({ nome: 1, grupo: 1 }, { unique: true });
ServiceSchema.index({ grupo: 1 });

module.exports = mongoose.model('Service', ServiceSchema);
module.exports.PORTES = PORTES;