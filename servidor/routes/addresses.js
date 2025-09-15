const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const UserAddress = require('../models/UserAddress');
const requireAuth = require('../middlewares/requireAuth');

// GET /api/addresses/:userId -> lista endereços do usuário
router.get('/:userId', requireAuth, async (req, res) => {
  try {
    const { userId } = req.params;

    if (!mongoose.isValidObjectId(userId)) {
      return res.status(400).json({ message: 'userId inválido' });
    }

    // só o próprio usuário ou admin_master pode acessar
    if (req.user.id !== userId && req.user.role !== 'admin_master') {
      return res.status(403).json({ message: 'Acesso negado' });
    }

    const addresses = await UserAddress.find({ user: userId }).sort({ isDefault: -1, updatedAt: -1 });
    res.json(addresses);
  } catch (err) {
    console.error('Erro ao buscar endereços:', err);
    res.status(500).json({ message: 'Erro no servidor' });
  }
});

// POST /api/addresses -> cria endereço (com deduplicação básica)
router.post('/', requireAuth, async (req, res) => {
  try {
    const { userId, apelido, cep, logradouro, numero, complemento, bairro, cidade, uf, ibge, isDefault } = req.body;

    if (!userId || !cep) {
      return res.status(400).json({ message: 'userId e cep são obrigatórios' });
    }
    if (!mongoose.isValidObjectId(userId)) {
      return res.status(400).json({ message: 'userId inválido' });
    }

    // só o próprio usuário ou admin_master pode criar
    if (req.user.id !== userId && req.user.role !== 'admin_master') {
      return res.status(403).json({ message: 'Acesso negado' });
    }

    // Deduplicação: mesmo user + mesmo endereço (campos-chave)
    const existing = await UserAddress.findOne({
      user: userId,
      cep,
      logradouro,
      numero,
      complemento: complemento || '',
      bairro,
      cidade,
      uf
    });

    if (existing) {
      if (isDefault) {
        await UserAddress.updateMany({ user: userId, isDefault: true }, { $set: { isDefault: false } });
        if (!existing.isDefault) {
          existing.isDefault = true;
          await existing.save();
        }
      }
      return res.status(200).json(existing);
    }

    if (isDefault) {
      await UserAddress.updateMany({ user: userId, isDefault: true }, { $set: { isDefault: false } });
    }

    const addr = await UserAddress.create({
      user: userId,
      apelido: apelido || 'Principal',
      cep,
      logradouro: logradouro || '',
      numero: numero || '',
      complemento: complemento || '',
      bairro: bairro || '',
      cidade: cidade || '',
      uf: uf || '',
      ibge: ibge || '',
      isDefault: isDefault !== false
    });

    res.status(201).json(addr);
  } catch (err) {
    console.error('Erro ao criar endereço:', err);
    res.status(500).json({ message: 'Erro no servidor' });
  }
});

module.exports = router;
