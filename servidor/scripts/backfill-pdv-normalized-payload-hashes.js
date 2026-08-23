const crypto = require('crypto');
const mongoose = require('mongoose');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const PdvStateSale = require('../models/PdvStateSale');
const PdvStateReceivable = require('../models/PdvStateReceivable');
const PdvStateDeliveryOrder = require('../models/PdvStateDeliveryOrder');
const PdvStateHistoryEvent = require('../models/PdvStateHistoryEvent');
const PdvStateInventoryMovement = require('../models/PdvStateInventoryMovement');

const WRITE_MODE = process.argv.includes('--write');
const models = [
  PdvStateSale,
  PdvStateReceivable,
  PdvStateDeliveryOrder,
  PdvStateHistoryEvent,
  PdvStateInventoryMovement,
];

const hashPayload = (payload) =>
  crypto.createHash('sha1').update(JSON.stringify(payload || null)).digest('hex');

async function backfillModel(model) {
  const filter = { $or: [{ payloadHash: { $exists: false } }, { payloadHash: '' }, { payloadHash: null }] };
  const missing = await model.countDocuments(filter);
  let updated = 0;
  if (WRITE_MODE && missing) {
    const cursor = model.find(filter).select('_id payload').lean().cursor();
    let operations = [];
    for await (const document of cursor) {
      operations.push({
        updateOne: {
          filter: { _id: document._id },
          update: { $set: { payloadHash: hashPayload(document.payload) } },
        },
      });
      if (operations.length >= 500) {
        const result = await model.collection.bulkWrite(operations, { ordered: false });
        updated += Number(result.modifiedCount || 0);
        operations = [];
      }
    }
    if (operations.length) {
      const result = await model.collection.bulkWrite(operations, { ordered: false });
      updated += Number(result.modifiedCount || 0);
    }
  }
  return { collection: model.collection.collectionName, missing, updated };
}

async function main() {
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!mongoUri) throw new Error('MONGO_URI/MONGODB_URI não configurada.');
  await mongoose.connect(mongoUri, { compressors: ['zlib'], zlibCompressionLevel: 6 });
  const collections = [];
  for (const model of models) collections.push(await backfillModel(model));
  console.log(JSON.stringify({ mode: WRITE_MODE ? 'write' : 'dry-run', collections }, null, 2));
}

main()
  .catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => {});
  });
