const mongoose = require('mongoose');
const { Schema } = mongoose;

const PORTES = ['Todos', 'Mini', 'Pequeno', 'Médio', 'Grande', 'Gigante'];
const SERVICE_CATEGORIES = [
  'banho',
  'taxi_pet',
  'internacao',
  'hotel',
  'vacina',
  'day_care',
  'outros',
  'veterinario',
  'exame',
  'banho_tosa',
];

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

function normalizeCategorias(value) {
  let arr = Array.isArray(value) ? value : (value != null ? [value] : []);
  arr = arr.map(v => String(v).trim()).filter(Boolean);
  const allowed = new Set(SERVICE_CATEGORIES);
  arr = arr.filter(v => allowed.has(v));
  return [...new Set(arr)];
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
  categorias: {
    type: [String],
    enum: SERVICE_CATEGORIES,
    default: [],
    set: normalizeCategorias,
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
module.exports.CATEGORIES = SERVICE_CATEGORIES;
