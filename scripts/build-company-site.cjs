const fs = require('node:fs');
const path = require('node:path');
const { DEFAULT_COMPANY } = require('./core/config');
const { resolveSiteCompany, companyPage } = require('./core/site-company.cjs');

const company = resolveSiteCompany();
const root = path.join(__dirname, '..');
const buildRoot = path.join(root, '.codex-output', 'sites');
fs.mkdirSync(buildRoot, { recursive: true });
const output = fs.mkdtempSync(path.join(buildRoot, company.id + '-'));
const sharedDirectories = ['api', 'components', 'data', 'pages', 'public', 'scripts', 'src'];
const legacy = company.id === DEFAULT_COMPANY;

for (const directory of sharedDirectories) {
  fs.cpSync(path.join(root, directory), path.join(output, directory), {
    recursive: true,
    filter(source) {
      const relative = path.relative(root, source).replaceAll(path.sep, '/');
      if (fs.lstatSync(source).isSymbolicLink() || relative.split('/').some(part => part.startsWith('.'))) return false;
      if (!legacy && ['public/downloads', 'public/updates', 'public/image/logo.svg', 'public/image/logo.png'].includes(relative)) return false;
      return !/\.(bak|log)(?:_|$)/i.test(relative);
    },
  });
}
for (const name of ['index.html', 'package.json', 'package-lock.json', 'nfeschema_v400.zip', '.vercelignore']) {
  fs.copyFileSync(path.join(root, name), path.join(output, name));
}

const routes = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
if (!legacy) routes.redirects = routes.redirects.filter(({ source }) => !/^\/public\/(downloads|updates)\//.test(source));
fs.writeFileSync(path.join(output, 'vercel.json'), JSON.stringify(routes, null, 2) + '\n');

const browserConfig = path.join(output, 'scripts', 'core', 'config.js');
const source = fs.readFileSync(browserConfig, 'utf8');
const publicationMarker = 'const PUBLISHED_COMPANY = null;';
if (!source.includes(publicationMarker)) throw new Error('Use o código-fonte para preparar uma publicação.');
fs.writeFileSync(browserConfig, source.replace(publicationMarker, 'const PUBLISHED_COMPANY = ' + JSON.stringify(company.id) + ';'));

function renderPage(route) {
  const target = path.join(output, route.slice(1));
  const html = fs.readFileSync(target, 'utf8');
  const { html: rendered } = companyPage(root, route, company, () => html);
  if (rendered !== html) fs.writeFileSync(target, rendered);
}

renderPage('/index.html');
for (const directory of ['pages', 'components']) {
  for (const entry of fs.readdirSync(path.join(output, directory), { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.html')) continue;
    renderPage('/' + path.relative(output, path.join(entry.parentPath, entry.name)).replaceAll(path.sep, '/'));
  }
}
console.log('Publicação preparada em ' + output);
