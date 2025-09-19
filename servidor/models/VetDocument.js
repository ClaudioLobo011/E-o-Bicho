const mongoose = require('mongoose');

const { Schema } = mongoose;

const VetDocumentSchema = new Schema({
  descricao: {
    type: String,
    required: true,
    trim: true,
    maxlength: 180,
  },
  conteudo: {
    type: String,
    default: '',
  },
  createdBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  updatedBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
}, { timestamps: true });

VetDocumentSchema.index({ descricao: 1, createdAt: -1 });

module.exports = mongoose.model('VetDocument', VetDocumentSchema);
