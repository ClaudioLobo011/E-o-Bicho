const express = require('express');
const InternacaoBox = require('../models/InternacaoBox');
const InternacaoRegistro = require('../models/InternacaoRegistro');
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
    return value
      .map((item) => sanitizeText(item))
      .filter((item, index, arr) => item && arr.indexOf(item) === index);
  }
  const text = sanitizeText(value);
  return text ? [text] : [];
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

const formatRegistro = (doc) => {
  if (!doc) return null;
  const plain = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  return {
    id: String(plain._id || plain.id || '').trim(),
    codigo: plain.codigo || null,
    petId: sanitizeText(plain.petId),
    petNome: sanitizeText(plain.petNome),
    petEspecie: sanitizeText(plain.petEspecie),
    petRaca: sanitizeText(plain.petRaca),
    petPeso: sanitizeText(plain.petPeso),
    petIdade: sanitizeText(plain.petIdade),
    tutorNome: sanitizeText(plain.tutorNome),
    tutorDocumento: sanitizeText(plain.tutorDocumento),
    tutorContato: sanitizeText(plain.tutorContato),
    situacao: sanitizeText(plain.situacao),
    situacaoCodigo: sanitizeText(plain.situacaoCodigo),
    risco: sanitizeText(plain.risco),
    riscoCodigo: sanitizeText(plain.riscoCodigo),
    veterinario: sanitizeText(plain.veterinario),
    box: sanitizeText(plain.box),
    altaPrevistaData: sanitizeText(plain.altaPrevistaData),
    altaPrevistaHora: sanitizeText(plain.altaPrevistaHora),
    queixa: sanitizeText(plain.queixa),
    diagnostico: sanitizeText(plain.diagnostico),
    prognostico: sanitizeText(plain.prognostico),
    alergias: sanitizeArray(plain.alergias),
    acessorios: sanitizeText(plain.acessorios),
    observacoes: sanitizeText(plain.observacoes),
    admissao: plain.createdAt || null,
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

router.get('/registros', async (req, res) => {
  try {
    const registros = await InternacaoRegistro.find().sort({ createdAt: -1 }).lean();
    return res.json(registros.map(formatRegistro).filter(Boolean));
  } catch (error) {
    console.error('internacao: falha ao listar internações', error);
    return res.status(500).json({ message: 'Não foi possível carregar as internações.' });
  }
});

router.post('/registros', async (req, res) => {
  try {
    const payload = {
      petId: sanitizeText(req.body?.petId),
      petNome: sanitizeText(req.body?.petNome),
      petEspecie: sanitizeText(req.body?.petEspecie),
      petRaca: sanitizeText(req.body?.petRaca),
      petPeso: sanitizeText(req.body?.petPeso),
      petIdade: sanitizeText(req.body?.petIdade),
      tutorNome: sanitizeText(req.body?.tutorNome),
      tutorDocumento: sanitizeText(req.body?.tutorDocumento),
      tutorContato: sanitizeText(req.body?.tutorContato),
      situacao: sanitizeText(req.body?.situacao),
      situacaoCodigo: sanitizeText(req.body?.situacaoCodigo),
      risco: sanitizeText(req.body?.risco),
      riscoCodigo: sanitizeText(req.body?.riscoCodigo),
      veterinario: sanitizeText(req.body?.veterinario),
      box: sanitizeText(req.body?.box),
      altaPrevistaData: sanitizeText(req.body?.altaPrevistaData),
      altaPrevistaHora: sanitizeText(req.body?.altaPrevistaHora),
      queixa: sanitizeText(req.body?.queixa),
      diagnostico: sanitizeText(req.body?.diagnostico),
      prognostico: sanitizeText(req.body?.prognostico),
      alergias: sanitizeArray(req.body?.alergias),
      acessorios: sanitizeText(req.body?.acessorios),
      observacoes: sanitizeText(req.body?.observacoes),
    };

    if (!payload.petNome) {
      return res.status(400).json({ message: 'Selecione um paciente válido antes de salvar.' });
    }

    const lastRegistro = await InternacaoRegistro.findOne().sort({ codigo: -1 }).lean();
    const nextCodigo = (lastRegistro?.codigo || 0) + 1;

    const record = await InternacaoRegistro.create({ ...payload, codigo: nextCodigo });
    return res.status(201).json(formatRegistro(record));
  } catch (error) {
    console.error('internacao: falha ao salvar internação', error);
    if (error?.name === 'ValidationError') {
      return res.status(400).json({ message: 'Revise as informações preenchidas antes de salvar.' });
    }
    if (error?.code === 11000) {
      return res.status(409).json({ message: 'Não foi possível gerar o código interno da internação. Tente novamente.' });
    }
    return res.status(500).json({ message: 'Não foi possível registrar a internação.' });
  }
});

module.exports = router;
