const mongoose = require('mongoose');

const UserGroupSchema = new mongoose.Schema({
  codigo: {
    type: Number,
    required: true,
    unique: true,
    min: 1,
  },
  nome: {
    type: String,
    required: true,
    trim: true,
    maxlength: 120,
  },
  comissaoPercent: {
    type: Number,
    min: 0,
    max: 100,
    default: 0,
  },
  comissaoServicoPercent: {
    type: Number,
    min: 0,
    max: 100,
    default: 0,
  },
  ativo: {
    type: Boolean,
    default: true,
  },
}, {
  timestamps: true,
});

module.exports = mongoose.model('UserGroup', UserGroupSchema);
