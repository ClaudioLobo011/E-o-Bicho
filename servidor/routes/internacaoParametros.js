const express = require('express');
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
  ordem: Number(record?.ordem) || null,
  opcoes: Array.isArray(record?.opcoes) ? record.opcoes.filter(Boolean) : [],
  createdAt: record?.createdAt || null,
  updatedAt: record?.updatedAt || null,
});

router.use(requireAuth);
router.use(authorizeRoles(...allowedRoles));

router.get('/', async (_req, res) => {
  try {
    const parametros = await InternacaoParametro.find().sort({ ordem: 1, createdAt: 1 }).lean();
    return res.json(parametros.map(formatParametro));
  } catch (error) {
    console.error('internacao: falha ao listar parâmetros clínicos', error);
    return res.status(500).json({ message: 'Não foi possível carregar os parâmetros clínicos.' });
  }
});

router.post('/', async (req, res) => {
  try {
    const payload = {
      nome: sanitizeText(req.body?.nome),
      ordem: Number.parseInt(req.body?.ordem, 10),
      opcoes: sanitizeArray(req.body?.opcoes),
    };

    if (!payload.nome) {
      return res.status(400).json({ message: 'Informe o nome do parâmetro clínico.' });
    }

    if (!Number.isInteger(payload.ordem) || payload.ordem < 1) {
      return res
        .status(400)
        .json({ message: 'Defina a ordem utilizando um número inteiro maior ou igual a 1.' });
    }

    if (!payload.opcoes.length) {
      return res.status(400).json({ message: 'Adicione pelo menos uma opção de resposta.' });
    }

    const conflito = await InternacaoParametro.findOne({ ordem: payload.ordem });
    if (conflito) {
      return res.status(409).json({ message: 'Já existe um parâmetro com essa ordem.' });
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

module.exports = router;
