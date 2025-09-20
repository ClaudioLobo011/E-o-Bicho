const mongoose = require('mongoose');

const { Schema } = mongoose;

const VetClinicHistorySchema = new Schema(
  {
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
      required: true,
      unique: true,
      index: true,
    },
    finalizadoEm: {
      type: Date,
      default: Date.now,
    },
    finalizadoPor: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    agenda: {
      type: Schema.Types.Mixed,
      default: {},
    },
    consultas: {
      type: [Schema.Types.Mixed],
      default: [],
    },
    vacinas: {
      type: [Schema.Types.Mixed],
      default: [],
    },
    anexos: {
      type: [Schema.Types.Mixed],
      default: [],
    },
    exames: {
      type: [Schema.Types.Mixed],
      default: [],
    },
    pesos: {
      type: [Schema.Types.Mixed],
      default: [],
    },
    observacoes: {
      type: [Schema.Types.Mixed],
      default: [],
    },
    documentos: {
      type: [Schema.Types.Mixed],
      default: [],
    },
    receitas: {
      type: [Schema.Types.Mixed],
      default: [],
    },
  },
  {
    timestamps: true,
  },
);

VetClinicHistorySchema.index({ cliente: 1, pet: 1, finalizadoEm: -1 });

module.exports = mongoose.model('VetClinicHistory', VetClinicHistorySchema);
