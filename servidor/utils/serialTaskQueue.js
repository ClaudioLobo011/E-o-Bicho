function normalizeQueueKey(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function createNoopLogger() {
  return {
    warn() {},
  };
}

function sanitizeMeta(meta = {}) {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
    return {};
  }
  const result = {};
  for (const [key, value] of Object.entries(meta)) {
    if (value === undefined) continue;
    if (value === null) {
      result[key] = null;
      continue;
    }
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      result[key] = value;
      continue;
    }
    result[key] = String(value);
  }
  return result;
}

function createSerialTaskQueue({
  staleAfterMs = 90_000,
  label = 'serial-task-queue',
  logger = createNoopLogger(),
} = {}) {
  const queues = new Map();

  const getQueue = (rawKey) => {
    const key = normalizeQueueKey(rawKey);
    let queue = queues.get(key);
    if (!queue) {
      queue = {
        key,
        tail: Promise.resolve(),
        activeStartedAt: 0,
        activeToken: null,
        activeMeta: null,
      };
      queues.set(key, queue);
    }
    return queue;
  };

  const enqueue = async (rawKey, task, meta = {}) => {
    if (typeof task !== 'function') {
      throw new TypeError('task must be a function');
    }

    const queue = getQueue(rawKey);
    const safeMeta = sanitizeMeta(meta);
    const now = Date.now();
    const activeAgeMs = queue.activeStartedAt > 0 ? now - queue.activeStartedAt : 0;

    if (queue.activeStartedAt > 0 && activeAgeMs > staleAfterMs) {
      logger.warn(`[${label}] stale task detected, resetting queue chain`, {
        key: queue.key,
        activeAgeMs,
        staleAfterMs,
        activeMeta: queue.activeMeta || null,
        nextMeta: safeMeta,
      });
      queue.tail = Promise.resolve();
      queue.activeStartedAt = 0;
      queue.activeToken = null;
      queue.activeMeta = null;
    }

    const executionToken = Symbol(`${label}:${queue.key}`);
    const previous = queue.tail;
    const runTask = async () => {
      queue.activeStartedAt = Date.now();
      queue.activeToken = executionToken;
      queue.activeMeta = safeMeta;
      try {
        return await task();
      } finally {
        if (queue.activeToken === executionToken) {
          queue.activeStartedAt = 0;
          queue.activeToken = null;
          queue.activeMeta = null;
        }
      }
    };

    const current = Promise.resolve(previous)
      .catch(() => {})
      .then(runTask);

    queue.tail = current.finally(() => {
      if (queue.tail === current && queue.activeToken === null) {
        queues.delete(queue.key);
      }
    });

    return current;
  };

  const inspect = (rawKey) => {
    const key = normalizeQueueKey(rawKey);
    const queue = queues.get(key);
    if (!queue) {
      return null;
    }
    return {
      key,
      activeStartedAt: queue.activeStartedAt || 0,
      activeMeta: queue.activeMeta || null,
      activeAgeMs: queue.activeStartedAt > 0 ? Math.max(0, Date.now() - queue.activeStartedAt) : 0,
    };
  };

  const clear = (rawKey) => {
    const key = normalizeQueueKey(rawKey);
    queues.delete(key);
  };

  return {
    enqueue,
    inspect,
    clear,
  };
}

module.exports = {
  createSerialTaskQueue,
};
