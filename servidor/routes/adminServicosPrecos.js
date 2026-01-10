const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();

const Service = require('../models/Service');
const Store = require('../models/Store');
const ServiceBreedPrice = require('../models/ServiceBreedPrice');
const authMiddleware = require('../middlewares/authMiddleware');

const STAFF_ROLES = new Set(['funcionario', 'franqueado', 'franqueador', 'admin', 'admin_master']);

function requireAdmin(req, res, next) {
  const role = req.user?.role;
  if (role && STAFF_ROLES.has(role)) return next();
  return res.status(403).json({ message: 'Acesso negado. Apenas administradores.' });
}

// GET /api/admin/servicos/precos?serviceId=&storeId=&tipo=
router.get('/', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const { serviceId, storeId, tipo } = req.query;
    const filter = {};
    if (serviceId) {
      if (!mongoose.Types.ObjectId.isValid(serviceId)) return res.status(400).json({ message: 'serviceId inválido.' });
      filter.service = serviceId;
    }
    if (storeId) {
      if (!mongoose.Types.ObjectId.isValid(storeId)) return res.status(400).json({ message: 'storeId inválido.' });
      filter.store = storeId;
    }
    if (tipo) filter.tipo = String(tipo).trim();
    const items = await ServiceBreedPrice.find(filter).sort({ raca: 1 }).lean();
    res.json(items.map(it => ({
      _id: it._id,
      service: String(it.service),
      store: String(it.store),
      tipo: it.tipo,
      raca: it.raca,
      custo: Number(it.custo || 0),
      valor: Number(it.valor || 0)
    })));
  } catch (e) {
    console.error('GET /admin/servicos/precos', e);
    res.status(500).json({ message: 'Erro ao listar preços por raça' });
  }
});

// PUT /api/admin/servicos/precos/bulk
// { serviceId, storeId, tipo, items: [{ raca, custo, valor }, ...] }
router.put('/bulk', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const { serviceId, storeId, tipo, items } = req.body || {};
    if (!serviceId || !mongoose.Types.ObjectId.isValid(serviceId)) {
      return res.status(400).json({ message: 'serviceId obrigatório.' });
    }
    if (!storeId || !mongoose.Types.ObjectId.isValid(storeId)) {
      return res.status(400).json({ message: 'storeId obrigatório.' });
    }
    const t = String(tipo || '').trim();
    if (!t) return res.status(400).json({ message: 'tipo obrigatório.' });
    if (!Array.isArray(items)) return res.status(400).json({ message: 'items deve ser array.' });

    // Valida existência de referências básicas
    const [svc, st] = await Promise.all([
      Service.exists({ _id: serviceId }),
      Store.exists({ _id: storeId })
    ]);
    if (!svc) return res.status(400).json({ message: 'Serviço inexistente.' });
    if (!st) return res.status(400).json({ message: 'Empresa inexistente.' });

    const ops = [];
    for (const it of items) {
      const raca = String(it?.raca || '').trim();
      if (!raca) continue;
      const custo = Number(it?.custo || 0);
      const valor = Number(it?.valor || 0);
      ops.push({
        updateOne: {
          filter: { service: serviceId, store: storeId, tipo: t, raca },
          update: { $set: { custo, valor } },
          upsert: true
        }
      });
    }
    if (!ops.length) return res.json({ updated: 0 });
    const resBulk = await ServiceBreedPrice.bulkWrite(ops, { ordered: false });
    res.json({
      updated: (resBulk.nModified || 0) + (resBulk.nUpserted || 0),
      upserts: resBulk.upsertedCount || 0,
      modified: resBulk.modifiedCount || resBulk.nModified || 0
    });
  } catch (e) {
    console.error('PUT /admin/servicos/precos/bulk', e);
    let msg = 'Erro ao salvar preços';
    if (e?.code === 11000) msg = 'Conflito de duplicidade (service+store+tipo+raca).';
    res.status(500).json({ message: msg });
  }
});

module.exports = router;
