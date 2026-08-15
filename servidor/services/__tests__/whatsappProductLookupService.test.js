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
  }, {
    cod: 'MED-PEQUENO',
    codbarras: '7890000000004',
    nome: 'Anti-inflamatorio Exemplo para Caes de Porte Pequeno 20ml',
    custo: 20,
    venda: 42.9,
    especificacoes: { pet: ['Cachorro'], porteRaca: ['Pequeno'] },
    estoques: [{ deposito: mainDeposit._id, quantidade: 5 }],
  }, {
    cod: 'QUAT-SELECT-1',
    codbarras: '7890000000005',
    nome: 'Racao Quatree Select para Caes Adultos de Porte Pequeno 1Kg',
    custo: 20,
    venda: 34.9,
    especificacoes: { pet: ['Cachorro'], idade: ['Adulto'], porteRaca: ['Pequeno'] },
    estoques: [{ deposito: mainDeposit._id, quantidade: 6 }],
  }, {
    cod: 'QUAT-SELECT-3',
    codbarras: '7890000000006',
    nome: 'Racao Quatree Select para Caes Adultos de Porte Pequeno 3Kg',
    custo: 45,
    venda: 69.9,
    especificacoes: { pet: ['Cachorro'], idade: ['Adulto'], porteRaca: ['Pequeno'] },
    estoques: [{ deposito: mainDeposit._id, quantidade: 4 }],
  }, {
    cod: 'QUAT-LIFE-PEQUENO',
    codbarras: '7890000000007',
    nome: 'Racao Quatree Life para Caes Adultos de Porte Pequeno 3Kg',
    custo: 38,
    venda: 59.9,
    especificacoes: { pet: ['Cachorro'], idade: ['Adulto'], porteRaca: ['Pequeno'] },
    estoques: [{ deposito: mainDeposit._id, quantidade: 2 }],
  }, {
    cod: 'RACAO-GATO-ADULTO',
    codbarras: '7890000000008',
    nome: 'Racao Felina Exemplo para Gatos Adultos 3Kg',
    custo: 35,
    venda: 55.9,
    especificacoes: { pet: ['Gato'], idade: ['Adulto'] },
    estoques: [{ deposito: mainDeposit._id, quantidade: 7 }],
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

test('interpreta a frase completa e nao troca racao por medicamento que compartilha o porte', async () => {
  const result = await lookupProductsForMessage({
    storeId: store._id,
    message: 'Quais quatree select para porte pequeno voces tem?',
  });

  assert.deepEqual(result.variants.map((entry) => entry.code).sort(), [
    'QUAT-SELECT-1',
    'QUAT-SELECT-3',
  ]);
  assert.equal(result.variants.some((entry) => entry.code === 'MED-PEQUENO'), false);
  assert.equal(result.variants.some((entry) => entry.code === 'QUAT-LIFE-PEQUENO'), false);
});

test('tolera erro na marca e na linha sem perder os filtros da frase', async () => {
  const result = await lookupProductsForMessage({
    storeId: store._id,
    message: 'Tem quatre selec para cachorro pequeno?',
  });

  assert.deepEqual(result.variants.map((entry) => entry.code).sort(), [
    'QUAT-SELECT-1',
    'QUAT-SELECT-3',
  ]);
});

test('entende consulta por tipo, especie e idade mesmo sem uma marca', async () => {
  const result = await lookupProductsForMessage({
    storeId: store._id,
    message: 'Quais racoes para gatos adultos voces tem?',
  });

  assert.deepEqual(result.variants.map((entry) => entry.code), ['RACAO-GATO-ADULTO']);
  assert.equal(result.variants.some((entry) => entry.code === 'MED-PEQUENO'), false);
});
