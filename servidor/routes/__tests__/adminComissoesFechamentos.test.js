const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const supertest = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { MongoMemoryServer } = require('mongodb-memory-server');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'commission-closing-test-secret';

const Appointment = require('../../models/Appointment');
const AccountingAccount = require('../../models/AccountingAccount');
const BankAccount = require('../../models/BankAccount');
const CommissionClosing = require('../../models/CommissionClosing');
const CommissionConfig = require('../../models/CommissionConfig');
const Pet = require('../../models/Pet');
const ProfessionalCommissionConfig = require('../../models/ProfessionalCommissionConfig');
const Service = require('../../models/Service');
const ServiceGroup = require('../../models/ServiceGroup');
const Store = require('../../models/Store');
const User = require('../../models/User');
const UserGroup = require('../../models/UserGroup');
const router = require('../../routes/adminComissoesFechamentos');

let mongo;

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', router);
  return app;
}

function authorizationFor(user) {
  const token = jwt.sign({ id: String(user._id) }, process.env.JWT_SECRET, { expiresIn: '1h' });
  return { Authorization: `Bearer ${token}` };
}

async function createFixture() {
  const suffix = String(Date.now()).slice(-9);
  const store = await Store.create({
    codigo: `COM-${suffix}`,
    nome: 'Loja Comissão Agenda',
    nomeFantasia: 'Loja Comissão Agenda',
    cnpj: `12${suffix}`.padEnd(14, '0').slice(0, 14),
  });
  const admin = await User.create({
    tipoConta: 'pessoa_fisica',
    email: `admin-comissao-${suffix}@example.com`,
    senha: 'hash',
    celular: `2190${suffix}`.slice(0, 13),
    nomeCompleto: 'Admin Comissão',
    role: 'admin_master',
  });
  const group = await UserGroup.create({
    codigo: Number(suffix.slice(-6)) || 1,
    nome: `Profissionais ${suffix}`,
    comissaoServicoPercent: 10,
  });
  const professional = await User.create({
    tipoConta: 'pessoa_fisica',
    email: `profissional-comissao-${suffix}@example.com`,
    senha: 'hash',
    celular: `2180${suffix}`.slice(0, 13),
    nomeCompleto: 'Profissional Comissão',
    role: 'funcionario',
    grupos: ['esteticista'],
    empresas: [store._id],
    userGroup: group._id,
  });
  const customer = await User.create({
    tipoConta: 'pessoa_fisica',
    email: `cliente-comissao-${suffix}@example.com`,
    senha: 'hash',
    celular: `2170${suffix}`.slice(0, 13),
    nomeCompleto: 'Cliente Comissão',
    role: 'cliente',
    empresaPrincipal: store._id,
  });
  const pet = await Pet.create({
    owner: customer._id,
    nome: 'Bidu',
    tipo: 'cachorro',
    raca: 'vira-lata',
    sexo: 'macho',
  });
  const serviceGroup = await ServiceGroup.create({
    nome: `Banho Comissão ${suffix}`,
    tiposPermitidos: ['esteticista'],
    comissaoPercent: 5,
  });
  const service = await Service.create({
    nome: `Serviço Comissão ${suffix}`,
    grupo: serviceGroup._id,
    duracaoMinutos: 60,
    valor: 100,
    porte: ['Todos'],
    ativo: true,
  });
  await ProfessionalCommissionConfig.create({
    user: professional._id,
    professionalType: 'esteticista',
    serviceRules: [{ service: service._id, percent: 40 }],
  });
  const accountingAccount = await AccountingAccount.create({
    companies: [store._id],
    name: 'Comissões a pagar',
    code: `CP-${suffix}`,
    type: 'analitica',
    paymentNature: 'contas_pagar',
  });
  const bankAccount = await BankAccount.create({
    company: store._id,
    bankCode: '001',
    bankName: 'Banco Teste',
    agency: '1234',
    accountNumber: suffix,
    accountType: 'corrente',
    documentNumber: '12345678901',
  });
  await CommissionConfig.create({
    store: store._id,
    accountingAccount: accountingAccount._id,
    bankAccount: bankAccount._id,
    includeServices: true,
    includePdvSales: false,
    createdBy: admin._id,
    updatedBy: admin._id,
  });
  return { store, admin, professional, customer, pet, service };
}

async function createAppointment({
  fixture,
  scheduledAt,
  paid = true,
  saleCode = '',
  items,
}) {
  return Appointment.create({
    store: fixture.store._id,
    cliente: fixture.customer._id,
    pet: fixture.pet._id,
    servico: fixture.service._id,
    profissional: fixture.professional._id,
    scheduledAt: new Date(scheduledAt),
    valor: items.reduce((sum, item) => sum + Number(item.valor || 0), 0),
    pago: paid,
    codigoVenda: saleCode,
    status: 'agendado',
    itens: items.map((item) => ({
      servico: fixture.service._id,
      profissional: fixture.professional._id,
      ...item,
    })),
  });
}

test.describe('fechamento de comissões por data literal do agendamento', () => {
  test.before(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri(), { dbName: 'admin-commission-closing-test' });
  });

  test.after(async () => {
    await mongoose.disconnect();
    if (mongo) await mongo.stop();
  });

  test.beforeEach(async () => {
    await mongoose.connection.db.dropDatabase();
  });

  test('usa itens.data/hora, filtra cada item e só soma serviços finalizados e pagos', async () => {
    const fixture = await createFixture();

    await createAppointment({
      fixture,
      // Deliberadamente fora do período: o relatório não pode usar este campo do MongoDB.
      scheduledAt: '2026-08-31T12:00:00.000Z',
      items: [
        { valor: 100, data: '2026-08-31', hora: '23:50', status: 'finalizado' },
        { valor: 100, data: '2026-09-01', hora: '00:15', status: 'finalizado' },
        { valor: 100, data: '2026-09-02', hora: '08:00', status: 'agendado' },
      ],
    });
    await createAppointment({
      fixture,
      scheduledAt: '2026-09-10T12:00:00.000Z',
      paid: false,
      items: [{ valor: 100, data: '2026-09-10', hora: '09:00', status: 'finalizado' }],
    });
    await createAppointment({
      fixture,
      // Deliberadamente dentro do período, mas o item informado no formulário está fora.
      scheduledAt: '2026-09-15T12:00:00.000Z',
      items: [{ valor: 100, data: '2026-10-01', hora: '09:00', status: 'finalizado' }],
    });
    await createAppointment({
      fixture,
      scheduledAt: '2026-08-01T12:00:00.000Z',
      paid: false,
      saleCode: 'PDV-TESTE-001',
      items: [{ valor: 50, data: '2026-09-30', hora: '23:45', status: 'finalizado' }],
    });

    const request = supertest(createApp());
    const headers = authorizationFor(fixture.admin);
    const query = `start=2026-09-01&end=2026-09-30&store=${fixture.store._id}`;

    const preview = await request
      .get(`/api/admin/comissoes/fechamentos/preview?profissionalId=${fixture.professional._id}&${query}`)
      .set(headers);
    assert.equal(preview.status, 200, preview.text);
    assert.equal(preview.body.periodoInicio, '2026-09-01');
    assert.equal(preview.body.periodoFim, '2026-09-30');
    assert.equal(preview.body.totals.totalServicos, 60);
    assert.equal(preview.body.totals.totalVendas, 0);
    assert.equal(preview.body.totals.totalPeriodo, 60);

    const list = await request.get(`/api/admin/comissoes/fechamentos?${query}`).set(headers);
    assert.equal(list.status, 200, list.text);
    const professionalRow = list.body.find(
      (row) => String(row.profissional) === String(fixture.professional._id),
    );
    assert.ok(professionalRow);
    assert.equal(professionalRow.periodoInicio, '2026-09-01');
    assert.equal(professionalRow.periodoFim, '2026-09-30');
    assert.equal(professionalRow.totalServicos, 60);

    const pending = await request
      .get(`/api/admin/comissoes/fechamentos/pendentes?${query}`)
      .set(headers);
    assert.equal(pending.status, 200, pending.text);
    const professionalPending = pending.body.find(
      (row) => String(row.profissional) === String(fixture.professional._id),
    );
    assert.ok(professionalPending);
    assert.equal(professionalPending.pendenteServicos, 60);
  });

  test('preserva literalmente período e hora do formulário e usa os mesmos dados no resumo', async () => {
    const fixture = await createFixture();
    await createAppointment({
      fixture,
      scheduledAt: '2026-08-31T21:15:00.000Z',
      items: [
        { valor: 100, data: '2026-09-01', hora: '00:15', status: 'finalizado' },
        { valor: 50, data: '2026-09-30', hora: '23:45', status: 'finalizado' },
      ],
    });

    const request = supertest(createApp());
    const headers = authorizationFor(fixture.admin);
    const created = await request
      .post('/api/admin/comissoes/fechamentos')
      .set(headers)
      .send({
        profissionalId: String(fixture.professional._id),
        storeId: String(fixture.store._id),
        inicio: '2026-09-01',
        fim: '2026-09-30',
        previsaoPagamento: '2026-10-05',
        previsaoPagamentoData: '2026-10-05',
        previsaoPagamentoHora: '21:45',
        meioPagamento: 'pix',
      });
    assert.equal(created.status, 201, created.text);
    assert.equal(created.body.periodoInicio, '2026-09-01');
    assert.equal(created.body.periodoFim, '2026-09-30');
    assert.equal(created.body.previsaoPagamentoData, '2026-10-05');
    assert.equal(created.body.previsaoPagamentoHora, '21:45');
    assert.equal(created.body.totalServicos, 60);

    const closing = await CommissionClosing.findById(created.body.id);
    assert.equal(closing.periodoInicioData, '2026-09-01');
    assert.equal(closing.periodoFimData, '2026-09-30');
    assert.equal(closing.previsaoPagamentoData, '2026-10-05');
    assert.equal(closing.previsaoPagamentoHora, '21:45');
    assert.equal(closing.periodoInicio.toISOString(), '2026-09-01T03:00:00.000Z');
    assert.equal(closing.previsaoPagamento.toISOString(), '2026-10-06T00:45:00.000Z');

    closing.status = 'pago';
    closing.totalPago = closing.totalPeriodo;
    closing.totalPendente = 0;
    await closing.save();

    const summary = await request
      .get(`/api/admin/comissoes/fechamentos/${closing._id}/resumo-servicos`)
      .set(headers);
    assert.equal(summary.status, 200, summary.text);
    assert.equal(summary.body.periodoInicio, '2026-09-01');
    assert.equal(summary.body.periodoFim, '2026-09-30');
    assert.deepEqual(
      summary.body.rows.map((row) => row.data),
      ['01/09/2026 00:15', '30/09/2026 23:45'],
    );
    assert.equal(summary.body.totals.itens, 2);
    assert.equal(summary.body.totals.valor, 150);
    assert.equal(summary.body.totals.comissao, 60);
  });
});
