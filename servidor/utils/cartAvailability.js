const Product = require("../models/Product");
function availableStock(product) {
  if (
    !product ||
    product.inativo ||
    product.naoMostrarNoSite ||
    !(Number(product.venda) > 0)
  )
    return 0;
  if (product.fracionado?.ativo) {
    const items = product.fracionado.itens || [];
    if (!items.length) return 0;
    const values = items.map((item) => {
      const child = item.produto;
      const ratio =
        Number(item.quantidadeOrigem) / Number(item.quantidadeFracionada);
      return child && Number.isFinite(ratio) && ratio > 0
        ? Math.max(0, Number(child.stock) || 0) * ratio
        : 0;
    });
    return Math.floor(Math.min(...values));
  }
  return Math.floor(Math.max(0, Number(product.stock) || 0));
}
async function validateCartProduct(productId, quantity) {
  if (!/^[a-f0-9]{24}$/i.test(String(productId || "")))
    return { status: 400, message: "Produto inválido." };
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 100000)
    return { status: 400, message: "Informe uma quantidade inteira válida." };
  const product = await Product.findById(productId)
    .populate("fracionado.itens.produto")
    .lean();
  if (
    !product ||
    product.inativo ||
    product.naoMostrarNoSite ||
    !(Number(product.venda) > 0)
  )
    return {
      status: 409,
      message: "Este produto não está disponível para compra.",
    };
  const stock = availableStock(product);
  if (quantity > stock)
    return {
      status: 409,
      message: stock
        ? `Estoque atualizado: há ${stock} unidade(s) disponível(is). Confira a sacola.`
        : "Este produto está indisponível no momento.",
      availableStock: stock,
    };
  return null;
}
module.exports = { availableStock, validateCartProduct };
