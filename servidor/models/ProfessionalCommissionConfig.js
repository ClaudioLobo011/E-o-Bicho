const mongoose = require('mongoose');

const { Schema } = mongoose;

const PROFESSIONAL_TYPES = ['esteticista', 'veterinario'];

const CommissionRuleSchema = new Schema(
  {
    percent: {
      type: Number,
      min: 0,
      max: 100,
      required: true,
    },
  },
  { _id: false, discriminatorKey: 'ruleType' }
);

const GroupCommissionRuleSchema = new Schema(
  {
    group: {
      type: Schema.Types.ObjectId,
      ref: 'ServiceGroup',
      required: true,
    },
  },
  { _id: false }
);

const ServiceCommissionRuleSchema = new Schema(
  {
    service: {
      type: Schema.Types.ObjectId,
      ref: 'Service',
      required: true,
    },
  },
  { _id: false }
);

const ProfessionalCommissionConfigSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },
    professionalType: {
      type: String,
      enum: PROFESSIONAL_TYPES,
      required: true,
      trim: true,
    },
    groupRules: {
      type: [GroupCommissionRuleSchema],
      default: [],
    },
    serviceRules: {
      type: [ServiceCommissionRuleSchema],
      default: [],
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
  {
    timestamps: true,
  }
);

GroupCommissionRuleSchema.add(CommissionRuleSchema.obj);
ServiceCommissionRuleSchema.add(CommissionRuleSchema.obj);

module.exports = mongoose.model('ProfessionalCommissionConfig', ProfessionalCommissionConfigSchema);
module.exports.PROFESSIONAL_TYPES = PROFESSIONAL_TYPES;
