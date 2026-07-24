const test = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveOperatingHours,
} = require('../whatsappOperatingHoursService');

const baseConfig = {
  timezone: 'America/Sao_Paulo',
  specialHours: [],
};

test('horário não configurado é tratado como aberto para preservar prioridade humana', () => {
  const result = resolveOperatingHours({
    store: { horario: {} },
    config: baseConfig,
    at: new Date('2026-07-20T15:00:00.000Z'),
  });
  assert.equal(result.isOpen, true);
  assert.equal(result.source, 'unconfigured');
  assert.equal(result.scheduleConfigured, false);
});

test('resolve expediente da loja no fuso configurado', () => {
  const store = {
    horario: {
      segunda: { abre: '09:00', fecha: '18:00', fechada: false },
    },
  };
  const open = resolveOperatingHours({
    store,
    config: baseConfig,
    at: new Date('2026-07-20T15:00:00.000Z'),
  });
  const closed = resolveOperatingHours({
    store,
    config: baseConfig,
    at: new Date('2026-07-20T23:00:00.000Z'),
  });
  assert.equal(open.weekday, 'segunda');
  assert.equal(open.isOpen, true);
  assert.equal(closed.isOpen, false);
});

test('exceção de data substitui o horário semanal', () => {
  const result = resolveOperatingHours({
    store: {
      horario: {
        segunda: { abre: '09:00', fecha: '18:00', fechada: false },
      },
    },
    config: {
      ...baseConfig,
      specialHours: [{
        date: '2026-07-20',
        closed: true,
        label: 'Feriado',
      }],
    },
    at: new Date('2026-07-20T15:00:00.000Z'),
  });
  assert.equal(result.isOpen, false);
  assert.equal(result.source, 'special');
  assert.equal(result.label, 'Feriado');
});
