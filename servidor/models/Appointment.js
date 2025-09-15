const mongoose = require('mongoose');
const { Schema } = mongoose;

const AppointmentSchema = new Schema({
  store: { type: Schema.Types.ObjectId, ref: 'Store', required: true },
  cliente: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  pet: { type: Schema.Types.ObjectId, ref: 'Pet', required: true },
    servico: { type: Schema.Types.ObjectId, ref: 'Service', required: false },
    itens: [{
    servico: { type: Schema.Types.ObjectId, ref: 'Service', required: true },
    valor:   { type: Number, required: true, min: 0 }
    }],
  profissional: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  scheduledAt: { type: Date, required: true },
  valor: { type: Number, required: true, min: 0 },
  pago: { type: Boolean, default: false },
  codigoVenda: { type: String },
  status: {
    type: String,
    enum: ['agendado', 'em_espera', 'em_atendimento', 'finalizado'],
    default: 'agendado',
    index: true
  },
  observacoes: { type: String },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

AppointmentSchema.index({ store: 1, scheduledAt: 1 });
AppointmentSchema.index({ profissional: 1, scheduledAt: 1 });

module.exports = mongoose.model('Appointment', AppointmentSchema);