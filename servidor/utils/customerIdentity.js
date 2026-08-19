const TECHNICAL_EMAIL_PATTERNS = [
  /^cadastro\.desktop\+.+@eobicho\.local$/i,
  /^cadastro\.clientes\+.+@eobicho\.local$/i,
  /^importacao\.clientes\+.+@eobicho\.local$/i,
  /^whatsapp\..+@eobicho\.local$/i,
];

function digitsOnly(value) {
  return String(value || '').replace(/\D/g, '');
}

function normalizeBrazilPhone(value) {
  let digits = digitsOnly(value);
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) {
    digits = digits.slice(2);
  }
  return digits.length === 10 || digits.length === 11 ? digits : '';
}

function isBrazilianMobile(value) {
  const phone = normalizeBrazilPhone(value);
  return phone.length === 11 && phone[2] === '9';
}

function phoneVariants(value) {
  const phone = normalizeBrazilPhone(value);
  if (!phone) return [];
  const ddd = phone.slice(0, 2);
  const local = phone.slice(2);
  const formatted = local.length === 9
    ? `(${ddd}) ${local.slice(0, 5)}-${local.slice(5)}`
    : `(${ddd}) ${local.slice(0, 4)}-${local.slice(4)}`;
  return [...new Set([phone, `55${phone}`, `+55${phone}`, formatted])];
}

function normalizeCpf(value) {
  const digits = digitsOnly(value);
  return digits.length === 11 ? digits : '';
}

function normalizeCnpj(value) {
  const digits = digitsOnly(value);
  return digits.length === 14 ? digits : '';
}

function isTechnicalEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return TECHNICAL_EMAIL_PATTERNS.some((pattern) => pattern.test(email));
}

function effectiveWebAccountStatus(user = {}) {
  const explicit = String(user.webAccountStatus || '').trim().toLowerCase();
  if (['store_only', 'pending_completion', 'active', 'blocked'].includes(explicit)) return explicit;
  if (String(user.role || '').toLowerCase() !== 'cliente') return 'active';
  return isTechnicalEmail(user.email) ? 'store_only' : 'active';
}

function phoneLookupQuery(value) {
  const normalized = normalizeBrazilPhone(value);
  if (!normalized) return null;
  const variants = phoneVariants(normalized);
  return {
    $or: [
      { celularNormalizado: normalized },
      { celular: { $in: variants } },
    ],
  };
}

module.exports = {
  digitsOnly,
  normalizeBrazilPhone,
  isBrazilianMobile,
  phoneVariants,
  normalizeCpf,
  normalizeCnpj,
  isTechnicalEmail,
  effectiveWebAccountStatus,
  phoneLookupQuery,
};
