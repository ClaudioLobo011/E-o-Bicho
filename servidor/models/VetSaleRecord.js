const mongoose = require('mongoose');

const { Schema } = mongoose;

const VetSaleRecordSchema = new Schema(
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
      default: null,
      index: true,
    },
    produto: {
      type: Schema.Types.ObjectId,
      ref: 'Product',
      default: null,
    },
    produtoNome: {
      type: String,
      default: '',
      trim: true,
    },
    valorUnitario: {
      type: Number,
      default: 0,
    },
    quantidade: {
      type: Number,
      default: 0,
    },
    subtotal: {
      type: Number,
      default: 0,
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
  },
  { timestamps: true },
);

VetSaleRecordSchema.index({ cliente: 1, pet: 1, createdAt: -1 });
VetSaleRecordSchema.index({ appointment: 1, createdAt: -1 });

module.exports = mongoose.model('VetSaleRecord', VetSaleRecordSchema);
