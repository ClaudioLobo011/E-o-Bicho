const path = require('path');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const Product = require('../models/Product');
const { buildProductSearchData } = require('../utils/productSearch');

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const WRITE = process.argv.includes('--write');
const BATCH_SIZE = 500;

async function main() {
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI || process.env.DATABASE_URL;
  if (!mongoUri) {
    throw new Error('Defina MONGO_URI, MONGODB_URI ou DATABASE_URL no .env.');
  }

  await mongoose.connect(mongoUri);
  if (WRITE) {
    await Product.createIndexes();
  }

  const cursor = Product.find({})
    .select('+searchTokens +searchTokenPrefixes +searchableString')
    .lean()
    .cursor();

  let scanned = 0;
  let changed = 0;
  let operations = [];

  async function flush() {
    if (!operations.length) return;
    if (WRITE) {
      await Product.bulkWrite(operations, { ordered: false });
    }
    operations = [];
  }

  for await (const product of cursor) {
    scanned += 1;
    const searchData = buildProductSearchData(product);
    const currentTokens = Array.isArray(product.searchTokens) ? product.searchTokens : [];
    const currentPrefixes = Array.isArray(product.searchTokenPrefixes) ? product.searchTokenPrefixes : [];
    const changedTokens = JSON.stringify(currentTokens) !== JSON.stringify(searchData.tokens);
    const changedPrefixes = JSON.stringify(currentPrefixes) !== JSON.stringify(searchData.prefixes);
    const changedText = String(product.searchableString || '') !== String(searchData.text || '');

    if (changedTokens || changedPrefixes || changedText) {
      changed += 1;
      operations.push({
        updateOne: {
          filter: { _id: product._id },
          update: {
            $set: {
              searchableString: searchData.text,
              searchTokens: searchData.tokens,
              searchTokenPrefixes: searchData.prefixes,
            },
          },
        },
      });
    }

    if (operations.length >= BATCH_SIZE) {
      await flush();
    }
  }

  await flush();
  console.log(JSON.stringify({ scanned, changed, wrote: WRITE }, null, 2));
}

main()
  .catch((error) => {
    console.error('[backfill-product-search-index]', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => {});
  });
