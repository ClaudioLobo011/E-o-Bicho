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

const requireStaff = authorizeRoles('funcionario', 'admin', 'admin_master');

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

async function buildClientePayload(body = {}, opts = {}) {
  const { isUpdate = false, currentUser = null } = opts;
  const tipoConta = normalizeTipoConta(body.tipoConta || currentUser?.tipoConta);

  const email = sanitizeEmail(body.email || currentUser?.email || '');
  if (!email) throw new Error('Email é obrigatório.');

  const celular = sanitizeTelefone(body.celular || currentUser?.celular || '');
  if (!celular) throw new Error('Celular é obrigatório.');

  const telefone = sanitizeTelefone(body.telefone);
  const celular2 = sanitizeTelefone(body.celular2 || body.celularSecundario);
  const telefone2 = sanitizeTelefone(body.telefone2 || body.telefoneSecundario);

  const pais = sanitizeString(body.pais || currentUser?.pais || 'Brasil') || 'Brasil';
  const apelido = sanitizeString(body.apelido || (tipoConta === 'pessoa_fisica' ? currentUser?.apelido : currentUser?.nomeFantasia) || '');

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
    payload.cnpj = cnpj || '';
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

async function ensureClienteEhEditavel(user) {
  if (!user) {
    throw new Error('Cliente não encontrado.');
  }
  if (user.role && user.role !== 'cliente') {
    throw new Error('Este usuário não pode ser gerenciado como cliente.');
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

function extractAllowedStaffTypes(serviceDoc) {
  if (!serviceDoc) return [];
  const raw = [];
  if (Array.isArray(serviceDoc.tiposPermitidos)) raw.push(...serviceDoc.tiposPermitidos);
  if (serviceDoc.grupo && Array.isArray(serviceDoc.grupo.tiposPermitidos)) {
    raw.push(...serviceDoc.grupo.tiposPermitidos);
  }
  return [...new Set(raw.map(v => String(v || '').trim()).filter(Boolean))];
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
      profissionalId, scheduledAt, valor, pago, status, servicos, observacoes, codigoVenda
    } = req.body || {};

    const set = {};
    if (storeId && mongoose.Types.ObjectId.isValid(storeId)) set.store = storeId;
    if (clienteId && mongoose.Types.ObjectId.isValid(clienteId)) set.cliente = clienteId;
    if (servicoId && mongoose.Types.ObjectId.isValid(servicoId)) set.servico = servicoId; // compat
    if (profissionalId && mongoose.Types.ObjectId.isValid(profissionalId)) set.profissional = profissionalId;
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

    // STATUS
    if (typeof status !== 'undefined') {
      const allowed = new Set(['agendado', 'em_espera', 'em_atendimento', 'finalizado']);
      const s = String(status);
      if (!allowed.has(s)) return res.status(400).json({ message: 'Status inválido.' });
      set.status = s;
    }
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
        const item = { servico: sid, valor: Number(v || 0) };
        const pid = it?.profissionalId;
        if (pid && mongoose.Types.ObjectId.isValid(pid)) {
          item.profissional = pid;
        }
        itens.push(item);
      }
      set.itens = itens;
      if (itens.length) {
        set.servico = itens[0].servico; // compat
        set.valor = itens.reduce((s, x) => s + Number(x.valor || 0), 0);
      } else {
        set.itens = [];
        set.valor = 0;
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
      .populate('itens.profissional', 'nomeCompleto nomeContato razaoSocial nome nomeFantasia')
      .populate('profissional', 'nomeCompleto nomeContato razaoSocial')
      .lean();

    if (!full) {
      return res.status(404).json({ message: 'Agendamento não encontrado.' });
    }

    const servicosList = (full.itens || []).map((it) => {
      const profDoc = it.profissional && typeof it.profissional === 'object' ? it.profissional : null;
      const profId = profDoc?._id || it.profissional || null;
      const profNome = profDoc
        ? (profDoc.nomeCompleto || profDoc.nomeContato || profDoc.razaoSocial || profDoc.nomeFantasia || profDoc.nome || '')
        : null;
      return {
        _id: it.servico?._id || it.servico,
        nome: it.servico?.nome || '-',
        valor: Number(it.valor || 0),
        categorias: Array.isArray(it.servico?.categorias)
          ? it.servico.categorias.filter(Boolean)
          : [],
        tiposPermitidos: extractAllowedStaffTypes(it.servico || {}),
        profissionalId: profId,
        profissionalNome: profNome,
      };
    });
    if (!servicosList.length && full.servico) {
      servicosList.push({
        _id: full.servico?._id || full.servico,
        nome: full.servico?.nome || '-',
        valor: Number(full.valor || 0),
        categorias: Array.isArray(full.servico?.categorias)
          ? full.servico.categorias.filter(Boolean)
          : [],
        tiposPermitidos: extractAllowedStaffTypes(full.servico || {}),
        profissionalId: full.profissional?._id || null,
        profissionalNome: full.profissional
          ? (full.profissional.nomeCompleto || full.profissional.nomeContato || full.profissional.razaoSocial || '')
          : null,
      });
    }
    const servicosStr = servicosList.map(s => s.nome).join(', ');

    return res.json({
      _id: full._id,
      h: new Date(full.scheduledAt).toISOString(),
      valor: Number(full.valor || 0),
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
    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '10', 10), 1), 50);
    const search = sanitizeString(req.query.search || req.query.q || '');

    const filter = { role: 'cliente' };
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
        .select('_id nomeCompleto nomeContato razaoSocial nomeFantasia email tipoConta cpf cnpj inscricaoEstadual celular telefone empresaPrincipal pais apelido role telefoneSecundario celularSecundario')
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
      return {
        _id: doc._id,
        nome: userDisplayName(doc),
        tipoConta: doc.tipoConta,
        codigo: String(doc._id),
        email: doc.email || '',
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

    const created = await User.create(payload);
    res.status(201).json({
      message: 'Cliente criado com sucesso.',
      id: created._id,
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
      return res.status(409).json({ message: 'Dados duplicados encontrados para este cliente.' });
    }
    res.status(400).json({ message: err?.message || 'Erro ao criar cliente.' });
  }
});

router.put('/clientes/:id', authMiddleware, requireStaff, async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'ID inválido.' });
    }
    const current = await User.findById(id).select('role tipoConta nomeCompleto razaoSocial nomeFantasia nomeContato email celular telefone apelido pais cpf cnpj inscricaoEstadual genero dataNascimento rgNumero estadoIE isentoIE empresaPrincipal empresas telefoneSecundario celularSecundario').lean();
    await ensureClienteEhEditavel(current);

    const payload = await buildClientePayload(req.body, { isUpdate: true, currentUser: current });
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
      payload.cnpj = '';
      payload.inscricaoEstadual = '';
      payload.estadoIE = '';
      payload.isentoIE = false;
    }

    const updated = await User.findByIdAndUpdate(id, payload, { new: true, runValidators: true });
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
    };

    const created = await Pet.create(doc);
    res.status(201).json(created);
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

    const updated = await Pet.findByIdAndUpdate(petId, update, { new: true });
    res.json(updated);
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
    const q = String(req.query.q || '').trim();
    const limit = Math.min(parseInt(req.query.limit || '8', 10), 20);
    if (!q) return res.json([]);
    const regex = new RegExp(escapeRegex(q), 'i');
    const onlyDigits = q.replace(/\D/g, '');

    const or = [{ nomeCompleto: regex }, { nomeContato: regex }, { razaoSocial: regex }, { email: regex }];
    if (onlyDigits.length >= 4) {
      or.push({ cpf: new RegExp(onlyDigits) });
      or.push({ cnpj: new RegExp(onlyDigits) });
      or.push({ celular: new RegExp(onlyDigits) });
    }

    const users = await User.find({ $or: or })
      .select('_id nomeCompleto nomeContato razaoSocial email cpf cnpj inscricaoEstadual celular tipoConta')
      .limit(limit)
      .lean();

    res.json(users.map(u => ({
      _id: u._id,
      nome: userDisplayName(u),
      email: u.email,
      celular: u.celular || '',
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

// ---------- PETS DO CLIENTE ----------
router.get('/clientes/:id/pets', authMiddleware, requireStaff, async (req, res) => {
  try {
    const ownerId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(ownerId)) return res.json([]);
    const pets = await Pet.find({ owner: ownerId })
      .select('_id nome tipo raca porte sexo dataNascimento peso microchip pelagemCor rga')
      .sort({ nome: 1 })
      .lean();
    res.json(pets);
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
      role: { $in: ['funcionario', 'admin', 'admin_master'] },
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
    const filter = { role: { $in: ['funcionario','admin','admin_master'] }, grupos: { $in: tiposArr } };
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
      .populate('itens.profissional', 'nomeCompleto nomeContato razaoSocial nome nomeFantasia')
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

      const itens = Array.isArray(a.itens) ? a.itens : [];
      const servicosList = itens.length
        ? itens.map((it) => {
            const profDoc = it.profissional && typeof it.profissional === 'object' ? it.profissional : null;
            const profId = profDoc?._id || it.profissional || null;
            const profNome = profDoc
              ? (profDoc.nomeCompleto || profDoc.nomeContato || profDoc.razaoSocial || profDoc.nomeFantasia || profDoc.nome || '')
              : null;
            return {
              _id: it.servico?._id || it.servico || null,
              nome: it.servico?.nome || '-',
              valor: Number(it.valor || 0),
              categorias: Array.isArray(it.servico?.categorias)
                ? it.servico.categorias.filter(Boolean)
                : [],
              tiposPermitidos: extractAllowedStaffTypes(it.servico || {}),
              profissionalId: profId,
              profissionalNome: profNome,
            };
          })
        : (a.servico
            ? [{
                _id: a.servico?._id || a.servico,
                nome: a.servico?.nome || '-',
                valor: Number(a.valor || 0),
                categorias: Array.isArray(a.servico?.categorias)
                  ? a.servico.categorias.filter(Boolean)
                  : [],
                tiposPermitidos: extractAllowedStaffTypes(a.servico || {}),
                profissionalId: a.profissional?._id || a.profissionalId || null,
                profissionalNome: a.profissional || null,
            }]
            : []);
      const servicosStr = servicosList.map((s) => s.nome).filter(Boolean).join(', ');
      const valorTotal =
        servicosList.reduce((soma, item) => soma + Number(item.valor || 0), 0) ||
        Number(a.valor || 0) ||
        0;

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
        pet: a.pet ? a.pet.nome : '-',
        petId: a.pet?._id || null,
        servico: servicosStr,
        servicos: servicosList,
        profissionalId: a.profissional?._id || null,
        profissional: a.profissional
          ? (a.profissional.nomeCompleto || a.profissional.nomeContato || a.profissional.razaoSocial)
          : null,
        h: new Date(a.scheduledAt).toISOString(),
        valor: valorTotal,
        pago: !!a.pago,
        codigoVenda: a.codigoVenda || null,
        observacoes: a.observacoes || '',
        status: a.status || 'agendado',
      };
    });

    res.json(map);
  } catch (e) {
    console.error('GET /func/agendamentos', e);
    res.status(500).json({ message: 'Erro ao listar agendamentos' });
  }
});

router.post('/agendamentos', authMiddleware, requireStaff, async (req, res) => {
  try {
    const {
      storeId,
      clienteId,
      petId,
      servicoId,
      profissionalId,
      scheduledAt,
      valor,
      pago,
      status,
      servicos,
      observacoes,
    } = req.body || {};

    if (!storeId || !clienteId || !petId || !profissionalId || !scheduledAt) {
      return res.status(400).json({ message: 'Campos obrigatórios ausentes.' });
    }
    if (
      !mongoose.Types.ObjectId.isValid(storeId) ||
      !mongoose.Types.ObjectId.isValid(clienteId) ||
      !mongoose.Types.ObjectId.isValid(petId) ||
      !mongoose.Types.ObjectId.isValid(profissionalId)
    ) {
      return res.status(400).json({ message: 'IDs inválidos.' });
    }

    const allowed = new Set(['agendado', 'em_espera', 'em_atendimento', 'finalizado']);
    const statusFinal = allowed.has(status) ? status : 'agendado';

    let itens = [];
    if (Array.isArray(servicos) && servicos.length) {
      for (const it of servicos) {
        const sid = it?.servicoId;
        if (!sid || !mongoose.Types.ObjectId.isValid(sid)) continue;
        let v = typeof it?.valor === 'number' ? it.valor : null;
        if (v == null) {
          const serviceDoc = await Service.findById(sid).select('valor').lean();
          v = serviceDoc?.valor || 0;
        }
        const item = { servico: sid, valor: Number(v || 0) };
        const pid = it?.profissionalId;
        if (pid && mongoose.Types.ObjectId.isValid(pid)) {
          item.profissional = pid;
        }
        itens.push(item);
      }
      if (!itens.length) {
        return res.status(400).json({ message: 'Lista de serviços inválida.' });
      }
    } else {
      if (!servicoId || !mongoose.Types.ObjectId.isValid(servicoId)) {
        return res.status(400).json({ message: 'servicoId inválido.' });
      }
      let valorFinal = typeof valor === 'number' ? valor : null;
      if (valorFinal == null) {
        const serv = await Service.findById(servicoId).select('valor').lean();
        valorFinal = serv?.valor || 0;
      }
      const baseItem = {
        servico: servicoId,
        valor: Number(valorFinal || 0),
      };
      if (mongoose.Types.ObjectId.isValid(profissionalId)) {
        baseItem.profissional = profissionalId;
      }
      itens = [baseItem];
    }

    const total = itens.reduce((soma, item) => soma + Number(item.valor || 0), 0);

    const appt = await Appointment.create({
      store: storeId,
      cliente: clienteId,
      pet: petId,
      servico: itens[0]?.servico || null,
      itens,
      profissional: profissionalId,
      scheduledAt: new Date(scheduledAt),
      valor: total,
      pago: !!pago,
      status: statusFinal,
      observacoes: typeof observacoes === 'string' ? observacoes : '',
      createdBy: req.user?._id,
    });

    const full = await Appointment.findById(appt._id)
      .select('_id store cliente pet servico itens profissional scheduledAt valor pago status observacoes codigoVenda')
      .populate('pet', 'nome')
      .populate('servico', 'nome')
      .populate('itens.servico', 'nome')
      .populate('itens.profissional', 'nomeCompleto nomeContato razaoSocial nome nomeFantasia')
      .populate('profissional', 'nomeCompleto nomeContato razaoSocial')
      .lean();

    const servicosList = (full.itens || []).map((it) => {
      const profDoc = it.profissional && typeof it.profissional === 'object' ? it.profissional : null;
      const profId = profDoc?._id || it.profissional || null;
      const profNome = profDoc
        ? (profDoc.nomeCompleto || profDoc.nomeContato || profDoc.razaoSocial || profDoc.nomeFantasia || profDoc.nome || '')
        : null;
      return {
        _id: it.servico?._id || it.servico,
        nome: it.servico?.nome || '-',
        valor: Number(it.valor || 0),
        profissionalId: profId,
        profissionalNome: profNome,
      };
    });
    const servicosStr = servicosList.map((s) => s.nome).filter(Boolean).join(', ');

    res.status(201).json({
      _id: full._id,
      h: new Date(full.scheduledAt).toISOString(),
      valor: Number(full.valor || 0),
      pago: !!full.pago,
      status: full.status || 'agendado',
      pet: full.pet ? full.pet.nome : '-',
      servico: servicosStr,
      servicos: servicosList,
      observacoes: full.observacoes || '',
      profissional: full.profissional
        ? (full.profissional.nomeCompleto || full.profissional.nomeContato || full.profissional.razaoSocial)
        : null,
      profissionalId: full.profissional?._id || null,
      codigoVenda: full.codigoVenda || null,
    });
  } catch (e) {
    console.error('POST /func/agendamentos', e);
    res.status(500).json({ message: 'Erro ao salvar' });
  }
});

router.get('/clientes/:id', authMiddleware, requireStaff, async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'ID inválido.' });
    }
    const u = await User.findById(id)
      .select('_id role tipoConta nomeCompleto nomeContato razaoSocial nomeFantasia email celular telefone celularSecundario telefoneSecundario cpf cnpj inscricaoEstadual genero dataNascimento rgNumero estadoIE isentoIE apelido pais empresaPrincipal empresas limiteCredito')
      .lean();
    if (!u) {
      return res.status(404).json({ message: 'Cliente não encontrado.' });
    }
    await ensureClienteEhEditavel(u);

    const nome = u.nomeCompleto || u.nomeContato || u.razaoSocial || u.email || '';
    const celular = u.celular || u.telefone || '';
    const telefone = u.telefone || '';
    const cpf = typeof u.cpf === 'string' ? u.cpf : '';
    const cnpj = typeof u.cnpj === 'string' ? u.cnpj : '';
    const inscricaoEstadual = typeof u.inscricaoEstadual === 'string' ? u.inscricaoEstadual : '';
    const documentoPrincipal = cpf || cnpj || inscricaoEstadual || '';
    const cpfCnpj = cpf || cnpj || '';

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
      codigo: String(u._id),
      apelido: u.apelido || '',
      pais: u.pais || 'Brasil',
      empresaPrincipal: empresa,
      empresas: Array.isArray(u.empresas) ? u.empresas.map((empId) => String(empId)) : [],
      email: u.email || '',
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
      .select('_id nome owner')
      .populate('owner', 'nomeCompleto nomeContato razaoSocial email')
      .lean();
    if (!p) {
      return res.status(404).json({ message: 'Pet não encontrado.' });
    }
    const clienteNome = p.owner
      ? (p.owner.nomeCompleto || p.owner.nomeContato || p.owner.razaoSocial || p.owner.email || '')
      : '';
    res.json({
      _id: p._id,
      nome: p.nome,
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



