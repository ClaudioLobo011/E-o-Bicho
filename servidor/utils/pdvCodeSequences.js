const mongoose = require('mongoose');
const Pdv = require('../models/Pdv');
const PdvState = require('../models/PdvState');
const PdvStateSale = require('../models/PdvStateSale');
const PdvCodeRange = require('../models/PdvCodeRange');

const canonicalSaleCodeIdentifier = (pdv) => String(pdv?.codigo || pdv?.apelido || pdv?.nome || pdv?._id || 'PDV')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 12) || 'PDV';

// Only actual records establish consumption. Reservation ceilings and state counters
// must never be used to advance an existing desktop range's consumption cursor.
async function historicalPdvSequence({ pdvId, kind, identifier }) {
  if (!mongoose.Types.ObjectId.isValid(pdvId) || !['sale', 'budget'].includes(kind)) return 0;
  const pdv = new mongoose.Types.ObjectId(String(pdvId));
  const prefix = kind === 'budget' ? 'ORC' : identifier || canonicalSaleCodeIdentifier(await Pdv.findById(pdv).select('codigo apelido nome').lean());
  const regex = `^${prefix}-([0-9]+)$`;
  const maxStages = (code) => [
    { $project: { match: { $regexFind: { input: { $ifNull: [code, ''] }, regex, options: 'i' } } } },
    { $group: { _id: null, value: { $max: { $convert: { input: { $arrayElemAt: ['$match.captures', 0] }, to: 'double', onError: 0, onNull: 0 } } } } },
  ];
  const field = kind === 'sale' ? 'completedSales' : 'budgets';
  const queries = [PdvState.aggregate([
    { $match: { pdv } }, { $unwind: `$${field}` },
    ...maxStages(kind === 'sale' ? '$completedSales.saleCode' : '$budgets.code'),
  ])];
  if (kind === 'sale') queries.push(PdvStateSale.aggregate([{ $match: { pdv } }, ...maxStages('$saleCode')]));
  const results = await Promise.all(queries);
  return Math.max(0, ...results.map((rows) => Number(rows[0]?.value) || 0));
}

// New numbers must be above every persisted reservation, including revoked ones.
// The shared atomic counter also protects simultaneous web and desktop allocations.
async function pdvAllocationFloor({ scope, reference }) {
  const kind = scope === 'pdv_sale' ? 'sale' : scope === 'pdv_budget' ? 'budget' : '';
  if (!kind || !mongoose.Types.ObjectId.isValid(reference)) return 0;
  const field = kind === 'sale' ? 'saleCodeSequence' : 'budgetSequence';
  const [state, range, consumed] = await Promise.all([
    PdvState.findOne({ pdv: reference }).select(field).lean(),
    PdvCodeRange.findOne({ pdv: reference, kind }).sort({ end: -1 }).select('end').lean(),
    historicalPdvSequence({ pdvId: reference, kind }),
  ]);
  return Math.max(0, (Number(state?.[field]) || 1) - 1, Number(range?.end) || 0, consumed);
}

async function mayPreserveProvidedCode({ pdvId, kind, sequence, desktopHost }) {
  // Web drafts only preview numbers. Their definitive number always comes from
  // the atomic counter; a client-supplied flag must not impersonate an offline host.
  if (!desktopHost || String(desktopHost.pdv) !== String(pdvId)) return false;
  const ranges = await PdvCodeRange.find({ pdv: pdvId, kind, start: { $lte: sequence }, end: { $gte: sequence } })
    .select('host status expiresAt').lean();
  if (!ranges.length) {
    const { claimScopedSequence } = require('./sequences');
    if (await claimScopedSequence({ scope: kind === 'sale' ? 'pdv_sale' : 'pdv_budget', reference: String(pdvId), value: sequence })) return true;
    const error = new Error('O código legado não possui faixa comprovada e já foi alcançado pelo contador. Revise a origem antes de sincronizar.');
    error.code = 'PDV_CODE_RESERVATION_REQUIRED';
    error.statusCode = 409;
    error.disposition = 'requires_action';
    error.retryable = false;
    throw error;
  }
  if (ranges.every((range) => String(range.host) === String(desktopHost._id)
    && ['active', 'exhausted'].includes(range.status)
    && (!range.expiresAt || new Date(range.expiresAt).getTime() > Date.now()))) return true;
  const error = new Error('O código pertence a uma faixa de outro servidor local ou a uma faixa indisponível.');
  error.code = 'PDV_CODE_RANGE_OWNER_MISMATCH';
  error.statusCode = 409;
  error.disposition = 'requires_action';
  error.retryable = false;
  throw error;
}

module.exports = { canonicalSaleCodeIdentifier, historicalPdvSequence, pdvAllocationFloor, mayPreserveProvidedCode };
