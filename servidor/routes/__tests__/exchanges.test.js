const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const supertest = require('supertest');
const mongoose = require('mongoose');
const path = require('node:path');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

const Store = require('../../models/Store');
const User = require('../../models/User');
const Pdv = require('../../models/Pdv');
const Deposit = require('../../models/Deposit');
const Product = require('../../models/Product');
const Exchange = require('../../models/Exchange');

let mongo;
let currentUserId = null;

const requireAuthPath = path.join(__dirname, '../../middlewares/requireAuth.js');
const authMiddlewarePath = path.join(__dirname, '../../middlewares/authMiddleware.js');
const authorizeRolesPath = path.join(__dirname, '../../middlewares/authorizeRoles.js');

const authStub = (req, _res, next) => {
  req.user = { id: currentUserId, role: 'admin', email: 'admin@example.com' };
  next();
};

require.cache[requireAuthPath] = {
  id: requireAuthPath,
  filename: requireAuthPath,
  loaded: true,
  exports: authStub,
};

require.cache[authMiddlewarePath] = {
  id: authMiddlewarePath,
  filename: authMiddlewarePath,
  loaded: true,
  exports: authStub,
};

require.cache[authorizeRolesPath] = {
  id: authorizeRolesPath,
  filename: authorizeRolesPath,
  loaded: true,
  exports: () => (_req, _res, next) => next(),
};

const exchangesRouter = require('../../routes/exchanges');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/exchanges', exchangesRouter);
  return app;
}

async function createFixture() {
  const company = await Store.create({
    codigo: `EMP-${Date.now()}`,
    nome: 'Empresa Teste Troca',
    nomeFantasia: 'Empresa Teste Troca',
    cnpj: `${Date.now()}`.slice(-14),
  });

  const admin = await User.create({
    tipoConta: 'pessoa_fisica',
    email: `admin-${Date.now()}@example.com`,
    senha: 'hash',
    celular: `1199${String(Date.now()).slice(-7)}`,
    nomeCompleto: 'Admin Teste',
    role: 'admin',
    empresas: [company._id],
    empresaPrincipal: company._id,
  });
  currentUserId = String(admin._id);

  const deposit = await Deposit.create({
    codigo: `DEP-${Date.now()}`,
    nome: 'Loja Teste',
    empresa: company._id,
  });

  const pdv = await Pdv.create({
    codigo: `PDV-${Date.now()}`,
    nome: 'Caixa Teste',
    empresa: company._id,
    configuracoesEstoque: {
      depositoPadrao: deposit._id,
    },
  });

  const returnedProduct = await Product.create({
    cod: `RET-${Date.now()}`,
    codbarras: `BRET-${Date.now()}`,
    nome: 'Produto Devolvido',
    custo: 2,
    venda: 5,
    estoques: [{ deposito: deposit._id, quantidade: 5, unidade: 'UN' }],
  });

  const takenProduct = await Product.create({
    cod: `TAK-${Date.now()}`,
    codbarras: `BTAK-${Date.now()}`,
    nome: 'Produto Levado',
    custo: 4,
    venda: 12,
    estoques: [{ deposito: deposit._id, quantidade: 7, unidade: 'UN' }],
  });

  const exchange = await Exchange.create({
    number: 1,
    code: '1',
    date: new Date('2026-06-30T12:00:00.000Z'),
    type: 'troca',
    company: company._id,
    pdv: pdv._id,
    returnedItems: [{
      code: returnedProduct.cod,
      description: returnedProduct.nome,
      productId: returnedProduct._id,
      quantity: 1,
      unitValue: 5,
      totalValue: 5,
      depositLabel: deposit.nome,
    }],
    takenItems: [{
      code: takenProduct.cod,
      description: takenProduct.nome,
      productId: takenProduct._id,
      quantity: 1,
      unitValue: 12,
      totalValue: 12,
      discountValue: 5,
      depositLabel: deposit.nome,
    }],
    totals: { returned: 5, taken: 12 },
    differenceValue: -7,
  });

  return {
    company,
    deposit,
    pdv,
    returnedProduct,
    takenProduct,
    exchange,
  };
}

test.describe('Exchange finalize endpoint', () => {
  test.before(async () => {
    mongo = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    await mongoose.connect(mongo.getUri(), { dbName: 'exchange-finalize-test' });
  });

  test.after(async () => {
    await mongoose.disconnect();
    if (mongo) await mongo.stop();
  });

  test.beforeEach(async () => {
    await mongoose.connection.db.dropDatabase();
  });

  test('finaliza troca vinculada a venda sem baixar o item levado novamente', async () => {
    const base = await createFixture();
    const app = createApp();
    const request = supertest(app);

    const response = await request
      .post(`/exchanges/${base.exchange._id}/finalize`)
      .set('Authorization', 'Bearer token')
      .send({
        pdvId: String(base.pdv._id),
        companyId: String(base.company._id),
        inventoryMode: 'return_only',
        sourceSales: [{ saleId: 'sale-local-001', saleCode: 'OFF-LOCAL-001' }],
      });

    assert.equal(response.status, 200, response.text);
    const returnedProduct = await Product.findById(base.returnedProduct._id).lean();
    const takenProduct = await Product.findById(base.takenProduct._id).lean();
    const exchange = await Exchange.findById(base.exchange._id).lean();

    assert.equal(Number(returnedProduct.estoques[0].quantidade), 6);
    assert.equal(Number(takenProduct.estoques[0].quantidade), 7);
    assert.equal(exchange.inventoryProcessed, true);
    assert.equal(exchange.sourceSales.length, 1);
    assert.equal(exchange.sourceSales[0].saleId, 'sale-local-001');
  });

  test('mantem o comportamento antigo quando a troca finaliza em modo completo', async () => {
    const base = await createFixture();
    const app = createApp();
    const request = supertest(app);

    const response = await request
      .post(`/exchanges/${base.exchange._id}/finalize`)
      .set('Authorization', 'Bearer token')
      .send({
        pdvId: String(base.pdv._id),
        companyId: String(base.company._id),
      });

    assert.equal(response.status, 200, response.text);
    const returnedProduct = await Product.findById(base.returnedProduct._id).lean();
    const takenProduct = await Product.findById(base.takenProduct._id).lean();

    assert.equal(Number(returnedProduct.estoques[0].quantidade), 6);
    assert.equal(Number(takenProduct.estoques[0].quantidade), 6);
  });
});
