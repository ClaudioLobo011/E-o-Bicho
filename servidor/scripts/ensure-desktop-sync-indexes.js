const mongoose = require('mongoose');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const Product = require('../models/Product');
const PdvStateSale = require('../models/PdvStateSale');
const PdvStateDeliveryOrder = require('../models/PdvStateDeliveryOrder');
const PdvDesktopHost = require('../models/PdvDesktopHost');
const Pet = require('../models/Pet');
const UserAddress = require('../models/UserAddress');
const User = require('../models/User');
const Appointment = require('../models/Appointment');
const Transfer = require('../models/Transfer');
const Service = require('../models/Service');
const Store = require('../models/Store');
const Deposit = require('../models/Deposit');
const PdvDesktopSyncTombstone = require('../models/PdvDesktopSyncTombstone');

const WRITE_MODE = process.argv.includes('--write');

const indexDefinitions = [
  { model: Product, name: 'pdv_sync_updatedAt_id', key: { updatedAt: 1, _id: 1 } },
  { model: PdvStateSale, name: 'pdv_sync_pdv_id', key: { pdv: 1, _id: 1 } },
  { model: PdvStateSale, name: 'pdv_sync_pdv_updatedAt_id', key: { pdv: 1, updatedAt: 1, _id: 1 } },
  { model: PdvStateDeliveryOrder, name: 'pdv_sync_delivery_pdv_updatedAt_id', key: { pdv: 1, updatedAt: 1, _id: 1 } },
  { model: PdvDesktopHost, name: 'pdv_sync_host_token_status', key: { tokenHash: 1, status: 1 } },
  { model: User, name: 'pdv_sync_user_updatedAt_id', key: { updatedAt: 1, _id: 1 } },
  { model: Pet, name: 'pdv_sync_pet_owner_updatedAt_id', key: { owner: 1, updatedAt: 1, _id: 1 } },
  { model: Pet, name: 'pdv_sync_pet_updatedAt_id', key: { updatedAt: 1, _id: 1 } },
  { model: UserAddress, name: 'pdv_sync_address_owner_updatedAt_id', key: { user: 1, updatedAt: 1, _id: 1 } },
  { model: UserAddress, name: 'pdv_sync_address_updatedAt_id', key: { updatedAt: 1, _id: 1 } },
  { model: Appointment, name: 'pdv_sync_appointment_store_scheduledAt', key: { store: 1, scheduledAt: 1 } },
  { model: Appointment, name: 'pdv_sync_appointment_store_updatedAt_id', key: { store: 1, updatedAt: 1, _id: 1 } },
  { model: Service, name: 'pdv_sync_service_updatedAt_id', key: { updatedAt: 1, _id: 1 } },
  { model: Store, name: 'pdv_sync_store_updatedAt_id', key: { updatedAt: 1, _id: 1 } },
  { model: Deposit, name: 'pdv_sync_deposit_company_updatedAt_id', key: { empresa: 1, updatedAt: 1, _id: 1 } },
  { model: Transfer, name: 'pdv_sync_transfer_origin_updatedAt_id', key: { originCompany: 1, updatedAt: 1, _id: 1 } },
  { model: Transfer, name: 'pdv_sync_transfer_destination_updatedAt_id', key: { destinationCompany: 1, updatedAt: 1, _id: 1 } },
  { model: PdvDesktopSyncTombstone, name: 'pdv_sync_tombstone_entity_updatedAt_id', key: { entity: 1, updatedAt: 1, _id: 1 } },
  { model: PdvDesktopSyncTombstone, name: 'pdv_sync_tombstone_company_updatedAt_id', key: { entity: 1, companies: 1, updatedAt: 1, _id: 1 } },
];

function sameKey(left, right) {
  return JSON.stringify(left || {}) === JSON.stringify(right || {});
}

async function main() {
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!mongoUri) throw new Error('MONGO_URI/MONGODB_URI não configurada.');
  await mongoose.connect(mongoUri, { compressors: ['zlib'], zlibCompressionLevel: 6 });

  const report = [];
  for (const definition of indexDefinitions) {
    const indexes = await definition.model.collection.indexes();
    const existing = indexes.find((index) => sameKey(index.key, definition.key));
    let status = existing ? 'presente' : 'ausente';
    let actualName = existing?.name || '';
    if (!existing && WRITE_MODE) {
      actualName = await definition.model.collection.createIndex(definition.key, {
        name: definition.name,
        background: true,
      });
      status = 'criado';
    }
    report.push({
      collection: definition.model.collection.collectionName,
      index: definition.name,
      key: definition.key,
      status,
      actualName,
    });
  }

  const missing = report.filter((entry) => entry.status === 'ausente').length;
  console.log(JSON.stringify({ mode: WRITE_MODE ? 'write' : 'dry-run', missing, indexes: report }, null, 2));
  if (WRITE_MODE && missing) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => {});
  });
