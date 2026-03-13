const FALSE_VALUES = new Set(['0', 'false', 'off', 'no', 'nao', 'não', '']);

const normalizeHeaderValue = (value) => {
  if (Array.isArray(value)) {
    return String(value[0] ?? '').trim().toLowerCase();
  }
  return String(value ?? '').trim().toLowerCase();
};

const isAdminMasterModeActive = (req) => {
  const raw = req?.headers?.['x-admin-master-active'];
  if (raw === undefined || raw === null) return true;
  const normalized = normalizeHeaderValue(raw);
  return !FALSE_VALUES.has(normalized);
};

const resolveEffectiveRole = (req, role) => {
  if (role !== 'admin_master') return role;
  return isAdminMasterModeActive(req) ? 'admin_master' : 'admin';
};

const hasAdminMasterGlobalAccess = (req, userOrRole) => {
  const role =
    typeof userOrRole === 'string'
      ? userOrRole
      : userOrRole && typeof userOrRole === 'object'
      ? userOrRole.role
      : '';
  return role === 'admin_master' && isAdminMasterModeActive(req);
};

module.exports = {
  isAdminMasterModeActive,
  resolveEffectiveRole,
  hasAdminMasterGlobalAccess,
};

