const fs = require('node:fs');
const path = require('node:path');
const { DEFAULT_COMPANY, PUBLISHED_COMPANY, getCompany } = require('./config');

function resolveSiteCompany({ local = false, published = false, env = process.env } = {}) {
  const selected = published ? PUBLISHED_COMPANY : env.SITE_EMPRESA || PUBLISHED_COMPANY;
  const company = getCompany(selected || DEFAULT_COMPANY);
  if (!local) {
    if (!company.siteUrl || !company.apiUrl) throw new Error('Defina o domínio e a API de ' + company.name + ' antes de publicar.');
    for (const origin of [company.siteUrl, company.apiUrl]) {
      const url = new URL(origin);
      if (url.protocol !== 'https:' || url.origin !== origin) throw new Error('Use origens HTTPS sem caminho no perfil de ' + company.name);
    }
    if (company.id !== DEFAULT_COMPANY && [getCompany().siteUrl, getCompany().apiUrl].some(origin => [company.siteUrl, company.apiUrl].includes(origin))) {
      throw new Error('O domínio e a API precisam ser exclusivos de ' + company.name);
    }
    return company;
  }
  const api = new URL(env.FRONTEND_API_URL || company.localApiUrl);
  if (!['http:', 'https:'].includes(api.protocol) || api.username || api.password || api.search || api.hash) {
    throw new Error('FRONTEND_API_URL deve ser uma URL HTTP ou HTTPS sem credenciais.');
  }
  const localApiUrl = api.href.replace(/\/+$/, '').replace(/\/api$/i, '');
  return { ...company, apiUrl: localApiUrl, localApiUrl };
}

function browserConfigSource(source, company) {
  const payload = JSON.stringify({ id: company.id, localApiUrl: company.localApiUrl }).replace(/</g, '\\u003c');
  return 'window.LOBOSTI_COMPANY = ' + payload + ';\n' + source;
}

const original = getCompany();
const companySpecificPages = new Set(['/pages/politica-de-privacidade.html', '/pages/ajuda.html']);
const pendingCompanyPage = '<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Página em preparação</title><h1>Página em preparação</h1><p>Os dados desta empresa ainda serão cadastrados.</p></html>';
const escape = value => String(value).replace(/[&<>"']/g, char =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const cdnLink = new RegExp('<link\\b(?=[^>]*\\bhref="' + escapeRegex(original.cdnUrl) + '")[^>]*>', 'gi');
const callbackAddress = new RegExp(escapeRegex(original.callbackUrl) + '/webhooks/(marketplaces|mercadopago)', 'g');
const instagramLink = new RegExp('<a\\b[^>]*href="' + escapeRegex(original.instagramUrl) + '"[^>]*>[\\s\\S]*?<\\/a>', 'gi');
const legacyLegalLine = new RegExp(escapeRegex(original.legalName + ' - CNPJ: ' + original.taxId) + '[^\\r\\n<]*', 'g');

function companyPage(root, route, company, loadTemplate) {
  const override = company.pageOverrides?.[route];
  if (override) {
    const pagesRoot = path.resolve(root, 'pages');
    const file = path.resolve(root, override);
    if (!file.startsWith(pagesRoot + path.sep) || path.extname(file) !== '.html') {
      throw new Error('A página personalizada deve ser um HTML dentro de pages.');
    }
    return { status: 200, html: fs.readFileSync(file, 'utf8') };
  }
  if (company.id !== DEFAULT_COMPANY && companySpecificPages.has(route)) {
    return { status: 503, html: pendingCompanyPage };
  }
  return { status: 200, html: renderCompanyHtml(loadTemplate(), company) };
}

function renderCompanyHtml(html, company) {
  if (company.id === DEFAULT_COMPANY) return html;
  const siteUrl = company.siteUrl;
  const logo = company.logo || '/public/image/placeholder.svg';
  const image = company.socialImage || logo;
  const legal = [company.legalName, company.taxId && 'CNPJ ' + company.taxId].filter(Boolean).join(' · ');
  let output = html
    .replace(/<meta\b(?=[^>]*\bname="facebook-domain-verification")[^>]*>/gi, () =>
      company.facebookDomainVerification
        ? '<meta name="facebook-domain-verification" content="' + escape(company.facebookDomainVerification) + '">'
        : '')
    .replace(cdnLink, tag =>
      company.cdnUrl ? tag.replace(original.cdnUrl, () => escape(company.cdnUrl)) : '')
    .replaceAll(original.siteUrl + original.socialImage, () => escape(siteUrl + image))
    .replaceAll(original.siteUrl + original.logo, () => escape(siteUrl + image))
    .replaceAll(original.siteUrl, () => escape(siteUrl))
    .replaceAll(original.apiUrl, () => escape(company.apiUrl))
    .replace(callbackAddress, (_match, route) =>
      company.callbackUrl ? escape(company.callbackUrl + '/webhooks/' + route) : 'Endereço de webhook em configuração')
    .replaceAll(original.socialImage, () => escape(image))
    .replaceAll(original.logo, () => escape(logo))
    .replaceAll(original.legalName + ' · CNPJ ' + original.taxId, () => escape(legal))
    .replace(legacyLegalLine, () => escape(legal))
    .replaceAll(original.legalName, () => escape(company.legalName || company.name))
    .replaceAll(original.locationLabel, () => escape(company.locationLabel))
    .replaceAll(' e lojas na Tijuca e em Vila Isabel', '')
    .replaceAll(' e conheça nossas lojas na Tijuca e em Vila Isabel, Rio de Janeiro', '')
    .replaceAll('Lojas na Tijuca e em Vila Isabel', 'Conheça nossas lojas')
    .replaceAll('nossas lojas na Tijuca e em Vila Isabel', 'nossas lojas')
    .replace(/\bE o Bicho\b/gi, () => escape(company.name));
  if (company.instagramUrl) output = output.replaceAll(original.instagramUrl, () => escape(company.instagramUrl));
  else output = output.replace(instagramLink, '');
  return output;
}

module.exports = { resolveSiteCompany, browserConfigSource, renderCompanyHtml, companyPage };
