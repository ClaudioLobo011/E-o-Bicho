const express = require('express');
const bcrypt = require('bcrypt'); // npm i bcrypt
const router = express.Router();

const User = require('../models/User');
const authMiddleware = require('../middlewares/authMiddleware');
const mongoose = require('mongoose');
const Store = require('../models/Store');

// ----- helpers / policies -----
const roleRank = { cliente: 0, funcionario: 1, admin: 2, admin_master: 3 };
const CURSO_SITUACOES = ['concluido', 'cursando'];
const HORARIO_DIAS = ['segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado', 'domingo'];
const HORARIO_TIPOS = ['jornada', 'escala'];
const HORARIO_MODALIDADES_JORNADA = ['diurna', 'noturna', 'integral', 'parcial', 'extraordinaria', 'intermitente', 'estagio', 'remota', 'reduzida'];
const HORARIO_MODALIDADES_ESCALA = ['6x1', '5x1', '12x36'];
const HORARIO_MODALIDADES = [...HORARIO_MODALIDADES_JORNADA, ...HORARIO_MODALIDADES_ESCALA];
const RACA_COR_OPCOES = ['nao_informar', 'indigena', 'branco', 'preto', 'amarelo', 'pardo'];
const DEFICIENCIA_OPCOES = ['nao_portador', 'fisica', 'auditiva', 'visual', 'intelectual', 'multipla'];
const ESTADO_CIVIL_OPCOES = ['solteiro', 'casado', 'separado', 'viuvo'];

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function parseNumber(value, { allowFloat = false, min = null } = {}) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    if (min !== null && value < min) return null;
    return value;
  }
  const normalized = String(value).trim().replace(',', '.');
  if (!normalized) return null;
  const parsed = allowFloat ? Number.parseFloat(normalized) : Number.parseInt(normalized, 10);
  if (!Number.isFinite(parsed)) return null;
  if (min !== null && parsed < min) return null;
  return parsed;
}

function parseEnum(value, allowed = []) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const normalized = String(value).trim().toLowerCase();
  return allowed.includes(normalized) ? normalized : null;
}

function sanitizeCursosPayload(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const nome = (item.nome || item.curso || item.formacao || '').trim();
      if (!nome) return null;

      const curso = { nome };

      if (Object.prototype.hasOwnProperty.call(item, 'data')) {
        if (item.data instanceof Date) {
          curso.data = item.data;
        } else {
          curso.data = parseDate(item.data);
        }
      }

      const situacao = parseEnum(item.situacao, CURSO_SITUACOES);
      if (situacao !== undefined) {
        curso.situacao = situacao;
      }

      if (Object.prototype.hasOwnProperty.call(item, 'observacao')) {
        const obs = (item.observacao || '').trim();
        curso.observacao = obs || null;
      }

      if (item._id && mongoose.Types.ObjectId.isValid(item._id)) {
        curso._id = item._id;
      }

      return curso;
    })
    .filter(Boolean);
}

function normalizeDiaValue(value) {
  if (!value) return null;
  const normalized = String(value)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
  if (normalized.startsWith('seg')) return 'segunda';
  if (normalized.startsWith('ter')) return 'terca';
  if (normalized.startsWith('qua')) return 'quarta';
  if (normalized.startsWith('qui')) return 'quinta';
  if (normalized.startsWith('sex')) return 'sexta';
  if (normalized.startsWith('sab')) return 'sabado';
  if (normalized.startsWith('dom')) return 'domingo';
  return null;
}

function normalizeHorarioTipo(value) {
  if (!value) return null;
  const normalized = String(value).toLowerCase().trim();
  return HORARIO_TIPOS.includes(normalized) ? normalized : null;
}

function normalizeHorarioModalidade(tipo, value) {
  if (!value) return null;
  const normalized = String(value)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
  const compact = normalized.replace(/[^a-z0-9]/g, '');
  if (tipo === 'escala') {
    if (compact.includes('6') && compact.includes('1')) return '6x1';
    if (compact.includes('5') && compact.includes('1')) return '5x1';
    if (compact.includes('12') && (compact.includes('36') || (compact.includes('3') && compact.includes('6')))) return '12x36';
    if (HORARIO_MODALIDADES_ESCALA.includes(normalized)) return normalized;
    if (HORARIO_MODALIDADES_ESCALA.includes(compact)) return compact;
    return null;
  }
  if (tipo === 'jornada') {
    if (normalized.includes('diurn')) return 'diurna';
    if (normalized.includes('noturn')) return 'noturna';
    if (normalized.includes('integral')) return 'integral';
    if (normalized.includes('parcial')) return 'parcial';
    if (normalized.includes('extra')) return 'extraordinaria';
    if (normalized.includes('intermit')) return 'intermitente';
    if (normalized.includes('estag')) return 'estagio';
    if (normalized.includes('remot')) return 'remota';
    if (normalized.includes('reduz')) return 'reduzida';
    if (HORARIO_MODALIDADES_JORNADA.includes(normalized)) return normalized;
    return null;
  }
  if (HORARIO_MODALIDADES.includes(normalized)) return normalized;
  return null;
}

function sanitizeHorarioTime(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  if (/^\d{2}:\d{2}$/.test(raw)) return raw;
  if (/^\d{1,2}:\d{2}$/.test(raw)) {
    const [h, m] = raw.split(':');
    const hour = Math.min(Math.max(parseInt(h, 10), 0), 23).toString().padStart(2, '0');
    const minute = Math.min(Math.max(parseInt(m, 10), 0), 59).toString().padStart(2, '0');
    return `${hour}:${minute}`;
  }
  if (/^\d{3,4}$/.test(raw)) {
    const padded = raw.padStart(4, '0');
    const hour = Math.min(Math.max(parseInt(padded.slice(0, 2), 10), 0), 23).toString().padStart(2, '0');
    const minute = Math.min(Math.max(parseInt(padded.slice(2), 10), 0), 59).toString().padStart(2, '0');
    return `${hour}:${minute}`;
  }
  const attempt = new Date(`1970-01-01T${raw}`);
  if (!Number.isNaN(attempt.getTime())) {
    const hour = attempt.getHours().toString().padStart(2, '0');
    const minute = attempt.getMinutes().toString().padStart(2, '0');
    return `${hour}:${minute}`;
  }
  return null;
}

function sanitizeHorariosPayload(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const dia = normalizeDiaValue(item.dia || item.diaSemana || item.day);
      if (!dia || !HORARIO_DIAS.includes(dia)) return null;
      const tipo = normalizeHorarioTipo(item.tipoJornada || item.tipo || item.categoria);
      const modalidade = tipo ? normalizeHorarioModalidade(tipo, item.modalidade || item.modalidadeJornada || item.jornada || item.escala) : null;
      const horaInicio = sanitizeHorarioTime(item.horaInicio || item.inicio || item.horarioInicio);
      const horaFim = sanitizeHorarioTime(item.horaFim || item.termino || item.horarioFim);
      const almocoInicio = sanitizeHorarioTime(item.almocoInicio || item.intervaloInicio || item.almoco);
      const almocoFim = sanitizeHorarioTime(item.almocoFim || item.intervaloFim);
      if (!(tipo || modalidade || horaInicio || horaFim || almocoInicio || almocoFim)) return null;
      const horario = { dia };
      if (tipo) horario.tipoJornada = tipo;
      if (modalidade && HORARIO_MODALIDADES.includes(modalidade)) horario.modalidade = modalidade;
      if (horaInicio) horario.horaInicio = horaInicio;
      if (horaFim) horario.horaFim = horaFim;
      if (almocoInicio) horario.almocoInicio = almocoInicio;
      if (almocoFim) horario.almocoFim = almocoFim;
      return horario;
    })
    .filter(Boolean);
}

function normName(u) {
  return (
    (u.nomeCompleto && String(u.nomeCompleto).trim()) ||
    (u.nomeContato && String(u.nomeContato).trim()) ||
    (u.razaoSocial && String(u.razaoSocial).trim()) ||
    ''
  );
}

function userToDTO(u) {
  return {
    _id: u._id,
    email: u.email,
    role: u.role,
    tipoConta: u.tipoConta,
    celular: u.celular,
    telefone: u.telefone,
    cpf: u.cpf,
    cnpj: u.cnpj,
    nome: normName(u),
    grupos: Array.isArray(u.grupos) ? u.grupos : [],
    empresas: Array.isArray(u.empresas) ? u.empresas : [],
    genero: u.genero || '',
    dataNascimento: u.dataNascimento || null,
    racaCor: u.racaCor || '',
    deficiencia: u.deficiencia || '',
    estadoCivil: u.estadoCivil || '',
    rgEmissao: u.rgEmissao || null,
    rgNumero: u.rgNumero || '',
    rgOrgaoExpedidor: u.rgOrgaoExpedidor || '',
    situacao: u.situacao || 'ativo',
    dataCadastro: u.dataCadastro || u.criadoEm || null,
    criadoEm: u.criadoEm || null,
    periodoExperienciaInicio: u.periodoExperienciaInicio || null,
    periodoExperienciaFim: u.periodoExperienciaFim || null,
    dataAdmissao: u.dataAdmissao || null,
    diasProrrogacaoExperiencia: typeof u.diasProrrogacaoExperiencia === 'number'
      ? u.diasProrrogacaoExperiencia
      : null,
    exameMedico: u.exameMedico || null,
    dataDemissao: u.dataDemissao || null,
    cargoCarteira: u.cargoCarteira || '',
    habilitacaoNumero: u.habilitacaoNumero || '',
    habilitacaoCategoria: u.habilitacaoCategoria || '',
    habilitacaoOrgaoEmissor: u.habilitacaoOrgaoEmissor || '',
    habilitacaoValidade: u.habilitacaoValidade || null,
    nomeMae: u.nomeMae || '',
    nascimentoMae: u.nascimentoMae || null,
    nomeConjuge: u.nomeConjuge || '',
    formaPagamento: u.formaPagamento || '',
    tipoContrato: u.tipoContrato || '',
    salarioContratual: typeof u.salarioContratual === 'number' ? u.salarioContratual : null,
    horasSemanais: typeof u.horasSemanais === 'number' ? u.horasSemanais : null,
    horasMensais: typeof u.horasMensais === 'number' ? u.horasMensais : null,
    passagensPorDia: typeof u.passagensPorDia === 'number' ? u.passagensPorDia : null,
    valorPassagem: typeof u.valorPassagem === 'number' ? u.valorPassagem : null,
    banco: u.banco || '',
    tipoContaBancaria: u.tipoContaBancaria || '',
    agencia: u.agencia || '',
    conta: u.conta || '',
    tipoChavePix: u.tipoChavePix || '',
    chavePix: u.chavePix || '',
    cursos: Array.isArray(u.cursos)
      ? u.cursos.map((curso) => ({
          _id: curso?._id ? String(curso._id) : null,
          nome: curso?.nome || '',
          data: curso?.data || null,
          situacao: curso?.situacao || '',
          observacao: curso?.observacao || '',
        }))
      : [],
    horarios: Array.isArray(u.horarios)
      ? u.horarios.map((horario) => ({
          dia: horario?.dia || '',
          tipoJornada: horario?.tipoJornada || '',
          modalidade: horario?.modalidade || '',
          horaInicio: horario?.horaInicio || '',
          horaFim: horario?.horaFim || '',
          almocoInicio: horario?.almocoInicio || '',
          almocoFim: horario?.almocoFim || '',
        }))
      : [],
  };
}

function requireAdmin(req, res, next) {
  const role = req.user?.role;
  if (role === 'admin' || role === 'admin_master') return next();
  return res.status(403).json({ message: 'Acesso negado. Apenas administradores.' });
}

function canChangeRole(actorRole, targetRole, desiredRole) {
  const a = roleRank[actorRole] ?? -1;
  const t = roleRank[targetRole] ?? -1;
  const d = roleRank[desiredRole] ?? -1;
  if (actorRole === 'admin_master') return true;
  if (actorRole === 'admin') {
    // admin só mexe em quem está abaixo e só pode definir "funcionario"
    return t < roleRank.admin && d < roleRank.admin;
  }
  return false;
}

// ================== ROTAS ==================

// LISTAR quadro (inclui admin_master, admin e funcionário) com ordenação
router.get('/', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const users = await User
      .find(
        { role: { $in: ['admin_master', 'admin', 'funcionario'] } },
        'nomeCompleto nomeContato razaoSocial email role tipoConta celular telefone cpf cnpj grupos empresas genero dataNascimento racaCor deficiencia estadoCivil situacao criadoEm dataCadastro periodoExperienciaInicio periodoExperienciaFim dataAdmissao diasProrrogacaoExperiencia exameMedico dataDemissao cargoCarteira nomeMae nascimentoMae nomeConjuge formaPagamento tipoContrato salarioContratual horasSemanais horasMensais passagensPorDia valorPassagem banco tipoContaBancaria agencia conta tipoChavePix chavePix cursos horarios'
      )
      .lean();

    // Ordenar: Admin Master > Admin > Funcionário; depois por nome
    users.sort((a, b) => {
      const r = (roleRank[b.role] ?? -1) - (roleRank[a.role] ?? -1);
      if (r !== 0) return r;
      const an = normName(a).toLocaleLowerCase('pt-BR');
      const bn = normName(b).toLocaleLowerCase('pt-BR');
      return an.localeCompare(bn);
    });

    res.json(users.map(userToDTO));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erro ao buscar funcionários.' });
  }
});

// ------- rotas específicas ANTES de "/:id" -------

// BUSCAR usuários (exclui quem já está no quadro)
// GET /api/admin/funcionarios/buscar-usuarios?q=...&limit=5
router.get('/buscar-usuarios', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const { q = '', limit = 5 } = req.query;
    const lim = Math.min(parseInt(limit, 10) || 5, 10);

    const safe = String(q || '');
    const regex = safe ? new RegExp(escapeRegex(safe), 'i') : null;
    const digits = safe.replace(/\D/g, '');

    const or = [];
    if (regex) {
      or.push({ nomeCompleto: regex }, { nomeContato: regex }, { razaoSocial: regex });
      or.push({ email: regex });
    }
    if (digits.length >= 3) {
      const dRe = new RegExp(digits);
      or.push({ cpf: dRe }, { cnpj: dRe });
    }

    // base: NÃO trazer quem já está no quadro (funcionario, admin, admin_master)
    const base = { role: { $nin: ['funcionario', 'admin', 'admin_master'] } };
    const filter = or.length ? { ...base, $or: or } : base;

    const users = await User
      .find(
        filter,
        'nomeCompleto nomeContato razaoSocial email role tipoConta celular telefone cpf cnpj grupos genero dataNascimento racaCor deficiencia estadoCivil situacao criadoEm dataCadastro periodoExperienciaInicio periodoExperienciaFim dataAdmissao diasProrrogacaoExperiencia exameMedico dataDemissao cargoCarteira nomeMae nascimentoMae nomeConjuge formaPagamento tipoContrato salarioContratual horasSemanais horasMensais passagensPorDia valorPassagem banco tipoContaBancaria agencia conta tipoChavePix chavePix cursos horarios'
      )
      .sort({ createdAt: -1 })
      .limit(lim)
      .lean();

    res.json(users.map(userToDTO));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erro na busca de usuários.' });
  }
});

// TRANSFORMAR usuário (policy aplicada)
router.post('/transformar', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const { userId, role = 'funcionario' } = req.body;
    if (!userId) return res.status(400).json({ message: 'userId é obrigatório.' });
    if (!['funcionario', 'admin', 'admin_master'].includes(role)) {
      return res.status(400).json({ message: 'Cargo inválido.' });
    }

    const actorRole = req.user?.role;
    const target = await User.findById(userId, 'role');
    if (!target) return res.status(404).json({ message: 'Usuário não encontrado.' });

    if (!canChangeRole(actorRole, target.role, role)) {
      return res.status(403).json({ message: 'Você não tem permissão para alterar este cargo.' });
    }

    target.role = role;
    await target.save();

    const ret = await User.findById(
      userId,
      'nomeCompleto nomeContato razaoSocial email role tipoConta celular telefone cpf cnpj grupos empresas genero dataNascimento racaCor deficiencia estadoCivil rgEmissao rgNumero rgOrgaoExpedidor situacao criadoEm dataCadastro periodoExperienciaInicio periodoExperienciaFim dataAdmissao diasProrrogacaoExperiencia exameMedico dataDemissao cargoCarteira habilitacaoNumero habilitacaoCategoria habilitacaoOrgaoEmissor habilitacaoValidade nomeMae nascimentoMae nomeConjuge formaPagamento tipoContrato salarioContratual horasSemanais horasMensais passagensPorDia valorPassagem banco tipoContaBancaria agencia conta tipoChavePix chavePix cursos horarios'
    ).lean();
    res.json({ message: 'Usuário transformado com sucesso.', funcionario: userToDTO(ret) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erro ao transformar usuário.' });
  }
});

// ------- rotas com parâmetro DEPOIS das específicas -------

// OBTÉM um funcionário
router.get('/:id', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const u = await User.findById(
      req.params.id,
      'nomeCompleto nomeContato razaoSocial email role tipoConta celular telefone cpf cnpj grupos empresas genero dataNascimento racaCor deficiencia estadoCivil rgEmissao rgNumero rgOrgaoExpedidor situacao criadoEm dataCadastro periodoExperienciaInicio periodoExperienciaFim dataAdmissao diasProrrogacaoExperiencia exameMedico dataDemissao cargoCarteira habilitacaoNumero habilitacaoCategoria habilitacaoOrgaoEmissor habilitacaoValidade nomeMae nascimentoMae nomeConjuge formaPagamento tipoContrato salarioContratual horasSemanais horasMensais passagensPorDia valorPassagem banco tipoContaBancaria agencia conta tipoChavePix chavePix cursos horarios'
    ).lean();
    if (!u || !['admin_master', 'admin', 'funcionario'].includes(u.role)) {
      return res.status(404).json({ message: 'Funcionário não encontrado.' });
    }
    res.json(userToDTO(u));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erro ao buscar funcionário.' });
  }
});

// CRIA funcionário (novo usuário)
router.post('/', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const { nome, nomeCompleto, nomeContato, razaoSocial, email, senha, role, tipoConta, celular, telefone, grupos } = req.body;

    if (!email || !senha || !celular) {
      return res.status(400).json({ message: 'Email, senha e celular são obrigatórios.' });
    }
    const cargo = role || 'funcionario';
    if (!['admin', 'funcionario'].includes(cargo)) {
      return res.status(400).json({ message: 'Cargo inválido.' });
    }

    const existe = await User.findOne({ email });
    if (existe) return res.status(400).json({ message: 'Email já cadastrado.' });

    const hash = await bcrypt.hash(senha, 10);
    const conta = (tipoConta === 'pessoa_juridica') ? 'pessoa_juridica' : 'pessoa_fisica';

    const doc = { tipoConta: conta, email, senha: hash, celular, role: cargo };
    if (telefone) doc.telefone = telefone;
    if (conta === 'pessoa_juridica') {
      doc.nomeContato = (nomeContato || nome || '').trim();
      if (razaoSocial) doc.razaoSocial = razaoSocial.trim();
    } else {
      doc.nomeCompleto = (nomeCompleto || nome || '').trim();
    }

    if (typeof req.body.genero !== 'undefined') {
      doc.genero = (req.body.genero || '').trim();
    } else if (typeof req.body.sexo !== 'undefined') {
      doc.genero = (req.body.sexo || '').trim();
    }

    if (Object.prototype.hasOwnProperty.call(req.body, 'dataNascimento')) {
      doc.dataNascimento = parseDate(req.body.dataNascimento);
    }
    const racaCor = parseEnum(req.body.racaCor, RACA_COR_OPCOES);
    if (racaCor !== undefined) {
      doc.racaCor = racaCor;
    }
    const deficiencia = parseEnum(req.body.deficiencia, DEFICIENCIA_OPCOES);
    if (deficiencia !== undefined) {
      doc.deficiencia = deficiencia;
    }
    const estadoCivil = parseEnum(req.body.estadoCivil, ESTADO_CIVIL_OPCOES);
    if (estadoCivil !== undefined) {
      doc.estadoCivil = estadoCivil;
    }

    if (Object.prototype.hasOwnProperty.call(req.body, 'rgEmissao')) {
      doc.rgEmissao = parseDate(req.body.rgEmissao);
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'rgNumero')) {
      const rgNumero = (req.body.rgNumero || '').trim();
      doc.rgNumero = rgNumero || null;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'rgOrgaoExpedidor')) {
      const rgOrgao = (req.body.rgOrgaoExpedidor || '').trim();
      doc.rgOrgaoExpedidor = rgOrgao || null;
    }

    if (Object.prototype.hasOwnProperty.call(req.body, 'cpf')) {
      const cpfDigits = String(req.body.cpf || '').replace(/\D/g, '');
      doc.cpf = cpfDigits || null;
    }

    const ALLOWED_GROUPS = ['gerente','vendedor','esteticista','veterinario'];
    let gruposArr = [];
    if (Array.isArray(grupos)) gruposArr = grupos;
    else if (typeof grupos === 'string' && grupos) gruposArr = [grupos];
    gruposArr = [...new Set(gruposArr.filter(g => ALLOWED_GROUPS.includes(g)))];
    doc.grupos = gruposArr;

    // Empresas (lojas): aceita array/string de IDs; valida ObjectId e existência
    let empresasArr = [];
    if (Array.isArray(req.body.empresas)) empresasArr = req.body.empresas;
    else if (typeof req.body.empresas === 'string' && req.body.empresas) empresasArr = [req.body.empresas];
    empresasArr = [...new Set(empresasArr)].filter(id => mongoose.Types.ObjectId.isValid(id));
    if (empresasArr.length) {
      const exists = await Store.find({ _id: { $in: empresasArr } }).select('_id').lean();
      const foundIds = new Set(exists.map(e => String(e._id)));
      empresasArr = empresasArr.filter(id => foundIds.has(String(id)));
    }
    doc.empresas = empresasArr;

    if (Object.prototype.hasOwnProperty.call(req.body, 'periodoExperienciaInicio')) {
      doc.periodoExperienciaInicio = parseDate(req.body.periodoExperienciaInicio);
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'periodoExperienciaFim')) {
      doc.periodoExperienciaFim = parseDate(req.body.periodoExperienciaFim);
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'dataAdmissao')) {
      doc.dataAdmissao = parseDate(req.body.dataAdmissao);
    }
    const diasProrrogacao = parseNumber(req.body.diasProrrogacaoExperiencia, { min: 0 });
    if (diasProrrogacao !== undefined) {
      doc.diasProrrogacaoExperiencia = diasProrrogacao;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'exameMedico')) {
      doc.exameMedico = parseDate(req.body.exameMedico);
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'dataDemissao')) {
      doc.dataDemissao = parseDate(req.body.dataDemissao);
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'cargoCarteira')) {
      const cargo = (req.body.cargoCarteira || '').trim();
      doc.cargoCarteira = cargo || null;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'habilitacaoNumero')) {
      const habilitacaoNumero = (req.body.habilitacaoNumero || '').trim();
      doc.habilitacaoNumero = habilitacaoNumero || null;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'habilitacaoCategoria')) {
      const categoria = (req.body.habilitacaoCategoria || '').trim();
      doc.habilitacaoCategoria = categoria || null;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'habilitacaoOrgaoEmissor')) {
      const orgao = (req.body.habilitacaoOrgaoEmissor || '').trim();
      doc.habilitacaoOrgaoEmissor = orgao || null;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'habilitacaoValidade')) {
      doc.habilitacaoValidade = parseDate(req.body.habilitacaoValidade);
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'nomeMae')) {
      const nomeMae = (req.body.nomeMae || '').trim();
      doc.nomeMae = nomeMae || null;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'nascimentoMae')) {
      doc.nascimentoMae = parseDate(req.body.nascimentoMae);
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'nomeConjuge')) {
      const nomeConjuge = (req.body.nomeConjuge || '').trim();
      doc.nomeConjuge = nomeConjuge || null;
    }
    const formaPagamento = parseEnum(req.body.formaPagamento, ['mensal', 'quinzenal', 'semanal', 'diaria']);
    if (formaPagamento !== undefined) {
      doc.formaPagamento = formaPagamento;
    }
    const tipoContrato = parseEnum(req.body.tipoContrato, ['clt', 'mei', 'estagiario', 'temporario', 'avulso']);
    if (tipoContrato !== undefined) {
      doc.tipoContrato = tipoContrato;
    }
    const salarioContratual = parseNumber(req.body.salarioContratual, { allowFloat: true, min: 0 });
    if (salarioContratual !== undefined) {
      doc.salarioContratual = salarioContratual;
    }
    const horasSemanais = parseNumber(req.body.horasSemanais, { allowFloat: true, min: 0 });
    if (horasSemanais !== undefined) {
      doc.horasSemanais = horasSemanais;
    }
    const horasMensais = parseNumber(req.body.horasMensais, { allowFloat: true, min: 0 });
    if (horasMensais !== undefined) {
      doc.horasMensais = horasMensais;
    }
    const passagensPorDia = parseNumber(req.body.passagensPorDia, { min: 0 });
    if (passagensPorDia !== undefined) {
      doc.passagensPorDia = passagensPorDia;
    }
    const valorPassagem = parseNumber(req.body.valorPassagem, { allowFloat: true, min: 0 });
    if (valorPassagem !== undefined) {
      doc.valorPassagem = valorPassagem;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'banco')) {
      const banco = (req.body.banco || '').trim();
      doc.banco = banco || null;
    }
    const tipoContaBancaria = parseEnum(req.body.tipoContaBancaria, ['corrente', 'poupanca', 'cartao_salario', 'conta_salario']);
    if (tipoContaBancaria !== undefined) {
      doc.tipoContaBancaria = tipoContaBancaria;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'agencia')) {
      const agencia = (req.body.agencia || '').trim();
      doc.agencia = agencia || null;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'conta')) {
      const conta = (req.body.conta || '').trim();
      doc.conta = conta || null;
    }
    const tipoChavePix = parseEnum(req.body.tipoChavePix, ['cpf', 'cnpj', 'email', 'telefone']);
    if (tipoChavePix !== undefined) {
      doc.tipoChavePix = tipoChavePix;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'chavePix')) {
      const chavePix = (req.body.chavePix || '').trim();
      doc.chavePix = chavePix || null;
    }

    if (Object.prototype.hasOwnProperty.call(req.body, 'cursos')) {
      doc.cursos = sanitizeCursosPayload(req.body.cursos);
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'horarios')) {
      doc.horarios = sanitizeHorariosPayload(req.body.horarios);
    }

    const novo = await User.create(doc);
    res.status(201).json({ message: 'Funcionário criado com sucesso.', id: novo._id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erro ao criar funcionário.' });
  }
});

// ATUALIZA funcionário (policy aplicada para mudar role)
router.put('/:id', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const { nome, nomeCompleto, nomeContato, razaoSocial, email, senha, role, tipoConta, celular, telefone, grupos } = req.body;

    const target = await User.findById(req.params.id, 'role');
    if (!target) return res.status(404).json({ message: 'Funcionário não encontrado.' });

    const update = {};
    if (email) update.email = email;
    if (celular) update.celular = celular;
    if (typeof telefone !== 'undefined') update.telefone = telefone || '';

    if (role) {
      if (!['admin', 'funcionario', 'admin_master'].includes(role)) {
        return res.status(400).json({ message: 'Cargo inválido.' });
      }
      if (!canChangeRole(req.user?.role, target.role, role)) {
        return res.status(403).json({ message: 'Você não tem permissão para alterar este cargo.' });
      }
      update.role = role;
    }

    if (typeof grupos !== 'undefined') {
      const ALLOWED_GROUPS = ['gerente','vendedor','esteticista','veterinario'];
      let arr = [];
      if (Array.isArray(grupos)) arr = grupos;
      else if (typeof grupos === 'string' && grupos) arr = [grupos];
      arr = [...new Set(arr.filter(g => ALLOWED_GROUPS.includes(g)))];
      update.grupos = arr;

      if (typeof req.body.empresas !== 'undefined') {
        let arr = [];
        if (Array.isArray(req.body.empresas)) arr = req.body.empresas;
        else if (typeof req.body.empresas === 'string' && req.body.empresas) arr = [req.body.empresas];
        arr = [...new Set(arr)].filter(id => mongoose.Types.ObjectId.isValid(id));
        if (arr.length) {
          const exists = await Store.find({ _id: { $in: arr } }).select('_id').lean();
          const foundIds = new Set(exists.map(e => String(e._id)));
          arr = arr.filter(id => foundIds.has(String(id)));
        }
        update.empresas = arr;
      }
    }

    const conta = (tipoConta === 'pessoa_juridica') ? 'pessoa_juridica' : undefined;
    if (conta === 'pessoa_juridica') {
      if (nomeContato || nome) update.nomeContato = (nomeContato || nome).trim();
      if (razaoSocial) update.razaoSocial = razaoSocial.trim();
    } else {
      if (nomeCompleto || nome) update.nomeCompleto = (nomeCompleto || nome).trim();
    }

    if (senha && senha.length >= 8) update.senha = await bcrypt.hash(senha, 10);

    if (Object.prototype.hasOwnProperty.call(req.body, 'rgEmissao')) {
      update.rgEmissao = parseDate(req.body.rgEmissao);
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'rgNumero')) {
      const rgNumero = (req.body.rgNumero || '').trim();
      update.rgNumero = rgNumero || null;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'rgOrgaoExpedidor')) {
      const rgOrgao = (req.body.rgOrgaoExpedidor || '').trim();
      update.rgOrgaoExpedidor = rgOrgao || null;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'cpf')) {
      const cpfDigits = String(req.body.cpf || '').replace(/\D/g, '');
      update.cpf = cpfDigits || null;
    }

    if (typeof req.body.genero !== 'undefined') {
      update.genero = (req.body.genero || '').trim();
    } else if (typeof req.body.sexo !== 'undefined') {
      update.genero = (req.body.sexo || '').trim();
    }

    if (Object.prototype.hasOwnProperty.call(req.body, 'dataNascimento')) {
      update.dataNascimento = parseDate(req.body.dataNascimento);
    }
    const racaCorUpdate = parseEnum(req.body.racaCor, RACA_COR_OPCOES);
    if (racaCorUpdate !== undefined) {
      update.racaCor = racaCorUpdate;
    }
    const deficienciaUpdate = parseEnum(req.body.deficiencia, DEFICIENCIA_OPCOES);
    if (deficienciaUpdate !== undefined) {
      update.deficiencia = deficienciaUpdate;
    }
    const estadoCivilUpdate = parseEnum(req.body.estadoCivil, ESTADO_CIVIL_OPCOES);
    if (estadoCivilUpdate !== undefined) {
      update.estadoCivil = estadoCivilUpdate;
    }

    if (Object.prototype.hasOwnProperty.call(req.body, 'periodoExperienciaInicio')) {
      update.periodoExperienciaInicio = parseDate(req.body.periodoExperienciaInicio);
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'periodoExperienciaFim')) {
      update.periodoExperienciaFim = parseDate(req.body.periodoExperienciaFim);
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'dataAdmissao')) {
      update.dataAdmissao = parseDate(req.body.dataAdmissao);
    }
    const diasProrrogacao = parseNumber(req.body.diasProrrogacaoExperiencia, { min: 0 });
    if (diasProrrogacao !== undefined) {
      update.diasProrrogacaoExperiencia = diasProrrogacao;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'exameMedico')) {
      update.exameMedico = parseDate(req.body.exameMedico);
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'dataDemissao')) {
      update.dataDemissao = parseDate(req.body.dataDemissao);
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'cargoCarteira')) {
      const cargo = (req.body.cargoCarteira || '').trim();
      update.cargoCarteira = cargo || null;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'habilitacaoNumero')) {
      const habilitacaoNumero = (req.body.habilitacaoNumero || '').trim();
      update.habilitacaoNumero = habilitacaoNumero || null;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'habilitacaoCategoria')) {
      const categoria = (req.body.habilitacaoCategoria || '').trim();
      update.habilitacaoCategoria = categoria || null;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'habilitacaoOrgaoEmissor')) {
      const orgao = (req.body.habilitacaoOrgaoEmissor || '').trim();
      update.habilitacaoOrgaoEmissor = orgao || null;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'habilitacaoValidade')) {
      update.habilitacaoValidade = parseDate(req.body.habilitacaoValidade);
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'nomeMae')) {
      const nomeMae = (req.body.nomeMae || '').trim();
      update.nomeMae = nomeMae || null;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'nascimentoMae')) {
      update.nascimentoMae = parseDate(req.body.nascimentoMae);
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'nomeConjuge')) {
      const nomeConjuge = (req.body.nomeConjuge || '').trim();
      update.nomeConjuge = nomeConjuge || null;
    }
    const formaPagamento = parseEnum(req.body.formaPagamento, ['mensal', 'quinzenal', 'semanal', 'diaria']);
    if (formaPagamento !== undefined) {
      update.formaPagamento = formaPagamento;
    }
    const tipoContrato = parseEnum(req.body.tipoContrato, ['clt', 'mei', 'estagiario', 'temporario', 'avulso']);
    if (tipoContrato !== undefined) {
      update.tipoContrato = tipoContrato;
    }
    const salarioContratual = parseNumber(req.body.salarioContratual, { allowFloat: true, min: 0 });
    if (salarioContratual !== undefined) {
      update.salarioContratual = salarioContratual;
    }
    const horasSemanais = parseNumber(req.body.horasSemanais, { allowFloat: true, min: 0 });
    if (horasSemanais !== undefined) {
      update.horasSemanais = horasSemanais;
    }
    const horasMensais = parseNumber(req.body.horasMensais, { allowFloat: true, min: 0 });
    if (horasMensais !== undefined) {
      update.horasMensais = horasMensais;
    }
    const passagensPorDia = parseNumber(req.body.passagensPorDia, { min: 0 });
    if (passagensPorDia !== undefined) {
      update.passagensPorDia = passagensPorDia;
    }
    const valorPassagem = parseNumber(req.body.valorPassagem, { allowFloat: true, min: 0 });
    if (valorPassagem !== undefined) {
      update.valorPassagem = valorPassagem;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'banco')) {
      const banco = (req.body.banco || '').trim();
      update.banco = banco || null;
    }
    const tipoContaBancaria = parseEnum(req.body.tipoContaBancaria, ['corrente', 'poupanca', 'cartao_salario', 'conta_salario']);
    if (tipoContaBancaria !== undefined) {
      update.tipoContaBancaria = tipoContaBancaria;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'agencia')) {
      const agencia = (req.body.agencia || '').trim();
      update.agencia = agencia || null;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'conta')) {
      const conta = (req.body.conta || '').trim();
      update.conta = conta || null;
    }
    const tipoChavePix = parseEnum(req.body.tipoChavePix, ['cpf', 'cnpj', 'email', 'telefone']);
    if (tipoChavePix !== undefined) {
      update.tipoChavePix = tipoChavePix;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'chavePix')) {
      const chavePix = (req.body.chavePix || '').trim();
      update.chavePix = chavePix || null;
    }

    if (Object.prototype.hasOwnProperty.call(req.body, 'cursos')) {
      update.cursos = sanitizeCursosPayload(req.body.cursos);
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'horarios')) {
      update.horarios = sanitizeHorariosPayload(req.body.horarios);
    }

    const updated = await User.findByIdAndUpdate(
      req.params.id,
      update,
      { new: true, runValidators: true, fields: 'nomeCompleto nomeContato razaoSocial email role tipoConta celular telefone cpf cnpj grupos empresas genero dataNascimento racaCor deficiencia estadoCivil rgEmissao rgNumero rgOrgaoExpedidor situacao criadoEm dataCadastro periodoExperienciaInicio periodoExperienciaFim dataAdmissao diasProrrogacaoExperiencia exameMedico dataDemissao cargoCarteira habilitacaoNumero habilitacaoCategoria habilitacaoOrgaoEmissor habilitacaoValidade nomeMae nascimentoMae nomeConjuge formaPagamento tipoContrato salarioContratual horasSemanais horasMensais passagensPorDia valorPassagem banco tipoContaBancaria agencia conta tipoChavePix chavePix cursos horarios' }
    ).lean();

    res.json({ message: 'Funcionário atualizado com sucesso.', funcionario: userToDTO(updated) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erro ao atualizar funcionário.' });
  }
});

// REMOVER do quadro (rebaixa para cliente) com policy
router.delete('/:id', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const actorRole = req.user?.role;
    const target = await User.findById(req.params.id, 'role');
    if (!target) return res.status(404).json({ message: 'Funcionário não encontrado.' });

    if (!(actorRole === 'admin_master' || (actorRole === 'admin' && roleRank[target.role] < roleRank.admin))) {
      return res.status(403).json({ message: 'Você não tem permissão para remover este usuário do quadro.' });
    }

    target.role = 'cliente';
    await target.save();
    res.json({ message: 'Funcionário removido com sucesso.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erro ao remover funcionário.' });
  }
});

module.exports = router;
