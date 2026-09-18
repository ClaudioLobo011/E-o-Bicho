const Product = require('../models/Product');
const mongoose = require('mongoose');
const pricing = require('../../scripts/core/nfe-loan-pricing');

async function applyLoanCostPricing(payload) {
  if (!pricing.isLoan(payload)) return payload;
  const costs = await Promise.all((payload.items || []).map(async (item) => {
    let query;
    if (item.productId) {
      if (!mongoose.isValidObjectId(item.productId)) throw new Error('Identificador de produto invalido no emprestimo.');
      query = { _id: item.productId };
    }
    else if (item.code) query = { cod: String(item.code) };
    else throw new Error('Vincule todos os itens do emprestimo a produtos cadastrados.');
    const products = await Product.find(query).select('_id custo').limit(2).lean();
    if (products.length !== 1) throw new Error(`Produto ${item.code || item.productId} nao encontrado ou ambiguo.`);
    return products[0].custo;
  }));
  return pricing.pricePayload(payload, costs);
}
module.exports = { ...pricing, applyLoanCostPricing };
