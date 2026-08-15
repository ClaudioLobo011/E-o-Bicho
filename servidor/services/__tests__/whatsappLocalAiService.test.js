const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildChatMessages,
  requestCompletion,
  stripThinking,
} = require('../whatsappLocalAiService');

test('prompt do E o Bicho fica isolado da Zoe e preserva contexto da conversa', () => {
  const messages = buildChatMessages({
    config: {},
    store: {
      nome: 'E o Bicho Vila Isabel',
      endereco: 'Rua de teste, 10',
      servicos: ['Banho', 'Tosa'],
      horario: {
        segunda: { abre: '09:00', fecha: '18:00', fechada: false },
        domingo: { fechada: true },
      },
    },
    history: [
      { direction: 'incoming', message: 'Vocês fazem banho?' },
      { direction: 'outgoing', message: 'Sim, fazemos.' },
      { direction: 'incoming', message: 'Quanto custa?' },
    ],
  });
  assert.equal(messages[0].role, 'system');
  assert.match(messages[0].content, /mensagem mais recente do cliente define a pergunta atual/i);
  assert.match(messages[0].content, /Respostas anteriores do pr.prio assistente podem conter enganos/i);
  assert.match(messages[0].content, /E o Bicho Vila Isabel/);
  assert.match(messages[0].content, /Nunca invente preço/);
  assert.doesNotMatch(messages[0].content, /assistente social oficial|jogadores|servidor roleplay/i);
  assert.deepEqual(messages.slice(-3).map((entry) => entry.role), ['user', 'assistant', 'user']);
});

test('cliente local envia prompt separado e remove raciocínio interno da resposta', async () => {
  const originalKey = process.env.EOBICHO_LOCAL_AI_API_KEY;
  process.env.EOBICHO_LOCAL_AI_API_KEY = 'test-local-key';
  let requestBody;
  let authorization;
  try {
    const reply = await requestCompletion({
      config: { aiEndpoint: 'http://127.0.0.1:18080', aiModel: 'zoe-local' },
      messages: [
        { role: 'system', content: 'Prompt E o Bicho' },
        { role: 'user', content: 'Olá' },
      ],
      fetchImpl: async (_url, options) => {
        requestBody = JSON.parse(options.body);
        authorization = options.headers.Authorization;
        return new Response(JSON.stringify({
          choices: [{ message: { content: '<think>interno</think>Olá! Como posso ajudar?' } }],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      },
    });
    assert.equal(reply, 'Olá! Como posso ajudar?');
    assert.equal(authorization, 'Bearer test-local-key');
    assert.equal(requestBody.model, 'zoe-local');
    assert.equal(requestBody.chat_template_kwargs.enable_thinking, false);
    assert.equal(requestBody.messages[0].content, 'Prompt E o Bicho');
  } finally {
    if (originalKey === undefined) delete process.env.EOBICHO_LOCAL_AI_API_KEY;
    else process.env.EOBICHO_LOCAL_AI_API_KEY = originalKey;
  }
});

test('endpoint remoto é rejeitado para não expor a IA local', async () => {
  const originalKey = process.env.EOBICHO_LOCAL_AI_API_KEY;
  process.env.EOBICHO_LOCAL_AI_API_KEY = 'test-local-key';
  try {
    await assert.rejects(
      requestCompletion({
        config: { aiEndpoint: 'https://example.com' },
        messages: [{ role: 'user', content: 'Olá' }],
        fetchImpl: async () => new Response('{}'),
      }),
      /endpoint local/
    );
  } finally {
    if (originalKey === undefined) delete process.env.EOBICHO_LOCAL_AI_API_KEY;
    else process.env.EOBICHO_LOCAL_AI_API_KEY = originalKey;
  }
});

test('stripThinking também preserva respostas sem bloco de raciocínio', () => {
  assert.equal(stripThinking('Resposta direta'), 'Resposta direta');
});
