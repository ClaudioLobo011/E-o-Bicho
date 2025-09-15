const mongoose = require('mongoose');

const settingSchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true },
    value: { type: mongoose.Schema.Types.Mixed } // Mixed permite guardar qualquer tipo de dado
});

const Setting = mongoose.model('Setting', settingSchema);

module.exports = Setting;