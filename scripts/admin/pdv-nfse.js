(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EoBichoNfse = api;
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
  const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const itemsOf = (sale = {}) => [sale.items, sale.fiscalItemsSnapshot, sale.receiptSnapshot?.items, sale.receiptSnapshot?.itens]
    .find((items) => Array.isArray(items) && items.length) || [];
  const isService = (item = {}) => ['service', 'servico', 'serviço'].includes(String(item.itemType || item.tipoItem || item.type || item.kind || '').toLowerCase())
    || Boolean(item.serviceId || item.servicoId || item.servico);
  const classify = (sale) => {
    const items = itemsOf(sale);
    return { services: items.some(isService), products: items.some((item) => !isService(item)) };
  };
  const explicitZero = (value) => ['number', 'string'].includes(typeof value) && String(value).trim() !== '' && Number(value) === 0;
  const complimentaryService = (item = {}) => {
    if (!isService(item) || !(Number(item.quantity ?? item.quantidade ?? item.qtd) > 0)) return false;
    const unit = item.unitPrice ?? item.unitValue ?? item.valorUnitario ?? item.valor ?? item.preco;
    const total = item.totalPrice ?? item.totalValue ?? item.subtotal ?? item.total;
    if (!(explicitZero(unit) || (unit === undefined && explicitZero(total)))) return false;
    if (total !== undefined && !explicitZero(total)) return false;
    return [item.valorSemAjuste, item.baseUnitPrice, item.subtotalSemAjuste, item.baseSubtotal, item.originalSubtotal,
      item.itemDiscountValue, item.descontoItemValor, item.discountValue, item.discount, item.desconto,
      item.itemAdditionValue, item.acrescimoItemValor, item.additionValue, item.addition, item.acrescimo]
      .every((value) => value === undefined || value === null || explicitZero(value));
  };
  const hasChargeableServices = (sale = {}) => {
    const services = itemsOf(sale).filter(isService);
    if (!services.length) return false;
    const discount = sale.receiptSnapshot?.totais?.descontoValor ?? sale.receiptSnapshot?.totais?.desconto ?? sale.discountValue ?? 0;
    const addition = sale.receiptSnapshot?.totais?.acrescimoValor ?? sale.receiptSnapshot?.totais?.acrescimo ?? sale.additionValue ?? 0;
    const allItemsAreServices = itemsOf(sale).every(isService);
    return (allItemsAreServices && (!explicitZero(discount) || !explicitZero(addition)))
      || services.some((item) => !complimentaryService(item));
  };
  const authorized = (doc) => ['authorized', 'emitted', 'autorizada'].includes(doc?.status);
  const safeUrl = (value) => /^https:\/\//i.test(String(value || '')) ? String(value) : '';
  const safeImage = (value) => /^data:image\/(png|jpeg);base64,[a-z\d+/=]+$/i.test(String(value || '')) ? String(value) : '';

  async function request({ baseUrl, pdvId, saleId, token, method = 'GET', preview = false, body = {} }) {
    const response = await fetch(`${baseUrl}/pdvs/${encodeURIComponent(pdvId)}/sales/${encodeURIComponent(saleId)}/nfse${preview ? '/preview' : ''}`, {
      method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(method === 'GET' ? {} : { body: JSON.stringify(body) }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(data.message || 'Não foi possível processar a NFS-e.'), { response: data });
    return data;
  }

  function receiptDocuments(sale = {}) {
    const documents = [];
    if (sale.fiscalStatus === 'emitted' && sale.fiscalAccessKey) {
      let issuerName = '';
      const key = String(sale.fiscalAccessKey).replace(/\D/g, '');
      let issuerCnpj = key.length === 44 ? key.slice(6, 20) : '';
      const xml = String(sale.fiscalXmlContent || '');
      if (typeof DOMParser !== 'undefined' && xml && !/<!DOCTYPE|<!ENTITY/i.test(xml)) {
        const parsed = new DOMParser().parseFromString(xml, 'application/xml');
        const issuer = parsed.getElementsByTagNameNS('*', 'emit')[0];
        issuerName = issuer?.getElementsByTagNameNS('*', 'xNome')[0]?.textContent || '';
        issuerCnpj = issuer?.getElementsByTagNameNS('*', 'CNPJ')[0]?.textContent || issuerCnpj;
      }
      documents.push({ label: 'NFC-e • Produtos', number: sale.fiscalNumber, accessKey: sale.fiscalAccessKey,
        series: sale.fiscalSerie || sale.fiscalSeries, protocol: sale.fiscalProtocol,
        issuerName, issuerCnpj,
        environment: sale.fiscalEnvironment, payload: sale.fiscalQrCodeData || '', image: sale.fiscalQrCodeImage || '' });
    }
    for (const doc of sale.nfseDocuments || []) {
      if (!authorized(doc)) continue;
      documents.push({ label: 'NFS-e • Serviços', number: doc.number, accessKey: doc.accessKey,
        issuerName: doc.issuerName || '', issuerCnpj: doc.issuerCnpj || '',
        approximateTaxes: doc.approximateTaxes || null,
        verificationCode: doc.verificationCode, total: doc.total, environment: doc.environment,
        payload: safeUrl(doc.consultationUrl), image: safeImage(doc.qrCodeImage || doc.qrCodeDataUrl) });
    }
    return documents;
  }

  function approximateTaxesMarkup(taxes) {
    if (!taxes || !['percentual', 'simples'].includes(taxes.mode) || !Number.isFinite(taxes.total) || taxes.total < 0) return '';
    const money = (value) => Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const parts = [['federal', 'Federal'], ['state', 'Estadual'], ['municipal', 'Municipal']]
      .filter(([key]) => Number.isFinite(taxes[key]) && taxes[key] >= 0)
      .map(([key, label]) => `${label}: ${escape(money(taxes[key]))}`);
    const source = [taxes.source, taxes.version].filter(Boolean).join(' • ');
    return `<div style="font-size:10px;margin-top:6px">Tributos aproximados dos serviços: ${escape(money(taxes.total))}${parts.length ? `<br>${parts.join(' · ')}` : ''}${source ? `<br>Fonte: ${escape(source)}` : ''}</div>`;
  }

  function receiptMarkup(sale = {}) {
    const docs = receiptDocuments(sale);
    const productWarning = classify(sale).products && sale.fiscalStatus !== 'emitted' ? '<p>NFC-e dos produtos pendente. Consulte o atendimento.</p>' : '';
    return `<section class="receipt__section" style="text-align:center;border-top:1px dashed #222;margin-top:8px;padding-top:8px"><strong>DOCUMENTOS FISCAIS DA VENDA</strong>${productWarning}${docs.map((doc) => `<div style="break-inside:avoid;margin:12px 0;overflow-wrap:anywhere"><strong>${escape(doc.label)}</strong>${doc.issuerName ? `<div>Emitente: ${escape(doc.issuerName)}</div>` : ""}${doc.issuerCnpj ? `<div>CNPJ: ${escape(doc.issuerCnpj)}</div>` : ""}<div>Nota ${escape(doc.number)}${doc.series ? ` • Série ${escape(doc.series)}` : ''}</div>${doc.environment === 'homologacao' ? '<strong>HOMOLOGAÇÃO — SEM VALOR FISCAL</strong>' : ''}<div>${escape(doc.accessKey)}</div>${doc.protocol ? `<div>Protocolo: ${escape(doc.protocol)}</div>` : ''}${doc.verificationCode ? `<div>Verificação: ${escape(doc.verificationCode)}</div>` : ''}${approximateTaxesMarkup(doc.approximateTaxes)}${safeImage(doc.image) ? `<img alt="QR Code ${escape(doc.label)}" src="${safeImage(doc.image)}" style="display:block;width:32mm;height:32mm;margin:5px auto">` : ''}${safeUrl(doc.payload) ? `<div style="font-size:9px"><a href="${escape(doc.payload)}">Consultar documento fiscal</a></div>` : ''}</div>`).join('')}${classify(sale).services && !['authorized', 'emitted', 'not_applicable'].includes(sale.nfseStatus) ? `<p>NFS-e pendente${sale.nfseError ? `: ${escape(sale.nfseError)}` : ''}. Consulte o atendimento.</p>` : ''}${sale.nfseStatus === 'not_applicable' ? `<p>${escape(sale.nfseWarning || 'Serviços gratuitos: não há valor para emitir NFS-e.')}</p>` : ''}<p style="font-size:9px">Comprovante conjunto da venda. Os documentos fiscais permanecem individualizados e disponíveis para consulta.</p></section>`;
  }
  return { itemsOf, isService, classify, complimentaryService, hasChargeableServices, authorized, safeUrl, request, receiptDocuments, approximateTaxesMarkup, receiptMarkup };
});
