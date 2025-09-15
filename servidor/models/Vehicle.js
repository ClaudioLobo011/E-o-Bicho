const mongoose = require('mongoose');

const vehicleSchema = new mongoose.Schema({
    tipo: { 
        type: String, 
        required: true,
        enum: ['Moto', 'Carro', 'Caminhão'] // Garante que apenas estes valores são aceites
    },
    pesoMax: { type: Number, required: true }, // Em kg
    taxaMin: { type: Number, required: true }, // Taxa de saída
    taxaKm: { type: Number, required: true }  // Custo por KM rodado
}, {
    timestamps: true
});

const Vehicle = mongoose.model('Vehicle', vehicleSchema);

module.exports = Vehicle;