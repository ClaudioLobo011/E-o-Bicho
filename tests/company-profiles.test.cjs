const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const http = require('node:http');
const vm = require('node:vm');
const { setTimeout: delay } = require('node:timers/promises');
const test = require('node:test');
const { resolveSiteCompany } = require('../scripts/core/site-company.cjs');

const productId = '68a609824652d5650cfbbcd3';
const categoryId = '68a609824652d5650cfbbcd4';
const leafId = '68a609824652d5650cfbbcd6';
const expected = [
  { id: 'e_o_bicho', brand: 'E o Bicho', product: 'Produto Teste EoBicho', database: 'test' },
  { id: 'palace_do_pet', brand: 'Palace do Pet', product: 'Produto Teste Palace', database: 'palace_do_pet' },
];

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return 'http://127.0.0.1:' + server.address().port;
}

async function runSite(t, profile) {
  const categories = [{ _id: categoryId, nome: 'Cachorro' }, { _id: leafId, nome: 'Brinquedos', parent: categoryId }];
  const product = { _id: productId, categorias: [leafId], nome: profile.product, venda: 30, stock: 1, imagemPrincipal: '/uploads/catalogo.jpg' };
  const sibling = { ...product, _id: '68a609824652d5650cfbbcd5', nome: 'Relacionado ' + profile.brand };
  const upstream = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const responses = {
      ['/api/products/' + productId]: product,
      '/api/products': { products: [product], pages: 1 },
      '/api/products/by-category': { products: [product, sibling] },
      '/api/categories': categories,
    };
    res.setHeader('Content-Type', 'application/json');
    if (!Object.hasOwn(responses, pathname)) res.statusCode = 404;
    res.end(JSON.stringify(responses[pathname] || {}));
  });
  t.after(() => upstream.close());
  const upstreamUrl = await listen(upstream);
  const child = spawn(process.execPath, ['scripts/start-static-local.js'], {
    env: { ...process.env, FRONTEND_PORT: '0', SITE_EMPRESA: profile.id, FRONTEND_API_URL: upstreamUrl },
    stdio: ['ignore','pipe','pipe'],
  });
  t.after(() => child.kill());
  let log = '';
  let url;
  child.stdout.on('data', chunk => { log += chunk; url ||= log.match(/http:\/\/localhost:\d+/)?.[0]; });
  child.stderr.on('data', chunk => { log += chunk; });
  for (let i = 0; !url && i < 50 && child.exitCode === null; i++) await delay(50);
  assert.ok(url, log);
  const origin = url.replace('localhost', '127.0.0.1');
  const get = async route => {
    const result = await fetch(origin + route);
    assert.equal(result.status, 200, route);
    return result;
  };
  const configSource = await get('/scripts/core/config.js').then(response => response.text());
  const context = { window: { location: new URL(origin) }, URL, localStorage: { getItem() { throw Error('Sem armazenamento'); } } };
  vm.runInNewContext(configSource, context);
  assert.equal(context.API_CONFIG.BASE_URL, upstreamUrl + '/api');
  assert.equal(context.API_CONFIG.COMPANY.name, profile.brand);
  assert.equal(context.API_CONFIG.COMPANY.database, profile.database);
  const main = await get('/').then(response => response.text());
  const footer = await get('/components/storefront/footer.html').then(response => response.text());
  assert.match(main + footer, new RegExp(profile.brand, 'i'));
  if (profile.id === 'palace_do_pet') {
    assert.doesNotMatch(main + footer, /peteobicho\.com\.br|07\.919\.703|petshopeobichovilaisabel/i);
    assert.equal((await fetch(origin + '/pages/politica-de-privacidade.html')).status, 503);
  }
  const detail = await get('/pages/menu-departments-item/product.html?id=' + productId).then(r => r.text());
  assert.match(detail, new RegExp('<title>' + profile.product + ' - ' + profile.brand + '</title>'));
  assert.ok(detail.includes(upstreamUrl + '/uploads/catalogo.jpg'));
  const catalog = await get('/api/storefront-catalog?category=Cachorro').then(r => r.text());
  assert.ok(catalog.includes(profile.product));
  const related = await get('/api/product-related?id=' + productId).then(r => r.text());
  assert.ok(related.includes(sibling.nome));
  assert.equal((await fetch(origin + '/servidor/.env')).status, 403);
}

test('dois perfis servem marca, catálogo e produtos da API correspondente', async t => {
  await Promise.all(expected.map(profile => runSite(t, profile)));
});

test('publicação sem domínio da empresa falha sem usar a API da E o Bicho', () => {
  assert.throws(() => resolveSiteCompany({ env: { SITE_EMPRESA: 'palace_do_pet' } }), /domínio e a API de Palace do Pet/);
  assert.throws(() => resolveSiteCompany({ env: { SITE_EMPRESA: 'outro' } }), /Empresa desconhecida/);
});
