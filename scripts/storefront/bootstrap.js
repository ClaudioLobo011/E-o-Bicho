(() => {
  "use strict";
  if (window.storefrontReady) return;
  const version = "20261107-header2";
  const compactHeader =
    document.documentElement.dataset.storefrontHeader === "compact";
  const compactFooter =
    document.documentElement.dataset.storefrontFooter === "compact";
  async function script(src, ready) {
    if (ready?.()) return;
    for (let attempt = 0; attempt < 2; attempt++) {
      try { return await new Promise((resolve, reject) => {
      const node = document.createElement("script");
      const timer = setTimeout(() => { cleanup(); reject(Error('O carregamento do menu demorou mais que o esperado.')); }, 8000);
      function cleanup() { clearTimeout(timer); node.onload = node.onerror = null; }
      node.src = src;
      node.onload = () => { cleanup(); if (ready && !ready()) reject(Error('Não foi possível iniciar o menu.')); else resolve(); };
      node.onerror = () => { cleanup(); reject(Error("Não foi possível carregar " + src)); };
      document.head.append(node);
      }); } catch(error) { if (ready?.()) return; if(attempt) throw error; }
    }
  }
  function configuration() {
    const ready = () => { try { return typeof API_CONFIG === 'object' && Boolean(API_CONFIG.BASE_URL); } catch { return false; } };
    if (ready()) return Promise.resolve();
    return new Promise((resolve,reject) => {
      // The config declares a global const. Wait for the existing script; never inject it twice.
      const node = [...document.scripts].find(s => /\/scripts\/core\/config\.js(?:\?|$)/.test(s.src));
      const finish = () => { cleanup(); if(ready()) resolve(); else reject(Error('Não foi possível carregar a configuração da loja.')); };
      const cleanup = () => { clearTimeout(timer); node?.removeEventListener('load',finish); node?.removeEventListener('error',finish); };
      const timer = setTimeout(finish,8000);
      if (!node) { finish(); return; }
      node.addEventListener('load',finish,{once:true}); node.addEventListener('error',finish,{once:true});
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
      for (let attempt = 0; attempt < 2; attempt++) {
        const controller = new AbortController(); let timer;
        try {
          return await Promise.race([
            (async () => { const response = await fetch('/components/storefront/' + name + '.html?v=' + version, {signal:controller.signal,cache:'no-store'}); if (!response.ok) throw Error('Componente indisponível'); return response.text(); })(),
            new Promise((_, reject) => { timer = setTimeout(() => { reject(Error('O carregamento do menu demorou mais que o esperado.')); controller.abort(); }, 4000); }),
          ]);
        } catch(error) { if (attempt) throw error; }
        finally { clearTimeout(timer); }
      }
    };
    const footerTask = get(compactFooter ? 'footer-compact' : 'footer').then(html => { if(footer) footer.innerHTML = html; }).catch(() => {
      if (footer) footer.innerHTML = '<div class="storefront-shell" style="padding:20px"><a href="/pages/nossas-lojas.html">Lojas e atendimento</a> · <a href="/pages/politica-de-privacidade.html">Privacidade</a></div>';
    });
    await get(compactHeader ? 'header-compact' : 'header').then(html => {
      if (header) { header.innerHTML = html; header.dataset.loaded = 'true'; }
    });
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
      await script("/scripts/product/product-utils.js?v=" + version, () => Boolean(window.ProductPageUtils));
    if (!compactHeader) await configuration();
    if (!compactHeader && !window.StorefrontShell)
      await script("/scripts/storefront/shell.js?v=" + version, () => Boolean(window.StorefrontShell));
    if (
      !compactHeader &&
      window.CATALOG_PREVIEW &&
      !window.CheckoutPreviewModel
    )
      await script("/scripts/checkout/model.js?v=" + version, () => Boolean(window.CheckoutPreviewModel));
    if (!compactHeader && window.CATALOG_PREVIEW && !window.PreviewCartStore)
      await script("/scripts/storefront/preview-cart-store.js?v=" + version, () => Boolean(window.PreviewCartStore));
    if (!compactHeader && !window.StorefrontCart)
      await script("/scripts/storefront/cart-drawer.js?v=" + version, () => Boolean(window.StorefrontCart));
    await footerTask;
    document.dispatchEvent(new CustomEvent("storefront:ready"));
    return true;
  })().catch((error) => {
    console.error("Cabeçalho e rodapé:", error.message);
    const header = document.getElementById("header-placeholder");
    if (header && !header.children.length) {
      header.innerHTML = '<div style="padding:20px;font:14px system-ui"><a href="/">E o Bicho · Início</a> · <a href="/pages/nossas-lojas.html">Lojas e contatos</a><p>Não foi possível carregar o menu. </p></div>';
      const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = 'Tentar novamente'; retry.addEventListener('click', () => location.reload()); header.firstElementChild.append(retry);
    } else if (header) {
      const message = document.createElement('div'); message.className='storefront-shell'; message.setAttribute('role','status'); message.style.cssText='padding:8px 20px;font:12px system-ui;text-align:center;background:#f3f5eb';
      message.append(document.createTextNode('Não foi possível iniciar todos os recursos do menu. '));
      const retry=document.createElement('button');retry.type='button';retry.textContent='Tentar novamente';retry.style.cssText='text-decoration:underline;cursor:pointer';retry.addEventListener('click',()=>location.reload());message.append(retry);header.append(message);
    }
    return false;
  });
})();
