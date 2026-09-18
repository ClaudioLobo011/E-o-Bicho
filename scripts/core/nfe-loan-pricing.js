(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NfeLoanPricing = factory();
})(typeof window === 'undefined' ? this : window, function () {
  const number = (value) => typeof value === 'number' ? value : Number(String(value ?? '').replace(/R\$|\s/g, '').replace(/\.(?=.*[,])/g, '').replace(',', '.'));
  const money = (value) => Number(value.toFixed(2));
  const format = (value, digits = 2) => value.toFixed(digits).replace('.', ',');
  const keyword = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const isLoan = (payload) => ['natureza', 'finalidade'].some((key) => keyword(payload?.metadata?.[key]) === 'emprestimo');
  function priceItem(item, cost) {
    if (cost === null || cost === undefined || String(cost).trim() === '' || !Number.isFinite(number(cost)) || number(cost) < 0) {
      throw new Error(`Produto ${item.code || item.name || ''} sem preco de custo valido. Corrija o cadastro antes de continuar.`);
    }
    const unit = money(number(cost));
    const qty = number(item.qty);
    if (!Number.isFinite(qty) || qty <= 0) throw new Error(`Quantidade invalida no produto ${item.code || ''}.`);
    const gross = money(qty * unit);
    const discount = number(item.discount || 0);
    const total = money(Math.max(0, gross - discount));
    const oldBase = number(item.baseIcms || 0);
    const oldTotal = number(item.total || 0);
    const result = { ...item, unit: format(unit), unitTrib: format(gross / (number(item.qtyTrib) || qty), 10), total: format(total) };
    // Preserve explicitly reduced bases; refresh the normal base and percentage taxes.
    result.baseIcms = format(oldBase && oldTotal ? total * oldBase / oldTotal : total);
    for (const [base, rate, value] of [['baseIcms', 'icms', 'valorIcms'], ['baseIpi', 'ipi', 'valorIpi'], ['basePis', 'pis', 'valorPis'], ['baseCofins', 'cofins', 'valorCofins']]) {
      if (base !== 'baseIcms') result[base] = format(number(item[base]) && oldTotal ? total * number(item[base]) / oldTotal : 0);
      result[value] = format(number(result[base]) * number(item[rate] || 0) / 100);
    }
    return result;
  }
  function pricePayload(payload, costs) {
    if (!isLoan(payload)) return payload;
    const items = (payload.items || []).map((item, index) => priceItem(item, costs[index]));
    const sum = (field) => money(items.reduce((total, item) => total + number(item[field] || 0), 0));
    const totals = { ...payload.totals, products: sum('total'), icmsBase: sum('baseIcms'), icmsValue: sum('valorIcms'), ipi: sum('valorIpi'), pis: sum('valorPis'), cofins: sum('valorCofins') };
    totals.totalValue = money(totals.products + number(totals.freight || 0) + number(totals.other || 0));
    const payments = payload.payments && !Array.isArray(payload.payments) ? { ...payload.payments } : payload.payments;
    if (payments && number(payments.totalValue) === number(payload.totals?.totalValue)) payments.totalValue = format(totals.totalValue);
    return { ...payload, items, totals, payments };
  }
  return { number, isLoan, priceItem, pricePayload };
});
