const mongoose = require('mongoose');

const ambientesPermitidos = ['homologacao', 'producao'];
const opcoesImpressao = ['sim', 'nao', 'perguntar'];
const perfisDesconto = ['funcionario', 'gerente', 'admin'];
const tiposEmissao = ['matricial', 'fiscal'];
const tiposUso = ['web', 'executavel'];
const modosTerminais = ['exclusivo', 'espelhado'];
const statusDesktop = ['web', 'configurando', 'ativo', 'suspenso', 'reversao_pendente'];
const largurasPapel = ['80mm', '58mm'];
const tiposImpressora = ['bematech', 'elgin'];

const printerSchema = new mongoose.Schema(
  {
    nome: { type: String, trim: true, default: '' },
    nomesImpressoras: {
      type: [{ type: String, trim: true }],
      default: [],
    },
    vias: {
      type: Number,
      min: [1, 'O número mínimo de vias é 1.'],
      max: [10, 'O número máximo de vias é 10.'],
      default: 1,
    },
    larguraPapel: { type: String, enum: largurasPapel, default: '80mm' },
    tipoImpressora: { type: String, enum: tiposImpressora, default: 'bematech' },
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

const desktopSchema = new mongoose.Schema(
  {
    status: { type: String, enum: statusDesktop, default: 'web' },
    hostId: { type: mongoose.Schema.Types.ObjectId, ref: 'PdvDesktopHost', default: null },
    hostName: { type: String, trim: true, default: '' },
    hostMachineId: { type: String, trim: true, default: '' },
    localDbReady: { type: Boolean, default: false },
    initialSyncCompletedAt: { type: Date, default: null },
    lastHeartbeatAt: { type: Date, default: null },
    pendingEvents: { type: Number, min: 0, default: 0 },
    pendingFiscal: { type: Number, min: 0, default: 0 },
    conversionAt: { type: Date, default: null },
    conversionBy: { type: String, trim: true, default: '' },
    allowedTerminalIds: { type: [{ type: String, trim: true }], default: [] },
    codeRangeSize: { type: Number, min: 100, max: 100000, default: 10000 },
  },
  { _id: false }
);

const estoqueSchema = new mongoose.Schema(
  {
    depositoPadrao: { type: mongoose.Schema.Types.ObjectId, ref: 'Deposit', default: null },
  },
  { _id: false }
);

const financeiroSchema = new mongoose.Schema(
  {
    contaCorrente: { type: mongoose.Schema.Types.ObjectId, ref: 'BankAccount', default: null },
    contaContabilReceber: { type: mongoose.Schema.Types.ObjectId, ref: 'AccountingAccount', default: null },
    contaContabilPagar: { type: mongoose.Schema.Types.ObjectId, ref: 'AccountingAccount', default: null },
  },
  { _id: false }
);

const pdvSchema = new mongoose.Schema(
  {
    codigo: { type: String, required: true, trim: true, unique: true },
    nome: { type: String, required: true, trim: true },
    apelido: { type: String, trim: true },
    ativo: { type: Boolean, default: true },
    tipoUso: { type: String, enum: tiposUso, default: 'web', index: true },
    modoTerminais: { type: String, enum: modosTerminais, default: 'exclusivo' },
    empresa: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true },
    empresaEmitenteFiscal: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Store',
      default: null,
      index: true,
    },
    serieNfe: { type: String, trim: true },
    serieNfce: { type: String, trim: true },
    numeroNfeInicial: {
      type: Number,
      min: [1, 'O número inicial da NF-e deve ser maior ou igual a 1.'],
      default: null,
      validate: {
        validator(value) {
          return value === null || Number.isInteger(value);
        },
        message: 'O número inicial da NF-e deve ser um inteiro válido.',
      },
    },
    numeroNfceInicial: {
      type: Number,
      min: [1, 'O número inicial da NFC-e deve ser maior ou igual a 1.'],
      default: null,
      validate: {
        validator(value) {
          return value === null || Number.isInteger(value);
        },
        message: 'O número inicial da NFC-e deve ser um inteiro válido.',
      },
    },
    numeroNfeAtual: {
      type: Number,
      min: [0, 'O número atual da NF-e deve ser maior ou igual a zero.'],
      default: null,
      validate: {
        validator(value) {
          return value === null || Number.isInteger(value);
        },
        message: 'O número atual da NF-e deve ser um inteiro válido.',
      },
    },
    numeroNfceAtual: {
      type: Number,
      min: [0, 'O número atual da NFC-e deve ser maior ou igual a zero.'],
      default: null,
      validate: {
        validator(value) {
          return value === null || Number.isInteger(value);
        },
        message: 'O número atual da NFC-e deve ser um inteiro válido.',
      },
    },
    ambientesHabilitados: {
      type: [{ type: String, enum: ambientesPermitidos }],
      default: [],
      validate: {
        validator(value) {
          return Array.isArray(value);
        },
        message: 'Os ambientes habilitados devem ser uma lista.',
      },
    },
    ambientePadrao: { type: String, enum: [...ambientesPermitidos, ''], default: '' },
    sincronizacaoAutomatica: { type: Boolean, default: true },
    permitirModoOffline: { type: Boolean, default: false },
    mostrarParaFuncionarios: { type: Boolean, default: true },
    limiteOffline: { type: Number, min: 0, default: null },
    observacoes: { type: String, trim: true },
    ultimaSincronizacao: { type: Date, default: null },
    criadoPor: { type: String, trim: true },
    atualizadoPor: { type: String, trim: true },
    configuracoesImpressao: { type: impressaoSchema, default: () => ({}) },
    configuracoesVenda: { type: vendaSchema, default: () => ({}) },
    configuracoesFiscal: { type: fiscalSchema, default: () => ({}) },
    configuracoesEstoque: { type: estoqueSchema, default: () => ({}) },
    configuracoesFinanceiro: { type: financeiroSchema, default: () => ({}) },
    desktop: { type: desktopSchema, default: () => ({}) },
  },
  {
    timestamps: true,
  }
);

pdvSchema.index({ updatedAt: -1 });
pdvSchema.index({ empresa: 1, updatedAt: -1 });
pdvSchema.index({ empresa: 1, tipoUso: 1, ativo: 1 });

pdvSchema.pre('validate', function normalizeLegacyEmissionMode(next) {
  if (this.configuracoesFiscal?.tipoEmissaoPadrao === 'ambos') {
    this.configuracoesFiscal.tipoEmissaoPadrao = 'fiscal';
  }
  next();
});

module.exports = mongoose.model('Pdv', pdvSchema);
