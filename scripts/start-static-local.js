const http = require('http');
const fs = require('fs');
const path = require('path');
const { DEFAULT_COMPANY } = require('./core/config');
const { resolveSiteCompany, browserConfigSource, companyPage } = require('./core/site-company.cjs');
const productPage = require('../api/product-page');
const productRelated = require('../api/product-related');
const storefrontCatalog = require('../api/storefront-catalog');

const root = path.resolve(__dirname, '..');
const port = Number(process.env.FRONTEND_PORT || 5500);
const profile = resolveSiteCompany({ local: true });
const apiRoutes = {
  '/pages/menu-departments-item/product.html': productPage,
  '/api/product-related': productRelated,
  '/api/storefront-catalog': storefrontCatalog,
};
const publicRoots = new Set(['pages', 'components', 'public', 'scripts', 'src', 'data']);
const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.webp': 'image/webp',
};

function resolveRequestPath(urlValue) {
  const pathname = decodeURIComponent(new URL(urlValue, 'http://localhost').pathname);
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  if (!['index.html', 'nfeschema_v400.zip'].includes(relative) && !publicRoots.has(relative.split('/')[0])) return null;
  if (relative.split(/[\\/]/).some(segment => segment.startsWith('.'))) return null;
  const filename = path.resolve(root, relative);
  if (filename !== root && !filename.startsWith(`${root}${path.sep}`)) return null;
  return filename;
}

const server = http.createServer((req, res) => {
  if (!['GET', 'HEAD'].includes(req.method || '')) {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    return res.end();
  }
  let filename;
  let pathname;
  let company;
  try {
    const requestUrl = new URL(req.url || '/', 'http://localhost:' + port);
    pathname = requestUrl.pathname;
    company = { ...profile, siteUrl: profile.siteUrl || 'http://localhost:' + port };
    filename = resolveRequestPath(pathname);
  } catch {
    res.writeHead(400);
    return res.end('Requisição inválida.');
  }
  if (Object.hasOwn(apiRoutes, pathname)) {
    req.siteCompany = company;
    return void apiRoutes[pathname](req, res);
  }
  if (!filename || (company.id !== DEFAULT_COMPANY && /^\/public\/(downloads|updates)\//.test(pathname))) {
    res.writeHead(403);
    return res.end('Acesso negado.');
  }
  if (filename === path.join(root, 'scripts', 'core', 'config.js')) {
    const config = browserConfigSource(fs.readFileSync(filename, 'utf8'), company);
    res.writeHead(200, {
      'Content-Type': mimeTypes['.js'],
      'Cache-Control': 'no-store',
    });
    return res.end(req.method === 'HEAD' ? undefined : config);
  }
  fs.stat(filename, (statError, stats) => {
    if (statError || !stats.isFile()) {
      res.writeHead(404);
      return res.end('Arquivo não encontrado.');
    }
    if (path.extname(filename) === '.html') {
      try {
        const { status, html } = companyPage(root, pathname, company, () => fs.readFileSync(filename, 'utf8'));
        res.writeHead(status, { 'Content-Type': mimeTypes['.html'], 'Cache-Control': 'no-store' });
        return res.end(req.method === 'HEAD' ? undefined : html);
      } catch {
        res.writeHead(500);
        return res.end('Página indisponível.');
      }
    }
    res.writeHead(200, {
      'Content-Type': mimeTypes[path.extname(filename).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    if (req.method === 'HEAD') return res.end();
    return fs.createReadStream(filename).pipe(res);
  });
});

server.listen(port, '127.0.0.1', () => {
  const actualPort = server.address().port;
  if (!profile.siteUrl) profile.siteUrl = 'http://localhost:' + actualPort;
  console.log(`Site local disponível em http://localhost:${actualPort}`);
  console.log(`Login: http://localhost:${actualPort}/pages/login.html`);
  console.log(`${profile.name} · API da prévia: ${profile.localApiUrl}`);
  console.log('Pressione Ctrl+C para encerrar.');
});
