const express = require('express');
const router = express.Router();
const Pdv = require('../models/Pdv');
const Store = require('../models/Store');
const requireAuth = require('../middlewares/requireAuth');
const authorizeRoles = require('../middlewares/authorizeRoles');

const ambientesPermitidos = ['homologacao', 'producao'];
const ambientesSet = new Set(ambientesPermitidos);

const normalizeString = (value) => {
  if (value === undefined || value === null) return '';
  return String(value).trim();
};

const parseBoolean = (value) => {
  if (typeof value === 'boolean') return value;
  if (value === undefined || value === null) return false;
  const normalized = String(value).trim().toLowerCase();
  return ['1', 'true', 'on', 'yes', 'sim'].includes(normalized);
};

const parseNumber = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const extractNumericValue = (code) => {
  const normalized = normalizeString(code);
  if (!normalized) return 0;
  const matches = normalized.match(/\d+/g);
  if (!matches) {
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return matches.reduce((max, part) => {
    const parsed = Number(part);
    return Number.isFinite(parsed) && parsed > max ? parsed : max;
  }, 0);
};

const generateNextCode = async () => {
  const pdvs = await Pdv.find({}, 'codigo').lean();
  const highest = pdvs.reduce((max, pdv) => {
    const current = extractNumericValue(pdv?.codigo);
    return current > max ? current : max;
  }, 0);
  return `PDV-${String(highest + 1).padStart(3, '0')}`;
};

const normalizeAmbientes = (value) => {
  let items = [];
  if (Array.isArray(value)) {
    items = value;
  } else if (typeof value === 'string') {
    items = value.split(',');
  }

  const filtered = items
    .map((item) => normalizeString(item).toLowerCase())
    .filter((item) => ambientesSet.has(item));

  return Array.from(new Set(filtered));
};

const storeSupportsEnvironment = (store, env) => {
  if (!store) return false;
  if (env === 'producao') {
    return Boolean(store.cscIdProducao && store.cscTokenProducaoArmazenado);
  }
  if (env === 'homologacao') {
    return Boolean(store.cscIdHomologacao && store.cscTokenHomologacaoArmazenado);
  }
  return false;
};

const buildPdvPayload = ({ body, store }) => {
  const nome = normalizeString(body.nome);
  const apelido = normalizeString(body.apelido);
  const serieNfe = normalizeString(body.serieNfe || body.serieNFE);
  const serieNfce = normalizeString(body.serieNfce || body.serieNFCE);
  const observacoes = normalizeString(body.observacoes);
  const ambientesHabilitados = normalizeAmbientes(body.ambientesHabilitados);
  const ambientePadrao = normalizeString(body.ambientePadrao).toLowerCase();
  const ativo = parseBoolean(body.ativo !== undefined ? body.ativo : true);
  const sincronizacaoAutomatica = parseBoolean(body.sincronizacaoAutomatica !== undefined ? body.sincronizacaoAutomatica : true);
  const permitirModoOffline = parseBoolean(body.permitirModoOffline);
  let limiteOffline = permitirModoOffline ? parseNumber(body.limiteOffline) : null;
  if (limiteOffline === null && permitirModoOffline) {
    limiteOffline = 0;
  }

  if (limiteOffline !== null && limiteOffline < 0) {
    throw new Error('O limite de emissões offline deve ser maior ou igual a zero.');
  }

  if (!ambientesHabilitados.length) {
    throw new Error('Informe ao menos um ambiente fiscal habilitado.');
  }

  if (!ambientePadrao) {
    throw new Error('Informe o ambiente padrão de emissão.');
  }

  if (!ambientesHabilitados.includes(ambientePadrao)) {
    throw new Error('O ambiente padrão precisa estar entre os ambientes habilitados.');
  }

  for (const env of ambientesHabilitados) {
    if (!storeSupportsEnvironment(store, env)) {
      if (env === 'producao') {
        throw new Error('A empresa selecionada não possui CSC configurado para Produção.');
      }
      if (env === 'homologacao') {
        throw new Error('A empresa selecionada não possui CSC configurado para Homologação.');
      }
      throw new Error('Ambiente fiscal indisponível para a empresa selecionada.');
    }
  }

  return {
    nome,
    apelido,
    ativo,
    serieNfe,
    serieNfce,
    ambientesHabilitados,
    ambientePadrao,
    sincronizacaoAutomatica,
    permitirModoOffline,
    limiteOffline,
    observacoes,
  };
};

router.get('/', async (req, res) => {
  try {
    const { empresa } = req.query;
    const query = {};
    if (empresa) {
      query.empresa = empresa;
    }
    const pdvs = await Pdv.find(query)
      .sort({ nome: 1 })
      .populate('empresa')
      .lean();
    res.json({ pdvs });
  } catch (error) {
    console.error('Erro ao listar PDVs:', error);
    res.status(500).json({ message: 'Erro ao listar PDVs.' });
  }
});

router.get('/next-code', async (req, res) => {
  try {
    const codigo = await generateNextCode();
    res.json({ codigo });
  } catch (error) {
    console.error('Erro ao gerar próximo código de PDV:', error);
    res.status(500).json({ message: 'Erro ao gerar próximo código.' });
  }
});

router.post('/', requireAuth, authorizeRoles('admin', 'admin_master'), async (req, res) => {
  try {
    const empresaId = normalizeString(req.body.empresa || req.body.empresaId);
    const nome = normalizeString(req.body.nome);

    if (!nome) {
      return res.status(400).json({ message: 'O nome do PDV é obrigatório.' });
    }
    if (!empresaId) {
      return res.status(400).json({ message: 'Selecione a empresa responsável pelo PDV.' });
    }

    const store = await Store.findById(empresaId).lean();
    if (!store) {
      return res.status(400).json({ message: 'Empresa informada não foi encontrada.' });
    }

    let codigo = normalizeString(req.body.codigo);
    if (!codigo) {
      codigo = await generateNextCode();
    }

    const codigoDuplicado = await Pdv.exists({ codigo });
    if (codigoDuplicado) {
      return res.status(409).json({ message: 'Já existe um PDV com este código.' });
    }

    let payload;
    try {
      payload = buildPdvPayload({ body: req.body, store });
    } catch (validationError) {
      return res.status(400).json({ message: validationError.message });
    }

    const criadoPor = req.user?.email || req.user?.id || 'Sistema';

    const pdv = await Pdv.create({
      ...payload,
      codigo,
      empresa: empresaId,
      criadoPor,
      atualizadoPor: criadoPor,
    });

    const populated = await pdv.populate('empresa');
    res.status(201).json(populated);
  } catch (error) {
    console.error('Erro ao criar PDV:', error);
    res.status(500).json({ message: 'Erro ao criar PDV.' });
  }
});

router.put('/:id', requireAuth, authorizeRoles('admin', 'admin_master'), async (req, res) => {
  try {
    const pdvId = req.params.id;
    const empresaId = normalizeString(req.body.empresa || req.body.empresaId);
    const nome = normalizeString(req.body.nome);

    if (!nome) {
      return res.status(400).json({ message: 'O nome do PDV é obrigatório.' });
    }
    if (!empresaId) {
      return res.status(400).json({ message: 'Selecione a empresa responsável pelo PDV.' });
    }

    const store = await Store.findById(empresaId).lean();
    if (!store) {
      return res.status(400).json({ message: 'Empresa informada não foi encontrada.' });
    }

    let payload;
    try {
      payload = buildPdvPayload({ body: req.body, store });
    } catch (validationError) {
      return res.status(400).json({ message: validationError.message });
    }

    const codigo = normalizeString(req.body.codigo);
    if (!codigo) {
      return res.status(400).json({ message: 'O código do PDV é obrigatório.' });
    }

    const duplicado = await Pdv.findOne({ codigo, _id: { $ne: pdvId } });
    if (duplicado) {
      return res.status(409).json({ message: 'Já existe outro PDV com este código.' });
    }

    const atualizadoPor = req.user?.email || req.user?.id || 'Sistema';

    const updated = await Pdv.findByIdAndUpdate(
      pdvId,
      {
        ...payload,
        codigo,
        empresa: empresaId,
        atualizadoPor,
      },
      { new: true, runValidators: true }
    ).populate('empresa');

    if (!updated) {
      return res.status(404).json({ message: 'PDV não encontrado.' });
    }

    res.json(updated);
  } catch (error) {
    console.error('Erro ao atualizar PDV:', error);
    res.status(500).json({ message: 'Erro ao atualizar PDV.' });
  }
});

router.delete('/:id', requireAuth, authorizeRoles('admin', 'admin_master'), async (req, res) => {
  try {
    const deleted = await Pdv.findByIdAndDelete(req.params.id);
    if (!deleted) {
      return res.status(404).json({ message: 'PDV não encontrado.' });
    }
    res.json({ message: 'PDV removido com sucesso.' });
  } catch (error) {
    console.error('Erro ao remover PDV:', error);
    res.status(500).json({ message: 'Erro ao remover PDV.' });
  }
});

module.exports = router;
