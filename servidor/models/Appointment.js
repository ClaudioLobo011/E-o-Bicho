const mongoose = require('mongoose');
const { Schema } = mongoose;

const AppointmentSchema = new Schema({
  store: { type: Schema.Types.ObjectId, ref: 'Store', required: true },
  cliente: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  pet: { type: Schema.Types.ObjectId, ref: 'Pet', required: true },
    servico: { type: Schema.Types.ObjectId, ref: 'Service', required: false },
  itens: [{
    servico: { type: Schema.Types.ObjectId, ref: 'Service', required: true },
    valor:   { type: Number, required: true, min: 0 },
    profissional: { type: Schema.Types.ObjectId, ref: 'User' },
    hora: { type: String, trim: true },
    data: { type: String, trim: true },
    status: {
      type: String,
      enum: ['agendado', 'em_espera', 'em_atendimento', 'finalizado'],
      default: 'agendado'
    },
    observacao: { type: String, trim: true },
  }],
  profissional: { type: Schema.Types.ObjectId, ref: 'User', required: false, default: null },
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
  clientMutationId: { type: String, trim: true, default: null },
  version: { type: Number, default: 1, min: 1 },
  deletedAt: { type: Date, default: null, index: true },
}, { timestamps: true });

AppointmentSchema.index({ store: 1, scheduledAt: 1 });
AppointmentSchema.index({ profissional: 1, scheduledAt: 1 });
AppointmentSchema.index({ store: 1, updatedAt: 1, _id: 1 });
AppointmentSchema.index({ store: 1, 'itens.data': 1 });
AppointmentSchema.index(
  { clientMutationId: 1 },
  { unique: true, partialFilterExpression: { clientMutationId: { $type: 'string' } } }
);

AppointmentSchema.pre(/^find/, function excludeSoftDeleted(next) {
  const query = this.getQuery();
  if (!Object.prototype.hasOwnProperty.call(query, 'deletedAt')) {
    this.where({ deletedAt: null });
  }
  next();
});

module.exports = mongoose.model('Appointment', AppointmentSchema);
