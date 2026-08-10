const test = require('node:test');
const assert = require('node:assert/strict');
const { deriveAppointmentStatus } = require('../appointmentStatus');

test('considera finalizado quando todos os serviços foram finalizados mesmo com status principal antigo', () => {
  assert.equal(deriveAppointmentStatus({ status: 'agendado', itens: [{ status: 'finalizado' }] }), 'finalizado');
});

test('considera atendimento parcial quando apenas parte dos serviços foi finalizada', () => {
  assert.equal(deriveAppointmentStatus({ status: 'agendado', itens: [{ status: 'finalizado' }, { status: 'agendado' }] }), 'em_atendimento');
});

test('preserva o status principal quando o atendimento não possui itens com status', () => {
  assert.equal(deriveAppointmentStatus({ status: 'em_espera', itens: [] }), 'em_espera');
});
