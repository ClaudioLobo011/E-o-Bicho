(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EobichoPaymentMetadata = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const keys = ['fiscalCode', 'codigoFiscal', 'codigoNfce', 'tPag', 'forma', 'indPag', 'paymentIndicator', 'xPag', 'descricao', 'paymentDescription', 'descricaoFiscal', 'tpIntegra', 'integracao', 'integrationType', 'tipoIntegracao', 'CNPJ', 'cnpj', 'acquirerCnpj', 'cnpjCredenciadora', 'tBand', 'bandeira', 'bandeiraCodigo', 'brandCode', 'cAut', 'autorizacao', 'codigoAutorizacao', 'authorizationCode', 'CNPJReceb', 'receiverCnpj', 'idTermPag', 'terminalId'];
  const cardKeys = keys.filter(key => !['fiscalCode', 'codigoFiscal', 'codigoNfce', 'tPag', 'forma', 'indPag', 'paymentIndicator', 'xPag', 'descricao', 'paymentDescription', 'descricaoFiscal'].includes(key));
  const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const first = values => values.find(value => value !== undefined && value !== null && String(value).trim() !== '');
  const pick = (source, fields) => Object.fromEntries(fields.filter(key => ['string', 'number'].includes(typeof source[key]) && String(source[key]).trim() !== '').map(key => [key, source[key]]));
  function metadata(value = {}) {
    const source = object(value);
    const result = pick(source, keys);
    const explicitCode = first([source.fiscalCode, source.codigoFiscal, source.codigoNfce, source.tPag, /^\d{1,2}$/.test(String(source.forma || '').trim()) ? source.forma : undefined]);
    if (explicitCode !== undefined) result.fiscalCode = explicitCode;
    const details = { ...source, ...object(source.cartao), ...object(source.card) };
    const card = { ...pick(object(source.cartao), cardKeys), ...pick(object(source.card), cardKeys) };
    for (const [field, aliases] of Object.entries({ tpIntegra: ['tpIntegra', 'integrationType', 'tipoIntegracao', 'integracao'], CNPJ: ['CNPJ', 'acquirerCnpj', 'cnpjCredenciadora', 'cnpj'], tBand: ['tBand', 'brandCode', 'bandeiraCodigo', 'bandeira'], cAut: ['cAut', 'authorizationCode', 'codigoAutorizacao', 'autorizacao'], CNPJReceb: ['CNPJReceb', 'receiverCnpj'], idTermPag: ['idTermPag', 'terminalId'] })) {
      const value = first(aliases.map(alias => details[alias]));
      if (value !== undefined) card[field] = value;
    }
    if (Object.keys(card).length) result.card = card;
    return result;
  }
  function merge(payment = {}, method = {}) {
    const payload = object(payment.payload);
    const sources = [object(method), payload, object(payment)];
    const result = Object.assign({}, ...sources);
    const fiscal = sources.map(metadata);
    Object.assign(result, ...fiscal);
    const card = Object.assign({}, ...fiscal.map(entry => entry.card || {}));
    if (Object.keys(card).length) result.card = card;
    return result;
  }
  function isCash(payment = {}) {
    const source = merge(payment);
    const explicit = [source.fiscalCode, source.codigoFiscal, source.codigoNfce, source.tPag, source.forma]
      .find(value => value !== undefined && value !== null && /^\d{1,2}$/.test(String(value).trim()));
    if (explicit !== undefined) return String(explicit).padStart(2, '0') === '01';
    const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
    return [source.name, source.nome, source.label, source.type, source.forma]
      .map(normalize).some(value => /\b(dinheiro|cash|especie)\b/.test(value)) ||
      [source.paymentMethodId, source.id].map(normalize).some(value => /^(dinheiro|cash|especie)$/.test(value));
  }
  return { metadata, merge, isCash };
});
