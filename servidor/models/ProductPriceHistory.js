const mongoose = require('mongoose');

const { Schema } = mongoose;

const productPriceHistorySchema = new Schema({
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    cod: { type: String, trim: true, required: true },
    descricao: { type: String, trim: true, required: true },
    campo: { type: String, trim: true, required: true },
    campoChave: { type: String, trim: true, required: true },
    valorAnterior: { type: Number, default: null },
    valorNovo: { type: Number, default: null },
    tela: { type: String, trim: true, required: true },
    autorId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    autorNome: { type: String, trim: true, default: '' },
    autorEmail: { type: String, trim: true, default: '' },
    dataAlteracao: { type: Date, default: Date.now, index: true },
}, {
    versionKey: false,
});

productPriceHistorySchema.index({ product: 1, dataAlteracao: -1 });

module.exports = mongoose.model('ProductPriceHistory', productPriceHistorySchema);
