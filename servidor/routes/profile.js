// servidor/routes/profile.js
const express = require('express');
const router = express.Router();

const authMiddleware = require('../middlewares/authMiddleware');
const User = require('../models/User');

// Normaliza o "nome" para front (PF/PJ)
function userToDTO(u) {
  const nomeNorm =
    (u.nomeCompleto && String(u.nomeCompleto).trim()) ||
    (u.nomeContato && String(u.nomeContato).trim()) ||
    (u.razaoSocial && String(u.razaoSocial).trim()) ||
    '';

  const empresas = Array.isArray(u.empresas)
    ? u.empresas
        .filter(Boolean)
        .map((empresa) => ({
          _id: empresa?._id || empresa,
          nome: empresa?.nome || empresa?.nomeFantasia || empresa?.razaoSocial || '',
        }))
        .filter((empresa) => String(empresa.nome || '').trim())
    : [];

  const empresaPrincipal = u.empresaPrincipal
    ? {
        _id: u.empresaPrincipal?._id || u.empresaPrincipal,
        nome:
          u.empresaPrincipal?.nome ||
          u.empresaPrincipal?.nomeFantasia ||
          u.empresaPrincipal?.razaoSocial ||
          '',
      }
    : null;

  return {
    _id: u._id,
    email: u.email,
    role: u.role,
    tipoConta: u.tipoConta,
    celular: u.celular,
    cpf: u.cpf,
    cnpj: u.cnpj,
    nome: nomeNorm,
    empresas,
    empresaPrincipal,
  };
}

// GET /api/profile/me  -> retorna usuario logado (token)
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const u = await User.findById(
      req.user?.id,
      'nomeCompleto nomeContato razaoSocial email role tipoConta celular cpf cnpj empresas empresaPrincipal'
    )
      .populate('empresas', 'nome nomeFantasia razaoSocial')
      .populate('empresaPrincipal', 'nome nomeFantasia razaoSocial')
      .lean();

    if (!u) return res.status(404).json({ message: 'Usuario nao encontrado.' });
    return res.json(userToDTO(u));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Erro ao obter perfil.' });
  }
});

module.exports = router;
