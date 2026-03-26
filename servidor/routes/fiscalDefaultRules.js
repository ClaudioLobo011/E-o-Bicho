const express = require('express');
const requireAuth = require('../middlewares/requireAuth');
const authorizeRoles = require('../middlewares/authorizeRoles');
const Store = require('../models/Store');
const FiscalDefaultRule = require('../models/FiscalDefaultRule');
const { normalizeFiscalData } = require('../services/fiscalRuleEngine');

const router = express.Router();

const parseRuleCode = (value) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const toRulePayload = (rule) => ({
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

router.get('/', requireAuth, authorizeRoles('admin', 'admin_master'), async (req, res) => {
  try {
    const { storeId } = req.query;
    if (!storeId) {
      return res.status(400).json({ message: 'Informe a empresa (storeId).' });
    }

    const storeExists = await ensureStoreExists(storeId);
    if (!storeExists) {
      return res.status(404).json({ message: 'Empresa nao encontrada.' });
    }

    const rules = await FiscalDefaultRule.find({ empresa: storeId })
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
    return res.status(500).json({ message: 'Erro ao carregar regras fiscais padrao.' });
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

    const storeExists = await ensureStoreExists(storeId);
    if (!storeExists) {
      return res.status(404).json({ message: 'Empresa nao encontrada.' });
    }

    const fiscalNormalized = normalizeFiscalData(fiscal || {});
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
    return res.status(500).json({ message: 'Erro ao criar regra fiscal padrao.' });
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

    const storeExists = await ensureStoreExists(storeId);
    if (!storeExists) {
      return res.status(404).json({ message: 'Empresa nao encontrada.' });
    }

    const updatedRule = await FiscalDefaultRule.findOneAndUpdate(
      { empresa: storeId, code: ruleCode },
      {
        $set: {
          name: trimmedName,
          fiscal: normalizeFiscalData(fiscal || {}),
          updatedBy: req.user?.id || '',
        },
      },
      { new: true, runValidators: true }
    ).lean();

    if (!updatedRule) {
      return res.status(404).json({ message: 'Regra nao encontrada.' });
    }

    const total = await FiscalDefaultRule.countDocuments({ empresa: storeId });
    return res.json({ rule: toRulePayload(updatedRule), total });
  } catch (error) {
    console.error('Erro ao atualizar regra fiscal padrao:', error);
    return res.status(500).json({ message: 'Erro ao atualizar regra fiscal padrao.' });
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

    const storeExists = await ensureStoreExists(storeId);
    if (!storeExists) {
      return res.status(404).json({ message: 'Empresa nao encontrada.' });
    }

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
    return res.status(500).json({ message: 'Erro ao remover regra fiscal padrao.' });
  }
});

module.exports = router;
