const mongoose = require('mongoose');
const { Schema } = mongoose;

const VetConsultationSchema = new Schema({
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
  servico: {
    type: Schema.Types.ObjectId,
    ref: 'Service',
    required: true,
  },
  appointment: {
    type: Schema.Types.ObjectId,
    ref: 'Appointment',
  },
  anamnese: {
    type: String,
    default: '',
  },
  exameFisico: {
    type: String,
    default: '',
  },
  diagnostico: {
    type: String,
    default: '',
  },
  createdBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
  },
  updatedBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
  },
}, { timestamps: true });

VetConsultationSchema.index({ cliente: 1, pet: 1, createdAt: -1 });
VetConsultationSchema.index({ appointment: 1 });
VetConsultationSchema.index({ servico: 1 });

module.exports = mongoose.model('VetConsultation', VetConsultationSchema);
