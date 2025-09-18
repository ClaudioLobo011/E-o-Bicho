const mongoose = require('mongoose');

const { Schema } = mongoose;

const petWeightSchema = new Schema({
  cliente: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  pet: {
    type: Schema.Types.ObjectId,
    ref: 'Pet',
    required: true,
  },
  peso: {
    type: Number,
    required: true,
    min: 0,
  },
  registradoPor: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  isInitial: {
    type: Boolean,
    default: false,
  },
}, { timestamps: true });

module.exports = mongoose.model('PetWeight', petWeightSchema);
