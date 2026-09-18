function validateProductEdit(payload) {
  if (payload._editor === 'product-workspace-v2'
      && ['stock', 'estoques', 'fracionado'].some((key) => Object.prototype.hasOwnProperty.call(payload, key))
      && payload._confirmInventory !== true) {
    return { field: 'estoques', message: 'Confirme o ajuste de estoque ou fracionamento antes de salvar.' };
  }
  for (const field of ['custo', 'venda', 'precoClube']) {
    if (payload[field] === undefined) continue;
    if (field === 'precoClube' && (payload[field] === null || payload[field] === '')) continue;
    const raw = payload[field];
    const value = typeof raw === 'string' && raw.includes(',') ? Number(raw.replace(/\./g, '').replace(',', '.')) : Number(raw);
    if (raw === null || raw === '' || !Number.isFinite(value) || value < 0) {
      return { field, message: `Informe um valor válido, maior ou igual a zero, para ${field}.` };
    }
  }
  return null;
}
function productEditFilter(id, payload) {
  const filter = { _id: id };
  if (payload._editor === 'product-workspace-v2') {
    if (!payload.expectedUpdatedAt || !Number.isFinite(Date.parse(payload.expectedUpdatedAt))) {
      throw new Error('Recarregue o produto antes de salvar: versão não informada ou inválida.');
    }
    filter.updatedAt = new Date(payload.expectedUpdatedAt);
  }
  return filter;
}
module.exports = { validateProductEdit, productEditFilter };
