const test = require('node:test');
const assert = require('node:assert/strict');
const { isPermanentReceivingFailure, transmitReceivingEvents } = require('../admin-compras-romaneios.js');

const event = (id) => ({ eventId: id, barcode: id, quantity: 1, mode: 'count' });
const failure = (status, code, message = code) => Object.assign(new Error(message), { status, code });

test('isola o evento inválido do lote e confirma os demais sem alterar seus UUIDs', async () => {
  const events = [event('first'), event('bad-identify'), event('last')];
  const calls = [];
  const result = await transmitReceivingEvents(events, async (batch) => {
    calls.push(batch.map((entry) => entry.eventId));
    if (batch.some((entry) => entry.eventId === 'bad-identify')) throw failure(409, 'BARCODE_CONFLICT');
    return { acknowledged: batch.map((entry) => entry.eventId) };
  });
  assert.deepEqual(calls, [['first', 'bad-identify', 'last'], ['first'], ['bad-identify'], ['last']]);
  assert.deepEqual(result.acknowledged, ['first', 'last']);
  assert.deepEqual(result.rejected.map((entry) => entry.eventId), ['bad-identify']);
  assert.equal(result.rejected[0].code, 'BARCODE_CONFLICT');
  assert.equal(result.error, null);
});

test('o reenvio individual permanece idempotente mesmo quando um evento já foi aceito', async () => {
  const applied = new Set(['first']);
  let quantity = 1;
  const events = [event('first'), event('bad'), event('last')];
  const result = await transmitReceivingEvents(events, async (batch) => {
    if (batch.some((entry) => entry.eventId === 'bad')) throw failure(404, 'LINE_NOT_FOUND');
    for (const entry of batch) if (!applied.has(entry.eventId)) { applied.add(entry.eventId); quantity++; }
    return { acknowledged: batch.map((entry) => entry.eventId) };
  });
  assert.equal(quantity, 2);
  assert.deepEqual(result.acknowledged, ['first', 'last']);
  assert.equal(result.rejected.length, 1);
});

for (const [name, error] of [
  ['autenticação', failure(401, 'UNAUTHORIZED')],
  ['limite de requisições', failure(429, 'RATE_LIMIT')],
  ['erro interno', failure(500, 'SERVER_ERROR')],
  ['indisponibilidade', failure(503, 'UNAVAILABLE')],
  ['versão concorrente', failure(409, 'VERSION_CONFLICT')],
  ['timeout HTTP', failure(408, 'TIMEOUT')],
  ['queda de rede', new TypeError('Failed to fetch')],
]) {
  test(`preserva ${name} como falha transitória sem isolar ou rejeitar leituras`, async () => {
    let calls = 0;
    const result = await transmitReceivingEvents([event('first'), event('last')], async () => { calls++; throw error; });
    assert.equal(calls, 1);
    assert.equal(result.error, error);
    assert.deepEqual(result.acknowledged, []);
    assert.deepEqual(result.rejected, []);
    assert.equal(isPermanentReceivingFailure(error), false);
  });
}

test('interrompe isolamento quando a rede cai e preserva o restante não confirmado', async () => {
  const events = [event('first'), event('bad'), event('offline'), event('last')];
  const calls = [];
  const result = await transmitReceivingEvents(events, async (batch) => {
    calls.push(batch.map((entry) => entry.eventId));
    if (batch.length > 1 || batch[0].eventId === 'bad') throw failure(409, 'BARCODE_CONFLICT');
    if (batch[0].eventId === 'offline') throw new TypeError('Failed to fetch');
    return { acknowledged: [batch[0].eventId] };
  });
  assert.deepEqual(result.acknowledged, ['first']);
  assert.deepEqual(result.rejected.map((entry) => entry.eventId), ['bad']);
  assert(result.error instanceof TypeError);
  assert.deepEqual(calls, [['first', 'bad', 'offline', 'last'], ['first'], ['bad'], ['offline']]);
});

test('não considera enviado um evento sem confirmação explícita nem UUID estranho', async () => {
  const result = await transmitReceivingEvents([event('first')], async () => ({ acknowledged: ['unrelated'] }));
  assert.deepEqual(result.acknowledged, []);
  assert.deepEqual(result.rejected, []);
});

test('uma rejeição de evento único é preservada com motivo e não é reenviada imediatamente', async () => {
  let calls = 0;
  const result = await transmitReceivingEvents([event('bad')], async () => { calls++; throw failure(400, 'INVALID_RECEIVING', 'Quantidade inválida.'); });
  assert.equal(calls, 1);
  assert.deepEqual(result.rejected, [{ eventId: 'bad', status: 400, code: 'INVALID_RECEIVING', message: 'Quantidade inválida.' }]);
});
