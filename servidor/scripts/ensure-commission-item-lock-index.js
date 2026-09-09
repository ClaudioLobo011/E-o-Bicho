const path = require('path');
const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '..', '.env'), quiet: true });
mongoose.set('autoIndex', false);

const CommissionItemLock = require('../models/CommissionItemLock');

const APPLY = process.argv.includes('--apply');
const CONFIRMED = process.argv.includes('--confirm-unique-lock-index');

const definitions = [
  { name: 'key_1', key: { key: 1 }, options: { unique: true } },
  {
    name: 'profissional_1_store_1_date_1',
    key: { profissional: 1, store: 1, date: 1 },
    options: {},
  },
];

function sameKey(left, right) {
  return JSON.stringify(left || {}) === JSON.stringify(right || {});
}

async function main() {
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI || process.env.DATABASE_URL;
  if (!mongoUri) throw new Error('Defina MONGO_URI no servidor/.env.');
  if (APPLY && !CONFIRMED) {
    throw new Error('Para aplicar, use --apply --confirm-unique-lock-index.');
  }

  await mongoose.connect(mongoUri, {
    autoIndex: false,
    compressors: ['zlib'],
    zlibCompressionLevel: 6,
  });

  const collectionName = CommissionItemLock.collection.collectionName;
  const collectionExists = await mongoose.connection.db
    .listCollections({ name: collectionName }, { nameOnly: true })
    .hasNext();
  const collection = mongoose.connection.db.collection(collectionName);
  const indexes = collectionExists ? await collection.indexes() : [];
  const duplicates = collectionExists
    ? await collection
        .aggregate([
          { $match: { key: { $type: 'string', $ne: '' } } },
          { $group: { _id: '$key', count: { $sum: 1 } } },
          { $match: { count: { $gt: 1 } } },
          { $limit: 20 },
        ])
        .toArray()
    : [];

  const report = definitions.map((definition) => {
    const equivalent = indexes.find((index) => sameKey(index.key, definition.key));
    const compatible = Boolean(
      equivalent && (!definition.options.unique || equivalent.unique === true),
    );
    return {
      name: definition.name,
      key: definition.key,
      status: compatible ? 'presente' : equivalent ? 'incompatível' : 'ausente',
      actualName: equivalent?.name || '',
    };
  });

  if (APPLY) {
    if (duplicates.length) {
      throw new Error('Existem chaves duplicadas; o índice único não pode ser criado com segurança.');
    }
    const incompatible = report.find((entry) => entry.status === 'incompatível');
    if (incompatible) {
      throw new Error(`O índice ${incompatible.actualName} existe com opções incompatíveis.`);
    }
    for (const definition of definitions) {
      const entry = report.find((item) => sameKey(item.key, definition.key));
      if (entry.status === 'presente') continue;
      entry.actualName = await collection.createIndex(definition.key, {
        ...definition.options,
        name: definition.name,
      });
      entry.status = 'criado';
    }
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        mode: APPLY ? 'apply' : 'dry-run',
        collection: collectionName,
        collectionExists,
        duplicateKeys: duplicates.length,
        duplicateSamples: duplicates.map((entry) => ({ key: entry._id, count: entry.count })),
        indexes: report,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(JSON.stringify({ ok: false, mode: APPLY ? 'apply' : 'dry-run', message: error.message }, null, 2));
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => {});
  });
