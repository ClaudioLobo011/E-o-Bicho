const mongoose = require('mongoose');

const fiscalDefaultRuleSchema = new mongoose.Schema(
  {
    empresa: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Store',
      required: true,
    },
    code: {
      type: Number,
      required: true,
      min: 1,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    fiscal: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    updatedBy: {
      type: String,
      trim: true,
      default: '',
    },
  },
  {
    timestamps: true,
  }
);

fiscalDefaultRuleSchema.index({ empresa: 1, code: 1 }, { unique: true });
fiscalDefaultRuleSchema.index({ empresa: 1, name: 1 });

module.exports = mongoose.model('FiscalDefaultRule', fiscalDefaultRuleSchema);
