const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {
  renderProductMetadata,
} = require("../../../scripts/product/product-meta.cjs");
const template = fs.readFileSync(
  path.resolve(__dirname, "../../../pages/menu-departments-item/product.html"),
  "utf8",
);
const product = {
  _id: "68a609824652d5650cfbbcd3",
  nome: 'Produto <teste> & "seguro"',
  descricao: "Informação original <b>completa</b> $&.",
  venda: 34.9,
  stock: 1,
  imagemPrincipal: "https://cdn.peteobicho.com.br/test.jpg",
  cod: "123",
  marca: "Marca teste",
};
test("server output contains product-specific social metadata and structured price before JavaScript", () => {
  const html = renderProductMetadata(template, product);
  assert.match(
    html,
    /<title>Produto &lt;teste&gt; &amp; &quot;seguro&quot; - E o Bicho<\/title>/,
  );
  assert.match(
    html,
    /property="og:image" content="https:\/\/cdn.peteobicho.com.br\/test.jpg"/,
  );
  assert.match(
    html,
    /<link rel="canonical" href="https:\/\/www.peteobicho.com.br\/pages\/menu-departments-item\/product.html\?id=68a609824652d5650cfbbcd3">/,
  );
  const json = html.match(
    /<script id="product-structured-data" type="application\/ld\+json">([\s\S]*?)<\/script>/,
  )[1];
  const data = JSON.parse(json);
  assert.equal(data.name, product.nome);
  assert.equal(data.offers.price, "34.90");
  assert.equal(data.offers.availability, "https://schema.org/InStock");
  assert.equal(data.aggregateRating, undefined);
  assert.equal(data.custo, undefined);
  assert.equal(data.description, "Informação original completa $&.");
});
test("script closing tags in names cannot break structured data or inject markup", () => {
  const html = renderProductMetadata(template, {
    ...product,
    nome: "</script><img src=x onerror=alert(1)>",
    stock: 0,
  });
  assert.ok(!html.includes("</script><img src=x"));
  const json = html.match(
    /<script id="product-structured-data" type="application\/ld\+json">([\s\S]*?)<\/script>/,
  )[1];
  assert.ok(!json.includes("<"));
  assert.equal(
    JSON.parse(json).offers.availability,
    "https://schema.org/OutOfStock",
  );
});
test("hidden products are not rendered into public metadata", () => {
  assert.equal(
    renderProductMetadata(template, { ...product, naoMostrarNoSite: true }),
    template,
  );
});
test("login returns to the same product and rejects external destinations", () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, "../../../scripts/auth.js"),
    "utf8",
  );
  const a = source.indexOf("function productLoginDestination()"),
    b = source.indexOf("\nlet accountCompletionToken", a);
  const code = source.slice(a, b);
  const destination = (search) => {
    const ctx = vm.createContext({
      URL,
      URLSearchParams,
      window: { location: { origin: "https://www.peteobicho.com.br", search } },
      sessionStorage: { getItem: () => null, removeItem: () => {} },
    });
    vm.runInContext(code, ctx);
    return ctx.productLoginDestination();
  };
  const local = `/pages/menu-departments-item/product.html?id=${product._id}`;
  assert.equal(destination(`?redirect=${encodeURIComponent(local)}`), local);
  for (const url of [
    "https://evil.example/",
    "//evil.example/pages/menu-departments-item/product.html?id=" + product._id,
    "javascript:alert(1)",
    "/pages/admin.html",
  ])
    assert.equal(
      destination("?redirect=" + encodeURIComponent(url)),
      "/index.html",
    );
});
