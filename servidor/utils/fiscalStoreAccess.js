const { hasAdminMasterGlobalAccess } = require('./adminMasterMode');

const canAccessFiscalStore = (req, storeId) => hasAdminMasterGlobalAccess(req, req.user)
  || (req.user?.storeIds || []).some(id => String(id) === String(storeId));

const assertFiscalStoreAccess = (req, storeId) => {
  if (typeof storeId !== 'string' || !/^[a-f\d]{24}$/i.test(storeId)) {
    throw Object.assign(new Error('Empresa inválida.'), { status: 400 });
  }
  if (!canAccessFiscalStore(req, storeId)) {
    throw Object.assign(new Error('Você não tem acesso à configuração fiscal desta empresa.'), { status: 403 });
  }
};

const visibleServiceFiscal = (req, service) => {
  const source = typeof service?.toObject === 'function' ? service.toObject() : service;
  if (!source || typeof source !== 'object') return source;
  return {
    ...source,
    fiscalPorEmpresa: Object.fromEntries(Object.entries(source.fiscalPorEmpresa || {})
      .filter(([storeId]) => canAccessFiscalStore(req, storeId))),
  };
};

module.exports = { canAccessFiscalStore, assertFiscalStoreAccess, visibleServiceFiscal };
