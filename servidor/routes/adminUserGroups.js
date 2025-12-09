const express = require('express');
const router = express.Router();

const UserGroup = require('../models/UserGroup');
const authMiddleware = require('../middlewares/authMiddleware');

function requireAdmin(req, res, next) {
  const role = req.user?.role;
  if (role === 'admin' || role === 'admin_master') return next();
  return res.status(403).json({ message: 'Acesso negado. Apenas administradores.' });
}

async function getNextCode() {
  const last = await UserGroup.findOne({}, { codigo: 1 }).sort({ codigo: -1 }).lean();
  return (last?.codigo || 0) + 1;
}

router.get('/', authMiddleware, requireAdmin, async (_req, res) => {
  try {
    const items = await UserGroup.find({}).sort({ codigo: 1 }).lean();
    return res.json(items);
  } catch (e) {
    console.error('GET /admin/grupos-usuarios', e);
    return res.status(500).json({ message: 'Erro ao listar grupos' });
  }
});

router.post('/', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const nome = (req.body.nome || '').trim();
    if (!nome) return res.status(400).json({ message: 'Informe o nome do grupo.' });

    const comissao = Number(req.body.comissaoPercent ?? req.body.comissao ?? 0);
    if (!Number.isFinite(comissao) || comissao < 0 || comissao > 100) {
      return res.status(400).json({ message: 'A comissão deve estar entre 0 e 100%.' });
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const codigo = await getNextCode();
        const created = await UserGroup.create({ codigo, nome, comissaoPercent: comissao });
        return res.status(201).json(created);
      } catch (err) {
        if (err?.code === 11000) {
          // Em caso de condição de corrida, tenta novamente.
          continue;
        }
        throw err;
      }
    }

    return res.status(409).json({ message: 'Não foi possível gerar um código único. Tente novamente.' });
  } catch (e) {
    if (e?.code === 11000) {
      return res.status(409).json({ message: 'Não foi possível salvar: código duplicado.' });
    }
    console.error('POST /admin/grupos-usuarios', e);
    return res.status(500).json({ message: 'Erro ao criar grupo' });
  }
});

module.exports = router;
