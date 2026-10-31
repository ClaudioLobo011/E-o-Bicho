const U = require("./product-utils");
const escape = (value) =>
  String(value || "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const plain = (value) =>
  String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
function renderProductMetadata(template, product) {
  if (!product || product.inativo || product.naoMostrarNoSite) return template;
  const canonical = `https://www.peteobicho.com.br/pages/menu-departments-item/product.html?id=${product._id}`;
  const description =
    plain(product.descricao) ||
    `${product.nome}. Consulte disponibilidade e entrega no E o Bicho.`;
  const image = U.safeUrl(
    product.imagemPrincipal || "/public/image/placeholder.svg",
    "https://api.peteobicho.com.br",
  );
  let html = template.replace(
    /<title>[\s\S]*?<\/title>/,
    () => `<title>${escape(product.nome)} - E o Bicho</title>`,
  );
  html = html.replace(
    /<meta\b(?=[^>]*\bname="description")[^>]*>/,
    () =>
      `<meta name="description" content="${escape(description.slice(0, 190))}">`,
  );
  for (const [property, value] of Object.entries({
    title: `${product.nome} - E o Bicho`,
    description: description.slice(0, 190),
    image,
    url: canonical,
  })) {
    const pattern = new RegExp(
      `<meta\\b(?=[^>]*\\bproperty="og:${property}")[^>]*>`,
    );
    html = html.replace(
      pattern,
      () => `<meta property="og:${property}" content="${escape(value)}">`,
    );
  }
  html = html.replace(
    /<link\b(?=[^>]*\brel="canonical")[^>]*>/,
    () => `<link rel="canonical" href="${escape(canonical)}">`,
  );
  html = html.replace(
    /(<h1 id="product-title"[^>]*>)[\s\S]*?(<\/h1>)/,
    (_, before, after) => before + escape(product.nome) + after,
  );
  html = html.replace(
    '<div id="product-description" class="pd-description"></div>',
    () =>
      `<div id="product-description" class="pd-description"><p>${escape(description)}</p></div>`,
  );
  const productSchema = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.nome,
    description,
    image,
    sku: String(product.cod || product._id),
    url: canonical,
  };
  if (product.marca)
    productSchema.brand = { "@type": "Brand", name: product.marca };
  if (product.venda > 0)
    productSchema.offers = {
      "@type": "Offer",
      price: U.price(product).unit.toFixed(2),
      priceCurrency: "BRL",
      availability: `https://schema.org/${product.stock > 0 ? "InStock" : "OutOfStock"}`,
      url: canonical,
    };
  const json = JSON.stringify(productSchema).replace(/</g, "\\u003c");
  return html.replace(
    "</head>",
    () =>
      `<script id="product-structured-data" type="application/ld+json">${json}</script>\n</head>`,
  );
}
module.exports = { renderProductMetadata, escape };
