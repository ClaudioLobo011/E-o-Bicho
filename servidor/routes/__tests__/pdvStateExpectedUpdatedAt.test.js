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
const PdvState = require('../../models/PdvStateNormalized');

let mongo;
let currentUserId = null;

const requireAuthPath = path.join(__dirname, '../../middlewares/requireAuth.js');
const authMiddlewarePath = path.join(__dirname, '../../middlewares/authMiddleware.js');
const authorizeRolesPath = path.join(__dirname, '../../middlewares/authorizeRoles.js');

const authStub = (req, _res, next) => {
  req.user = { id: currentUserId, role: 'admin' };
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

const pdvsRouter = require('../../routes/pdvs');

function createApp() {
  const app = express();
  app.use(express.json());
  app.set('emitPdvStateUpdate', () => {});
  app.use('/pdvs', pdvsRouter);
  return app;
}

async function createBaseFixture() {
  const company = await Store.create({
    codigo: `EMP-${Date.now()}`,
    nome: 'Empresa Teste PDV',
    nomeFantasia: 'Empresa Teste PDV',
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

  const pdv = await Pdv.create({
    codigo: `PDV-${Date.now()}`,
    nome: 'Caixa Teste',
    empresa: company._id,
  });

  const state = await PdvState.create({
    pdv: pdv._id,
    empresa: company._id,
    caixaAberto: true,
    summary: {
      abertura: 100,
      recebido: 10,
      recebimentosCliente: 0,
      saldo: 110,
    },
    caixaInfo: {
      aberturaData: new Date('2026-03-04T12:00:00.000Z'),
      fechamentoData: null,
      fechamentoPrevisto: 10,
      fechamentoApurado: 0,
      previstoPagamentos: [],
      apuradoPagamentos: [],
    },
    pagamentos: [],
    history: [],
    completedSales: [],
    budgets: [],
    deliveryOrders: [],
    accountsReceivable: [],
  });

  return { company, admin, pdv, state };
}

test.describe('PDV state optimistic concurrency', () => {
  test.before(async () => {
    mongo = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    await mongoose.connect(mongo.getUri(), { dbName: 'pdv-state-expected-updated-at-test' });
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

  test('returns 409 when client tries to persist stale PDV state', async () => {
    const base = await createBaseFixture();
    const app = createApp();
    const request = supertest(app);

    const staleTimestamp = new Date(base.state.updatedAt.getTime() - 5000).toISOString();

    const response = await request
      .put(`/pdvs/${base.pdv._id}/state`)
      .set('Authorization', 'Bearer token')
      .send({
        caixaAberto: false,
        summary: {
          abertura: 100,
          recebido: 10,
          saldo: 110,
          recebimentosCliente: 0,
        },
        caixaInfo: {
          aberturaData: '2026-03-04T12:00:00.000Z',
          fechamentoData: '2026-03-04T12:10:00.000Z',
          fechamentoPrevisto: 10,
          fechamentoApurado: 10,
          previstoPagamentos: [],
          apuradoPagamentos: [],
        },
        pagamentos: [],
        history: [],
        completedSales: [],
        budgets: [],
        deliveryOrders: [],
        accountsReceivable: [],
        _meta: {
          expectedUpdatedAt: staleTimestamp,
        },
      });

    assert.equal(response.status, 409, response.text);
    assert.equal(response.body.conflict, true);
    assert.equal(response.body.state.caixa.aberto, true);

    const persistedState = await PdvState.findOne({ pdv: base.pdv._id }).lean();
    assert.ok(persistedState);
    assert.equal(persistedState.caixaAberto, true);
    assert.equal(persistedState.caixaInfo.fechamentoData, null);
  });

  test('returns 409 when a request tries to close the caixa without explicit closing metadata', async () => {
    const base = await createBaseFixture();
    const app = createApp();
    const request = supertest(app);

    const response = await request
      .put(`/pdvs/${base.pdv._id}/state`)
      .set('Authorization', 'Bearer token')
      .send({
        caixaAberto: false,
        summary: {
          abertura: 100,
          recebido: 10,
          saldo: 110,
          recebimentosCliente: 0,
        },
        caixaInfo: {
          aberturaData: '2026-03-04T12:00:00.000Z',
          fechamentoData: null,
          fechamentoPrevisto: 10,
          fechamentoApurado: 10,
          previstoPagamentos: [],
          apuradoPagamentos: [],
        },
        pagamentos: [],
        history: [],
        completedSales: [],
        budgets: [],
        deliveryOrders: [],
        accountsReceivable: [],
        _meta: {
          expectedUpdatedAt: new Date(base.state.updatedAt).toISOString(),
        },
      });

    assert.equal(response.status, 409, response.text);
    assert.equal(response.body.conflict, true);
    assert.equal(response.body.state.caixa.aberto, true);

    const persistedState = await PdvState.findOne({ pdv: base.pdv._id }).lean();
    assert.ok(persistedState);
    assert.equal(persistedState.caixaAberto, true);
    assert.equal(persistedState.caixaInfo.fechamentoData, null);
  });

  test('allows closing the caixa when the request contains explicit closing metadata', async () => {
    const base = await createBaseFixture();
    const app = createApp();
    const request = supertest(app);

    const response = await request
      .put(`/pdvs/${base.pdv._id}/state`)
      .set('Authorization', 'Bearer token')
      .send({
        caixaAberto: false,
        summary: {
          abertura: 100,
          recebido: 10,
          saldo: 110,
          recebimentosCliente: 0,
        },
        caixaInfo: {
          aberturaData: '2026-03-04T12:00:00.000Z',
          fechamentoData: '2026-03-04T12:10:00.000Z',
          fechamentoPrevisto: 10,
          fechamentoApurado: 10,
          previstoPagamentos: [],
          apuradoPagamentos: [],
        },
        pagamentos: [],
        history: [
          {
            id: 'fechamento',
            label: 'Fechamento de caixa',
            amount: 10,
            delta: -10,
            timestamp: '2026-03-04T12:10:00.000Z',
          },
        ],
        completedSales: [],
        budgets: [],
        deliveryOrders: [],
        accountsReceivable: [],
        _meta: {
          expectedUpdatedAt: new Date(base.state.updatedAt).toISOString(),
        },
      });

    assert.equal(response.status, 200, response.text);
    assert.equal(response.body.caixa.aberto, false);

    const persistedState = await PdvState.findOne({ pdv: base.pdv._id }).lean();
    assert.ok(persistedState);
    assert.equal(persistedState.caixaAberto, false);
    assert.ok(persistedState.caixaInfo.fechamentoData);
  });

  test('clears previous fechamentoData when a new caixa cycle is opened', async () => {
    const base = await createBaseFixture();
    const app = createApp();
    const request = supertest(app);

    await PdvState.updateOne(
      { pdv: base.pdv._id },
      {
        $set: {
          caixaAberto: false,
          summary: {
            abertura: 50,
            recebido: 0,
            recebimentosCliente: 0,
            saldo: 50,
          },
          caixaInfo: {
            aberturaData: new Date('2026-03-03T10:00:00.000Z'),
            fechamentoData: new Date('2026-03-03T18:00:00.000Z'),
            fechamentoPrevisto: 50,
            fechamentoApurado: 50,
            previstoPagamentos: [],
            apuradoPagamentos: [],
          },
        },
      }
    );

    const refreshed = await PdvState.findOne({ pdv: base.pdv._id });
    const response = await request
      .put(`/pdvs/${base.pdv._id}/state`)
      .set('Authorization', 'Bearer token')
      .send({
        caixaAberto: true,
        summary: {
          abertura: 91,
          recebido: 0,
          saldo: 91,
          recebimentosCliente: 0,
        },
        caixaInfo: {
          aberturaData: '2026-03-04T13:14:58.443Z',
          fechamentoData: null,
          fechamentoPrevisto: 0,
          fechamentoApurado: 0,
          previstoPagamentos: [],
          apuradoPagamentos: [],
        },
        pagamentos: [
          {
            id: 'dinheiro',
            label: 'Dinheiro',
            type: 'avista',
            aliases: [],
            valor: 91,
            parcelas: 1,
          },
        ],
        history: [
          {
            id: 'abertura',
            label: 'Abertura de Caixa',
            amount: 91,
            delta: 91,
            timestamp: '2026-03-04T13:14:58.443Z',
          },
        ],
        completedSales: [],
        budgets: [],
        deliveryOrders: [],
        accountsReceivable: [],
        _meta: {
          expectedUpdatedAt: new Date(refreshed.updatedAt).toISOString(),
        },
      });

    assert.equal(response.status, 200, response.text);
    assert.equal(response.body.caixa.aberto, true);
    assert.equal(response.body.caixaInfo.fechamentoData, null);

    const persistedState = await PdvState.findOne({ pdv: base.pdv._id }).lean();
    assert.ok(persistedState);
    assert.equal(persistedState.caixaAberto, true);
    assert.equal(persistedState.caixaInfo.fechamentoData, null);
    assert.equal(persistedState.summary.abertura, 91);
  });
});
