const mongoose = require('mongoose');
const PdvDesktopHost = require('../models/PdvDesktopHost');

const COLLECTION_DOMAINS = new Map([
  ['products', ['products']],
  ['users', ['customers', 'employees']],
  ['pets', ['pets']],
  ['useraddresses', ['addresses']],
  ['appointments', ['appointments']],
  ['services', ['services']],
  ['stores', ['stores', 'configuration']],
  ['deposits', ['deposits']],
  ['transfers', ['transfers']],
  ['pdvs', ['configuration']],
  ['paymentmethods', ['configuration']],
  ['pdvstates', ['cash']],
  ['pdvstatesales', ['sales']],
  ['pdvstatedeliveryorders', ['deliveries']],
  ['pdvdesktopsynctombstones', ['customers', 'employees', 'pets', 'addresses', 'services', 'stores', 'deposits']],
]);

const GLOBAL_SCOPE = 'all';
const cleanId = (value) => String(value?._id || value || '').trim();

function scopesForChange(change = {}) {
  const collection = String(change?.ns?.coll || '');
  const document = change?.fullDocument || {};
  if (collection === 'pdvstatesales' || collection === 'pdvstatedeliveryorders') {
    const pdvId = cleanId(document.pdv);
    return pdvId ? [`pdv:${pdvId}`] : [GLOBAL_SCOPE];
  }
  if (collection === 'pdvs') {
    const pdvId = cleanId(document._id);
    return pdvId ? [`pdv:${pdvId}`] : [GLOBAL_SCOPE];
  }
  if (collection === 'pdvstates') {
    const pdvId = cleanId(document.pdv);
    return pdvId ? [`pdv:${pdvId}`] : [GLOBAL_SCOPE];
  }
  if (collection === 'paymentmethods') {
    const companyId = cleanId(document.company || document.empresa);
    return companyId ? [`company:${companyId}`] : [GLOBAL_SCOPE];
  }
  if (collection === 'appointments') {
    const companyId = cleanId(document.store);
    return companyId ? [`company:${companyId}`] : [GLOBAL_SCOPE];
  }
  if (collection === 'deposits') {
    const companyId = cleanId(document.empresa);
    return companyId ? [`company:${companyId}`] : [GLOBAL_SCOPE];
  }
  if (collection === 'transfers') {
    const companies = [document.originCompany, document.destinationCompany].map(cleanId).filter(Boolean);
    return companies.length ? [...new Set(companies.map((id) => `company:${id}`))] : [GLOBAL_SCOPE];
  }
  if (collection === 'pdvdesktopsynctombstones') {
    const entity = String(document.entity || '');
    const companyOnly = ['employee', 'deposit'].includes(entity);
    const companies = (Array.isArray(document.companies) ? document.companies : []).map(cleanId).filter(Boolean);
    if (companyOnly && companies.length) return [...new Set(companies.map((id) => `company:${id}`))];
  }
  // Produtos e clientes são compartilhados entre lojas. Store também fica
  // global porque uma loja pode usar outra como emitente fiscal.
  return [GLOBAL_SCOPE];
}

function startDesktopSyncChangeNotifier({ io, debounceMs = 1000, retryMs = 5 * 60 * 1000 } = {}) {
  let stream = null;
  let stopped = false;
  let flushTimer = null;
  let retryTimer = null;
  const pendingByScope = new Map();

  function addPending(scope, domains = []) {
    if (!pendingByScope.has(scope)) pendingByScope.set(scope, new Set());
    const target = pendingByScope.get(scope);
    domains.forEach((domain) => target.add(domain));
  }

  async function flush() {
    flushTimer = null;
    if (!pendingByScope.size || stopped) return;
    const pending = new Map([...pendingByScope].map(([scope, domains]) => [scope, new Set(domains)]));
    pendingByScope.clear();
    try {
      const hosts = await PdvDesktopHost.find({ status: 'active' }).select('pdv empresa').lean();
      const notifications = new Map();
      hosts.forEach((host) => {
        const pdvId = cleanId(host.pdv);
        if (!pdvId) return;
        if (!notifications.has(pdvId)) notifications.set(pdvId, new Set());
        const domains = notifications.get(pdvId);
        [GLOBAL_SCOPE, `pdv:${pdvId}`, `company:${cleanId(host.empresa)}`].forEach((scope) => {
          (pending.get(scope) || []).forEach((domain) => domains.add(domain));
        });
      });
      const timestamp = Date.now();
      notifications.forEach((domains, pdvId) => {
        if (!domains.size) return;
        io.to(`pdv:${pdvId}`).emit('desktop:sync-invalidated', {
          domains: [...domains].sort(), timestamp, pdvId,
        });
      });
    } catch (error) {
      console.warn('[PDV_SYNC_NOTIFY] Falha ao avisar PDVs:', error.message);
    }
  }

  function queue(domains = []) {
    addPending(GLOBAL_SCOPE, domains);
    if (!flushTimer) flushTimer = setTimeout(() => void flush(), debounceMs);
  }

  function queueChange(change = {}) {
    const domains = COLLECTION_DOMAINS.get(change?.ns?.coll) || [];
    scopesForChange(change).forEach((scope) => addPending(scope, domains));
    if (!flushTimer) flushTimer = setTimeout(() => void flush(), debounceMs);
  }

  function scheduleRetry() {
    if (stopped || retryTimer) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void openStream();
    }, retryMs);
    retryTimer.unref?.();
  }

  async function openStream() {
    if (stopped || mongoose.connection.readyState !== 1) return scheduleRetry();
    try {
      stream = mongoose.connection.watch([
        {
          $match: {
            operationType: { $in: ['insert', 'update', 'replace', 'delete'] },
            'ns.coll': { $in: [...COLLECTION_DOMAINS.keys()] },
          },
        },
      ], { fullDocument: 'updateLookup' });
      stream.on('change', queueChange);
      stream.on('error', (error) => {
        console.warn('[PDV_SYNC_NOTIFY] Change stream indisponível; fallback periódico permanece ativo:', error.message);
        stream = null;
        scheduleRetry();
      });
      stream.on('close', () => {
        stream = null;
        scheduleRetry();
      });
      console.log('[PDV_SYNC_NOTIFY] Avisos incrementais por change stream ativos.');
    } catch (error) {
      console.warn('[PDV_SYNC_NOTIFY] Change stream indisponível; fallback periódico permanece ativo:', error.message);
      scheduleRetry();
    }
  }

  void openStream();
  return {
    stop: async () => {
      stopped = true;
      if (flushTimer) clearTimeout(flushTimer);
      if (retryTimer) clearTimeout(retryTimer);
      if (stream) await stream.close().catch(() => {});
    },
    queue,
    queueChange,
  };
}

module.exports = { startDesktopSyncChangeNotifier, scopesForChange };
