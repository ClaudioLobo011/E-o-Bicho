const express = require('express');
const router = express.Router();

const ServiceModel = require('../models/Service');
const ServiceGroup = require('../models/ServiceGroup');
const authMiddleware = require('../middlewares/authMiddleware');

const STAFF_ROLES = new Set(['funcionario', 'franqueado', 'franqueador', 'admin', 'admin_master']);

const Service = ServiceModel;
const { PORTES, CATEGORIES: SERVICE_CATEGORIES } = ServiceModel;

// Apenas administradores
function requireAdmin(req, res, next) {
  const role = req.user?.role;
  if (role && STAFF_ROLES.has(role)) return next();
  return res.status(403).json({ message: 'Acesso negado. Apenas administradores.' });
}

function parsePorte(input) {
  // aceita body.porte (array|string) ou body.portes (alias)
  const raw = typeof input?.porte !== 'undefined' ? input.porte : input?.portes;
  let arr = Array.isArray(raw) ? raw : (raw != null ? [raw] : []);
  arr = arr.map(v => String(v)).filter(Boolean);
  // remove duplicados
  arr = [...new Set(arr)];
  if (arr.length === 0) return ['Todos'];
  // valida e normaliza "Todos"
  for (const p of arr) {
    if (!PORTES.includes(p)) throw new Error('Porte inválido.');
  }
  return arr.includes('Todos') ? ['Todos'] : arr;
}

const CATEGORIES_SET = new Set(SERVICE_CATEGORIES || []);

function parseCategorias(input) {
  const raw = typeof input?.categorias !== 'undefined'
    ? input.categorias
    : (typeof input?.categoria !== 'undefined' ? input.categoria : []);
  let arr = Array.isArray(raw) ? raw : (raw != null ? [raw] : []);
  arr = arr.map(v => String(v).trim()).filter(Boolean);
  if (arr.some(v => !CATEGORIES_SET.has(v))) {
    throw new Error('Categorias inválidas.');
  }
  return [...new Set(arr)];
}

// LISTAR
router.get('/', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const items = await Service.find({})
      .populate('grupo')
      .sort({ nome: 1 })
      .lean();
    res.json(items);
  } catch (e) {
    console.error('GET /admin/servicos', e);
    res.status(500).json({ message: 'Erro ao listar serviços' });
  }
});

// OBTER POR ID
router.get('/:id', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const item = await Service.findById(req.params.id).populate('grupo').lean();
    if (!item) return res.status(404).json({ message: 'Serviço não encontrado' });
    res.json(item);
  } catch (e) {
    console.error('GET /admin/servicos/:id', e);
    res.status(500).json({ message: 'Erro ao carregar serviço' });
  }
});

function validarPayload(body, isUpdate = false) {
  const erros = [];
  const out = {};

  if (!isUpdate || typeof body.nome !== 'undefined') {
    const nome = String(body.nome || '').trim();
    if (!nome) erros.push('Nome obrigatório.');
    else out.nome = nome;
  }

  if (!isUpdate || typeof body.grupo !== 'undefined') {
    const grpId = String(body.grupo || '').trim();
    if (!grpId) erros.push('Grupo obrigatório.');
    else out.grupo = grpId;
  }

  if (!isUpdate || typeof body.duracaoMinutos !== 'undefined') {
    const dur = Number(body.duracaoMinutos);
    if (!Number.isInteger(dur) || dur < 1 || dur > 600) erros.push('Duração deve estar entre 1 e 600 minutos.');
    else out.duracaoMinutos = dur;
  }

  if (!isUpdate || typeof body.custo !== 'undefined') {
    const custo = Number(body.custo);
    if (Number.isNaN(custo) || custo < 0) erros.push('Custo inválido.');
    else out.custo = custo;
  }

  if (!isUpdate || typeof body.valor !== 'undefined') {
    const valor = Number(body.valor);
    if (Number.isNaN(valor) || valor < 0) erros.push('Valor inválido.');
    else out.valor = valor;
  }

  if (!isUpdate || typeof body.porte !== 'undefined' || typeof body.portes !== 'undefined') {
    try {
      out.porte = parsePorte(body);
    } catch (e) {
      erros.push(e.message || 'Porte inválido.');
    }
  }

  if (!isUpdate || typeof body.categorias !== 'undefined' || typeof body.categoria !== 'undefined') {
    try {
      out.categorias = parseCategorias(body);
    } catch (e) {
      erros.push(e.message || 'Categorias inválidas.');
    }
  }

  return { ok: erros.length === 0, erros, out };
}

// CRIAR
router.post('/', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const v = validarPayload(req.body, false);
    if (!v.ok) return res.status(400).json({ message: v.erros.join(' ') });

    const grpExists = await ServiceGroup.exists({ _id: v.out.grupo });
    if (!grpExists) return res.status(400).json({ message: 'Grupo inexistente.' });

    const created = await Service.create(v.out);
    const full = await Service.findById(created._id).populate('grupo').lean();
    res.status(201).json(full);
  } catch (e) {
    console.error('POST /admin/servicos', e);
    res.status(500).json({ message: 'Erro ao criar serviço' });
  }
});

// ATUALIZAR
router.put('/:id', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const v = validarPayload(req.body, true);
    if (!v.ok) return res.status(400).json({ message: v.erros.join(' ') });

    if (typeof v.out.grupo !== 'undefined') {
      const grpExists = await ServiceGroup.exists({ _id: v.out.grupo });
      if (!grpExists) return res.status(400).json({ message: 'Grupo inexistente.' });
    }

    const updated = await Service.findByIdAndUpdate(
      req.params.id,
      v.out,
      { new: true, runValidators: true }
    ).populate('grupo');

    if (!updated) return res.status(404).json({ message: 'Serviço não encontrado' });
    res.json(updated);
  } catch (e) {
    console.error('PUT /admin/servicos/:id', e);
    res.status(500).json({ message: 'Erro ao atualizar serviço' });
  }
});

// REMOVER
router.delete('/:id', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const del = await Service.findByIdAndDelete(req.params.id);
    if (!del) return res.status(404).json({ message: 'Serviço não encontrado' });
    res.json({ deleted: true });
  } catch (e) {
    console.error('DELETE /admin/servicos/:id', e);
    res.status(500).json({ message: 'Erro ao remover serviço' });
  }
});

module.exports = router;
