const express = require('express');
const mongoose = require('mongoose');

const Setting = require('../models/Setting');
const User = require('../models/User');
const requireAuth = require('../middlewares/requireAuth');
const authorizeRoles = require('../middlewares/authorizeRoles');

const router = express.Router();

const SCREEN_SECURITY_PREFIX = 'admin_screen_security';
const MAX_SCREEN_KEY_LENGTH = 200;

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || ''));

const normalizeStoreId = (value) => {
  if (!value) return '';
  const raw = typeof value === 'object' && value._id ? value._id : value;
  const str = String(raw || '').trim();
  return isValidObjectId(str) ? str : '';
};

const resolveUserStoreAccess = async (userId) => {
  if (!userId) return { allowedStoreIds: [], defaultStoreId: '', allowAllStores: false };
  const user = await User.findById(userId).select('empresaPrincipal empresas role').lean();
  if (!user) return { allowedStoreIds: [], defaultStoreId: '', allowAllStores: false };

  const allowedSet = new Set();
  const principal = normalizeStoreId(user.empresaPrincipal);
  if (principal) allowedSet.add(principal);

  if (Array.isArray(user.empresas)) {
    user.empresas.forEach((id) => {
      const normalized = normalizeStoreId(id);
      if (normalized) allowedSet.add(normalized);
    });
  }

  const allowedStoreIds = Array.from(allowedSet);
  const defaultStoreId = principal || allowedStoreIds[0] || '';
  const allowAllStores = user.role === 'admin_master' && allowedStoreIds.length === 0;

  return { allowedStoreIds, defaultStoreId, allowAllStores };
};

const getSettingKey = (storeId) => `${SCREEN_SECURITY_PREFIX}:${storeId}`;

const sanitizeRules = (rules) => {
  if (!rules || typeof rules !== 'object') return {};
  const sanitized = {};

  Object.entries(rules).forEach(([key, value]) => {
    if (!key || typeof key !== 'string') return;
    const trimmedKey = key.trim();
    if (!trimmedKey || trimmedKey.length > MAX_SCREEN_KEY_LENGTH) return;
    if (!value || typeof value !== 'object') return;

    const entry = {
      hide: Boolean(value.hide),
      block: Boolean(value.block),
      password: Boolean(value.password),
    };

    if (entry.hide || entry.block || entry.password) {
      sanitized[trimmedKey] = entry;
    }
  });

  return sanitized;
};

// GET /api/admin/screen-security?storeId=...
router.get('/', requireAuth, authorizeRoles('admin', 'admin_master', 'funcionario'), async (req, res) => {
  try {
    const queryStoreId = normalizeStoreId(req.query.storeId || req.query.companyId || req.query.empresa);
    const { allowedStoreIds, defaultStoreId, allowAllStores } = await resolveUserStoreAccess(req.user?.id);
    const storeId = queryStoreId || defaultStoreId;

    if (storeId && !allowAllStores && !allowedStoreIds.includes(storeId)) {
      return res.status(403).json({ message: 'Acesso negado' });
    }

    if (!storeId) {
      return res.json({ storeId: '', rules: {} });
    }

    const setting = await Setting.findOne({ key: getSettingKey(storeId) }).lean();
    const value = setting?.value;

    let rules = {};
    let updatedAt = null;
    let updatedBy = null;

    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (value.rules && typeof value.rules === 'object') {
        rules = value.rules;
        updatedAt = value.updatedAt || null;
        updatedBy = value.updatedBy || null;
      } else {
        rules = value;
      }
    }

    return res.json({ storeId, rules, updatedAt, updatedBy });
  } catch (error) {
    console.error('Erro ao buscar regras de seguranca de telas:', error);
    return res.status(500).json({ message: 'Erro ao buscar regras de seguranca.' });
  }
});

// PUT /api/admin/screen-security { storeId, rules }
router.put('/', requireAuth, authorizeRoles('admin', 'admin_master'), async (req, res) => {
  try {
    const bodyStoreId = normalizeStoreId(
      req.body?.storeId || req.body?.companyId || req.body?.empresa || req.query.storeId
    );
    if (!bodyStoreId) {
      return res.status(400).json({ message: 'Informe a empresa.' });
    }

    const { allowedStoreIds, allowAllStores } = await resolveUserStoreAccess(req.user?.id);
    if (!allowAllStores && !allowedStoreIds.includes(bodyStoreId)) {
      return res.status(403).json({ message: 'Acesso negado' });
    }

    const rules = sanitizeRules(req.body?.rules);
    const payload = {
      rules,
      updatedAt: new Date().toISOString(),
      updatedBy: req.user?.id || null,
    };

    await Setting.findOneAndUpdate(
      { key: getSettingKey(bodyStoreId) },
      { value: payload },
      { upsert: true, new: true }
    );

    return res.json({
      storeId: bodyStoreId,
      rules,
      updatedAt: payload.updatedAt,
      updatedBy: payload.updatedBy,
    });
  } catch (error) {
    console.error('Erro ao salvar regras de seguranca de telas:', error);
    return res.status(500).json({ message: 'Erro ao salvar regras de seguranca.' });
  }
});

module.exports = router;
