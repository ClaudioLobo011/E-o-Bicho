const mongoose = require('mongoose');

const fiscalSerieParametroSchema = new mongoose.Schema({
  empresa: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Store',
    required: true,
  },
  ultimaNotaEmitida: {
    type: String,
    trim: true,
    default: '',
  },
}, { _id: false });

const fiscalSerieSchema = new mongoose.Schema({
  codigo: {
    type: String,
    trim: true,
    required: true,
  },
  descricao: {
    type: String,
    trim: true,
    required: true,
  },
  modelo: {
    type: String,
    trim: true,
    default: '',
  },
  serie: {
    type: String,
    trim: true,
    default: '',
  },
  ambiente: {
    type: String,
    trim: true,
    default: '',
  },
  parametros: {
    type: [fiscalSerieParametroSchema],
    default: () => ([]),
  },
}, {
  timestamps: true,
});

fiscalSerieSchema.index({ codigo: 1 }, { unique: true });

const FiscalSerie = mongoose.model('FiscalSerie', fiscalSerieSchema);

module.exports = FiscalSerie;
