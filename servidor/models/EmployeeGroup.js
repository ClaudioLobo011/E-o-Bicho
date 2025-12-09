const mongoose = require('mongoose');

const EmployeeGroupSchema = new mongoose.Schema({
  codigo: {
    type: Number,
    required: true,
    unique: true,
    min: 1
  },
  nome: {
    type: String,
    required: true,
    trim: true,
    unique: true,
  },
  descricao: {
    type: String,
    trim: true,
    default: '',
  },
  ativo: {
    type: Boolean,
    default: true,
  }
}, { timestamps: true });

module.exports = mongoose.model('EmployeeGroup', EmployeeGroupSchema);
