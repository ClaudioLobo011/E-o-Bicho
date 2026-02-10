const express = require('express');
const mongoose = require('mongoose');

const FiscalSerie = require('../models/FiscalSerie');
const Store = require('../models/Store');
const User = require('../models/User');
const requireAuth = require('../middlewares/requireAuth');
const authorizeRoles = require('../middlewares/authorizeRoles');

const router = express.Router();

const normalizeString = (value) => (typeof value === 'string' ? value.trim() : '');
const normalizeCodigo = (value) => {
  if (value === null || value === undefined) return '';
  return String(value).trim();
};

const normalizeModelo = (value) => {
  const normalized = normalizeString(value);
  return ['55', '65'].includes(normalized) ? normalized : '';
};

const normalizeAmbiente = (value) => {
  const normalized = normalizeString(value).toLowerCase();
  if (normalized === 'homologacao' || normalized === 'producao') return normalized;
  return '';
};

const resolveUserStoreAccess = async (userId) => {
  if (!userId) return { allowedStoreIds: [], allowAllStores: false };
  const user = await User.findById(userId).select('empresaPrincipal empresas role').lean();
  if (!user) return { allowedStoreIds: [], allowAllStores: false };

  const markedCompanies = Array.isArray(user.empresas)
    ? user.empresas
      .map((id) => {
        if (!id) return null;
        const str = typeof id === 'object' && id._id ? String(id._id) : String(id);
        return str && str.length === 24 ? str : null;
      })
      .filter(Boolean)
    : [];

  const allowedStoreIds =
    markedCompanies.length > 0
      ? Array.from(new Set(markedCompanies))
      : (user.empresaPrincipal && String(user.empresaPrincipal).length === 24
        ? [String(user.empresaPrincipal)]
        : []);

  const allowAllStores = user.role === 'admin_master' && allowedStoreIds.length === 0;

  return { allowedStoreIds, allowAllStores };
};

const sanitizeParametros = (parametros) => {
  if (!Array.isArray(parametros)) return [];
  const unique = new Map();

  parametros.forEach((item) => {
    const empresa = normalizeCodigo(item?.empresa);
    if (!mongoose.Types.ObjectId.isValid(empresa)) return;
    if (unique.has(empresa)) return;
    unique.set(empresa, {
      empresa,
      ultimaNotaEmitida: normalizeString(item?.ultimaNotaEmitida || ''),
    });
  });

  return Array.from(unique.values());
};

const getNextCodigo = async () => {
  const docs = await FiscalSerie.find({ codigo: { $ne: '' } }).select('codigo').lean();
  let maxValue = 0;
  docs.forEach((doc) => {
    const digits = String(doc.codigo || '').replace(/\D/g, '');
    const parsed = Number(digits);
    if (Number.isFinite(parsed) && parsed > maxValue) {
      maxValue = parsed;
    }
  });
  return String(maxValue + 1);
};

router.get('/', requireAuth, authorizeRoles('admin', 'admin_master', 'funcionario'), async (req, res) => {
  try {
    const { allowedStoreIds, allowAllStores } = await resolveUserStoreAccess(req.user?.id);
    if (!allowAllStores && (!Array.isArray(allowedStoreIds) || allowedStoreIds.length === 0)) {
      return res.json({ series: [] });
    }

    const series = await FiscalSerie.find({})
      .sort({ codigo: 1, createdAt: 1 })
      .populate('parametros.empresa', 'nome nomeFantasia razaoSocial codigo')
      .lean();

    if (allowAllStores) {
      return res.json({ series });
    }

    const allowedSet = new Set(allowedStoreIds.map((id) => String(id)));
    const filtered = series.map((serie) => {
      const parametros = Array.isArray(serie.parametros) ? serie.parametros : [];
      const allowedParametros = parametros.filter((param) => {
        const empresaId =
          typeof param?.empresa === 'object' && param.empresa
            ? param.empresa._id || param.empresa.id || ''
            : param.empresa;
        return allowedSet.has(String(empresaId));
      });
      return { ...serie, parametros: allowedParametros };
    });

    return res.json({ series: filtered });
  } catch (error) {
    console.error('Erro ao listar series fiscais:', error);
    res.status(500).json({ message: 'Erro ao listar as series fiscais.' });
  }
});

router.get('/next-code', requireAuth, authorizeRoles('admin', 'admin_master'), async (_req, res) => {
  try {
    const codigo = await getNextCodigo();
    res.json({ codigo });
  } catch (error) {
    console.error('Erro ao calcular proximo codigo:', error);
    res.status(500).json({ message: 'Erro ao calcular o proximo codigo.' });
  }
});

router.get('/by-code/:codigo', requireAuth, authorizeRoles('admin', 'admin_master', 'funcionario'), async (req, res) => {
  try {
    const codigo = normalizeCodigo(req.params.codigo);
    if (!codigo) {
      return res.status(400).json({ message: 'Codigo invalido.' });
    }

    const { allowedStoreIds, allowAllStores } = await resolveUserStoreAccess(req.user?.id);
    if (!allowAllStores && (!Array.isArray(allowedStoreIds) || allowedStoreIds.length === 0)) {
      return res.status(403).json({ message: 'Usuario sem empresas vinculadas.' });
    }

    const serie = await FiscalSerie.findOne({ codigo })
      .populate('parametros.empresa', 'nome nomeFantasia razaoSocial codigo')
      .lean();

    if (!serie) {
      return res.status(404).json({ message: 'Serie fiscal nao encontrada.' });
    }

    if (allowAllStores) {
      return res.json(serie);
    }

    const allowedSet = new Set(allowedStoreIds.map((id) => String(id)));
    const parametros = Array.isArray(serie.parametros) ? serie.parametros : [];
    const filteredParametros = parametros.filter((param) => {
      const empresaId =
        typeof param?.empresa === 'object' && param.empresa
          ? param.empresa._id || param.empresa.id || ''
          : param.empresa;
      return allowedSet.has(String(empresaId));
    });

    return res.json({ ...serie, parametros: filteredParametros });
  } catch (error) {
    console.error('Erro ao buscar serie por codigo:', error);
    res.status(500).json({ message: 'Erro ao buscar a serie fiscal.' });
  }
});

router.post('/', requireAuth, authorizeRoles('admin', 'admin_master'), async (req, res) => {
  try {
    const { allowedStoreIds, allowAllStores } = await resolveUserStoreAccess(req.user?.id);
    if (!allowAllStores && (!Array.isArray(allowedStoreIds) || allowedStoreIds.length === 0)) {
      return res.status(403).json({ message: 'Usuario sem empresas vinculadas.' });
    }

    const codigo = normalizeCodigo(req.body?.codigo);
    const descricao = normalizeString(req.body?.descricao);
    const modelo = normalizeModelo(req.body?.modelo);
    const serie = normalizeString(req.body?.serie);
    const ambiente = normalizeAmbiente(req.body?.ambiente);
    const parametros = sanitizeParametros(req.body?.parametros);

    if (!descricao) {
      return res.status(400).json({ message: 'Descricao obrigatoria.' });
    }
    if (!modelo) {
      return res.status(400).json({ message: 'Modelo da NF obrigatorio.' });
    }
    if (!serie) {
      return res.status(400).json({ message: 'Serie obrigatoria.' });
    }
    if (!ambiente) {
      return res.status(400).json({ message: 'Ambiente obrigatorio.' });
    }

    if (!allowAllStores && parametros.length) {
      const allowedSet = new Set(allowedStoreIds.map((id) => String(id)));
      const notAllowed = parametros.some((param) => !allowedSet.has(String(param.empresa)));
      if (notAllowed) {
        return res.status(403).json({ message: 'Empresa nao autorizada para este usuario.' });
      }
    }

    if (parametros.length) {
      const empresaIds = parametros.map((param) => param.empresa);
      const stores = await Store.find({ _id: { $in: empresaIds } }).select('_id').lean();
      if (stores.length !== empresaIds.length) {
        return res.status(400).json({ message: 'Empresa informada nao encontrada.' });
      }
    }

    const codigoFinal = codigo || await getNextCodigo();
    const exists = await FiscalSerie.exists({ codigo: codigoFinal });
    if (exists) {
      return res.status(409).json({ message: 'Codigo ja cadastrado para outra serie.' });
    }

    const serieFiscal = await FiscalSerie.create({
      codigo: codigoFinal,
      descricao,
      modelo,
      serie,
      ambiente,
      parametros,
    });

    const populado = await serieFiscal.populate('parametros.empresa', 'nome nomeFantasia razaoSocial codigo');
    res.status(201).json(populado);
  } catch (error) {
    console.error('Erro ao salvar serie fiscal:', error);
    if (error?.code === 11000) {
      return res.status(409).json({ message: 'Codigo ja cadastrado para outra serie.' });
    }
    res.status(500).json({ message: 'Erro ao salvar a serie fiscal.' });
  }
});

router.put('/:id', requireAuth, authorizeRoles('admin', 'admin_master'), async (req, res) => {
  try {
    const { allowedStoreIds, allowAllStores } = await resolveUserStoreAccess(req.user?.id);
    if (!allowAllStores && (!Array.isArray(allowedStoreIds) || allowedStoreIds.length === 0)) {
      return res.status(403).json({ message: 'Usuario sem empresas vinculadas.' });
    }

    const codigo = normalizeCodigo(req.body?.codigo);
    const descricao = normalizeString(req.body?.descricao);
    const modelo = normalizeModelo(req.body?.modelo);
    const serie = normalizeString(req.body?.serie);
    const ambiente = normalizeAmbiente(req.body?.ambiente);
    const parametros = sanitizeParametros(req.body?.parametros);

    if (!descricao) {
      return res.status(400).json({ message: 'Descricao obrigatoria.' });
    }
    if (!modelo) {
      return res.status(400).json({ message: 'Modelo da NF obrigatorio.' });
    }
    if (!serie) {
      return res.status(400).json({ message: 'Serie obrigatoria.' });
    }
    if (!ambiente) {
      return res.status(400).json({ message: 'Ambiente obrigatorio.' });
    }

    const existingSerie = await FiscalSerie.findById(req.params.id).lean();
    if (!existingSerie) {
      return res.status(404).json({ message: 'Serie fiscal nao encontrada.' });
    }

    if (codigo) {
      const exists = await FiscalSerie.exists({ codigo, _id: { $ne: req.params.id } });
      if (exists) {
        return res.status(409).json({ message: 'Codigo ja cadastrado para outra serie.' });
      }
    }

    if (!allowAllStores && parametros.length) {
      const allowedSet = new Set(allowedStoreIds.map((id) => String(id)));
      const notAllowed = parametros.some((param) => !allowedSet.has(String(param.empresa)));
      if (notAllowed) {
        return res.status(403).json({ message: 'Empresa nao autorizada para este usuario.' });
      }
    }

    if (parametros.length) {
      const empresaIds = parametros.map((param) => param.empresa);
      const stores = await Store.find({ _id: { $in: empresaIds } }).select('_id').lean();
      if (stores.length !== empresaIds.length) {
        return res.status(400).json({ message: 'Empresa informada nao encontrada.' });
      }
    }

    let parametrosFinal = parametros;
    if (!allowAllStores && Array.isArray(allowedStoreIds) && allowedStoreIds.length) {
      const allowedSet = new Set(allowedStoreIds.map((id) => String(id)));
      const merged = new Map();

      const existingParams = Array.isArray(existingSerie.parametros) ? existingSerie.parametros : [];
      existingParams.forEach((param) => {
        const empresaId = String(param?.empresa || '');
        if (!empresaId) return;
        if (!allowedSet.has(empresaId)) {
          merged.set(empresaId, {
            empresa: empresaId,
            ultimaNotaEmitida: normalizeString(param?.ultimaNotaEmitida || ''),
          });
        }
      });

      parametros.forEach((param) => {
        merged.set(String(param.empresa), param);
      });

      parametrosFinal = Array.from(merged.values());
    }

    const updatePayload = {
      descricao,
      modelo,
      serie,
      ambiente,
      parametros: parametrosFinal,
    };
    if (codigo) {
      updatePayload.codigo = codigo;
    }

    const atualizado = await FiscalSerie.findByIdAndUpdate(
      existingSerie._id,
      updatePayload,
      { new: true, runValidators: true }
    ).populate('parametros.empresa', 'nome nomeFantasia razaoSocial codigo');

    if (!atualizado) {
      return res.status(404).json({ message: 'Serie fiscal nao encontrada.' });
    }

    res.json(atualizado);
  } catch (error) {
    console.error('Erro ao atualizar serie fiscal:', error);
    res.status(500).json({ message: 'Erro ao atualizar a serie fiscal.' });
  }
});

router.delete('/:id', requireAuth, authorizeRoles('admin', 'admin_master'), async (req, res) => {
  try {
    const removido = await FiscalSerie.findByIdAndDelete(req.params.id);
    if (!removido) {
      return res.status(404).json({ message: 'Serie fiscal nao encontrada.' });
    }
    res.json({ message: 'Serie fiscal removida com sucesso.' });
  } catch (error) {
    console.error('Erro ao remover serie fiscal:', error);
    res.status(500).json({ message: 'Erro ao remover a serie fiscal.' });
  }
});

module.exports = router;
