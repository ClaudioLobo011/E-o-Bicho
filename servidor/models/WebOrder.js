const mongoose = require('mongoose');

const { Schema } = mongoose;

const WebOrderAddressSchema = new Schema(
  {
    id: { type: Schema.Types.ObjectId, ref: 'UserAddress', default: null },
    cep: { type: String, trim: true, default: '' },
    logradouro: { type: String, trim: true, default: '' },
    numero: { type: String, trim: true, default: '' },
    complemento: { type: String, trim: true, default: '' },
    bairro: { type: String, trim: true, default: '' },
    cidade: { type: String, trim: true, default: '' },
    uf: { type: String, trim: true, default: '' },
    pais: { type: String, trim: true, default: 'Brasil' },
  },
  { _id: false }
);

const WebOrderCustomerSchema = new Schema(
  {
    id: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    name: { type: String, trim: true, default: '' },
    document: { type: String, trim: true, default: '' },
    phone: { type: String, trim: true, default: '' },
    email: { type: String, trim: true, default: '' },
    type: { type: String, trim: true, default: '' },
    address: { type: WebOrderAddressSchema, default: () => ({}) },
  },
  { _id: false }
);

const WebOrderItemSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', default: null },
    sku: { type: String, trim: true, default: '' },
    name: { type: String, trim: true, default: '' },
    quantity: { type: Number, default: 0 },
    unitPrice: { type: Number, default: 0 },
    discount: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    imageUrl: { type: String, trim: true, default: '' },
  },
  { _id: false }
);

const WebOrderPaymentSchema = new Schema(
  {
    method: { type: String, trim: true, default: '' },
    status: { type: String, trim: true, default: '' },
    statusDetail: { type: String, trim: true, default: '' },
    id: { type: String, trim: true, default: '' },
    orderId: { type: String, trim: true, default: '' },
    amount: { type: Number, default: 0 },
    fees: { type: Number, default: 0 },
    gateway: { type: String, trim: true, default: '' },
    confirmedAt: { type: Date, default: null },
  },
  { _id: false }
);

const WebOrderFiscalSchema = new Schema(
  {
    status: { type: String, trim: true, default: 'pendente' },
    number: { type: String, trim: true, default: '' },
    series: { type: String, trim: true, default: '' },
    key: { type: String, trim: true, default: '' },
  },
  { _id: false }
);

const WebOrderDeliverySchema = new Schema(
  {
    type: { type: String, trim: true, default: '' },
    cost: { type: Number, default: 0 },
  },
  { _id: false }
);

const WebOrderTotalsSchema = new Schema(
  {
    subtotal: { type: Number, default: 0 },
    discounts: { type: Number, default: 0 },
    deliveryCost: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
  },
  { _id: false }
);

const WebOrderHistorySchema = new Schema(
  {
    date: { type: Date, default: null },
    user: { type: String, trim: true, default: '' },
    description: { type: String, trim: true, default: '' },
  },
  { _id: false }
);

const WebOrderSchema = new Schema(
  {
    number: { type: Number, required: true, unique: true, index: true },
    code: { type: String, required: true, trim: true, unique: true },
    origin: { type: String, trim: true, default: 'ECOMMERCE', index: true },
    status: { type: String, trim: true, default: 'RECEBIDO', index: true },
    store: {
      id: { type: Schema.Types.ObjectId, ref: 'Store', required: true },
      name: { type: String, trim: true, default: '' },
    },
    customer: { type: WebOrderCustomerSchema, default: () => ({}) },
    payment: { type: WebOrderPaymentSchema, default: () => ({}) },
    fiscal: { type: WebOrderFiscalSchema, default: () => ({}) },
    delivery: { type: WebOrderDeliverySchema, default: () => ({}) },
    totals: { type: WebOrderTotalsSchema, default: () => ({}) },
    total: { type: Number, default: 0 },
    items: { type: [WebOrderItemSchema], default: [] },
    notes: { type: String, trim: true, default: '' },
    externalReference: { type: String, trim: true, default: '' },
    history: { type: [WebOrderHistorySchema], default: [] },
  },
  { timestamps: true }
);

module.exports = mongoose.model('WebOrder', WebOrderSchema);
