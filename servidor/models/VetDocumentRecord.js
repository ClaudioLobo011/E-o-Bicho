const mongoose = require('mongoose');

const { Schema } = mongoose;

const VetDocumentRecordSchema = new Schema({
  cliente: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  pet: {
    type: Schema.Types.ObjectId,
    ref: 'Pet',
    required: true,
    index: true,
  },
  documento: {
    type: Schema.Types.ObjectId,
    ref: 'VetDocument',
    default: null,
  },
  appointment: {
    type: Schema.Types.ObjectId,
    ref: 'Appointment',
    default: null,
  },
  descricao: {
    type: String,
    trim: true,
    default: '',
    maxlength: 180,
  },
  conteudo: {
    type: String,
    required: true,
  },
  conteudoOriginal: {
    type: String,
    default: '',
  },
  preview: {
    type: String,
    default: '',
    maxlength: 2000,
  },
  createdBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  updatedBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
}, { timestamps: true });

VetDocumentRecordSchema.index({ cliente: 1, pet: 1, createdAt: -1 });
VetDocumentRecordSchema.index({ appointment: 1 });

module.exports = mongoose.model('VetDocumentRecord', VetDocumentRecordSchema);
