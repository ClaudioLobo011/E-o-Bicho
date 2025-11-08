const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const supertest = require('supertest');
const mongoose = require('mongoose');
const path = require('node:path');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

const InventoryAdjustment = require('../../models/InventoryAdjustment');
const Product = require('../../models/Product');
const Store = require('../../models/Store');
const Deposit = require('../../models/Deposit');
const User = require('../../models/User');

let mongo;
let currentUserId = null;

const requireAuthPath = path.join(__dirname, '../../middlewares/requireAuth.js');
const authorizeRolesPath = path.join(__dirname, '../../middlewares/authorizeRoles.js');

require.cache[requireAuthPath] = {
  id: requireAuthPath,
  filename: requireAuthPath,
  loaded: true,
  exports: (req, res, next) => {
    req.user = { id: currentUserId, role: 'admin' };
    next();
  },
};

require.cache[authorizeRolesPath] = {
  id: authorizeRolesPath,
  filename: authorizeRolesPath,
  loaded: true,
  exports: () => (req, res, next) => next(),
};

const router = require('../../routes/inventoryAdjustments');

async function createBaseData() {
  const company = await Store.create({
    nome: 'Empresa Teste',
    nomeFantasia: 'Empresa Teste',
    cnpj: '12345678000199',
  });

  const deposit = await Deposit.create({
    codigo: 'DEP1',
    nome: 'Depósito Principal',
    empresa: company._id,
  });

  const user = await User.create({
    tipoConta: 'pessoa_fisica',
    email: 'admin@example.com',
    senha: 'hash',
    celular: '11999999999',
    nomeCompleto: 'Admin Teste',
    role: 'admin',
  });

  const product = await Product.create({
    cod: 'SKU1',
    codbarras: '0000000000001',
    nome: 'Produto Teste',
    custo: 10,
    venda: 15,
    unidade: 'UN',
    estoques: [
      { deposito: deposit._id, quantidade: 0, unidade: 'UN' },
    ],
  });

  return { company, deposit, user, product };
}

async function seedAdjustments({ company, deposit, user, product }) {
  const entradaDate = new Date('2024-05-10T12:00:00Z');
  const saidaDate = new Date('2024-05-12T15:00:00Z');

  await InventoryAdjustment.create([
    {
      operation: 'entrada',
      reason: 'inventario',
      company: company._id,
      deposit: deposit._id,
      movementDate: entradaDate,
      referenceDocument: 'DOC-1',
      notes: 'Entrada manual',
      responsible: user._id,
      createdBy: user._id,
      items: [
        {
          product: product._id,
          sku: product.cod,
          barcode: product.codbarras,
          name: product.nome,
          quantity: 4,
          unitValue: 10,
          notes: '',
        },
      ],
      totalQuantity: 4,
      totalValue: 40,
    },
    {
      operation: 'saida',
      reason: 'ajuste',
      company: company._id,
      deposit: deposit._id,
      movementDate: saidaDate,
      referenceDocument: 'DOC-2',
      notes: 'Saída manual',
      responsible: user._id,
      createdBy: user._id,
      items: [
        {
          product: product._id,
          sku: product.cod,
          barcode: product.codbarras,
          name: product.nome,
          quantity: 2,
          unitValue: 15,
          notes: '',
        },
      ],
      totalQuantity: -2,
      totalValue: -30,
    },
  ]);
}

test.describe('GET /inventory-adjustments', () => {
  test.before(async () => {
    mongo = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    await mongoose.connect(mongo.getUri(), { dbName: 'test-db' });
  });

  test.after(async () => {
    await mongoose.disconnect();
    if (mongo) {
      await mongo.stop();
    }
  });

  test.beforeEach(async () => {
    await mongoose.connection.db.dropDatabase();
  });

  test('lista movimentações e agrega totais', async () => {
    const base = await createBaseData();
    await seedAdjustments(base);
    currentUserId = base.user._id.toString();

    const app = express();
    app.use(express.json());
    app.use('/inventory-adjustments', router);

    const request = supertest(app);
    const response = await request
      .get('/inventory-adjustments')
      .set('Authorization', 'Bearer token');

    assert.equal(response.status, 200, response.text);

    const body = response.body;
    assert.ok(Array.isArray(body.adjustments));
    assert.equal(body.adjustments.length, 2);

    const [first, second] = body.adjustments;
    assert.equal(first.operation, 'saida');
    assert.equal(second.operation, 'entrada');

    assert.equal(body.summary.totalAdjustments, 2);
    assert.equal(body.summary.totalEntradas, 1);
    assert.equal(body.summary.totalSaidas, 1);
    assert.equal(body.summary.quantityEntradas, 4);
    assert.equal(body.summary.quantitySaidas, 2);
    assert.equal(body.summary.valueEntradas, 40);
    assert.equal(body.summary.valueSaidas, 30);
    assert.equal(body.summary.netQuantity, 2);
    assert.equal(body.summary.netValue, 10);

    assert.equal(body.pagination.total, 2);
    assert.equal(body.pagination.limit, 50); // valor padrão
  });

  test('filtra por operação e período', async () => {
    const base = await createBaseData();
    await seedAdjustments(base);
    currentUserId = base.user._id.toString();

    const app = express();
    app.use(express.json());
    app.use('/inventory-adjustments', router);

    const request = supertest(app);
    const response = await request
      .get('/inventory-adjustments')
      .query({
        operation: 'entrada',
        startDate: '2024-05-01',
        endDate: '2024-05-11',
      })
      .set('Authorization', 'Bearer token');

    assert.equal(response.status, 200, response.text);

    const body = response.body;
    assert.ok(Array.isArray(body.adjustments));
    assert.equal(body.adjustments.length, 1);
    assert.equal(body.adjustments[0].operation, 'entrada');
    assert.equal(body.summary.totalAdjustments, 1);
    assert.equal(body.summary.totalEntradas, 1);
    assert.equal(body.summary.totalSaidas, 0);
    assert.equal(body.summary.quantityEntradas, 4);
    assert.equal(body.summary.quantitySaidas, 0);
    assert.equal(body.summary.netQuantity, 4);
  });

  test('retorna erro quando período é inválido', async () => {
    const base = await createBaseData();
    currentUserId = base.user._id.toString();

    const app = express();
    app.use(express.json());
    app.use('/inventory-adjustments', router);

    const request = supertest(app);
    const response = await request
      .get('/inventory-adjustments')
      .query({ startDate: '2024-05-10', endDate: '2024-05-01' })
      .set('Authorization', 'Bearer token');

    assert.equal(response.status, 400, response.text);
    const payload = response.body || {};
    assert.match(payload.message, /período informado/i);
  });

  test('retorna erro para data inicial inválida', async () => {
    const base = await createBaseData();
    currentUserId = base.user._id.toString();

    const app = express();
    app.use(express.json());
    app.use('/inventory-adjustments', router);

    const request = supertest(app);
    const response = await request
      .get('/inventory-adjustments')
      .query({ startDate: '2024-13-01' })
      .set('Authorization', 'Bearer token');

    assert.equal(response.status, 400, response.text);
    const payload = response.body || {};
    assert.match(payload.message, /data inicial/i);
  });
});
