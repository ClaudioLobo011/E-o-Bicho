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

const fiscalTaxSchema = new mongoose.Schema({
    codigo: { type: String, trim: true, default: '' },
    cst: { type: String, trim: true, default: '' },
    aliquota: { type: Number, default: null },
    tipoCalculo: { type: String, trim: true, default: 'percentual' },
    valorBase: { type: Number, default: null },
}, { _id: false });

const fiscalCfopSchema = new mongoose.Schema({
    dentroEstado: { type: String, trim: true, default: '' },
    foraEstado: { type: String, trim: true, default: '' },
    transferencia: { type: String, trim: true, default: '' },
    devolucao: { type: String, trim: true, default: '' },
    industrializacao: { type: String, trim: true, default: '' },
}, { _id: false });

const fiscalSchema = new mongoose.Schema({
    origem: { type: String, trim: true, default: '0' },
    cest: { type: String, trim: true, default: '' },
    csosn: { type: String, trim: true, default: '' },
    cst: { type: String, trim: true, default: '' },
    cfop: {
        nfe: { type: fiscalCfopSchema, default: () => ({}) },
        nfce: { type: fiscalCfopSchema, default: () => ({}) },
    },
    pis: { type: fiscalTaxSchema, default: () => ({}) },
    cofins: { type: fiscalTaxSchema, default: () => ({}) },
    ipi: {
        cst: { type: String, trim: true, default: '' },
        codigoEnquadramento: { type: String, trim: true, default: '' },
        aliquota: { type: Number, default: null },
        tipoCalculo: { type: String, trim: true, default: 'percentual' },
        valorBase: { type: Number, default: null },
    },
    fcp: {
        indicador: { type: String, trim: true, default: '0' },
        aliquota: { type: Number, default: null },
        aplica: { type: Boolean, default: false },
    },
    status: {
        nfe: { type: String, enum: ['pendente', 'parcial', 'aprovado'], default: 'pendente' },
        nfce: { type: String, enum: ['pendente', 'parcial', 'aprovado'], default: 'pendente' },
    },
    atualizadoEm: { type: Date, default: null },
    atualizadoPor: { type: String, trim: true, default: '' },
}, { _id: false });

const fractionItemSchema = new mongoose.Schema({
    produto: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    quantidadeOrigem: { type: Number, default: 1 },
    quantidadeFracionada: { type: Number, default: 0 },
}, { _id: false });

const fractionSchema = new mongoose.Schema({
    ativo: { type: Boolean, default: false },
    itens: { type: [fractionItemSchema], default: [] },
    custoCalculado: { type: Number, default: null },
    estoqueEquivalente: { type: Number, default: null },
    atualizadoEm: { type: Date, default: null },
}, { _id: false });

const productSchema = new mongoose.Schema({
    cod: { type: String, required: true, unique: true },
    codbarras: { type: String, required: true, unique: true },
    nome: { type: String, required: true },
    descricao: { type: String, required: false, default: '' },
    custo: { type: Number, required: true },
    venda: { type: Number, required: true },
    unidade: { type: String, trim: true, default: '' },
    referencia: { type: String, trim: true, default: '' },
    imagemPrincipal: { type: String, default: '/image/placeholder.svg' },
    imagens: [{ // Um array que guardará os caminhos para as imagens
        type: String
    }],
    driveImages: {
        type: [{
            sequence: { type: String, trim: true, default: '' },
            fileId: { type: String, trim: true, default: '' },
        }],
        default: [],
    },
    driveImagesUpdatedAt: { type: Date, default: null },
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
            documentoFornecedor: { type: String, trim: true, default: '' },
            nomeProdutoFornecedor: { type: String, trim: true, default: '' },
            codigoProduto: { type: String, trim: true },
            unidadeEntrada: { type: String, trim: true },
            tipoCalculo: { type: String, trim: true },
            valorCalculo: { type: Number, default: null }
        }],
        default: []
    },
    fracionado: { type: fractionSchema, default: () => ({}) },
    dataCadastro: { type: Date, default: null },
    dataVigencia: { type: Date, default: null },
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
    naoMostrarNoSite: {
        type: Boolean,
        default: true,
    },
    enviarParaIfood: {
        type: Boolean,
        default: false,
    },
    ifoodIntegratedAt: { type: Date, default: null },
    ifoodLastSyncAt: { type: Date, default: null },
    ifoodActive: { type: Boolean, default: null },
    inativo: {
        type: Boolean,
        default: false
    },
    // Especificações adicionais do produto (opcional)
    especificacoes: {
        idade: { type: [String], default: [] }, // ex.: Filhotes, Adulto, Sênior
        pet: { type: [String], default: [] },   // ex.: Cachorro, Gato, Pássaros, etc.
        porteRaca: { type: [String], default: [] }, // ex.: Mini, Pequeno, Médio, Grande, Gigante
        apresentacao: { type: String, default: '' }
    },
    fiscal: { type: fiscalSchema, default: () => ({}) },
    fiscalPorEmpresa: {
        type: Map,
        of: fiscalSchema,
        default: () => ({}),
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
