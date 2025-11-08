const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const supertest = require('supertest');
const mongoose = require('mongoose');
const path = require('node:path');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

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

async function setupBaseDocuments() {
  const company = await Store.create({
    nome: 'Empresa Teste',
    nomeFantasia: 'Empresa Teste',
    cnpj: '12345678000199',
  });

  const deposit = await Deposit.create({
    codigo: 'D1',
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

  const child = await Product.create({
    cod: 'CHD1',
    codbarras: '0000000000010',
    nome: 'Produto Filho',
    custo: 10,
    venda: 15,
    unidade: 'UN',
    estoques: [
      { deposito: deposit._id, quantidade: 0, unidade: 'UN' },
    ],
  });

  const parent = await Product.create({
    cod: 'PAR1',
    codbarras: '0000000000001',
    nome: 'Produto Pai',
    custo: 30,
    venda: 45,
    unidade: 'CX',
    fracionado: {
      ativo: true,
      itens: [
        {
          produto: child._id,
          quantidadeOrigem: 1,
          quantidadeFracionada: 3,
        },
      ],
    },
    estoques: [
      { deposito: deposit._id, quantidade: 0, unidade: 'CX' },
    ],
  });

  return { company, deposit, user, parent, child };
}

test.describe('POST /inventory-adjustments - fracionados', () => {
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

  test('entrada com pai e filho credita quantidade total no filho', async () => {
    const { company, deposit, user, parent, child } = await setupBaseDocuments();
    currentUserId = user._id.toString();

    const app = express();
    app.use(express.json());
    app.use('/inventory-adjustments', router);

    const request = supertest(app);

    const response = await request
      .post('/inventory-adjustments')
      .set('Authorization', 'Bearer token')
      .send({
        operation: 'entrada',
        reason: 'ajuste_inventario',
        company: company._id.toString(),
        deposit: deposit._id.toString(),
        movementDate: '2024-11-20',
        referenceDocument: '',
        notes: '',
        responsible: user._id.toString(),
        items: [
          { productId: parent._id.toString(), quantity: 1, unitValue: null },
          { productId: child._id.toString(), quantity: 1, unitValue: null },
        ],
      });

    assert.equal(response.status, 201, response.text);

    const updatedChild = await Product.findById(child._id).lean();
    const childEntry = updatedChild.estoques.find(
      (entry) => entry.deposito.toString() === deposit._id.toString(),
    );
    assert.equal(childEntry.quantidade, 4);
  });
});
