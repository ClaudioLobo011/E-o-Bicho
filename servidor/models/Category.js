const mongoose = require('mongoose');

const categorySchema = new mongoose.Schema({
    nome: {
        type: String,
        required: true,
        trim: true
    },
    // Este campo guarda o ID da categoria pai.
    // Se for null, é uma categoria de nível superior (como "Cachorro", "Gato").
    parent: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Category', // 'ref' diz ao Mongoose que este ID refere-se a outro documento na mesma coleção 'Category'.
        default: null
    }
}, {
    timestamps: true
});

// Garante que a combinação de nome e pai seja única, evitando categorias duplicadas no mesmo nível.
categorySchema.index({ nome: 1, parent: 1 }, { unique: true });

const Category = mongoose.model('Category', categorySchema);

module.exports = Category;