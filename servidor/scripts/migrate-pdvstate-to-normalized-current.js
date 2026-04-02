const path = require('path');
const mongoose = require('mongoose');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const PdvState = require('../models/PdvState');
const PdvStateNormalized = require('../models/PdvStateNormalized');

const args = process.argv.slice(2);
const hasFlag = (flag) => args.includes(flag);
const readArgValue = (name, fallback = '') => {
  const prefix = `${name}=`;
  const found = args.find((entry) => entry.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
};

const WRITE_MODE = hasFlag('--write');
const TARGET_PDV = String(readArgValue('--pdv', '') || '').trim();
const LIMIT = Math.max(0, Number.parseInt(readArgValue('--limit', '0'), 10) || 0);

const toObjectIdOrNull = (value) => {
  if (!value) return null;
  if (value instanceof mongoose.Types.ObjectId) return value;
  const normalized = String(value).trim();
  return mongoose.Types.ObjectId.isValid(normalized) ? new mongoose.Types.ObjectId(normalized) : null;
};

const main = async () => {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.DATABASE_URL;
  if (!mongoUri) {
    throw new Error('MONGO_URI/MONGODB_URI não configurada no .env');
  }

  await mongoose.connect(mongoUri);

  const query = {};
  if (TARGET_PDV) {
    const pdvId = toObjectIdOrNull(TARGET_PDV);
    if (!pdvId) throw new Error(`PDV inválido em --pdv: ${TARGET_PDV}`);
    query.pdv = pdvId;
  }

  const legacySchema = PdvState.schema.clone();
  const LegacyPdvState =
    mongoose.models.PdvStateLegacySource ||
    mongoose.model('PdvStateLegacySource', legacySchema, 'pdvstates');

  const sourceDocs = await LegacyPdvState.find(query).sort({ updatedAt: -1 }).lean();
  const docs = LIMIT > 0 ? sourceDocs.slice(0, LIMIT) : sourceDocs;

  const ops = docs.map((doc) => {
    const legacyId = doc._id;
    const payload = { ...doc };
    delete payload._id;
    return {
      updateOne: {
        filter: { pdv: doc.pdv },
        update: {
          $set: payload,
          $setOnInsert: { migratedFromLegacyId: legacyId },
        },
        upsert: true,
      },
    };
  });

  console.info(
    `[migrate-pdvstate-to-normalized-current] encontrados=${docs.length} modo=${WRITE_MODE ? 'write' : 'dry-run'}`
  );

  if (WRITE_MODE && ops.length) {
    await PdvStateNormalized.bulkWrite(ops, { ordered: false });
    console.info('[migrate-pdvstate-to-normalized-current] migração concluída.');
  }

  await mongoose.disconnect();
};

main().catch(async (error) => {
  console.error('[migrate-pdvstate-to-normalized-current] erro:', error);
  try {
    await mongoose.disconnect();
  } catch (_) {
    // noop
  }
  process.exit(1);
});
