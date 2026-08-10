const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const port = Number(process.env.FRONTEND_PORT || 5500);
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
  try {
    filename = resolveRequestPath(req.url || '/');
  } catch {
    res.writeHead(400);
    return res.end('Requisição inválida.');
  }
  if (!filename) {
    res.writeHead(403);
    return res.end('Acesso negado.');
  }
  fs.stat(filename, (statError, stats) => {
    if (statError || !stats.isFile()) {
      res.writeHead(404);
      return res.end('Arquivo não encontrado.');
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
  console.log(`Site local disponível em http://localhost:${port}`);
  console.log(`Login: http://localhost:${port}/pages/login.html`);
  console.log('Pressione Ctrl+C para encerrar.');
});
