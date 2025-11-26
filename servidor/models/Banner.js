// Ficheiro: servidor/models/Banner.js

const mongoose = require('mongoose');

const bannerSchema = new mongoose.Schema({
    imageUrl: { type: String, required: true },
    imageDriveFileId: { type: String, default: '' },
    imageDrivePath: { type: String, default: '' },
    mobileImageUrl: { type: String, default: '' },
    mobileImageDriveFileId: { type: String, default: '' },
    mobileImageDrivePath: { type: String, default: '' },
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