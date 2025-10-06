const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// Esta é a "planta" para cada novo utilizador na nossa base de dados.
const userSchema = new Schema({
  // Campo para diferenciar o tipo de conta
  tipoConta: {
    type: String,
    enum: ['pessoa_fisica', 'pessoa_juridica'], // Só aceita um destes dois valores
    required: true
  },

  // --- Campos Comuns ---
  email: {
    type: String,
    required: true,
    unique: true, // Garante que não haja dois emails iguais na base de dados
    trim: true,   // Remove espaços em branco desnecessários
    lowercase: true // Guarda sempre o email em minúsculas
  },
  senha: {
    type: String,
    required: true
  },
  celular: {
    type: String,
    required: true,
    unique: true,
    sparse: true
  },
  telefone: {
    type: String // Opcional
  },

  // Dados adicionais comuns a todos os clientes
  codigoCliente: { type: String, trim: true },
  apelido: { type: String, trim: true },
  pais: { type: String, trim: true, default: 'Brasil' },
  celularSecundario: { type: String, trim: true },
  telefoneSecundario: { type: String, trim: true },
  empresaPrincipal: { type: Schema.Types.ObjectId, ref: 'Store' },

  // --- Campos Específicos de Pessoa Física ---
  nomeCompleto: { type: String },
  cpf: { type: String, unique: true, sparse: true },
  genero: { type: String },
  rgEmissao: { type: Date },
  rgNumero: { type: String, trim: true },
  rgOrgaoExpedidor: { type: String, trim: true },
  dataNascimento: { type: Date },
  racaCor: {
    type: String,
    enum: ['nao_informar', 'indigena', 'branco', 'preto', 'amarelo', 'pardo'],
    lowercase: true,
    trim: true,
  },
  deficiencia: {
    type: String,
    enum: ['nao_portador', 'fisica', 'auditiva', 'visual', 'intelectual', 'multipla'],
    lowercase: true,
    trim: true,
  },
  estadoCivil: {
    type: String,
    enum: ['solteiro', 'casado', 'separado', 'viuvo'],
    lowercase: true,
    trim: true,
  },
  periodoExperienciaInicio: { type: Date },
  periodoExperienciaFim: { type: Date },
  dataAdmissao: { type: Date },
  diasProrrogacaoExperiencia: { type: Number, min: 0 },
  exameMedico: { type: Date },
  dataDemissao: { type: Date },
  cargoCarteira: { type: String },
  habilitacaoNumero: { type: String, trim: true },
  habilitacaoCategoria: { type: String, trim: true },
  habilitacaoOrgaoEmissor: { type: String, trim: true },
  habilitacaoValidade: { type: Date },
  nomeMae: { type: String },
  nascimentoMae: { type: Date },
  nomeConjuge: { type: String },
  formaPagamento: {
    type: String,
    enum: ['mensal', 'quinzenal', 'semanal', 'diaria'],
    lowercase: true,
    trim: true,
  },
  tipoContrato: {
    type: String,
    enum: ['clt', 'mei', 'estagiario', 'temporario', 'avulso'],
    lowercase: true,
    trim: true,
  },
  salarioContratual: { type: Number, min: 0 },
  horasSemanais: { type: Number, min: 0 },
  horasMensais: { type: Number, min: 0 },
  passagensPorDia: { type: Number, min: 0 },
  valorPassagem: { type: Number, min: 0 },
  banco: { type: String, trim: true },
  tipoContaBancaria: {
    type: String,
    enum: ['corrente', 'poupanca', 'cartao_salario', 'conta_salario'],
    lowercase: true,
    trim: true,
  },
  agencia: { type: String, trim: true },
  conta: { type: String, trim: true },
  tipoChavePix: {
    type: String,
    enum: ['cpf', 'cnpj', 'email', 'telefone'],
    lowercase: true,
    trim: true,
  },
  chavePix: { type: String, trim: true },
  cursos: [{
    nome: { type: String, trim: true },
    data: { type: Date },
    situacao: {
      type: String,
      enum: ['concluido', 'cursando'],
      lowercase: true,
      trim: true,
    },
    observacao: { type: String, trim: true },
  }],
  horarios: [{
    dia: {
      type: String,
      enum: ['segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado', 'domingo'],
      required: true,
      lowercase: true,
      trim: true,
    },
    tipoJornada: {
      type: String,
      enum: ['jornada', 'escala'],
      lowercase: true,
      trim: true,
    },
    modalidade: {
      type: String,
      enum: [
        'diurna',
        'noturna',
        'integral',
        'parcial',
        'extraordinaria',
        'intermitente',
        'estagio',
        'remota',
        'reduzida',
        '6x1',
        '5x1',
        '12x36',
      ],
      lowercase: true,
      trim: true,
    },
    horaInicio: { type: String, trim: true },
    horaFim: { type: String, trim: true },
    almocoInicio: { type: String, trim: true },
    almocoFim: { type: String, trim: true },
  }],

  // --- Campos Específicos de Pessoa Jurídica ---
  razaoSocial: { type: String },
  cnpj: { type: String, unique: true, sparse: true },
  nomeContato: { type: String },
  nomeFantasia: { type: String },
  inscricaoEstadual: { type: String },
  estadoIE: { type: String },
  isentoIE: { type: Boolean, default: false },

  // --- Campos do Carrinho ---
  cart: [
    {
      product: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product',
        required: true
      },
      quantity: {
        type: Number,
        required: true,
        min: 1,
        default: 1
      },
      isSubscribed: {
        type: Boolean,
        default: false // Por padrão, um item adicionado não é uma assinatura
      },
      subscriptionFrequency: {
        type: Number, // Guardaremos a frequência em dias (ex: 30, 45)
        default: 30   // Um valor padrão de 30 dias
      }
    }
  ],
  
  // --- Favoritos ---
  favorites: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product'
  }],

  // --- Dados de Controlo ---
  criadoEm: {
    type: Date,
    default: Date.now // Define a data de criação automaticamente
  },
  role: {
    type: String,
    enum: ['admin_master', 'admin', 'funcionario', 'cliente'],
    default: 'cliente'
  },

  grupos: {
    type: [String],
    enum: ['gerente','vendedor','esteticista','veterinario'],
    default: []
  },
  empresas: [{
    type: Schema.Types.ObjectId,
    ref: 'Store'
  }],

  emailVerified: { type: Boolean, default: false },
  emailVerificationToken: { type: String },
  emailVerificationExpires: { type: Date },
  passwordResetToken: { type: String },
  passwordResetExpires: { type: Date },

  // --- 2FA (TOTP) ---
  totpEnabled: { type: Boolean, default: false },
  totpSecretEnc: { type: String }, // secreto criptografado (AES-GCM)
  totpTempSecretEnc: { type: String }, // secreto temporário para setup
  totpTempCreatedAt: { type: Date },

  // --- Quick Login por e-mail (OTP curto) ---
  quickEmailCodeHash: { type: String },
  quickEmailCodeExpires: { type: Date },
  quickEmailCodeAttempts: { type: Number, default: 0 },

});

module.exports = mongoose.model('User', userSchema);
