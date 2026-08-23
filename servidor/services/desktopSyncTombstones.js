const PdvDesktopSyncTombstone = require('../models/PdvDesktopSyncTombstone');

function normalizeIds(values = []) {
  return [...new Set((Array.isArray(values) ? values : [values])
    .map((value) => String(value || '').trim())
    .filter(Boolean))];
}

async function recordDesktopSyncDeletion({ entity, entityId, ownerId = '', companies = [] } = {}) {
  const id = String(entityId || '').trim();
  if (!entity || !id) return null;
  const deletedAt = new Date();
  return PdvDesktopSyncTombstone.findOneAndUpdate(
    { entity, entityId: id },
    {
      $set: {
        ownerId: String(ownerId || '').trim(),
        companies: normalizeIds(companies),
        deletedAt,
        updatedAt: deletedAt,
      },
      $setOnInsert: { createdAt: deletedAt },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

async function recordDesktopSyncDeletions(entries = []) {
  return Promise.all(entries.map((entry) => recordDesktopSyncDeletion(entry)));
}

module.exports = { recordDesktopSyncDeletion, recordDesktopSyncDeletions };
