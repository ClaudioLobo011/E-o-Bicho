const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const supertest = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { MongoMemoryServer } = require('mongodb-memory-server');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'commission-closing-test-secret';

const Appointment = require('../../models/Appointment');
const AccountPayable = require('../../models/AccountPayable');
const AccountingAccount = require('../../models/AccountingAccount');
const BankAccount = require('../../models/BankAccount');
const CommissionClosing = require('../../models/CommissionClosing');
const CommissionItemLock = require('../../models/CommissionItemLock');
const CommissionConfig = require('../../models/CommissionConfig');
const Pet = require('../../models/Pet');
const Pdv = require('../../models/Pdv');
const PdvState = require('../../models/PdvState');
const ProfessionalCommissionConfig = require('../../models/ProfessionalCommissionConfig');
const Product = require('../../models/Product');
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
    comissaoPercent: 1,
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

async function createClosingRequest({ request, headers, fixture, start, end, paymentDate = '', paymentTime = '' }) {
  return request
    .post('/api/admin/comissoes/fechamentos')
    .set(headers)
    .send({
      profissionalId: String(fixture.professional._id),
      storeId: String(fixture.store._id),
      inicio: start,
      fim: end,
      previsaoPagamento: paymentDate || null,
      previsaoPagamentoData: paymentDate,
      previsaoPagamentoHora: paymentTime,
      meioPagamento: paymentDate ? 'pix' : '',
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
      .get(`/api/admin/comissoes/fechamentos/preview?profissionalId=${fixture.professional._id}&${query}&details=1`)
      .set(headers);
    assert.equal(preview.status, 200, preview.text);
    assert.equal(preview.body.periodoInicio, '2026-09-01');
    assert.equal(preview.body.periodoFim, '2026-09-30');
    assert.equal(preview.body.totals.totalServicos, 40);
    assert.equal(preview.body.totals.totalVendas, 0);
    assert.equal(preview.body.totals.totalPeriodo, 40);
    assert.equal(preview.body.eligibility.excludedUnpaid, 2);
    assert.ok(
      preview.body.eligibility.exclusions.some(
        (item) => item.saleCode === 'PDV-TESTE-001' && item.reason === 'Agendamento ainda não pago',
      ),
    );

    const list = await request.get(`/api/admin/comissoes/fechamentos?${query}`).set(headers);
    assert.equal(list.status, 200, list.text);
    const professionalRow = list.body.find(
      (row) => String(row.profissional) === String(fixture.professional._id),
    );
    assert.ok(professionalRow);
    assert.equal(professionalRow.periodoInicio, '2026-09-01');
    assert.equal(professionalRow.periodoFim, '2026-09-30');
    assert.equal(professionalRow.totalServicos, 40);

    const pending = await request
      .get(`/api/admin/comissoes/fechamentos/pendentes?${query}`)
      .set(headers);
    assert.equal(pending.status, 200, pending.text);
    const professionalPending = pending.body.find(
      (row) => String(row.profissional) === String(fixture.professional._id),
    );
    assert.ok(professionalPending);
    assert.equal(professionalPending.pendenteServicos, 40);
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

    const unsafeGenericUpdate = await request
      .put(`/api/admin/comissoes/fechamentos/${created.body.id}`)
      .set(headers)
      .send({ status: 'pago', totalPago: 40 });
    assert.equal(unsafeGenericUpdate.status, 400);
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

  test('relatório estrito não soma itens de 30/07 nem 01/09 e separa fechamento cruzado', async () => {
    const fixture = await createFixture();
    await createAppointment({
      fixture,
      scheduledAt: '2026-07-30T12:00:00.000Z',
      items: [
        { valor: 100, data: '2026-07-30', hora: '10:00', status: 'finalizado' },
        { valor: 100, data: '2026-08-01', hora: '00:05', status: 'finalizado' },
        { valor: 100, data: '2026-08-31', hora: '23:55', status: 'finalizado' },
        { valor: 100, data: '2026-09-01', hora: '00:01', status: 'finalizado' },
      ],
    });
    await CommissionClosing.create({
      profissional: fixture.professional._id,
      store: fixture.store._id,
      periodoInicio: new Date('2026-07-30T03:00:00.000Z'),
      periodoFim: new Date('2026-08-16T02:59:59.999Z'),
      periodoInicioData: '2026-07-30',
      periodoFimData: '2026-08-15',
      totalPeriodo: 999,
      totalPendente: 999,
      status: 'pendente',
      createdBy: fixture.admin._id,
    });

    const request = supertest(createApp());
    const response = await request
      .get(`/api/admin/comissoes/fechamentos/report?store=${fixture.store._id}&start=2026-08-01&end=2026-08-31`)
      .set(authorizationFor(fixture.admin));
    assert.equal(response.status, 200, response.text);
    const row = response.body.items.find(
      (item) => String(item.profissional) === String(fixture.professional._id),
    );
    assert.ok(row);
    assert.equal(row.periodoInicio, '2026-08-01');
    assert.equal(row.periodoFim, '2026-08-31');
    assert.equal(row.totalServicos, 80);
    assert.equal(row.totalPeriodo, 80);
    assert.equal(row.status, 'reconciliacao');
    assert.equal(row.totalPendente, 0);
    assert.equal(response.body.summary.totalExpected, 80);
    assert.equal(response.body.anomalies.crossBoundary, 1);
    assert.equal(response.body.history.length, 1);
    assert.equal(response.body.history[0].crossesSelection, true);
  });

  test('fallback legado converte o fim do dia em São Paulo sem exibir 01/09', async () => {
    const fixture = await createFixture();
    const closing = await CommissionClosing.create({
      profissional: fixture.professional._id,
      store: fixture.store._id,
      periodoInicio: new Date('2026-08-01T03:00:00.000Z'),
      periodoFim: new Date('2026-09-01T02:59:59.999Z'),
      totalPeriodo: 50,
      totalPendente: 50,
      totalServicos: 50,
      pendenteServicos: 50,
      status: 'pendente',
      createdBy: fixture.admin._id,
    });
    await CommissionClosing.collection.updateOne(
      { _id: closing._id },
      { $unset: { periodoInicioData: '', periodoFimData: '' } },
    );
    const request = supertest(createApp());
    const response = await request
      .get(`/api/admin/comissoes/fechamentos/report?store=${fixture.store._id}&start=2026-08-01&end=2026-08-31`)
      .set(authorizationFor(fixture.admin));
    assert.equal(response.status, 200, response.text);
    assert.equal(response.body.history[0].periodoInicio, '2026-08-01');
    assert.equal(response.body.history[0].periodoFim, '2026-08-31');
    assert.equal(response.body.history[0].crossesSelection, false);
    assert.equal(response.body.history[0].legacyPeriod, true);
    assert.equal(response.body.summary.totalExpected, 50);
  });

  test('congela itens do fechamento, impede duplicidade e mantém o resumo imutável', async () => {
    const fixture = await createFixture();
    const appointment = await createAppointment({
      fixture,
      scheduledAt: '2026-09-10T15:00:00.000Z',
      items: [{ valor: 100, data: '2026-09-10', hora: '12:15', status: 'finalizado' }],
    });
    const request = supertest(createApp());
    const headers = authorizationFor(fixture.admin);
    const created = await createClosingRequest({
      request,
      headers,
      fixture,
      start: '2026-09-01',
      end: '2026-09-30',
    });
    assert.equal(created.status, 201, created.text);
    assert.equal(created.body.snapshotItemCount, 1);
    assert.equal(created.body.totalPeriodo, 40);
    assert.equal(await CommissionItemLock.countDocuments({ closing: created.body.id }), 1);

    appointment.itens[0].valor = 900;
    appointment.itens[0].data = '2026-10-01';
    appointment.itens[0].status = 'agendado';
    appointment.pago = false;
    await appointment.save();

    const details = await request
      .get(`/api/admin/comissoes/fechamentos/${created.body.id}/details`)
      .set(headers);
    assert.equal(details.status, 200, details.text);
    assert.equal(details.body.immutable, true);
    assert.equal(details.body.items.length, 1);
    assert.equal(details.body.items[0].date, '2026-09-10');
    assert.equal(details.body.items[0].time, '12:15');
    assert.equal(details.body.items[0].value, 100);
    assert.equal(details.body.items[0].commission, 40);

    const duplicate = await createClosingRequest({
      request,
      headers,
      fixture,
      start: '2026-09-01',
      end: '2026-09-30',
    });
    assert.equal(duplicate.status, 422, duplicate.text);
    assert.equal(duplicate.body.code, 'NO_PAYABLE_COMMISSION_ITEMS');
    assert.equal(await CommissionClosing.countDocuments({}), 1);
  });

  test('pagamento exige confirmação, valor integral, acesso à empresa e sincroniza contas a pagar', async () => {
    const fixture = await createFixture();
    await createAppointment({
      fixture,
      scheduledAt: '2026-09-10T15:00:00.000Z',
      items: [{ valor: 100, data: '2026-09-10', hora: '12:15', status: 'finalizado' }],
    });
    const request = supertest(createApp());
    const headers = authorizationFor(fixture.admin);
    const created = await createClosingRequest({
      request,
      headers,
      fixture,
      start: '2026-09-01',
      end: '2026-09-30',
      paymentDate: '2026-10-05',
      paymentTime: '09:30',
    });
    assert.equal(created.status, 201, created.text);

    const noConfirmation = await request
      .post(`/api/admin/comissoes/fechamentos/${created.body.id}/pay`)
      .set(headers)
      .send({ paymentDate: '2026-10-06', paymentTime: '14:20', paymentMethod: 'pix' });
    assert.equal(noConfirmation.status, 400);

    const wrongAmount = await request
      .post(`/api/admin/comissoes/fechamentos/${created.body.id}/pay`)
      .set(headers)
      .send({
        confirm: true,
        amount: 39.99,
        paymentDate: '2026-10-06',
        paymentTime: '14:20',
        paymentMethod: 'pix',
      });
    assert.equal(wrongAmount.status, 400);
    assert.equal(wrongAmount.body.expectedAmount, 40);

    const suffix = String(Date.now()).slice(-9);
    const otherStore = await Store.create({
      codigo: `OUT-${suffix}`,
      nome: 'Outra Loja',
      cnpj: `98${suffix}`.padEnd(14, '0').slice(0, 14),
    });
    const scopedAdmin = await User.create({
      tipoConta: 'pessoa_fisica',
      email: `admin-scoped-${suffix}@example.com`,
      senha: 'hash',
      celular: `2160${suffix}`.slice(0, 13),
      nomeCompleto: 'Admin Outra Loja',
      role: 'admin',
      empresas: [otherStore._id],
    });
    const forbidden = await request
      .post(`/api/admin/comissoes/fechamentos/${created.body.id}/pay`)
      .set(authorizationFor(scopedAdmin))
      .send({
        confirm: true,
        amount: 40,
        paymentDate: '2026-10-06',
        paymentTime: '14:20',
        paymentMethod: 'pix',
      });
    assert.equal(forbidden.status, 403, forbidden.text);

    const paid = await request
      .post(`/api/admin/comissoes/fechamentos/${created.body.id}/pay`)
      .set(headers)
      .send({
        confirm: true,
        amount: 40,
        paymentDate: '2026-10-06',
        paymentTime: '14:20',
        paymentMethod: 'pix',
      });
    assert.equal(paid.status, 200, paid.text);
    assert.equal(paid.body.status, 'pago');
    assert.equal(paid.body.totalPago, 40);
    assert.equal(paid.body.totalPendente, 0);
    assert.equal(paid.body.paidDate, '2026-10-06');
    assert.equal(paid.body.paidTime, '14:20');

    const closing = await CommissionClosing.findById(created.body.id);
    const payable = await AccountPayable.findById(closing.payable);
    assert.ok(payable);
    assert.equal(payable.totalValue, 40);
    assert.equal(payable.installments.length, 1);
    assert.equal(payable.installments[0].status, 'paid');
    assert.equal(payable.installments[0].value, 40);

    const report = await request
      .get(`/api/admin/comissoes/fechamentos/report?store=${fixture.store._id}&start=2026-10-01&end=2026-10-31`)
      .set(headers);
    assert.equal(report.status, 200, report.text);
    assert.equal(report.body.summary.paymentsMade, 40);
    assert.equal(report.body.summary.lastPaymentDate, '2026-10-06');
    assert.equal(report.body.summary.lastPaymentTime, '14:20');
  });

  test('cancelamento é auditável, não apaga o fechamento e libera os itens', async () => {
    const fixture = await createFixture();
    await createAppointment({
      fixture,
      scheduledAt: '2026-09-12T15:00:00.000Z',
      items: [{ valor: 100, data: '2026-09-12', hora: '11:00', status: 'finalizado' }],
    });
    const request = supertest(createApp());
    const headers = authorizationFor(fixture.admin);
    const created = await createClosingRequest({
      request,
      headers,
      fixture,
      start: '2026-09-01',
      end: '2026-09-30',
    });
    assert.equal(created.status, 201, created.text);

    const physicalDelete = await request
      .delete(`/api/admin/comissoes/fechamentos/${created.body.id}`)
      .set(headers);
    assert.equal(physicalDelete.status, 405);

    const shortReason = await request
      .post(`/api/admin/comissoes/fechamentos/${created.body.id}/cancel`)
      .set(headers)
      .send({ confirm: true, reason: 'erro' });
    assert.equal(shortReason.status, 400);

    const cancelled = await request
      .post(`/api/admin/comissoes/fechamentos/${created.body.id}/cancel`)
      .set(headers)
      .send({ confirm: true, reason: 'Período selecionado incorretamente' });
    assert.equal(cancelled.status, 200, cancelled.text);
    const closing = await CommissionClosing.findById(created.body.id);
    assert.ok(closing);
    assert.equal(closing.status, 'cancelado');
    assert.equal(closing.cancellationReason, 'Período selecionado incorretamente');
    assert.equal(closing.auditTrail.at(-1).action, 'cancelled');
    assert.equal(await CommissionItemLock.countDocuments({ closing: closing._id }), 0);
    const payable = await AccountPayable.findById(closing.payable);
    assert.equal(payable.installments[0].status, 'cancelled');

    const preview = await request
      .get(`/api/admin/comissoes/fechamentos/preview?profissionalId=${fixture.professional._id}&store=${fixture.store._id}&start=2026-09-01&end=2026-09-30&details=1`)
      .set(headers);
    assert.equal(preview.status, 200, preview.text);
    assert.equal(preview.body.totals.totalPeriodo, 40);
    assert.equal(preview.body.items.length, 1);
  });

  test('falha de contas a pagar desfaz fechamento e locks em vez de retornar sucesso parcial', async () => {
    const fixture = await createFixture();
    await CommissionConfig.deleteOne({ store: fixture.store._id });
    await createAppointment({
      fixture,
      scheduledAt: '2026-09-18T15:00:00.000Z',
      items: [{ valor: 100, data: '2026-09-18', hora: '10:00', status: 'finalizado' }],
    });
    const request = supertest(createApp());
    const response = await createClosingRequest({
      request,
      headers: authorizationFor(fixture.admin),
      fixture,
      start: '2026-09-01',
      end: '2026-09-30',
    });
    assert.equal(response.status, 422, response.text);
    assert.equal(response.body.code, 'PAYABLE_SYNC_FAILED');
    assert.equal(await CommissionClosing.countDocuments({}), 0);
    assert.equal(await CommissionItemLock.countDocuments({}), 0);
    assert.equal(await AccountPayable.countDocuments({}), 0);
  });

  test('duplo clique concorrente não cria dois fechamentos para os mesmos itens', async () => {
    const fixture = await createFixture();
    await CommissionItemLock.syncIndexes();
    await createAppointment({
      fixture,
      scheduledAt: '2026-09-20T15:00:00.000Z',
      items: [{ valor: 100, data: '2026-09-20', hora: '10:00', status: 'finalizado' }],
    });
    const request = supertest(createApp());
    const headers = authorizationFor(fixture.admin);
    const [first, second] = await Promise.all([
      createClosingRequest({ request, headers, fixture, start: '2026-09-01', end: '2026-09-30' }),
      createClosingRequest({ request, headers, fixture, start: '2026-09-01', end: '2026-09-30' }),
    ]);
    const statuses = [first.status, second.status].sort((a, b) => a - b);
    assert.equal(statuses[0], 201, `${first.text}\n${second.text}`);
    assert.ok([409, 422].includes(statuses[1]), `${first.text}\n${second.text}`);
    assert.equal(await CommissionClosing.countDocuments({ status: { $ne: 'cancelado' } }), 1);
    assert.equal(await CommissionItemLock.countDocuments({}), 1);
    assert.equal(await AccountPayable.countDocuments({}), 1);
  });

  test('com agenda e PDV ativos não duplica o serviço vendido no caixa', async () => {
    const fixture = await createFixture();
    await CommissionConfig.updateOne(
      { store: fixture.store._id },
      { $set: { includeServices: true, includePdvSales: true } },
    );
    await createAppointment({
      fixture,
      scheduledAt: '2026-09-22T15:00:00.000Z',
      items: [{ valor: 100, data: '2026-09-22', hora: '10:00', status: 'finalizado' }],
    });
    const suffix = String(Date.now()).slice(-9);
    const product = await Product.create({
      cod: `PROD-${suffix}`,
      codbarras: `789${suffix}`,
      nome: 'Produto comissão',
      custo: 50,
      venda: 100,
    });
    const pdv = await Pdv.create({
      codigo: `PDV-${suffix}`,
      nome: 'PDV Comissão',
      empresa: fixture.store._id,
    });
    await PdvState.create({
      pdv: pdv._id,
      empresa: fixture.store._id,
      completedSales: [
        {
          id: `SALE-${suffix}`,
          saleCode: `V-${suffix}`,
          seller: { _id: String(fixture.professional._id), nome: fixture.professional.nomeCompleto },
          sellerName: fixture.professional.nomeCompleto,
          status: 'pago',
          createdAt: new Date('2026-09-22T16:00:00.000Z'),
          items: [
            { productId: product._id, nome: product.nome, quantidade: 1, valorUnitario: 100 },
            { servico: fixture.service._id, nome: fixture.service.nome, quantidade: 1, valorUnitario: 100 },
          ],
          total: 200,
        },
      ],
    });

    const request = supertest(createApp());
    const preview = await request
      .get(`/api/admin/comissoes/fechamentos/preview?profissionalId=${fixture.professional._id}&store=${fixture.store._id}&start=2026-09-01&end=2026-09-30&details=1`)
      .set(authorizationFor(fixture.admin));
    assert.equal(preview.status, 200, preview.text);
    assert.equal(preview.body.totals.totalServicos, 40);
    assert.equal(preview.body.totals.totalVendas, 1);
    assert.equal(preview.body.totals.totalPeriodo, 41);
    assert.equal(preview.body.items.filter((item) => item.source === 'appointment_service').length, 1);
    assert.equal(preview.body.items.filter((item) => item.source === 'pdv_product').length, 1);
  });
});
