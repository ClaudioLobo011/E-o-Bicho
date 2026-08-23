const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  entity: {
    type: String,
    enum: ['customer', 'pet', 'address', 'employee', 'service', 'store', 'deposit'],
    required: true,
    index: true,
  },
  entityId: { type: String, required: true, trim: true },
  ownerId: { type: String, trim: true, default: '' },
  companies: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Store' }],
  deletedAt: { type: Date, required: true, default: Date.now },
}, { timestamps: true });

schema.index({ entity: 1, entityId: 1 }, { unique: true });
schema.index({ entity: 1, updatedAt: 1, _id: 1 });
schema.index({ entity: 1, companies: 1, updatedAt: 1, _id: 1 });

module.exports = mongoose.model('PdvDesktopSyncTombstone', schema);
