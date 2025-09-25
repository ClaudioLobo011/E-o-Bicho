const mongoose = require('mongoose');

// Função auxiliar para remover acentos e normalizar o texto
const normalizeText = (text) => {
    if (!text) return '';
    return text
        .toString()
        .toLowerCase()
        .normalize("NFD") // Decompõe os acentos dos caracteres
        .replace(/[\u0300-\u036f]/g, ""); // Remove os acentos
};

const productSchema = new mongoose.Schema({
    cod: { type: String, required: true, unique: true },
    codbarras: { type: String, required: true, unique: true },
    nome: { type: String, required: true },
    descricao: { type: String, required: false, default: '' },
    custo: { type: Number, required: true },
    venda: { type: Number, required: true },
    unidade: { type: String, trim: true, default: '' },
    referencia: { type: String, trim: true, default: '' },
    imagemPrincipal: { type: String, default: '/image/placeholder.png' },
    imagens: [{ // Um array que guardará os caminhos para as imagens
        type: String
    }],
    codigosComplementares: {
        type: [String],
        default: []
    },
    stock: { type: Number, required: false, default: 0 },
    estoques: {
        type: [{
            deposito: { type: mongoose.Schema.Types.ObjectId, ref: 'Deposit', required: true },
            quantidade: { type: Number, default: 0 },
            unidade: { type: String, trim: true, default: '' }
        }],
        default: []
    },
    categorias: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Category'
    }],
    marca: { type: String, required: false },
    fornecedores: {
        type: [{
            fornecedor: { type: String, trim: true, required: true },
            codigoProduto: { type: String, trim: true },
            unidadeEntrada: { type: String, trim: true },
            tipoCalculo: { type: String, trim: true },
            valorCalculo: { type: Number, default: null }
        }],
        default: []
    },
    dataCadastro: { type: Date, default: null },
    peso: { type: Number, default: null },
    iat: { type: String, trim: true, default: '' },
    tipoProduto: { type: String, trim: true, default: '' },
    ncm: { type: String, trim: true, default: '' },
    searchableString: { type: String, select: false },
    isDestaque: { // Para saber se o produto é um destaque ou não
        type: Boolean,
        default: false
    },
    destaqueOrder: { // Para definir a ordem de exibição dos destaques
        type: Number,
        default: 0
    },
    precoClube: {
        type: Number,
        default: null // Por padrão, não há preço de clube
    },
    promocao: {
        ativa: { type: Boolean, default: false },
        porcentagem: { type: Number, default: 0 }
    },
    promocaoCondicional: {
        ativa: { type: Boolean, default: false },
        tipo: { type: String, enum: ['leve_pague', 'acima_de', null], default: null },
        
        // Campos para a promoção 'Leve e Pague'
        leve: { type: Number, default: 0 },
        pague: { type: Number, default: 0 },
        
        // Campos para a promoção 'Acima de'
        quantidadeMinima: { type: Number, default: 0 },
        descontoPorcentagem: { type: Number, default: 0 }
    },
    // Especificações adicionais do produto (opcional)
    especificacoes: {
        idade: { type: [String], default: [] }, // ex.: Filhotes, Adulto, Sênior
        pet: { type: [String], default: [] },   // ex.: Cachorro, Gato, Pássaros, etc.
        porteRaca: { type: [String], default: [] }, // ex.: Mini, Pequeno, Médio, Grande, Gigante
        apresentacao: { type: String, default: '' }
    }

}, {
    timestamps: true
});

// Middleware do Mongoose: é executado ANTES de salvar qualquer produto
productSchema.pre('save', function(next) {
    if (Array.isArray(this.estoques) && this.estoques.length > 0) {
        const total = this.estoques.reduce((acc, item) => {
            const quantidade = Number(item?.quantidade);
            return acc + (Number.isFinite(quantidade) ? quantidade : 0);
        }, 0);
        this.stock = Number.isFinite(total) ? total : this.stock;
    }
    // Cria a string de pesquisa normalizada a partir dos campos relevantes
    this.searchableString = normalizeText(
        `${this.nome} ${this.cod} ${this.marca} ${this.codbarras}`
    );
    next();
});

const Product = mongoose.model('Product', productSchema);

module.exports = Product;
