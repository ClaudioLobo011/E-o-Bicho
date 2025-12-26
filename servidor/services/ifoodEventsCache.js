// Cache simples em memória para eventos iFood por loja
const cache = new Map(); // storeId -> array de eventos

const eventKey = (evt) => evt?.id || evt?.eventId || evt?.orderId || JSON.stringify(evt);

function mergeEvents(storeId, events = []) {
  const key = String(storeId);
  const existing = Array.isArray(cache.get(key)) ? cache.get(key) : [];
  const map = new Map();
  [...existing, ...events].forEach((evt) => {
    const k = eventKey(evt);
    if (!k) return;
    map.set(k, evt);
  });
  const merged = Array.from(map.values());
  cache.set(key, merged);
  return merged;
}

function getEvents(storeId) {
  const key = String(storeId);
  const existing = cache.get(key);
  return Array.isArray(existing) ? existing : [];
}

function clearEvents(storeId) {
  cache.delete(String(storeId));
}

module.exports = {
  mergeEvents,
  getEvents,
  clearEvents,
};
