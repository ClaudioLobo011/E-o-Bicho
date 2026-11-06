(() => {
  "use strict";
  if (window.storefrontReady) return;
  const version = "20261106-release1";
  const compactHeader =
    document.documentElement.dataset.storefrontHeader === "compact";
  const compactFooter =
    document.documentElement.dataset.storefrontFooter === "compact";
  function script(src) {
    return new Promise((resolve, reject) => {
      const node = document.createElement("script");
      node.src = src;
      node.onload = resolve;
      node.onerror = () => reject(Error("Não foi possível carregar " + src));
      document.head.append(node);
    });
  }
  const stylesheet = document.createElement("link");
  stylesheet.rel = "stylesheet";
  stylesheet.href = "/src/storefront-shell.css?v=" + version;
  document.head.append(stylesheet);
  if (!compactHeader) {
    const cartCSS = document.createElement("link");
    cartCSS.rel = "stylesheet";
    cartCSS.href = "/src/cart-drawer.css?v=" + version;
    document.head.append(cartCSS);
  }
  window.storefrontReady = (async () => {
    const header = document.getElementById("header-placeholder"),
      footer = document.getElementById("footer-placeholder");
    const get = async (name) => {
      const response = await fetch(
        "/components/storefront/" + name + ".html?v=" + version,
        { signal: AbortSignal.timeout(15000), cache: "no-store" },
      );
      if (!response.ok) throw Error("Componente indisponível");
      return response.text();
    };
    const [headerHTML, footerHTML] = await Promise.all([
      get(compactHeader ? "header-compact" : "header"),
      get(compactFooter ? "footer-compact" : "footer"),
    ]);
    if (header) {
      header.innerHTML = headerHTML;
      header.dataset.loaded = "true";
    }
    if (footer) footer.innerHTML = footerHTML;
    const main = document.querySelector("main");
    if (main && !main.id) main.id = "site-main";
    if (header && main) {
      const skip = document.createElement("a");
      skip.className = "skip";
      skip.href = "#" + main.id;
      skip.textContent = "Pular para o conteúdo";
      header.querySelector("header")?.prepend(skip);
    }
    if (!compactHeader && !window.ProductPageUtils)
      await script("/scripts/product/product-utils.js?v=" + version);
    if (!compactHeader && !window.StorefrontShell)
      await script("/scripts/storefront/shell.js?v=" + version);
    if (
      !compactHeader &&
      window.CATALOG_PREVIEW &&
      !window.CheckoutPreviewModel
    )
      await script("/scripts/checkout/model.js?v=" + version);
    if (!compactHeader && window.CATALOG_PREVIEW && !window.PreviewCartStore)
      await script("/scripts/storefront/preview-cart-store.js?v=" + version);
    if (!compactHeader && !window.StorefrontCart)
      await script("/scripts/storefront/cart-drawer.js?v=" + version);
    document.dispatchEvent(new CustomEvent("storefront:ready"));
    return true;
  })().catch((error) => {
    console.error("Cabeçalho e rodapé:", error.message);
    const header = document.getElementById("header-placeholder");
    if (header && !header.children.length)
      header.innerHTML =
        '<div style="padding:20px;font:14px system-ui"><a href="/">E o Bicho · Início</a> · <a href="/pages/nossas-lojas.html">Lojas e contatos</a><p>Não foi possível carregar o menu. Atualize a página para tentar novamente.</p></div>';
    return false;
  });
})();
