const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const supertest = require('supertest');
const mongoose = require('mongoose');
const path = require('node:path');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

const Store = require('../../models/Store');
const User = require('../../models/User');
const Pet = require('../../models/Pet');
const ServiceGroup = require('../../models/ServiceGroup');
const Service = require('../../models/Service');
const Appointment = require('../../models/Appointment');
const BankAccount = require('../../models/BankAccount');
const AccountingAccount = require('../../models/AccountingAccount');
const PaymentMethod = require('../../models/PaymentMethod');
const AccountReceivable = require('../../models/AccountReceivable');
const Pdv = require('../../models/Pdv');
const PdvState = require('../../models/PdvState');

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

const accountsReceivableRouter = require('../../routes/accountsReceivable');
const funcAgendaRouter = require('../../routes/funcAgenda');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/accounts-receivable', accountsReceivableRouter);
  app.use('/func', funcAgendaRouter);
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

  const customer = await User.create({
    tipoConta: 'pessoa_fisica',
    email: `cliente-${Date.now()}@example.com`,
    senha: 'hash',
    celular: `1188${String(Date.now()).slice(-7)}`,
    nomeCompleto: 'Cliente Teste',
    cpf: `${Date.now()}`.slice(-11),
    role: 'cliente',
    empresaPrincipal: company._id,
  });

  const pet = await Pet.create({
    owner: customer._id,
    nome: 'Pet Teste',
    tipo: 'cachorro',
    raca: 'vira-lata',
    sexo: 'macho',
    dataNascimento: new Date('2022-01-01T00:00:00Z'),
  });

  const serviceGroup = await ServiceGroup.create({
    nome: `Banho e Tosa ${Date.now()}`,
    tiposPermitidos: ['esteticista'],
    comissaoPercent: 10,
  });

  const service = await Service.create({
    nome: `Banho ${Date.now()}`,
    grupo: serviceGroup._id,
    duracaoMinutos: 60,
    valor: 80,
    categorias: ['banho'],
    porte: ['Todos'],
  });

  const bankAccount = await BankAccount.create({
    company: company._id,
    bankCode: '001',
    bankName: 'Banco Teste',
    agency: '1234',
    accountNumber: `${Date.now()}`.slice(-6),
    accountDigit: '1',
    accountType: 'corrente',
    documentNumber: customer.cpf,
    alias: 'Conta Teste',
  });

  const accountingAccount = await AccountingAccount.create({
    companies: [company._id],
    name: 'Contas a Receber Teste',
    code: `ACR-${Date.now()}`,
    type: 'analitica',
    accountingOrigin: 'ativo',
    paymentNature: 'contas_receber',
  });

  const paymentMethod = await PaymentMethod.create({
    company: company._id,
    code: `PM-${Date.now()}`,
    name: 'Crediario Teste',
    type: 'crediario',
    installments: 1,
    accountingAccount: accountingAccount._id,
    bankAccount: bankAccount._id,
  });

  const pdv = await Pdv.create({
    codigo: `PDV-${Date.now()}`,
    nome: 'Caixa Teste',
    empresa: company._id,
  });

  return {
    company,
    admin,
    customer,
    pet,
    service,
    bankAccount,
    accountingAccount,
    paymentMethod,
    pdv,
  };
}

async function createAppointmentFixture(base, saleCode, scheduleOffsetMinutes = 0) {
  return Appointment.create({
    store: base.company._id,
    cliente: base.customer._id,
    pet: base.pet._id,
    servico: base.service._id,
    itens: [
      {
        servico: base.service._id,
        valor: 80,
        status: 'em_atendimento',
      },
    ],
    scheduledAt: new Date(Date.now() + scheduleOffsetMinutes * 60 * 1000),
    valor: 80,
    pago: false,
    codigoVenda: '',
    status: 'em_atendimento',
    observacoes: `Venda ${saleCode}`,
    createdBy: base.admin._id,
  });
}

function buildReceivablePayload(base, saleCode, paymentSuffix = 1) {
  return {
    company: String(base.company._id),
    customer: String(base.customer._id),
    bankAccount: String(base.bankAccount._id),
    accountingAccount: String(base.accountingAccount._id),
    paymentMethod: String(base.paymentMethod._id),
    issueDate: '2026-03-02T10:00:00.000Z',
    dueDate: '2026-03-02T10:00:00.000Z',
    totalValue: 80,
    installmentsCount: 1,
    installmentsData: [
      {
        number: 1,
        dueDate: '2026-03-02T10:00:00.000Z',
        bankAccount: String(base.bankAccount._id),
        value: 80,
      },
    ],
    documentNumber: `PDV-${saleCode}-${paymentSuffix}`,
    notes: `Codigo da venda: ${saleCode}`,
    locked: true,
    origin: 'pdv-sale',
    originReference: `${saleCode}:payment-${paymentSuffix}`,
  };
}

test.describe('PDV isolated concurrency checks', () => {
  test.before(async () => {
    mongo = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    await mongoose.connect(mongo.getUri(), { dbName: 'pdv-concurrency-test' });
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

  test('creates two simultaneous receivables with unique automatic codes and correct sale references', async () => {
    const base = await createBaseFixture();
    const app = createApp();
    const request = supertest(app);

    const saleCodeA = 'PDV001-000201';
    const saleCodeB = 'PDV001-000202';

    const [responseA, responseB] = await Promise.all([
      request
        .post('/accounts-receivable')
        .set('Authorization', 'Bearer token')
        .send(buildReceivablePayload(base, saleCodeA, 1)),
      request
        .post('/accounts-receivable')
        .set('Authorization', 'Bearer token')
        .send(buildReceivablePayload(base, saleCodeB, 1)),
    ]);

    assert.equal(responseA.status, 201, responseA.text);
    assert.equal(responseB.status, 201, responseB.text);
    assert.notEqual(responseA.body.code, responseB.body.code);

    const receivables = await AccountReceivable.find({}).sort({ code: 1 }).lean();
    assert.equal(receivables.length, 2);

    const documents = receivables.map((entry) => entry.documentNumber).sort();
    assert.deepEqual(documents, [
      `PDV-${saleCodeA}-1`,
      `PDV-${saleCodeB}-1`,
    ].sort());

    const notes = receivables.map((entry) => entry.notes || '').join('\n');
    assert.match(notes, new RegExp(saleCodeA));
    assert.match(notes, new RegExp(saleCodeB));
  });

  test('marks service appointments as paid and reverts them cleanly on cancellation', async () => {
    const base = await createBaseFixture();
    const appointmentA = await createAppointmentFixture(base, 'PDV001-000301', 0);
    const appointmentB = await createAppointmentFixture(base, 'PDV001-000302', 30);

    const app = createApp();
    const request = supertest(app);

    const saleCodeA = 'PDV001-000301';
    const saleCodeB = 'PDV001-000302';

    const [receivableA, receivableB] = await Promise.all([
      request
        .post('/accounts-receivable')
        .set('Authorization', 'Bearer token')
        .send(buildReceivablePayload(base, saleCodeA, 1)),
      request
        .post('/accounts-receivable')
        .set('Authorization', 'Bearer token')
        .send(buildReceivablePayload(base, saleCodeB, 1)),
    ]);

    assert.equal(receivableA.status, 201, receivableA.text);
    assert.equal(receivableB.status, 201, receivableB.text);

    const [markA, markB] = await Promise.all([
      request
        .put(`/func/agendamentos/${appointmentA._id}`)
        .set('Authorization', 'Bearer token')
        .send({ codigoVenda: saleCodeA, pago: true, status: 'finalizado' }),
      request
        .put(`/func/agendamentos/${appointmentB._id}`)
        .set('Authorization', 'Bearer token')
        .send({ codigoVenda: saleCodeB, pago: true, status: 'finalizado' }),
    ]);

    assert.equal(markA.status, 200, markA.text);
    assert.equal(markB.status, 200, markB.text);

    let updatedAppointments = await Appointment.find({ _id: { $in: [appointmentA._id, appointmentB._id] } })
      .sort({ codigoVenda: 1 })
      .lean();
    assert.equal(updatedAppointments.length, 2);
    updatedAppointments.forEach((appointment) => {
      assert.equal(appointment.pago, true);
      assert.equal(appointment.status, 'finalizado');
      assert.ok(appointment.codigoVenda === saleCodeA || appointment.codigoVenda === saleCodeB);
    });

    const [cancelReceivableA, cancelReceivableB] = await Promise.all([
      request
        .delete(`/accounts-receivable/${receivableA.body._id}`)
        .set('Authorization', 'Bearer token'),
      request
        .delete(`/accounts-receivable/${receivableB.body._id}`)
        .set('Authorization', 'Bearer token'),
    ]);

    assert.equal(cancelReceivableA.status, 204, cancelReceivableA.text);
    assert.equal(cancelReceivableB.status, 204, cancelReceivableB.text);

    const [revertA, revertB] = await Promise.all([
      request
        .put(`/func/agendamentos/${appointmentA._id}`)
        .set('Authorization', 'Bearer token')
        .send({ codigoVenda: '', pago: false, status: 'em_atendimento' }),
      request
        .put(`/func/agendamentos/${appointmentB._id}`)
        .set('Authorization', 'Bearer token')
        .send({ codigoVenda: '', pago: false, status: 'em_atendimento' }),
    ]);

    assert.equal(revertA.status, 200, revertA.text);
    assert.equal(revertB.status, 200, revertB.text);

    updatedAppointments = await Appointment.find({ _id: { $in: [appointmentA._id, appointmentB._id] } })
      .sort({ createdAt: 1 })
      .lean();
    updatedAppointments.forEach((appointment) => {
      assert.equal(appointment.pago, false);
      assert.equal(appointment.codigoVenda || '', '');
      assert.equal(appointment.status, 'em_atendimento');
    });

    const remainingReceivables = await AccountReceivable.countDocuments({});
    assert.equal(remainingReceivables, 0);
  });

  test('persists appointment linkage in PDV state completed sales', async () => {
    const base = await createBaseFixture();
    const appointmentA = await createAppointmentFixture(base, 'PDV001-000401', 0);
    const appointmentB = await createAppointmentFixture(base, 'PDV001-000402', 30);

    await PdvState.create({
      pdv: base.pdv._id,
      empresa: base.company._id,
      completedSales: [
        {
          id: 'sale-test-1',
          type: 'venda',
          saleCode: 'PDV001-000401',
          saleCodeLabel: 'PDV001-000401',
          customerName: base.customer.nomeCompleto,
          customerDocument: base.customer.cpf,
          total: 80,
          totalLiquido: 80,
          totalBruto: 80,
          status: 'completed',
          appointmentId: String(appointmentA._id),
          appointmentIds: [String(appointmentA._id), String(appointmentB._id)],
        },
      ],
    });

    const persistedState = await PdvState.findOne({ pdv: base.pdv._id }).lean();
    assert.ok(persistedState);
    assert.equal(persistedState.completedSales.length, 1);
    assert.equal(
      persistedState.completedSales[0].appointmentId,
      String(appointmentA._id)
    );
    assert.deepEqual(
      persistedState.completedSales[0].appointmentIds.map(String).sort(),
      [String(appointmentA._id), String(appointmentB._id)].sort()
    );
  });
});
