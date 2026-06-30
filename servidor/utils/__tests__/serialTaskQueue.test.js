const test = require('node:test');
const assert = require('node:assert/strict');
const { createSerialTaskQueue } = require('../serialTaskQueue');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('serializa tarefas para a mesma chave', async () => {
  const queue = createSerialTaskQueue({ staleAfterMs: 1000 });
  const events = [];

  const first = queue.enqueue('pdv-1', async () => {
    events.push('first:start');
    await sleep(20);
    events.push('first:end');
    return 'first';
  });

  const second = queue.enqueue('pdv-1', async () => {
    events.push('second:start');
    events.push('second:end');
    return 'second';
  });

  const results = await Promise.all([first, second]);
  assert.deepEqual(results, ['first', 'second']);
  assert.deepEqual(events, [
    'first:start',
    'first:end',
    'second:start',
    'second:end',
  ]);
});

test('permite recuperar a fila quando a tarefa ativa fica obsoleta', async () => {
  const warnings = [];
  const queue = createSerialTaskQueue({
    staleAfterMs: 25,
    logger: {
      warn(message, payload) {
        warnings.push({ message, payload });
      },
    },
  });

  void queue.enqueue('pdv-2', async () => new Promise(() => {}), { action: 'hung-sale' });

  await sleep(40);

  const result = await queue.enqueue('pdv-2', async () => 'recovered', { action: 'fresh-sale' });

  assert.equal(result, 'recovered');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0].message, /stale task detected/i);
  assert.equal(warnings[0].payload?.activeMeta?.action, 'hung-sale');
  assert.equal(warnings[0].payload?.nextMeta?.action, 'fresh-sale');
});
