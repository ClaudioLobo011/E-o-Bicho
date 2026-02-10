const express = require('express');
const fs = require('fs');
const path = require('path');
const requireAuth = require('../middlewares/requireAuth');
const authorizeRoles = require('../middlewares/authorizeRoles');
const Store = require('../models/Store');
const { normalizeFiscalData } = require('../services/fiscalRuleEngine');

const router = express.Router();
const rulesPath = path.join(__dirname, '..', 'data', 'fiscal-default-rules.json');

const readRulesFile = () => {
  if (!fs.existsSync(rulesPath)) {
    return { stores: {} };
  }
  try {
    const raw = fs.readFileSync(rulesPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return { stores: {} };
    }
    if (!parsed.stores || typeof parsed.stores !== 'object') {
      parsed.stores = {};
    }
    return parsed;
  } catch (error) {
    console.error('Erro ao ler fiscal-default-rules.json:', error);
    return { stores: {} };
  }
};

const writeRulesFile = (payload) => {
  const data = payload && typeof payload === 'object' ? payload : { stores: {} };
  if (!data.stores || typeof data.stores !== 'object') {
    data.stores = {};
  }
  const tmpPath = `${rulesPath}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  fs.renameSync(tmpPath, rulesPath);
};

const ensureStoreRules = (data, storeId) => {
  if (!data.stores || typeof data.stores !== 'object') {
    data.stores = {};
  }
  if (!Array.isArray(data.stores[storeId])) {
    data.stores[storeId] = [];
  }
  return data.stores[storeId];
};

const parseRuleCode = (value) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const getNextCode = (rules) => {
  if (!Array.isArray(rules) || !rules.length) return 1;
  const maxCode = rules.reduce((max, rule) => {
    const code = Number(rule?.code) || 0;
    return code > max ? code : max;
  }, 0);
  return maxCode + 1;
};

const sortRules = (rules) => {
  if (!Array.isArray(rules)) return [];
  return [...rules].sort((a, b) => {
    const left = Number(a?.code) || 0;
    const right = Number(b?.code) || 0;
    return left - right;
  });
};

router.get('/', requireAuth, authorizeRoles('admin', 'admin_master'), async (req, res) => {
  try {
    const { storeId } = req.query;
    if (!storeId) {
      return res.status(400).json({ message: 'Informe a empresa (storeId).' });
    }

    const store = await Store.findById(storeId).lean();
    if (!store) {
      return res.status(404).json({ message: 'Empresa nao encontrada.' });
    }

    const data = readRulesFile();
    const rules = ensureStoreRules(data, String(storeId));
    const sortedRules = sortRules(rules);

    res.json({
      storeId,
      total: sortedRules.length,
      nextCode: getNextCode(sortedRules),
      rules: sortedRules,
    });
  } catch (error) {
    console.error('Erro ao carregar regras fiscais padrao:', error);
    res.status(500).json({ message: 'Erro ao carregar regras fiscais padrao.' });
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

    const store = await Store.findById(storeId).lean();
    if (!store) {
      return res.status(404).json({ message: 'Empresa nao encontrada.' });
    }

    const data = readRulesFile();
    const rules = ensureStoreRules(data, String(storeId));
    const code = getNextCode(rules);
    const timestamp = new Date().toISOString();
    const rule = {
      code,
      name: trimmedName,
      fiscal: normalizeFiscalData(fiscal || {}),
      createdAt: timestamp,
      updatedAt: timestamp,
      updatedBy: req.user?.id || '',
    };
    rules.push(rule);
    writeRulesFile(data);

    res.json({
      rule,
      total: rules.length,
      nextCode: getNextCode(rules),
    });
  } catch (error) {
    console.error('Erro ao criar regra fiscal padrao:', error);
    res.status(500).json({ message: 'Erro ao criar regra fiscal padrao.' });
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

    const store = await Store.findById(storeId).lean();
    if (!store) {
      return res.status(404).json({ message: 'Empresa nao encontrada.' });
    }

    const data = readRulesFile();
    const rules = ensureStoreRules(data, String(storeId));
    const index = rules.findIndex((item) => Number(item?.code) === ruleCode);
    if (index < 0) {
      return res.status(404).json({ message: 'Regra nao encontrada.' });
    }

    const timestamp = new Date().toISOString();
    rules[index] = {
      ...rules[index],
      name: trimmedName,
      fiscal: normalizeFiscalData(fiscal || {}),
      updatedAt: timestamp,
      updatedBy: req.user?.id || '',
    };

    writeRulesFile(data);
    res.json({ rule: rules[index], total: rules.length });
  } catch (error) {
    console.error('Erro ao atualizar regra fiscal padrao:', error);
    res.status(500).json({ message: 'Erro ao atualizar regra fiscal padrao.' });
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

    const store = await Store.findById(storeId).lean();
    if (!store) {
      return res.status(404).json({ message: 'Empresa nao encontrada.' });
    }

    const data = readRulesFile();
    const rules = ensureStoreRules(data, String(storeId));
    const index = rules.findIndex((item) => Number(item?.code) === ruleCode);
    if (index < 0) {
      return res.status(404).json({ message: 'Regra nao encontrada.' });
    }

    const [removed] = rules.splice(index, 1);
    writeRulesFile(data);

    res.json({
      removed: removed?.code || ruleCode,
      total: rules.length,
      nextCode: getNextCode(rules),
    });
  } catch (error) {
    console.error('Erro ao remover regra fiscal padrao:', error);
    res.status(500).json({ message: 'Erro ao remover regra fiscal padrao.' });
  }
});

module.exports = router;
