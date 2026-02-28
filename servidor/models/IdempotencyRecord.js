const mongoose = require('mongoose');

const idempotencyRecordSchema = new mongoose.Schema(
  {
    scope: { type: String, required: true, trim: true },
    key: { type: String, required: true, trim: true },
    status: { type: Number, required: true, default: 200 },
    body: { type: mongoose.Schema.Types.Mixed, default: {} },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

idempotencyRecordSchema.index({ scope: 1, key: 1 }, { unique: true });
idempotencyRecordSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('IdempotencyRecord', idempotencyRecordSchema);
