const mongoose = require('mongoose');

// Schema para um dia de funcionamento
const horarioDiaSchema = new mongoose.Schema({
    abre: { type: String, default: '' },
    fecha: { type: String, default: '' },
    fechada: { type: Boolean, default: false }
}, { _id: false });

const storeSchema = new mongoose.Schema({
    nome: { type: String, required: true },
    imagem: { type: String, default: '/image/placeholder.png' },
    endereco: { type: String, required: true },
    cep: { type: String },
    latitude: { type: Number },
    longitude: { type: Number },
    telefone: { type: String },
    whatsapp: { type: String },
    // O campo 'horario' agora é um objeto estruturado
    horario: {
        domingo: horarioDiaSchema,
        segunda: horarioDiaSchema,
        terca: horarioDiaSchema,
        quarta: horarioDiaSchema,
        quinta: horarioDiaSchema,
        sexta: horarioDiaSchema,
        sabado: horarioDiaSchema
    },
    servicos: [{
        type: String
    }]
}, {
    timestamps: true
});

const Store = mongoose.model('Store', storeSchema);

module.exports = Store;