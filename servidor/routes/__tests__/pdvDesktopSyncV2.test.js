const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const supertest = require('supertest');
const mongoose = require('mongoose');
const path = require('node:path');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

const requireAuthPath = path.join(__dirname, '../../middlewares/requireAuth.js');
const authorizeRolesPath = path.join(__dirname, '../../middlewares/authorizeRoles.js');
require.cache[requireAuthPath] = { id: requireAuthPath, filename: requireAuthPath, loaded: true, exports: (req, _res, next) => { req.user = { id: 'test-admin', role: 'admin' }; next(); } };
require.cache[authorizeRolesPath] = { id: authorizeRolesPath, filename: authorizeRolesPath, loaded: true, exports: () => (_req, _res, next) => next() };

const Store = require('../../models/Store');
const Pdv = require('../../models/Pdv');
const PdvState = require('../../models/PdvState');
const PdvStateSale = require('../../models/PdvStateSale');
const PdvStateDeliveryOrder = require('../../models/PdvStateDeliveryOrder');
const PdvStateHistoryEvent = require('../../models/PdvStateHistoryEvent');
const PdvStateInventoryMovement = require('../../models/PdvStateInventoryMovement');
const PaymentMethod = require('../../models/PaymentMethod');
const User = require('../../models/User');
const Pet = require('../../models/Pet');
const UserAddress = require('../../models/UserAddress');
const Deposit = require('../../models/Deposit');
const Appointment = require('../../models/Appointment');
const PdvDesktopHost = require('../../models/PdvDesktopHost');
require('../../models/UserGroup');
const router = require('../../routes/pdvDesktop');
const pdvDomain = require('../../routes/pdvs');
const { recordDesktopSyncDeletion } = require('../../services/desktopSyncTombstones');

let mongo;
function app() {
  const instance = express();
  instance.use(express.json());
  instance.use('/desktop', router);
  return instance;
}

async function pairedFixture(machineId = 'sync-v2-host') {
  const suffix = String(Date.now()).slice(-10);
  const company = await Store.create({ codigo: `SYNC-${suffix}`, nome: 'Empresa Sync V2', nomeFantasia: 'Empresa Sync V2', cnpj: `1${suffix}`.padEnd(14, '0').slice(0, 14) });
  const pdv = await Pdv.create({ codigo: `PDV-${suffix}`, nome: 'PDV Sync V2', empresa: company._id, tipoUso: 'web' });
  await PaymentMethod.create({ company: company._id, code: `PIX-${suffix}`, name: 'Pix', type: 'avista' });
  const state = await PdvState.create({
    pdv: pdv._id, empresa: company._id, caixaAberto: false, saleCodeSequence: 31, budgetSequence: 7,
    completedSales: [{ id: 'legacy-sale', saleCode: 'LEGACY-1', total: 10 }],
    deliveryOrders: [{ id: 'legacy-delivery', saleCode: 'LEGACY-D1', total: 10 }],
    history: [{ id: 'legacy-history', label: 'Histórico grande', valor: 10 }],
  });
  const request = supertest(app());
  const pairing = await request.post(`/desktop/pdvs/${pdv._id}/pairing-code`).set('Authorization', 'Bearer test').send();
  assert.equal(pairing.status, 200, pairing.text);
  const paired = await request.post('/desktop/pair').send({ pairingCode: pairing.body.pairingCode, machineId, name: machineId });
  assert.equal(paired.status, 200, paired.text);
  return { company, pdv, state, request, token: paired.body.token, headers: { 'X-Desktop-Token': paired.body.token } };
}

test.describe('sincronização incremental do PDV Desktop v2', () => {
  test.before(async () => {
    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
    await mongoose.connect(mongo.getUri(), { dbName: 'pdv-desktop-sync-v2-test' });
  });
  test.after(async () => { await mongoose.disconnect(); if (mongo) await mongo.stop(); });
  test.beforeEach(async () => { await mongoose.connection.db.dropDatabase(); });

  test('mantém o bootstrap antigo e entrega bootstrap v2 enxuto com histórico paginado por cursor', async () => {
    const base = await pairedFixture();
    const heartbeat = await base.request.post('/desktop/heartbeat').set(base.headers).send({
      localDbReady: true, initialSyncCompleted: true, syncProtocolVersion: 2, appVersion: '0.8.55',
    });
    assert.equal(heartbeat.status, 200, heartbeat.text);
    const host = await PdvDesktopHost.findOne({ machineId: 'sync-v2-host' }).lean();
    assert.equal(host.syncProtocolVersion, 2);
    assert.equal(host.appVersion, '0.8.55');

    const legacy = await base.request.get('/desktop/bootstrap').set(base.headers);
    assert.equal(legacy.status, 200, legacy.text);
    assert.equal(legacy.body.state.completedSales.length, 1);
    assert.equal(legacy.body.state.deliveryOrders.length, 1);

    const lean = await base.request.get('/desktop/sync/v2/bootstrap').set(base.headers);
    assert.equal(lean.status, 200, lean.text);
    assert.equal(lean.body.protocol.version, 2);
    assert.equal(lean.body.protocol.legacyCompatible, true);
    assert.equal(Object.hasOwn(lean.body.state, 'completedSales'), false);
    assert.equal(Object.hasOwn(lean.body.state, 'deliveryOrders'), false);
    assert.equal(Object.hasOwn(lean.body.state, 'history'), false);
    assert.equal(lean.body.state.saleCodeSequence, 31);
    assert.equal(lean.body.state.budgetSequence, 7);
    assert.equal(Object.hasOwn(lean.body.versions, 'sales'), true);
    assert.equal(JSON.stringify(lean.body).includes('certificadoSenha'), false);
    assert.equal(JSON.stringify(lean.body).includes('certificadoArquivo'), false);

    const sales = Array.from({ length: 30 }, (_, index) => ({
      pdv: base.pdv._id, empresa: base.company._id, sourceState: base.state._id,
      saleId: `sale-${String(index + 1).padStart(2, '0')}`,
      saleCode: `PDV-${String(index + 1).padStart(6, '0')}`,
      payload: { id: `sale-${String(index + 1).padStart(2, '0')}`, saleCode: `PDV-${String(index + 1).padStart(6, '0')}`, total: index + 1 },
    }));
    await PdvStateSale.insertMany(sales);

    const first = await base.request.get('/desktop/sync/v2/sales?limit=25').set(base.headers);
    assert.equal(first.status, 200, first.text);
    assert.equal(first.body.sales.length, 25);
    assert.equal(first.body.hasMore, true);
    assert.ok(first.body.nextCursor);
    assert.equal(first.headers['x-pdv-sync-documents'], '25');
    assert.ok(Number(first.headers['x-pdv-sync-bytes']) > 0);
    assert.ok(Number(first.headers['x-pdv-sync-duration-ms']) >= 0);
    assert.equal(first.headers['x-pdv-sync-type'], 'initial');
    assert.equal(first.headers['x-pdv-sync-cursor-used'], 'false');

    const second = await base.request.get(`/desktop/sync/v2/sales?limit=25&cursor=${encodeURIComponent(first.body.nextCursor)}`).set(base.headers);
    assert.equal(second.status, 200, second.text);
    assert.equal(second.body.sales.length, 5);
    assert.equal(second.body.hasMore, false);
    assert.equal(second.headers['x-pdv-sync-type'], 'incremental');
    assert.equal(second.headers['x-pdv-sync-cursor-used'], 'true');
    assert.equal(new Set([...first.body.sales, ...second.body.sales].map((sale) => sale.id)).size, 30);
    const invalid = await base.request.get('/desktop/sync/v2/sales?cursor=invalido').set(base.headers);
    assert.equal(invalid.status, 400, invalid.text);
  });

  test('sincroniza clientes globais, pets, endereços e exclusões sem snapshot completo', async () => {
    const base = await pairedFixture('sync-directory-host');
    const suffix = String(Date.now()).slice(-8);
    const otherCompany = await Store.create({ codigo: `OTHER-${suffix}`, nome: 'Outra Empresa', nomeFantasia: 'Outra Empresa', cnpj: `9${suffix}`.padEnd(14, '0').slice(0, 14) });
    const otherDeposit = await Deposit.create({ codigo: `OTHER-DEP-${suffix}`, nome: 'Depósito Outra Empresa', empresa: otherCompany._id });
    const customer = await User.create({ tipoConta: 'pessoa_fisica', email: `global-${suffix}@example.com`, senha: 'hash', celular: `219${suffix}`, nomeCompleto: 'Cliente Global', role: 'cliente', empresaPrincipal: otherCompany._id });
    const pet = await Pet.create({ owner: customer._id, nome: 'Pet Global', tipo: 'cachorro', raca: 'SRD', sexo: 'macho' });
    const address = await UserAddress.create({ user: customer._id, cep: '20000000', logradouro: 'Rua Global', numero: '10', cidade: 'Rio de Janeiro', uf: 'RJ', isDefault: true });
    await User.create({ tipoConta: 'pessoa_fisica', email: `employee-${suffix}@example.com`, senha: 'hash', celular: `218${suffix}`, nomeCompleto: 'Vendedor Local', role: 'funcionario', grupos: ['vendedor'], empresas: [base.company._id] });

    const customers = await base.request.get('/desktop/sync/v2/directory/customers').set(base.headers);
    assert.equal(customers.status, 200, customers.text);
    assert.ok(customers.body.upserts.some((entry) => entry.id === String(customer._id)));
    const pets = await base.request.get('/desktop/sync/v2/directory/pets').set(base.headers);
    assert.ok(pets.body.upserts.some((entry) => entry.id === String(pet._id) && entry.ownerId === String(customer._id)));
    const addresses = await base.request.get('/desktop/sync/v2/directory/addresses').set(base.headers);
    assert.ok(addresses.body.upserts.some((entry) => entry.id === String(address._id) && entry.street === 'Rua Global'));
    const employees = await base.request.get('/desktop/sync/v2/directory/employees').set(base.headers);
    assert.equal(employees.body.upserts.filter((entry) => entry.seller).length, 1);
    const stores = await base.request.get('/desktop/sync/v2/directory/stores').set(base.headers);
    assert.ok(stores.body.upserts.some((entry) => entry.id === String(otherCompany._id)));
    const deposits = await base.request.get('/desktop/sync/v2/directory/deposits').set(base.headers);
    assert.ok(deposits.body.upserts.some((entry) => entry.id === String(otherDeposit._id) && entry.companyId === String(otherCompany._id)));

    await recordDesktopSyncDeletion({ entity: 'address', entityId: address._id, ownerId: customer._id });
    await UserAddress.deleteOne({ _id: address._id });
    const deletion = await base.request.get(`/desktop/sync/v2/directory/addresses?cursor=${encodeURIComponent(addresses.body.nextCursor)}`).set(base.headers);
    assert.equal(deletion.status, 200, deletion.text);
    assert.deepEqual(deletion.body.deletedIds, [String(address._id)]);
    assert.equal(deletion.body.upserts.length, 0);
  });

  test('agenda removida e delivery normalizado chegam incrementalmente', async () => {
    const base = await pairedFixture('sync-operational-host');
    const suffix = String(Date.now()).slice(-8);
    const customer = await User.create({ tipoConta: 'pessoa_fisica', email: `appointment-${suffix}@example.com`, senha: 'hash', celular: `217${suffix}`, nomeCompleto: 'Cliente Agenda V2', role: 'cliente', empresaPrincipal: base.company._id });
    const pet = await Pet.create({ owner: customer._id, nome: 'Pet Agenda V2', tipo: 'cachorro', raca: 'SRD', sexo: 'femea' });
    const appointment = await Appointment.create({ store: base.company._id, cliente: customer._id, pet: pet._id, scheduledAt: new Date(Date.now() + 3600000), valor: 40, status: 'agendado' });

    const start = new Date(Date.now() - 86400000).toISOString();
    const end = new Date(Date.now() + 86400000).toISOString();
    const firstAgenda = await base.request.get(`/desktop/sync/v2/appointments?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`).set(base.headers);
    assert.equal(firstAgenda.status, 200, firstAgenda.text);
    assert.equal(firstAgenda.body.appointments.length, 1);
    assert.equal(firstAgenda.body.appointments[0].sourceAppointmentId, String(appointment._id));

    await Appointment.updateOne({ _id: appointment._id }, { $set: { deletedAt: new Date(), updatedAt: new Date(Date.now() + 1000) } });
    const deletedAgenda = await base.request.get(`/desktop/sync/v2/appointments?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&cursor=${encodeURIComponent(firstAgenda.body.nextCursor)}`).set(base.headers);
    assert.equal(deletedAgenda.status, 200, deletedAgenda.text);
    assert.deepEqual(deletedAgenda.body.deletedSourceIds, [String(appointment._id)]);

    await PdvStateDeliveryOrder.create({
      pdv: base.pdv._id, empresa: base.company._id, sourceState: base.state._id,
      deliveryId: 'delivery-v2-1', saleId: 'sale-delivery-v2-1',
      payload: { id: 'delivery-v2-1', saleId: 'sale-delivery-v2-1', saleCode: 'PDV-000100', status: 'emRota', total: 40 },
    });
    const deliveries = await base.request.get('/desktop/sync/v2/deliveries').set(base.headers);
    assert.equal(deliveries.status, 200, deliveries.text);
    assert.deepEqual(deliveries.body.deliveries.map((entry) => entry.id), ['delivery-v2-1']);
    assert.equal(deliveries.body.deliveries[0].status, 'emRota');
  });

  test('espelho normalizado não regrava vendas antigas quando o conteúdo não mudou', async () => {
    const base = await pairedFixture('sync-hash-host');
    const state = {
      _id: base.state._id,
      pdv: base.pdv._id,
      empresa: base.company._id,
      updatedAt: new Date(),
      completedSales: [{ id: 'stable-sale', saleCode: 'PDV-000200', total: 25 }],
      accountsReceivable: [], deliveryOrders: [], history: [], inventoryMovements: [],
    };
    await pdvDomain.syncPdvStateNormalizedMirror({ pdvDoc: base.pdv, updatedState: state });
    const first = await PdvStateSale.findOne({ pdv: base.pdv._id, saleId: 'stable-sale' }).lean();
    assert.ok(first?.payloadHash);

    await new Promise((resolve) => setTimeout(resolve, 20));
    await pdvDomain.syncPdvStateNormalizedMirror({ pdvDoc: base.pdv, updatedState: { ...state, updatedAt: new Date() } });
    const unchanged = await PdvStateSale.findOne({ pdv: base.pdv._id, saleId: 'stable-sale' }).lean();
    assert.equal(unchanged.updatedAt.toISOString(), first.updatedAt.toISOString());

    await new Promise((resolve) => setTimeout(resolve, 20));
    await pdvDomain.syncPdvStateNormalizedMirror({
      pdvDoc: base.pdv,
      updatedState: { ...state, updatedAt: new Date(), completedSales: [{ ...state.completedSales[0], total: 30 }] },
    });
    const changed = await PdvStateSale.findOne({ pdv: base.pdv._id, saleId: 'stable-sale' }).lean();
    assert.equal(changed.payload.total, 30);
    assert.notEqual(changed.payloadHash, first.payloadHash);
    assert.ok(changed.updatedAt > unchanged.updatedAt);
  });

  test('espelho normalizado resolve identidades legadas repetidas usando a última versão', async () => {
    const base = await pairedFixture('sync-deduplicate-host');
    await pdvDomain.syncPdvStateNormalizedMirror({
      pdvDoc: base.pdv,
      updatedState: {
        _id: base.state._id,
        pdv: base.pdv._id,
        empresa: base.company._id,
        updatedAt: new Date(),
        completedSales: [], accountsReceivable: [], deliveryOrders: [],
        history: [
          { id: 'event-duplicate', label: 'Versão anterior', amount: 10 },
          { id: 'event-duplicate', label: 'Versão atual', amount: 20 },
        ],
        inventoryMovements: [
          { saleId: 'sale-duplicate', deposit: String(base.company._id), quantity: 1 },
          { saleId: 'sale-duplicate', deposit: String(base.company._id), quantity: 2 },
        ],
      },
    });
    const histories = await PdvStateHistoryEvent.find({ pdv: base.pdv._id, eventId: 'event-duplicate' }).lean();
    const movements = await PdvStateInventoryMovement.find({ pdv: base.pdv._id, movementId: `sale-duplicate:${base.company._id}` }).lean();
    assert.equal(histories.length, 1);
    assert.equal(histories[0].payload.amount, 20);
    assert.equal(movements.length, 1);
    assert.equal(movements[0].payload.quantity, 2);
  });
});
