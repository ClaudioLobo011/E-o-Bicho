const mongoose = require('mongoose');

const transferItemSchema = new mongoose.Schema({
    product: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product',
        required: true,
    },
    sku: {
        type: String,
        trim: true,
        default: '',
    },
    barcode: {
        type: String,
        trim: true,
        default: '',
    },
    description: {
        type: String,
        trim: true,
        default: '',
    },
    quantity: {
        type: Number,
        required: true,
        min: 0,
    },
    unit: {
        type: String,
        trim: true,
        default: '',
    },
    lot: {
        type: String,
        trim: true,
        default: '',
    },
    validity: {
        type: Date,
        default: null,
    },
    unitWeight: {
        type: Number,
        default: null,
    },
    unitCost: {
        type: Number,
        default: null,
    },
}, { _id: false });

const transportSchema = new mongoose.Schema({
    mode: { type: String, trim: true, default: '' },
    vehicle: { type: String, trim: true, default: '' },
    driver: { type: String, trim: true, default: '' },
}, { _id: false });

const transferSchema = new mongoose.Schema({
    number: {
        type: Number,
        unique: true,
        required: true,
    },
    requestDate: {
        type: Date,
        required: true,
    },
    status: {
        type: String,
        enum: ['solicitada', 'em_separacao', 'aprovada'],
        default: 'solicitada',
        lowercase: true,
        trim: true,
    },
    originCompany: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Store',
        required: true,
    },
    originDeposit: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Deposit',
        required: true,
    },
    destinationCompany: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Store',
        required: true,
    },
    destinationDeposit: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Deposit',
        required: true,
    },
    responsible: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    referenceDocument: {
        type: String,
        trim: true,
        default: '',
    },
    observations: {
        type: String,
        trim: true,
        default: '',
    },
    transport: {
        type: transportSchema,
        default: () => ({}),
    },
    items: {
        type: [transferItemSchema],
        validate: {
            validator(value) {
                return Array.isArray(value) && value.length > 0;
            },
            message: 'Inclua ao menos um item na transferência.',
        },
    },
}, {
    timestamps: true,
});

module.exports = mongoose.model('Transfer', transferSchema);
