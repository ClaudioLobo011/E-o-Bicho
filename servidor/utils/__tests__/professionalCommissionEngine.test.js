const { test } = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../../../scripts/common/professional-commission-engine');
const base = { serviceRules: [{ service: 's', percent: 40 }], groupRules: [{ group: 'g', percent: 30 }], weekdayRules: [{ id: 'special', weekdays: [0, 6], defaultPercent: 50, serviceRules: [{ service: 's', percent: 60 }], groupRules: [{ group: 'g', percent: 55 }] }] };
const resolve = (config = base, extra = {}) => engine.resolveServiceCommission({ professionalCommission: config, serviceId: 's', groupId: 'g', serviceDate: '2026-10-11', servicePercent: 25, groupPercent: 20, itemPercent: 15, fallbackPercent: 10, ...extra });
test('ordem serviço do dia, grupo do dia, padrão do dia, serviço e grupo comuns', () => {
  const config = structuredClone(base);
  assert.equal(resolve(config).percent, 60);
  config.weekdayRules[0].serviceRules = [];
  assert.equal(resolve(config).percent, 55);
  config.weekdayRules[0].groupRules = [];
  assert.equal(resolve(config).percent, 50);
  config.weekdayRules[0].defaultPercent = null;
  assert.equal(resolve(config).percent, 40);
  config.serviceRules = [];
  assert.equal(resolve(config).percent, 30);
});
test('sete dias, zero explícito, inatividade e limites de fuso', () => {
  for (let day = 5; day <= 11; day++) assert.equal(resolve(base, { serviceDate: `2026-10-${String(day).padStart(2,'0')}` }).percent, day >= 10 ? 60 : 40);
  const config = structuredClone(base); config.weekdayRules[0].serviceRules[0].percent = 0;
  assert.equal(resolve(config).percent, 0);
  config.weekdayRules[0].enabled = false; assert.equal(resolve(config).percent, 40);
  assert.equal(engine.dateKey('2026-10-12T02:59:59Z'), '2026-10-11');
  assert.equal(engine.dateKey('2026-10-12T03:00:00Z'), '2026-10-12');
  assert.equal(engine.dateKey('2026-02-30'), '');
  assert.equal(resolve(base, { serviceDate: '' }).source, 'professional_service');
});
test('vigência preserva passado, troca de versão e formato desktop', () => {
  const config = { ...base, revision: 2, effectiveFrom: '2026-10-12', history: [{ revision: 0, serviceRules: [{ serviceId: 's', percent: 20 }] }, { ...base, revision: 1, effectiveFrom: '2026-10-10' }] };
  assert.equal(resolve(config, { serviceDate: '2026-10-09' }).percent, 20);
  assert.equal(resolve(config).revision, 1);
  assert.equal(resolve(config, { serviceDate: '2026-10-18' }).revision, 2);
  assert.equal(engine.commissionAmount(19.99, 33.33), 6.66);
});


test('correção retroativa prevalece após sua vigência, preserva passado e aceita mudança futura', () => {
  const config = { revision: 2, effectiveFrom: '2026-10-04', weekdayRules: [{ id: 'domingo', weekdays: [0], defaultPercent: 50 }], groupRules: [{ group: 'g', percent: 30 }], history: [
    { revision: 0, groupRules: [{ group: 'g', percent: 30 }] },
    { revision: 1, effectiveFrom: '2026-10-08', weekdayRules: [{ id: 'domingo', weekdays: [0], defaultPercent: 60 }] }
  ] };
  assert.equal(resolve(config, { serviceDate: '2026-09-27' }).percent, 30);
  for (const serviceDate of ['2026-10-04', '2026-10-11']) {
    assert.equal(resolve(config, { serviceDate }).percent, 50);
    assert.equal(resolve(config, { serviceDate }).revision, 2);
  }
  const { history, ...previous } = config;
  const next = { ...config, revision: 3, effectiveFrom: '2026-11-01', weekdayRules: [{ id: 'domingo', weekdays: [0], defaultPercent: 70 }], history: [...history, previous] };
  assert.equal(resolve(next, { serviceDate: '2026-10-11' }).percent, 50);
  assert.equal(resolve(next, { serviceDate: '2026-11-01' }).percent, 70);
});
