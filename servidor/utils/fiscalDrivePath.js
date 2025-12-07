const DEFAULT_COMPANY_SEGMENT = 'Empresa';
const DEFAULT_PDV_SEGMENT = 'PDV';
const ROOT_SEGMENTS = ['Fiscal', 'XMLs'];

const sanitizeSegment = (value, fallback = '') => {
  const baseValue = value === undefined || value === null ? '' : String(value);
  const normalized = baseValue
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\\/:*?"'<>|]+/g, ' ')
    .replace(/[^\w\s-]+/g, ' ')
    .replace(/-+/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  const candidate = normalized || fallback;
  return candidate.slice(0, 255) || fallback || 'Segmento';
};

const resolveCompanySegment = (store = {}) => {
  const fallback = DEFAULT_COMPANY_SEGMENT;
  const source =
    store.nomeFantasia ||
    store.nome ||
    store.razaoSocial ||
    store.cnpj ||
    fallback;
  return sanitizeSegment(source, fallback);
};

const resolvePdvSegment = (pdv = {}) => {
  const fallback = DEFAULT_PDV_SEGMENT;
  const code = pdv.codigo || pdv.nome || pdv._id || '';
  const label = code ? `PDV ${code}` : fallback;
  return sanitizeSegment(label, fallback);
};

const resolveDateSegments = (referenceDate) => {
  const reference =
    referenceDate instanceof Date && !Number.isNaN(referenceDate.getTime())
      ? referenceDate
      : new Date();
  const year = String(reference.getFullYear());
  const month = String(reference.getMonth() + 1).padStart(2, '0');
  const day = String(reference.getDate()).padStart(2, '0');
  return [year, month, day];
};

const buildFiscalDrivePath = ({ store, pdv, emissionDate } = {}) => {
  const companySegment = resolveCompanySegment(store || {});
  const pdvSegment = resolvePdvSegment(pdv || {});
  const dateSegments = resolveDateSegments(emissionDate);
  return [...ROOT_SEGMENTS, companySegment, pdvSegment, ...dateSegments];
};

const normalizeXmlFileBase = (value, fallback = '') => {
  const normalized = sanitizeSegment(value || '', fallback).replace(/\.xml$/i, '');
  return normalized || fallback || 'nfce-documento';
};

const buildFiscalR2Key = ({ store, pdv, emissionDate, accessKey } = {}) => {
  const companySegment = resolveCompanySegment(store || {});
  const pdvSegment = resolvePdvSegment(pdv || {});
  const dateSegments = resolveDateSegments(emissionDate);
  const fileBase = normalizeXmlFileBase(accessKey, 'NFCe');
  const fileName = `${fileBase}.xml`;
  return ['NFCe', companySegment, pdvSegment, ...dateSegments, fileName]
    .filter(Boolean)
    .join('/');
};

module.exports = {
  buildFiscalDrivePath,
  buildFiscalR2Key,
  sanitizeSegment,
};
