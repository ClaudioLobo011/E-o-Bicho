const express = require('express');
const mongoose = require('mongoose');

const authMiddleware = require('../middlewares/authMiddleware');
const User = require('../models/User');
const Service = require('../models/Service');
const ServiceGroup = require('../models/ServiceGroup');
const ProfessionalCommissionConfig = require('../models/ProfessionalCommissionConfig');
const { randomUUID } = require('node:crypto');
const { dateKey } = require('../../scripts/common/professional-commission-engine');

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
  if (!Array.isArray(raw)) throw new Error('Informe uma lista de regras válida.');
  const byRef = new Map();
  const items = [];
  raw.forEach((item) => {
    if (!item || typeof item !== 'object') throw new Error('Regra inválida.');
    const refId = normalizeObjectId(item[keyName]);
    const percent = parsePercent(item.percent);
    if (!refId || percent === null || typeof item.percent === 'boolean') throw new Error('Referência inválida ou comissão fora de 0 a 100%.');
    if (byRef.has(refId)) throw new Error('Não repita o mesmo grupo ou serviço na configuração.');
    byRef.set(refId, { [keyName]: refId, percent });
  });
  byRef.forEach((value) => items.push(value));
  return items;
}

function normalizeWeekdayRules(raw) {
  if (!Array.isArray(raw) || raw.length > 70) throw new Error('Lista de dias inválida.');
  const occupied = new Set();
  const ids = new Set();
  return raw.map((rule) => {
    if (!rule || !Array.isArray(rule.weekdays) || !rule.weekdays.length || rule.weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) throw new Error('Selecione pelo menos um dia da semana válido.');
    const weekdays = [...new Set(rule.weekdays)].sort();
    const enabled = rule.enabled !== false;
    if (enabled && weekdays.some((day) => occupied.has(day))) throw new Error('Um dia da semana não pode pertencer a duas regras ativas.');
    if (enabled) weekdays.forEach((day) => occupied.add(day));
    const defaultPercent = rule.defaultPercent === '' || rule.defaultPercent == null ? null : parsePercent(rule.defaultPercent);
    if (rule.defaultPercent !== '' && rule.defaultPercent != null && (defaultPercent === null || typeof rule.defaultPercent === 'boolean')) throw new Error('A comissão do dia deve estar entre 0 e 100%.');
    const groupRules = normalizeRuleArray(rule.groupRules || [], 'group');
    const serviceRules = normalizeRuleArray(rule.serviceRules || [], 'service');
    if (defaultPercent === null && !groupRules.length && !serviceRules.length) throw new Error('Informe o percentual do dia ou pelo menos uma exceção.');
    const id = String(rule.id || randomUUID()).slice(0, 80);
    if (ids.has(id)) throw new Error('Identificador de regra repetido.');
    ids.add(id);
    return { id, weekdays, enabled, defaultPercent, groupRules, serviceRules };
  });
}

function mapConfigForClient(config) {
  if (!config) return null;
  return {
    _id: String(config._id),
    user: normalizeObjectId(config.user),
    professionalType: String(config.professionalType || ''),
    revision: Number(config.revision || 0),
    effectiveFrom: config.effectiveFrom || '',
    weekdayRules: config.weekdayRules || [],
    history: config.history || [],
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
      .select('nomeCompleto nomeContato razaoSocial email grupos empresas empresaPrincipal cargoCarteira userGroup')
      .populate('userGroup', 'comissaoServicoPercent')
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
          fallbackPercent: Number(user.userGroup?.comissaoServicoPercent || 0),
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
          comissaoPercent: service.comissaoPercent ?? null,
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

    const existing = await ProfessionalCommissionConfig.findOne({ user: userId }).lean();
    if (!Number.isInteger(req.body?.expectedRevision) || req.body.expectedRevision !== Number(existing?.revision || 0)) {
      return res.status(409).json({ message: 'A configuração mudou. Recarregue a página antes de salvar.' });
    }
    const effectiveFrom = dateKey(req.body?.effectiveFrom);
    if (!effectiveFrom || effectiveFrom !== req.body.effectiveFrom) {
      return res.status(400).json({ message: 'Informe uma data de vigência válida.' });
    }
    let groupRules, serviceRules, weekdayRules;
    try {
      groupRules = normalizeRuleArray(req.body?.groupRules, 'group');
      serviceRules = normalizeRuleArray(req.body?.serviceRules, 'service');
      weekdayRules = normalizeWeekdayRules(req.body?.weekdayRules || []);
    } catch (error) {
      return res.status(400).json({ message: error.message });
    }

    const validationError = await validateRuleReferences({
      professionalType,
      groupRules: [...groupRules, ...weekdayRules.flatMap((rule) => rule.groupRules)],
      serviceRules: [...serviceRules, ...weekdayRules.flatMap((rule) => rule.serviceRules)],
    });
    if (validationError) {
      return res.status(400).json({ message: validationError });
    }

    const { history: previousHistory = [], ...previousVersion } = existing || { revision: 0, effectiveFrom: '', groupRules: [], serviceRules: [], weekdayRules: [] };
    const revisionFilter = existing ? { _id: existing._id, ...(existing.revision == null ? { revision: { $exists: false } } : { revision: existing.revision }) } : { user: userId, revision: { $exists: false } };
    const saved = await ProfessionalCommissionConfig.findOneAndUpdate(
      revisionFilter,
      {
        $set: {
          user: userId,
          professionalType,
          groupRules,
          serviceRules,
          weekdayRules,
          effectiveFrom,
          revision: Number(existing?.revision || 0) + 1,
          history: [...previousHistory, previousVersion],
          updatedBy: req.user?.id || null,
        },
        $setOnInsert: {
          createdBy: req.user?.id || null,
        },
      },
      {
        new: true,
        upsert: !existing,
        runValidators: true,
      }
    ).lean();
    if (!saved) return res.status(409).json({ message: 'A configuração mudou. Recarregue antes de salvar.' });

    // O cursor incremental de profissionais é baseado no User. Avançá-lo
    // faz a nova comissão chegar sem reenviar toda a equipe.
    await User.updateOne({ _id: userId }, { $currentDate: { updatedAt: true } });

    return res.json(mapConfigForClient(saved));
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ message: 'Outro usuário salvou esta configuração. Recarregue a página.' });
    console.error('PUT /api/admin/comissoes-profissionais/:userId', error);
    return res.status(500).json({ message: 'Erro ao salvar comissão por profissional.' });
  }
});

module.exports = router;
