const mongoose = require('mongoose');

const icmsSimplesSchema = new mongoose.Schema({
  empresa: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Store',
    required: true,
  },
  codigo: {
    type: Number,
    required: true,
    min: 1,
    max: 999,
  },
  valor: {
    type: Number,
    required: true,
    min: 0,
  },
}, {
  timestamps: true,
});

icmsSimplesSchema.index({ empresa: 1, codigo: 1 }, { unique: true });

const IcmsSimples = mongoose.model('IcmsSimples', icmsSimplesSchema);

module.exports = IcmsSimples;
