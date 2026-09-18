const test = require('node:test');
const assert = require('node:assert/strict');
const { validateProductEdit, productEditFilter } = require('../productEditSafety');

test('preços negativos, vazios e inválidos são rejeitados', () => {
  for (const value of [-1, '', null, 'abc', Infinity]) {
    assert.equal(validateProductEdit({ venda: value }).field, 'venda');
  }
  assert.equal(validateProductEdit({ custo: 0, venda: '1.234,56', precoClube: null }), null);
});
test('editor exige versão e inclui a versão no filtro atômico', () => {
  assert.throws(() => productEditFilter('id', { _editor: 'product-workspace-v2' }));
  assert.throws(() => productEditFilter('id', { _editor: 'product-workspace-v2', expectedUpdatedAt: 'invalid' }));
  const updatedAt = '2026-09-16T12:00:00.000Z';
  assert.deepEqual(productEditFilter('id', { _editor: 'product-workspace-v2', expectedUpdatedAt: updatedAt }), { _id: 'id', updatedAt: new Date(updatedAt) });
});
test('consumidores legados mantêm o filtro original', () => {
  assert.deepEqual(productEditFilter('id', {}), { _id: 'id' });
});
test('estoque e fracionamento exigem confirmação no editor novo', () => {
  for (const field of ['stock', 'estoques', 'fracionado']) {
    const payload = { _editor: 'product-workspace-v2', [field]: [] };
    assert.equal(validateProductEdit(payload).field, 'estoques');
    assert.equal(validateProductEdit({ ...payload, _confirmInventory: true }), null);
  }
});

test('API isolada: versão, estoque e validação de preços', { skip: process.env.PRODUCT_TEST_API !== 'http://localhost:3100/api' }, async () => {
  const base = process.env.PRODUCT_TEST_API;
  const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'admin.local@eobicho.test', senha: 'TestePDV123!' }) });
  assert.equal(login.status, 200);
  const { token } = await login.json();
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  const code = String(Date.now());
  const create = await fetch(`${base}/products`, { method: 'POST', headers, body: JSON.stringify({ cod: code, codbarras: code, nome: 'TESTE LOCAL - segurança cadastro', custo: 10, venda: 15, stock: 7 }) });
  assert.equal(create.status, 201);
  const original = (await create.json()).product;
  const endpoint = `${base}/products/${original._id}`;
  const update = (payload) => fetch(endpoint, { method: 'PUT', headers, body: JSON.stringify(payload) });
  const first = await update({ _editor: 'product-workspace-v2', expectedUpdatedAt: original.updatedAt, referencia: 'teste isolado' });
  assert.equal(first.status, 200);
  const saved = await first.json();
  assert.equal(saved.stock, original.stock, 'editar referência não pode alterar saldo');
  const stale = await update({ _editor: 'product-workspace-v2', expectedUpdatedAt: original.updatedAt, nome: 'NAO DEVE GRAVAR' });
  assert.equal(stale.status, 409);
  assert.equal((await update({ venda: -1 })).status, 400);
  assert.equal((await update({ _editor: 'product-workspace-v2', referencia: 'sem versão' })).status, 409);
  const final = await (await fetch(endpoint)).json();
  assert.equal(final.nome, original.nome);
  assert.equal(final.venda, 15);
  assert.equal(final.referencia, 'teste isolado');
  const concurrentPayload = { _editor: 'product-workspace-v2', expectedUpdatedAt: final.updatedAt };
  const concurrent = await Promise.all([
    update({ ...concurrentPayload, referencia: 'concorrente A' }),
    update({ ...concurrentPayload, referencia: 'concorrente B' }),
  ]);
  assert.deepEqual(concurrent.map(r => r.status).sort(), [200, 409]);
  const latest = await (await fetch(endpoint)).json();
  assert.equal((await update({ _editor: 'product-workspace-v2', expectedUpdatedAt: latest.updatedAt, stock: 19 })).status, 400);
  assert.equal((await update({ _editor: 'product-workspace-v2', expectedUpdatedAt: latest.updatedAt, stock: 19, _confirmInventory: true })).status, 200);
  assert.equal((await update({ _editor: 'product-workspace-v2', expectedUpdatedAt: latest.updatedAt, nome: 'ANTIGO' })).status, 409);
  assert.equal((await (await fetch(endpoint)).json()).stock, 19);
});
