const express = require('express');
const router = express.Router();

const EmployeeGroup = require('../models/EmployeeGroup');
const authMiddleware = require('../middlewares/authMiddleware');

function requireAdmin(req, res, next) {
  const role = req.user?.role;
  if (role === 'admin' || role === 'admin_master') return next();
  return res.status(403).json({ message: 'Acesso negado. Apenas administradores.' });
}

async function calcularProximoCodigo() {
  const ultimo = await EmployeeGroup.findOne({}).sort({ codigo: -1 }).select('codigo').lean();
  return (ultimo?.codigo || 0) + 1;
}

router.get('/proximo-codigo', authMiddleware, requireAdmin, async (_req, res) => {
  try {
    const codigo = await calcularProximoCodigo();
    return res.json({ codigo });
  } catch (err) {
    console.error('GET /admin/funcionarios/grupos/proximo-codigo', err);
    return res.status(500).json({ message: 'Erro ao calcular próximo código.' });
  }
});

router.get('/', authMiddleware, requireAdmin, async (_req, res) => {
  try {
    const lista = await EmployeeGroup.find({}).sort({ codigo: 1 }).lean();
    return res.json(lista);
  } catch (err) {
    console.error('GET /admin/funcionarios/grupos', err);
    return res.status(500).json({ message: 'Erro ao listar grupos.' });
  }
});

router.get('/:id', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const item = await EmployeeGroup.findById(req.params.id).lean();
    if (!item) return res.status(404).json({ message: 'Grupo não encontrado.' });
    return res.json(item);
  } catch (err) {
    console.error('GET /admin/funcionarios/grupos/:id', err);
    return res.status(500).json({ message: 'Erro ao carregar grupo.' });
  }
});

router.post('/', authMiddleware, requireAdmin, async (req, res) => {
  try {
    let { nome, descricao } = req.body;
    nome = (nome || '').trim();
    descricao = (descricao || '').trim();

    if (!nome) return res.status(400).json({ message: 'Informe o nome do grupo.' });

    const codigo = await calcularProximoCodigo();

    try {
      const created = await EmployeeGroup.create({ codigo, nome, descricao });
      return res.status(201).json(created);
    } catch (err) {
      if (err?.code === 11000) {
        if (err?.keyPattern?.nome) {
          return res.status(409).json({ message: 'Já existe um grupo com este nome.' });
        }
        if (err?.keyPattern?.codigo) {
          const novoCodigo = await calcularProximoCodigo();
          const created = await EmployeeGroup.create({ codigo: novoCodigo, nome, descricao });
          return res.status(201).json(created);
        }
      }
      throw err;
    }
  } catch (err) {
    console.error('POST /admin/funcionarios/grupos', err);
    return res.status(500).json({ message: 'Erro ao criar grupo.' });
  }
});

router.put('/:id', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const update = {};

    if (typeof req.body.nome !== 'undefined') {
      const nome = String(req.body.nome || '').trim();
      if (!nome) return res.status(400).json({ message: 'Nome não pode ser vazio.' });
      update.nome = nome;
    }

    if (typeof req.body.descricao !== 'undefined') {
      update.descricao = String(req.body.descricao || '').trim();
    }

    const saved = await EmployeeGroup.findByIdAndUpdate(
      req.params.id,
      { $set: update },
      { new: true, runValidators: true }
    );

    if (!saved) return res.status(404).json({ message: 'Grupo não encontrado.' });
    return res.json(saved);
  } catch (err) {
    if (err?.code === 11000) {
      return res.status(409).json({ message: 'Já existe um grupo com este nome.' });
    }
    console.error('PUT /admin/funcionarios/grupos/:id', err);
    return res.status(500).json({ message: 'Erro ao atualizar grupo.' });
  }
});

router.delete('/:id', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const deleted = await EmployeeGroup.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ message: 'Grupo não encontrado.' });
    return res.json({ deleted: true });
  } catch (err) {
    console.error('DELETE /admin/funcionarios/grupos/:id', err);
    return res.status(500).json({ message: 'Erro ao remover grupo.' });
  }
});

module.exports = router;
