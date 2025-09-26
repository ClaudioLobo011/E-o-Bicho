const mongoose = require('mongoose');

const ambientesPermitidos = ['homologacao', 'producao'];
const opcoesImpressao = ['sim', 'nao', 'perguntar'];
const perfisDesconto = ['funcionario', 'gerente', 'admin'];
const tiposEmissao = ['matricial', 'fiscal', 'ambos'];

const printerSchema = new mongoose.Schema(
  {
    nome: { type: String, trim: true, default: '' },
    vias: {
      type: Number,
      min: [1, 'O número mínimo de vias é 1.'],
      max: [10, 'O número máximo de vias é 10.'],
      default: 1,
    },
  },
  { _id: false }
);

const impressaoSchema = new mongoose.Schema(
  {
    sempreImprimir: { type: String, enum: opcoesImpressao, default: 'perguntar' },
    impressoraVenda: { type: printerSchema, default: undefined },
    impressoraOrcamento: { type: printerSchema, default: undefined },
    impressoraContasReceber: { type: printerSchema, default: undefined },
    impressoraCaixa: { type: printerSchema, default: undefined },
  },
  { _id: false }
);

const vendaSchema = new mongoose.Schema(
  {
    permitirDesconto: {
      type: [{ type: String, enum: perfisDesconto }],
      default: [],
    },
  },
  { _id: false }
);

const fiscalSchema = new mongoose.Schema(
  {
    tipoEmissaoPadrao: { type: String, enum: tiposEmissao, default: 'fiscal' },
  },
  { _id: false }
);

const estoqueSchema = new mongoose.Schema(
  {
    depositoPadrao: { type: mongoose.Schema.Types.ObjectId, ref: 'Deposit', default: null },
  },
  { _id: false }
);

const pdvSchema = new mongoose.Schema(
  {
    codigo: { type: String, required: true, trim: true, unique: true },
    nome: { type: String, required: true, trim: true },
    apelido: { type: String, trim: true },
    ativo: { type: Boolean, default: true },
    empresa: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true },
    serieNfe: { type: String, trim: true },
    serieNfce: { type: String, trim: true },
    ambientesHabilitados: {
      type: [{ type: String, enum: ambientesPermitidos }],
      default: ['homologacao'],
      validate: {
        validator(value) {
          return Array.isArray(value) && value.length > 0;
        },
        message: 'Informe ao menos um ambiente habilitado.',
      },
    },
    ambientePadrao: { type: String, enum: ambientesPermitidos, default: 'homologacao' },
    sincronizacaoAutomatica: { type: Boolean, default: true },
    permitirModoOffline: { type: Boolean, default: false },
    limiteOffline: { type: Number, min: 0, default: null },
    observacoes: { type: String, trim: true },
    ultimaSincronizacao: { type: Date, default: null },
    criadoPor: { type: String, trim: true },
    atualizadoPor: { type: String, trim: true },
    configuracoesImpressao: { type: impressaoSchema, default: () => ({}) },
    configuracoesVenda: { type: vendaSchema, default: () => ({}) },
    configuracoesFiscal: { type: fiscalSchema, default: () => ({}) },
    configuracoesEstoque: { type: estoqueSchema, default: () => ({}) },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Pdv', pdvSchema);
