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
const UserGroup = require('../../models/UserGroup');
const ServiceGroup = require('../../models/ServiceGroup');
const Service = require('../../models/Service');
const ProfessionalCommissionConfig = require('../../models/ProfessionalCommissionConfig');
const router = require('../../routes/pdvDesktop');
const { encryptBuffer, encryptText } = require('../../utils/certificates');

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
    const appointmentMutationId = `appointment-cloud-alias-${suffix}`;
    const appointment = await Appointment.create({ store: base.company._id, cliente: customer._id, pet: pet._id, scheduledAt: new Date(Date.now() + 3600000), valor: 20, status: 'em_atendimento', observacoes: 'Atendimento do teste desktop', clientMutationId: appointmentMutationId });
    await UserAddress.create({ user: customer._id, cep: '20000000', logradouro: 'Rua Desktop', numero: '10', cidade: 'Rio de Janeiro', uf: 'RJ', isDefault: true });
    await User.create({ tipoConta: 'pessoa_fisica', email: `desktop-seller-${suffix}@example.com`, senha: 'hash', celular: `218${suffix}`, nomeCompleto: 'Vendedor Desktop', role: 'funcionario', grupos: ['vendedor'], empresas: [base.company._id], codigoCliente: 987654 });
    const courier = await User.create({ tipoConta: 'pessoa_fisica', email: `desktop-courier-${suffix}@example.com`, senha: 'hash', celular: `216${suffix}`, nomeCompleto: 'Entregador Desktop', role: 'funcionario', grupos: ['entregador'], empresas: [base.company._id], codigoCliente: 123456 });
    const employeeGroup = await UserGroup.create({ codigo: 9001, nome: 'Esteticistas Desktop', comissaoServicoPercent: 15 });
    const serviceGroup = await ServiceGroup.create({ nome: 'Banho Desktop', tiposPermitidos: ['esteticista'], comissaoPercent: 25 });
    const service = await Service.create({ nome: 'Banho Comissão Desktop', grupo: serviceGroup._id, duracaoMinutos: 60, valor: 100, porte: ['Todos'], ativo: true });
    const professional = await User.create({ tipoConta: 'pessoa_fisica', email: `desktop-professional-${suffix}@example.com`, senha: 'hash', celular: `214${suffix}`, nomeCompleto: 'Paulo Desktop', role: 'funcionario', grupos: ['esteticista'], empresas: [base.company._id], userGroup: employeeGroup._id });
    await ProfessionalCommissionConfig.create({ user: professional._id, professionalType: 'esteticista', groupRules: [{ group: serviceGroup._id, percent: 30 }], serviceRules: [{ service: service._id, percent: 40 }] });
    const otherCompany = await Store.create({ codigo: `OUTRA-${Date.now()}`, nome: 'Outra Loja', nomeFantasia: 'Outra Loja', cnpj: `9${Date.now()}`.slice(-14) });
    const sharedCustomer = await User.create({ tipoConta: 'pessoa_fisica', email: `desktop-shared-${suffix}@example.com`, senha: 'hash', celular: `217${suffix}`, nomeCompleto: 'Cliente de Outra Loja', cpf: `987${suffix}`, role: 'cliente', empresaPrincipal: otherCompany._id });
    const sharedPet = await Pet.create({ owner: sharedCustomer._id, nome: 'Pet Compartilhado', tipo: 'cachorro', raca: 'vira-lata', sexo: 'macho', dataNascimento: new Date('2023-01-01T00:00:00Z') });
    await UserAddress.create({ user: sharedCustomer._id, cep: '21000000', logradouro: 'Rua Compartilhada', numero: '20', cidade: 'Rio de Janeiro', uf: 'RJ', isDefault: true });
    await User.create({ tipoConta: 'pessoa_fisica', email: `desktop-other-seller-${suffix}@example.com`, senha: 'hash', celular: `215${suffix}`, nomeCompleto: 'Vendedor de Outra Loja', role: 'funcionario', grupos: ['vendedor'], empresas: [otherCompany._id], codigoCliente: 654321 });
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
    assert.equal(directory.body.customers.find((entry) => entry.name === 'Cliente de Outra Loja').address.street, 'Rua Compartilhada');
    assert.equal(directory.body.pets.find((entry) => entry.name === 'Bidu').ownerId, String(customer._id));
    assert.equal(directory.body.pets.find((entry) => entry.name === 'Bidu').type, 'cachorro');
    assert.equal(directory.body.pets.find((entry) => entry.name === 'Bidu').species, 'cachorro');
    assert.equal(directory.body.pets.find((entry) => entry.name === 'Bidu').deceased, false);
    assert.equal(directory.body.pets.find((entry) => entry.name === 'Pet Compartilhado').ownerId, String(sharedCustomer._id));
    assert.equal(directory.body.sellers.find((entry) => entry.name === 'Vendedor Desktop').code, '987654');
    assert.equal(directory.body.sellers.some((entry) => entry.name === 'Vendedor de Outra Loja'), false);
    assert.equal(directory.body.couriers.find((entry) => entry.name === 'Entregador Desktop').code, '123456');
    const directoryProfessional = directory.body.professionals.find((entry) => entry.name === 'Paulo Desktop');
    assert.equal(directoryProfessional.commission.fallbackPercent, 15);
    assert.deepEqual(directoryProfessional.commission.groupRules, [{ groupId: String(serviceGroup._id), percent: 30 }]);
    assert.deepEqual(directoryProfessional.commission.serviceRules, [{ serviceId: String(service._id), percent: 40 }]);
    const directoryService = directory.body.services.find((entry) => entry.name === 'Banho Comissão Desktop');
    assert.equal(directoryService.groupId, String(serviceGroup._id));
    assert.equal(directoryService.groupCommissionPercent, 25);
    const appointments = await request.get(`/desktop/appointments?start=${encodeURIComponent(new Date(Date.now() - 86400000).toISOString())}&end=${encodeURIComponent(new Date(Date.now() + 86400000).toISOString())}`).set(headers);
    assert.equal(appointments.status, 200, appointments.text);
    assert.equal(appointments.body.appointments.length, 1);
    assert.equal(appointments.body.appointments[0].customerName, 'Cliente Desktop');
    assert.equal(appointments.body.appointments[0].petName, 'Bidu');
    await Appointment.create({
      store: base.company._id,
      cliente: customer._id,
      pet: pet._id,
      profissional: professional._id,
      scheduledAt: new Date('2026-08-22T12:00:00.000Z'),
      valor: 100,
      status: 'finalizado',
      itens: [{ servico: service._id, profissional: professional._id, valor: 100, data: '2026-08-22', hora: '09:00', status: 'finalizado' }],
    });
    const commissionReport = await request.get(`/desktop/agenda/commission-report?date=2026-08-22&professionalId=${professional._id}`).set(headers);
    assert.equal(commissionReport.status, 200, commissionReport.text);
    assert.equal(commissionReport.body.source, 'professional_commission_config');
    assert.equal(commissionReport.body.report.professionalName, 'Paulo Desktop');
    assert.equal(commissionReport.body.report.rows.length, 1);
    assert.equal(commissionReport.body.report.rows[0].commission, 40);
    assert.equal(commissionReport.body.report.total, 40);
    const recurringServiceId = new mongoose.Types.ObjectId();
    const recurringAppointment = await Appointment.create({
      store: base.company._id,
      cliente: customer._id,
      pet: pet._id,
      scheduledAt: new Date('2026-08-01T12:00:00.000Z'),
      valor: 90,
      pago: true,
      codigoVenda: 'VENDA-RECORRENTE',
      status: 'agendado',
      itens: [
        { servico: recurringServiceId, valor: 40, data: '2026-08-01', hora: '09:00', status: 'finalizado' },
        { servico: recurringServiceId, valor: 50, data: '2026-08-15', hora: '09:00', status: 'agendado' },
      ],
    });
    const recurringAppointments = await request.get('/desktop/appointments?start=2026-08-15T03%3A00%3A00.000Z&end=2026-08-16T03%3A00%3A00.000Z').set(headers);
    assert.equal(recurringAppointments.status, 200, recurringAppointments.text);
    const recurringPulled = recurringAppointments.body.appointments.find((entry) => entry.sourceAppointmentId === String(recurringAppointment._id));
    assert.ok(recurringPulled);
    assert.equal(recurringPulled.scheduledAt, '2026-08-15T12:00:00.000Z');
    assert.equal(recurringPulled.total, 50);
    assert.equal(recurringPulled.status, 'agendado');
    assert.equal(recurringPulled.paid, true);
    assert.match(recurringPulled.id, /:occurrence:/);
    await Pdv.updateOne({ _id: base.pdv._id }, { $set: { tipoUso: 'executavel', 'desktop.status': 'ativo' } });
    const statusRecurringAppointment = await Appointment.create({
      store: base.company._id,
      cliente: customer._id,
      pet: pet._id,
      scheduledAt: new Date('2026-08-01T12:00:00.000Z'),
      valor: 80,
      status: 'agendado',
      itens: [
        { servico: recurringServiceId, valor: 30, data: '2026-08-01', hora: '09:00', status: 'agendado' },
        { servico: recurringServiceId, valor: 50, data: '2026-08-15', hora: '09:00', status: 'agendado' },
      ],
    });
    const recurringFinalizationResponse = await request.post('/desktop/events/batch').set(headers).send({ events: [{
      eventId: 'recurring-status-finalized', type: 'appointment.status.updated', occurredAt: new Date().toISOString(),
      payload: { appointmentIds: [`${statusRecurringAppointment._id}:occurrence:2026-08-15T12:00:00.000Z`], status: 'finalizado' },
    }] });
    assert.equal(recurringFinalizationResponse.body.results[0].status, 'processed', recurringFinalizationResponse.text);
    const recurringFinalized = await Appointment.findById(statusRecurringAppointment._id).lean();
    assert.equal(recurringFinalized.itens.find((item) => item.data === '2026-08-01').status, 'agendado');
    assert.equal(recurringFinalized.itens.find((item) => item.data === '2026-08-15').status, 'finalizado');
    assert.equal(recurringFinalized.status, 'em_atendimento');
    await Appointment.deleteOne({ _id: statusRecurringAppointment._id });
    const recurringStatusResponse = await request.post('/desktop/events/batch').set(headers).send({ events: [{
      eventId: 'recurring-paid-status', type: 'appointment.updated', occurredAt: new Date().toISOString(),
      payload: {
        appointmentId: String(recurringAppointment._id), sourceAppointmentId: String(recurringAppointment._id),
        sourceOccurrenceKey: '2026-08-15T12:00:00.000Z', expectedVersion: 1,
        customerId: String(customer._id), petId: String(pet._id), scheduledAt: '2026-08-15T12:00:00.000Z',
        status: 'em_espera', services: [{ serviceId: String(recurringServiceId), unitPrice: 50, date: '2026-08-15', time: '09:00', status: 'em_espera' }],
      },
    }] });
    assert.equal(recurringStatusResponse.body.results[0].status, 'processed', recurringStatusResponse.text);
    const recurringUpdated = await Appointment.findById(recurringAppointment._id).lean();
    assert.equal(recurringUpdated.pago, true);
    assert.equal(recurringUpdated.itens.find((item) => item.data === '2026-08-01').status, 'finalizado');
    assert.equal(recurringUpdated.itens.find((item) => item.data === '2026-08-15').status, 'em_espera');
    const recurringMoveResponse = await request.post('/desktop/events/batch').set(headers).send({ events: [{
      eventId: 'recurring-move-time', type: 'appointment.updated', occurredAt: new Date().toISOString(),
      payload: {
        appointmentId: String(recurringAppointment._id), sourceAppointmentId: String(recurringAppointment._id),
        sourceOccurrenceKey: '2026-08-15T12:00:00.000Z', expectedVersion: 2,
        customerId: String(customer._id), petId: String(pet._id), scheduledAt: '2026-08-15T13:30:00.000Z',
        status: 'em_espera', services: [{ serviceId: String(recurringServiceId), unitPrice: 50, date: '2026-08-15', time: '10:30', status: 'em_espera' }],
      },
    }] });
    assert.equal(recurringMoveResponse.body.results[0].status, 'processed', recurringMoveResponse.text);
    const recurringMoved = await Appointment.findById(recurringAppointment._id).lean();
    assert.equal(recurringMoved.itens.length, 2);
    assert.equal(recurringMoved.itens.filter((item) => item.data === '2026-08-15').length, 1);
    assert.equal(recurringMoved.itens.find((item) => item.data === '2026-08-15').hora, '10:30');
    const paidServiceChange = await request.post('/desktop/events/batch').set(headers).send({ events: [{
      eventId: 'recurring-paid-service-change', type: 'appointment.updated', occurredAt: new Date().toISOString(),
      payload: {
        appointmentId: String(recurringAppointment._id), sourceAppointmentId: String(recurringAppointment._id),
        sourceOccurrenceKey: '2026-08-15T13:30:00.000Z', expectedVersion: 3,
        customerId: String(customer._id), petId: String(pet._id), scheduledAt: '2026-08-15T13:30:00.000Z',
        status: 'em_espera', services: [{ serviceId: String(new mongoose.Types.ObjectId()), unitPrice: 50, date: '2026-08-15', time: '10:30', status: 'em_espera' }],
      },
    }] });
    assert.equal(paidServiceChange.body.results[0].accepted, false);
    assert.equal(paidServiceChange.body.results[0].code, 'PAID_APPOINTMENT_RESTRICTED');
    const paidDelete = await request.post('/desktop/events/batch').set(headers).send({ events: [{
      eventId: 'recurring-paid-delete', type: 'appointment.deleted', occurredAt: new Date().toISOString(),
      payload: { appointmentId: String(recurringAppointment._id), sourceAppointmentId: String(recurringAppointment._id), sourceOccurrenceKey: '2026-08-15T13:30:00.000Z', expectedVersion: 3 },
    }] });
    assert.equal(paidDelete.body.results[0].accepted, false);
    assert.match(paidDelete.body.results[0].error, /Para excluir cancela primeiro a venda \(VENDA-RECORRENTE\)/);
    const movedOccurrences = await request.get('/desktop/appointments?start=2026-08-15T03%3A00%3A00.000Z&end=2026-08-16T03%3A00%3A00.000Z').set(headers);
    const movedOccurrence = movedOccurrences.body.appointments.find((entry) => entry.sourceAppointmentId === String(recurringAppointment._id));
    assert.ok(movedOccurrence);
    assert.equal(movedOccurrence.scheduledAt, '2026-08-15T13:30:00.000Z');
    const staleOccurrenceMove = await request.post('/desktop/events/batch').set(headers).send({ events: [{
      eventId: 'recurring-stale-occurrence', type: 'appointment.updated', occurredAt: new Date().toISOString(),
      payload: {
        appointmentId: String(recurringAppointment._id), sourceAppointmentId: String(recurringAppointment._id),
        sourceOccurrenceKey: '2026-08-15T12:00:00.000Z', expectedVersion: 3,
        customerId: String(customer._id), petId: String(pet._id), scheduledAt: '2026-08-15T14:00:00.000Z',
        status: 'em_espera', services: [{ serviceId: String(recurringServiceId), unitPrice: 50, date: '2026-08-15', time: '11:00', status: 'em_espera' }],
      },
    }] });
    assert.equal(staleOccurrenceMove.body.results[0].accepted, false);
    assert.equal(staleOccurrenceMove.body.results[0].code, 'APPOINTMENT_VERSION_CONFLICT');
    const recurringAfterStaleMove = await Appointment.findById(recurringAppointment._id).lean();
    assert.equal(recurringAfterStaleMove.version, 3);
    assert.equal(recurringAfterStaleMove.itens.length, 2);
    const agendaServiceId = new mongoose.Types.ObjectId();
    const appointmentCreateEvent = {
      eventId: 'appointment-create-1', type: 'appointment.created', occurredAt: new Date().toISOString(),
      payload: { clientMutationId: 'appointment-create-1', customerId: String(customer._id), petId: String(pet._id), scheduledAt: new Date(Date.now() + 7200000).toISOString(), status: 'agendado', notes: 'Criado offline', services: [{ serviceId: String(agendaServiceId), name: 'Banho', unitPrice: 35, status: 'agendado' }] },
    };
    const appointmentCreateResponse = await request.post('/desktop/events/batch').set(headers).send({ events: [appointmentCreateEvent] });
    assert.equal(appointmentCreateResponse.body.results[0].status, 'processed', appointmentCreateResponse.text);
    const locallyCreatedAppointment = await Appointment.findOne({ clientMutationId: 'appointment-create-1' }).lean();
    assert.equal(locallyCreatedAppointment.observacoes, 'Criado offline');
    assert.equal(locallyCreatedAppointment.version, 1);
    const appointmentUpdateEvent = {
      eventId: 'appointment-update-1', type: 'appointment.updated', occurredAt: new Date().toISOString(),
      payload: { ...appointmentCreateEvent.payload, appointmentId: String(locallyCreatedAppointment._id), expectedVersion: 1, status: 'em_espera', notes: 'Atualizado offline' },
    };
    const appointmentUpdateResponse = await request.post('/desktop/events/batch').set(headers).send({ events: [appointmentUpdateEvent] });
    assert.equal(appointmentUpdateResponse.body.results[0].status, 'processed', appointmentUpdateResponse.text);
    const locallyUpdatedAppointment = await Appointment.findById(locallyCreatedAppointment._id).lean();
    assert.equal(locallyUpdatedAppointment.status, 'em_espera');
    assert.equal(locallyUpdatedAppointment.version, 2);
    const conflictingEvent = { ...appointmentUpdateEvent, eventId: 'appointment-update-conflict', payload: { ...appointmentUpdateEvent.payload, expectedVersion: 1 } };
    const conflictResponse = await request.post('/desktop/events/batch').set(headers).send({ events: [conflictingEvent] });
    assert.equal(conflictResponse.body.results[0].accepted, false);
    assert.equal(conflictResponse.body.results[0].code, 'APPOINTMENT_VERSION_CONFLICT');
    const invalidStatusResponse = await request.post('/desktop/events/batch').set(headers).send({ events: [{
      eventId: 'appointment-status-invalid', type: 'appointment.status.updated', occurredAt: new Date().toISOString(), payload: { appointmentIds: ['referencia-invalida'], status: 'finalizado' },
    }] });
    assert.equal(invalidStatusResponse.body.results[0].accepted, false);
    assert.equal(invalidStatusResponse.body.results[0].disposition, 'requires_action');
    assert.equal(invalidStatusResponse.body.results[0].retryable, false);
    const customerWithoutCepId = String(new mongoose.Types.ObjectId());
    const customerWithoutCepResponse = await request.post('/desktop/events/batch').set(headers).send({ events: [{
      eventId: 'customer-without-cep', type: 'customer.created', occurredAt: new Date().toISOString(), payload: { customerId: customerWithoutCepId, name: 'Cliente sem CEP', phone: `213${suffix}`, address: { street: 'Rua Incompleta', number: '1' } },
    }] });
    assert.equal(customerWithoutCepResponse.body.results[0].code, 'CUSTOMER_CEP_REQUIRED');
    assert.equal(customerWithoutCepResponse.body.results[0].disposition, 'requires_action');
    assert.equal(await User.exists({ _id: customerWithoutCepId }), null);
    const repairedCustomerResponse = await request.post('/desktop/events/batch').set(headers).send({ events: [{
      eventId: 'customer-without-cep', type: 'customer.created', occurredAt: new Date().toISOString(), payload: { customerId: customerWithoutCepId, name: 'Cliente com CEP', phone: `213${suffix}`, address: { zipCode: '20550230', street: 'Rua Corrigida', number: '1', city: 'Rio de Janeiro', state: 'RJ', principal: true } },
    }] });
    assert.equal(repairedCustomerResponse.body.results[0].status, 'processed', repairedCustomerResponse.text);
    assert.equal((await UserAddress.findOne({ user: customerWithoutCepId }).lean()).cep, '20550230');
    const duplicateCustomerEvent = {
      eventId: 'customer-existing-1',
      type: 'customer.created',
      occurredAt: new Date().toISOString(),
      payload: {
        customerId: String(new mongoose.Types.ObjectId()),
        name: 'Cliente Desktop Repetido',
        phone: customer.celular,
        document: customer.cpf,
        address: { id: String((await UserAddress.findOne({ user: customer._id }))._id), zipCode: '20000000', street: 'Rua Desktop', number: '10', city: 'Rio de Janeiro', state: 'RJ', principal: true },
      },
    };
    const duplicateCustomerResponse = await request.post('/desktop/events/batch').set(headers).send({ events: [duplicateCustomerEvent] });
    assert.equal(duplicateCustomerResponse.body.results[0].accepted, true, duplicateCustomerResponse.text);
    assert.equal(duplicateCustomerResponse.body.results[0].status, 'processed');
    assert.equal(await User.countDocuments({ celular: customer.celular }), 1);
    const linkedCustomer = await User.findById(customer._id).lean();
    assert.ok(linkedCustomer.empresas.map(String).includes(String(base.company._id)));
    const existingPrimaryAddress = await UserAddress.findOne({ user: customer._id }).lean();
    const primaryAddressId = String(existingPrimaryAddress._id);
    const secondaryAddressId = String(new mongoose.Types.ObjectId());
    const customerAddressUpdate = {
      eventId: 'customer-addresses-1',
      type: 'customer.updated',
      occurredAt: new Date().toISOString(),
      payload: {
        customerId: String(customer._id), name: customer.nomeCompleto, phone: customer.celular, document: customer.cpf,
        address: { id: primaryAddressId, label: 'Principal', zipCode: '20270215', street: 'Rua Principal', number: '10', city: 'Rio de Janeiro', state: 'RJ', principal: true },
        addresses: [
          { id: primaryAddressId, label: 'Principal', zipCode: '20270215', street: 'Rua Principal', number: '10', city: 'Rio de Janeiro', state: 'RJ', principal: true },
          { id: secondaryAddressId, label: 'Trabalho', zipCode: '21073185', street: 'Rua Secundária', number: '20', city: 'Rio de Janeiro', state: 'RJ' },
        ],
      },
    };
    const customerAddressResponse = await request.post('/desktop/events/batch').set(headers).send({ events: [customerAddressUpdate] });
    assert.equal(customerAddressResponse.body.results[0].status, 'processed', customerAddressResponse.text);
    const customerAddresses = await UserAddress.find({ user: customer._id }).sort({ isDefault: -1 }).lean();
    assert.equal(customerAddresses.length, 2);
    assert.equal(customerAddresses[0].logradouro, 'Rua Principal');
    assert.equal(customerAddresses[1].logradouro, 'Rua Secundária');
    const directoryWithAddresses = await request.get('/desktop/directory/snapshot').set(headers);
    const directoryCustomer = directoryWithAddresses.body.customers.find((entry) => entry.id === String(customer._id));
    assert.equal(directoryCustomer.addresses.length, 2);
    assert.equal(directoryCustomer.address.id, primaryAddressId);
    const duplicateLocalCustomerId = duplicateCustomerEvent.payload.customerId;
    const duplicatePetId = String(new mongoose.Types.ObjectId());
    const duplicatePetEvent = {
      eventId: 'pet-existing-customer-1',
      type: 'pet.created',
      occurredAt: new Date().toISOString(),
      payload: { petId: duplicatePetId, customerId: duplicateLocalCustomerId, name: 'Pet do cliente repetido', type: 'cachorro', breed: 'Poodle Grande', size: 'grande', sex: 'M', birthDate: '2026-08-01' },
    };
    const duplicatePetResponse = await request.post('/desktop/events/batch').set(headers).send({ events: [duplicatePetEvent] });
    assert.equal(duplicatePetResponse.body.results[0].status, 'processed', duplicatePetResponse.text);
    const duplicatePet = await Pet.findById(duplicatePetId).lean();
    assert.equal(String(duplicatePet.owner), String(customer._id));
    const petWithoutBirthId = String(new mongoose.Types.ObjectId());
    const petWithoutBirthResponse = await request.post('/desktop/events/batch').set(headers).send({ events: [{
      eventId: 'pet-without-birth-1', type: 'pet.created', occurredAt: new Date().toISOString(),
      payload: { petId: petWithoutBirthId, customerId: duplicateLocalCustomerId, name: 'Pet sem nascimento', type: 'cachorro', breed: 'SRD', size: 'medio', sex: 'F', birthDate: '' },
    }] });
    assert.equal(petWithoutBirthResponse.body.results[0].status, 'processed', petWithoutBirthResponse.text);
    const petWithoutBirth = await Pet.findById(petWithoutBirthId).lean();
    assert.equal(petWithoutBirth.nome, 'Pet sem nascimento');
    assert.equal(petWithoutBirth.dataNascimento, undefined);
    const updatePetEvent = {
      eventId: 'pet-update-existing-1', type: 'pet.updated', occurredAt: new Date().toISOString(),
      payload: { petId: duplicatePetId, customerId: duplicateLocalCustomerId, name: 'Pet atualizado', type: 'cachorro', breed: 'Poodle', size: 'medio', sex: 'M', birthDate: '2026-08-01' },
    };
    const updatePetResponse = await request.post('/desktop/events/batch').set(headers).send({ events: [updatePetEvent] });
    assert.equal(updatePetResponse.body.results[0].status, 'processed', updatePetResponse.text);
    const updatedPet = await Pet.findById(duplicatePetId).lean();
    assert.equal(updatedPet.nome, 'Pet atualizado');
    assert.equal(await Pet.countDocuments({ _id: duplicatePetId }), 1);
    const duplicateAppointmentEvent = {
      eventId: 'appointment-existing-customer-1',
      type: 'appointment.created',
      occurredAt: new Date().toISOString(),
      payload: { clientMutationId: 'appointment-existing-customer-1', customerId: duplicateLocalCustomerId, petId: duplicatePetId, scheduledAt: new Date(Date.now() + 10800000).toISOString(), status: 'agendado', services: [{ serviceId: String(agendaServiceId), name: 'Consulta', unitPrice: 40, status: 'agendado' }] },
    };
    const duplicateAppointmentResponse = await request.post('/desktop/events/batch').set(headers).send({ events: [duplicateAppointmentEvent] });
    assert.equal(duplicateAppointmentResponse.body.results[0].status, 'processed', duplicateAppointmentResponse.text);
    const duplicateAppointment = await Appointment.findOne({ clientMutationId: 'appointment-existing-customer-1' }).lean();
    assert.equal(String(duplicateAppointment.cliente), String(customer._id));
    const billingRecurringAppointment = await Appointment.create({
      store: base.company._id,
      cliente: customer._id,
      pet: pet._id,
      scheduledAt: new Date('2026-08-01T12:00:00.000Z'),
      valor: 80,
      status: 'agendado',
      itens: [
        { servico: recurringServiceId, valor: 30, data: '2026-08-01', hora: '09:00', status: 'agendado' },
        { servico: recurringServiceId, valor: 50, data: '2026-08-15', hora: '09:00', status: 'agendado' },
      ],
    });
    const events = [
      { eventId: 'cash-1', type: 'cash.opened', occurredAt: new Date().toISOString(), payload: { openingAmount: 50 } },
      { eventId: 'event-1', type: 'sale.completed', occurredAt: new Date().toISOString(), payload: { id: 'local-sale-1', saleCode: `${base.pdv.codigo.replace(/[^A-Za-z0-9]/g, '')}-000001`, appointmentId: `local:${appointmentMutationId}`, appointmentIds: [`local:${appointmentMutationId}`, `${billingRecurringAppointment._id}:occurrence:2026-08-15T12:00:00.000Z`], grossTotal: 20, netTotal: 20, items: [{ productId: String(new mongoose.Types.ObjectId()), code: base.product.cod, name: base.product.nome, quantity: 1, unitPrice: 20 }], payments: [{ paymentMethodId: String(base.payment._id), amount: 20 }] } },
    ];
    const first = await request.post('/desktop/events/batch').set(headers).send({ events });
    const duplicateOpen = await request.post('/desktop/events/batch').set(headers).send({ events: [{ eventId: 'cash-open-duplicate-state', type: 'cash.opened', occurredAt: new Date().toISOString(), payload: { openingAmount: 999 } }] });
    assert.equal(duplicateOpen.body.results[0].status, 'processed', duplicateOpen.text);
    const replay = await request.post('/desktop/events/batch').set(headers).send({ events: [events[1]] });
    assert.equal(first.body.results[1].accepted, true, first.text);
    assert.equal(first.body.results[1].status, 'processed');
    assert.equal(replay.body.results[0].replayed, true);
    assert.equal(await PdvDesktopEvent.countDocuments({ eventId: 'event-1' }), 1);
    const cloudState = await PdvState.findOne({ pdv: base.pdv._id }).lean();
    assert.equal(cloudState.completedSales.length, 1);
    assert.equal(cloudState.completedSales[0].id, 'local-sale-1');
    assert.equal(cloudState.completedSales[0].appointmentId, `local:${appointmentMutationId}`);
    assert.deepEqual(cloudState.completedSales[0].appointmentIds, [`local:${appointmentMutationId}`, `${billingRecurringAppointment._id}:occurrence:2026-08-15T12:00:00.000Z`]);
    assert.equal(String(cloudState.completedSales[0].items[0].productId), String(base.product._id));
    assert.equal(Number(cloudState.completedSales[0].items[0].unitCost), 10);
    const salesHistory = await request.get('/desktop/sales/history?limit=50').set(headers);
    assert.equal(salesHistory.status, 200, salesHistory.text);
    assert.equal(salesHistory.body.sales.length, 1);
    assert.equal(salesHistory.body.sales[0].id, 'local-sale-1');
    const billedAppointment = await Appointment.findById(appointment._id).lean();
    assert.equal(billedAppointment.pago, true);
    assert.equal(billedAppointment.status, 'finalizado');
    assert.equal(billedAppointment.codigoVenda, events[1].payload.saleCode);
    const billedRecurring = await Appointment.findById(billingRecurringAppointment._id).lean();
    assert.equal(billedRecurring.pago, true);
    assert.equal(billedRecurring.codigoVenda, events[1].payload.saleCode);
    assert.equal(billedRecurring.itens.find((item) => item.data === '2026-08-01').status, 'agendado');
    assert.equal(billedRecurring.itens.find((item) => item.data === '2026-08-15').status, 'finalizado');
    await Appointment.deleteOne({ _id: billingRecurringAppointment._id });

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
    const staleDeliveryStatus = await request.post('/desktop/events/batch').set(headers).send({ events: [{ eventId: 'delivery-stale-after-final', type: 'delivery.status.updated', occurredAt: new Date().toISOString(), payload: { orderId: 'delivery-local-1', status: 'emRota' } }] });
    assert.equal(staleDeliveryStatus.body.results[0].status, 'processed', staleDeliveryStatus.text);
    assert.equal((await PdvState.findOne({ pdv: base.pdv._id }).lean()).deliveryOrders[0].status, 'finalizado');
    const deliveryPull = await request.get('/desktop/deliveries').set(headers);
    assert.equal(deliveryPull.body.deliveries[0].id, 'delivery-local-1');

    const operationalEvents = [
      { eventId: 'cash-entry-1', type: 'cash.entry', occurredAt: new Date().toISOString(), payload: { amount: 5, paymentMethodId: String(base.payment._id), reason: 'Reforço' } },
      { eventId: 'cancel-1', type: 'sale.cancelled', occurredAt: new Date().toISOString(), payload: { saleId: 'local-sale-1', saleCode: events[1].payload.saleCode, appointmentId: `local:${appointmentMutationId}`, appointmentIds: [`local:${appointmentMutationId}`], reason: 'Cliente desistiu' } },
      { eventId: 'cash-close-1', type: 'cash.closed', occurredAt: new Date().toISOString(), payload: { countedPayments: [{ paymentMethodId: String(base.payment._id), amount: 55 }], reason: 'Fim do turno' } },
    ];
    const operational = await request.post('/desktop/events/batch').set(headers).send({ events: operationalEvents });
    assert.equal(operational.status, 200, operational.text);
    assert.deepEqual(operational.body.results.map((item) => item.status), ['processed', 'processed', 'processed']);
    const finalState = await PdvState.findOne({ pdv: base.pdv._id }).lean();
    assert.equal(finalState.completedSales.find((entry) => entry.id === 'local-sale-1').status, 'cancelled');
    assert.equal(finalState.caixaAberto, false);
    const cancelledAppointment = await Appointment.findById(appointment._id).lean();
    assert.equal(cancelledAppointment.pago, false);
    assert.equal(cancelledAppointment.codigoVenda, '');
    assert.equal(cancelledAppointment.status, 'em_atendimento');
    const redundantClose = await request.post('/desktop/events/batch').set(headers).send({ events: [
      { eventId: 'cash-close-after-web-1', type: 'cash.closed', occurredAt: new Date().toISOString(), payload: { cashSessionId: 'desktop-stale-session', countedPayments: [{ paymentMethodId: String(base.payment._id), amount: 55 }], reason: 'Caixa já fechado no Web' } },
    ] });
    assert.equal(redundantClose.status, 200, redundantClose.text);
    assert.deepEqual(redundantClose.body.results.map((item) => item.status), ['processed']);
    const redundantCloseRecord = await PdvDesktopEvent.findOne({ pdv: base.pdv._id, eventId: 'cash-close-after-web-1' }).lean();
    assert.equal(redundantCloseRecord.status, 'processed');
    assert.equal(redundantCloseRecord.error, '');
    const missingAppointmentDelete = await request.post('/desktop/events/batch').set(headers).send({ events: [{
      eventId: 'appointment-delete-already-absent', type: 'appointment.deleted', occurredAt: new Date().toISOString(), payload: { appointmentId: String(new mongoose.Types.ObjectId()), expectedVersion: 1 },
    }] });
    assert.equal(missingAppointmentDelete.body.results[0].status, 'processed', missingAppointmentDelete.text);
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

  test('provisiona o certificado e os dados da empresa emitente fiscal sem trocar a empresa operacional', async () => {
    const base = await fixture();
    const issuer = await Store.create({
      codigo: `EMIT-${Date.now()}`,
      nome: 'Emitente Fiscal Vila',
      nomeFantasia: 'Emitente Fiscal Vila',
      razaoSocial: 'EMITENTE FISCAL VILA LTDA',
      cnpj: '07919703000167',
      inscricaoEstadual: '12345678',
      regimeTributario: 'simples',
      uf: 'RJ',
      codigoUf: '33',
      codigoIbgeMunicipio: '3304557',
      municipio: 'Rio de Janeiro',
      logradouro: 'Rua Fiscal',
      numero: '100',
      bairro: 'Vila Isabel',
      cep: '20551000',
      certificadoArquivoCriptografado: encryptBuffer(Buffer.from('pfx-de-teste')),
      certificadoSenhaCriptografada: encryptText('senha-teste'),
      cscIdProducao: '000004',
      cscTokenProducaoCriptografado: encryptText('csc-producao-teste'),
      cscTokenProducaoArmazenado: true,
    });
    await Pdv.updateOne(
      { _id: base.pdv._id },
      {
        $set: {
          tipoUso: 'executavel',
          'desktop.status': 'ativo',
          empresaEmitenteFiscal: issuer._id,
          serieNfce: '4',
          ambientesHabilitados: ['producao'],
          ambientePadrao: 'producao',
          'configuracoesFiscal.tipoEmissaoPadrao': 'matricial',
        },
      }
    );

    const request = supertest(app());
    const pairing = await request
      .post(`/desktop/pdvs/${base.pdv._id}/pairing-code`)
      .set('Authorization', 'Bearer test')
      .send();
    const paired = await request
      .post('/desktop/pair')
      .send({ pairingCode: pairing.body.pairingCode, machineId: 'issuer-host' });
    const headers = { 'X-Desktop-Token': paired.body.token };

    const bootstrap = await request.get('/desktop/bootstrap').set(headers);
    assert.equal(bootstrap.status, 200, bootstrap.text);
    assert.equal(String(bootstrap.body.pdv.empresa._id), String(base.company._id));
    assert.equal(String(bootstrap.body.pdv.empresaEmitenteFiscal._id), String(issuer._id));

    const fiscalConfig = await request.get('/desktop/fiscal/config').set(headers);
    assert.equal(fiscalConfig.status, 200, fiscalConfig.text);
    assert.equal(fiscalConfig.body.version, 2);
    assert.equal(fiscalConfig.body.operationalStoreId, String(base.company._id));
    assert.equal(fiscalConfig.body.fiscalIssuerStoreId, String(issuer._id));
    assert.equal(fiscalConfig.body.series, 4);
    assert.equal(fiscalConfig.body.store.cnpj, '07919703000167');
    assert.equal(fiscalConfig.body.certificatePassword, 'senha-teste');
    assert.equal(fiscalConfig.body.cscToken, 'csc-producao-teste');
  });

  test('registra transferência desktop entre lojas uma única vez e não movimenta estoque antes da aprovação', async () => {
    const base = await fixture();
    const suffix = String(Date.now()).slice(-8);
    const destinationCompany = await Store.create({ codigo: `DEST-${suffix}`, nome: 'Empresa Destino', nomeFantasia: 'Empresa Destino', cnpj: `8${suffix}`.padEnd(14, '0').slice(0, 14) });
    const [origin, destination, responsible] = await Promise.all([
      Deposit.create({ codigo: `TO-${suffix}`, nome: 'Origem', empresa: base.company._id }),
      Deposit.create({ codigo: `TD-${suffix}`, nome: 'Destino', empresa: destinationCompany._id }),
      User.create({ tipoConta: 'pessoa_fisica', email: `transfer-${suffix}@example.com`, senha: 'hash', celular: `214${suffix}`, nomeCompleto: 'Responsável Transferência', role: 'funcionario', empresas: [base.company._id] }),
    ]);
    await Product.updateOne({ _id: base.product._id }, { $set: { estoques: [{ deposito: origin._id, quantidade: 8 }, { deposito: destination._id, quantidade: 2 }] } });
    const request = supertest(app());
    const pairing = await request.post(`/desktop/pdvs/${base.pdv._id}/pairing-code`).set('Authorization', 'Bearer test').send();
    const paired = await request.post('/desktop/pair').send({ pairingCode: pairing.body.pairingCode, machineId: 'transfer-host' });
    await Pdv.updateOne({ _id: base.pdv._id }, { $set: { tipoUso: 'executavel', 'desktop.status': 'ativo' } });
    const headers = { 'X-Desktop-Token': paired.body.token };
    const directory = await request.get('/desktop/directory/snapshot').set(headers);
    assert.ok(directory.body.stores.some((entry) => entry.id === String(destinationCompany._id)));
    assert.ok(directory.body.deposits.some((entry) => entry.id === String(destination._id) && entry.companyId === String(destinationCompany._id)));
    const payload = { id: 'local-transfer-1', pdvId: String(base.pdv._id), originCompanyId: String(base.company._id), originDepositId: String(origin._id), destinationCompanyId: String(destinationCompany._id), destinationDepositId: String(destination._id), responsibleId: String(responsible._id), items: [{ productId: String(base.product._id), quantity: 3 }] };
    const event = { eventId: 'transfer-event-1', type: 'transfer.requested', occurredAt: new Date().toISOString(), payload };
    const first = await request.post('/desktop/events/batch').set(headers).send({ events: [event] });
    const replay = await request.post('/desktop/events/batch').set(headers).send({ events: [event] });
    assert.equal(first.body.results[0].status, 'processed');
    assert.equal(replay.body.results[0].replayed, true);
    assert.equal(await Transfer.countDocuments({ desktopTransferId: payload.id }), 1);
    const transfer = await Transfer.findOne({ desktopTransferId: payload.id }).lean();
    assert.equal(String(transfer.originCompany), String(base.company._id));
    assert.equal(String(transfer.destinationCompany), String(destinationCompany._id));
    const product = await Product.findById(base.product._id).lean();
    assert.deepEqual(product.estoques.map((entry) => Number(entry.quantidade)), [8, 2]);
    const snapshot = await request.get('/desktop/transfers').set(headers);
    assert.equal(snapshot.status, 200, snapshot.text);
    assert.equal(snapshot.body.transfers[0].desktopTransferId, payload.id);
  });
});
