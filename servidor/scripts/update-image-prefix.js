#!/usr/bin/env node

const path = require('path');
const dotenv = require('dotenv');
const mongoose = require('mongoose');
const connectDB = require('../config/db');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const DEFAULT_LEGACY_BASE = 'https://pub-d39d1e4bf3834e4197203327d74b5838.r2.dev';

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');

function getArgValue(flag) {
  const directIndex = args.indexOf(flag);
  if (directIndex >= 0 && directIndex < args.length - 1) {
    return args[directIndex + 1];
  }
  const inline = args.find((value) => value.startsWith(`${flag}=`));
  if (inline) {
    return inline.slice(flag.length + 1);
  }
  return '';
}

const legacyBase =
  (getArgValue('--from') || getArgValue('--old') || process.env.R2_PUBLIC_BASE_URL_OLD || DEFAULT_LEGACY_BASE).trim();
const newBase = (process.env.R2_PUBLIC_BASE_URL || '').trim();
const collectionFilter = getArgValue('--collections');

function log(message) {
  // eslint-disable-next-line no-console
  console.log(message);
}

function normalizeBase(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

const normalizedLegacy = normalizeBase(legacyBase);
const normalizedNew = normalizeBase(newBase);

function isPlainObject(value) {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return false;
  if (value instanceof Date) return false;
  if (Buffer.isBuffer(value)) return false;
  if (value._bsontype) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function replacePrefix(value, stats) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed || !trimmed.startsWith(normalizedLegacy)) return value;

  const remainder = trimmed.slice(normalizedLegacy.length).replace(/^\/+/, '');
  const updated = remainder ? `${normalizedNew}/${remainder}` : normalizedNew;

  if (updated !== value) {
    stats.replacements += 1;
  }
  return updated;
}

function replaceInValue(value, stats) {
  if (typeof value === 'string') {
    const updated = replacePrefix(value, stats);
    return { value: updated, changed: updated !== value };
  }

  if (Array.isArray(value)) {
    let changed = false;
    const updated = value.map((entry) => {
      const result = replaceInValue(entry, stats);
      if (result.changed) {
        changed = true;
      }
      return result.value;
    });
    return { value: changed ? updated : value, changed };
  }

  if (isPlainObject(value)) {
    let changed = false;
    const updated = {};
    for (const [key, entry] of Object.entries(value)) {
      const result = replaceInValue(entry, stats);
      if (result.changed) {
        changed = true;
      }
      updated[key] = result.value;
    }
    return { value: changed ? updated : value, changed };
  }

  return { value, changed: false };
}

async function updateCollection(collection) {
  const cursor = collection.find({}, { batchSize: 200 });
  let scanned = 0;
  let updated = 0;
  let replacements = 0;

  while (await cursor.hasNext()) {
    const doc = await cursor.next();
    scanned += 1;

    const stats = { replacements: 0 };
    const result = replaceInValue(doc, stats);

    if (result.changed) {
      updated += 1;
      replacements += stats.replacements;
      if (!isDryRun) {
        await collection.replaceOne({ _id: doc._id }, result.value);
      }
    }
  }

  await cursor.close();
  return { scanned, updated, replacements };
}

async function main() {
  if (!normalizedNew) {
    log('Missing R2_PUBLIC_BASE_URL in .env.');
    process.exit(1);
  }

  if (!normalizedLegacy) {
    log('Missing legacy base URL. Use --from <old_base> or set R2_PUBLIC_BASE_URL_OLD.');
    process.exit(1);
  }

  if (normalizedLegacy === normalizedNew) {
    log('Legacy base matches new base. Nothing to update.');
    process.exit(0);
  }

  log(`Legacy base: ${normalizedLegacy}`);
  log(`New base: ${normalizedNew}`);
  if (isDryRun) {
    log('Dry run enabled. No database changes will be saved.');
  }

  await connectDB();

  const db = mongoose.connection.db;
  let collections = await db.listCollections().toArray();
  collections = collections.filter((entry) => entry?.name && !entry.name.startsWith('system.'));

  if (collectionFilter) {
    const allowed = new Set(
      collectionFilter
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean)
    );
    collections = collections.filter((entry) => allowed.has(entry.name));
  }

  if (!collections.length) {
    log('No collections to process.');
    await mongoose.disconnect();
    process.exit(0);
  }

  let totalScanned = 0;
  let totalUpdated = 0;
  let totalReplacements = 0;

  for (const entry of collections) {
    const collection = db.collection(entry.name);
    // eslint-disable-next-line no-await-in-loop
    const result = await updateCollection(collection);
    totalScanned += result.scanned;
    totalUpdated += result.updated;
    totalReplacements += result.replacements;
    log(
      `Collection ${entry.name}: scanned=${result.scanned}, updated=${result.updated}, replacements=${result.replacements}`
    );
  }

  log(`Total scanned=${totalScanned}, updated=${totalUpdated}, replacements=${totalReplacements}`);

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('Failed to update image prefixes:', error);
  mongoose
    .disconnect()
    .catch((disconnectError) => console.error('Failed to disconnect from MongoDB:', disconnectError))
    .finally(() => process.exit(1));
});
