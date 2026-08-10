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
const Product = require('../../models/Product');
const PaymentMethod = require('../../models/PaymentMethod');
const Deposit = require('../../models/Deposit');
const BankAccount = require('../../models/BankAccount');
const AccountingAccount = require('../../models/AccountingAccount');
const AccountReceivable = require('../../models/AccountReceivable');
const PdvConversionBackup = require('../../models/PdvConversionBackup');
const PdvDesktopEvent = require('../../models/PdvDesktopEvent');
const PdvState = require('../../models/PdvState');
const PdvStateSale = require('../../models/PdvStateSale');
const User = require('../../models/User');
const Pet = require('../../models/Pet');
const UserAddress = require('../../models/UserAddress');
const Appointment = require('../../models/Appointment');
const Exchange = require('../../models/Exchange');
const Transfer = require('../../models/Transfer');
const router = require('../../routes/pdvDesktop');

let mongo;
function app() { const instance = express(); instance.use(express.json()); instance.use('/desktop', router); return instance; }

async function fixture() {
  const company = await Store.create({ codigo: `E-${Date.now()}`, nome: 'Empresa Desktop', nomeFantasia: 'Empresa Desktop', cnpj: `${Date.now()}`.slice(-14) });
  const pdv = await Pdv.create({ codigo: `PDV-${Date.now()}`, nome: 'PDV Conversão', empresa: company._id, tipoUso: 'web' });
  const product = await Product.create({ cod: `P-${Date.now()}`, codbarras: `${Date.now()}`, nome: 'Ração Teste', custo: 10, venda: 20, stock: 4.5 });
  const payment = await PaymentMethod.create({ company: company._id, code: `PIX-${Date.now()}`, name: 'Pix', type: 'avista' });
  return { company, pdv, product, payment };
}

test.describe('integração do PDV Desktop', () => {
  test.before(async () => {
    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
    await mongoose.connect(mongo.getUri(), { dbName: 'pdv-desktop-test' });
  });
  test.after(async () => { await mongoose.disconnect(); if (mongo) await mongo.stop(); });
  test.beforeEach(async () => { await mongoose.connection.db.dropDatabase(); });

  test('permite preparar um PDV Web, sincronizar catálogo e receber eventos idempotentes', async () => {
    const base = await fixture();
    const suffix = String(Date.now()).slice(-8);
    const customer = await User.create({ tipoConta: 'pessoa_fisica', email: `desktop-customer-${suffix}@example.com`, senha: 'hash', celular: `219${suffix}`, nomeCompleto: 'Cliente Desktop', cpf: `123${suffix}`, role: 'cliente', empresaPrincipal: base.company._id });
    const pet = await Pet.create({ owner: customer._id, nome: 'Bidu', tipo: 'cachorro', raca: 'vira-lata', sexo: 'macho', dataNascimento: new Date('2022-01-01T00:00:00Z') });
    const appointment = await Appointment.create({ store: base.company._id, cliente: customer._id, pet: pet._id, scheduledAt: new Date(Date.now() + 3600000), valor: 20, status: 'em_atendimento', observacoes: 'Atendimento do teste desktop' });
    await UserAddress.create({ user: customer._id, cep: '20000000', logradouro: 'Rua Desktop', numero: '10', cidade: 'Rio de Janeiro', uf: 'RJ', isDefault: true });
    await User.create({ tipoConta: 'pessoa_fisica', email: `desktop-seller-${suffix}@example.com`, senha: 'hash', celular: `218${suffix}`, nomeCompleto: 'Vendedor Desktop', role: 'funcionario', grupos: ['vendedor'], empresas: [base.company._id], codigoCliente: 987654 });
    const courier = await User.create({ tipoConta: 'pessoa_fisica', email: `desktop-courier-${suffix}@example.com`, senha: 'hash', celular: `216${suffix}`, nomeCompleto: 'Entregador Desktop', role: 'funcionario', grupos: ['entregador'], empresas: [base.company._id], codigoCliente: 123456 });
    const request = supertest(app());
    const pairing = await request.post(`/desktop/pdvs/${base.pdv._id}/pairing-code`).set('Authorization', 'Bearer test').send();
    assert.equal(pairing.status, 200, pairing.text);
    const paired = await request.post('/desktop/pair').send({ pairingCode: pairing.body.pairingCode, machineId: 'machine-1', name: 'Caixa Principal' });
    assert.equal(paired.status, 200, paired.text);
    const headers = { 'X-Desktop-Token': paired.body.token };
    const bootstrap = await request.get('/desktop/bootstrap').set(headers);
    assert.equal(bootstrap.status, 200, bootstrap.text);
    assert.equal(bootstrap.body.pdv.tipoUso, 'web');
    const catalog = await request.get('/desktop/catalog/products?limit=50').set(headers);
    assert.equal(catalog.status, 200, catalog.text);
    assert.equal(catalog.body.products.length, 1);
    assert.equal(catalog.body.products[0].stock, 4.5);
    assert.ok(catalog.body.syncCursor);
    const incrementalCatalog = await request.get(`/desktop/catalog/products?limit=50&cursor=${encodeURIComponent(catalog.body.syncCursor)}`).set(headers);
    assert.equal(incrementalCatalog.status, 200, incrementalCatalog.text);
    assert.equal(incrementalCatalog.body.products.length, 0);
    assert.equal(incrementalCatalog.body.syncCursor, catalog.body.syncCursor);
    const directory = await request.get('/desktop/directory/snapshot').set(headers);
    assert.equal(directory.status, 200, directory.text);
    assert.equal(directory.body.customers.find((entry) => entry.name === 'Cliente Desktop').address.street, 'Rua Desktop');
    assert.equal(directory.body.pets.find((entry) => entry.name === 'Bidu').ownerId, String(customer._id));
    assert.equal(directory.body.sellers.find((entry) => entry.name === 'Vendedor Desktop').code, '987654');
    assert.equal(directory.body.couriers.find((entry) => entry.name === 'Entregador Desktop').code, '123456');
    const appointments = await request.get(`/desktop/appointments?start=${encodeURIComponent(new Date(Date.now() - 86400000).toISOString())}&end=${encodeURIComponent(new Date(Date.now() + 86400000).toISOString())}`).set(headers);
    assert.equal(appointments.status, 200, appointments.text);
    assert.equal(appointments.body.appointments.length, 1);
    assert.equal(appointments.body.appointments[0].customerName, 'Cliente Desktop');
    assert.equal(appointments.body.appointments[0].petName, 'Bidu');
    await Pdv.updateOne({ _id: base.pdv._id }, { $set: { tipoUso: 'executavel', 'desktop.status': 'ativo' } });
    const events = [
      { eventId: 'cash-1', type: 'cash.opened', occurredAt: new Date().toISOString(), payload: { openingAmount: 50 } },
      { eventId: 'event-1', type: 'sale.completed', occurredAt: new Date().toISOString(), payload: { id: 'local-sale-1', saleCode: `${base.pdv.codigo.replace(/[^A-Za-z0-9]/g, '')}-000001`, appointmentId: String(appointment._id), appointmentIds: [String(appointment._id)], grossTotal: 20, netTotal: 20, items: [{ productId: String(new mongoose.Types.ObjectId()), code: base.product.cod, name: base.product.nome, quantity: 1, unitPrice: 20 }], payments: [{ paymentMethodId: String(base.payment._id), amount: 20 }] } },
    ];
    const first = await request.post('/desktop/events/batch').set(headers).send({ events });
    const replay = await request.post('/desktop/events/batch').set(headers).send({ events: [events[1]] });
    assert.equal(first.body.results[1].accepted, true, first.text);
    assert.equal(first.body.results[1].status, 'processed');
    assert.equal(replay.body.results[0].replayed, true);
    assert.equal(await PdvDesktopEvent.countDocuments({ eventId: 'event-1' }), 1);
    const cloudState = await PdvState.findOne({ pdv: base.pdv._id }).lean();
    assert.equal(cloudState.completedSales.length, 1);
    assert.equal(cloudState.completedSales[0].id, 'local-sale-1');
    assert.equal(cloudState.completedSales[0].appointmentId, String(appointment._id));
    assert.deepEqual(cloudState.completedSales[0].appointmentIds, [String(appointment._id)]);
    assert.equal(String(cloudState.completedSales[0].items[0].productId), String(base.product._id));
    assert.equal(Number(cloudState.completedSales[0].items[0].unitCost), 10);
    const billedAppointment = await Appointment.findById(appointment._id).lean();
    assert.equal(billedAppointment.pago, true);
    assert.equal(billedAppointment.status, 'finalizado');
    assert.equal(billedAppointment.codigoVenda, events[1].payload.saleCode);

    const budgetEvents = [
      { eventId: 'budget-1', type: 'budget.saved', occurredAt: new Date().toISOString(), payload: { id: 'local-budget-1', budgetCode: 'ORC-000321', customerId: '', customerName: 'Consumidor final', netTotal: 20, grossTotal: 20, validityDays: 15, items: [{ productId: String(base.product._id), code: base.product.cod, name: base.product.nome, quantity: 1, unitPrice: 20 }] } },
      { eventId: 'budget-finalize-1', type: 'budget.finalized', occurredAt: new Date().toISOString(), payload: { budgetId: 'local-budget-1', budgetCode: 'ORC-000321', saleId: 'local-sale-1', finalizedAt: new Date().toISOString() } },
    ];
    const budgetResponse = await request.post('/desktop/events/batch').set(headers).send({ events: budgetEvents });
    assert.equal(budgetResponse.status, 200, budgetResponse.text);
    assert.deepEqual(budgetResponse.body.results.map((entry) => entry.status), ['processed', 'processed']);
    const stateWithBudget = await PdvState.findOne({ pdv: base.pdv._id }).lean();
    assert.equal(stateWithBudget.budgets.length, 1);
    assert.equal(stateWithBudget.budgets[0].id, 'local-budget-1');
    assert.equal(stateWithBudget.budgets[0].code, 'ORC-000321');
    assert.equal(stateWithBudget.budgets[0].customer, null);
    assert.equal(stateWithBudget.budgets[0].status, 'finalizado');
    assert.equal(stateWithBudget.budgets[0].finalizedSaleId, 'local-sale-1');

    const deliveryCode = `${base.pdv.codigo.replace(/[^A-Za-z0-9]/g, '')}-000002`;
    const deliveryEvents = [
      { eventId: 'delivery-register-1', type: 'delivery.registered', occurredAt: new Date().toISOString(), payload: { id: 'delivery-local-1', saleRecordId: 'delivery-sale-record-1', saleCode: deliveryCode, customerId: String(customer._id), customerName: 'Cliente Desktop', customerDocument: customer.cpf, grossTotal: 20, netTotal: 25, additionTotal: 5, address: { street: 'Rua Desktop', number: '10', city: 'Rio de Janeiro', state: 'RJ' }, items: [{ productId: String(base.product._id), code: base.product.cod, name: base.product.nome, quantity: 1, unitPrice: 20 }], payments: [] } },
      { eventId: 'delivery-status-1', type: 'delivery.status.updated', occurredAt: new Date().toISOString(), payload: { orderId: 'delivery-local-1', status: 'emSeparacao' } },
      { eventId: 'delivery-courier-1', type: 'delivery.courier.updated', occurredAt: new Date().toISOString(), payload: { orderId: 'delivery-local-1', courier: { id: String(courier._id), label: 'Entregador Desktop' } } },
      { eventId: 'delivery-status-2', type: 'delivery.status.updated', occurredAt: new Date().toISOString(), payload: { orderId: 'delivery-local-1', status: 'emRota' } },
      { eventId: 'delivery-finalize-1', type: 'delivery.finalized', occurredAt: new Date().toISOString(), payload: { id: 'delivery-sale-final-1', orderId: 'delivery-local-1', saleRecordId: 'delivery-sale-record-1', saleCode: deliveryCode, customerId: String(customer._id), customerName: 'Cliente Desktop', customerDocument: customer.cpf, grossTotal: 20, netTotal: 25, additionTotal: 5, address: { street: 'Rua Desktop', number: '10' }, courier: { id: String(courier._id), label: 'Entregador Desktop' }, items: [{ productId: String(base.product._id), code: base.product.cod, name: base.product.nome, quantity: 1, unitPrice: 20 }], payments: [{ paymentMethodId: String(base.payment._id), amount: 25 }] } },
    ];
    const deliveryResponse = await request.post('/desktop/events/batch').set(headers).send({ events: deliveryEvents });
    assert.equal(deliveryResponse.status, 200, deliveryResponse.text);
    assert.deepEqual(deliveryResponse.body.results.map((entry) => entry.status), ['processed', 'processed', 'processed', 'processed', 'processed']);
    const stateWithDelivery = await PdvState.findOne({ pdv: base.pdv._id }).lean();
    assert.equal(stateWithDelivery.deliveryOrders.length, 1);
    assert.equal(stateWithDelivery.deliveryOrders[0].status, 'finalizado');
    assert.equal(stateWithDelivery.deliveryOrders[0].courierLabel, 'Entregador Desktop');
    assert.equal(stateWithDelivery.completedSales.find((entry) => entry.id === 'delivery-sale-record-1').cashContributions.length, 1);
    const deliveryPull = await request.get('/desktop/deliveries').set(headers);
    assert.equal(deliveryPull.body.deliveries[0].id, 'delivery-local-1');

    const operationalEvents = [
      { eventId: 'cash-entry-1', type: 'cash.entry', occurredAt: new Date().toISOString(), payload: { amount: 5, paymentMethodId: String(base.payment._id), reason: 'Reforço' } },
      { eventId: 'cancel-1', type: 'sale.cancelled', occurredAt: new Date().toISOString(), payload: { saleId: 'local-sale-1', saleCode: events[1].payload.saleCode, appointmentId: String(appointment._id), appointmentIds: [String(appointment._id)], reason: 'Cliente desistiu' } },
      { eventId: 'cash-close-1', type: 'cash.closed', occurredAt: new Date().toISOString(), payload: { countedPayments: [{ paymentMethodId: String(base.payment._id), amount: 55 }], reason: 'Fim do turno' } },
    ];
    const operational = await request.post('/desktop/events/batch').set(headers).send({ events: operationalEvents });
    assert.equal(operational.status, 200, operational.text);
    assert.deepEqual(operational.body.results.map((item) => item.status), ['processed', 'processed', 'processed']);
    const finalState = await PdvState.findOne({ pdv: base.pdv._id }).lean();
    assert.equal(finalState.completedSales.find((entry) => entry.id === 'local-sale-1').status, 'cancelled');
    assert.equal(finalState.caixaAberto, false);
    const revertedAppointment = await Appointment.findById(appointment._id).lean();
    assert.equal(revertedAppointment.pago, false);
    assert.equal(revertedAppointment.status, 'em_atendimento');
    assert.equal(revertedAppointment.codigoVenda, '');
    const reconciliation = await request.get('/desktop/reconciliation').set(headers);
    assert.equal(reconciliation.status, 200, reconciliation.text);
    assert.equal(reconciliation.body.completedEvents, 1);
    assert.equal(reconciliation.body.cancelledEvents, 1);
    assert.equal(reconciliation.body.completedSales, 0);
  });

  test('reserva faixas sem sobreposição para terminais simultâneos', async () => {
    const base = await fixture();
    const request = supertest(app());
    const pairing = await request.post(`/desktop/pdvs/${base.pdv._id}/pairing-code`).set('Authorization', 'Bearer test').send();
    const paired = await request.post('/desktop/pair').send({ pairingCode: pairing.body.pairingCode, machineId: 'machine-2' });
    await Pdv.updateOne({ _id: base.pdv._id }, { $set: { tipoUso: 'executavel', 'desktop.status': 'ativo' } });
    const send = () => request.post('/desktop/ranges/sale/reserve').set('X-Desktop-Token', paired.body.token).send({ size: 100 });
    const [first, second] = await Promise.all([send(), send()]);
    assert.equal(first.status, 201, first.text);
    assert.equal(second.status, 201, second.text);
    const ranges = [first.body, second.body].sort((a, b) => a.start - b.start);
    assert.equal(ranges[0].end + 1, ranges[1].start);
    const sendNfce = () => request.post('/desktop/ranges/nfce/reserve').set('X-Desktop-Token', paired.body.token).send({ size: 100 });
    const [nfceFirst, nfceSecond] = await Promise.all([sendNfce(), sendNfce()]);
    assert.equal(nfceFirst.status, 201, nfceFirst.text); assert.equal(nfceSecond.status, 201, nfceSecond.text);
    const nfceRanges = [nfceFirst.body, nfceSecond.body].sort((a, b) => a.start - b.start);
    assert.equal(nfceRanges[0].end + 1, nfceRanges[1].start);
  });

  test('sincroniza troca uma unica vez e preserva os movimentos de estoque', async () => {
    const base = await fixture();
    const deposit = await Deposit.create({ codigo: `D-TRC-${Date.now()}`, nome: 'Deposito Trocas', empresa: base.company._id });
    const takenProduct = await Product.create({
      cod: `T-${Date.now()}`,
      codbarras: `9${Date.now()}`,
      nome: 'Produto levado na troca',
      custo: 15,
      venda: 30,
      stock: 5,
      estoques: [{ deposito: deposit._id, quantidade: 5 }],
    });
    await Product.updateOne(
      { _id: base.product._id },
      { $set: { stock: 4, estoques: [{ deposito: deposit._id, quantidade: 4 }] } },
    );
    const customer = await User.create({
      tipoConta: 'pessoa_fisica',
      email: `exchange-${Date.now()}@example.com`,
      senha: 'hash',
      celular: `215${String(Date.now()).slice(-8)}`,
      nomeCompleto: 'Cliente da Troca',
      cpf: `654${String(Date.now()).slice(-8)}`,
      role: 'cliente',
      empresaPrincipal: base.company._id,
    });
    const request = supertest(app());
    const pairing = await request.post(`/desktop/pdvs/${base.pdv._id}/pairing-code`).set('Authorization', 'Bearer test').send();
    const paired = await request.post('/desktop/pair').send({ pairingCode: pairing.body.pairingCode, machineId: 'exchange-host' });
    await Pdv.updateOne(
      { _id: base.pdv._id },
      { $set: { tipoUso: 'executavel', 'desktop.status': 'ativo', 'configuracoesEstoque.depositoPadrao': deposit._id } },
    );
    const headers = { 'X-Desktop-Token': paired.body.token };
    const payload = {
      id: 'exchange-local-1', exchangeCode: 'TRC-LOCAL-000001', sourceSaleId: 'sale-original-1',
      sourceSaleCode: 'VENDA-ORIGINAL-1', customerId: String(customer._id), customerName: 'Cliente da Troca',
      returnedTotal: 40, takenTotal: 30, differenceValue: 10,
      returnedItems: [{ productId: String(base.product._id), code: base.product.cod, name: base.product.nome, quantity: 2, unitPrice: 20, total: 40 }],
      takenItems: [{ productId: String(takenProduct._id), code: takenProduct.cod, name: takenProduct.nome, quantity: 1, unitPrice: 30, total: 30 }],
    };
    const registered = { eventId: 'exchange-register-1', type: 'exchange.registered', occurredAt: new Date().toISOString(), payload };
    const finalized = { eventId: 'exchange-finalize-1', type: 'exchange.finalized', occurredAt: new Date().toISOString(), payload: { ...payload, outcome: 'credit', refundAmount: 10, inventoryMode: 'full', finalizedAt: new Date().toISOString() } };
    const first = await request.post('/desktop/events/batch').set(headers).send({ events: [registered, finalized] });
    const replay = await request.post('/desktop/events/batch').set(headers).send({ events: [finalized] });
    assert.equal(first.status, 200, first.text);
    assert.deepEqual(first.body.results.map((entry) => entry.status), ['processed', 'processed']);
    assert.equal(replay.body.results[0].replayed, true);
    const exchange = await Exchange.findOne({ desktopExchangeId: payload.id }).lean();
    assert.ok(exchange);
    assert.equal(exchange.inventoryProcessed, true);
    assert.equal(exchange.desktopOutcome, 'credit');
    assert.equal(await Exchange.countDocuments({ desktopExchangeId: payload.id }), 1);
    const returned = await Product.findById(base.product._id).lean();
    const taken = await Product.findById(takenProduct._id).lean();
    assert.equal(Number(returned.estoques[0].quantidade), 6);
    assert.equal(Number(taken.estoques[0].quantidade), 4);
    const creditedCustomer = await User.findById(customer._id).lean();
    assert.equal(Number(creditedCustomer.valorPendente), 10);
  });

  test('sincroniza venda em crediário sem inflar o caixa e registra recebimento parcial', async () => {
    const base = await fixture();
    const crediario = await PaymentMethod.create({ company: base.company._id, code: `CRED-${Date.now()}`, name: 'Crediário', type: 'crediario' });
    const bankAccount = await BankAccount.create({ company: base.company._id, bankCode: '001', bankName: 'Banco Teste', agency: '1', accountNumber: `CR-${Date.now()}`, accountType: 'corrente', documentNumber: '12345678901' });
    const accountingAccount = await AccountingAccount.create({ companies: [base.company._id], name: 'Contas a receber', code: `CR-${Date.now()}`, type: 'analitica', paymentNature: 'contas_receber' });
    const customer = await User.create({ tipoConta: 'pessoa_fisica', email: `credit-${Date.now()}@example.com`, senha: 'hash', celular: `217${String(Date.now()).slice(-8)}`, nomeCompleto: 'Cliente Crediário', cpf: `987${String(Date.now()).slice(-8)}`, role: 'cliente', empresaPrincipal: base.company._id });
    const request = supertest(app());
    const pairing = await request.post(`/desktop/pdvs/${base.pdv._id}/pairing-code`).set('Authorization', 'Bearer test').send();
    const paired = await request.post('/desktop/pair').send({ pairingCode: pairing.body.pairingCode, machineId: 'credit-host' });
    await Pdv.updateOne({ _id: base.pdv._id }, { $set: { tipoUso: 'executavel', 'desktop.status': 'ativo', 'configuracoesFinanceiro.contaCorrente': bankAccount._id, 'configuracoesFinanceiro.contaContabilReceber': accountingAccount._id } });
    const headers = { 'X-Desktop-Token': paired.body.token };
    const saleCode = `${base.pdv.codigo.replace(/[^A-Za-z0-9]/g, '')}-000001`;
    const events = [
      { eventId: 'credit-cash-open', type: 'cash.opened', occurredAt: new Date().toISOString(), payload: { openingAmount: 0, paymentMethodId: String(base.payment._id) } },
      { eventId: 'credit-sale', type: 'sale.completed', occurredAt: new Date().toISOString(), payload: { id: 'credit-sale-local', saleCode, customerId: String(customer._id), customerName: 'Cliente Crediário', grossTotal: 20, netTotal: 20, items: [{ productId: String(base.product._id), quantity: 1, unitPrice: 20 }], payments: [{ paymentMethodId: String(crediario._id), type: 'crediario', amount: 20, installments: 2 }], receivables: [{ id: 'local-receivable-1', customerId: String(customer._id), customerName: 'Cliente Crediário', paymentMethodId: String(crediario._id), installmentNumber: 1, originalAmount: 10, dueDate: '2026-09-05' }, { id: 'local-receivable-2', customerId: String(customer._id), customerName: 'Cliente Crediário', paymentMethodId: String(crediario._id), installmentNumber: 2, originalAmount: 10, dueDate: '2026-10-05' }] } },
      { eventId: 'credit-received', type: 'receivable.received', occurredAt: new Date().toISOString(), payload: { receivableId: 'local-receivable-1', saleId: 'credit-sale-local', saleCode, customerId: String(customer._id), customerName: 'Cliente Crediário', installmentNumber: 1, amount: 4, remainingAmount: 6, status: 'partial', paymentMethodId: String(base.payment._id), paidAt: new Date().toISOString() } },
    ];
    const response = await request.post('/desktop/events/batch').set(headers).send({ events });
    assert.equal(response.status, 200, response.text);
    assert.deepEqual(response.body.results.map((entry) => entry.status), ['processed', 'processed', 'processed']);
    const state = await PdvState.findOne({ pdv: base.pdv._id }).lean();
    assert.equal(state.completedSales.length, 1);
    assert.equal(Number(state.completedSales[0].total), 20);
    assert.equal(state.completedSales[0].cashContributions.length, 0);
    const normalizedSale = await PdvStateSale.findOne({ pdv: base.pdv._id, saleId: 'credit-sale-local' }).lean();
    assert.ok(normalizedSale);
    assert.equal(Number(normalizedSale.payload.total), 20);
    assert.equal(await PdvStateSale.countDocuments({ pdv: base.pdv._id }), 1);
    assert.equal(Number(state.summary.recebido || 0), 0);
    assert.equal(Number(state.summary.recebimentosCliente || 0), 4);
    assert.equal(state.history.find((entry) => entry.id === 'recebimento-cliente')?.label, 'Recebimentos de Clientes');
    const first = state.completedSales[0].receivables.find((entry) => entry.id === 'local-receivable-1');
    assert.equal(first.status, 'partial');
    assert.equal(Number(first.value), 6);
    const financialReceivable = await AccountReceivable.findOne({ originReference: `desktop:${base.pdv._id}:local-receivable-1` }).lean();
    assert.ok(financialReceivable);
    assert.equal(financialReceivable.locked, true);
    assert.deepEqual(financialReceivable.installments.map((entry) => [entry.status, Number(entry.value)]), [['received', 4], ['pending', 6]]);
  });

  test('só converte depois do banco local sincronizado e cria backup', async () => {
    const base = await fixture();
    const request = supertest(app());
    const deposit = await Deposit.create({ codigo: `D-${Date.now()}`, nome: 'Depósito', empresa: base.company._id });
    const account = await BankAccount.create({ company: base.company._id, bankCode: '001', bankName: 'Banco', agency: '1', accountNumber: `${Date.now()}`, accountType: 'corrente', documentNumber: '12345678901' });
    const accountingAccount = await AccountingAccount.create({ companies: [base.company._id], name: 'Contas a receber', code: `CONV-${Date.now()}`, type: 'analitica', paymentNature: 'contas_receber' });
    await Pdv.updateOne({ _id: base.pdv._id }, { $set: { serieNfce: '991', 'configuracoesFiscal.tipoEmissaoPadrao': 'fiscal', 'configuracoesEstoque.depositoPadrao': deposit._id, 'configuracoesFinanceiro.contaCorrente': account._id, 'configuracoesFinanceiro.contaContabilReceber': accountingAccount._id } });
    await PdvState.create({ pdv: base.pdv._id, empresa: base.company._id, caixaAberto: false, saleCodeSequence: 8, budgetSequence: 3 });
    const pairing = await request.post(`/desktop/pdvs/${base.pdv._id}/pairing-code`).set('Authorization', 'Bearer test').send();
    const paired = await request.post('/desktop/pair').send({ pairingCode: pairing.body.pairingCode, machineId: 'conversion-host' });
    const beforeSync = await request.get(`/desktop/pdvs/${base.pdv._id}/conversion-check`).set('Authorization', 'Bearer test');
    assert.equal(beforeSync.body.ok, false);
    assert.equal(beforeSync.body.checks.find((item) => item.key === 'local_db_ready').ok, false);
    await request.post('/desktop/heartbeat').set('X-Desktop-Token', paired.body.token).send({ localDbReady: true, initialSyncCompleted: true });
    const conversion = await request.post(`/desktop/pdvs/${base.pdv._id}/convert`).set('Authorization', 'Bearer test').send({ tipoEmissao: 'fiscal', modoTerminais: 'espelhado' });
    assert.equal(conversion.status, 200, conversion.text);
    const converted = await Pdv.findById(base.pdv._id).lean();
    assert.equal(converted.tipoUso, 'executavel');
    assert.equal(converted.desktop.status, 'ativo');
    assert.equal(converted.modoTerminais, 'espelhado');
    assert.equal(await PdvConversionBackup.countDocuments({ pdv: base.pdv._id, reason: 'convert' }), 1);
  });

  test('registra transferência desktop uma única vez e não movimenta estoque antes da aprovação', async () => {
    const base = await fixture();
    const suffix = String(Date.now()).slice(-8);
    const [origin, destination, responsible] = await Promise.all([
      Deposit.create({ codigo: `TO-${suffix}`, nome: 'Origem', empresa: base.company._id }),
      Deposit.create({ codigo: `TD-${suffix}`, nome: 'Destino', empresa: base.company._id }),
      User.create({ tipoConta: 'pessoa_fisica', email: `transfer-${suffix}@example.com`, senha: 'hash', celular: `214${suffix}`, nomeCompleto: 'Responsável Transferência', role: 'funcionario', empresas: [base.company._id] }),
    ]);
    await Product.updateOne({ _id: base.product._id }, { $set: { estoques: [{ deposito: origin._id, quantidade: 8 }, { deposito: destination._id, quantidade: 2 }] } });
    const request = supertest(app());
    const pairing = await request.post(`/desktop/pdvs/${base.pdv._id}/pairing-code`).set('Authorization', 'Bearer test').send();
    const paired = await request.post('/desktop/pair').send({ pairingCode: pairing.body.pairingCode, machineId: 'transfer-host' });
    await Pdv.updateOne({ _id: base.pdv._id }, { $set: { tipoUso: 'executavel', 'desktop.status': 'ativo' } });
    const headers = { 'X-Desktop-Token': paired.body.token };
    const payload = { id: 'local-transfer-1', pdvId: String(base.pdv._id), originCompanyId: String(base.company._id), originDepositId: String(origin._id), destinationCompanyId: String(base.company._id), destinationDepositId: String(destination._id), responsibleId: String(responsible._id), items: [{ productId: String(base.product._id), quantity: 3 }] };
    const event = { eventId: 'transfer-event-1', type: 'transfer.requested', occurredAt: new Date().toISOString(), payload };
    const first = await request.post('/desktop/events/batch').set(headers).send({ events: [event] });
    const replay = await request.post('/desktop/events/batch').set(headers).send({ events: [event] });
    assert.equal(first.body.results[0].status, 'processed');
    assert.equal(replay.body.results[0].replayed, true);
    assert.equal(await Transfer.countDocuments({ desktopTransferId: payload.id }), 1);
    const product = await Product.findById(base.product._id).lean();
    assert.deepEqual(product.estoques.map((entry) => Number(entry.quantidade)), [8, 2]);
    const snapshot = await request.get('/desktop/transfers').set(headers);
    assert.equal(snapshot.status, 200, snapshot.text);
    assert.equal(snapshot.body.transfers[0].desktopTransferId, payload.id);
  });
});
