const STAFF_ROLES = new Set(['funcionario', 'franqueado', 'franqueador', 'admin', 'admin_master']);

module.exports = function authorizeRoles(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(403).json({ message: 'Acesso negado' });
    }
    const role = req.user.role;
    if (allowedRoles.includes(role)) {
      return next();
    }
    if (allowedRoles.includes('admin') && STAFF_ROLES.has(role)) {
      return next();
    }
    return res.status(403).json({ message: 'Acesso negado' });
  };
};
