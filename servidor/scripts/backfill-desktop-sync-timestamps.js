const mongoose = require('mongoose');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const Product = require('../models/Product');
const User = require('../models/User');
const Pet = require('../models/Pet');
const UserAddress = require('../models/UserAddress');
const Appointment = require('../models/Appointment');
const Service = require('../models/Service');
const Store = require('../models/Store');
const Deposit = require('../models/Deposit');
const Transfer = require('../models/Transfer');
const PdvStateSale = require('../models/PdvStateSale');
const PdvStateDeliveryOrder = require('../models/PdvStateDeliveryOrder');

const WRITE_MODE = process.argv.slice(2).includes('--write');
const MODELS = {
  Product, User, Pet, UserAddress, Appointment, Service, Store, Deposit, Transfer,
  PdvStateSale, PdvStateDeliveryOrder,
};

async function main() {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI não configurada.');
  await mongoose.connect(process.env.MONGO_URI, { compressors: ['zlib'], zlibCompressionLevel: 6 });
  const report = {};
  for (const [name, Model] of Object.entries(MODELS)) {
    const missing = { $or: [{ updatedAt: { $exists: false } }, { updatedAt: null }] };
    const before = await Model.collection.countDocuments(missing);
    let modified = 0;
    if (WRITE_MODE && before) {
      const result = await Model.collection.updateMany(missing, [{
        $set: {
          updatedAt: { $convert: { input: '$_id', to: 'date', onError: '$$NOW', onNull: '$$NOW' } },
        },
      }]);
      modified = Number(result.modifiedCount || 0);
    }
    const after = WRITE_MODE ? await Model.collection.countDocuments(missing) : before;
    report[name] = { before, modified, after };
  }
  console.log(JSON.stringify({ ok: true, mode: WRITE_MODE ? 'write' : 'dry-run', report }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, mode: WRITE_MODE ? 'write' : 'dry-run', message: error.message, stack: error.stack }, null, 2));
  process.exitCode = 1;
}).finally(async () => {
  await mongoose.disconnect().catch(() => {});
});
