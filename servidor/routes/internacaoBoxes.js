const express = require('express');
const InternacaoBox = require('../models/InternacaoBox');
const requireAuth = require('../middlewares/requireAuth');
const authorizeRoles = require('../middlewares/authorizeRoles');

const router = express.Router();
const allowedRoles = ['funcionario', 'admin', 'admin_master'];

const sanitizeText = (value, { fallback = '' } = {}) => {
  if (value === undefined || value === null) return fallback;
  const normalized = String(value).trim();
  return normalized || fallback;
};

const formatBox = (doc) => {
  if (!doc) return null;
  const plain = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  const ocupante = sanitizeText(plain.ocupante, { fallback: 'Livre' });
  return {
    id: String(plain._id || plain.id || plain.box || '').trim(),
    box: sanitizeText(plain.box),
    ocupante,
    status: sanitizeText(plain.status, { fallback: ocupante === 'Livre' ? 'Disponível' : 'Em uso' }),
    especialidade: sanitizeText(plain.especialidade),
    higienizacao: sanitizeText(plain.higienizacao, { fallback: '—' }),
    observacao: sanitizeText(plain.observacao),
    createdAt: plain.createdAt || null,
    updatedAt: plain.updatedAt || null,
  };
};

router.use(requireAuth);
router.use(authorizeRoles(...allowedRoles));

router.get('/boxes', async (req, res) => {
  try {
    const boxes = await InternacaoBox.find().sort({ createdAt: -1 }).lean();
    return res.json(boxes.map(formatBox).filter(Boolean));
  } catch (error) {
    console.error('internacao: falha ao listar boxes', error);
    return res.status(500).json({ message: 'Não foi possível carregar os boxes.' });
  }
});

router.post('/boxes', async (req, res) => {
  try {
    const payload = {
      box: sanitizeText(req.body?.box),
      ocupante: sanitizeText(req.body?.ocupante, { fallback: 'Livre' }),
      status: sanitizeText(req.body?.status),
      especialidade: sanitizeText(req.body?.especialidade),
      higienizacao: sanitizeText(req.body?.higienizacao, { fallback: '—' }),
      observacao: sanitizeText(req.body?.observacao),
    };

    if (!payload.box) {
      return res.status(400).json({ message: 'Informe o identificador do box.' });
    }

    if (!payload.status) {
      payload.status = payload.ocupante === 'Livre' ? 'Disponível' : 'Em uso';
    }

    const record = await InternacaoBox.create(payload);
    return res.status(201).json(formatBox(record));
  } catch (error) {
    console.error('internacao: falha ao criar box', error);
    if (error?.name === 'ValidationError') {
      return res.status(400).json({ message: 'Verifique os dados informados para o box.' });
    }
    return res.status(500).json({ message: 'Não foi possível salvar o box.' });
  }
});

module.exports = router;
