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

const WeekdayRuleSchema = new Schema({
  id: { type: String, required: true },
  weekdays: [{ type: Number, min: 0, max: 6 }],
  enabled: { type: Boolean, default: true },
  defaultPercent: { type: Number, min: 0, max: 100, default: null },
  groupRules: { type: [GroupCommissionRuleSchema], default: [] },
  serviceRules: { type: [ServiceCommissionRuleSchema], default: [] },
}, { _id: false });

const VersionSchema = new Schema({
  revision: { type: Number, default: 0 },
  effectiveFrom: { type: String, default: '' },
  professionalType: { type: String },
  groupRules: { type: [GroupCommissionRuleSchema], default: [] },
  serviceRules: { type: [ServiceCommissionRuleSchema], default: [] },
  weekdayRules: { type: [WeekdayRuleSchema], default: [] },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  updatedAt: { type: Date },
}, { _id: false });

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
    revision: { type: Number, default: 0 },
    effectiveFrom: { type: String, default: '' },
    weekdayRules: { type: [WeekdayRuleSchema], default: [] },
    history: { type: [VersionSchema], default: [] },
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
