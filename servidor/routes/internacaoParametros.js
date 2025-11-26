const express = require('express');
const mongoose = require('mongoose');
const InternacaoParametro = require('../models/InternacaoParametro');
const requireAuth = require('../middlewares/requireAuth');
const authorizeRoles = require('../middlewares/authorizeRoles');

const router = express.Router();
const allowedRoles = ['funcionario', 'admin', 'admin_master'];

const sanitizeText = (value, { fallback = '' } = {}) => {
  if (value === undefined || value === null) return fallback;
  const normalized = String(value).trim();
  return normalized || fallback;
};

const sanitizeArray = (value) => {
  if (Array.isArray(value)) {
    const unique = new Set();
    return value
      .map((item) => sanitizeText(item))
      .filter((item) => {
        if (!item || unique.has(item)) return false;
        unique.add(item);
        return true;
      });
  }
  const text = sanitizeText(value);
  return text ? [text] : [];
};

const formatParametro = (record) => ({
  id: record?._id?.toString() || record?.id || '',
  nome: sanitizeText(record?.nome),
  ordem: Number.isFinite(record?.ordem) ? Number(record.ordem) : null,
  opcoes: Array.isArray(record?.opcoes) ? record.opcoes.filter(Boolean) : [],
  createdAt: record?.createdAt || null,
  updatedAt: record?.updatedAt || null,
});

const findParametroOr404 = async (id, res) => {
  if (!mongoose.isValidObjectId(id)) {
    res.status(404).json({ message: 'Parâmetro não encontrado.' });
    return null;
  }

  const record = await InternacaoParametro.findById(id);
  if (!record) {
    res.status(404).json({ message: 'Parâmetro não encontrado.' });
    return null;
  }

  return record;
};

router.use(requireAuth);
router.use(authorizeRoles(...allowedRoles));

router.get('/', async (_req, res) => {
  try {
    const parametros = await InternacaoParametro.find().lean();
    const sorted = parametros.sort((a, b) => {
      const ordemA = Number.isFinite(a?.ordem) ? Number(a.ordem) : null;
      const ordemB = Number.isFinite(b?.ordem) ? Number(b.ordem) : null;

      if (ordemA !== null && ordemB !== null) return ordemA - ordemB;
      if (ordemA !== null) return -1;
      if (ordemB !== null) return 1;
      return sanitizeText(a?.nome).localeCompare(sanitizeText(b?.nome), 'pt-BR');
    });
    return res.json(sorted.map(formatParametro));
  } catch (error) {
    console.error('internacao: falha ao listar parâmetros clínicos', error);
    return res.status(500).json({ message: 'Não foi possível carregar os parâmetros clínicos.' });
  }
});

router.post('/', async (req, res) => {
  try {
    const parsedOrder = Number.parseInt(req.body?.ordem, 10);
    const payload = {
      nome: sanitizeText(req.body?.nome),
      ordem: Number.isInteger(parsedOrder) && parsedOrder > 0 ? parsedOrder : null,
      opcoes: sanitizeArray(req.body?.opcoes),
    };

    if (!payload.nome) {
      return res.status(400).json({ message: 'Informe o nome do parâmetro clínico.' });
    }

    if (!payload.opcoes.length) {
      return res.status(400).json({ message: 'Adicione pelo menos uma opção de resposta.' });
    }

    if (payload.ordem !== null) {
      const conflito = await InternacaoParametro.findOne({ ordem: payload.ordem });
      if (conflito) {
        return res.status(409).json({ message: 'Já existe um parâmetro com essa ordem.' });
      }
    }

    const record = await InternacaoParametro.create(payload);
    return res.status(201).json(formatParametro(record));
  } catch (error) {
    console.error('internacao: falha ao criar parâmetro clínico', error);
    if (error?.code === 11000) {
      return res.status(409).json({ message: 'Já existe um parâmetro com essa ordem.' });
    }
    return res.status(500).json({ message: 'Não foi possível salvar o parâmetro clínico.' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const record = await findParametroOr404(req.params.id, res);
    if (!record) return;

    const parsedOrder = Number.parseInt(req.body?.ordem, 10);
    const payload = {
      nome: sanitizeText(req.body?.nome),
      ordem: Number.isInteger(parsedOrder) && parsedOrder > 0 ? parsedOrder : null,
      opcoes: sanitizeArray(req.body?.opcoes),
    };

    if (!payload.nome) {
      return res.status(400).json({ message: 'Informe o nome do parâmetro clínico.' });
    }

    if (!payload.opcoes.length) {
      return res.status(400).json({ message: 'Adicione pelo menos uma opção de resposta.' });
    }

    if (payload.ordem !== null) {
      const conflito = await InternacaoParametro.findOne({ ordem: payload.ordem, _id: { $ne: record._id } });
      if (conflito) {
        return res.status(409).json({ message: 'Já existe um parâmetro com essa ordem.' });
      }
    }

    record.nome = payload.nome;
    record.ordem = payload.ordem;
    record.opcoes = payload.opcoes;
    await record.save();

    return res.json(formatParametro(record));
  } catch (error) {
    console.error('internacao: falha ao atualizar parâmetro clínico', error);
    if (error?.code === 11000) {
      return res.status(409).json({ message: 'Já existe um parâmetro com essa ordem.' });
    }
    return res.status(500).json({ message: 'Não foi possível atualizar o parâmetro clínico.' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const record = await findParametroOr404(req.params.id, res);
    if (!record) return;

    await record.deleteOne();
    return res.status(204).send();
  } catch (error) {
    console.error('internacao: falha ao excluir parâmetro clínico', error);
    return res.status(500).json({ message: 'Não foi possível excluir o parâmetro clínico.' });
  }
});

module.exports = router;
