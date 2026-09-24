const mongoose = require('mongoose');

// A DPS assinada e o retrato dos dados nunca são reescritos. Correções de uma
// rejeição definitiva geram outra revisão, preservando a tentativa anterior.
const schema = new mongoose.Schema({
  pdv: { type: mongoose.Schema.Types.ObjectId, ref: 'Pdv', required: true, immutable: true },
  store: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true, immutable: true },
  saleId: { type: String, required: true, immutable: true },
  saleCode: { type: String, default: '', immutable: true },
  environment: { type: String, enum: ['homologacao', 'producao'], required: true, immutable: true },
  groupKey: { type: String, required: true, immutable: true },
  revision: { type: Number, required: true, default: 1, immutable: true },
  sourceHash: { type: String, required: true, immutable: true },
  dpsId: { type: String, required: true, immutable: true },
  dpsNumber: { type: Number, required: true, immutable: true },
  dpsSerie: { type: String, required: true, immutable: true },
  snapshot: { type: mongoose.Schema.Types.Mixed, required: true, immutable: true },
  dpsXml: { type: String, required: true, immutable: true, select: false },
  total: { type: Number, required: true, immutable: true },
  status: { type: String, enum: ['pending', 'processing', 'authorized', 'rejected', 'unknown', 'cancelled', 'superseded'], default: 'pending', index: true },
  number: String,
  accessKey: String,
  issuerName: String,
  issuerCnpj: String,
  verificationCode: String,
  consultationUrl: String,
  xmlContent: { type: String, select: false },
  issuedAt: Date,
  error: String,
  errorCodes: [String],
  attempts: { type: Number, default: 0 },
  lastAttemptAt: Date,
  lockToken: { type: String, select: false },
  lockUntil: { type: Date, default: null },
  cancelledAt: Date,
  cancelRequestXml: { type: String, select: false },
  cancelEventXml: { type: String, select: false },
  cancellationReason: String,
}, { timestamps: true });

schema.index({ pdv: 1, saleId: 1, environment: 1, groupKey: 1, revision: 1 }, { unique: true });
schema.index({ environment: 1, dpsId: 1 }, { unique: true });
schema.index({ store: 1, createdAt: -1 });
module.exports = mongoose.models.NfseDocument || mongoose.model('NfseDocument', schema);

// Serializa revisões/agrupamentos da mesma venda também entre processos do servidor.
const saleLockSchema = new mongoose.Schema({
  _id: { type: String },
  token: { type: String, required: true },
  until: { type: Date, required: true },
}, { versionKey: false });
module.exports.SaleLock = mongoose.models.NfseSaleLock || mongoose.model('NfseSaleLock', saleLockSchema);
