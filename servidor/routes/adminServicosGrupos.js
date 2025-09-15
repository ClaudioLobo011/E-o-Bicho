const express = require('express');
const router = express.Router();

const ServiceGroup = require('../models/ServiceGroup');
const { STAFF_TYPES } = require('../models/ServiceGroup');

const authMiddleware = require('../middlewares/authMiddleware');

// === MANTER O MESMO PADRÃO DAS ROTAS DE ADMIN ===
function requireAdmin(req, res, next) {
  const role = req.user?.role;
  if (role === 'admin' || role === 'admin_master') return next();
  return res.status(403).json({ message: 'Acesso negado. Apenas administradores.' });
}

// LISTAR
router.get('/', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const items = await ServiceGroup.find({}).sort({ nome: 1 }).lean();
    return res.json(items);
  } catch (e) {
    console.error('GET /admin/servicos/grupos', e);
    return res.status(500).json({ message: 'Erro ao listar grupos' });
  }
});

// OBTER POR ID
router.get('/:id', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const item = await ServiceGroup.findById(req.params.id).lean();
    if (!item) return res.status(404).json({ message: 'Grupo não encontrado' });
    return res.json(item);
  } catch (e) {
    console.error('GET /admin/servicos/grupos/:id', e);
    return res.status(500).json({ message: 'Erro ao obter grupo' });
  }
});

// CRIAR
router.post('/', authMiddleware, requireAdmin, async (req, res) => {
  try {
    let { nome, tiposPermitidos, comissaoPercent } = req.body;

    nome = (nome || '').trim();
    if (!nome) return res.status(400).json({ message: 'Informe o nome do grupo.' });

    let tipos = [];
    if (Array.isArray(tiposPermitidos)) tipos = tiposPermitidos;
    else if (typeof tiposPermitidos === 'string') tipos = [tiposPermitidos];

    tipos = [...new Set(tipos.map(t => String(t).toLowerCase()).filter(t => STAFF_TYPES.includes(t)))];
    if (!tipos.length) return res.status(400).json({ message: 'Selecione ao menos um tipo de funcionário.' });

    const comissao = Number(comissaoPercent ?? 0);
    if (Number.isNaN(comissao) || comissao < 0 || comissao > 100) {
      return res.status(400).json({ message: 'Comissão deve estar entre 0 e 100.' });
    }

    const created = await ServiceGroup.create({
      nome,
      tiposPermitidos: tipos,
      comissaoPercent: comissao
    });
    return res.status(201).json(created);
  } catch (e) {
    if (e?.code === 11000) {
      return res.status(409).json({ message: 'Já existe um grupo com este nome.' });
    }
    console.error('POST /admin/servicos/grupos', e);
    return res.status(500).json({ message: 'Erro ao criar grupo' });
  }
});

// ATUALIZAR
router.put('/:id', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const update = {};
    if (typeof req.body.nome !== 'undefined') {
      update.nome = String(req.body.nome || '').trim();
      if (!update.nome) return res.status(400).json({ message: 'Nome do grupo não pode ser vazio.' });
    }

    if (typeof req.body.tiposPermitidos !== 'undefined') {
      let tipos = [];
      if (Array.isArray(req.body.tiposPermitidos)) tipos = req.body.tiposPermitidos;
      else if (typeof req.body.tiposPermitidos === 'string') tipos = [req.body.tiposPermitidos];
      tipos = [...new Set(tipos.map(t => String(t).toLowerCase()).filter(t => STAFF_TYPES.includes(t)))];
      if (!tipos.length) return res.status(400).json({ message: 'Selecione ao menos um tipo de funcionário.' });
      update.tiposPermitidos = tipos;
    }

    if (typeof req.body.comissaoPercent !== 'undefined') {
      const c = Number(req.body.comissaoPercent);
      if (Number.isNaN(c) || c < 0 || c > 100) {
        return res.status(400).json({ message: 'Comissão deve estar entre 0 e 100.' });
      }
      update.comissaoPercent = c;
    }

    const saved = await ServiceGroup.findByIdAndUpdate(
      req.params.id,
      { $set: update },
      { new: true, runValidators: true }
    );

    if (!saved) return res.status(404).json({ message: 'Grupo não encontrado' });
    return res.json(saved);
  } catch (e) {
    if (e?.code === 11000) {
      return res.status(409).json({ message: 'Já existe um grupo com este nome.' });
    }
    console.error('PUT /admin/servicos/grupos/:id', e);
    return res.status(500).json({ message: 'Erro ao atualizar grupo' });
  }
});

// REMOVER
router.delete('/:id', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const del = await ServiceGroup.findByIdAndDelete(req.params.id);
    if (!del) return res.status(404).json({ message: 'Grupo não encontrado' });
    return res.json({ deleted: true });
  } catch (e) {
    console.error('DELETE /admin/servicos/grupos/:id', e);
    return res.status(500).json({ message: 'Erro ao remover grupo' });
  }
});

module.exports = router;