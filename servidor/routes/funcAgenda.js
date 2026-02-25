const express = require('express');
const router = express.Router();

const mongoose = require('mongoose');
const authMiddleware = require('../middlewares/authMiddleware');
const authorizeRoles = require('../middlewares/authorizeRoles');

const User = require('../models/User');
const Pet = require('../models/Pet');
const Service = require('../models/Service');
const Appointment = require('../models/Appointment');
const UserAddress = require('../models/UserAddress');
const Store = require('../models/Store');
const bcrypt = require('bcryptjs');
const { randomBytes } = require('crypto');

const requireStaff = authorizeRoles('funcionario', 'franqueado', 'franqueador', 'admin', 'admin_master');
const MAX_CODIGO_CLIENTE_SEQUENCIAL = 999999999;

function escapeRegex(s) { return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function userDisplayName(u) { return u?.nomeCompleto || u?.nomeContato || u?.razaoSocial || u?.email; }

function onlyDigits(value = '') {
  return String(value || '').replace(/\D/g, '');
}

function sanitizeString(value = '') {
  if (typeof value !== 'string') return '';
  return value.trim();
}

function sanitizeEmail(value = '') {
  return sanitizeString(value).toLowerCase();
}

function isGeneratedCustomerEmail(value = '') {
  const email = sanitizeEmail(value);
  return /@(eobicho\.local)$/i.test(email) && /^(importacao\.clientes\+|cadastro\.clientes\+)/i.test(email);
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function normalizeTipoConta(value, fallback = 'pessoa_fisica') {
  const raw = String(value || '').toLowerCase();
  if (raw === 'pessoa_juridica' || raw === 'juridica' || raw === 'pj') return 'pessoa_juridica';
  return 'pessoa_fisica';
}

async function ensureEmpresaExists(empresaId) {
  if (!empresaId) return null;
  if (!mongoose.Types.ObjectId.isValid(empresaId)) return null;
  const store = await Store.findById(empresaId).select('_id nome').lean();
  return store ? store._id : null;
}

function sanitizeTelefone(value = '') {
  const digits = onlyDigits(value);
  return digits || '';
}

function formatCep(value = '') {
  const digits = onlyDigits(value).slice(0, 8);
  if (digits.length <= 5) return digits;
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
}

function sanitizeCpf(value = '') {
  const digits = onlyDigits(value);
  if (!digits) return '';
  return digits.padStart(11, '0').slice(-11);
}

function sanitizeCnpj(value = '') {
  const digits = onlyDigits(value);
  if (!digits) return '';
  return digits.padStart(14, '0').slice(-14);
}

function parseNumber(value, fallback = 0) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : fallback;
  }
  if (typeof value === 'string') {
    const cleaned = value
      .trim()
      .replace(/\s+/g, '')
      .replace(/\.(?=\d{3}(?:\D|$))/g, '')
      .replace(',', '.')
      .replace(/[^\d.-]/g, '')
      .replace(/(?!^)-/g, '');
    if (!cleaned || cleaned === '-' || cleaned === '.') return fallback;
    const parsed = Number.parseFloat(cleaned);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function parseBooleanFlag(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return false;
    return ['1', 'true', 'sim', 'yes', 'on'].includes(normalized);
  }
  return false;
}

function parseCodigoCliente(raw) {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const code = Math.trunc(raw);
    if (code >= 1 && code <= MAX_CODIGO_CLIENTE_SEQUENCIAL) return code;
    return null;
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    if (!/^[\d.\-\/\s]+$/.test(trimmed)) return null;
    const digits = trimmed.replace(/\D/g, '');
    if (!digits) return null;
    const parsed = Number.parseInt(digits, 10);
    if (!Number.isFinite(parsed)) return null;
    if (parsed < 1 || parsed > MAX_CODIGO_CLIENTE_SEQUENCIAL) return null;
    return parsed;
  }
  return null;
}

function parseCodigoPet(raw) {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    return Math.trunc(raw);
  }
  if (typeof raw === 'string') {
    const digits = raw.trim().replace(/\D/g, '');
    if (!digits) return null;
    const parsed = Number.parseInt(digits, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return null;
}

async function obterMaiorCodigoCliente() {
  const candidatos = await User.find({ codigoCliente: { $exists: true } })
    .select('codigoCliente')
    .sort({ codigoCliente: -1 })
    .limit(5)
    .lean();

  return candidatos.reduce((maior, doc) => {
    const parsed = parseCodigoCliente(doc?.codigoCliente);
    if (parsed && parsed > maior) return parsed;
    return maior;
  }, 0);
}

async function atribuirCodigosParaClientesSemCodigo() {
  const semCodigo = await User.find({
    $or: [
      { codigoCliente: { $exists: false } },
      { codigoCliente: null },
      { codigoCliente: '' },
    ],
  })
    .select('_id criadoEm codigoCliente')
    .lean();

  const comCodigoInvalido = await User.find({ codigoCliente: { $exists: true, $ne: null, $ne: '' } })
    .select('_id criadoEm codigoCliente')
    .lean();

  const pendentes = [
    ...semCodigo,
    ...comCodigoInvalido.filter((doc) => !parseCodigoCliente(doc.codigoCliente)),
  ].sort((a, b) => {
    const aDate = a.criadoEm ? new Date(a.criadoEm).getTime() : 0;
    const bDate = b.criadoEm ? new Date(b.criadoEm).getTime() : 0;
    return aDate - bDate;
  });

  if (!pendentes.length) return;

  let ultimoCodigo = await obterMaiorCodigoCliente();
  const ops = pendentes.map((doc) => {
    ultimoCodigo += 1;
    return {
      updateOne: {
        filter: { _id: doc._id },
        update: { $set: { codigoCliente: ultimoCodigo } },
      },
    };
  });

  if (ops.length) {
    await User.bulkWrite(ops);
  }
}

async function gerarCodigoClienteSequencial() {
  const maior = await obterMaiorCodigoCliente();
  return maior + 1;
}

async function obterMaiorCodigoPet() {
  const candidatos = await Pet.find({ codigoPet: { $exists: true } })
    .select('codigoPet')
    .sort({ codigoPet: -1 })
    .limit(5)
    .lean();

  return candidatos.reduce((maior, doc) => {
    const parsed = parseCodigoPet(doc?.codigoPet);
    if (parsed && parsed > maior) return parsed;
    return maior;
  }, 0);
}

async function atribuirCodigosParaPetsSemCodigo(ownerId = null) {
  const filter = ownerId ? { owner: ownerId } : {};

  const semCodigo = await Pet.find({
    $and: [
      filter,
      {
        $or: [
          { codigoPet: { $exists: false } },
          { codigoPet: null },
          { codigoPet: '' },
        ],
      },
    ],
  })
    .select('_id createdAt codigoPet owner')
    .lean();

  const comCodigoInvalido = await Pet.find({
    $and: [
      filter,
      { codigoPet: { $exists: true, $ne: null, $ne: '' } },
    ],
  })
    .select('_id createdAt codigoPet owner')
    .lean();

  const pendentes = [
    ...semCodigo,
    ...comCodigoInvalido.filter((doc) => !parseCodigoPet(doc.codigoPet)),
  ].sort((a, b) => {
    const aDate = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const bDate = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return aDate - bDate;
  });

  if (!pendentes.length) return;

  let ultimoCodigo = await obterMaiorCodigoPet();
  const ops = pendentes.map((doc) => {
    ultimoCodigo += 1;
    return {
      updateOne: {
        filter: { _id: doc._id },
        update: { $set: { codigoPet: ultimoCodigo } },
      },
    };
  });

  if (ops.length) {
    await Pet.bulkWrite(ops);
  }
}

async function gerarCodigoPetSequencial() {
  const maior = await obterMaiorCodigoPet();
  return maior + 1;
}

function mapPetDoc(doc) {
  const plain = doc?.toObject ? doc.toObject() : doc;
  const parsed = parseCodigoPet(plain?.codigoPet);
  return {
    _id: plain?._id,
    nome: plain?.nome,
    tipo: plain?.tipo,
    raca: plain?.raca,
    porte: plain?.porte,
    sexo: plain?.sexo,
    dataNascimento: plain?.dataNascimento,
    microchip: plain?.microchip,
    pelagemCor: plain?.pelagemCor,
    rga: plain?.rga,
    peso: plain?.peso,
    obito: plain?.obito,
    castrado: plain?.castrado,
    codAntigoPet: plain?.codAntigoPet || '',
    codigoPet: parsed || null,
    codigo: parsed ? String(parsed) : null,
    owner: plain?.owner,
  };
}

async function buildClientePayload(body = {}, opts = {}) {
  const { isUpdate = false, currentUser = null } = opts;
  const tipoConta = normalizeTipoConta(body.tipoConta || currentUser?.tipoConta);

  const emailFromBody = sanitizeEmail(body.email || '');
  const emailFromCurrent = sanitizeEmail(currentUser?.email || '');
  let email = emailFromBody || emailFromCurrent;
  if (!email) {
    email = buildCadastroFallbackEmail(`${Date.now()}-${randomBytes(3).toString('hex')}`);
  }

  const celular = sanitizeTelefone(body.celular || currentUser?.celular || '');
  if (!celular) throw new Error('Celular é obrigatório.');

  const telefone = sanitizeTelefone(body.telefone);
  const celular2 = sanitizeTelefone(body.celular2 || body.celularSecundario);
  const telefone2 = sanitizeTelefone(body.telefone2 || body.telefoneSecundario);

  const pais = sanitizeString(body.pais || currentUser?.pais || 'Brasil') || 'Brasil';
  const apelido = sanitizeString(body.apelido || (tipoConta === 'pessoa_fisica' ? currentUser?.apelido : currentUser?.nomeFantasia) || '');
  const codigoAntigo = sanitizeString(body.codigoAntigo || currentUser?.codigoAntigo || '');

  const empresaPrincipal = await ensureEmpresaExists(body.empresaId || body.empresa || body.empresaPrincipal || currentUser?.empresaPrincipal);

  const payload = {
    tipoConta,
    email,
    celular,
    telefone: telefone || '',
    telefoneSecundario: telefone2 || '',
    celularSecundario: celular2 || '',
    pais,
    apelido,
    codigoAntigo,
  };

  if (Object.prototype.hasOwnProperty.call(body, 'limiteCredito')) {
    payload.limiteCredito = parseNumber(body.limiteCredito, currentUser?.limiteCredito || 0);
  } else if (!isUpdate && typeof payload.limiteCredito === 'undefined') {
    payload.limiteCredito = 0;
  }

  if (empresaPrincipal) {
    payload.empresaPrincipal = empresaPrincipal;
    payload.empresas = [empresaPrincipal];
  } else if (!isUpdate) {
    payload.empresas = [];
    payload.empresaPrincipal = undefined;
  }

  if (tipoConta === 'pessoa_fisica') {
    const nomeCompleto = sanitizeString(body.nome || body.nomeCompleto);
    if (!nomeCompleto && !currentUser?.nomeCompleto) {
      throw new Error('Nome do cliente é obrigatório.');
    }
    const cpf = sanitizeCpf(body.cpf || currentUser?.cpf);
    if (!cpf && !isUpdate) {
      throw new Error('CPF é obrigatório para pessoa física.');
    }
    payload.nomeCompleto = nomeCompleto || currentUser?.nomeCompleto || '';
    payload.cpf = cpf || '';
    payload.genero = sanitizeString(body.sexo || body.genero || currentUser?.genero || '');
    const dataNascimento = parseDate(body.nascimento || body.dataNascimento);
    if (dataNascimento) payload.dataNascimento = dataNascimento;
    payload.rgNumero = sanitizeString(body.rg || body.rgNumero || currentUser?.rgNumero || '');
  } else {
    const razaoSocial = sanitizeString(body.razaoSocial || currentUser?.razaoSocial || '');
    if (!razaoSocial) {
      throw new Error('Razão Social é obrigatória para pessoa jurídica.');
    }
    payload.razaoSocial = razaoSocial;
    payload.nomeFantasia = sanitizeString(body.nomeFantasia || currentUser?.nomeFantasia || '');
    payload.nomeContato = sanitizeString(body.nomeContato || currentUser?.nomeContato || '');
    const cnpj = sanitizeCnpj(body.cnpj || currentUser?.cnpj);
    if (cnpj) {
      payload.cnpj = cnpj;
    } else if (!isUpdate) {
      payload.cnpj = '';
    }
    let inscricaoEstadual = sanitizeString(body.inscricaoEstadual || currentUser?.inscricaoEstadual || '');
    const isento = body.isentoIE === true || body.isentoIE === 'true' || body.isentoIE === 'on';
    if (isento) {
      inscricaoEstadual = 'ISENTO';
    }
    payload.inscricaoEstadual = inscricaoEstadual;
    payload.isentoIE = !!isento;
    payload.estadoIE = sanitizeString(body.estadoIE || currentUser?.estadoIE || '');
  }

  return payload;
}

function normalizeImportText(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function parseImportBirthDate(value) {
  const raw = sanitizeString(value);
  if (!raw) return '';

  const brMatch = raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (brMatch) {
    const day = brMatch[1].padStart(2, '0');
    const month = brMatch[2].padStart(2, '0');
    const year = brMatch[3];
    return `${year}-${month}-${day}`;
  }

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

function normalizePhoneWithDdd(dddValue, phoneValue) {
  let digits = onlyDigits(phoneValue);
  if (!digits) return '';

  if (digits.startsWith('55') && digits.length > 11) {
    digits = digits.slice(2);
  }

  if (digits.length > 11) {
    digits = digits.slice(-11);
  }

  if (digits.length === 8 || digits.length === 9) {
    const ddd = onlyDigits(dddValue).slice(-2) || '21';
    digits = `${ddd}${digits}`;
  }

  if (digits.length < 10) return '';
  if (digits.length > 11) return digits.slice(-11);
  return digits;
}

function classifyPhoneNumber(phoneDigits) {
  if (!phoneDigits) return '';
  if (phoneDigits.length === 11) return 'celular';
  if (phoneDigits.length === 10) return 'telefone';
  return '';
}

function collectImportPhones(row = {}) {
  const rawCandidates = [
    { source: 'celular', value: normalizePhoneWithDdd('', row.celular) },
    { source: 'fone1', value: normalizePhoneWithDdd(row.ddd1, row.fone) },
    { source: 'fone2', value: normalizePhoneWithDdd(row.ddd2, row.fone2) },
  ];

  const dedupSet = new Set();
  const candidates = rawCandidates
    .filter((entry) => entry.value)
    .filter((entry) => {
      if (dedupSet.has(entry.value)) return false;
      dedupSet.add(entry.value);
      return true;
    })
    .map((entry) => ({ ...entry, type: classifyPhoneNumber(entry.value) }))
    .filter((entry) => entry.type);

  const mobiles = candidates.filter((entry) => entry.type === 'celular');
  const landlines = candidates.filter((entry) => entry.type === 'telefone');

  const sortByPriority = (list, priorityMap) => {
    return list.slice().sort((a, b) => {
      const pa = priorityMap[a.source] ?? 99;
      const pb = priorityMap[b.source] ?? 99;
      return pa - pb;
    });
  };

  const mobilePriority = { celular: 1, fone1: 2, fone2: 3 };
  const landlinePriority = { fone1: 1, fone2: 2, celular: 3 };

  const sortedMobiles = sortByPriority(mobiles, mobilePriority);
  const sortedLandlines = sortByPriority(landlines, landlinePriority);

  const celular = sortedMobiles[0]?.value || '';
  const telefone = sortedLandlines[0]?.value || '';
  const celular2 = sortedMobiles[1]?.value || '';
  const telefone2 = sortedLandlines[1]?.value || '';

  return { celular, celular2, telefone, telefone2 };
}

function detectTipoContaForImport(tipoValue, documentoDigits) {
  const normalizedTipo = normalizeImportText(tipoValue);
  if (normalizedTipo.includes('jurid') || normalizedTipo === 'pj') return 'pessoa_juridica';
  if (normalizedTipo.includes('fis') || normalizedTipo === 'pf') return 'pessoa_fisica';
  return documentoDigits.length > 11 ? 'pessoa_juridica' : 'pessoa_fisica';
}

function parseImportSexo(value) {
  const normalized = normalizeImportText(value);
  if (!normalized) return '';
  if (normalized === 'm' || normalized.startsWith('masc')) return 'masculino';
  if (normalized === 'f' || normalized.startsWith('fem')) return 'feminino';
  return '';
}

function buildStoreNameIndex(stores = []) {
  const index = new Map();
  stores.forEach((store) => {
    const keys = [store?.nome, store?.nomeFantasia, store?.razaoSocial];
    keys.forEach((key) => {
      const normalized = normalizeImportText(key);
      if (normalized && !index.has(normalized)) {
        index.set(normalized, String(store._id));
      }
    });
  });
  return index;
}

function buildFallbackEmail(seed) {
  return `importacao.clientes+${seed}@eobicho.local`;
}

function buildCadastroFallbackEmail(seed) {
  return `cadastro.clientes+${seed}@eobicho.local`;
}

function buildFallbackCellular(seed) {
  const suffix = String(100000000 + (seed % 900000000)).slice(-9);
  return `99${suffix}`;
}

function normalizePetImportType(value) {
  const normalized = normalizeImportText(value);
  if (!normalized) return 'outro';
  if (normalized === 'cao' || normalized === 'cachorro' || normalized.includes('canin')) return 'cachorro';
  if (normalized === 'gato' || normalized.includes('felin')) return 'gato';
  if (normalized === 'passaro' || normalized === 'ave') return 'passaro';
  if (normalized === 'peixe') return 'peixe';
  if (normalized === 'roedor') return 'roedor';
  if (normalized === 'lagarto') return 'lagarto';
  if (normalized === 'tartaruga') return 'tartaruga';
  return normalized;
}

function normalizePetImportSex(value) {
  const normalized = normalizeImportText(value);
  if (!normalized) return '';
  if (normalized === 'm' || normalized.startsWith('mach')) return 'macho';
  if (normalized === 'f' || normalized.startsWith('fem')) return 'femea';
  return normalized;
}

function parseImportWeight(value) {
  const raw = sanitizeString(value);
  if (!raw) return '';
  const parsed = parseNumber(raw, NaN);
  if (!Number.isFinite(parsed)) return raw;
  return parsed.toFixed(3);
}

function buildCodigoAntigoIndex(users = []) {
  const index = new Map();
  users.forEach((user) => {
    const codigoAntigo = sanitizeString(user?.codigoAntigo);
    if (!codigoAntigo) return;
    const keyText = normalizeImportText(codigoAntigo);
    if (keyText && !index.has(keyText)) {
      index.set(keyText, String(user._id));
    }
    const keyDigits = onlyDigits(codigoAntigo);
    if (keyDigits && !index.has(keyDigits)) {
      index.set(keyDigits, String(user._id));
    }
  });
  return index;
}

async function ensureClienteEhEditavel(user) {
  if (!user) {
    throw new Error('Cliente não encontrado.');
  }
  return user;
}

function mapAddressDoc(doc) {
  if (!doc) return null;
  const codIbge = sanitizeString(doc.codIbgeMunicipio || doc.ibge || '');
  return {
    _id: doc._id,
    apelido: sanitizeString(doc.apelido || ''),
    cep: formatCep(doc.cep || ''),
    logradouro: sanitizeString(doc.logradouro || ''),
    numero: sanitizeString(doc.numero || ''),
    complemento: sanitizeString(doc.complemento || ''),
    bairro: sanitizeString(doc.bairro || ''),
    cidade: sanitizeString(doc.cidade || ''),
    uf: sanitizeString(doc.uf || '').toUpperCase(),
    ibge: codIbge,
    codIbgeMunicipio: codIbge,
    codUf: sanitizeString(doc.codUf || ''),
    pais: sanitizeString(doc.pais || 'Brasil') || 'Brasil',
    isDefault: !!doc.isDefault,
  };
}

function buildAddressLabel(address) {
  if (!address || typeof address !== 'object') return '';
  const logradouro = sanitizeString(address.logradouro || address.endereco || '');
  const numero = sanitizeString(address.numero || '');
  const complemento = sanitizeString(address.complemento || '');
  const bairro = sanitizeString(address.bairro || '');
  const cidade = sanitizeString(address.cidade || address.municipio || '');
  const uf = sanitizeString(address.uf || address.estado || '').toUpperCase();
  const cep = formatCep(address.cep || '');

  const firstLine = [logradouro, numero].filter(Boolean).join(', ');
  const cityLine = cidade && uf ? `${cidade} - ${uf}` : (cidade || uf);
  const parts = [firstLine, complemento, bairro, cityLine];
  if (cep) parts.push(`CEP: ${cep}`);
  return parts.filter(Boolean).join(' - ');
}

function extractAllowedStaffTypes(serviceDoc) {
  if (!serviceDoc) return [];
  const raw = [];
  if (Array.isArray(serviceDoc.tiposPermitidos)) raw.push(...serviceDoc.tiposPermitidos);
  if (serviceDoc.grupo && Array.isArray(serviceDoc.grupo.tiposPermitidos)) {
    raw.push(...serviceDoc.grupo.tiposPermitidos);
  }
  return [...new Set(raw.map(v => String(v || '').trim()).filter(Boolean))];
}

const SERVICE_STATUS_VALUES = ['agendado', 'em_espera', 'em_atendimento', 'finalizado'];

function pad2(value) {
  return String(value).padStart(2, '0');
}

function normalizeServiceStatus(raw, fallback = 'agendado') {
  if (!raw) return fallback;
  const key = String(raw)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .trim().toLowerCase()
    .replace(/[-\s]+/g, '_');
  return SERVICE_STATUS_VALUES.includes(key) ? key : fallback;
}

function formatProfessionalName(profDoc) {
  if (!profDoc) return null;
  if (typeof profDoc === 'string') return profDoc;
  if (typeof profDoc !== 'object') return null;
  return (
    profDoc.nomeCompleto
    || profDoc.nomeContato
    || profDoc.razaoSocial
    || null
  );
}

function normalizeHourString(raw) {
  if (!raw) return null;
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return `${pad2(raw.getHours())}:${pad2(raw.getMinutes())}`;
  }
  const str = String(raw).trim();
  if (!str) return null;
  const direct = str.match(/^(\d{2}):(\d{2})$/);
  if (direct) {
    return `${direct[1]}:${direct[2]}`;
  }
  const parsed = new Date(str);
  if (!Number.isNaN(parsed.getTime())) {
    return `${pad2(parsed.getHours())}:${pad2(parsed.getMinutes())}`;
  }
  return null;
}

function mapServiceItemResponse(item) {
  if (!item) return null;
  const serviceId = item.servico?._id || item.servico || null;
  const valor = Number(item.valor || 0);
  const categorias = Array.isArray(item.servico?.categorias)
    ? item.servico.categorias.filter(Boolean)
    : [];
  const tiposPermitidos = extractAllowedStaffTypes(item.servico || {});
  const profDoc = item.profissional || null;
  const profissionalId = profDoc?._id || (typeof profDoc === 'string' ? profDoc : null);
  const horaRaw = typeof item.hora === 'string' ? item.hora.trim() : '';
  const observacaoRaw = typeof item.observacao === 'string'
    ? item.observacao.trim()
    : (typeof item.observacoes === 'string' ? item.observacoes.trim() : '');
  const statusRaw = normalizeServiceStatus(item.status, null);
  return {
    itemId: item._id || null,
    _id: serviceId,
    nome: item.servico?.nome || item.nome || '—',
    valor,
    categorias,
    tiposPermitidos,
    profissionalId,
    profissionalNome: formatProfessionalName(profDoc) || null,
    hora: horaRaw,
    status: statusRaw || normalizeServiceStatus(null),
    observacao: typeof observacaoRaw === 'string' ? observacaoRaw : '',
  };
}

function mapAppointmentCustomer(userDoc) {
  if (!userDoc || typeof userDoc !== 'object') {
    return null;
  }

  const normalizeString = value => {
    if (value === undefined || value === null) return '';
    return String(value).trim();
  };

  const documentCandidates = [];
  const addDocument = value => {
    const doc = normalizeString(value);
    if (doc && !documentCandidates.includes(doc)) {
      documentCandidates.push(doc);
    }
  };

  addDocument(userDoc.documento);
  addDocument(userDoc.cpf);
  addDocument(userDoc.cnpj);
  if (Array.isArray(userDoc.documentos)) {
    userDoc.documentos.forEach(entry => {
      if (!entry) return;
      if (typeof entry === 'string') {
        addDocument(entry);
      } else if (typeof entry === 'object') {
        addDocument(entry.numero || entry.valor || entry.documento || entry.code);
      }
    });
  }

  const phoneCandidates = [];
  const addPhone = value => {
    const phone = normalizeString(value);
    if (phone && !phoneCandidates.includes(phone)) {
      phoneCandidates.push(phone);
    }
  };

  addPhone(userDoc.telefone);
  addPhone(userDoc.celular);
  addPhone(userDoc.telefoneSecundario);
  addPhone(userDoc.celularSecundario);

  const collectPhonesFromArray = entries => {
    if (!Array.isArray(entries)) return;
    entries.forEach(entry => {
      if (!entry) return;
      if (typeof entry === 'string') {
        addPhone(entry);
      } else if (typeof entry === 'object') {
        addPhone(entry.telefone || entry.celular || entry.whatsapp || entry.numero || entry.number || entry.mobile);
      }
    });
  };

  collectPhonesFromArray(userDoc.telefones);
  collectPhonesFromArray(userDoc.meiosContato);

  const emailCandidates = [];
  const addEmail = value => {
    const email = normalizeString(value).toLowerCase();
    if (email && !emailCandidates.includes(email)) {
      emailCandidates.push(email);
    }
  };

  addEmail(userDoc.email);

  const collectContactsFromArray = entries => {
    if (!Array.isArray(entries)) return [];
    return entries.filter(Boolean).map(entry => {
      if (typeof entry === 'string') {
        addEmail(entry);
        addPhone(entry);
        return entry;
      }
      if (typeof entry === 'object') {
        addEmail(entry.email);
        addPhone(entry.telefone || entry.celular || entry.whatsapp || entry.numero || entry.number || entry.mobile);
        return { ...entry };
      }
      return null;
    }).filter(Boolean);
  };

  const contatos = [
    ...collectContactsFromArray(userDoc.contatos),
    ...collectContactsFromArray(userDoc.contatosPrincipais),
    ...collectContactsFromArray(userDoc.meiosContato),
  ];

  const primaryPhone = phoneCandidates.length ? phoneCandidates[0] : normalizeString(userDoc.telefone) || null;
  const secondaryPhone = phoneCandidates.find(value => value !== primaryPhone) || normalizeString(userDoc.celular) || primaryPhone || null;

  const documento = documentCandidates.length ? documentCandidates[0] : '';

  return {
    _id: userDoc._id || null,
    id: userDoc._id || null,
    nomeCompleto: userDoc.nomeCompleto || null,
    nomeContato: userDoc.nomeContato || null,
    razaoSocial: userDoc.razaoSocial || null,
    nomeFantasia: userDoc.nomeFantasia || null,
    email: emailCandidates[0] || userDoc.email || null,
    emails: emailCandidates,
    cpf: userDoc.cpf || null,
    cnpj: userDoc.cnpj || null,
    documento: documento || null,
    documentos: Array.isArray(userDoc.documentos)
      ? userDoc.documentos
          .filter(Boolean)
          .map(entry => (typeof entry === 'object' ? { ...entry } : entry))
      : [],
    telefone: primaryPhone || null,
    celular: secondaryPhone || null,
    telefones: phoneCandidates,
    contatos,
  };
}

router.put('/agendamentos/:id', authMiddleware, requireStaff, async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'ID inválido.' });
    }

    const {
      storeId, clienteId, petId, servicoId,
      profissionalId, scheduledAt, valor, pago, status, servicos, observacoes, codigoVenda,
      serviceItemIds, serviceHour, serviceScheduledAt,
    } = req.body || {};

    const hasStatusField = Object.prototype.hasOwnProperty.call(req.body || {}, 'status');
    const hasProfessionalField = Object.prototype.hasOwnProperty.call(req.body || {}, 'profissionalId');
    let normalizedStatus = null;
    if (hasStatusField) {
      normalizedStatus = normalizeServiceStatus(status, null);
      if (!normalizedStatus) {
        return res.status(400).json({ message: 'Status inválido.' });
      }
    }

    const set = {};
    if (storeId && mongoose.Types.ObjectId.isValid(storeId)) set.store = storeId;
    if (clienteId && mongoose.Types.ObjectId.isValid(clienteId)) set.cliente = clienteId;
    if (servicoId && mongoose.Types.ObjectId.isValid(servicoId)) set.servico = servicoId; // compat
    if (hasProfessionalField) {
      if (profissionalId && mongoose.Types.ObjectId.isValid(profissionalId)) set.profissional = profissionalId;
      else set.profissional = null;
    }
    if (typeof valor !== 'undefined') set.valor = Number(valor);
    if (typeof codigoVenda !== 'undefined') {
      const normalizedSaleCode = String(codigoVenda || '').trim();
      set.codigoVenda = normalizedSaleCode;
      set.pago = !!normalizedSaleCode; // paga somente quando há código vinculado
    } else if (typeof pago !== 'undefined') {
      set.pago = !!pago;
    }

    if (scheduledAt) {
      const d = new Date(scheduledAt);
      if (isNaN(d.getTime())) return res.status(400).json({ message: 'scheduledAt inválido.' });
      set.scheduledAt = d;
    }

    // STATUS será aplicado após tratar itens (se necessário)
    // Observações
    if (typeof observacoes !== 'undefined') set.observacoes = String(observacoes);

    // Pet do cliente (se informado)
    if (petId) {
      if (!mongoose.Types.ObjectId.isValid(petId)) return res.status(400).json({ message: 'petId inválido.' });
      let clienteTarget = null;
      if (clienteId) {
        clienteTarget = clienteId;
      } else {
        const current = await Appointment.findById(id).select('cliente').lean();
        clienteTarget = current?.cliente ? String(current.cliente) : null;
      }
      if (!clienteTarget) return res.status(400).json({ message: 'clienteId é obrigatório para trocar o pet.' });

      const pet = await Pet.findById(petId).select('owner').lean();
      if (!pet) return res.status(404).json({ message: 'Pet não encontrado.' });
      if (String(pet.owner) !== String(clienteTarget)) {
        return res.status(400).json({ message: 'Este pet não pertence ao cliente selecionado.' });
      }
      set.pet = petId;
    }

    let itensPayload = null;

    // Atualiza lista de serviços (se enviada)
    if (Array.isArray(servicos)) {
      const itens = [];
      for (const it of servicos) {
        const sid = it?.servicoId;
        if (!sid || !mongoose.Types.ObjectId.isValid(sid)) continue;
        let v = typeof it?.valor === 'number' ? it.valor : null;
        if (v == null) {
          const s = await Service.findById(sid).select('valor').lean();
          v = s?.valor || 0;
        }
        const payload = { servico: sid, valor: Number(v || 0) };
        const pid = it?.profissionalId;
        if (pid && mongoose.Types.ObjectId.isValid(pid)) {
          payload.profissional = pid;
        }
        const horaRaw = typeof it?.hora === 'string' ? it.hora.trim() : '';
        if (horaRaw) payload.hora = horaRaw;
        const statusItem = normalizeServiceStatus(it?.status || it?.situacao, null);
        if (statusItem) payload.status = statusItem;
        const obsRaw = typeof it?.observacao === 'string'
          ? it.observacao.trim()
          : (typeof it?.observacoes === 'string' ? it.observacoes.trim() : '');
        if (obsRaw) payload.observacao = obsRaw;
        itens.push(payload);
      }
      itensPayload = itens;
    }

    let serviceHourNormalized = normalizeHourString(serviceHour);
    let serviceScheduledAtDate = null;
    if (serviceScheduledAt) {
      const candidate = new Date(serviceScheduledAt);
      if (!Number.isNaN(candidate.getTime())) {
        serviceScheduledAtDate = candidate;
        if (!serviceHourNormalized) {
          serviceHourNormalized = `${pad2(candidate.getHours())}:${pad2(candidate.getMinutes())}`;
        }
      } else {
        const hourFromScheduled = normalizeHourString(serviceScheduledAt);
        if (hourFromScheduled) {
          serviceHourNormalized = hourFromScheduled;
        }
      }
    }

    const normalizedServiceItemIds = Array.isArray(serviceItemIds)
      ? serviceItemIds
          .map(id => {
            try { return mongoose.Types.ObjectId.isValid(id) ? String(id) : null; } catch (_) { return null; }
          })
          .filter(Boolean)
      : [];

    let currentItensDoc = null;

    if (
      !itensPayload
      && normalizedServiceItemIds.length
      && (
        (profissionalId && mongoose.Types.ObjectId.isValid(profissionalId))
        || hasProfessionalField
        || hasStatusField
      )
    ) {
      currentItensDoc = await Appointment.findById(id).select('itens').lean();
      if (!currentItensDoc) {
        return res.status(404).json({ message: 'Agendamento não encontrado.' });
      }
      const itens = (currentItensDoc.itens || []).map(it => {
        const payload = {
          servico: it.servico,
          valor: Number(it.valor || 0),
        };
        const currentProf = it.profissional ? String(it.profissional) : null;
        const target = normalizedServiceItemIds.includes(String(it._id));
        if (currentProf && mongoose.Types.ObjectId.isValid(currentProf)) {
          payload.profissional = currentProf;
        }
        if (target && hasProfessionalField) {
          if (profissionalId && mongoose.Types.ObjectId.isValid(profissionalId)) {
            payload.profissional = profissionalId;
          } else {
            delete payload.profissional;
          }
        }
        if (typeof it.hora === 'string' && it.hora.trim()) {
          payload.hora = it.hora.trim();
        }
        if (target) {
          if (serviceScheduledAtDate) {
            payload.hora = serviceScheduledAtDate.toISOString();
          } else if (serviceHourNormalized) {
            payload.hora = serviceHourNormalized;
          }
        }
        const existingStatus = normalizeServiceStatus(it.status, null);
        if (existingStatus) {
          payload.status = existingStatus;
        }
        if (target && hasStatusField && normalizedStatus) {
          payload.status = normalizedStatus;
        }
        const existingObs = typeof it.observacao === 'string'
          ? it.observacao.trim()
          : (typeof it.observacoes === 'string' ? it.observacoes.trim() : '');
        if (existingObs) payload.observacao = existingObs;
        return payload;
      });
      itensPayload = itens;
    }

    if (itensPayload) {
      set.itens = itensPayload;
      if (set.itens.length) {
        set.servico = set.itens[0].servico; // compat
        set.valor = set.itens.reduce((sum, entry) => sum + Number(entry.valor || 0), 0);
        if (!set.profissional) {
          const firstProf = set.itens.find(entry => entry.profissional)?.profissional;
          if (firstProf) set.profissional = firstProf;
        }
      } else {
        set.valor = 0;
      }
    }

    if (hasStatusField && normalizedStatus) {
      let applyStatusToAppointment = false;
      if (!normalizedServiceItemIds.length) {
        applyStatusToAppointment = true;
      } else if (Array.isArray(itensPayload)) {
        const total = itensPayload.length;
        if (total === 0 || normalizedServiceItemIds.length >= total) {
          applyStatusToAppointment = true;
        }
      } else if (currentItensDoc && Array.isArray(currentItensDoc.itens)) {
        const total = currentItensDoc.itens.length;
        if (total === 0 || normalizedServiceItemIds.length >= total) {
          applyStatusToAppointment = true;
        }
      }
      if (applyStatusToAppointment) {
        set.status = normalizedStatus;
      }
    }

    // Se já faturado e não é admin/admin_master, bloquear mudanças em serviços e data/hora
    try {
      const current = await Appointment.findById(id).select('codigoVenda pago').lean();
      const locked = !!(current?.codigoVenda || current?.pago);
      const role = req.user?.role || 'cliente';
      const privileged = (role === 'admin' || role === 'admin_master');

      // Intenções do request
      const wantsServiceChange = Array.isArray(servicos) || typeof valor !== 'undefined' || !!servicoId;
      const wantsScheduleChange = !!scheduledAt;

      if (locked && !privileged && (wantsServiceChange || wantsScheduleChange)) {
        return res.status(403).json({ message: 'Agendamento já faturado. Apenas Admin/Admin Master podem alterar serviços ou data/hora.' });
      }
    } catch (_) {}

    const full = await Appointment.findByIdAndUpdate(id, { $set: set }, { new: true })
      .select('_id store cliente pet servico itens profissional scheduledAt valor pago codigoVenda status observacoes')
      .populate('pet', 'nome')
      .populate({
        path: 'servico',
        select: 'nome categorias grupo',
        populate: { path: 'grupo', select: 'nome tiposPermitidos' }
      })
      .populate({
        path: 'itens.servico',
        select: 'nome categorias grupo',
        populate: { path: 'grupo', select: 'nome tiposPermitidos' }
      })
      .populate({
        path: 'itens.profissional',
        select: 'nomeCompleto nomeContato razaoSocial'
      })
      .populate('profissional', 'nomeCompleto nomeContato razaoSocial')
      .lean();

    if (!full) {
      return res.status(404).json({ message: 'Agendamento não encontrado.' });
    }

    let servicosList = (full.itens || []).map(mapServiceItemResponse).filter(Boolean);
    if (!servicosList.length && full.servico) {
      servicosList = [{
        itemId: null,
        _id: full.servico?._id || full.servico,
        nome: full.servico?.nome || '—',
        valor: Number(full.valor || 0),
        categorias: Array.isArray(full.servico?.categorias)
          ? full.servico.categorias.filter(Boolean)
          : [],
        tiposPermitidos: extractAllowedStaffTypes(full.servico || {}),
        profissionalId: full.profissional?._id || null,
        profissionalNome: formatProfessionalName(full.profissional) || null,
        hora: '',
        status: normalizeServiceStatus(full.status || 'agendado'),
        observacao: typeof full.observacoes === 'string' ? full.observacoes : '',
      }];
    }
    const servicosStr = servicosList.map(s => s.nome).join(', ');
    const valorTotal = servicosList.reduce((sum, svc) => sum + Number(svc.valor || 0), 0) || Number(full.valor || 0) || 0;

    return res.json({
      _id: full._id,
      h: new Date(full.scheduledAt).toISOString(),
      valor: valorTotal,
      pago: !!full.pago,
      status: full.status || 'agendado',
      pet: full.pet ? full.pet.nome : '—',
      servico: servicosStr,
      servicos: servicosList,
      profissional: full.profissional
        ? (full.profissional.nomeCompleto || full.profissional.nomeContato || full.profissional.razaoSocial)
        : '—',
      profissionalId: full.profissional?._id || null
    });
  } catch (e) {
    console.error('PUT /func/agendamentos/:id', e);
    res.status(500).json({ message: 'Erro ao atualizar agendamento' });
  }
});

// ---------- CLIENTES (GERENCIAMENTO) ----------
router.get('/clientes', authMiddleware, requireStaff, async (req, res) => {
  try {
    await atribuirCodigosParaClientesSemCodigo();

    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '10', 10), 1), 50);
    const search = sanitizeString(req.query.search || req.query.q || '');

    const filter = {};
    if (search) {
      const regex = new RegExp(escapeRegex(search), 'i');
      const only = onlyDigits(search);
      const or = [
        { nomeCompleto: regex },
        { nomeContato: regex },
        { razaoSocial: regex },
        { email: regex },
        { apelido: regex },
      ];
      if (only.length >= 3) {
        or.push({ cpf: new RegExp(only) });
        or.push({ cnpj: new RegExp(only) });
        or.push({ celular: new RegExp(only) });
        or.push({ telefone: new RegExp(only) });
      }
      if (mongoose.Types.ObjectId.isValid(search)) {
        or.push({ _id: new mongoose.Types.ObjectId(search) });
      }
      filter.$or = or;
    }

    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      User.find(filter)
        .select('_id nomeCompleto nomeContato razaoSocial nomeFantasia email tipoConta cpf cnpj inscricaoEstadual celular telefone empresaPrincipal pais apelido role telefoneSecundario celularSecundario codigoCliente')
        .sort({ criadoEm: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      User.countDocuments(filter),
    ]);

    const empresaIds = new Set();
    items.forEach((doc) => {
      if (doc.empresaPrincipal) empresaIds.add(String(doc.empresaPrincipal));
    });
    const empresas = empresaIds.size
      ? await Store.find({ _id: { $in: Array.from(empresaIds) } })
          .select('_id nome nomeFantasia razaoSocial')
          .lean()
      : [];
    const empresaMap = new Map(empresas.map((e) => [String(e._id), e]));

    const list = items.map((doc) => {
      const empresaDoc = doc.empresaPrincipal ? empresaMap.get(String(doc.empresaPrincipal)) : null;
      const empresaNome = empresaDoc?.nomeFantasia || empresaDoc?.nome || empresaDoc?.razaoSocial || '';
      const documento = doc.cpf || doc.cnpj || doc.inscricaoEstadual || '';
      const codigo = parseCodigoCliente(doc.codigoCliente) || null;
      return {
        _id: doc._id,
        nome: userDisplayName(doc),
        tipoConta: doc.tipoConta,
        codigo: codigo ? String(codigo) : String(doc._id),
        email: isGeneratedCustomerEmail(doc.email) ? '' : (doc.email || ''),
        celular: doc.celular || '',
        telefone: doc.telefone || '',
        documento,
        empresa: empresaNome,
        pais: doc.pais || 'Brasil',
        apelido: doc.apelido || '',
      };
    });

    const totalPages = Math.max(1, Math.ceil(total / limit));
    res.json({
      items: list,
      pagination: {
        page,
        limit,
        total,
        totalPages,
      },
    });
  } catch (err) {
    console.error('GET /func/clientes', err);
    res.status(500).json({ message: 'Erro ao listar clientes.' });
  }
});

router.post('/clientes', authMiddleware, requireStaff, async (req, res) => {
  try {
    const payload = await buildClientePayload(req.body, { isUpdate: false });
    payload.role = 'cliente';

    let plainPassword = sanitizeString(req.body.senha || req.body.password || '');
    let senhaGerada = false;
    if (!plainPassword || plainPassword.length < 8) {
      plainPassword = randomBytes(8).toString('base64url').slice(0, 12);
      senhaGerada = true;
    }
    const salt = await bcrypt.genSalt(10);
    payload.senha = await bcrypt.hash(plainPassword, salt);

    let created;
    for (let tentativas = 0; tentativas < 3; tentativas += 1) {
      try {
        payload.codigoCliente = await gerarCodigoClienteSequencial();
        created = await User.create(payload);
        break;
      } catch (creationErr) {
        if (creationErr?.code === 11000 && creationErr?.keyPattern?.codigoCliente && tentativas < 2) {
          continue;
        }
        throw creationErr;
      }
    }

    res.status(201).json({
      message: 'Cliente criado com sucesso.',
      id: created._id,
      codigo: created.codigoCliente,
      senhaTemporaria: senhaGerada ? plainPassword : undefined,
    });
  } catch (err) {
    console.error('POST /func/clientes', err);
    if (err?.code === 11000) {
      const keys = Object.keys(err.keyPattern || err.keyValue || {});
      if (keys.includes('email')) {
        return res.status(409).json({ message: 'Já existe um cliente com este email.' });
      }
      if (keys.includes('celular')) {
        return res.status(409).json({ message: 'Já existe um cliente com este celular.' });
      }
      if (keys.includes('cpf')) {
        return res.status(409).json({ message: 'Já existe um cliente com este CPF.' });
      }
      if (keys.includes('cnpj')) {
        return res.status(409).json({ message: 'Já existe um cliente com este CNPJ.' });
      }
      if (keys.includes('codigoCliente')) {
        return res.status(409).json({ message: 'Código do cliente já está em uso, tente novamente.' });
      }
      return res.status(409).json({ message: 'Dados duplicados encontrados para este cliente.' });
    }
    res.status(400).json({ message: err?.message || 'Erro ao criar cliente.' });
  }
});

router.post('/clientes/importar-lote', authMiddleware, requireStaff, async (req, res) => {
  try {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!rows.length) {
      return res.status(400).json({ message: 'Envie ao menos uma linha para importar.' });
    }

    await atribuirCodigosParaClientesSemCodigo();

    const stores = await Store.find({})
      .select('_id nome nomeFantasia razaoSocial')
      .lean();
    const storeIndex = buildStoreNameIndex(stores);
    const timestampSeed = Date.now();

    const summary = {
      received: rows.length,
      created: 0,
      updated: 0,
      failed: 0,
      skipped: 0,
    };
    const errors = [];
    const createdIds = [];
    const updatedIds = [];

    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i] || {};
      const line = Number(row._line) || (i + 2);

      const codigoAntigo = sanitizeString(row.codigoAntigo);
      const nome = sanitizeString(row.nome);
      const documentoDigits = onlyDigits(row.cpfCnpj);

      if (!codigoAntigo || !nome || !documentoDigits) {
        summary.skipped += 1;
        errors.push({
          line,
          message: 'Campos obrigatorios ausentes (Codigo Antigo, Nome, CPF/CNPJ).',
        });
        continue;
      }

      try {
        const tipoConta = detectTipoContaForImport(row.tipo, documentoDigits);
        const storeNameKey = normalizeImportText(row.empresa);
        const empresaId = storeNameKey && storeIndex.has(storeNameKey)
          ? storeIndex.get(storeNameKey)
          : '';

        const phones = collectImportPhones(row);

        let email = sanitizeEmail(row.email);
        if (!email) {
          email = buildFallbackEmail(`${timestampSeed}-${i}`);
        }

        let celular = phones.celular;
        if (!celular) {
          celular = buildFallbackCellular(timestampSeed + i);
        }

        const payloadInput = {
          tipoConta,
          codigoAntigo,
          empresaId,
          nome,
          apelido: nome,
          sexo: parseImportSexo(row.sexo),
          email,
          celular,
          celular2: phones.celular2,
          telefone: phones.telefone,
          telefone2: phones.telefone2,
          pais: 'Brasil',
        };

        if (tipoConta === 'pessoa_juridica') {
          payloadInput.razaoSocial = nome;
          payloadInput.nomeFantasia = nome;
          payloadInput.nomeContato = nome;
          payloadInput.cnpj = documentoDigits.slice(-14);
          payloadInput.inscricaoEstadual = sanitizeString(row.rgIe);
          payloadInput.estadoIE = sanitizeString(row.uf || '').toUpperCase();
        } else {
          payloadInput.cpf = documentoDigits.slice(-11);
          payloadInput.rg = sanitizeString(row.rgIe);
          payloadInput.nascimento = parseImportBirthDate(row.dataNascimento);
        }

        const existing = await User.findOne({ codigoAntigo, role: 'cliente' })
          .select('role tipoConta nomeCompleto razaoSocial nomeFantasia nomeContato email celular telefone apelido pais cpf cnpj inscricaoEstadual genero dataNascimento rgNumero estadoIE isentoIE empresaPrincipal empresas telefoneSecundario celularSecundario codigoAntigo')
          .lean();

        let persistedUserId = '';
        if (existing) {
          const payload = await buildClientePayload(payloadInput, {
            isUpdate: true,
            currentUser: existing,
          });

          const unsetPayload = {};
          Object.keys(payload).forEach((key) => {
            if (typeof payload[key] === 'undefined') delete payload[key];
          });

          if (payload.tipoConta === 'pessoa_juridica') {
            payload.nomeCompleto = '';
            payload.cpf = '';
            payload.genero = '';
            if (!Object.prototype.hasOwnProperty.call(payload, 'dataNascimento')) {
              payload.dataNascimento = null;
            }
            payload.rgNumero = '';
          } else {
            payload.razaoSocial = '';
            payload.nomeFantasia = '';
            payload.nomeContato = '';
            unsetPayload.cnpj = '';
            unsetPayload.inscricaoEstadual = '';
            unsetPayload.estadoIE = '';
            unsetPayload.isentoIE = '';
          }

          const updateQuery = { $set: payload };
          if (Object.keys(unsetPayload).length > 0) {
            updateQuery.$unset = unsetPayload;
          }

          const updated = await User.findByIdAndUpdate(existing._id, updateQuery, {
            new: true,
            runValidators: true,
          });
          if (!updated) {
            throw new Error('Cliente existente nao encontrado para atualizacao.');
          }

          persistedUserId = String(updated._id);
          updatedIds.push(persistedUserId);
          summary.updated += 1;
        } else {
          let payload = await buildClientePayload(payloadInput, { isUpdate: false });
          payload.role = 'cliente';

          const plainPassword = randomBytes(8).toString('base64url').slice(0, 12);
          const salt = await bcrypt.genSalt(10);
          payload.senha = await bcrypt.hash(plainPassword, salt);

          let created = null;
          for (let attempt = 0; attempt < 5; attempt += 1) {
            try {
              payload.codigoCliente = await gerarCodigoClienteSequencial();
              created = await User.create(payload);
              break;
            } catch (creationErr) {
              const duplicateKeys = Object.keys(creationErr?.keyPattern || creationErr?.keyValue || {});
              if (creationErr?.code === 11000 && duplicateKeys.includes('codigoCliente')) {
                continue;
              }
              if (creationErr?.code === 11000 && duplicateKeys.includes('email')) {
                payload.email = buildFallbackEmail(`${timestampSeed}-${i}-${attempt + 1}`);
                continue;
              }
              if (creationErr?.code === 11000 && duplicateKeys.includes('celular')) {
                payload.celular = buildFallbackCellular(timestampSeed + i + attempt + 1);
                continue;
              }
              throw creationErr;
            }
          }

          if (!created) {
            throw new Error('Nao foi possivel criar cliente apos multiplas tentativas.');
          }

          persistedUserId = String(created._id);
          createdIds.push(persistedUserId);
          summary.created += 1;
        }

        const cepDigits = onlyDigits(row.cep);
        if (cepDigits.length === 8 && persistedUserId) {
          const addressPayload = {
            user: persistedUserId,
            apelido: 'Principal',
            cep: formatCep(cepDigits),
            logradouro: sanitizeString(row.endereco),
            numero: sanitizeString(row.numero),
            complemento: sanitizeString(row.complemento),
            bairro: sanitizeString(row.bairro),
            cidade: sanitizeString(row.cidade),
            uf: sanitizeString(row.uf || '').toUpperCase(),
            pais: 'Brasil',
            isDefault: true,
          };

          const existingAddress = await UserAddress.findOne({ user: persistedUserId, isDefault: true })
            .sort({ updatedAt: -1 })
            .lean();

          if (existingAddress?._id) {
            await UserAddress.findByIdAndUpdate(existingAddress._id, { $set: addressPayload }, { runValidators: true });
          } else {
            await UserAddress.create(addressPayload);
          }
        }
      } catch (rowErr) {
        summary.failed += 1;
        errors.push({
          line,
          message: rowErr?.message || 'Erro ao importar linha.',
        });
      }
    }

    return res.json({
      message: 'Importacao de clientes concluida.',
      summary,
      errors,
      createdIds,
      updatedIds,
    });
  } catch (err) {
    console.error('POST /func/clientes/importar-lote', err);
    return res.status(500).json({ message: err?.message || 'Erro ao importar clientes.' });
  }
});

router.post('/pets/importar-lote', authMiddleware, requireStaff, async (req, res) => {
  try {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!rows.length) {
      return res.status(400).json({ message: 'Envie ao menos uma linha para importar.' });
    }

    await atribuirCodigosParaPetsSemCodigo();

    const clientes = await User.find({
      role: 'cliente',
      codigoAntigo: { $exists: true, $ne: null, $ne: '' },
    })
      .select('_id codigoAntigo')
      .lean();
    const ownerIndex = buildCodigoAntigoIndex(clientes);

    const summary = {
      received: rows.length,
      created: 0,
      updated: 0,
      failed: 0,
      skipped: 0,
    };
    const errors = [];
    const createdIds = [];
    const updatedIds = [];

    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i] || {};
      const line = Number(row._line) || (i + 2);

      const codAntigoPet = sanitizeString(row.codigo);
      const nome = sanitizeString(row.nome);
      const codProprietarioRaw = sanitizeString(row.codProprietario);

      if (!codAntigoPet || !nome || !codProprietarioRaw) {
        summary.skipped += 1;
        errors.push({
          line,
          message: 'Campos obrigatorios ausentes (Codigo, Nome, Cod. Proprietario).',
        });
        continue;
      }

      const ownerKeyText = normalizeImportText(codProprietarioRaw);
      const ownerKeyDigits = onlyDigits(codProprietarioRaw);
      const ownerId = ownerIndex.get(ownerKeyText) || ownerIndex.get(ownerKeyDigits) || '';
      if (!ownerId) {
        summary.failed += 1;
        errors.push({
          line,
          message: `Cliente com Codigo Antigo "${codProprietarioRaw}" nao encontrado.`,
        });
        continue;
      }

      try {
        const payload = {
          owner: ownerId,
          codAntigoPet,
          nome,
          tipo: normalizePetImportType(row.especie),
          raca: sanitizeString(row.raca) || 'SRD',
          pelagemCor: sanitizeString(row.pelagem),
          sexo: normalizePetImportSex(row.sexo) || 'macho',
          dataNascimento: parseDate(parseImportBirthDate(row.dataNascimento)) || new Date(),
          rga: sanitizeString(row.rga),
          microchip: sanitizeString(row.chip),
          peso: parseImportWeight(row.peso),
        };

        const existing = await Pet.findOne({ owner: ownerId, codAntigoPet })
          .select('_id codigoPet')
          .lean();

        if (existing?._id) {
          const update = { ...payload };
          delete update.owner;
          if (!parseCodigoPet(existing.codigoPet)) {
            update.codigoPet = await gerarCodigoPetSequencial();
          }
          const updated = await Pet.findByIdAndUpdate(existing._id, { $set: update }, {
            new: true,
            runValidators: true,
          });
          if (!updated) {
            throw new Error('Pet existente nao encontrado para atualizacao.');
          }
          updatedIds.push(String(updated._id));
          summary.updated += 1;
        } else {
          let created = null;
          let tentativas = 0;
          do {
            tentativas += 1;
            try {
              payload.codigoPet = await gerarCodigoPetSequencial();
              created = await Pet.create(payload);
            } catch (creationErr) {
              if (creationErr?.code === 11000 && creationErr?.keyPattern?.codigoPet && tentativas < 5) {
                created = null;
                continue;
              }
              throw creationErr;
            }
          } while (!created && tentativas < 5);

          if (!created) {
            throw new Error('Nao foi possivel gerar o codigo do pet.');
          }
          createdIds.push(String(created._id));
          summary.created += 1;
        }
      } catch (rowErr) {
        summary.failed += 1;
        errors.push({
          line,
          message: rowErr?.message || 'Erro ao importar linha.',
        });
      }
    }

    return res.json({
      message: 'Importacao de animais concluida.',
      summary,
      errors,
      createdIds,
      updatedIds,
    });
  } catch (err) {
    console.error('POST /func/pets/importar-lote', err);
    return res.status(500).json({ message: err?.message || 'Erro ao importar animais.' });
  }
});

router.put('/clientes/:id', authMiddleware, requireStaff, async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'ID inválido.' });
    }
    const current = await User.findById(id).select('role tipoConta nomeCompleto razaoSocial nomeFantasia nomeContato email celular telefone apelido pais cpf cnpj inscricaoEstadual genero dataNascimento rgNumero estadoIE isentoIE empresaPrincipal empresas telefoneSecundario celularSecundario codigoAntigo').lean();
    await ensureClienteEhEditavel(current);

    const payload = await buildClientePayload(req.body, { isUpdate: true, currentUser: current });
    const unsetPayload = {};

    Object.keys(payload).forEach(key => {
      if (typeof payload[key] === 'undefined') {
        delete payload[key];
      }
    });

    if (payload.tipoConta === 'pessoa_juridica') {
      payload.nomeCompleto = '';
      payload.cpf = '';
      payload.genero = '';
      if (!Object.prototype.hasOwnProperty.call(payload, 'dataNascimento')) {
        payload.dataNascimento = null;
      }
      payload.rgNumero = '';
    } else {
      payload.razaoSocial = '';
      payload.nomeFantasia = '';
      payload.nomeContato = '';
      unsetPayload.cnpj = '';
      unsetPayload.inscricaoEstadual = '';
      unsetPayload.estadoIE = '';
      unsetPayload.isentoIE = '';
    }

    const updateQuery = { $set: payload };
    if (Object.keys(unsetPayload).length > 0) {
      updateQuery.$unset = unsetPayload;
    }

    const updated = await User.findByIdAndUpdate(id, updateQuery, { new: true, runValidators: true });
    if (!updated) {
      return res.status(404).json({ message: 'Cliente não encontrado.' });
    }

    res.json({ message: 'Cliente atualizado com sucesso.' });
  } catch (err) {
    console.error('PUT /func/clientes/:id', err);
    if (err?.code === 11000) {
      const keys = Object.keys(err.keyPattern || err.keyValue || {});
      if (keys.includes('email')) {
        return res.status(409).json({ message: 'Já existe um cliente com este email.' });
      }
      if (keys.includes('celular')) {
        return res.status(409).json({ message: 'Já existe um cliente com este celular.' });
      }
      if (keys.includes('cpf')) {
        return res.status(409).json({ message: 'Já existe um cliente com este CPF.' });
      }
      if (keys.includes('cnpj')) {
        return res.status(409).json({ message: 'Já existe um cliente com este CNPJ.' });
      }
      return res.status(409).json({ message: 'Dados duplicados encontrados para este cliente.' });
    }
    res.status(400).json({ message: err?.message || 'Erro ao atualizar cliente.' });
  }
});

router.delete('/clientes/:id', authMiddleware, requireStaff, async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'ID invalido.' });
    }
    const cliente = await User.findById(id).select('role').lean();
    if (!cliente) {
      return res.status(404).json({ message: 'Cliente nao encontrado.' });
    }
    await ensureClienteEhEditavel(cliente);
    if (cliente.role && cliente.role !== 'cliente') {
      return res.status(403).json({ message: 'Apenas clientes podem ser removidos.' });
    }

    await Promise.all([
      UserAddress.deleteMany({ user: id }),
      Pet.deleteMany({ owner: id }),
    ]);
    await User.deleteOne({ _id: id });

    res.json({ message: 'Cliente removido com sucesso.' });
  } catch (err) {
    console.error('DELETE /func/clientes/:id', err);
    res.status(400).json({ message: err?.message || 'Erro ao remover cliente.' });
  }
});

router.get('/clientes/:id/enderecos', authMiddleware, requireStaff, async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'ID inválido.' });
    }
    const cliente = await User.findById(id).select('role').lean();
    await ensureClienteEhEditavel(cliente);

    const enderecosDocs = await UserAddress.find({ user: id })
      .sort({ isDefault: -1, updatedAt: -1 })
      .lean();
    res.json(enderecosDocs.map(mapAddressDoc));
  } catch (err) {
    console.error('GET /func/clientes/:id/enderecos', err);
    res.status(500).json({ message: 'Erro ao buscar endereços.' });
  }
});

router.post('/clientes/:id/enderecos', authMiddleware, requireStaff, async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'ID inválido.' });
    }
    const cliente = await User.findById(id).select('role').lean();
    await ensureClienteEhEditavel(cliente);

    const apelido = sanitizeString(req.body.apelido || 'Principal');
    const cepDigits = onlyDigits(req.body.cep);
    if (cepDigits.length !== 8) {
      return res.status(400).json({ message: 'Informe um CEP válido com 8 dígitos.' });
    }

    const doc = {
      user: id,
      apelido: apelido || 'Principal',
      cep: formatCep(req.body.cep),
      logradouro: sanitizeString(req.body.logradouro),
      numero: sanitizeString(req.body.numero),
      complemento: sanitizeString(req.body.complemento),
      bairro: sanitizeString(req.body.bairro),
      cidade: sanitizeString(req.body.cidade),
      uf: sanitizeString(req.body.uf || '').toUpperCase(),
      ibge: sanitizeString(req.body.ibge || req.body.codIbgeMunicipio || ''),
      codIbgeMunicipio: sanitizeString(req.body.codIbgeMunicipio || req.body.ibge || ''),
      codUf: sanitizeString(req.body.codUf || ''),
      pais: sanitizeString(req.body.pais || 'Brasil') || 'Brasil',
      isDefault: req.body.isDefault === true || req.body.isDefault === 'true',
    };

    const existingCount = await UserAddress.countDocuments({ user: id });
    if (!existingCount) {
      doc.isDefault = true;
    }

    const created = await UserAddress.create(doc);
    if (doc.isDefault) {
      await UserAddress.updateMany({ user: id, _id: { $ne: created._id } }, { $set: { isDefault: false } });
    }

    res.status(201).json(mapAddressDoc(created.toObject()));
  } catch (err) {
    console.error('POST /func/clientes/:id/enderecos', err);
    res.status(400).json({ message: err?.message || 'Erro ao salvar endereço.' });
  }
});

router.put('/clientes/:id/enderecos/:enderecoId', authMiddleware, requireStaff, async (req, res) => {
  try {
    const { id, enderecoId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(enderecoId)) {
      return res.status(400).json({ message: 'ID inválido.' });
    }
    const cliente = await User.findById(id).select('role').lean();
    await ensureClienteEhEditavel(cliente);

    const apelido = sanitizeString(req.body.apelido || 'Principal');
    const cepDigits = onlyDigits(req.body.cep);
    if (cepDigits.length !== 8) {
      return res.status(400).json({ message: 'Informe um CEP válido com 8 dígitos.' });
    }

    const update = {
      apelido: apelido || 'Principal',
      cep: formatCep(req.body.cep),
      logradouro: sanitizeString(req.body.logradouro),
      numero: sanitizeString(req.body.numero),
      complemento: sanitizeString(req.body.complemento),
      bairro: sanitizeString(req.body.bairro),
      cidade: sanitizeString(req.body.cidade),
      uf: sanitizeString(req.body.uf || '').toUpperCase(),
      ibge: sanitizeString(req.body.ibge || req.body.codIbgeMunicipio || ''),
      codIbgeMunicipio: sanitizeString(req.body.codIbgeMunicipio || req.body.ibge || ''),
      codUf: sanitizeString(req.body.codUf || ''),
      pais: sanitizeString(req.body.pais || 'Brasil') || 'Brasil',
      isDefault: req.body.isDefault === true || req.body.isDefault === 'true',
    };

    const updated = await UserAddress.findOneAndUpdate({ _id: enderecoId, user: id }, update, { new: true });
    if (!updated) {
      return res.status(404).json({ message: 'Endereço não encontrado.' });
    }

    if (update.isDefault) {
      await UserAddress.updateMany({ user: id, _id: { $ne: updated._id } }, { $set: { isDefault: false } });
    }

    res.json(mapAddressDoc(updated));
  } catch (err) {
    console.error('PUT /func/clientes/:id/enderecos/:enderecoId', err);
    res.status(400).json({ message: err?.message || 'Erro ao atualizar endereço.' });
  }
});

router.delete('/clientes/:id/enderecos/:enderecoId', authMiddleware, requireStaff, async (req, res) => {
  try {
    const { id, enderecoId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(enderecoId)) {
      return res.status(400).json({ message: 'ID inválido.' });
    }
    const cliente = await User.findById(id).select('role').lean();
    await ensureClienteEhEditavel(cliente);

    const deleted = await UserAddress.findOneAndDelete({ _id: enderecoId, user: id });
    if (!deleted) {
      return res.status(404).json({ message: 'Endereço não encontrado.' });
    }

    res.json({ message: 'Endereço removido com sucesso.' });
  } catch (err) {
    console.error('DELETE /func/clientes/:id/enderecos/:enderecoId', err);
    res.status(500).json({ message: 'Erro ao remover endereço.' });
  }
});

router.post('/clientes/:id/pets', authMiddleware, requireStaff, async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'ID inválido.' });
    }
    const cliente = await User.findById(id).select('role').lean();
    await ensureClienteEhEditavel(cliente);

    const nome = sanitizeString(req.body.nome || req.body.nomePet);
    if (!nome) {
      return res.status(400).json({ message: 'Informe o nome do pet.' });
    }
    const tipo = sanitizeString(req.body.tipo || req.body.tipoPet);
    if (!tipo) {
      return res.status(400).json({ message: 'Informe o tipo do pet.' });
    }
    const sexo = sanitizeString(req.body.sexo);
    if (!sexo) {
      return res.status(400).json({ message: 'Informe o sexo do pet.' });
    }

    const doc = {
      owner: id,
      codAntigoPet: sanitizeString(req.body.codAntigoPet || req.body.codigoAntigoPet || req.body.codigo),
      nome,
      tipo,
      porte: sanitizeString(req.body.porte),
      raca: sanitizeString(req.body.raca),
      sexo,
      dataNascimento: parseDate(req.body.nascimento || req.body.dataNascimento) || new Date(),
      microchip: sanitizeString(req.body.microchip),
      pelagemCor: sanitizeString(req.body.pelagem || req.body.pelagemCor || req.body.cor),
      rga: sanitizeString(req.body.rga),
      peso: sanitizeString(req.body.peso),
      obito: parseBooleanFlag(req.body.obito),
      castrado: parseBooleanFlag(req.body.castrado),
    };

    let tentativas = 0;
    let created = null;
    do {
      tentativas += 1;
      try {
        doc.codigoPet = await gerarCodigoPetSequencial();
        created = await Pet.create(doc);
      } catch (creationErr) {
        if (creationErr?.code === 11000 && creationErr?.keyPattern?.codigoPet && tentativas < 3) {
          created = null;
          continue;
        }
        throw creationErr;
      }
    } while (!created && tentativas < 3);

    if (!created) {
      throw new Error('Não foi possível gerar o código do pet.');
    }

    res.status(201).json(mapPetDoc(created));
  } catch (err) {
    console.error('POST /func/clientes/:id/pets', err);
    res.status(400).json({ message: err?.message || 'Erro ao cadastrar pet.' });
  }
});

router.put('/clientes/:id/pets/:petId', authMiddleware, requireStaff, async (req, res) => {
  try {
    const { id, petId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(petId)) {
      return res.status(400).json({ message: 'ID inválido.' });
    }
    const cliente = await User.findById(id).select('role').lean();
    await ensureClienteEhEditavel(cliente);

    const pet = await Pet.findOne({ _id: petId, owner: id });
    if (!pet) {
      return res.status(404).json({ message: 'Pet não encontrado.' });
    }

    const update = {
      codAntigoPet: sanitizeString(req.body.codAntigoPet || req.body.codigoAntigoPet || req.body.codigo || pet.codAntigoPet || ''),
      nome: sanitizeString(req.body.nome || req.body.nomePet) || pet.nome,
      tipo: sanitizeString(req.body.tipo || req.body.tipoPet) || pet.tipo,
      porte: sanitizeString(req.body.porte),
      raca: sanitizeString(req.body.raca) || pet.raca,
      sexo: sanitizeString(req.body.sexo) || pet.sexo,
      dataNascimento: parseDate(req.body.nascimento || req.body.dataNascimento) || pet.dataNascimento,
      microchip: sanitizeString(req.body.microchip),
      pelagemCor: sanitizeString(req.body.pelagem || req.body.pelagemCor || req.body.cor),
      rga: sanitizeString(req.body.rga),
      peso: sanitizeString(req.body.peso),
    };

    if (!parseCodigoPet(pet.codigoPet)) {
      update.codigoPet = await gerarCodigoPetSequencial();
    }

    if (Object.prototype.hasOwnProperty.call(req.body, 'obito')) {
      update.obito = parseBooleanFlag(req.body.obito);
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'castrado')) {
      update.castrado = parseBooleanFlag(req.body.castrado);
    }

    const updated = await Pet.findByIdAndUpdate(petId, update, { new: true });
    res.json(mapPetDoc(updated));
  } catch (err) {
    console.error('PUT /func/clientes/:id/pets/:petId', err);
    res.status(400).json({ message: err?.message || 'Erro ao atualizar pet.' });
  }
});

router.delete('/clientes/:id/pets/:petId', authMiddleware, requireStaff, async (req, res) => {
  try {
    const { id, petId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(petId)) {
      return res.status(400).json({ message: 'ID inválido.' });
    }
    const cliente = await User.findById(id).select('role').lean();
    await ensureClienteEhEditavel(cliente);

    const deleted = await Pet.findOneAndDelete({ _id: petId, owner: id });
    if (!deleted) {
      return res.status(404).json({ message: 'Pet não encontrado.' });
    }

    res.json({ message: 'Pet removido com sucesso.' });
  } catch (err) {
    console.error('DELETE /func/clientes/:id/pets/:petId', err);
    res.status(500).json({ message: 'Erro ao remover pet.' });
  }
});

// ---------- BUSCA CLIENTES ----------
router.get('/clientes/buscar', authMiddleware, requireStaff, async (req, res) => {
  try {
    await atribuirCodigosParaClientesSemCodigo();

    const q = String(req.query.q || '').trim();
    const limit = Math.min(parseInt(req.query.limit || '8', 10), 20);
    if (!q) return res.json([]);
    const regex = new RegExp(escapeRegex(q), 'i');
    const onlyDigits = q.replace(/\D/g, '');
    const numericCode = parseCodigoCliente(onlyDigits);

    const or = [{ nomeCompleto: regex }, { nomeContato: regex }, { razaoSocial: regex }, { email: regex }];
    if (numericCode) {
      or.push({ codigoCliente: numericCode });
    }
    if (onlyDigits.length >= 4) {
      or.push({ cpf: new RegExp(onlyDigits) });
      or.push({ cnpj: new RegExp(onlyDigits) });
      or.push({ celular: new RegExp(onlyDigits) });
    }

    const users = await User.find({ $or: or })
      .select(
        '_id nomeCompleto nomeContato razaoSocial email cpf cnpj inscricaoEstadual celular tipoConta codigoCliente genero sexo dataNascimento'
      )
      .limit(limit)
      .lean();

    const userIds = users.map((u) => u?._id).filter(Boolean);
    const addressByUserId = new Map();
    if (userIds.length) {
      const addressDocs = await UserAddress.find({ user: { $in: userIds } })
        .select('user apelido cep logradouro numero complemento bairro cidade uf isDefault updatedAt')
        .sort({ isDefault: -1, updatedAt: -1, _id: -1 })
        .lean();

      for (const doc of addressDocs) {
        const userId = String(doc?.user || '');
        if (!userId || addressByUserId.has(userId)) continue;
        const mapped = mapAddressDoc(doc);
        if (!mapped) continue;
        addressByUserId.set(userId, {
          ...mapped,
          formatted: buildAddressLabel(mapped),
        });
      }
    }

    res.json(users.map(u => ({
      ...(addressByUserId.get(String(u._id)) ? {
        enderecoFormatado: addressByUserId.get(String(u._id)).formatted || '',
        logradouro: addressByUserId.get(String(u._id)).logradouro || '',
        numero: addressByUserId.get(String(u._id)).numero || '',
        complemento: addressByUserId.get(String(u._id)).complemento || '',
        bairro: addressByUserId.get(String(u._id)).bairro || '',
        cidade: addressByUserId.get(String(u._id)).cidade || '',
        uf: addressByUserId.get(String(u._id)).uf || '',
        cep: addressByUserId.get(String(u._id)).cep || '',
      } : {}),
      _id: u._id,
      codigo: (() => {
        const parsed = parseCodigoCliente(u.codigoCliente);
        return parsed ? String(parsed) : null;
      })(),
      nome: userDisplayName(u),
      email: isGeneratedCustomerEmail(u.email) ? '' : (u.email || ''),
      celular: u.celular || '',
      genero: u.genero || u.sexo || '',
      sexo: u.sexo || u.genero || '',
      dataNascimento: u.dataNascimento || null,
      doc: u.cpf || u.cnpj || u.inscricaoEstadual || '',
      cpf: u.cpf || '',
      cnpj: u.cnpj || '',
      inscricaoEstadual: u.inscricaoEstadual || '',
      tipoConta: u.tipoConta
    })));
  } catch (e) {
    console.error('GET /func/clientes/buscar', e);
    res.status(500).json({ message: 'Erro ao buscar clientes' });
  }
});

router.post('/clientes/lookup-codigo-antigo', authMiddleware, requireStaff, async (req, res) => {
  try {
    const codes = Array.isArray(req.body?.codes) ? req.body.codes : [];
    const cleanedCodes = Array.from(new Set(codes
      .map((value) => sanitizeString(value))
      .filter(Boolean)));

    if (!cleanedCodes.length) {
      return res.json({ items: [] });
    }

    const codeKeys = cleanedCodes.map((code) => ({
      raw: code,
      normalized: normalizeImportText(code),
      digits: onlyDigits(code),
    }));

    const users = await User.find({
      role: 'cliente',
      codigoAntigo: { $exists: true, $ne: null, $ne: '' },
    })
      .select('_id codigoAntigo nomeCompleto nomeContato razaoSocial email')
      .lean();

    const ownersByKey = new Map();
    users.forEach((user) => {
      const codigoAntigo = sanitizeString(user?.codigoAntigo);
      if (!codigoAntigo) return;
      const info = {
        ownerId: String(user._id),
        codigoAntigo,
        nome: userDisplayName(user) || '',
      };
      const normalized = normalizeImportText(codigoAntigo);
      const digits = onlyDigits(codigoAntigo);
      if (normalized && !ownersByKey.has(normalized)) {
        ownersByKey.set(normalized, info);
      }
      if (digits && !ownersByKey.has(digits)) {
        ownersByKey.set(digits, info);
      }
    });

    const items = codeKeys.map((entry) => {
      const owner = ownersByKey.get(entry.normalized) || ownersByKey.get(entry.digits) || null;
      return {
        query: entry.raw,
        encontrado: !!owner,
        ownerId: owner?.ownerId || '',
        codigoAntigo: owner?.codigoAntigo || '',
        nome: owner?.nome || '',
      };
    });

    return res.json({ items });
  } catch (err) {
    console.error('POST /func/clientes/lookup-codigo-antigo', err);
    return res.status(500).json({ message: err?.message || 'Erro ao consultar codigos antigos.' });
  }
});

// ---------- CONTATOS COM WHATSAPP ----------
router.get('/clientes/whatsapp', authMiddleware, requireStaff, async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const limit = Math.min(parseInt(req.query.limit || '60', 10), 100);
    const searchLimit = Math.min(limit * 3, 240);
    const phoneFilter = [
      { celular: { $exists: true, $ne: '' } },
      { celularSecundario: { $exists: true, $ne: '' } },
    ];

    const query = { $and: [{ $or: phoneFilter }] };
    if (q) {
      const regex = new RegExp(escapeRegex(q), 'i');
      const onlyDigits = q.replace(/\D/g, '');
      const or = [
        { nomeCompleto: regex },
        { nomeContato: regex },
        { razaoSocial: regex },
        { apelido: regex },
        { email: regex },
      ];
      if (onlyDigits.length >= 3) {
        const phoneRegex = new RegExp(onlyDigits);
        or.push({ celular: phoneRegex });
        or.push({ celularSecundario: phoneRegex });
      }
      query.$and.push({ $or: or });
    }

    const users = await User.find(query)
      .select('_id nomeCompleto nomeContato razaoSocial apelido email celular celularSecundario')
      .sort({ nomeCompleto: 1, nomeContato: 1, razaoSocial: 1, apelido: 1 })
      .limit(searchLimit)
      .lean();

    const seen = new Set();
    const results = [];

    const pushPhone = (user, value) => {
      const raw = sanitizeString(value);
      const digits = onlyDigits(raw);
      if (!digits || digits.length < 8) return;
      if (seen.has(digits)) return;
      seen.add(digits);
      results.push({
        _id: user._id,
        nome: userDisplayName(user),
        phone: raw,
        waId: digits,
        isKnownUser: true,
      });
    };

    users.forEach((user) => {
      pushPhone(user, user.celular);
      pushPhone(user, user.celularSecundario);
    });

    res.json(results.slice(0, limit));
  } catch (e) {
    console.error('GET /func/clientes/whatsapp', e);
    res.status(500).json({ message: 'Erro ao buscar contatos' });
  }
});

// ---------- PETS DO CLIENTE ----------
router.get('/clientes/:id/pets', authMiddleware, requireStaff, async (req, res) => {
  try {
    const ownerId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(ownerId)) return res.json([]);
    await atribuirCodigosParaPetsSemCodigo(ownerId);
    const includeDeceased = String(req.query.includeDeceased || '')
      .trim().toLowerCase();
    const includeFlag = ['1', 'true', 'sim'].includes(includeDeceased);
    const filter = { owner: ownerId };
    if (!includeFlag) {
      filter.obito = { $ne: true };
    }
    const pets = await Pet.find(filter)
      .select('_id nome tipo raca porte sexo dataNascimento peso microchip pelagemCor rga obito castrado codAntigoPet codigoPet owner')
      .sort({ nome: 1 })
      .lean();
    res.json(pets.map(mapPetDoc));
  } catch (e) {
    console.error('GET /func/clientes/:id/pets', e);
    res.status(500).json({ message: 'Erro ao buscar pets' });
  }
});

// ---------- BUSCA SERVIÇOS ----------
router.get('/servicos/buscar', authMiddleware, requireStaff, async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const limit = Math.min(parseInt(req.query.limit || '8', 10), 30);
    const filter = q ? { nome: new RegExp(escapeRegex(q), 'i') } : {};
    const normalizeTipo = (s) => String(s || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .trim().toLowerCase();
    const profTipo = normalizeTipo(req.query.profTipo || req.query.staffType || '');

    const items = await Service.find(filter)
      .select('_id nome valor porte grupo categorias')
      .populate({ path: 'grupo', select: 'nome tiposPermitidos' })
      .limit(limit)
      .sort({ nome: 1 })
      .lean();

    const filtered = profTipo
      ? items.filter(s => {
        const tipos = Array.isArray(s?.grupo?.tiposPermitidos) ? s.grupo.tiposPermitidos : [];
        if (!tipos.length) return true;
        return tipos.some(t => normalizeTipo(t) === profTipo);
      })
      : items;

    res.json(filtered.map(s => ({
      _id: s._id,
      nome: s.nome,
      valor: s.valor || 0,
      porte: s.porte || [],
      categorias: Array.isArray(s.categorias) ? s.categorias : [],
      grupo: s.grupo ? {
        _id: s.grupo._id,
        nome: s.grupo.nome,
        tiposPermitidos: Array.isArray(s.grupo.tiposPermitidos) ? s.grupo.tiposPermitidos : []
      } : null
    })));
  } catch (e) {
    console.error('GET /func/servicos/buscar', e);
    res.status(500).json({ message: 'Erro ao buscar serviços' });
  }
});

// Preço por raça de um serviço para uso na agenda
// GET /api/func/servicos/preco?serviceId=&storeId=&petId=  (ou &tipo=&raca=)
router.get('/servicos/preco', authMiddleware, requireStaff, async (req, res) => {
  try {
    const { serviceId, storeId, petId } = req.query || {};
    if (!serviceId || !mongoose.Types.ObjectId.isValid(serviceId)) {
      return res.status(400).json({ message: 'serviceId obrigatório' });
    }
    if (!storeId || !mongoose.Types.ObjectId.isValid(storeId)) {
      return res.status(400).json({ message: 'storeId obrigatório' });
    }

    let tipo = (req.query.tipo || '').trim();
    let raca = (req.query.raca || '').trim();

    if ((!tipo || !raca) && petId && mongoose.Types.ObjectId.isValid(petId)) {
      const pet = await Pet.findById(petId).select('tipo raca').lean();
      if (pet) {
        const norm = (s) => String(s || '')
          .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
          .trim().toLowerCase();
        const mapTipo = (t) => {
          const n = norm(t);
          if (/cachorr|cao|c.o/.test(n)) return 'cachorro';
          if (/gat/.test(n)) return 'gato';
          if (/passar|ave/.test(n)) return 'passaro';
          if (/peix/.test(n)) return 'peixe';
          if (/roedor|hamster|coelho|porquinho/.test(n)) return 'roedor';
          if (/lagart/.test(n)) return 'lagarto';
          if (/tartarug/.test(n)) return 'tartaruga';
          if (/exot/.test(n)) return 'exotico';
          return n || 'cachorro';
        };
        tipo = tipo || mapTipo(pet.tipo);
        raca = raca || String(pet.raca || '').trim();
      }
    }

    const ServiceBreedPrice = require('../models/ServiceBreedPrice');
    let preco = null;
    if (tipo && raca) {
      const ov = await ServiceBreedPrice.findOne({
        service: serviceId,
        store: storeId,
        tipo: String(tipo).trim(),
        raca: new RegExp('^' + escapeRegex(raca) + '$', 'i')
      }).select('valor custo').lean();
      if (ov) {
        preco = { valor: Number(ov.valor || 0), custo: Number(ov.custo || 0), source: 'breed' };
      }
    }

    if (!preco || !(preco.valor > 0)) {
      const s = await Service.findById(serviceId).select('valor').lean();
      preco = { valor: Number((s && s.valor) || 0), custo: 0, source: 'service' };
    }
    res.json(preco);
  } catch (e) {
    console.error('GET /func/servicos/preco', e);
    res.status(500).json({ message: 'Erro ao obter preço do serviço' });
  }
});

// ---------- PROFISSIONAIS (esteticistas) ----------
router.get('/profissionais/esteticistas', authMiddleware, requireStaff, async (req, res) => {
  try {
    const { storeId } = req.query;
    const filter = {
      role: { $in: ['funcionario', 'franqueado', 'franqueador', 'admin', 'admin_master'] },
      grupos: 'esteticista'
    };
    if (storeId && mongoose.Types.ObjectId.isValid(storeId)) {
      // Usuários que pertencem à empresa informada
      filter.empresas = storeId;
    }

    const users = await User.find(filter)
      .select('_id nomeCompleto nomeContato razaoSocial email empresas grupos')
      .sort({ nomeCompleto: 1 })
      .lean();

    res.json(users.map(u => ({ _id: u._id, nome: userDisplayName(u) })));
  } catch (e) {
    console.error('GET /func/profissionais/esteticistas', e);
    res.status(500).json({ message: 'Erro ao carregar profissionais' });
  }
});

// PROFISSIONAIS: esteticistas e veterinários
router.get('/profissionais', authMiddleware, requireStaff, async (req, res) => {
  try {
    const { storeId } = req.query;
    let tipos = String(req.query.tipos || '').trim();
    const ALLOWED = ['esteticista','veterinario'];
    const tiposArr = tipos ? tipos.split(',').map(s => s.trim().toLowerCase()).filter(s => ALLOWED.includes(s)) : ALLOWED;
    const filter = { role: { $in: ['funcionario', 'franqueado', 'franqueador', 'admin', 'admin_master'] }, grupos: { $in: tiposArr } };
    if (storeId && mongoose.Types.ObjectId.isValid(storeId)) filter.empresas = storeId;
    const users = await User.find(filter)
      .select('_id nomeCompleto nomeContato razaoSocial email grupos')
      .sort({ nomeCompleto: 1 })
      .lean();
    const out = users.map(u => ({
      _id: u._id,
      nome: userDisplayName(u),
      tipo: (Array.isArray(u.grupos) && u.grupos.includes('veterinario')) ? 'veterinario' : 'esteticista'
    }));
    res.json(out);
  } catch (e) {
    console.error('GET /func/profissionais', e);
    res.status(500).json({ message: 'Erro ao carregar profissionais' });
  }
});

// ---------- AGENDAMENTOS ----------
function getDayRange(dateStr) {
  // dateStr: YYYY-MM-DD (sem timezone). Considera dia local.
  const [y, m, d] = dateStr.split('-').map(n => parseInt(n, 10));
  const start = new Date(y, m - 1, d, 0, 0, 0, 0);
  const end = new Date(y, m - 1, d + 1, 0, 0, 0, 0);
  return { start, end };
}

// Listar do dia por empresa
// GET /api/func/agendamentos?date=YYYY-MM-DD&storeId=<id>
router.get('/agendamentos', authMiddleware, requireStaff, async (req, res) => {
  try {
    const { date, storeId } = req.query;
    if (!date) return res.status(400).json({ message: 'Parâmetro "date" é obrigatório (YYYY-MM-DD).' });

    const [y, m, d] = date.split('-').map(n => parseInt(n, 10));
    const start = new Date(y, m - 1, d, 0, 0, 0, 0);
    const end   = new Date(y, m - 1, d + 1, 0, 0, 0, 0);

    const filter = { scheduledAt: { $gte: start, $lt: end } };
    if (storeId && mongoose.Types.ObjectId.isValid(storeId)) filter.store = storeId;

    const list = await Appointment.find(filter)
      .select('_id store cliente pet servico itens profissional scheduledAt valor pago codigoVenda status observacoes')
      .populate(
        'cliente',
        [
          'nomeCompleto',
          'nomeContato',
          'razaoSocial',
          'nomeFantasia',
          'email',
          'cpf',
          'cnpj',
          'documento',
          'documentos',
          'telefone',
          'celular',
          'telefoneSecundario',
          'celularSecundario',
          'telefones',
          'contatos',
          'contatosPrincipais',
          'meiosContato',
        ].join(' ')
      )
      .populate('pet', 'nome')
      .populate({
        path: 'servico',
        select: 'nome categorias grupo',
        populate: { path: 'grupo', select: 'nome tiposPermitidos' }
      })
      .populate({
        path: 'itens.servico',
        select: 'nome categorias grupo',
        populate: { path: 'grupo', select: 'nome tiposPermitidos' }
      })
      .populate({
        path: 'itens.profissional',
        select: 'nomeCompleto nomeContato razaoSocial'
      })
      .populate('profissional', 'nomeCompleto nomeContato razaoSocial')
      .sort({ scheduledAt: 1 })
      .lean();

    const map = (list || []).map(a => {
      const clienteInfo = mapAppointmentCustomer(a.cliente);
      const clienteNome = clienteInfo?.nomeCompleto
        || clienteInfo?.nomeContato
        || clienteInfo?.razaoSocial
        || clienteInfo?.email
        || null;

      let servicosList = Array.isArray(a.itens)
        ? a.itens.map(mapServiceItemResponse).filter(Boolean)
        : [];
      if (!servicosList.length && a.servico) {
        servicosList = [{
          itemId: null,
          _id: a.servico?._id || a.servico,
          nome: a.servico?.nome || '—',
          valor: Number(a.valor || 0),
          categorias: Array.isArray(a.servico?.categorias)
            ? a.servico.categorias.filter(Boolean)
            : [],
          tiposPermitidos: extractAllowedStaffTypes(a.servico || {}),
          profissionalId: a.profissional?._id || null,
          profissionalNome: formatProfessionalName(a.profissional) || null,
          hora: '',
          status: normalizeServiceStatus(a.status || 'agendado'),
          observacao: typeof a.observacoes === 'string' ? a.observacoes : '',
        }];
      }
      const servicosStr = servicosList.map(s => s.nome).join(', ');
      const valorTotal = (servicosList.reduce((s, x) => s + Number(x.valor || 0), 0)) || Number(a.valor || 0) || 0;
      const profFromServices = servicosList.map(s => s.profissionalId).filter(Boolean);
      const primaryProfId = profFromServices[0] || (a.profissional?._id || null);
      const primaryProfName = profFromServices.length
        ? (servicosList.find(s => s.profissionalId === profFromServices[0])?.profissionalNome || null)
        : formatProfessionalName(a.profissional) || null;

      return {
        _id: a._id,
        storeId: a.store?._id || a.store || null,
        clienteId: clienteInfo?._id || a.cliente?._id || null,
        clienteNome,
        clienteDocumento: clienteInfo?.documento || null,
        clienteEmail: clienteInfo?.email || null,
        clienteTelefone: clienteInfo?.telefone || null,
        clienteCelular: clienteInfo?.celular || null,
        clienteContatos: clienteInfo?.contatos || [],
        cliente: clienteInfo,
        pet: a.pet ? a.pet.nome : '—',
        petId: a.pet?._id || null,
        servico: servicosStr,             // compat: texto p/ exibição
        servicos: servicosList,           // novo: array de serviços do agendamento
        profissionalId: primaryProfId,
        profissional: primaryProfName,
        profissionaisServicos: servicosList
          .map(s => ({ profissionalId: s.profissionalId, profissionalNome: s.profissionalNome }))
          .filter(entry => entry.profissionalId),
        h: new Date(a.scheduledAt).toISOString(),
        valor: valorTotal,                // total do agendamento
        pago: !!a.pago,
        codigoVenda: a.codigoVenda || null,
        observacoes: a.observacoes || '',
        status: a.status || 'agendado'
      };
    });

    res.json(map);
  } catch (e) {
    console.error('GET /func/agendamentos', e);
    res.status(500).json({ message: 'Erro ao listar agendamentos' });
  }
});

// GET /api/func/agendamentos/range?start=YYYY-MM-DD&end=YYYY-MM-DD&storeId=<id>
router.get('/agendamentos/range', authMiddleware, requireStaff, async (req, res) => {
  try {
    const { start: startStr, end: endStr, storeId } = req.query;
    if (!startStr || !endStr) {
      return res.status(400).json({ message: 'Parâmetros "start" e "end" são obrigatórios (YYYY-MM-DD).' });
    }
    const [ys, ms, ds] = startStr.split('-').map(n => parseInt(n, 10));
    const [ye, me, de] = endStr.split('-').map(n => parseInt(n, 10));
    const start = new Date(ys, ms - 1, ds, 0, 0, 0, 0);
    const end   = new Date(ye, me - 1, de, 0, 0, 0, 0); // exclusivo

    const filter = { scheduledAt: { $gte: start, $lt: end } };
    if (storeId && mongoose.Types.ObjectId.isValid(storeId)) filter.store = storeId;

    const list = await Appointment.find(filter)
      .select('_id store cliente pet servico itens profissional scheduledAt valor pago codigoVenda status observacoes')
      .populate(
        'cliente',
        [
          'nomeCompleto',
          'nomeContato',
          'razaoSocial',
          'nomeFantasia',
          'email',
          'cpf',
          'cnpj',
          'documento',
          'documentos',
          'telefone',
          'celular',
          'telefoneSecundario',
          'celularSecundario',
          'telefones',
          'contatos',
          'contatosPrincipais',
          'meiosContato',
        ].join(' ')
      )
      .populate('pet', 'nome')
      .populate({
        path: 'servico',
        select: 'nome categorias grupo',
        populate: { path: 'grupo', select: 'nome tiposPermitidos' }
      })
      .populate({
        path: 'itens.servico',
        select: 'nome categorias grupo',
        populate: { path: 'grupo', select: 'nome tiposPermitidos' }
      })
      .populate({
        path: 'itens.profissional',
        select: 'nomeCompleto nomeContato razaoSocial'
      })
      .populate('profissional', 'nomeCompleto nomeContato razaoSocial')
      .sort({ scheduledAt: 1 })
      .lean();

    const map = (list || []).map(a => {
      let servicosList = (a.itens || []).map(mapServiceItemResponse).filter(Boolean);
      if (!servicosList.length && a.servico) {
        servicosList.push({
          itemId: null,
          _id: a.servico?._id || a.servico,
          nome: a.servico?.nome || '—',
          valor: Number(a.valor || 0),
          categorias: Array.isArray(a.servico?.categorias)
            ? a.servico.categorias.filter(Boolean)
            : [],
          tiposPermitidos: extractAllowedStaffTypes(a.servico || {}),
          profissionalId: a.profissional?._id || null,
          profissionalNome: formatProfessionalName(a.profissional) || null,
        });
      }
      const valorTotal = servicosList.reduce((acc, s) => acc + Number(s.valor || 0), 0) || Number(a.valor || 0) || 0;
      const clienteInfo = mapAppointmentCustomer(a.cliente);
      const tutorNome = clienteInfo?.nomeCompleto
        || clienteInfo?.nomeContato
        || clienteInfo?.razaoSocial
        || '';
      const profFromServices = servicosList.map(s => s.profissionalId).filter(Boolean);
      const primaryProfId = profFromServices[0] || (a.profissional?._id || null);
      const primaryProfName = profFromServices.length
        ? (servicosList.find(s => s.profissionalId === profFromServices[0])?.profissionalNome || null)
        : formatProfessionalName(a.profissional) || null;
      return {
        _id: a._id,
        pet: a.pet ? a.pet.nome : null,
        servico: servicosList.map(s => s.nome).join(', '),
        servicos: servicosList,
        profissionalId: primaryProfId,
        profissional: primaryProfName,
        tutor: tutorNome,
        cliente: clienteInfo,
        clienteId: clienteInfo?._id || a.cliente?._id || null,
        clienteDocumento: clienteInfo?.documento || null,
        clienteEmail: clienteInfo?.email || null,
        clienteTelefone: clienteInfo?.telefone || null,
        clienteCelular: clienteInfo?.celular || null,
        clienteContatos: clienteInfo?.contatos || [],
        h: new Date(a.scheduledAt).toISOString(),
        valor: valorTotal,
        pago: !!a.pago,
        codigoVenda: a.codigoVenda || null,
        observacoes: a.observacoes || '',
        status: a.status || 'agendado'
      };
    });

    res.json(map);
  } catch (e) {
    console.error('GET /func/agendamentos/range', e);
    res.status(500).json({ message: 'Erro ao listar agendamentos por intervalo' });
  }
});

// Criar agendamento
// body: { storeId, clienteId, petId, servicoId, profissionalId, scheduledAt, valor, pago }
router.post('/agendamentos', authMiddleware, requireStaff, async (req, res) => {
  try {
    const { storeId, clienteId, petId, servicoId, profissionalId, scheduledAt, valor, pago, status, servicos, observacoes } = req.body || {};
    if (!storeId || !clienteId || !petId || !scheduledAt) {
      return res.status(400).json({ message: 'Campos obrigatórios ausentes.' });
    }
    if (!mongoose.Types.ObjectId.isValid(storeId)
      || !mongoose.Types.ObjectId.isValid(clienteId)
      || !mongoose.Types.ObjectId.isValid(petId)
      || (profissionalId && !mongoose.Types.ObjectId.isValid(profissionalId))) {
      return res.status(400).json({ message: 'IDs inválidos.' });
    }

    const statusFinal = normalizeServiceStatus(status);

    let itens = [];
    if (Array.isArray(servicos) && servicos.length) {
      for (const it of servicos) {
        const sid = it?.servicoId;
        if (!sid || !mongoose.Types.ObjectId.isValid(sid)) continue;
        let v = typeof it?.valor === 'number' ? it.valor : null;
        if (v == null) {
          const s = await Service.findById(sid).select('valor').lean();
          v = s?.valor || 0;
        }
        const entry = { servico: sid, valor: Number(v || 0) };
        const pid = it?.profissionalId;
        if (pid && mongoose.Types.ObjectId.isValid(pid)) entry.profissional = pid;
        const horaRaw = typeof it?.hora === 'string' ? it.hora.trim() : '';
        if (horaRaw) entry.hora = horaRaw;
        const statusItem = normalizeServiceStatus(it?.status || it?.situacao, null);
        if (statusItem) entry.status = statusItem;
        else entry.status = normalizeServiceStatus(statusFinal);
        const obsRaw = typeof it?.observacao === 'string'
          ? it.observacao.trim()
          : (typeof it?.observacoes === 'string' ? it.observacoes.trim() : '');
        if (obsRaw) entry.observacao = obsRaw;
        itens.push(entry);
      }
      if (!itens.length) return res.status(400).json({ message: 'Lista de serviços inválida.' });
    } else {
      if (!servicoId || !mongoose.Types.ObjectId.isValid(servicoId)) {
        return res.status(400).json({ message: 'servicoId inválido.' });
      }
      let valorFinal = typeof valor === 'number' ? valor : null;
      if (valorFinal == null) {
        const serv = await Service.findById(servicoId).select('valor').lean();
        valorFinal = serv?.valor || 0;
      }
      const entry = { servico: servicoId, valor: Number(valorFinal || 0) };
      if (profissionalId && mongoose.Types.ObjectId.isValid(profissionalId)) entry.profissional = profissionalId;
      entry.status = normalizeServiceStatus(statusFinal);
      itens = [entry];
    }

    const total = itens.reduce((s, x) => s + Number(x.valor || 0), 0);
    const primaryProfessional = itens.find(x => x.profissional)?.profissional || (profissionalId && mongoose.Types.ObjectId.isValid(profissionalId) ? profissionalId : null);

    const appt = await Appointment.create({
      store: storeId,
      cliente: clienteId,
      pet: petId,
      servico: itens[0]?.servico || null, // compat
      itens,
      profissional: primaryProfessional,
      scheduledAt: new Date(scheduledAt),
      valor: total,
      pago: !!pago,
      status: statusFinal,
      observacoes: (typeof observacoes === 'string' ? observacoes : ''),
      createdBy: req.user?._id
    });

    const full = await Appointment.findById(appt._id)
      .select('_id store cliente pet servico itens profissional scheduledAt valor pago status observacoes')
      .populate('pet', 'nome')
      .populate('servico', 'nome')
      .populate('itens.servico', 'nome categorias grupo')
      .populate({ path: 'itens.servico.grupo', select: 'nome tiposPermitidos' })
      .populate({ path: 'itens.profissional', select: 'nomeCompleto nomeContato razaoSocial' })
      .populate('profissional', 'nomeCompleto nomeContato razaoSocial')
      .lean();

    let servicosList = (full.itens || []).map(mapServiceItemResponse).filter(Boolean);
    if (!servicosList.length && full.servico) {
      servicosList = [{
        itemId: null,
        _id: full.servico?._id || full.servico,
        nome: full.servico?.nome || '—',
        valor: Number(full.valor || 0),
        categorias: [],
        tiposPermitidos: extractAllowedStaffTypes(full.servico || {}),
        profissionalId: full.profissional?._id || null,
        profissionalNome: formatProfessionalName(full.profissional) || null,
        hora: '',
        status: normalizeServiceStatus(full.status || 'agendado'),
        observacao: typeof full.observacoes === 'string' ? full.observacoes : '',
      }];
    }
    const servicosStr = servicosList.map(s => s.nome).join(', ');
    const valorTotal = servicosList.reduce((sum, svc) => sum + Number(svc.valor || 0), 0) || Number(full.valor || 0) || 0;
    const primaryProfName = servicosList.find(s => s.profissionalId)?.profissionalNome || formatProfessionalName(full.profissional) || '—';

    res.status(201).json({
      _id: full._id,
      h: new Date(full.scheduledAt).toISOString(),
      valor: valorTotal,
      pago: !!full.pago,
      status: full.status || 'agendado',
      pet: full.pet ? full.pet.nome : '—',
      servico: servicosStr,
      servicos: servicosList,
      observacoes: full.observacoes || '',
      profissional: primaryProfName || '—',
      profissionalId: full.profissional?._id || servicosList.find(s => s.profissionalId)?.profissionalId || null
    });
  } catch (e) {
    console.error('POST /func/agendamentos', e);
    res.status(500).json({ message: 'Erro ao salvar' });
  }
});

router.get('/clientes/:id', authMiddleware, requireStaff, async (req, res) => {
  try {
    await atribuirCodigosParaClientesSemCodigo();

    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'ID inválido.' });
    }
    const u = await User.findById(id)
      .select('_id role tipoConta nomeCompleto nomeContato razaoSocial nomeFantasia email celular telefone celularSecundario telefoneSecundario cpf cnpj inscricaoEstadual genero dataNascimento rgNumero estadoIE isentoIE apelido pais empresaPrincipal empresas limiteCredito codigoCliente codigoAntigo')
      .lean();
    if (!u) {
      return res.status(404).json({ message: 'Cliente não encontrado.' });
    }
    await ensureClienteEhEditavel(u);

    const visibleEmail = isGeneratedCustomerEmail(u.email) ? '' : (u.email || '');
    const nome = u.nomeCompleto || u.nomeContato || u.razaoSocial || visibleEmail || '';
    const celular = u.celular || u.telefone || '';
    const telefone = u.telefone || '';
    const cpf = typeof u.cpf === 'string' ? u.cpf : '';
    const cnpj = typeof u.cnpj === 'string' ? u.cnpj : '';
    const inscricaoEstadual = typeof u.inscricaoEstadual === 'string' ? u.inscricaoEstadual : '';
    const documentoPrincipal = cpf || cnpj || inscricaoEstadual || '';
    const cpfCnpj = cpf || cnpj || '';
    const codigo = parseCodigoCliente(u.codigoCliente) || null;

    const enderecosDocs = await UserAddress.find({ user: id })
      .sort({ isDefault: -1, updatedAt: -1 })
      .lean();
    const enderecos = enderecosDocs.map(mapAddressDoc);
    const address = enderecos.length ? enderecos[0] : null;

    let empresa = null;
    if (u.empresaPrincipal) {
      const store = await Store.findById(u.empresaPrincipal).select('_id nome nomeFantasia razaoSocial').lean();
      if (store) {
        empresa = {
          _id: store._id,
          nome: store.nomeFantasia || store.nome || store.razaoSocial || '',
        };
      }
    }

    const limiteCredito = parseNumber(u.limiteCredito, 0);

    res.json({
      _id: u._id,
      nome,
      tipoConta: u.tipoConta,
      codigo: codigo ? String(codigo) : String(u._id),
      codigoAntigo: u.codigoAntigo || '',
      apelido: u.apelido || '',
      pais: u.pais || 'Brasil',
      empresaPrincipal: empresa,
      empresas: Array.isArray(u.empresas) ? u.empresas.map((empId) => String(empId)) : [],
      email: visibleEmail,
      celular,
      telefone,
      celularSecundario: u.celularSecundario || '',
      telefoneSecundario: u.telefoneSecundario || '',
      cpf,
      cnpj,
      cpfCnpj,
      inscricaoEstadual,
      genero: u.genero || '',
      dataNascimento: u.dataNascimento ? new Date(u.dataNascimento).toISOString().slice(0, 10) : '',
      rgNumero: u.rgNumero || '',
      razaoSocial: u.razaoSocial || '',
      nomeFantasia: u.nomeFantasia || '',
      nomeContato: u.nomeContato || '',
      estadoIE: u.estadoIE || '',
      isentoIE: !!u.isentoIE,
      documento: documentoPrincipal,
      documentoPrincipal,
      doc: documentoPrincipal,
      address,
      enderecos,
      limiteCredito,
      financeiro: {
        limiteCredito,
      },
    });
  } catch (e) {
    console.error('GET /func/clientes/:id', e);
    res.status(500).json({ message: 'Erro ao buscar cliente.' });
  }
});

router.get('/pets/:id', authMiddleware, requireStaff, async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'ID inválido.' });
    }
    const p = await Pet.findById(id)
      .select('_id nome owner codigoPet')
      .populate('owner', 'nomeCompleto nomeContato razaoSocial email')
      .lean();
    if (!p) {
      return res.status(404).json({ message: 'Pet não encontrado.' });
    }
    if (!parseCodigoPet(p.codigoPet)) {
      await atribuirCodigosParaPetsSemCodigo();
      const refreshed = await Pet.findById(id)
        .select('_id nome owner codigoPet')
        .populate('owner', 'nomeCompleto nomeContato razaoSocial email')
        .lean();
      if (refreshed) {
        p.codigoPet = refreshed.codigoPet;
      }
    }
    const clienteNome = p.owner
      ? (p.owner.nomeCompleto || p.owner.nomeContato || p.owner.razaoSocial || p.owner.email || '')
      : '';
    res.json({
      _id: p._id,
      nome: p.nome,
      codigo: (() => {
        const parsed = parseCodigoPet(p.codigoPet);
        return parsed ? String(parsed) : null;
      })(),
      clienteId: p.owner?._id || null,
      clienteNome
    });
  } catch (e) {
    console.error('GET /func/pets/:id', e);
    res.status(500).json({ message: 'Erro ao buscar pet.' });
  }
});

router.delete('/agendamentos/:id', authMiddleware, requireStaff, async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ message: 'ID inválido.' });

    const del = await Appointment.findByIdAndDelete(id).lean();
    if (!del) return res.status(404).json({ message: 'Agendamento não encontrado.' });

    return res.json({ ok: true });
  } catch (e) {
    console.error('DELETE /func/agendamentos/:id', e);
    res.status(500).json({ message: 'Erro ao excluir agendamento' });
  }
});

module.exports = router;
