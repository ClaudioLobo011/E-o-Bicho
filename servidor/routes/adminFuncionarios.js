const express = require('express');
const bcrypt = require('bcrypt'); // npm i bcrypt
const router = express.Router();

const User = require('../models/User');
const authMiddleware = require('../middlewares/authMiddleware');
const mongoose = require('mongoose');
const Store = require('../models/Store');

// ----- helpers / policies -----
const roleRank = { cliente: 0, funcionario: 1, admin: 2, admin_master: 3 };

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
    cpf: u.cpf,
    cnpj: u.cnpj,
    nome: normName(u),
    grupos: Array.isArray(u.grupos) ? u.grupos : [],
    empresas: Array.isArray(u.empresas) ? u.empresas : [],
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
        'nomeCompleto nomeContato razaoSocial email role tipoConta celular cpf cnpj grupos empresas'
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
        'nomeCompleto nomeContato razaoSocial email role tipoConta celular cpf cnpj grupos'
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
      'nomeCompleto nomeContato razaoSocial email role tipoConta celular cpf cnpj grupos' // +grupos
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
      'nomeCompleto nomeContato razaoSocial email role tipoConta celular cpf cnpj grupos empresas'
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
    const { nome, nomeCompleto, nomeContato, razaoSocial, email, senha, role, tipoConta, celular, grupos } = req.body;

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
    if (conta === 'pessoa_juridica') {
      doc.nomeContato = (nomeContato || nome || '').trim();
      if (razaoSocial) doc.razaoSocial = razaoSocial.trim();
    } else {
      doc.nomeCompleto = (nomeCompleto || nome || '').trim();
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
    const { nome, nomeCompleto, nomeContato, razaoSocial, email, senha, role, tipoConta, celular, grupos } = req.body;

    const target = await User.findById(req.params.id, 'role');
    if (!target) return res.status(404).json({ message: 'Funcionário não encontrado.' });

    const update = {};
    if (email) update.email = email;
    if (celular) update.celular = celular;

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

    const updated = await User.findByIdAndUpdate(
      req.params.id,
      update,
      { new: true, runValidators: true, fields: 'nomeCompleto nomeContato razaoSocial email role tipoConta celular cpf cnpj grupos' }
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
