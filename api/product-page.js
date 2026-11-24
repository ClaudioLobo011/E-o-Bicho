// Server-render the same public product metadata for customers, search and social previews.
const fs = require("node:fs");
const path = require("node:path");
const {
  renderProductMetadata,
} = require("../scripts/product/product-meta.cjs");
const { resolveSiteCompany, renderCompanyHtml } = require("../scripts/core/site-company.cjs");
const template = fs.readFileSync(
  path.join(__dirname, "../pages/menu-departments-item/product.html"),
  "utf8",
);
module.exports = async function productPage(req, res) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  let page = template;
  try {
    const company = req.siteCompany || resolveSiteCompany({ published: true });
    if (req.siteCompany) page = renderCompanyHtml(template, company);
    const id = String(req.query?.id || new URL(req.url, company.apiUrl).searchParams.get("id") || "");
    if (!/^[a-f0-9]{24}$/i.test(id)) {
      res.statusCode = 404;
      res.setHeader("X-Robots-Tag", "noindex");
      return res.end(page);
    }
    const response = await fetch(
      `${company.apiUrl}/api/products/${id}`,
      { signal: AbortSignal.timeout(5000) },
    );
    if (response.status === 404) {
      res.statusCode = 404;
      res.setHeader("X-Robots-Tag", "noindex");
      return res.end(page);
    }
    if (!response.ok) throw new Error("Catalog unavailable");
    const product = await response.json();
    if (product.inativo || product.naoMostrarNoSite) {
      res.statusCode = 404;
      res.setHeader("X-Robots-Tag", "noindex");
      return res.end(page);
    }
    res.setHeader(
      "Cache-Control",
      "public, max-age=0, s-maxage=60, stale-while-revalidate=120",
    );
    return res.end(renderProductMetadata(page, product, company));
  } catch {
    res.statusCode = 503;
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Retry-After", "60");
    return res.end(page);
  }
};
