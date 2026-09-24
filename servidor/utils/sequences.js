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
  const update = () => SequenceCounter.updateOne(
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
  try { await update(); } catch (error) {
    if (error?.code !== 11000) throw error;
    await update();
  }
  return parsed;
};

const reserveScopedSequence = async ({ scope, reference, size = 1 }) => {
  const normalizedScope = normalizePart(scope);
  const normalizedReference = normalizePart(reference);
  if (!Number.isSafeInteger(size) || size < 1 || size > 100000) throw new Error('Tamanho de reserva inválido.');
  await SequenceCounter.init();
  if (['pdv_sale', 'pdv_budget'].includes(normalizedScope)) {
    const { pdvAllocationFloor } = require('./pdvCodeSequences');
    const floor = await pdvAllocationFloor({ scope: normalizedScope, reference: normalizedReference });
    await ensureScopedSequenceAtLeast({ scope: normalizedScope, reference: normalizedReference, value: floor });
  }
  const increment = () => SequenceCounter.findOneAndUpdate(
    { scope: normalizedScope, reference: normalizedReference },
    {
      $inc: { seq: size },
      $setOnInsert: {
        scope: normalizedScope,
        reference: normalizedReference,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();
  let counter;
  try { counter = await increment(); } catch (error) {
    if (error?.code !== 11000) throw error;
    counter = await increment();
  }
  const end = Number(counter?.seq);
  if (!Number.isSafeInteger(end) || end < size) throw new Error('Contador de sequência inválido.');
  return { start: end - size + 1, end };
};

const nextScopedSequence = async (key) => (await reserveScopedSequence({ ...key, size: 1 })).end;

// Legacy offline codes without a persisted reservation can only be claimed if
// no other allocator has already advanced over them. The unique scoped index
// makes this conditional claim mutually exclusive with a concurrent reservation.
const claimScopedSequence = async ({ scope, reference, value }) => {
  if (!Number.isSafeInteger(value) || value < 1) return false;
  const key = { scope: normalizePart(scope), reference: normalizePart(reference) };
  await SequenceCounter.init();
  const { pdvAllocationFloor } = require('./pdvCodeSequences');
  await ensureScopedSequenceAtLeast({ ...key, value: await pdvAllocationFloor(key) });
  try {
    return Boolean(await SequenceCounter.findOneAndUpdate(
      { ...key, seq: { $lt: value } }, { $set: { seq: value }, $setOnInsert: key },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean());
  } catch (error) {
    if (error?.code === 11000) return false;
    throw error;
  }
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
  reserveScopedSequence,
  claimScopedSequence,
  getScopedSequence,
  customerSequenceKey,
  pdvSaleSequenceKey,
  pdvBudgetSequenceKey,
};
