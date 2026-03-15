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
const PdvState = require('../../models/PdvState');
const Deposit = require('../../models/Deposit');
const Product = require('../../models/Product');

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

async function createFixture({ caixaAberto = true } = {}) {
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
    caixaAberto: Boolean(caixaAberto),
    summary: {
      abertura: caixaAberto ? 100 : 0,
      recebido: 0,
      recebimentosCliente: 0,
      saldo: caixaAberto ? 100 : 0,
    },
    caixaInfo: {
      aberturaData: caixaAberto ? new Date('2026-03-04T12:00:00.000Z') : null,
      fechamentoData: caixaAberto ? null : new Date('2026-03-04T12:00:00.000Z'),
      fechamentoPrevisto: 0,
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

  return { pdv, state };
}

test.describe('PDV commands endpoint', () => {
  test.before(async () => {
    mongo = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    await mongoose.connect(mongo.getUri(), { dbName: 'pdv-commands-refresh-test' });
  });

  test.after(async () => {
    await mongoose.disconnect();
    if (mongo) await mongo.stop();
  });

  test.beforeEach(async () => {
    await mongoose.connection.db.dropDatabase();
  });

  test('returns current state for pdv.refresh_state', async () => {
    const base = await createFixture();
    const app = createApp();
    const request = supertest(app);

    const response = await request
      .post(`/pdvs/${base.pdv._id}/commands`)
      .set('Authorization', 'Bearer token')
      .set('X-Idempotency-Key', 'test-command-refresh-1')
      .send({ action: 'pdv.refresh_state' });

    assert.equal(response.status, 200, response.text);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.action, 'pdv.refresh_state');
    assert.equal(response.body.state.caixa.aberto, true);
    assert.equal(response.body.state.summary.abertura, 100);
    assert.equal(response.body.meta.idempotencyKey, 'test-command-refresh-1');
  });

  test('updates print preferences through pdv.settings.print_preferences', async () => {
    const base = await createFixture();
    const app = createApp();
    const request = supertest(app);

    const response = await request
      .post(`/pdvs/${base.pdv._id}/commands`)
      .set('Authorization', 'Bearer token')
      .set('X-Idempotency-Key', 'test-print-preferences-1')
      .send({
        action: 'pdv.settings.print_preferences',
        payload: {
          printPreferences: {
            venda: 'FM',
            fechamento: 'M',
          },
        },
      });

    assert.equal(response.status, 200, response.text);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.state.printPreferences.venda, 'FM');
    assert.equal(response.body.state.printPreferences.fechamento, 'M');
  });

  test('rejects unsupported actions', async () => {
    const base = await createFixture();
    const app = createApp();
    const request = supertest(app);

    const response = await request
      .post(`/pdvs/${base.pdv._id}/commands`)
      .set('Authorization', 'Bearer token')
      .send({ action: 'pdv.unsupported' });

    assert.equal(response.status, 400, response.text);
    assert.match(
      response.body.message,
      /Comando de PDV não suportado\./
    );
  });

  test('opens caixa through pdv.caixa.open and persists state', async () => {
    const base = await createFixture({ caixaAberto: false });
    const app = createApp();
    const request = supertest(app);

    const response = await request
      .post(`/pdvs/${base.pdv._id}/commands`)
      .set('Authorization', 'Bearer token')
      .set('X-Idempotency-Key', 'test-open-caixa-1')
      .send({
        action: 'pdv.caixa.open',
        payload: {
          reason: 'Abertura inicial',
          payments: [
            { id: 'dinheiro', label: 'Dinheiro', type: 'avista', valor: 50 },
            { id: 'pix', label: 'Pix', type: 'avista', valor: 20 },
          ],
        },
      });

    assert.equal(response.status, 200, response.text);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.action, 'pdv.caixa.open');
    assert.equal(response.body.state.caixa.aberto, true);
    assert.equal(response.body.state.summary.abertura, 70);
    assert.equal(response.body.state.history[0].id, 'abertura');

    const persisted = await PdvState.findOne({ pdv: base.pdv._id }).lean();
    assert.ok(persisted);
    assert.equal(persisted.caixaAberto, true);
    assert.equal(persisted.summary.abertura, 70);
    assert.equal(Array.isArray(persisted.history), true);
    assert.equal(persisted.history[0].id, 'abertura');
  });

  test('respects idempotency for pdv.caixa.open', async () => {
    const base = await createFixture({ caixaAberto: false });
    const app = createApp();
    const request = supertest(app);
    const idempotencyKey = 'test-open-caixa-idempotent-1';

    const body = {
      action: 'pdv.caixa.open',
      payload: {
        reason: 'Abertura idempotente',
        payments: [{ id: 'dinheiro', label: 'Dinheiro', type: 'avista', valor: 30 }],
      },
    };

    const first = await request
      .post(`/pdvs/${base.pdv._id}/commands`)
      .set('Authorization', 'Bearer token')
      .set('X-Idempotency-Key', idempotencyKey)
      .send(body);
    assert.equal(first.status, 200, first.text);

    const second = await request
      .post(`/pdvs/${base.pdv._id}/commands`)
      .set('Authorization', 'Bearer token')
      .set('X-Idempotency-Key', idempotencyKey)
      .send(body);
    assert.equal(second.status, 200, second.text);
    assert.equal(second.body.state.summary.abertura, 30);

    const persisted = await PdvState.findOne({ pdv: base.pdv._id }).lean();
    assert.ok(persisted);
    assert.equal(persisted.summary.abertura, 30);
    assert.equal(persisted.history.length, 1);
  });

  test('applies entry, exit, shipment and close commands to caixa state', async () => {
    const base = await createFixture({ caixaAberto: false });
    const app = createApp();
    const request = supertest(app);

    const open = await request
      .post(`/pdvs/${base.pdv._id}/commands`)
      .set('Authorization', 'Bearer token')
      .set('X-Idempotency-Key', 'test-cx-open-seq-1')
      .send({
        action: 'pdv.caixa.open',
        payload: {
          payments: [{ id: 'dinheiro', label: 'Dinheiro', type: 'avista', valor: 100 }],
        },
      });
    assert.equal(open.status, 200, open.text);
    assert.equal(open.body.state.caixa.aberto, true);

    const entry = await request
      .post(`/pdvs/${base.pdv._id}/commands`)
      .set('Authorization', 'Bearer token')
      .set('X-Idempotency-Key', 'test-cx-entry-seq-1')
      .send({
        action: 'pdv.caixa.entry',
        payload: { paymentId: 'dinheiro', amount: 20, reason: 'Reforço' },
      });
    assert.equal(entry.status, 200, entry.text);
    assert.equal(entry.body.state.history[0].id, 'entrada');
    assert.equal(entry.body.state.pagamentos[0].valor, 120);

    const exit = await request
      .post(`/pdvs/${base.pdv._id}/commands`)
      .set('Authorization', 'Bearer token')
      .set('X-Idempotency-Key', 'test-cx-exit-seq-1')
      .send({
        action: 'pdv.caixa.exit',
        payload: { paymentId: 'dinheiro', amount: 10, reason: 'Pagamento interno' },
      });
    assert.equal(exit.status, 200, exit.text);
    assert.equal(exit.body.state.history[0].id, 'saida');
    assert.equal(exit.body.state.pagamentos[0].valor, 110);

    const shipment = await request
      .post(`/pdvs/${base.pdv._id}/commands`)
      .set('Authorization', 'Bearer token')
      .set('X-Idempotency-Key', 'test-cx-shipment-seq-1')
      .send({
        action: 'pdv.caixa.shipment',
        payload: { paymentId: 'dinheiro', amount: 5, reason: 'Envio ao cofre' },
      });
    assert.equal(shipment.status, 200, shipment.text);
    assert.equal(shipment.body.state.history[0].id, 'envio');
    assert.equal(shipment.body.state.pagamentos[0].valor, 105);

    const close = await request
      .post(`/pdvs/${base.pdv._id}/commands`)
      .set('Authorization', 'Bearer token')
      .set('X-Idempotency-Key', 'test-cx-close-seq-1')
      .send({
        action: 'pdv.caixa.close',
        payload: {
          reason: 'Fechamento',
          payments: [{ id: 'dinheiro', label: 'Dinheiro', type: 'avista', valor: 105 }],
        },
      });
    assert.equal(close.status, 200, close.text);
    assert.equal(close.body.state.caixa.aberto, false);
    assert.equal(close.body.state.caixaInfo.fechamentoApurado, 105);
    assert.equal(close.body.state.history[0].id, 'fechamento');

    const persisted = await PdvState.findOne({ pdv: base.pdv._id }).lean();
    assert.ok(persisted);
    assert.equal(persisted.caixaAberto, false);
    assert.equal(persisted.caixaInfo.fechamentoApurado, 105);
  });

  test('keeps only cash value for next opening after caixa close', async () => {
    const base = await createFixture({ caixaAberto: false });
    const app = createApp();
    const request = supertest(app);

    const open = await request
      .post(`/pdvs/${base.pdv._id}/commands`)
      .set('Authorization', 'Bearer token')
      .set('X-Idempotency-Key', 'test-next-open-cash-only-open-1')
      .send({
        action: 'pdv.caixa.open',
        payload: {
          payments: [
            { id: 'dinheiro', label: 'Dinheiro', type: 'avista', valor: 50 },
            { id: 'pix', label: 'Pix', type: 'avista', valor: 15 },
            { id: 'credito', label: 'Crédito', type: 'credito', valor: 30 },
          ],
        },
      });
    assert.equal(open.status, 200, open.text);

    const close = await request
      .post(`/pdvs/${base.pdv._id}/commands`)
      .set('Authorization', 'Bearer token')
      .set('X-Idempotency-Key', 'test-next-open-cash-only-close-1')
      .send({
        action: 'pdv.caixa.close',
        payload: {
          payments: [
            { id: 'dinheiro', label: 'Dinheiro', type: 'avista', valor: 52 },
            { id: 'pix', label: 'Pix', type: 'avista', valor: 20 },
            { id: 'credito', label: 'Crédito', type: 'credito', valor: 40 },
          ],
        },
      });
    assert.equal(close.status, 200, close.text);

    const nextOpeningPayments = close.body.state.pagamentos || [];
    const dinheiro = nextOpeningPayments.find((item) => item.id === 'dinheiro');
    const pix = nextOpeningPayments.find((item) => item.id === 'pix');
    const credito = nextOpeningPayments.find((item) => item.id === 'credito');
    assert.ok(dinheiro);
    assert.equal(dinheiro.valor, 52);
    assert.ok(pix);
    assert.equal(pix.valor, 0);
    assert.ok(credito);
    assert.equal(credito.valor, 0);
  });

  test('registers client receipt through pdv.caixa.client_receipt', async () => {
    const base = await createFixture({ caixaAberto: false });
    const app = createApp();
    const request = supertest(app);

    const open = await request
      .post(`/pdvs/${base.pdv._id}/commands`)
      .set('Authorization', 'Bearer token')
      .set('X-Idempotency-Key', 'test-cx-client-receipt-open-1')
      .send({
        action: 'pdv.caixa.open',
        payload: {
          payments: [{ id: 'dinheiro', label: 'Dinheiro', type: 'avista', valor: 10 }],
        },
      });
    assert.equal(open.status, 200, open.text);

    const receive = await request
      .post(`/pdvs/${base.pdv._id}/commands`)
      .set('Authorization', 'Bearer token')
      .set('X-Idempotency-Key', 'test-cx-client-receipt-1')
      .send({
        action: 'pdv.caixa.client_receipt',
        payload: {
          customerName: 'Cliente Crediário',
          payments: [{ id: 'dinheiro', label: 'Dinheiro', type: 'avista', valor: 25 }],
          total: 25,
        },
      });
    assert.equal(receive.status, 200, receive.text);
    assert.equal(receive.body.state.summary.recebimentosCliente, 25);
    assert.equal(receive.body.state.pagamentos[0].valor, 35);
    assert.equal(receive.body.state.history[0].id, 'recebimento-cliente');
  });

  test('calculates fechamento previsto by payment method (abertura + vendas + entradas - saídas/envios)', async () => {
    const base = await createFixture({ caixaAberto: false });
    const app = createApp();
    const request = supertest(app);

    const open = await request
      .post(`/pdvs/${base.pdv._id}/commands`)
      .set('Authorization', 'Bearer token')
      .set('X-Idempotency-Key', 'test-close-calc-open-1')
      .send({
        action: 'pdv.caixa.open',
        payload: {
          payments: [
            { id: 'dinheiro', label: 'Dinheiro', type: 'avista', valor: 50 },
            { id: 'pix', label: 'Pix', type: 'avista', valor: 10 },
          ],
        },
      });
    assert.equal(open.status, 200, open.text);

    const sale = await request
      .post(`/pdvs/${base.pdv._id}/commands`)
      .set('Authorization', 'Bearer token')
      .set('X-Idempotency-Key', 'test-close-calc-sale-1')
      .send({
        action: 'pdv.sale.finalize',
        payload: {
          saleId: 'sale-close-calc-001',
          items: [{ nome: 'Ração', quantidade: 1, preco: 30 }],
          payments: [
            { id: 'dinheiro', label: 'Dinheiro', type: 'avista', valor: 20 },
            { id: 'pix', label: 'Pix', type: 'avista', valor: 10 },
          ],
          totalBruto: 30,
          totalLiquido: 30,
        },
      });
    assert.equal(sale.status, 200, sale.text);

    const entry = await request
      .post(`/pdvs/${base.pdv._id}/commands`)
      .set('Authorization', 'Bearer token')
      .set('X-Idempotency-Key', 'test-close-calc-entry-1')
      .send({
        action: 'pdv.caixa.entry',
        payload: { paymentId: 'dinheiro', amount: 5, reason: 'Reforço' },
      });
    assert.equal(entry.status, 200, entry.text);

    const exit = await request
      .post(`/pdvs/${base.pdv._id}/commands`)
      .set('Authorization', 'Bearer token')
      .set('X-Idempotency-Key', 'test-close-calc-exit-1')
      .send({
        action: 'pdv.caixa.exit',
        payload: { paymentId: 'pix', amount: 2, reason: 'Despesa' },
      });
    assert.equal(exit.status, 200, exit.text);

    const clientReceipt = await request
      .post(`/pdvs/${base.pdv._id}/commands`)
      .set('Authorization', 'Bearer token')
      .set('X-Idempotency-Key', 'test-close-calc-client-receipt-1')
      .send({
        action: 'pdv.caixa.client_receipt',
        payload: {
          customerName: 'Cliente Crediário',
          payments: [{ id: 'pix', label: 'Pix', type: 'avista', valor: 7 }],
          total: 7,
        },
      });
    assert.equal(clientReceipt.status, 200, clientReceipt.text);

    const close = await request
      .post(`/pdvs/${base.pdv._id}/commands`)
      .set('Authorization', 'Bearer token')
      .set('X-Idempotency-Key', 'test-close-calc-close-1')
      .send({
        action: 'pdv.caixa.close',
        payload: {
          reason: 'Fechamento',
          payments: [
            { id: 'dinheiro', label: 'Dinheiro', type: 'avista', valor: 75 },
            { id: 'pix', label: 'Pix', type: 'avista', valor: 25 },
          ],
        },
      });
    assert.equal(close.status, 200, close.text);

    const previsto = close.body.state.caixaInfo.previstoPagamentos || [];
    const dinheiro = previsto.find((item) => item.id === 'dinheiro');
    const pix = previsto.find((item) => item.id === 'pix');
    assert.ok(dinheiro);
    assert.ok(pix);
    assert.equal(dinheiro.valor, 75);
    assert.equal(pix.valor, 18);
    assert.equal(close.body.state.caixaInfo.fechamentoPrevisto, 93);
  });

  test('finalizes sale through pdv.sale.finalize and updates state', async () => {
    const base = await createFixture({ caixaAberto: false });
    const app = createApp();
    const request = supertest(app);

    const open = await request
      .post(`/pdvs/${base.pdv._id}/commands`)
      .set('Authorization', 'Bearer token')
      .set('X-Idempotency-Key', 'test-sale-open-1')
      .send({
        action: 'pdv.caixa.open',
        payload: {
          payments: [{ id: 'dinheiro', label: 'Dinheiro', type: 'avista', valor: 50 }],
        },
      });
    assert.equal(open.status, 200, open.text);

    const finalize = await request
      .post(`/pdvs/${base.pdv._id}/commands`)
      .set('Authorization', 'Bearer token')
      .set('X-Idempotency-Key', 'test-sale-finalize-1')
      .send({
        action: 'pdv.sale.finalize',
        payload: {
          items: [{ nome: 'Produto A', quantidade: 2, preco: 20 }],
          payments: [{ id: 'dinheiro', label: 'Dinheiro', type: 'avista', valor: 40 }],
          totalBruto: 40,
          totalLiquido: 40,
          customerName: 'Cliente Teste',
        },
      });
    assert.equal(finalize.status, 200, finalize.text);
    assert.equal(finalize.body.action, 'pdv.sale.finalize');
    assert.equal(finalize.body.state.caixa.aberto, true);
    assert.equal(finalize.body.state.completedSales.length, 1);
    assert.equal(finalize.body.state.completedSales[0].totalLiquido, 40);
    assert.equal(finalize.body.state.history[0].id, 'venda');
    assert.ok(String(finalize.body.state.completedSales[0].saleCode || '').length > 0);
    assert.equal(finalize.body.state.summary.recebido, 40);

    const persisted = await PdvState.findOne({ pdv: base.pdv._id }).lean();
    assert.ok(persisted);
    assert.equal(Array.isArray(persisted.completedSales), true);
    assert.equal(persisted.completedSales.length, 1);
    assert.equal(persisted.history[0].id, 'venda');
    assert.equal(persisted.summary.recebido, 40);
  });

  test('decrements stock on sale finalize when ids are present only in sale items', async () => {
    const base = await createFixture({ caixaAberto: false });
    const app = createApp();
    const request = supertest(app);

    const deposit = await Deposit.create({
      codigo: `DEP-${Date.now()}`,
      nome: 'Deposito Teste',
      empresa: base.pdv.empresa,
    });

    await Pdv.findByIdAndUpdate(base.pdv._id, {
      $set: { 'configuracoesEstoque.depositoPadrao': deposit._id },
    });

    const product = await Product.create({
      cod: `P-${Date.now()}`,
      codbarras: `B-${Date.now()}`,
      nome: 'Produto Estoque',
      custo: 10,
      venda: 20,
      estoques: [{ deposito: deposit._id, quantidade: 5, unidade: 'UN' }],
    });

    const open = await request
      .post(`/pdvs/${base.pdv._id}/commands`)
      .set('Authorization', 'Bearer token')
      .set('X-Idempotency-Key', 'test-sale-stock-open-1')
      .send({
        action: 'pdv.caixa.open',
        payload: {
          payments: [{ id: 'dinheiro', label: 'Dinheiro', type: 'avista', valor: 50 }],
        },
      });
    assert.equal(open.status, 200, open.text);

    const finalize = await request
      .post(`/pdvs/${base.pdv._id}/commands`)
      .set('Authorization', 'Bearer token')
      .set('X-Idempotency-Key', 'test-sale-stock-finalize-1')
      .send({
        action: 'pdv.sale.finalize',
        payload: {
          saleId: 'sale-stock-001',
          items: [
            {
              id: `${String(product._id)}:seller`,
              nome: 'Produto Estoque',
              quantidade: 2,
              preco: 20,
              subtotal: 40,
              productSnapshot: { _id: product._id },
            },
          ],
          receiptSnapshot: {
            itens: [{ codigo: '33', quantidade: '2', nome: 'Produto Estoque' }],
          },
          payments: [{ id: 'dinheiro', label: 'Dinheiro', type: 'avista', valor: 40 }],
          totalBruto: 40,
          totalLiquido: 40,
        },
      });
    assert.equal(finalize.status, 200, finalize.text);

    const updatedProduct = await Product.findById(product._id).lean();
    assert.ok(updatedProduct);
    const updatedEntry = (updatedProduct.estoques || []).find(
      (entry) => String(entry.deposito) === String(deposit._id)
    );
    assert.ok(updatedEntry);
    assert.equal(Number(updatedEntry.quantidade), 3);
  });

  test('respects idempotency for pdv.sale.finalize', async () => {
    const base = await createFixture({ caixaAberto: false });
    const app = createApp();
    const request = supertest(app);

    const open = await request
      .post(`/pdvs/${base.pdv._id}/commands`)
      .set('Authorization', 'Bearer token')
      .set('X-Idempotency-Key', 'test-sale-open-2')
      .send({
        action: 'pdv.caixa.open',
        payload: {
          payments: [{ id: 'dinheiro', label: 'Dinheiro', type: 'avista', valor: 20 }],
        },
      });
    assert.equal(open.status, 200, open.text);

    const key = 'test-sale-finalize-idempotent-1';
    const body = {
      action: 'pdv.sale.finalize',
      payload: {
        saleId: 'sale-idempotent-001',
        items: [{ nome: 'Produto B', quantidade: 1, preco: 15 }],
        payments: [{ id: 'dinheiro', label: 'Dinheiro', type: 'avista', valor: 15 }],
        totalBruto: 15,
        totalLiquido: 15,
        customerName: 'Cliente Teste',
      },
    };

    const first = await request
      .post(`/pdvs/${base.pdv._id}/commands`)
      .set('Authorization', 'Bearer token')
      .set('X-Idempotency-Key', key)
      .send(body);
    assert.equal(first.status, 200, first.text);

    const second = await request
      .post(`/pdvs/${base.pdv._id}/commands`)
      .set('Authorization', 'Bearer token')
      .set('X-Idempotency-Key', key)
      .send(body);
    assert.equal(second.status, 200, second.text);

    const persisted = await PdvState.findOne({ pdv: base.pdv._id }).lean();
    assert.ok(persisted);
    assert.equal(persisted.completedSales.length, 1);
    assert.equal(persisted.history.filter((entry) => entry.id === 'venda').length, 1);
  });

  test('syncs sale receivables through pdv.sale.sync_receivables', async () => {
    const base = await createFixture({ caixaAberto: false });
    const app = createApp();
    const request = supertest(app);

    const open = await request
      .post(`/pdvs/${base.pdv._id}/commands`)
      .set('Authorization', 'Bearer token')
      .set('X-Idempotency-Key', 'test-sale-sync-receivables-open-1')
      .send({
        action: 'pdv.caixa.open',
        payload: {
          payments: [{ id: 'dinheiro', label: 'Dinheiro', type: 'avista', valor: 10 }],
        },
      });
    assert.equal(open.status, 200, open.text);

    const finalize = await request
      .post(`/pdvs/${base.pdv._id}/commands`)
      .set('Authorization', 'Bearer token')
      .set('X-Idempotency-Key', 'test-sale-sync-receivables-finalize-1')
      .send({
        action: 'pdv.sale.finalize',
        payload: {
          saleId: 'sale-sync-receivables-001',
          items: [{ nome: 'Produto Sync', quantidade: 1, preco: 30 }],
          payments: [{ id: 'dinheiro', label: 'Dinheiro', type: 'avista', valor: 30 }],
          totalBruto: 30,
          totalLiquido: 30,
          customerName: 'Cliente Sync',
        },
      });
    assert.equal(finalize.status, 200, finalize.text);

    const sync = await request
      .post(`/pdvs/${base.pdv._id}/commands`)
      .set('Authorization', 'Bearer token')
      .set('X-Idempotency-Key', 'test-sale-sync-receivables-1')
      .send({
        action: 'pdv.sale.sync_receivables',
        payload: {
          saleId: 'sale-sync-receivables-001',
          receivables: [
            {
              id: 'rcv-001',
              parcelNumber: 1,
              value: 30,
              dueDate: '2026-03-20T00:00:00.000Z',
              paymentMethodId: 'crediario',
              paymentMethodLabel: 'Crediário',
              clienteNome: 'Cliente Sync',
            },
          ],
        },
      });
    assert.equal(sync.status, 200, sync.text);
    assert.equal(sync.body.state.accountsReceivable.length, 1);
    assert.equal(sync.body.state.accountsReceivable[0].saleId, 'sale-sync-receivables-001');
    assert.equal(sync.body.state.completedSales.length, 1);
    assert.equal(sync.body.state.completedSales[0].receivables.length, 1);
  });

  test('saves and finalizes budget through commands', async () => {
    const base = await createFixture({ caixaAberto: false });
    const app = createApp();
    const request = supertest(app);

    const save = await request
      .post(`/pdvs/${base.pdv._id}/commands`)
      .set('Authorization', 'Bearer token')
      .set('X-Idempotency-Key', 'test-budget-save-1')
      .send({
        action: 'pdv.budget.save',
        payload: {
          id: 'budget-001',
          items: [{ nome: 'Produto C', quantidade: 1, preco: 30 }],
          payments: [{ id: 'dinheiro', label: 'Dinheiro', valor: 30 }],
          total: 30,
          status: 'aberto',
          customer: { nome: 'Cliente Budget' },
        },
      });
    assert.equal(save.status, 200, save.text);
    assert.equal(save.body.state.budgets.length, 1);
    assert.equal(save.body.state.budgets[0].status, 'aberto');
    assert.ok(String(save.body.state.budgets[0].code || '').length > 0);

    const finalize = await request
      .post(`/pdvs/${base.pdv._id}/commands`)
      .set('Authorization', 'Bearer token')
      .set('X-Idempotency-Key', 'test-budget-finalize-1')
      .send({
        action: 'pdv.budget.finalize',
        payload: {
          budgetId: 'budget-001',
          finalizedSaleId: 'sale-xyz-001',
        },
      });
    assert.equal(finalize.status, 200, finalize.text);
    assert.equal(finalize.body.state.budgets.length, 1);
    assert.equal(finalize.body.state.budgets[0].status, 'finalizado');
    assert.equal(finalize.body.state.budgets[0].finalizedSaleId, 'sale-xyz-001');
    assert.ok(finalize.body.state.budgets[0].finalizedAt);
  });

  test('marks budget as imported and respects idempotency', async () => {
    const base = await createFixture({ caixaAberto: false });
    const app = createApp();
    const request = supertest(app);

    const save = await request
      .post(`/pdvs/${base.pdv._id}/commands`)
      .set('Authorization', 'Bearer token')
      .set('X-Idempotency-Key', 'test-budget-save-2')
      .send({
        action: 'pdv.budget.save',
        payload: {
          id: 'budget-002',
          items: [{ nome: 'Produto D', quantidade: 2, preco: 15 }],
          total: 30,
        },
      });
    assert.equal(save.status, 200, save.text);

    const idemKey = 'test-budget-import-1';
    const markFirst = await request
      .post(`/pdvs/${base.pdv._id}/commands`)
      .set('Authorization', 'Bearer token')
      .set('X-Idempotency-Key', idemKey)
      .send({
        action: 'pdv.budget.mark_imported',
        payload: { budgetId: 'budget-002' },
      });
    assert.equal(markFirst.status, 200, markFirst.text);
    assert.ok(markFirst.body.state.budgets[0].importedAt);

    const markSecond = await request
      .post(`/pdvs/${base.pdv._id}/commands`)
      .set('Authorization', 'Bearer token')
      .set('X-Idempotency-Key', idemKey)
      .send({
        action: 'pdv.budget.mark_imported',
        payload: { budgetId: 'budget-002' },
      });
    assert.equal(markSecond.status, 200, markSecond.text);
    assert.ok(markSecond.body.state.budgets[0].importedAt);
  });

  test('deletes budget through pdv.budget.delete', async () => {
    const base = await createFixture({ caixaAberto: false });
    const app = createApp();
    const request = supertest(app);

    const save = await request
      .post(`/pdvs/${base.pdv._id}/commands`)
      .set('Authorization', 'Bearer token')
      .set('X-Idempotency-Key', 'test-budget-save-delete-1')
      .send({
        action: 'pdv.budget.save',
        payload: {
          id: 'budget-delete-001',
          items: [{ nome: 'Produto E', quantidade: 1, preco: 40 }],
          total: 40,
        },
      });
    assert.equal(save.status, 200, save.text);
    assert.equal(save.body.state.budgets.length, 1);

    const remove = await request
      .post(`/pdvs/${base.pdv._id}/commands`)
      .set('Authorization', 'Bearer token')
      .set('X-Idempotency-Key', 'test-budget-delete-1')
      .send({
        action: 'pdv.budget.delete',
        payload: { budgetId: 'budget-delete-001' },
      });
    assert.equal(remove.status, 200, remove.text);
    assert.equal(remove.body.state.budgets.length, 0);
  });

  test('registers and finalizes delivery through commands', async () => {
    const base = await createFixture({ caixaAberto: false });
    const app = createApp();
    const request = supertest(app);

    const open = await request
      .post(`/pdvs/${base.pdv._id}/commands`)
      .set('Authorization', 'Bearer token')
      .set('X-Idempotency-Key', 'test-delivery-open-1')
      .send({
        action: 'pdv.caixa.open',
        payload: {
          payments: [{ id: 'dinheiro', label: 'Dinheiro', type: 'avista', valor: 10 }],
        },
      });
    assert.equal(open.status, 200, open.text);

    const register = await request
      .post(`/pdvs/${base.pdv._id}/commands`)
      .set('Authorization', 'Bearer token')
      .set('X-Idempotency-Key', 'test-delivery-register-1')
      .send({
        action: 'pdv.delivery.register',
        payload: {
          orderId: 'delivery-001',
          saleId: 'sale-delivery-001',
          customerName: 'Cliente Delivery',
          items: [{ nome: 'Ração', quantidade: 1, preco: 25 }],
          payments: [{ id: 'dinheiro', label: 'Dinheiro', type: 'avista', valor: 25 }],
          total: 25,
          status: 'emSeparacao',
          address: { cidade: 'Rio de Janeiro', uf: 'RJ' },
        },
      });
    assert.equal(register.status, 200, register.text);
    assert.equal(register.body.state.deliveryOrders.length, 1);
    assert.equal(register.body.state.deliveryOrders[0].status, 'emSeparacao');
    assert.equal(register.body.state.completedSales.length, 1);
    assert.equal(register.body.state.summary.recebido, 0);

    const finalize = await request
      .post(`/pdvs/${base.pdv._id}/commands`)
      .set('Authorization', 'Bearer token')
      .set('X-Idempotency-Key', 'test-delivery-finalize-1')
      .send({
        action: 'pdv.delivery.finalize',
        payload: {
          orderId: 'delivery-001',
          saleRecordId: register.body.state.deliveryOrders[0].saleRecordId,
          customerName: 'Cliente Delivery',
          items: [{ nome: 'Ração', quantidade: 1, preco: 25 }],
          payments: [{ id: 'dinheiro', label: 'Dinheiro', type: 'avista', valor: 25 }],
          total: 25,
        },
      });
    assert.equal(finalize.status, 200, finalize.text);
    assert.equal(finalize.body.state.deliveryOrders[0].status, 'finalizado');
    assert.ok(finalize.body.state.deliveryOrders[0].finalizedAt);
    assert.equal(finalize.body.state.summary.recebido, 25);
    assert.equal(finalize.body.state.history[0].id, 'venda');
  });

  test('respects idempotency for pdv.delivery.finalize', async () => {
    const base = await createFixture({ caixaAberto: false });
    const app = createApp();
    const request = supertest(app);

    const open = await request
      .post(`/pdvs/${base.pdv._id}/commands`)
      .set('Authorization', 'Bearer token')
      .set('X-Idempotency-Key', 'test-delivery-open-2')
      .send({
        action: 'pdv.caixa.open',
        payload: {
          payments: [{ id: 'dinheiro', label: 'Dinheiro', type: 'avista', valor: 5 }],
        },
      });
    assert.equal(open.status, 200, open.text);

    const register = await request
      .post(`/pdvs/${base.pdv._id}/commands`)
      .set('Authorization', 'Bearer token')
      .set('X-Idempotency-Key', 'test-delivery-register-2')
      .send({
        action: 'pdv.delivery.register',
        payload: {
          orderId: 'delivery-002',
          saleId: 'sale-delivery-002',
          customerName: 'Cliente Delivery',
          items: [{ nome: 'Areia', quantidade: 1, preco: 10 }],
          payments: [{ id: 'dinheiro', label: 'Dinheiro', type: 'avista', valor: 10 }],
          total: 10,
        },
      });
    assert.equal(register.status, 200, register.text);

    const idemKey = 'test-delivery-finalize-idempotent-1';
    const body = {
      action: 'pdv.delivery.finalize',
      payload: {
        orderId: 'delivery-002',
        saleRecordId: register.body.state.deliveryOrders[0].saleRecordId,
        items: [{ nome: 'Areia', quantidade: 1, preco: 10 }],
        payments: [{ id: 'dinheiro', label: 'Dinheiro', type: 'avista', valor: 10 }],
        total: 10,
      },
    };

    const first = await request
      .post(`/pdvs/${base.pdv._id}/commands`)
      .set('Authorization', 'Bearer token')
      .set('X-Idempotency-Key', idemKey)
      .send(body);
    assert.equal(first.status, 200, first.text);

    const second = await request
      .post(`/pdvs/${base.pdv._id}/commands`)
      .set('Authorization', 'Bearer token')
      .set('X-Idempotency-Key', idemKey)
      .send(body);
    assert.equal(second.status, 200, second.text);

    const persisted = await PdvState.findOne({ pdv: base.pdv._id }).lean();
    assert.ok(persisted);
    assert.equal(persisted.deliveryOrders.length, 1);
    assert.equal(
      persisted.history.filter((entry) => entry.id === 'venda').length,
      1
    );
    assert.equal(persisted.summary.recebido, 10);
  });

  test('cancels sale through pdv.sale.cancel and reverts cash summary', async () => {
    const base = await createFixture({ caixaAberto: false });
    const app = createApp();
    const request = supertest(app);

    const open = await request
      .post(`/pdvs/${base.pdv._id}/commands`)
      .set('Authorization', 'Bearer token')
      .set('X-Idempotency-Key', 'test-sale-cancel-open-1')
      .send({
        action: 'pdv.caixa.open',
        payload: {
          payments: [{ id: 'dinheiro', label: 'Dinheiro', type: 'avista', valor: 50 }],
        },
      });
    assert.equal(open.status, 200, open.text);

    const finalize = await request
      .post(`/pdvs/${base.pdv._id}/commands`)
      .set('Authorization', 'Bearer token')
      .set('X-Idempotency-Key', 'test-sale-cancel-finalize-1')
      .send({
        action: 'pdv.sale.finalize',
        payload: {
          saleId: 'sale-cancel-001',
          items: [{ nome: 'Produto Cancelamento', quantidade: 1, preco: 30 }],
          payments: [{ id: 'dinheiro', label: 'Dinheiro', type: 'avista', valor: 30 }],
          totalBruto: 30,
          totalLiquido: 30,
        },
      });
    assert.equal(finalize.status, 200, finalize.text);
    assert.equal(finalize.body.state.summary.recebido, 30);

    const cancel = await request
      .post(`/pdvs/${base.pdv._id}/commands`)
      .set('Authorization', 'Bearer token')
      .set('X-Idempotency-Key', 'test-sale-cancel-1')
      .send({
        action: 'pdv.sale.cancel',
        payload: {
          saleId: 'sale-cancel-001',
          reason: 'Cliente desistiu',
        },
      });
    assert.equal(cancel.status, 200, cancel.text);
    assert.equal(cancel.body.state.summary.recebido, 0);
    assert.equal(cancel.body.state.completedSales.length, 1);
    assert.equal(cancel.body.state.completedSales[0].status, 'cancelled');
    assert.equal(cancel.body.state.completedSales[0].cancellationReason, 'Cliente desistiu');
    assert.equal(cancel.body.state.history[0].id, 'cancelamento-venda');
    assert.equal(cancel.body.state.pagamentos[0].valor, 0);
  });

  test('respects idempotency for pdv.sale.cancel', async () => {
    const base = await createFixture({ caixaAberto: false });
    const app = createApp();
    const request = supertest(app);

    const open = await request
      .post(`/pdvs/${base.pdv._id}/commands`)
      .set('Authorization', 'Bearer token')
      .set('X-Idempotency-Key', 'test-sale-cancel-open-2')
      .send({
        action: 'pdv.caixa.open',
        payload: {
          payments: [{ id: 'dinheiro', label: 'Dinheiro', type: 'avista', valor: 20 }],
        },
      });
    assert.equal(open.status, 200, open.text);

    const finalize = await request
      .post(`/pdvs/${base.pdv._id}/commands`)
      .set('Authorization', 'Bearer token')
      .set('X-Idempotency-Key', 'test-sale-cancel-finalize-2')
      .send({
        action: 'pdv.sale.finalize',
        payload: {
          saleId: 'sale-cancel-002',
          items: [{ nome: 'Produto Cancelamento 2', quantidade: 1, preco: 15 }],
          payments: [{ id: 'dinheiro', label: 'Dinheiro', type: 'avista', valor: 15 }],
          totalBruto: 15,
          totalLiquido: 15,
        },
      });
    assert.equal(finalize.status, 200, finalize.text);

    const idemKey = 'test-sale-cancel-idempotent-1';
    const body = {
      action: 'pdv.sale.cancel',
      payload: {
        saleId: 'sale-cancel-002',
        reason: 'Erro de lançamento',
      },
    };

    const first = await request
      .post(`/pdvs/${base.pdv._id}/commands`)
      .set('Authorization', 'Bearer token')
      .set('X-Idempotency-Key', idemKey)
      .send(body);
    assert.equal(first.status, 200, first.text);

    const second = await request
      .post(`/pdvs/${base.pdv._id}/commands`)
      .set('Authorization', 'Bearer token')
      .set('X-Idempotency-Key', idemKey)
      .send(body);
    assert.equal(second.status, 200, second.text);

    const persisted = await PdvState.findOne({ pdv: base.pdv._id }).lean();
    assert.ok(persisted);
    assert.equal(persisted.summary.recebido, 0);
    assert.equal(persisted.completedSales.length, 1);
    assert.equal(persisted.completedSales[0].status, 'cancelled');
    assert.equal(
      persisted.history.filter((entry) => entry.id === 'cancelamento-venda').length,
      1
    );
  });

  test('resets fiscal status through pdv.sale.reset_fiscal_status', async () => {
    const base = await createFixture({ caixaAberto: false });
    const app = createApp();
    const request = supertest(app);

    const open = await request
      .post(`/pdvs/${base.pdv._id}/commands`)
      .set('Authorization', 'Bearer token')
      .set('X-Idempotency-Key', 'test-sale-fiscal-reset-open-1')
      .send({
        action: 'pdv.caixa.open',
        payload: {
          payments: [{ id: 'dinheiro', label: 'Dinheiro', type: 'avista', valor: 40 }],
        },
      });
    assert.equal(open.status, 200, open.text);

    const finalize = await request
      .post(`/pdvs/${base.pdv._id}/commands`)
      .set('Authorization', 'Bearer token')
      .set('X-Idempotency-Key', 'test-sale-fiscal-reset-finalize-1')
      .send({
        action: 'pdv.sale.finalize',
        payload: {
          saleId: 'sale-fiscal-reset-001',
          items: [{ nome: 'Produto Fiscal', quantidade: 1, preco: 25 }],
          payments: [{ id: 'dinheiro', label: 'Dinheiro', type: 'avista', valor: 25 }],
          totalBruto: 25,
          totalLiquido: 25,
        },
      });
    assert.equal(finalize.status, 200, finalize.text);

    await PdvState.findOneAndUpdate(
      { pdv: base.pdv._id, 'completedSales.id': 'sale-fiscal-reset-001' },
      { $set: { 'completedSales.$.fiscalStatus': 'emitting' } }
    );

    const idemKey = 'test-sale-fiscal-reset-1';
    const body = {
      action: 'pdv.sale.reset_fiscal_status',
      payload: {
        saleId: 'sale-fiscal-reset-001',
      },
    };

    const first = await request
      .post(`/pdvs/${base.pdv._id}/commands`)
      .set('Authorization', 'Bearer token')
      .set('X-Idempotency-Key', idemKey)
      .send(body);
    assert.equal(first.status, 200, first.text);
    assert.equal(first.body.state.completedSales[0].fiscalStatus, 'pending');

    const second = await request
      .post(`/pdvs/${base.pdv._id}/commands`)
      .set('Authorization', 'Bearer token')
      .set('X-Idempotency-Key', idemKey)
      .send(body);
    assert.equal(second.status, 200, second.text);
    assert.equal(second.body.state.completedSales[0].fiscalStatus, 'pending');
  });
});
