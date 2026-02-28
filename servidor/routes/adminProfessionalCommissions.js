const express = require('express');
const mongoose = require('mongoose');

const authMiddleware = require('../middlewares/authMiddleware');
const User = require('../models/User');
const Service = require('../models/Service');
const ServiceGroup = require('../models/ServiceGroup');
const ProfessionalCommissionConfig = require('../models/ProfessionalCommissionConfig');

const router = express.Router();

const STAFF_ROLES = new Set(['funcionario', 'franqueado', 'franqueador', 'admin', 'admin_master']);
const ELIGIBLE_PROFESSIONAL_TYPES = ['esteticista', 'veterinario'];

function requireAdmin(req, res, next) {
  const role = req.user?.role;
  if (role && STAFF_ROLES.has(role)) return next();
  return res.status(403).json({ message: 'Acesso negado. Apenas administradores.' });
}

function normalizeObjectId(value) {
  const raw = typeof value === 'object' && value !== null ? value._id || value.id : value;
  const id = String(raw || '').trim();
  return mongoose.Types.ObjectId.isValid(id) ? id : '';
}

function resolveProfessionalTypes(user) {
  const rawGroups = Array.isArray(user?.grupos) ? user.grupos : [];
  return rawGroups
    .map((group) => String(group || '').trim().toLowerCase())
    .filter((group, index, list) => ELIGIBLE_PROFESSIONAL_TYPES.includes(group) && list.indexOf(group) === index);
}

function resolveProfessionalType(user, preferred = '') {
  const available = resolveProfessionalTypes(user);
  const normalizedPreferred = String(preferred || '').trim().toLowerCase();
  if (available.includes(normalizedPreferred)) return normalizedPreferred;
  return available[0] || '';
}

function buildProfessionalLabel(user) {
  return (
    user?.nomeCompleto ||
    user?.nomeContato ||
    user?.razaoSocial ||
    user?.email ||
    'Profissional sem nome'
  );
}

function parsePercent(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(String(value).replace(',', '.'));
  if (!Number.isFinite(parsed)) return null;
  if (parsed < 0 || parsed > 100) return null;
  return Number(parsed.toFixed(2));
}

function normalizeRuleArray(raw, keyName) {
  if (!Array.isArray(raw)) return [];
  const byRef = new Map();
  const items = [];
  raw.forEach((item) => {
    if (!item || typeof item !== 'object') return;
    const refId = normalizeObjectId(item[keyName]);
    const percent = parsePercent(item.percent);
    if (!refId || percent === null) return;
    byRef.set(refId, { [keyName]: refId, percent });
  });
  byRef.forEach((value) => items.push(value));
  return items;
}

function mapConfigForClient(config) {
  if (!config) return null;
  return {
    _id: String(config._id),
    user: normalizeObjectId(config.user),
    professionalType: String(config.professionalType || ''),
    groupRules: (Array.isArray(config.groupRules) ? config.groupRules : []).map((rule) => ({
      group: normalizeObjectId(rule.group),
      percent: Number(rule.percent || 0),
    })),
    serviceRules: (Array.isArray(config.serviceRules) ? config.serviceRules : []).map((rule) => ({
      service: normalizeObjectId(rule.service),
      percent: Number(rule.percent || 0),
    })),
    updatedAt: config.updatedAt,
    createdAt: config.createdAt,
  };
}

async function validateRuleReferences({ professionalType, groupRules, serviceRules }) {
  const groupIds = groupRules.map((item) => item.group);
  const serviceIds = serviceRules.map((item) => item.service);

  const [groups, services] = await Promise.all([
    groupIds.length ? ServiceGroup.find({ _id: { $in: groupIds } }).select('tiposPermitidos').lean() : [],
    serviceIds.length ? Service.find({ _id: { $in: serviceIds } }).select('grupo').populate('grupo', 'tiposPermitidos').lean() : [],
  ]);

  const groupMap = new Map(groups.map((group) => [String(group._id), group]));
  const serviceMap = new Map(services.map((service) => [String(service._id), service]));

  for (const rule of groupRules) {
    const group = groupMap.get(rule.group);
    if (!group) {
      return `Grupo de serviço inválido na configuração (${rule.group}).`;
    }
    const allowedTypes = Array.isArray(group.tiposPermitidos) ? group.tiposPermitidos : [];
    if (!allowedTypes.includes(professionalType)) {
      return `O grupo selecionado não aceita o tipo ${professionalType}.`;
    }
  }

  for (const rule of serviceRules) {
    const service = serviceMap.get(rule.service);
    if (!service) {
      return `Serviço inválido na configuração (${rule.service}).`;
    }
    const allowedTypes = Array.isArray(service?.grupo?.tiposPermitidos) ? service.grupo.tiposPermitidos : [];
    if (!allowedTypes.includes(professionalType)) {
      return `O serviço selecionado não aceita o tipo ${professionalType}.`;
    }
  }

  return '';
}

router.get('/bootstrap', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const professionals = await User.find({
      role: { $in: Array.from(STAFF_ROLES) },
      grupos: { $in: ELIGIBLE_PROFESSIONAL_TYPES },
    })
      .select('nomeCompleto nomeContato razaoSocial email grupos empresas empresaPrincipal cargoCarteira')
      .sort({ nomeCompleto: 1, nomeContato: 1, razaoSocial: 1, email: 1 })
      .lean();

    const [groups, services, configs] = await Promise.all([
      ServiceGroup.find({ ativo: { $ne: false }, tiposPermitidos: { $in: ELIGIBLE_PROFESSIONAL_TYPES } })
        .sort({ nome: 1 })
        .lean(),
      Service.find({ ativo: { $ne: false } })
        .populate('grupo', 'nome tiposPermitidos comissaoPercent')
        .sort({ nome: 1 })
        .lean(),
      ProfessionalCommissionConfig.find({
        user: { $in: professionals.map((item) => item._id) },
      }).lean(),
    ]);

    const payload = {
      professionals: professionals.map((user) => {
        const types = resolveProfessionalTypes(user);
        return {
          _id: String(user._id),
          nome: buildProfessionalLabel(user),
          email: user.email || '',
          cargoCarteira: user.cargoCarteira || '',
          professionalTypes: types,
          professionalType: types[0] || '',
          empresas: Array.isArray(user.empresas) ? user.empresas.map((id) => normalizeObjectId(id)).filter(Boolean) : [],
          empresaPrincipal: normalizeObjectId(user.empresaPrincipal),
        };
      }),
      groups: groups.map((group) => ({
        _id: String(group._id),
        nome: group.nome || '',
        tiposPermitidos: Array.isArray(group.tiposPermitidos) ? group.tiposPermitidos : [],
        comissaoPercent: Number(group.comissaoPercent || 0),
      })),
      services: services
        .filter((service) => service?.grupo?._id)
        .map((service) => ({
          _id: String(service._id),
          nome: service.nome || '',
          grupo: {
            _id: String(service.grupo._id),
            nome: service.grupo.nome || '',
            tiposPermitidos: Array.isArray(service.grupo.tiposPermitidos) ? service.grupo.tiposPermitidos : [],
            comissaoPercent: Number(service.grupo.comissaoPercent || 0),
          },
        })),
      configs: configs.map(mapConfigForClient).filter(Boolean),
    };

    return res.json(payload);
  } catch (error) {
    console.error('GET /api/admin/comissoes-profissionais/bootstrap', error);
    return res.status(500).json({ message: 'Erro ao carregar configurações de comissão por profissional.' });
  }
});

router.put('/:userId', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const userId = normalizeObjectId(req.params.userId);
    if (!userId) {
      return res.status(400).json({ message: 'Profissional inválido.' });
    }

    const user = await User.findById(userId)
      .select('nomeCompleto nomeContato razaoSocial email grupos')
      .lean();

    if (!user) {
      return res.status(404).json({ message: 'Profissional não encontrado.' });
    }

    const professionalType = resolveProfessionalType(user, req.body?.professionalType);
    if (!professionalType) {
      return res.status(400).json({ message: 'O profissional selecionado não é Esteticista nem Veterinário.' });
    }

    const groupRules = normalizeRuleArray(req.body?.groupRules, 'group');
    const serviceRules = normalizeRuleArray(req.body?.serviceRules, 'service');

    const validationError = await validateRuleReferences({
      professionalType,
      groupRules,
      serviceRules,
    });
    if (validationError) {
      return res.status(400).json({ message: validationError });
    }

    const saved = await ProfessionalCommissionConfig.findOneAndUpdate(
      { user: userId },
      {
        $set: {
          user: userId,
          professionalType,
          groupRules,
          serviceRules,
          updatedBy: req.user?._id || null,
        },
        $setOnInsert: {
          createdBy: req.user?._id || null,
        },
      },
      {
        new: true,
        upsert: true,
        runValidators: true,
      }
    ).lean();

    return res.json(mapConfigForClient(saved));
  } catch (error) {
    console.error('PUT /api/admin/comissoes-profissionais/:userId', error);
    return res.status(500).json({ message: 'Erro ao salvar comissão por profissional.' });
  }
});

module.exports = router;
