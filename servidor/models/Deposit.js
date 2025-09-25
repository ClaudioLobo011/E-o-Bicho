const mongoose = require('mongoose');

const depositSchema = new mongoose.Schema({
    codigo: {
        type: String,
        required: true,
        trim: true,
        unique: true,
    },
    nome: {
        type: String,
        required: true,
        trim: true,
    },
    empresa: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Store',
        required: true,
    },
}, {
    timestamps: true,
});

const Deposit = mongoose.model('Deposit', depositSchema);

module.exports = Deposit;
