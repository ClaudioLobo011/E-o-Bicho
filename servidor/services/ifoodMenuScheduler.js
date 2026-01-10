const ExternalIntegration = require('../models/ExternalIntegration');
const { syncIfoodCatalogForStore } = require('./ifoodCatalogSync');

const DEFAULT_MENU_SYNC_INTERVAL_MS = 30 * 60 * 1000;

const resolveIntervalMs = () => {
  const raw = Number(process.env.IFOOD_MENU_SYNC_INTERVAL_MS);
  if (Number.isFinite(raw) && raw > 0) {
    return raw;
  }
  return DEFAULT_MENU_SYNC_INTERVAL_MS;
};

async function runOnce() {
  const integrations = await ExternalIntegration.find({
    'providers.ifood.enabled': true,
    'providers.ifood.hasCredentials': true,
    'providers.ifood.syncMenu': true,
  }).select('+providers.ifood.encryptedCredentials');

  for (const integration of integrations) {
    const storeId = integration?.store?.toString?.() || '';
    if (!storeId) {
      continue;
    }

    try {
      await syncIfoodCatalogForStore({ storeId, integration });
    } catch (err) {
      console.error('[ifood:menu-sync][fail]', {
        storeId,
        message: err?.message,
        status: err?.response?.status,
        data: err?.response?.data,
      });
    }
  }
}

function startIfoodMenuScheduler() {
  let inFlight = false;
  const intervalMs = resolveIntervalMs();

  const loop = async () => {
    if (inFlight) {
      setTimeout(loop, intervalMs);
      return;
    }
    inFlight = true;
    try {
      await runOnce();
    } catch (err) {
      console.error('[ifood:menu-sync][loop-error]', err?.message);
    } finally {
      inFlight = false;
      setTimeout(loop, intervalMs);
    }
  };

  loop();
}

module.exports = {
  startIfoodMenuScheduler,
};
