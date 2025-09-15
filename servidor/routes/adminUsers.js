const express = require('express');
const router = express.Router();
const User = require('../models/User');
const requireAuth = require('../middlewares/requireAuth');
const authorizeRoles = require('../middlewares/authorizeRoles');

// Listar todos usuários (somente admin_master)
router.get('/', requireAuth, authorizeRoles('admin_master'), async (req, res) => {
  try {
    const users = await User.find({}, 'nomeCompleto username email role createdAt updatedAt');
    res.json(users);
  } catch (error) {
    console.error('Erro ao listar usuários:', error);
    res.status(500).json({ message: 'Erro ao listar usuários' });
  }
});

// Atualizar role de usuário (somente admin_master)
router.put('/:id/role', requireAuth, authorizeRoles('admin_master'), async (req, res) => {
  const { role } = req.body;
  if (!['admin_master', 'admin', 'funcionario', 'cliente'].includes(role)) {
    return res.status(400).json({ message: 'Role inválida' });
  }
  try {
    const updated = await User.findByIdAndUpdate(
      req.params.id,
      { role },
      { new: true, runValidators: true }
    ).select('nomeCompleto username email role');
    if (!updated) return res.status(404).json({ message: 'Usuário não encontrado' });
    res.json(updated);
  } catch (error) {
    console.error('Erro ao atualizar role:', error);
    res.status(500).json({ message: 'Erro ao atualizar role' });
  }
});

module.exports = router;
