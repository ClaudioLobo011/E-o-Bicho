const mongoose = require('mongoose');

const searchTermSchema = new mongoose.Schema({
  term: { type: String, required: true, unique: true }, // já normalizado (lower/sem acento)
  original: { type: String, default: '' }, // última variação digitada pelo usuário
  count: { type: Number, default: 0 },
  lastSearchedAt: { type: Date, default: Date.now },
}, { timestamps: true });

module.exports = mongoose.model('SearchTerm', searchTermSchema);

