const mongoose = require('mongoose');

const { Schema } = mongoose;

const VetAttachmentFileSchema = new Schema({
  nome: {
    type: String,
    required: true,
    trim: true,
  },
  originalName: {
    type: String,
    trim: true,
    default: '',
  },
  mimeType: {
    type: String,
    trim: true,
    default: '',
  },
  size: {
    type: Number,
    default: 0,
  },
  extension: {
    type: String,
    trim: true,
    default: '',
  },
  url: {
    type: String,
    trim: true,
    default: '',
  },
  driveFileId: {
    type: String,
    trim: true,
    default: '',
  },
  driveViewLink: {
    type: String,
    trim: true,
    default: '',
  },
  driveContentLink: {
    type: String,
    trim: true,
    default: '',
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
}, { _id: true, id: false });

const VetAttachmentSchema = new Schema({
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
  appointment: {
    type: Schema.Types.ObjectId,
    ref: 'Appointment',
    default: null,
  },
  observacao: {
    type: String,
    default: '',
    trim: true,
  },
  arquivos: {
    type: [VetAttachmentFileSchema],
    default: [],
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

VetAttachmentSchema.index({ cliente: 1, pet: 1, createdAt: -1 });
VetAttachmentSchema.index({ appointment: 1 });

module.exports = mongoose.model('VetAttachment', VetAttachmentSchema);
