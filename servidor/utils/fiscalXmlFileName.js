const DEFAULT_FALLBACK = 'nfce-documento';

const sanitizeFiscalXmlBaseName = (value, fallback = '') => {
  const baseValue = value === undefined || value === null ? '' : String(value);
  const normalized = baseValue
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^0-9A-Za-z-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .trim();
  const candidate = normalized || fallback || '';
  const limited = candidate.length > 120 ? candidate.slice(0, 120) : candidate;
  return limited;
};

const formatDateForFallback = (date) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return '';
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  const second = String(date.getSeconds()).padStart(2, '0');
  return `${year}${month}${day}-${hour}${minute}${second}`;
};

const buildFallbackBaseName = ({ saleCode, emissionDate } = {}) => {
  const normalizedSaleCode = sanitizeFiscalXmlBaseName(saleCode || '', '');
  const timestamp = formatDateForFallback(emissionDate);
  const parts = ['nfce'];
  if (normalizedSaleCode) {
    parts.push(normalizedSaleCode);
  }
  if (timestamp) {
    parts.push(timestamp);
  }
  return parts.join('-');
};

const buildFiscalXmlFileName = ({ accessKey, saleCode, emissionDate } = {}) => {
  const accessKeyBase = sanitizeFiscalXmlBaseName(accessKey || '', '');
  const fallbackBase = sanitizeFiscalXmlBaseName(
    buildFallbackBaseName({ saleCode, emissionDate }),
    DEFAULT_FALLBACK,
  );
  const baseName = accessKeyBase || fallbackBase || DEFAULT_FALLBACK;
  return baseName.toLowerCase().endsWith('.xml') ? baseName : `${baseName}.xml`;
};

module.exports = {
  buildFiscalXmlFileName,
  sanitizeFiscalXmlBaseName,
};
