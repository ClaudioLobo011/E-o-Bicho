const express = require('express');
const requireAuth = require('../middlewares/requireAuth');
const authorizeRoles = require('../middlewares/authorizeRoles');
const Store = require('../models/Store');
const FiscalDefaultRule = require('../models/FiscalDefaultRule');
const Product = require('../models/Product');
const Service = require('../models/Service');
const { validateNfseFiscal } = require('../utils/nfseConfig');
const { assertFiscalStoreAccess } = require('../utils/fiscalStoreAccess');
const { normalizeFiscalData } = require('../services/fiscalRuleEngine');

const router = express.Router();

const parseRuleCode = (value) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const toRulePayload = (rule) => ({
  tipo: rule?.tipo || 'produto',
  code: Number(rule?.code) || 0,
  name: rule?.name || '',
  fiscal: rule?.fiscal || {},
  createdAt: rule?.createdAt || null,
  updatedAt: rule?.updatedAt || null,
  updatedBy: rule?.updatedBy || '',
});

const getNextCode = async (storeId) => {
  const lastRule = await FiscalDefaultRule.findOne({ empresa: storeId })
    .sort({ code: -1 })
    .select({ code: 1, _id: 0 })
    .lean();

  return (Number(lastRule?.code) || 0) + 1;
};

const ensureStoreExists = async (storeId) => {
  const exists = await Store.exists({ _id: storeId });
  return Boolean(exists);
};

const touchProductsUsingRule = async (storeId, ruleCode) => {
  const assignmentPath = `fiscalPorEmpresa.${storeId}.fiscalRuleCode`;
  return Product.updateMany(
    { [assignmentPath]: String(ruleCode) },
    { $set: { updatedAt: new Date() } },
    { timestamps: false }
  );
};

const touchServicesUsingRule = (storeId, ruleCode) => Service.updateMany(
  { [`fiscalPorEmpresa.${storeId}.fiscalRuleCode`]: String(ruleCode) },
  { $set: { updatedAt: new Date() } },
  { timestamps: false }
);

const normalizeRuleFiscal = (tipo, fiscal) => {
  if (!['produto', 'servico'].includes(tipo)) throw Object.assign(new Error('Tipo de regra fiscal inválido.'), { status: 400 });
  return tipo === 'servico' ? { nfse: validateNfseFiscal(fiscal?.nfse || {}) } : normalizeFiscalData(fiscal || {});
};

router.get('/', requireAuth, authorizeRoles('admin', 'admin_master'), async (req, res) => {
  try {
    const { storeId } = req.query;
    if (!storeId) {
      return res.status(400).json({ message: 'Informe a empresa (storeId).' });
    }

    assertFiscalStoreAccess(req, storeId);
    const storeExists = await ensureStoreExists(storeId);
    if (!storeExists) {
      return res.status(404).json({ message: 'Empresa nao encontrada.' });
    }

    const query = { empresa: storeId };
    if (req.query.tipo === 'servico') query.tipo = 'servico';
    if (req.query.tipo === 'produto') query.tipo = { $ne: 'servico' };
    const rules = await FiscalDefaultRule.find(query)
      .sort({ code: 1 })
      .lean();

    const nextCode = await getNextCode(storeId);

    return res.json({
      storeId,
      total: rules.length,
      nextCode,
      rules: rules.map(toRulePayload),
    });
  } catch (error) {
    console.error('Erro ao carregar regras fiscais padrao:', error);
    return res.status(error.status || 500).json({ message: [400, 403].includes(error.status) ? error.message : 'Erro ao carregar regras fiscais padrao.' });
  }
});

router.post('/', requireAuth, authorizeRoles('admin', 'admin_master'), async (req, res) => {
  try {
    const { storeId, name, fiscal } = req.body || {};
    if (!storeId) {
      return res.status(400).json({ message: 'Informe a empresa (storeId).' });
    }

    const trimmedName = typeof name === 'string' ? name.trim() : '';
    if (!trimmedName) {
      return res.status(400).json({ message: 'Informe o nome da regra.' });
    }

    assertFiscalStoreAccess(req, storeId);
    const storeExists = await ensureStoreExists(storeId);
    if (!storeExists) {
      return res.status(404).json({ message: 'Empresa nao encontrada.' });
    }

    const tipo = req.body.tipo || 'produto';
    const fiscalNormalized = normalizeRuleFiscal(tipo, fiscal);
    const updatedBy = req.user?.id || '';

    let created = null;
    let attempts = 0;

    while (!created && attempts < 3) {
      attempts += 1;
      const nextCode = await getNextCode(storeId);

      try {
        created = await FiscalDefaultRule.create({
          empresa: storeId,
          code: nextCode,
          name: trimmedName,
          tipo,
          fiscal: fiscalNormalized,
          updatedBy,
        });
      } catch (createError) {
        const isDuplicateCode = createError?.code === 11000 && String(createError?.message || '').includes('code');
        if (!isDuplicateCode || attempts >= 3) {
          throw createError;
        }
      }
    }

    const total = await FiscalDefaultRule.countDocuments({ empresa: storeId });
    const nextCode = await getNextCode(storeId);

    return res.json({
      rule: toRulePayload(created),
      total,
      nextCode,
    });
  } catch (error) {
    console.error('Erro ao criar regra fiscal padrao:', error);
    return res.status(error.status || 500).json({ message: [400, 403].includes(error.status) ? error.message : 'Erro ao criar regra fiscal padrao.' });
  }
});

router.put('/:code', requireAuth, authorizeRoles('admin', 'admin_master'), async (req, res) => {
  try {
    const ruleCode = parseRuleCode(req.params.code);
    if (!ruleCode) {
      return res.status(400).json({ message: 'Codigo de regra invalido.' });
    }

    const { storeId, name, fiscal } = req.body || {};
    if (!storeId) {
      return res.status(400).json({ message: 'Informe a empresa (storeId).' });
    }

    const trimmedName = typeof name === 'string' ? name.trim() : '';
    if (!trimmedName) {
      return res.status(400).json({ message: 'Informe o nome da regra.' });
    }

    assertFiscalStoreAccess(req, storeId);
    const storeExists = await ensureStoreExists(storeId);
    if (!storeExists) {
      return res.status(404).json({ message: 'Empresa nao encontrada.' });
    }

    const existingRule = await FiscalDefaultRule.findOne({ empresa: storeId, code: ruleCode }).lean();
    if (!existingRule) return res.status(404).json({ message: 'Regra não encontrada.' });
    const tipo = req.body.tipo || existingRule.tipo || 'produto';
    if (tipo !== (existingRule.tipo || 'produto')) return res.status(400).json({ message: 'O tipo de uma regra existente não pode ser alterado. Cadastre outra regra para preservar os vínculos.' });
    const updatedRule = await FiscalDefaultRule.findOneAndUpdate(
      { empresa: storeId, code: ruleCode },
      {
        $set: {
          name: trimmedName,
          tipo,
          fiscal: normalizeRuleFiscal(tipo, fiscal),
          updatedBy: req.user?.id || '',
        },
      },
      { new: true, runValidators: true }
    ).lean();

    if (!updatedRule) {
      return res.status(404).json({ message: 'Regra nao encontrada.' });
    }

    if (tipo === 'servico') await touchServicesUsingRule(storeId, ruleCode);
    else await touchProductsUsingRule(storeId, ruleCode);

    const total = await FiscalDefaultRule.countDocuments({ empresa: storeId });
    return res.json({ rule: toRulePayload(updatedRule), total });
  } catch (error) {
    console.error('Erro ao atualizar regra fiscal padrao:', error);
    return res.status(error.status || 500).json({ message: [400, 403].includes(error.status) ? error.message : 'Erro ao atualizar regra fiscal padrao.' });
  }
});

router.delete('/:code', requireAuth, authorizeRoles('admin', 'admin_master'), async (req, res) => {
  try {
    const ruleCode = parseRuleCode(req.params.code);
    if (!ruleCode) {
      return res.status(400).json({ message: 'Codigo de regra invalido.' });
    }

    const storeId = req.query.storeId || req.body?.storeId;
    if (!storeId) {
      return res.status(400).json({ message: 'Informe a empresa (storeId).' });
    }

    assertFiscalStoreAccess(req, storeId);
    const storeExists = await ensureStoreExists(storeId);
    if (!storeExists) {
      return res.status(404).json({ message: 'Empresa nao encontrada.' });
    }

    const ruleInUse = await Service.exists({ [`fiscalPorEmpresa.${storeId}.fiscalRuleCode`]: String(ruleCode) });
    if (ruleInUse) return res.status(409).json({ message: 'Esta regra está vinculada a serviços. Altere os vínculos antes de excluir.' });
    const removed = await FiscalDefaultRule.findOneAndDelete({ empresa: storeId, code: ruleCode }).lean();
    if (!removed) {
      return res.status(404).json({ message: 'Regra nao encontrada.' });
    }

    const total = await FiscalDefaultRule.countDocuments({ empresa: storeId });
    const nextCode = await getNextCode(storeId);

    return res.json({
      removed: ruleCode,
      total,
      nextCode,
    });
  } catch (error) {
    console.error('Erro ao remover regra fiscal padrao:', error);
    return res.status(error.status || 500).json({ message: [400, 403].includes(error.status) ? error.message : 'Erro ao remover regra fiscal padrao.' });
  }
});

module.exports = router;
