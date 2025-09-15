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

  return {
    _id: u._id,
    email: u.email,
    role: u.role,
    tipoConta: u.tipoConta,
    celular: u.celular,
    cpf: u.cpf,
    cnpj: u.cnpj,
    nome: nomeNorm,
  };
}

// GET /api/profile/me  -> retorna usuário logado (token)
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const u = await User.findById(
      req.user?.id,
      'nomeCompleto nomeContato razaoSocial email role tipoConta celular cpf cnpj'
    ).lean();

    if (!u) return res.status(404).json({ message: 'Usuário não encontrado.' });
    return res.json(userToDTO(u));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Erro ao obter perfil.' });
  }
});

module.exports = router;
