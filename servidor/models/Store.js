const mongoose = require('mongoose');

// Schema para um dia de funcionamento
const horarioDiaSchema = new mongoose.Schema({
    abre: { type: String, default: '' },
    fecha: { type: String, default: '' },
    fechada: { type: Boolean, default: false }
}, { _id: false });

const regimeTributarioEnum = ['simples', 'mei', 'normal'];

const storeSchema = new mongoose.Schema({
    codigo: { type: String, trim: true, unique: true, sparse: true },
    nome: { type: String, required: true, trim: true },
    nomeFantasia: { type: String, trim: true },
    razaoSocial: { type: String, trim: true },
    cnpj: { type: String, trim: true },
    cnaePrincipal: { type: String, trim: true },
    cnaePrincipalDescricao: { type: String, trim: true },
    cnaeSecundario: { type: String, trim: true },
    cnaeSecundarioDescricao: { type: String, trim: true },
    cnaesSecundarios: {
        type: [{ type: String, trim: true }],
        default: []
    },
    inscricaoEstadual: { type: String, trim: true },
    inscricaoMunicipal: { type: String, trim: true },
    regimeTributario: { type: String, enum: [...regimeTributarioEnum, ''], default: '' },
    emailFiscal: { type: String, trim: true },
    telefone: { type: String, trim: true },
    whatsapp: { type: String, trim: true },
    imagem: { type: String, default: '/image/placeholder.svg' },
    endereco: { type: String, trim: true },
    cep: { type: String, trim: true },
    municipio: { type: String, trim: true },
    uf: { type: String, trim: true, uppercase: true },
    logradouro: { type: String, trim: true },
    bairro: { type: String, trim: true },
    numero: { type: String, trim: true },
    complemento: { type: String, trim: true },
    codigoIbgeMunicipio: { type: String, trim: true },
    codigoUf: { type: String, trim: true },
    latitude: { type: Number },
    longitude: { type: Number },
    contadorNome: { type: String, trim: true },
    contadorCpf: { type: String, trim: true },
    contadorCrc: { type: String, trim: true },
    contadorCnpj: { type: String, trim: true },
    contadorCep: { type: String, trim: true },
    contadorEndereco: { type: String, trim: true },
    contadorCidade: { type: String, trim: true },
    contadorNumero: { type: String, trim: true },
    contadorBairro: { type: String, trim: true },
    contadorComplemento: { type: String, trim: true },
    contadorRazaoSocial: { type: String, trim: true },
    contadorTelefone: { type: String, trim: true },
    contadorFax: { type: String, trim: true },
    contadorCelular: { type: String, trim: true },
    contadorEmail: { type: String, trim: true },
    certificadoValidade: { type: String, trim: true },
    certificadoArquivoNome: { type: String, trim: true },
    certificadoSenhaCriptografada: { type: String, select: false },
    certificadoArquivoCriptografado: { type: String, select: false },
    certificadoFingerprint: { type: String, trim: true },
    cscIdProducao: { type: String, trim: true },
    cscTokenProducaoCriptografado: { type: String, select: false },
    cscTokenProducaoArmazenado: { type: Boolean, default: false },
    cscIdHomologacao: { type: String, trim: true },
    cscTokenHomologacaoCriptografado: { type: String, select: false },
    cscTokenHomologacaoArmazenado: { type: Boolean, default: false },
    horario: {
        domingo: { type: horarioDiaSchema, default: () => ({}) },
        segunda: { type: horarioDiaSchema, default: () => ({}) },
        terca: { type: horarioDiaSchema, default: () => ({}) },
        quarta: { type: horarioDiaSchema, default: () => ({}) },
        quinta: { type: horarioDiaSchema, default: () => ({}) },
        sexta: { type: horarioDiaSchema, default: () => ({}) },
        sabado: { type: horarioDiaSchema, default: () => ({}) }
    },
    servicos: {
        type: [{
            type: String,
            trim: true
        }],
        default: []
    }
}, {
    timestamps: true
});

const Store = mongoose.model('Store', storeSchema);

module.exports = Store;
