const mongoose = require('mongoose');
const { Schema } = mongoose;

const lineSchema = new Schema({
  id: { type: String, required: true },
  description: { type: String, default: '' },
  supplierCode: { type: String, default: '' },
  expectedQuantity: { type: Number, default: null },
  receivedQuantity: { type: Number, default: 0 },
  unit: { type: String, default: 'UN' },
  unitCost: { type: Number, default: null },
  productId: { type: Schema.Types.ObjectId, ref: 'Product', default: null },
  productName: { type: String, default: '' },
  barcode: { type: String, default: '' },
  stockFactor: { type: Number, default: 1 },
  conversionConfirmed: { type: Boolean, default: false },
  reviewed: { type: Boolean, default: false },
  sourcePhotoId: { type: String, default: '' },
  sourceText: { type: String, default: '' },
  sourcePage: { type: String, default: '' },
  warnings: { type: [String], default: [] },
}, { _id: false });

const eventSchema = new Schema({
  eventId: { type: String, required: true },
  payloadHash: { type: String, required: true },
  barcode: { type: String, default: '' },
  quantity: { type: Number, default: 0 },
  mode: { type: String, enum: ['count', 'identify', 'undo', 'adjust'], required: true },
  lineId: { type: String, default: '' },
  requestedLineId: { type: String, default: '' },
  createdAt: { type: Date, required: true },
  receivedAt: { type: Date, default: Date.now },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  deviceId: { type: Schema.Types.ObjectId, ref: 'ReceivingDevice', default: null },
  undoOf: { type: String, default: '' },
  undoneBy: { type: String, default: '' },
  status: { type: String, default: 'matched' },
  message: { type: String, default: '' },
}, { _id: false });

const schema = new Schema({
  code: { type: String, required: true, unique: true },
  version: { type: Number, required: true, default: 1 },
  status: { type: String, enum: ['draft', 'approved', 'test_approved', 'cancelled'], default: 'draft' },
  testMode: { type: Boolean, default: true },
  companyId: { type: Schema.Types.ObjectId, ref: 'Store', required: true },
  depositId: { type: Schema.Types.ObjectId, ref: 'Deposit', required: true },
  supplierId: { type: Schema.Types.ObjectId, ref: 'Supplier', default: null },
  supplierName: { type: String, default: '' },
  reference: { type: String, default: '' },
  documentType: { type: String, enum: ['romaneio'], default: 'romaneio' },
  sourceDocumentType: { type: String, default: '' },
  notes: { type: String, default: '' },
  lines: { type: [lineSchema], default: [] },
  events: { type: [eventSchema], default: [] },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  approvedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  approvedAt: { type: Date, default: null },
  approval: { type: Schema.Types.Mixed, default: null },
}, { timestamps: true, versionKey: false });
schema.index({ companyId: 1, updatedAt: -1 });
schema.index({ status: 1, updatedAt: -1 });
module.exports = mongoose.model('ReceivingReceipt', schema);
