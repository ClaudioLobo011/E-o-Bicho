const mongoose = require('mongoose');

const deliveryZoneSchema = new mongoose.Schema({
    store: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Store',
        required: true
    },
    nome: {
        type: String,
        required: true,
        trim: true
    },
    tipo: {
        type: String,
        enum: ['raio', 'bairro'],
        required: true
    },
    raioKm: {
        type: Number,
        default: 0
    },
    bairros: [{
        type: String
    }],
    gratis: {
        type: Boolean,
        default: false
    }
}, {
    timestamps: true
});

const DeliveryZone = mongoose.model('DeliveryZone', deliveryZoneSchema);

module.exports = DeliveryZone;
