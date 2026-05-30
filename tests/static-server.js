const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const port = Number(process.env.UI_AUDIT_PORT || 4173);

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

http
  .createServer((request, response) => {
    let pathname = decodeURIComponent((request.url || '/').split('?')[0]);
    if (pathname === '/') pathname = '/index.html';

    const filePath = path.resolve(root, pathname.replace(/^\/+/, ''));
    if (!filePath.startsWith(root)) {
      response.writeHead(403);
      response.end('forbidden');
      return;
    }

    fs.stat(filePath, (error, stat) => {
      if (error || !stat.isFile()) {
        response.writeHead(404);
        response.end('not found');
        return;
      }

      response.writeHead(200, {
        'content-type': types[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      });
      fs.createReadStream(filePath).pipe(response);
    });
  })
  .listen(port, '127.0.0.1', () => {
    console.log(`static server listening on http://127.0.0.1:${port}`);
  });
