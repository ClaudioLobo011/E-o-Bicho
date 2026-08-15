const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const Deposit = require('../../models/Deposit');
const Product = require('../../models/Product');
const Store = require('../../models/Store');
const {
  buildInventoryPromptContext,
  clearProductLookupCache,
  lookupProductsForMessage,
  tokenSimilarity,
} = require('../whatsappProductLookupService');

let mongoServer;
let store;
let mainDeposit;
let otherDeposit;

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  [store] = await Store.create([{ nome: 'Loja Estoque' }, { nome: 'Outra Loja' }]);
  const otherStore = await Store.findOne({ nome: 'Outra Loja' });
  [mainDeposit, otherDeposit] = await Deposit.create([{
    codigo: 'DEP-ESTOQUE-1',
    nome: 'Loja Estoque',
    empresa: store._id,
  }, {
    codigo: 'DEP-ESTOQUE-2',
    nome: 'Outra Loja',
    empresa: otherStore._id,
  }]);
  await Product.create([{
    cod: 'CIST-COMUM',
    codbarras: '7890000000001',
    nome: 'Suplemento Alimentar Avert Cistimicin Vet para Cães e Gatos 30 Comprimidos',
    custo: 80,
    venda: 119.9,
    estoques: [
      { deposito: mainDeposit._id, quantidade: 4 },
      { deposito: otherDeposit._id, quantidade: 50 },
    ],
  }, {
    cod: 'CIST-20',
    codbarras: '7890000000002',
    nome: 'Suplemento Alimentar Avert Cistimicin Vet 20 para Cães e Gatos 30 Comprimidos',
    custo: 100,
    venda: 167.9,
    estoques: [{ deposito: mainDeposit._id, quantidade: 9 }],
  }, {
    cod: 'OUTRO',
    codbarras: '7890000000003',
    nome: 'Antipulgas Exemplo 10 kg',
    custo: 20,
    venda: 39.9,
    estoques: [{ deposito: mainDeposit._id, quantidade: 3 }],
  }]);
  clearProductLookupCache();
});

test.after(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

test('busca tolera erro de grafia, agrupa variacoes e usa somente o estoque da loja', async () => {
  const result = await lookupProductsForMessage({
    storeId: store._id,
    message: 'Voces tem cistimissim?',
  });

  assert.ok(result.confidence >= 0.72);
  assert.equal(result.understoodAs, 'cistimicin');
  assert.equal(result.variants.length, 2);
  assert.deepEqual(result.variants.map((entry) => entry.stock).sort((a, b) => a - b), [4, 9]);
  assert.deepEqual(result.variants.map((entry) => entry.label), [
    'Cistimicin Vet — 30 Comprimidos',
    'Cistimicin Vet 20 — 30 Comprimidos',
  ]);
});

test('resposta curta de variacao reaproveita o produto mencionado no historico', async () => {
  const result = await lookupProductsForMessage({
    storeId: store._id,
    message: 'o 20',
    history: [
      { direction: 'incoming', message: 'Tem cistimicin?' },
      { direction: 'outgoing', message: 'Temos o comum e o 20. Qual deles?' },
      { direction: 'incoming', message: 'o 20' },
    ],
  });

  assert.equal(result.understoodAs, 'cistimicin');
  assert.equal(result.variants.length, 2);
});

test('contexto obriga lista por linha e nao mistura estoque com preco', async () => {
  const result = await lookupProductsForMessage({
    storeId: store._id,
    message: 'Tem cistimicin?',
  });
  const context = buildInventoryPromptContext(result);

  assert.match(context, /Cistimicin Vet 20 — 30 Comprimidos \| estoque nesta loja: 9 unidade/);
  assert.match(context, /cada variaÃ§Ã£o disponÃ­vel em uma linha separada/);
  assert.match(context, /Informe preÃ§o somente se o cliente pedir/);
});

test('similaridade diferencia erro pequeno de um produto sem relacao', () => {
  assert.ok(tokenSimilarity('cistimissim', 'cistimicin') > 0.72);
  assert.ok(tokenSimilarity('cistimissim', 'antipulgas') < 0.3);
});
