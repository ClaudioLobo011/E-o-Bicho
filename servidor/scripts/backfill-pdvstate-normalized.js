const crypto = require('crypto');
const mongoose = require('mongoose');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const PdvState = require('../models/PdvState');
const PdvStateSale = require('../models/PdvStateSale');
const PdvStateReceivable = require('../models/PdvStateReceivable');
const PdvStateDeliveryOrder = require('../models/PdvStateDeliveryOrder');
const PdvStateHistoryEvent = require('../models/PdvStateHistoryEvent');
const PdvStateInventoryMovement = require('../models/PdvStateInventoryMovement');

const args = process.argv.slice(2);
const hasFlag = (flag) => args.includes(flag);
const readArgValue = (name, fallback = '') => {
  const prefix = `${name}=`;
  const found = args.find((entry) => entry.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
};

const WRITE_MODE = hasFlag('--write');
const LIMIT = Math.max(0, Number.parseInt(readArgValue('--limit', '0'), 10) || 0);
const TARGET_PDV = String(readArgValue('--pdv', '') || '').trim();

const safeDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const normalizeString = (value) => (value == null ? '' : String(value).trim());

const hashJson = (value) =>
  crypto.createHash('sha1').update(JSON.stringify(value || null)).digest('hex');

const ensureObjectId = (value) => {
  if (!value) return null;
  if (value instanceof mongoose.Types.ObjectId) return value;
  const normalized = normalizeString(value);
  return mongoose.Types.ObjectId.isValid(normalized) ? new mongoose.Types.ObjectId(normalized) : null;
};

const buildReceivableId = (entry = {}) => {
  const explicit = normalizeString(entry.id || entry._id || entry.receivableId);
  if (explicit) return explicit;
  const signature = {
    saleId: normalizeString(entry.saleId),
    parcelNumber: entry.parcelNumber ?? entry.parcela ?? entry.installmentNumber ?? 0,
    value: Number(entry.value ?? entry.valor ?? entry.amount ?? 0) || 0,
    dueDate: safeDate(entry.dueDate || entry.vencimento)?.toISOString() || '',
    paymentMethodId: normalizeString(entry.paymentMethodId || entry.metodoPagamentoId),
  };
  return `hash:${hashJson(signature)}`;
};

const buildDeliveryId = (entry = {}) => {
  const explicit = normalizeString(entry.id || entry._id || entry.deliveryId);
  if (explicit) return explicit;
  const signature = {
    saleRecordId: normalizeString(entry.saleRecordId || entry.saleId),
    saleCode: normalizeString(entry.saleCode),
    createdAt: safeDate(entry.createdAt || entry.registeredAt)?.toISOString() || '',
    status: normalizeString(entry.status),
  };
  return `hash:${hashJson(signature)}`;
};

const buildHistoryEventId = (entry = {}) => {
  const explicit = normalizeString(entry.id || entry._id || entry.eventId);
  if (explicit) return explicit;
  const signature = {
    label: normalizeString(entry.label),
    amount: Number(entry.amount ?? entry.delta ?? 0) || 0,
    timestamp: safeDate(entry.timestamp)?.toISOString() || '',
    paymentId: normalizeString(entry.paymentId),
    motivo: normalizeString(entry.motivo),
  };
  return `hash:${hashJson(signature)}`;
};

const buildMovementId = (entry = {}) => {
  const saleId = normalizeString(entry.saleId);
  const depositId = normalizeString(entry.deposit);
  if (saleId && depositId) return `${saleId}:${depositId}`;
  const explicit = normalizeString(entry.id || entry._id || entry.movementId);
  if (explicit) return explicit;
  return `hash:${hashJson(entry)}`;
};

const chunked = async (items, size, handler) => {
  for (let index = 0; index < items.length; index += size) {
    await handler(items.slice(index, index + size));
  }
};

const main = async () => {
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI não configurada.');
  }

  await mongoose.connect(process.env.MONGO_URI);

  const query = {};
  if (TARGET_PDV) {
    const pdvId = ensureObjectId(TARGET_PDV);
    if (!pdvId) throw new Error(`PDV inválido no argumento --pdv: ${TARGET_PDV}`);
    query.pdv = pdvId;
  }

  const states = await PdvState.find(query).lean();
  const selectedStates = LIMIT > 0 ? states.slice(0, LIMIT) : states;

  const saleOps = [];
  const receivableOps = [];
  const deliveryOps = [];
  const historyOps = [];
  const movementOps = [];

  const stats = {
    scannedStates: selectedStates.length,
    saleOps: 0,
    receivableOps: 0,
    deliveryOps: 0,
    historyOps: 0,
    movementOps: 0,
  };

  selectedStates.forEach((state) => {
    const pdv = ensureObjectId(state.pdv);
    if (!pdv) return;
    const empresa = ensureObjectId(state.empresa);
    const sourceState = ensureObjectId(state._id);
    const sourceUpdatedAt = safeDate(state.updatedAt) || null;

    const sales = Array.isArray(state.completedSales) ? state.completedSales : [];
    sales.forEach((sale) => {
      const saleId = normalizeString(sale?.id || sale?._id);
      if (!saleId) return;
      const saleCode = normalizeString(sale?.saleCode || sale?.saleCodeLabel);
      saleOps.push({
        updateOne: {
          filter: { pdv, saleId },
          update: {
            $set: {
              pdv,
              empresa,
              sourceState,
              sourceUpdatedAt,
              saleId,
              saleCode,
              createdAtFromEntity: safeDate(sale?.createdAt),
              payload: sale,
            },
          },
          upsert: true,
        },
      });
      stats.saleOps += 1;
    });

    const consolidatedReceivables = [
      ...(Array.isArray(state.accountsReceivable) ? state.accountsReceivable : []),
      ...sales.flatMap((sale) => (Array.isArray(sale?.receivables) ? sale.receivables : [])),
    ];
    const seenReceivables = new Set();
    consolidatedReceivables.forEach((entry) => {
      const receivableId = buildReceivableId(entry);
      if (!receivableId || seenReceivables.has(receivableId)) return;
      seenReceivables.add(receivableId);
      receivableOps.push({
        updateOne: {
          filter: { pdv, receivableId },
          update: {
            $set: {
              pdv,
              empresa,
              sourceState,
              sourceUpdatedAt,
              receivableId,
              saleId: normalizeString(entry?.saleId),
              createdAtFromEntity: safeDate(entry?.createdAt),
              payload: entry,
            },
          },
          upsert: true,
        },
      });
      stats.receivableOps += 1;
    });

    const deliveries = Array.isArray(state.deliveryOrders) ? state.deliveryOrders : [];
    deliveries.forEach((entry) => {
      const deliveryId = buildDeliveryId(entry);
      if (!deliveryId) return;
      deliveryOps.push({
        updateOne: {
          filter: { pdv, deliveryId },
          update: {
            $set: {
              pdv,
              empresa,
              sourceState,
              sourceUpdatedAt,
              deliveryId,
              saleId: normalizeString(entry?.saleRecordId || entry?.saleId),
              createdAtFromEntity: safeDate(entry?.createdAt || entry?.registeredAt),
              payload: entry,
            },
          },
          upsert: true,
        },
      });
      stats.deliveryOps += 1;
    });

    const historyEntries = Array.isArray(state.history) ? state.history : [];
    historyEntries.forEach((entry) => {
      const eventId = buildHistoryEventId(entry);
      if (!eventId) return;
      historyOps.push({
        updateOne: {
          filter: { pdv, eventId },
          update: {
            $set: {
              pdv,
              empresa,
              sourceState,
              sourceUpdatedAt,
              eventId,
              eventType: normalizeString(entry?.id || entry?.label).toLowerCase(),
              createdAtFromEntity: safeDate(entry?.timestamp),
              payload: entry,
            },
          },
          upsert: true,
        },
      });
      stats.historyOps += 1;
    });

    const movements = Array.isArray(state.inventoryMovements) ? state.inventoryMovements : [];
    movements.forEach((entry) => {
      const movementId = buildMovementId(entry);
      if (!movementId) return;
      movementOps.push({
        updateOne: {
          filter: { pdv, movementId },
          update: {
            $set: {
              pdv,
              empresa,
              sourceState,
              sourceUpdatedAt,
              movementId,
              saleId: normalizeString(entry?.saleId),
              deposit: ensureObjectId(entry?.deposit),
              createdAtFromEntity: safeDate(entry?.processedAt),
              payload: entry,
            },
          },
          upsert: true,
        },
      });
      stats.movementOps += 1;
    });
  });

  if (WRITE_MODE) {
    await chunked(saleOps, 500, (ops) => PdvStateSale.bulkWrite(ops, { ordered: false }));
    await chunked(receivableOps, 500, (ops) => PdvStateReceivable.bulkWrite(ops, { ordered: false }));
    await chunked(deliveryOps, 500, (ops) => PdvStateDeliveryOrder.bulkWrite(ops, { ordered: false }));
    await chunked(historyOps, 500, (ops) => PdvStateHistoryEvent.bulkWrite(ops, { ordered: false }));
    await chunked(movementOps, 500, (ops) => PdvStateInventoryMovement.bulkWrite(ops, { ordered: false }));
  }

  const targetCounts = WRITE_MODE
    ? {
        sales: await PdvStateSale.estimatedDocumentCount(),
        receivables: await PdvStateReceivable.estimatedDocumentCount(),
        deliveries: await PdvStateDeliveryOrder.estimatedDocumentCount(),
        historyEvents: await PdvStateHistoryEvent.estimatedDocumentCount(),
        inventoryMovements: await PdvStateInventoryMovement.estimatedDocumentCount(),
      }
    : null;

  console.log(
    JSON.stringify(
      {
        ok: true,
        mode: WRITE_MODE ? 'write' : 'dry-run',
        targetPdv: TARGET_PDV || null,
        limit: LIMIT || null,
        stats,
        targetCounts,
      },
      null,
      2
    )
  );
};

main()
  .catch((error) => {
    console.error(
      JSON.stringify(
        {
          ok: false,
          mode: WRITE_MODE ? 'write' : 'dry-run',
          message: error.message,
          stack: error.stack,
        },
        null,
        2
      )
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => {});
  });

