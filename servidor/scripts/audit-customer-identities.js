const path = require('path');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const User = require('../models/User');
const { normalizeBrazilPhone, effectiveWebAccountStatus } = require('../utils/customerIdentity');

dotenv.config({ path: path.resolve(__dirname, '..', '.env'), quiet: true });
const APPLY = process.argv.includes('--apply');

async function main() {
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI || process.env.DATABASE_URL;
  if (!mongoUri) throw new Error('Defina MONGO_URI, MONGODB_URI ou DATABASE_URL no .env.');
  await mongoose.connect(mongoUri);
  const customers = await User.find({ role: 'cliente' })
    .select('_id email celular celularNormalizado webAccountStatus role')
    .lean();
  const byPhone = new Map();
  customers.forEach((customer) => {
    const phone = normalizeBrazilPhone(customer.celularNormalizado || customer.celular);
    if (!phone) return;
    if (!byPhone.has(phone)) byPhone.set(phone, []);
    byPhone.get(phone).push(customer);
  });
  const duplicates = [...byPhone.entries()]
    .filter(([, entries]) => entries.length > 1)
    .map(([phone, entries]) => ({ phone, ids: entries.map((entry) => String(entry._id)), emails: entries.map((entry) => entry.email) }));
  const duplicatePhones = new Set(duplicates.map((entry) => entry.phone));
  const operations = [];
  customers.forEach((customer) => {
    const phone = normalizeBrazilPhone(customer.celularNormalizado || customer.celular);
    const status = effectiveWebAccountStatus(customer);
    const set = {};
    if (phone && !duplicatePhones.has(phone) && customer.celularNormalizado !== phone) set.celularNormalizado = phone;
    if (!customer.webAccountStatus) set.webAccountStatus = status;
    if (Object.keys(set).length) operations.push({ updateOne: { filter: { _id: customer._id }, update: { $set: set } } });
  });
  if (APPLY && operations.length) await User.bulkWrite(operations, { ordered: false });
  console.log(JSON.stringify({ scanned: customers.length, safeUpdates: operations.length, duplicates, applied: APPLY }, null, 2));
}

main().catch((error) => { console.error('[audit-customer-identities]', error); process.exitCode = 1; })
  .finally(async () => mongoose.disconnect().catch(() => {}));
