const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const UserAddress = require('../models/UserAddress');
const requireAuth = require('../middlewares/requireAuth');

const STAFF_ROLES = new Set(['funcionario', 'franqueado', 'franqueador', 'admin', 'admin_master']);

function canManageOtherAddresses(user, ownerId) {
  if (!user) return false;
  if (user.id === String(ownerId)) return true;
  return STAFF_ROLES.has(user.role);
}

// GET /api/addresses/:userId -> lista endereços do usuário
router.get('/:userId', requireAuth, async (req, res) => {
  try {
    const { userId } = req.params;

    if (!mongoose.isValidObjectId(userId)) {
      return res.status(400).json({ message: 'userId inválido' });
    }

    // só o próprio usuário ou administradores podem acessar
    if (!canManageOtherAddresses(req.user, userId)) {
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

    // só o próprio usuário ou administradores podem criar
    if (!canManageOtherAddresses(req.user, userId)) {
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

// PUT /api/addresses/:id -> atualiza um endereço existente
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ message: 'Endereço inválido' });
    }

    const addr = await UserAddress.findById(id);
    if (!addr) {
      return res.status(404).json({ message: 'Endereço não encontrado' });
    }

    if (!canManageOtherAddresses(req.user, addr.user)) {
      return res.status(403).json({ message: 'Acesso negado' });
    }

    const {
      apelido,
      cep,
      logradouro,
      numero,
      complemento,
      bairro,
      cidade,
      uf,
      ibge,
      isDefault,
    } = req.body || {};

    if (typeof apelido !== 'undefined') addr.apelido = (apelido || 'Principal').trim();
    if (typeof cep !== 'undefined') addr.cep = cep;
    if (typeof logradouro !== 'undefined') addr.logradouro = logradouro || '';
    if (typeof numero !== 'undefined') addr.numero = numero || '';
    if (typeof complemento !== 'undefined') addr.complemento = complemento || '';
    if (typeof bairro !== 'undefined') addr.bairro = bairro || '';
    if (typeof cidade !== 'undefined') addr.cidade = cidade || '';
    if (typeof uf !== 'undefined') addr.uf = uf || '';
    if (typeof ibge !== 'undefined') addr.ibge = ibge || '';

    if (typeof isDefault === 'boolean') {
      if (isDefault) {
        await UserAddress.updateMany({ user: addr.user, _id: { $ne: addr._id } }, { $set: { isDefault: false } });
      }
      addr.isDefault = isDefault;
    }

    await addr.save();
    const refreshed = await UserAddress.findById(id);
    res.json(refreshed);
  } catch (err) {
    console.error('Erro ao atualizar endereço:', err);
    res.status(500).json({ message: 'Erro no servidor' });
  }
});

// DELETE /api/addresses/:id -> remove um endereço
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ message: 'Endereço inválido' });
    }

    const addr = await UserAddress.findById(id);
    if (!addr) {
      return res.status(404).json({ message: 'Endereço não encontrado' });
    }

    if (!canManageOtherAddresses(req.user, addr.user)) {
      return res.status(403).json({ message: 'Acesso negado' });
    }

    await addr.deleteOne();
    res.json({ message: 'Endereço removido com sucesso.' });
  } catch (err) {
    console.error('Erro ao remover endereço:', err);
    res.status(500).json({ message: 'Erro no servidor' });
  }
});

module.exports = router;
