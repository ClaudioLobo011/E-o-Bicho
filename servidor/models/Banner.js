// Ficheiro: servidor/models/Banner.js

const mongoose = require('mongoose');

const bannerSchema = new mongoose.Schema({
    imageUrl: { type: String, required: true },
    mobileImageUrl: { type: String, default: '' },
    title: { type: String, default: '' },
    subtitle: { type: String, default: '' },
    buttonText: { type: String, default: '' },
    link: { type: String, default: '#' },
    order: { type: Number, default: 0 } // Para controlar a ordem de exibição
}, {
    timestamps: true
});

const Banner = mongoose.model('Banner', bannerSchema);

module.exports = Banner;