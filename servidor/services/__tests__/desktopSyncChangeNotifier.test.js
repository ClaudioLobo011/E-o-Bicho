const test = require('node:test');
const assert = require('node:assert/strict');

const { scopesForChange, domainsForChange } = require('../desktopSyncChangeNotifier');

test('avisos operacionais são limitados ao PDV ou empresa afetada', () => {
  assert.deepEqual(scopesForChange({ ns: { coll: 'pdvstatesales' }, fullDocument: { pdv: 'pdv-1' } }), ['pdv:pdv-1']);
  assert.deepEqual(scopesForChange({ ns: { coll: 'pdvstatedeliveryorders' }, fullDocument: { pdv: 'pdv-2' } }), ['pdv:pdv-2']);
  assert.deepEqual(scopesForChange({ ns: { coll: 'appointments' }, fullDocument: { store: 'loja-1' } }), ['company:loja-1']);
  assert.deepEqual(scopesForChange({ ns: { coll: 'deposits' }, fullDocument: { empresa: 'loja-2' } }), ['company:loja-2']);
  assert.deepEqual(scopesForChange({ ns: { coll: 'pdvs' }, fullDocument: { _id: 'pdv-3' } }), ['pdv:pdv-3']);
  assert.deepEqual(scopesForChange({ ns: { coll: 'pdvstates' }, fullDocument: { pdv: 'pdv-3' } }), ['pdv:pdv-3']);
  assert.deepEqual(scopesForChange({ ns: { coll: 'paymentmethods' }, fullDocument: { company: 'loja-2' } }), ['company:loja-2']);
  assert.deepEqual(scopesForChange({
    ns: { coll: 'transfers' },
    fullDocument: { originCompany: 'loja-1', destinationCompany: 'loja-2' },
  }), ['company:loja-1', 'company:loja-2']);
});

test('cadastros compartilhados continuam avisando todos os PDVs', () => {
  for (const coll of ['products', 'users', 'pets', 'useraddresses', 'services', 'stores']) {
    assert.deepEqual(scopesForChange({ ns: { coll }, fullDocument: {} }), ['all']);
  }
});

test('exclusões de funcionário são restritas às empresas e clientes permanecem globais', () => {
  assert.deepEqual(scopesForChange({
    ns: { coll: 'pdvdesktopsynctombstones' },
    fullDocument: { entity: 'employee', companies: ['loja-1', 'loja-1', 'loja-2'] },
  }), ['company:loja-1', 'company:loja-2']);
  assert.deepEqual(scopesForChange({
    ns: { coll: 'pdvdesktopsynctombstones' },
    fullDocument: { entity: 'customer', companies: ['loja-1'] },
  }), ['all']);
});

test('mudança sem documento completo usa aviso global como proteção', () => {
  assert.deepEqual(scopesForChange({ ns: { coll: 'pdvstatesales' } }), ['all']);
  assert.deepEqual(scopesForChange({ ns: { coll: 'appointments' } }), ['all']);
});

test('alteração de usuário avisa somente o diretório correspondente', () => {
  assert.deepEqual(domainsForChange({ ns: { coll: 'users' }, fullDocument: { role: 'cliente', codigoCliente: 10 } }), ['customers']);
  assert.deepEqual(domainsForChange({ ns: { coll: 'users' }, fullDocument: { role: 'funcionario', grupos: ['esteticista'] } }), ['employees']);
  assert.deepEqual(domainsForChange({ ns: { coll: 'users' } }), ['customers', 'employees']);
  assert.deepEqual(domainsForChange({ ns: { coll: 'products' }, fullDocument: {} }), ['products']);
  assert.deepEqual(domainsForChange({ ns: { coll: 'paymentmethods' }, fullDocument: {} }), ['configuration']);
  assert.deepEqual(domainsForChange({ ns: { coll: 'professionalcommissionconfigs' }, fullDocument: {} }), ['employees']);
  assert.deepEqual(scopesForChange({ ns: { coll: 'users' }, fullDocument: { role: 'cliente', empresaPrincipal: 'loja-1' } }), ['all']);
  assert.deepEqual(scopesForChange({ ns: { coll: 'users' }, fullDocument: { role: 'funcionario', empresas: ['loja-1', 'loja-2'] } }), ['company:loja-1', 'company:loja-2']);
});
