// Server-render the same public product metadata for customers, search and social previews.
const fs = require("node:fs");
const path = require("node:path");
const {
  renderProductMetadata,
} = require("../scripts/product/product-meta.cjs");
const template = fs.readFileSync(
  path.join(__dirname, "../pages/menu-departments-item/product.html"),
  "utf8",
);
module.exports = async function productPage(req, res) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  const id = String(
    req.query?.id ||
      new URL(req.url, "https://www.peteobicho.com.br").searchParams.get(
        "id",
      ) ||
      "",
  );
  if (!/^[a-f0-9]{24}$/i.test(id)) {
    res.statusCode = 404;
    res.setHeader("X-Robots-Tag", "noindex");
    return res.end(template);
  }
  try {
    const response = await fetch(
      `https://api.peteobicho.com.br/api/products/${id}`,
      { signal: AbortSignal.timeout(5000) },
    );
    if (response.status === 404) {
      res.statusCode = 404;
      res.setHeader("X-Robots-Tag", "noindex");
      return res.end(template);
    }
    if (!response.ok) throw new Error("Catalog unavailable");
    const product = await response.json();
    if (product.inativo || product.naoMostrarNoSite) {
      res.statusCode = 404;
      res.setHeader("X-Robots-Tag", "noindex");
      return res.end(template);
    }
    res.setHeader(
      "Cache-Control",
      "public, max-age=0, s-maxage=60, stale-while-revalidate=120",
    );
    return res.end(renderProductMetadata(template, product));
  } catch {
    res.statusCode = 503;
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Retry-After", "60");
    return res.end(template);
  }
};
