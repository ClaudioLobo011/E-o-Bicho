const SequenceCounter = require('../models/SequenceCounter');

const normalizePart = (value, fallback = 'default') => {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  return normalized || fallback;
};

const buildReference = (...parts) => parts.map((part) => normalizePart(part)).join(':');

const ensureScopedSequenceAtLeast = async ({ scope, reference, value }) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  await SequenceCounter.updateOne(
    { scope: normalizePart(scope), reference: normalizePart(reference) },
    {
      $max: { seq: parsed },
      $setOnInsert: {
        scope: normalizePart(scope),
        reference: normalizePart(reference),
      },
    },
    { upsert: true }
  );
  return parsed;
};

const nextScopedSequence = async ({ scope, reference }) => {
  const normalizedScope = normalizePart(scope);
  const normalizedReference = normalizePart(reference);
  const counter = await SequenceCounter.findOneAndUpdate(
    { scope: normalizedScope, reference: normalizedReference },
    {
      $inc: { seq: 1 },
      $setOnInsert: {
        scope: normalizedScope,
        reference: normalizedReference,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();
  return Number.parseInt(counter?.seq, 10) || 1;
};

const getScopedSequence = async ({ scope, reference }) => {
  const counter = await SequenceCounter.findOne({
    scope: normalizePart(scope),
    reference: normalizePart(reference),
  })
    .select('seq')
    .lean();
  return Number.parseInt(counter?.seq, 10) || 0;
};

const customerSequenceKey = () => ({
  scope: 'customer',
  reference: 'global',
});

const pdvSaleSequenceKey = (pdvId) => ({
  scope: 'pdv_sale',
  reference: buildReference(pdvId),
});

const pdvBudgetSequenceKey = (pdvId) => ({
  scope: 'pdv_budget',
  reference: buildReference(pdvId),
});

module.exports = {
  ensureScopedSequenceAtLeast,
  nextScopedSequence,
  getScopedSequence,
  customerSequenceKey,
  pdvSaleSequenceKey,
  pdvBudgetSequenceKey,
};
