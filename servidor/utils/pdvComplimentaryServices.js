'use strict';

const explicitZero = (value) => ['number', 'string'].includes(typeof value)
  && String(value).trim() !== '' && Number.isFinite(Number(value)) && Number(value) === 0;
const absentOrZero = (value) => value === undefined || value === null || explicitZero(value);

// A exceção é para um serviço cadastrado sem cobrança. Desconto integral,
// valores ausentes e valores negativos não tornam um serviço gratuito.
function isComplimentaryServiceItem(item) {
  if (!item || typeof item !== 'object') return false;
  const type = String(item.itemType || item.tipoItem || item.type || item.kind || '').trim().toLowerCase();
  if (!['service', 'servico', 'serviço'].includes(type) && !(item.serviceId || item.servicoId)) return false;
  const quantity = Number(item.quantity ?? item.quantidade ?? item.qtd ?? 0);
  if (!Number.isFinite(quantity) || quantity <= 0) return false;
  const unit = item.unitPrice ?? item.unitValue ?? item.valorUnitario ?? item.valor ?? item.preco;
  const total = item.totalPrice ?? item.totalValue ?? item.subtotal ?? item.total;
  if (!(explicitZero(unit) || (unit === undefined && explicitZero(total)))) return false;
  if (!absentOrZero(total)) return false;
  return [
    item.valorSemAjuste, item.baseUnitPrice, item.subtotalSemAjuste, item.baseSubtotal, item.originalSubtotal,
    item.itemDiscountValue, item.descontoItemValor, item.discountValue, item.discount,
    item.itemAdditionValue, item.acrescimoItemValor, item.additionValue, item.addition,
  ].every(absentOrZero);
}

function isComplimentaryServiceSale(payload) {
  return Array.isArray(payload?.items) && payload.items.length > 0
    && payload.items.every(isComplimentaryServiceItem)
    && explicitZero(payload.totalBruto) && explicitZero(payload.totalLiquido)
    && [payload.total, payload.discountValue, payload.discount, payload.additionValue, payload.addition].every(absentOrZero);
}

module.exports = { isComplimentaryServiceItem, isComplimentaryServiceSale };
