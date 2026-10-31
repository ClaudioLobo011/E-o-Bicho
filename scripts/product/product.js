/* Product page: public reads, explicit account actions, no catalog mutations. */
(() => {
  "use strict";
  const U = ProductPageUtils;
  const $ = (id) => document.getElementById(id);
  const state = {
    product: null,
    imageIndex: 0,
    images: [],
    busy: false,
    loaded: false,
    favorite: false,
    community: null,
    quote: null,
  };
  const id = new URLSearchParams(location.search).get("id") || "";
  const canonical = `https://www.peteobicho.com.br/pages/menu-departments-item/product.html?id=${encodeURIComponent(id)}`;
  const readStorage = (key, fallback) => {
    try {
      return JSON.parse(localStorage.getItem(key)) ?? fallback;
    } catch {
      return fallback;
    }
  };
  const writeStorage = (key, value) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* browsing still works without storage */
    }
  };
  const user = () => readStorage("loggedInUser", null);
  function account() {
    if (user()?.token && user()?.id) return true;
    try {
      sessionStorage.setItem(
        "productReturnUrl",
        location.pathname + location.search,
      );
    } catch {
      /* the return URL is also in the login link */
    }
    location.href = `/pages/login.html?redirect=${encodeURIComponent(location.pathname + location.search)}`;
    return false;
  }
  function element(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  }
  function track(event, extra = {}) {
    // The existing analytics provider may consume these events. No personal data or new trackers.
    const detail = {
      event,
      ecommerce: {
        currency: "BRL",
        items: [
          {
            item_id: id,
            item_name: state.product?.nome || "",
            price: U.price(state.product).unit,
            quantity: U.quantity(
              $("product-quantity").value,
              state.product?.stock,
            ),
          },
        ],
      },
      ...extra,
    };
    if (Array.isArray(window.dataLayer)) window.dataLayer.push(detail);
    window.dispatchEvent(new CustomEvent("eobicho:product-event", { detail }));
    if (
      /^[a-f0-9]{24}$/i.test(id) &&
      navigator.doNotTrack !== "1" &&
      !navigator.globalPrivacyControl
    ) {
      fetch(`${API_CONFIG.BASE_URL}/product-experience/${id}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event,
          device: matchMedia("(max-width: 767px)").matches
            ? "mobile"
            : "desktop",
        }),
        keepalive: true,
      }).catch(() => {});
    }
  }
  async function request(path, options = {}) {
    const { timeout = 18000, ...rest } = options;
    const headers = { Accept: "application/json", ...rest.headers };
    if (rest.body) headers["Content-Type"] = "application/json";
    let response;
    try {
      response = await fetch(`${API_CONFIG.BASE_URL}${path}`, {
        ...rest,
        headers,
        signal: AbortSignal.timeout(timeout),
      });
    } catch (e) {
      throw new Error(
        e.name === "TimeoutError"
          ? "A consulta demorou mais que o esperado. Tente novamente."
          : "Não foi possível conectar. Verifique sua conexão e tente novamente.",
      );
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const e = new Error(
        data.message || "Não foi possível concluir. Tente novamente.",
      );
      e.status = response.status;
      e.data = data;
      throw e;
    }
    return data;
  }
  const authorized = (path, options = {}) =>
    request(path, {
      ...options,
      headers: { Authorization: `Bearer ${user()?.token}`, ...options.headers },
    });
  function imageUrl(value) {
    return U.safeUrl(
      value || "/public/image/placeholder.svg",
      API_CONFIG.SERVER_URL,
    );
  }
  function imageFallback(img) {
    img.addEventListener("error", () => {
      if (img.dataset.fallback !== "true") {
        img.dataset.fallback = "true";
        img.src = "/public/image/placeholder.svg";
      }
    });
  }
  function setImage(index) {
    if (!state.images.length) return;
    state.imageIndex = (index + state.images.length) % state.images.length;
    const src = state.images[state.imageIndex];
    for (const imageId of ["main-product-image", "zoomed-image"]) {
      const img = $(imageId);
      delete img.dataset.fallback;
      img.src = src;
      img.alt = `${state.product.nome} — foto ${state.imageIndex + 1}`;
    }
    $("image-counter").textContent =
      state.images.length > 1
        ? `${state.imageIndex + 1} de ${state.images.length} fotos`
        : "";
    $("zoom-counter").textContent =
      `${state.imageIndex + 1} / ${state.images.length}`;
    $("thumbnail-gallery")
      .querySelectorAll("button")
      .forEach((btn, i) =>
        btn.setAttribute("aria-pressed", String(i === state.imageIndex)),
      );
  }
  function renderGallery(p) {
    state.images = [
      ...new Set(
        [p.imagemPrincipal, ...(Array.isArray(p.imagens) ? p.imagens : [])]
          .filter(Boolean)
          .map(imageUrl)
          .filter(Boolean),
      ),
    ];
    if (!state.images.length) state.images = ["/public/image/placeholder.svg"];
    $("thumbnail-gallery").replaceChildren();
    $("thumbnail-gallery").hidden = state.images.length < 2;
    state.images.forEach((src, index) => {
      const btn = element("button", "pd-thumbnail");
      btn.type = "button";
      btn.setAttribute("aria-label", `Ver foto ${index + 1} de ${p.nome}`);
      btn.setAttribute("aria-pressed", String(index === 0));
      const img = element("img");
      img.src = src;
      img.alt = "";
      img.width = 68;
      img.height = 72;
      img.loading = "lazy";
      img.decoding = "async";
      imageFallback(img);
      btn.append(img);
      btn.addEventListener("click", () => setImage(index));
      $("thumbnail-gallery").append(btn);
    });
    for (const name of [
      "previous-image",
      "next-image",
      "zoom-prev",
      "zoom-next",
    ])
      $(name).hidden = state.images.length < 2;
    $("zoom-product").disabled = false;
    setImage(0);
  }
  function description(p) {
    const container = $("product-description");
    container.replaceChildren();
    const raw = String(p.descricao || "").trim();
    if (!raw) {
      container.append(
        element(
          "p",
          null,
          "Ainda não há uma descrição detalhada cadastrada. Consulte a ficha técnica ou fale com a nossa equipe.",
        ),
      );
      return;
    }
    // Rebuild with a strict semantic allowlist. No source attributes, scripts, styles, images or iframes.
    const parsed = new DOMParser().parseFromString(raw, "text/html");
    const allowed = new Set([
      "P",
      "BR",
      "UL",
      "OL",
      "LI",
      "STRONG",
      "EM",
      "B",
      "I",
      "H2",
      "H3",
      "H4",
      "TABLE",
      "THEAD",
      "TBODY",
      "TR",
      "TH",
      "TD",
      "A",
    ]);
    const blocked = new Set([
      "SCRIPT",
      "STYLE",
      "IFRAME",
      "OBJECT",
      "EMBED",
      "SVG",
      "MATH",
      "FORM",
      "INPUT",
      "BUTTON",
      "TEMPLATE",
      "NOSCRIPT",
    ]);
    function clean(node, target) {
      if (node.nodeType === Node.TEXT_NODE) {
        target.append(document.createTextNode(node.textContent));
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE || blocked.has(node.tagName))
        return;
      if (!allowed.has(node.tagName)) {
        for (const child of node.childNodes) clean(child, target);
        return;
      }
      const tag = /^H[24]$/.test(node.tagName)
        ? "h3"
        : node.tagName.toLowerCase();
      const el = document.createElement(tag);
      if (tag === "a") {
        const href = U.safeUrl(node.getAttribute("href"), canonical);
        if (href) {
          el.href = href;
          el.target = "_blank";
          el.rel = "noopener noreferrer";
        }
      }
      for (const child of node.childNodes) clean(child, el);
      target.append(el);
    }
    if (/<(?:p|ul|ol|li|table|h[234])\b/i.test(raw)) {
      for (const node of parsed.body.childNodes) clean(node, container);
    } else {
      const fragment = document.createDocumentFragment();
      for (const node of parsed.body.childNodes) clean(node, fragment);
      // Preserve every line and every sentence; never truncate or split on punctuation.
      const temp = element("div");
      temp.append(fragment);
      temp.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
      let list = null;
      for (const line of temp.textContent
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean)) {
        if (/^[-•–]\s*/.test(line)) {
          if (!list) {
            list = element("ul");
            container.append(list);
          }
          list.append(element("li", null, line.replace(/^[-•–]\s*/, "")));
        } else {
          list = null;
          container.append(element("p", null, line));
        }
      }
    }
    if (!container.textContent.trim())
      container.append(
        element(
          "p",
          null,
          "Consulte as informações na embalagem ou fale com a nossa equipe.",
        ),
      );
  }
  function renderSpecs(p) {
    const specs = U.specifications(p);
    $("product-specs-list").replaceChildren();
    for (const [label, value] of specs) {
      const row = element("div", "pd-spec-row");
      row.append(element("dt", null, label), element("dd", null, value));
      $("product-specs-list").append(row);
    }
    if (!specs.length)
      $("product-specs-list").append(
        element(
          "p",
          "pd-muted",
          "Consulte a embalagem para informações técnicas.",
        ),
      );
    const highlights = [];
    const spec = p.especificacoes || {};
    if (spec.pet?.length || spec.tipo?.length)
      highlights.push(
        `Indicado para ${(spec.pet?.length ? spec.pet : spec.tipo).join(" e ")}`,
      );
    if (spec.apresentacao)
      highlights.push(`Apresentação: ${spec.apresentacao}`);
    if (spec.idade?.length)
      highlights.push(`Fase de vida: ${spec.idade.join(", ")}`);
    $("product-highlights").replaceChildren(
      ...highlights.map((text) => element("li", null, text)),
    );
    $("product-highlights").hidden = !highlights.length;
    $("medicine-notice").hidden = !U.medicine(p);
    $("related-notice").hidden = !U.medicine(p);
    if (spec.apresentacao) {
      const current = element("span", "pd-variant", spec.apresentacao);
      current.setAttribute("aria-current", "true");
      $("variant-options").replaceChildren(current);
      $("product-variants").hidden = false;
    }
  }
  function breadcrumb(p) {
    const root = $("breadcrumb-container");
    root.replaceChildren();
    const home = element("li");
    const a = element("a", null, "Início");
    a.href = "/";
    home.append(a);
    root.append(home);
    for (const category of p.breadcrumbPath || []) {
      const li = element("li");
      const link = element("a", null, category.nome);
      const href = U.safeUrl(category.href, location.origin);
      if (href && new URL(href).origin === location.origin) link.href = href;
      li.append(link);
      root.append(li);
    }
    const current = element("li", null, p.nome);
    current.setAttribute("aria-current", "page");
    root.append(current);
  }
  function promotions(p) {
    const panel = $("product-promotions-panel");
    panel.replaceChildren();
    const club = U.number(p.precoClube);
    const normal = U.price(p);
    if (club > 0 && club < normal.unit) {
      const line = element("p");
      line.append(element("strong", null, `${U.money(club)} com Preço Clube`));
      panel.append(
        line,
        element(
          "p",
          null,
          "Disponível ao ativar a assinatura deste item na sacola.",
        ),
      );
      const label = element("label");
      const check = element("input");
      check.type = "checkbox";
      check.id = "product-subscription";
      check.addEventListener("change", () => {
        updatePurchase();
        track("select_subscription", { subscribed: check.checked });
      });
      label.append(
        check,
        element(
          "span",
          null,
          "Adicionar este item com assinatura e Preço Clube",
        ),
      );
      panel.append(label);
      const details = element("details");
      const sum = element("summary", null, "Como esse preço é aplicado?");
      details.append(
        sum,
        element(
          "p",
          null,
          "Ao marcar esta opção, a assinatura deste item será ativada na sacola. O sistema aplica a condição mais vantajosa disponível; os descontos não são somados. Confira os detalhes antes de finalizar.",
        ),
      );
      panel.append(details);
    }
    const c = p.promocaoCondicional;
    if (U.active(c)) {
      let text = "";
      if (
        c.tipo === "leve_pague" &&
        c.leve > 0 &&
        c.pague >= 0 &&
        c.pague < c.leve
      )
        text = `Leve ${c.leve}, pague ${c.pague}.`;
      if (
        c.tipo === "acima_de" &&
        c.quantidadeMinima > 0 &&
        c.descontoPorcentagem > 0 &&
        c.descontoPorcentagem <= 100
      )
        text = `${c.descontoPorcentagem}% de desconto a partir de ${c.quantidadeMinima} unidades.`;
      if (text) {
        const line = element("p");
        line.append(element("strong", null, text));
        panel.append(
          line,
          element(
            "p",
            null,
            c.produtosDiferentes
              ? "Válido para produtos participantes do mesmo grupo. O desconto é calculado na sacola."
              : "O desconto é calculado na sacola para a quantidade participante.",
          ),
        );
      }
    }
    panel.hidden = !panel.children.length;
    $("discount-answer").textContent = panel.children.length
      ? `${panel.textContent} Os descontos não são cumulativos; a sacola calcula a melhor condição disponível.`
      : "O preço exibido é o preço de compra avulsa. Se houver promoção ativa, ela aparece junto ao valor. Confira o total na sacola antes de finalizar.";
  }
  const subscribed = () => Boolean($("product-subscription")?.checked);
  function updatePurchase() {
    const p = state.product;
    if (!p) return;
    const qty = U.quantity($("product-quantity").value, p.stock);
    $("product-quantity").value = qty;
    const stock = Math.max(0, Math.floor(U.number(p.stock)));
    const valid =
      Number.isFinite(Number(p.venda)) &&
      Number(p.venda) > 0 &&
      !p.inativo &&
      !p.naoMostrarNoSite;
    const available = stock > 0 && valid;
    const pricing = U.price(p, qty, subscribed());
    $("stock-status").textContent = available
      ? "Disponível em estoque"
      : !valid
        ? "Compra indisponível"
        : "Indisponível no momento";
    $("stock-status").classList.toggle("unavailable", !available);
    $("purchase-controls").hidden = !available;
    $("restock-panel").hidden = stock > 0 || !valid;
    $("quantity-help").textContent = available
      ? stock === 1
        ? "1 unidade disponível."
        : `Até ${stock} unidades disponíveis.`
      : "";
    $("product-quantity").disabled = !available || state.busy;
    $("product-quantity").max = stock;
    $("decrease-quantity").disabled = !available || state.busy || qty <= 1;
    $("increase-quantity").disabled = !available || state.busy || qty >= stock;
    $("quantity-total").hidden = qty < 2;
    $("quantity-total").textContent =
      `${qty} unidades · subtotal estimado ${U.money(pricing.total)}${pricing.label ? ` · ${pricing.label}` : ""}`;
    for (const buttonId of ["add-to-cart", "mobile-add-to-cart"])
      $(buttonId).disabled = !available || state.busy;
    $("add-to-cart").querySelector("span").textContent = state.busy
      ? "Adicionando…"
      : "Adicionar à sacola";
    $("mobile-add-to-cart").textContent = state.busy
      ? "Adicionando…"
      : available
        ? "Adicionar à sacola"
        : stock === 0 && valid
          ? $("notify-restock").dataset.subscribed === "true"
            ? "Cancelar aviso"
            : "Avise-me"
          : "Indisponível";
    if (!available && valid && stock === 0)
      $("mobile-add-to-cart").disabled = state.busy;
    $("mobile-product-name").textContent = p.nome;
    $("mobile-price").textContent = valid
      ? U.money(pricing.unit)
      : "Consulte a loja";
    $("mobile-purchase-bar").hidden = !state.loaded;
    const price = $("product-price");
    price.replaceChildren();
    if (valid) {
      if (pricing.unit < pricing.base)
        price.append(element("del", null, U.money(pricing.base)));
      price.append(element("strong", null, U.money(pricing.unit)));
      if (pricing.saving > 0)
        price.append(
          element(
            "span",
            "pd-discount",
            `Economize ${U.money(pricing.saving)}`,
          ),
        );
    } else price.append(element("strong", null, "Consulte a loja"));
    const perUnit = valid ? U.unitPrice(p, pricing.unit) : "";
    $("unit-price").textContent = perUnit;
    $("unit-price").hidden = !perUnit;
    $("photo-badge").hidden = !pricing.label;
    $("photo-badge").textContent = pricing.label;
  }
  async function loadProduct() {
    if (!/^[a-f0-9]{24}$/i.test(id)) {
      showError(
        "Produto não encontrado",
        "O endereço não contém um produto válido.",
        false,
      );
      return;
    }
    $("product-error").hidden = true;
    $("product-details-container").hidden = false;
    $("product-details-container").setAttribute("aria-busy", "true");
    try {
      const p = await request(`/products/${id}`);
      if (!p._id || p.inativo || p.naoMostrarNoSite) {
        showError(
          "Produto indisponível",
          "Este produto não está disponível na loja virtual.",
          false,
        );
        return;
      }
      state.product = p;
      state.loaded = true;
      $("product-title").textContent = p.nome;
      $("product-sku").textContent = p.cod ? `Código ${p.cod}` : "";
      if (p.marca) {
        $("product-brand").textContent = p.marca;
        $("product-brand").href =
          `/pages/menu-departments-item/search.html?search=${encodeURIComponent(p.marca)}`;
        $("product-brand").hidden = false;
      }
      renderGallery(p);
      description(p);
      renderSpecs(p);
      breadcrumb(p);
      promotions(p);
      updatePurchase();
      metadata(p);
      restoreSelection();
      $("share-product").disabled = false;
      $("add-to-wishlist-btn").disabled = false;
      $("product-details-container").setAttribute("aria-busy", "false");
      track("view_item");
      void loadFavorites();
      void loadCommunity();
      void loadStores();
      void recentProducts();
      void loadRestock();
      void loadContent();
      if (location.hash) {
        const target = document.getElementById(location.hash.slice(1));
        if (target) requestAnimationFrame(() => target.scrollIntoView());
      }
    } catch (error) {
      showError(
        error.status === 404
          ? "Produto não encontrado"
          : "Não foi possível carregar este produto",
        error.status === 404
          ? "Este produto não está disponível. Explore outras opções na loja."
          : error.message,
        error.status !== 404,
      );
    }
  }
  function showError(title, message, retry = true) {
    state.loaded = false;
    $("product-details-container").hidden = true;
    $("product-details-container").setAttribute("aria-busy", "false");
    $("product-error").hidden = false;
    $("error-title").textContent = title;
    $("error-message").textContent = message;
    $("retry-product").hidden = !retry;
    $("mobile-purchase-bar").hidden = true;
    document.title = `${title} - E o Bicho`;
    track("product_error", { reason: title });
  }
  function saveSelection() {
    if (!state.product) return;
    try {
      sessionStorage.setItem(
        `productSelection:${id}`,
        JSON.stringify({
          qty: $("product-quantity").value,
          subscribed: subscribed(),
        }),
      );
    } catch {}
  }
  function restoreSelection() {
    try {
      const value = JSON.parse(
        sessionStorage.getItem(`productSelection:${id}`) || "null",
      );
      if (value) {
        $("product-quantity").value = U.quantity(
          value.qty,
          state.product.stock,
        );
        if ($("product-subscription"))
          $("product-subscription").checked = Boolean(value.subscribed);
        updatePurchase();
      }
    } catch {}
  }
  async function addToCart() {
    if (state.busy || !state.product) return;
    if (U.number(state.product.stock) < 1) {
      await notifyRestock();
      return;
    }
    if (!account()) return;
    state.busy = true;
    $("purchase-status").textContent = "";
    saveSelection();
    updatePurchase();
    try {
      // Revalidate current catalog/stock before asking the cart service; the server also validates it.
      const fresh = await request(`/products/${id}`);
      state.product = fresh;
      const qty = Number($("product-quantity").value);
      if (
        fresh.inativo ||
        fresh.naoMostrarNoSite ||
        !(Number(fresh.venda) > 0) ||
        qty > Math.floor(U.number(fresh.stock))
      )
        throw new Error(
          "A disponibilidade mudou. Confira a quantidade e tente novamente.",
        );
      const result = await authorized(
        `/cart/${encodeURIComponent(user().id)}`,
        {
          method: "POST",
          body: JSON.stringify({
            productId: id,
            quantity: qty,
            isSubscribed: subscribed(),
          }),
        },
      );
      if (!Array.isArray(result))
        throw new Error(
          "Não foi possível confirmar a inclusão. Confira sua sacola antes de tentar novamente.",
        );
      const item = result.find(
        (x) => String(x.product?._id || x.product) === id,
      );
      if (!item)
        throw new Error(
          "Não foi possível confirmar a inclusão. Confira sua sacola antes de tentar novamente.",
        );
      $("added-subscription-status").hidden = true;
      // Older servers ignore isSubscribed on POST. Explicitly confirm the existing subscription route.
      if (subscribed() && !item.isSubscribed) {
        try {
          await authorized(`/cart/${user().id}/${id}/subscribe`, {
            method: "PUT",
            body: JSON.stringify({ isSubscribed: true }),
          });
        } catch {
          $("added-subscription-status").textContent =
            "O produto foi adicionado. Ative o Preço Clube na sacola antes de finalizar.";
          $("added-subscription-status").hidden = false;
        }
      }
      const pricing = U.price(fresh, qty, subscribed());
      $("added-name").textContent = fresh.nome;
      $("added-image").src = imageUrl(fresh.imagemPrincipal);
      $("added-image").alt = fresh.nome;
      $("added-detail").textContent =
        `${qty} ${qty === 1 ? "unidade" : "unidades"} adicionada${qty === 1 ? "" : "s"} · ${U.money(pricing.total)} estimados. Confira o total na sacola.`;
      if (typeof CartManager !== "undefined")
        void CartManager.updateCartCount();
      $("added-dialog").showModal();
      track("add_to_cart");
    } catch (error) {
      $("purchase-status").textContent = error.message;
      track("cart_error", { reason: error.status || "connection" });
    } finally {
      state.busy = false;
      updatePurchase();
    }
  }
  async function loadFavorites() {
    if (!user()?.token) return;
    try {
      const values = await authorized(`/favorites/${user().id}`);
      state.favorite = Array.isArray(values) && values.includes(id);
      renderFavorite();
    } catch {
      /* account action will provide actionable feedback */
    }
  }
  function renderFavorite() {
    const btn = $("add-to-wishlist-btn");
    btn.setAttribute("aria-pressed", String(state.favorite));
    btn.setAttribute(
      "aria-label",
      state.favorite ? "Remover dos favoritos" : "Adicionar aos favoritos",
    );
    btn.querySelector("i").className = state.favorite
      ? "fa-solid fa-heart"
      : "fa-regular fa-heart";
  }
  async function toggleFavorite() {
    if (!account()) return;
    const btn = $("add-to-wishlist-btn");
    btn.disabled = true;
    try {
      await authorized(
        `/favorites/${user().id}${state.favorite ? `/${id}` : ""}`,
        {
          method: state.favorite ? "DELETE" : "POST",
          ...(state.favorite
            ? {}
            : { body: JSON.stringify({ productId: id }) }),
        },
      );
      state.favorite = !state.favorite;
      renderFavorite();
      $("purchase-status").textContent = state.favorite
        ? "Produto salvo nos seus favoritos."
        : "Produto removido dos favoritos.";
      track("add_to_wishlist", { saved: state.favorite });
    } catch (e) {
      $("purchase-status").textContent = e.message;
    } finally {
      btn.disabled = false;
    }
  }
  async function shipping(event) {
    event.preventDefault();
    const digits = $("cep").value.replace(/\D/g, "");
    const output = $("shipping-result");
    output.replaceChildren();
    output.classList.remove("error");
    if (digits.length !== 8) {
      output.textContent = "Informe um CEP com 8 dígitos.";
      output.classList.add("error");
      $("cep").setAttribute("aria-invalid", "true");
      $("cep").focus();
      return;
    }
    $("cep").removeAttribute("aria-invalid");
    const button = $("calculate-shipping");
    button.disabled = true;
    button.textContent = "Consultando…";
    output.textContent = "Consultando as opções de entrega…";
    writeStorage("productDeliveryCep", digits);
    try {
      const data = await request(
        `/shipping/quote?cep=${encodeURIComponent(digits)}`,
        { timeout: 45000 },
      );
      state.quote = data;
      output.replaceChildren();
      if (!data.methods || !Object.keys(data.methods).length)
        throw new Error(
          "Nenhuma opção disponível para este CEP. Fale com a loja.",
        );
      if (data.store?.nome)
        output.append(
          element("p", "pd-muted", `Loja de referência: ${data.store.nome}`),
        );
      for (const [key, method] of Object.entries(data.methods)) {
        if (!Number.isFinite(Number(method.price)) || Number(method.price) < 0)
          continue;
        const row = element("div", "pd-shipping-method");
        row.append(
          element("span", null, method.label || key),
          element(
            "strong",
            null,
            Number(method.price) === 0 ? "Grátis" : U.money(method.price),
          ),
        );
        output.append(row);
      }
      output.append(
        element(
          "p",
          "pd-muted",
          "Estimativa de frete. Prazo, disponibilidade e valor final são confirmados na finalização do pedido.",
        ),
      );
      track("shipping_quote", { available: true });
    } catch (error) {
      output.textContent = error.message;
      output.classList.add("error");
      track("shipping_quote", { available: false });
    } finally {
      button.disabled = false;
      button.textContent = "Calcular";
    }
  }
  async function loadStores() {
    try {
      const [data, availability] = await Promise.all([
        request("/product-experience/stores"),
        request(`/product-experience/${id}/availability`).catch(() => ({
          stores: [],
        })),
      ]);
      const stores = Array.isArray(data) ? data : [];
      $("pickup-stores").replaceChildren();
      $("product-contacts").replaceChildren();
      for (const store of stores) {
        const item = element("div", "pd-store");
        item.append(element("strong", null, store.nome));
        if (store.endereco) item.append(element("p", null, store.endereco));
        const stock = availability.stores?.find(
          (entry) => entry.store === store._id,
        );
        item.append(
          element(
            "p",
            null,
            stock
              ? stock.available
                ? "Produto disponível nesta unidade. Confirme a retirada no pedido."
                : "Sem estoque informado nesta unidade. Consulte a equipe."
              : "Consulte a equipe para confirmar o estoque desta unidade.",
          ),
        );
        const days = [
          ["segunda", "Seg"],
          ["terca", "Ter"],
          ["quarta", "Qua"],
          ["quinta", "Qui"],
          ["sexta", "Sex"],
          ["sabado", "Sáb"],
          ["domingo", "Dom"],
        ];
        const hours = days
          .map(([key, label]) => {
            const day = store.horario?.[key];
            return day?.fechada
              ? `${label}: fechada`
              : day?.abre && day?.fecha
                ? `${label}: ${day.abre}–${day.fecha}`
                : "";
          })
          .filter(Boolean);
        if (hours.length) item.append(element("p", null, hours.join(" · ")));
        const phone = String(store.whatsapp || "").replace(/\D/g, "");
        if (phone.length >= 10 && phone.length <= 13) {
          const link = element("a", null, `WhatsApp · ${store.nome}`);
          const message = `Olá! Gostaria de tirar uma dúvida sobre ${state.product.nome}. ${canonical}`;
          link.href = `https://wa.me/${phone.startsWith("55") && phone.length >= 12 ? phone : `55${phone}`}?text=${encodeURIComponent(message)}`;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          $("product-contacts").append(link);
        } else if (store.telefone) {
          const link = element("a", null, `Ligar para ${store.nome}`);
          link.href = `tel:${String(store.telefone).replace(/[^\d+]/g, "")}`;
          $("product-contacts").append(link);
        }
        $("pickup-stores").append(item);
      }
      if (!$("product-contacts").children.length) {
        const link = element("a", null, "Ver contatos das lojas");
        link.href = "/pages/nossas-lojas.html";
        $("product-contacts").append(link);
      }
    } catch {
      $("pickup-stores").textContent =
        "Consulte os endereços e horários na página das lojas.";
    }
  }
  async function loadContent() {
    try {
      const content = await request(`/product-experience/${id}/content`);
      state.content = content;
      document
        .querySelectorAll("[data-product-extra]")
        .forEach((el) => el.remove());
      for (const [label, value] of [
        ["Fabricante", content.manufacturer],
        ["Material", content.material],
        ["Dimensões", content.dimensions],
      ])
        if (value) {
          const row = element("div", "pd-spec-row");
          row.dataset.productExtra = "true";
          row.append(element("dt", null, label), element("dd", null, value));
          $("product-specs-list").append(row);
        }
      for (const [label, value] of [
        ["Composição", content.composition],
        ["Modo de uso", content.usage],
        ["Cuidados e conservação", content.care],
      ])
        if (value) {
          const section = element("div", "pd-extra-section");
          section.dataset.productExtra = "true";
          section.append(element("h3", null, label), element("p", null, value));
          $("product-description").append(section);
        }
      const docs = $("product-documents");
      docs.replaceChildren();
      if (content.documents?.length) {
        docs.append(element("h3", null, "Bula, rótulo e documentos"));
        for (const doc of content.documents) {
          const href = U.safeUrl(doc.url, canonical);
          if (!href) continue;
          const link = element("a", "pd-document-link", `${doc.title} ↗`);
          link.href = href;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          docs.append(link);
        }
      }
      docs.hidden = !docs.children.length;
      if (content.videoUrl) {
        const section = element("div", "pd-extra-section");
        section.dataset.productExtra = "true";
        section.append(element("h3", null, "Conheça melhor o produto"));
        const url = U.safeUrl(content.videoUrl, canonical);
        if (url) {
          if (/\.(mp4|webm)$/i.test(new URL(url).pathname)) {
            const video = element("video");
            video.controls = true;
            video.preload = "none";
            video.src = url;
            video.setAttribute("aria-label", `Vídeo de ${state.product.nome}`);
            section.append(video);
          } else {
            const link = element(
              "a",
              "pd-document-link",
              "Assistir ao vídeo do produto ↗",
            );
            link.href = url;
            link.target = "_blank";
            link.rel = "noopener noreferrer";
            section.append(link);
          }
        }
        $("product-description").append(section);
      }
      if (content.variants?.length) {
        for (const p of content.variants) {
          if (p._id === id) continue;
          const link = element(
            "a",
            "pd-variant",
            p.especificacoes?.apresentacao || p.nome,
          );
          link.dataset.productExtra = "true";
          link.href = `/pages/menu-departments-item/product.html?id=${p._id}`;
          $("variant-options").append(link);
        }
        const compare = element(
          "button",
          "pd-text-button",
          "Comparar apresentações",
        );
        compare.type = "button";
        compare.dataset.productExtra = "true";
        compare.addEventListener("click", () =>
          comparePresentations([state.product, ...content.variants]),
        );
        $("variant-options").append(compare);
        $("product-variants").hidden = false;
      }
      if (content.related?.length) {
        $("related-products").replaceChildren(
          ...content.related.slice(0, 4).map(card),
        );
        $("related-title").textContent = "Selecionados para você";
        $("related-see-all").hidden = true;
        $("related-section").hidden = false;
      } else {
        $("related-see-all").hidden = false;
        void loadRecommendations();
      }
      if (content.kits?.length) {
        const section = element("section", "pd-recommendations");
        section.dataset.productExtra = "true";
        section.append(element("h2", null, "Kits e opções selecionadas"));
        const grid = element("div", "pd-product-grid");
        grid.append(...content.kits.slice(0, 4).map(card));
        section.append(grid);
        $("related-section").after(section);
      }
      if (
        ["admin", "admin_master"].includes(user()?.role) &&
        !$("edit-product-content")
      ) {
        const button = element(
          "button",
          "pd-text-button",
          "Editar conteúdo desta página",
        );
        button.type = "button";
        button.id = "edit-product-content";
        button.addEventListener("click", openContentEditor);
        $("product-specs-section").append(button);
        const metrics = element(
          "button",
          "pd-text-button",
          "Ver indicadores desta página",
        );
        metrics.type = "button";
        metrics.addEventListener("click", openMetrics);
        $("product-specs-section").append(metrics);
      }
      metadata(state.product);
    } catch {
      void loadRecommendations();
    }
  }
  async function openMetrics() {
    const dialog = element("dialog", "pd-content-editor");
    dialog.setAttribute("aria-label", "Indicadores da página");
    const head = element("div", "pd-dialog-top");
    head.append(element("h2", null, "Indicadores dos últimos 30 dias"));
    const close = element("button", "pd-icon-button", "✕");
    close.type = "button";
    close.setAttribute("aria-label", "Fechar indicadores");
    close.addEventListener("click", () => dialog.close());
    head.append(close);
    dialog.append(head);
    const body = element("div");
    body.append(element("p", "pd-muted", "Consultando…"));
    dialog.append(body);
    document.body.append(dialog);
    dialog.addEventListener("close", () => dialog.remove());
    dialog.showModal();
    try {
      const data = await authorized(`/product-experience/${id}/events`);
      body.replaceChildren(
        element(
          "p",
          "pd-muted",
          "Contagens agregadas por dispositivo. Não representam visitantes únicos nem pedidos concluídos.",
        ),
      );
      const names = {
        view_item: "Visualizações",
        add_to_cart: "Inclusões na sacola",
        add_to_wishlist: "Ações de favoritos",
        shipping_quote: "Consultas de frete",
        cart_error: "Falhas na sacola",
        product_error: "Falhas no produto",
        view_product_image: "Ampliações da foto",
        share: "Compartilhamentos",
        restock_request: "Ações de reposição",
        select_subscription: "Seleções de assinatura",
        submit_review: "Avaliações enviadas",
        compare_products: "Comparações",
      };
      const table = element("table");
      table.className = "pd-metrics-table";
      const header = element("tr");
      for (const label of ["Ação", "Celular", "Computador"]) {
        const th = element("th", null, label);
        th.scope = "col";
        header.append(th);
      }
      const thead = element("thead");
      thead.append(header);
      table.append(thead);
      const tbody = element("tbody");
      for (const [event, label] of Object.entries(names)) {
        const row = element("tr");
        const th = element("th", null, label);
        th.scope = "row";
        row.append(th);
        for (const device of ["mobile", "desktop"])
          row.append(
            element(
              "td",
              null,
              String(
                (data.rows || [])
                  .filter((r) => r.event === event && r.device === device)
                  .reduce((sum, r) => sum + r.count, 0),
              ),
            ),
          );
        tbody.append(row);
      }
      table.append(tbody);
      body.append(table);
    } catch (e) {
      body.replaceChildren(element("p", "pd-muted", e.message));
    }
  }
  function comparePresentations(products) {
    const distinct = [...new Map(products.map((p) => [p._id, p])).values()];
    const dialog = element("dialog", "pd-compare-dialog");
    dialog.setAttribute("aria-label", "Comparar apresentações");
    const head = element("div", "pd-dialog-top");
    head.append(element("h2", null, "Compare as apresentações"));
    const close = element("button", "pd-icon-button", "✕");
    close.type = "button";
    close.setAttribute("aria-label", "Fechar comparação");
    close.addEventListener("click", () => dialog.close());
    head.append(close);
    dialog.append(head);
    const region = element("div", "pd-compare-scroll");
    region.tabIndex = 0;
    const table = element("table");
    const tbody = element("tbody");
    for (const [label, read] of [
      ["Produto", (p) => p.nome],
      [
        "Apresentação",
        (p) => p.especificacoes?.apresentacao || "Não informada",
      ],
      ["Preço avulso", (p) => U.money(U.price(p).unit)],
      ["Preço por medida", (p) => U.unitPrice(p, U.price(p).unit) || "—"],
      ["Marca", (p) => p.marca || "—"],
      ["Disponibilidade", (p) => (p.stock > 0 ? "Em estoque" : "Indisponível")],
    ]) {
      const row = element("tr");
      const th = element("th", null, label);
      th.scope = "row";
      row.append(th);
      for (const p of distinct) row.append(element("td", null, read(p)));
      tbody.append(row);
    }
    const row = element("tr");
    row.append(element("th", null, "Escolher"));
    for (const p of distinct) {
      const td = element("td");
      const link = element(
        "a",
        "pd-button pd-button-outline",
        p._id === id ? "Você está aqui" : "Ver produto",
      );
      link.href = `/pages/menu-departments-item/product.html?id=${p._id}`;
      td.append(link);
      row.append(td);
    }
    tbody.append(row);
    table.append(tbody);
    region.append(table);
    dialog.append(region);
    document.body.append(dialog);
    dialog.addEventListener("close", () => dialog.remove());
    dialog.showModal();
    track("compare_products");
  }
  function openContentEditor() {
    const content = state.content || {};
    const dialog = element("dialog", "pd-content-editor");
    dialog.setAttribute("aria-label", "Conteúdo da página do produto");
    const head = element("div", "pd-dialog-top");
    head.append(element("h2", null, "Conteúdo da página do produto"));
    const close = element("button", "pd-icon-button", "✕");
    close.type = "button";
    close.setAttribute("aria-label", "Fechar editor");
    close.addEventListener("click", () => dialog.close());
    head.append(close);
    dialog.append(head);
    const form = element("form", "pd-inline-form");
    form.append(
      element(
        "p",
        "pd-muted",
        "Use informações conferidas do fabricante. Esta edição não altera preço, estoque nem cadastro fiscal. Campos vazios ficam ocultos na loja.",
      ),
    );
    const fields = [
      ["manufacturer", "Fabricante", false],
      ["composition", "Composição", true],
      ["usage", "Modo de uso (conforme o fabricante)", true],
      ["care", "Cuidados e conservação", true],
      ["material", "Material", true],
      ["dimensions", "Dimensões", true],
      ["videoUrl", "Link HTTPS do vídeo", false],
      [
        "documents",
        "Documentos: uma linha por documento, no formato Nome | link HTTPS",
        true,
      ],
      [
        "variants",
        "Outras apresentações: códigos de produto separados por vírgula",
        false,
      ],
      [
        "related",
        "Produtos relacionados: códigos separados por vírgula",
        false,
      ],
      [
        "kits",
        "Kits: códigos de kits já cadastrados, separados por vírgula",
        false,
      ],
    ];
    for (const [field, label, multiline] of fields) {
      const caption = element("label", null, label);
      caption.htmlFor = `content-${field}`;
      const input = element(multiline ? "textarea" : "input");
      input.id = `content-${field}`;
      input.name = field;
      if (multiline) input.rows = 3;
      else input.type = field === "videoUrl" ? "url" : "text";
      input.maxLength =
        field === "manufacturer"
          ? 150
          : ["composition", "usage", "care"].includes(field)
            ? 10000
            : 5000;
      input.value =
        field === "documents"
          ? (content.documents || [])
              .map((d) => `${d.title} | ${d.url}`)
              .join("\n")
          : ["variants", "related", "kits"].includes(field)
            ? (content[field] || []).map((p) => p.cod).join(", ")
            : content[field] || "";
      form.append(caption, input);
    }
    const button = element("button", "pd-button", "Salvar conteúdo");
    button.type = "submit";
    const status = element("p");
    status.setAttribute("role", "status");
    form.append(button, status);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      button.disabled = true;
      status.textContent = "Salvando…";
      const data = { expectedUpdatedAt: content.updatedAt || null };
      for (const [field] of fields) {
        const value = form.elements[field].value.trim();
        data[field] =
          field === "documents"
            ? value
                .split(/\r?\n/)
                .filter(Boolean)
                .map((line) => {
                  const separator = line.indexOf("|");
                  return {
                    title: separator < 0 ? "" : line.slice(0, separator).trim(),
                    url: separator < 0 ? "" : line.slice(separator + 1).trim(),
                  };
                })
            : ["variants", "related", "kits"].includes(field)
              ? value
                  .split(",")
                  .map((x) => x.trim())
                  .filter(Boolean)
              : value;
      }
      try {
        await authorized(`/product-experience/${id}/content`, {
          method: "PUT",
          body: JSON.stringify(data),
        });
        await loadContent();
        dialog.close();
      } catch (e) {
        status.textContent = e.message;
      } finally {
        button.disabled = false;
      }
    });
    dialog.append(form);
    document.body.append(dialog);
    dialog.addEventListener("close", () => dialog.remove());
    dialog.showModal();
  }
  function stars(rating) {
    return "★".repeat(Math.round(rating)) + "☆".repeat(5 - Math.round(rating));
  }
  async function loadCommunity() {
    try {
      const data = await request(`/product-experience/${id}/reviews`);
      state.community = data;
      const root = $("reviews-content");
      root.replaceChildren();
      const count = U.number(data.total);
      $("review-summary").textContent = count
        ? `${Number(data.average).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} / 5 · ${count} ${count === 1 ? "avaliação" : "avaliações"}`
        : "Seja o primeiro a avaliar";
      if (!count) {
        const empty = element("div", "pd-empty-state");
        const icon = element("i", "fa-regular fa-star");
        icon.setAttribute("aria-hidden", "true");
        const text = element("div");
        text.append(
          element("strong", null, "Este produto ainda não tem avaliações."),
          element(
            "p",
            null,
            "Já comprou? Compartilhe sua experiência e ajude outros tutores.",
          ),
        );
        empty.append(icon, text);
        root.append(empty);
      } else {
        const overview = element("div", "pd-review-overview");
        overview.append(
          element(
            "strong",
            null,
            Number(data.average).toLocaleString("pt-BR", {
              maximumFractionDigits: 1,
            }),
          ),
          element("span", null, `${count} avaliações de compras verificadas`),
        );
        root.append(overview);
        for (const review of data.reviews || []) {
          const article = element("article", "pd-review");
          const head = element("div", "pd-review-header");
          const rating = element("span", "pd-stars", stars(review.rating));
          rating.setAttribute("aria-label", `${review.rating} de 5 estrelas`);
          const time = element(
            "time",
            null,
            new Date(review.createdAt).toLocaleDateString("pt-BR"),
          );
          time.dateTime = review.createdAt;
          head.append(
            rating,
            element("strong", null, review.author || "Cliente"),
            element("span", "pd-verified", "Compra verificada"),
            time,
          );
          article.append(head, element("p", null, review.text));
          root.append(article);
        }
        if (data.total > data.reviews.length) {
          const more = element(
            "button",
            "pd-text-button",
            "Carregar mais avaliações",
          );
          more.type = "button";
          more.addEventListener("click", async () => {
            more.disabled = true;
            try {
              const next = await request(
                `/product-experience/${id}/reviews?offset=${root.querySelectorAll(".pd-review").length}`,
              );
              for (const review of next.reviews || []) {
                const article = element("article", "pd-review");
                article.append(
                  element(
                    "strong",
                    null,
                    `${review.author} · ${review.rating}/5 · Compra verificada`,
                  ),
                  element("p", null, review.text),
                );
                more.before(article);
              }
              more.hidden =
                root.querySelectorAll(".pd-review").length >= data.total;
            } catch {
              more.textContent = "Tentar carregar mais";
            } finally {
              more.disabled = false;
            }
          });
          root.append(more);
        }
      }
      metadata(state.product);
    } catch {
      $("reviews-content").replaceChildren(
        element(
          "p",
          "pd-muted",
          "Não foi possível consultar as avaliações agora. Tente novamente mais tarde.",
        ),
      );
      $("review-summary").textContent = "Ver avaliações";
    }
  }
  async function review(event) {
    event.preventDefault();
    if (!account()) return;
    const button = $("review-form").querySelector("[type=submit]");
    button.disabled = true;
    $("review-status").textContent = "Enviando…";
    try {
      await authorized(`/product-experience/${id}/reviews`, {
        method: "POST",
        body: JSON.stringify({
          rating: Number($("review-rating").value),
          text: $("review-text").value,
        }),
      });
      $("review-status").textContent =
        "Avaliação publicada. Obrigado por compartilhar sua experiência!";
      $("review-form").reset();
      await loadCommunity();
      track("submit_review");
    } catch (e) {
      $("review-status").textContent = e.message;
    } finally {
      button.disabled = false;
    }
  }
  async function loadRestock() {
    if (!user()?.token || state.product.stock > 0) return;
    try {
      const data = await authorized(`/product-experience/${id}/restock`);
      $("notify-restock").dataset.subscribed = String(data.subscribed);
      $("notify-restock").textContent = data.subscribed
        ? "Cancelar aviso de reposição"
        : "Avise-me quando chegar";
      updatePurchase();
    } catch {}
  }
  async function notifyRestock() {
    if (!account()) return;
    const button = $("notify-restock");
    if (button.disabled) return;
    const cancel = button.dataset.subscribed === "true";
    button.disabled = true;
    try {
      await authorized(`/product-experience/${id}/restock`, {
        method: cancel ? "DELETE" : "POST",
        ...(cancel ? {} : { body: "{}" }),
      });
      $("purchase-status").textContent = cancel
        ? "Aviso de reposição cancelado."
        : "Aviso cadastrado! Você receberá um e-mail quando houver reposição.";
      button.dataset.subscribed = String(!cancel);
      button.textContent = cancel
        ? "Avise-me quando chegar"
        : "Cancelar aviso de reposição";
      track("restock_request", { subscribed: !cancel });
    } catch (e) {
      $("purchase-status").textContent = e.message;
    } finally {
      button.disabled = false;
      updatePurchase();
    }
  }
  function card(p) {
    const link = element("a", "pd-product-card");
    link.href = `/pages/menu-departments-item/product.html?id=${encodeURIComponent(p._id)}`;
    const img = element("img");
    img.src = imageUrl(p.imagemPrincipal);
    img.alt = p.nome;
    img.width = 220;
    img.height = 160;
    img.loading = "lazy";
    img.decoding = "async";
    imageFallback(img);
    link.append(
      img,
      element("small", null, p.marca || ""),
      element("h3", null, p.nome),
      element(
        "strong",
        null,
        U.number(p.stock) > 0 ? U.money(U.price(p).unit) : "Indisponível",
      ),
      element("span", "pd-card-link", "Ver produto →"),
    );
    return link;
  }
  async function loadRecommendations() {
    try {
      const data = await request(`/product-experience/${id}/related`);
      const list = (data.products || []).filter(
        (p) => p._id !== id && !p.inativo && !p.naoMostrarNoSite && p.venda > 0,
      );
      if (!list.length) return;
      $("related-products").replaceChildren(...list.slice(0, 4).map(card));
      $("related-section").hidden = false;
      const path = state.product.breadcrumbPath || [];
      const category = path.at(-1);
      if (category) {
        $("related-title").textContent = `Mais em ${category.nome}`;
        $("related-see-all").href = category.href;
      }
      if (Array.isArray(data.variants) && data.variants.length) {
        const options = $("variant-options");
        for (const p of data.variants) {
          if (p._id === id) continue;
          const option = element(
            "a",
            "pd-variant",
            p.especificacoes?.apresentacao || p.nome,
          );
          option.href = `/pages/menu-departments-item/product.html?id=${p._id}`;
          options.append(option);
        }
        $("product-variants").hidden = false;
      }
    } catch {
      /* secondary recommendations never block the product */
    }
  }
  async function recentProducts() {
    const previous = readStorage("recentProductIds", []);
    const ids = Array.isArray(previous)
      ? previous
          .filter(
            (x) =>
              typeof x === "string" && /^[a-f0-9]{24}$/i.test(x) && x !== id,
          )
          .slice(0, 4)
      : [];
    writeStorage("recentProductIds", [id, ...ids]);
    if (!ids.length) return;
    const results = await Promise.allSettled(
      ids.map((value) => request(`/products/${value}`)),
    );
    const products = results
      .filter((x) => x.status === "fulfilled")
      .map((x) => x.value)
      .filter((p) => !p.inativo && !p.naoMostrarNoSite && p.venda > 0);
    $("recent-products").replaceChildren(...products.map(card));
    $("recent-section").hidden = !products.length;
  }
  function metadata(p) {
    if (!p) return;
    document.title = `${p.nome} - E o Bicho`;
    const plain = $("product-description")
      .textContent.replace(/\s+/g, " ")
      .trim();
    const desc = plain
      ? plain.slice(0, 190)
      : `${p.nome}. Consulte disponibilidade e entrega no E o Bicho.`;
    document.querySelector("meta[name=description]").content = desc;
    for (const [key, value] of Object.entries({
      title: document.title,
      description: desc,
      image: imageUrl(p.imagemPrincipal),
      url: canonical,
    }))
      document.querySelector(`meta[property="og:${key}"]`).content = value;
    document.querySelector("link[rel=canonical]").href = canonical;
    const data = {
      "@context": "https://schema.org",
      "@type": "Product",
      name: p.nome,
      description: plain,
      image: state.images,
      sku: String(p.cod || p._id),
      url: canonical,
    };
    if (p.marca) data.brand = { "@type": "Brand", name: p.marca };
    if (!p.semGtin && /^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(p.codbarras || ""))
      data.gtin = p.codbarras;
    if (p.venda > 0)
      data.offers = {
        "@type": "Offer",
        price: U.price(p).unit.toFixed(2),
        priceCurrency: "BRL",
        availability: `https://schema.org/${p.stock > 0 ? "InStock" : "OutOfStock"}`,
        url: canonical,
        seller: { "@type": "Organization", name: "E o Bicho" },
      };
    if (state.community?.total > 0)
      data.aggregateRating = {
        "@type": "AggregateRating",
        ratingValue: state.community.average,
        reviewCount: state.community.total,
      };
    let script = $("product-structured-data");
    if (!script) {
      script = element("script");
      script.type = "application/ld+json";
      script.id = "product-structured-data";
      document.head.append(script);
    }
    script.textContent = JSON.stringify(data).replace(/</g, "\\u003c");
    let crumb = $("breadcrumb-structured-data");
    if (!crumb) {
      crumb = element("script");
      crumb.type = "application/ld+json";
      crumb.id = "breadcrumb-structured-data";
      document.head.append(crumb);
    }
    crumb.textContent = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { nome: "Início", href: "/" },
        ...(p.breadcrumbPath || []),
        { nome: p.nome, href: canonical },
      ].map((entry, index) => ({
        "@type": "ListItem",
        position: index + 1,
        name: entry.nome,
        item: U.safeUrl(entry.href, "https://www.peteobicho.com.br"),
      })),
    }).replace(/</g, "\\u003c");
  }
  function share() {
    if (!state.product) return;
    $("share-url").value = canonical;
    $("share-whatsapp").href =
      `https://wa.me/?text=${encodeURIComponent(`${state.product.nome} ${canonical}`)}`;
    $("share-status").textContent = "";
    $("share-dialog").showModal();
    track("share");
  }
  function bind() {
    function mobileMenu() {
      let menu = $("product-mobile-menu-dialog");
      if (!menu) {
        menu = element("dialog", "pd-menu-dialog");
        menu.id = "product-mobile-menu-dialog";
        menu.setAttribute("aria-label", "Menu da loja");
        const head = element("div", "pd-dialog-top");
        head.append(element("h2", null, "Explore a loja"));
        const close = element("button", "pd-icon-button", "✕");
        close.type = "button";
        close.setAttribute("aria-label", "Fechar menu");
        close.addEventListener("click", () => menu.close());
        head.append(close);
        menu.append(head);
        const nav = element("nav");
        nav.setAttribute("aria-label", "Categorias e conta");
        for (const source of document.querySelectorAll(
          "#category-nav>ul>li>a[href]",
        )) {
          const href = source.getAttribute("href");
          if (!href || href === "#") continue;
          const link = element("a", null, source.textContent.trim());
          link.href = href;
          nav.append(link);
        }
        for (const [text, href] of [
          [
            "Todos os produtos",
            "/pages/menu-departments-item/search.html?search=*",
          ],
          ["Meus favoritos", "/pages/favoritos.html"],
          ["Meus pedidos", "/pages/meus-pedidos.html"],
          ["Lojas e atendimento", "/pages/nossas-lojas.html"],
          ["Minha conta", "/pages/login.html"],
        ]) {
          const link = element("a", null, text);
          link.href = href;
          nav.append(link);
        }
        menu.append(nav);
        document.body.append(menu);
      }
      menu.showModal();
    }
    const labelHeader = () => {
      for (const [selector, label] of [
        ["#top-search", "Buscar produtos"],
        ["#top-search-btn", "Buscar produtos"],
        ["#phone-menu-trigger button", "Atendimento e contatos"],
        ["#open-cart-btn", "Abrir minha sacola"],
        ["#mobile-menu-button", "Abrir menu de categorias"],
        ["#user-menu-trigger", "Abrir minha conta"],
        ['#header-icons a[href="/pages/favoritos.html"]', "Meus favoritos"],
        ["#close-cart-btn", "Fechar sacola"],
      ]) {
        const target = document.querySelector(selector);
        if (target) target.setAttribute("aria-label", label);
      }
      const button = $("mobile-menu-button");
      const icons = $("header-icons"),
        wrapper = $("user-menu-wrapper");
      if (icons && !$("pd-compact-login")) {
        const link = element("a", "pd-compact-login");
        link.id = "pd-compact-login";
        link.href = "/pages/login.html";
        link.setAttribute("aria-label", "Entrar na minha conta");
        const icon = element("i", "fa-regular fa-user");
        icon.setAttribute("aria-hidden", "true");
        link.append(icon);
        icons.append(link);
      }
      if ($("pd-compact-login"))
        $("pd-compact-login").hidden = Boolean(user()?.token);
      if (wrapper) wrapper.dataset.productGuest = String(!user()?.token);
      if (button && !button.dataset.productMenu) {
        button.dataset.productMenu = "true";
        button.addEventListener("click", mobileMenu);
      }
      const phone = document.querySelector("#phone-menu-trigger button");
      if (phone && !phone.dataset.productContact) {
        phone.dataset.productContact = "true";
        phone.setAttribute("aria-controls", "phone-menu-panel");
        phone.addEventListener("click", () => {
          const panel = $("phone-menu-panel");
          const opening = panel.classList.contains("opacity-0");
          panel.classList.toggle("opacity-0", !opening);
          panel.classList.toggle("pointer-events-none", !opening);
          panel.classList.toggle("scale-95", !opening);
          phone.setAttribute("aria-expanded", String(opening));
        });
      }
    };
    const headerLabels = new MutationObserver(labelHeader);
    headerLabels.observe($("header-placeholder"), {
      childList: true,
      subtree: true,
    });
    let cartWasOpen = false,
      cartReturnFocus = null,
      cartInertRoots = [];
    const enhanceCart = () => {
      labelHeader();
      const panel = $("cart-panel"),
        overlay = $("cart-overlay");
      if (!panel || !overlay) return;
      for (const [action, label] of [
        ["remove-item", "Remover produto da sacola"],
        ["increase-qty", "Aumentar quantidade na sacola"],
        ["decrease-qty", "Diminuir quantidade na sacola"],
      ])
        panel
          .querySelectorAll(`button[data-action="${action}"]`)
          .forEach((button) => button.setAttribute("aria-label", label));
      panel
        .querySelectorAll('button[data-action="increase-qty"]')
        .forEach((button) => {
          if (button.dataset.productId === id && state.product) {
            const quantity = Number(
              button.parentElement.querySelector("span")?.textContent,
            );
            if (quantity >= Math.floor(U.number(state.product.stock)))
              button.disabled = true;
          }
        });
      const open = !overlay.classList.contains("hidden");
      panel.inert = !open;
      panel.setAttribute("aria-hidden", String(!open));
      if (open && !cartWasOpen) {
        cartReturnFocus = document.activeElement;
        panel.setAttribute("role", "dialog");
        panel.setAttribute("aria-modal", "true");
        panel.setAttribute("aria-label", "Minha sacola");
        cartInertRoots = [
          document.querySelector("main"),
          $("header-placeholder"),
          document.querySelector(".pd-footer"),
          $("mobile-purchase-bar"),
        ].filter((root) => root && !root.inert);
        cartInertRoots.forEach((root) => (root.inert = true));
        $("close-cart-btn")?.focus();
      }
      if (!open && cartWasOpen) {
        cartInertRoots.forEach((root) => (root.inert = false));
        cartInertRoots = [];
        cartReturnFocus?.focus();
      }
      cartWasOpen = open;
    };
    document.addEventListener("keydown", (event) => {
      if (!cartWasOpen) return;
      if (event.key === "Escape") {
        $("close-cart-btn").click();
        event.preventDefault();
      }
      if (event.key === "Tab") {
        const controls = [
          ...$("cart-panel").querySelectorAll(
            "button:not(:disabled),a[href],input:not(:disabled)",
          ),
        ].filter((el) => el.getClientRects().length);
        const first = controls[0],
          last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          last?.focus();
          event.preventDefault();
        } else if (!event.shiftKey && document.activeElement === last) {
          first?.focus();
          event.preventDefault();
        }
      }
    });
    const cartLabels = new MutationObserver(enhanceCart);
    cartLabels.observe($("cart-placeholder"), {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class"],
    });
    labelHeader();
    $("retry-product").addEventListener("click", loadProduct);
    $("decrease-quantity").addEventListener("click", () => {
      $("product-quantity").value = Number($("product-quantity").value) - 1;
      updatePurchase();
      saveSelection();
    });
    $("increase-quantity").addEventListener("click", () => {
      $("product-quantity").value = Number($("product-quantity").value) + 1;
      updatePurchase();
      saveSelection();
    });
    $("product-quantity").addEventListener("change", () => {
      updatePurchase();
      saveSelection();
    });
    $("add-to-cart").addEventListener("click", addToCart);
    $("mobile-add-to-cart").addEventListener("click", addToCart);
    $("notify-restock").addEventListener("click", notifyRestock);
    $("add-to-wishlist-btn").addEventListener("click", toggleFavorite);
    $("shipping-form").addEventListener("submit", shipping);
    $("cep").value = String(readStorage("productDeliveryCep", "")).replace(
      /^(\d{5})(\d{3})$/,
      "$1-$2",
    );
    $("cep").addEventListener("input", () => {
      $("cep").value = $("cep")
        .value.replace(/\D/g, "")
        .slice(0, 8)
        .replace(/^(\d{5})(\d)/, "$1-$2");
      $("shipping-result").replaceChildren();
    });
    $("share-product").addEventListener("click", share);
    $("copy-product-link").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(canonical);
        $("share-status").textContent = "Link copiado!";
      } catch {
        $("share-url").focus();
        $("share-url").select();
        $("share-status").textContent = "Selecione e copie o link acima.";
      }
    });
    for (const name of ["main-product-image", "zoomed-image", "added-image"])
      imageFallback($(name));
    $("zoom-product").addEventListener("click", () => {
      $("image-dialog").showModal();
      track("view_product_image");
    });
    for (const name of ["previous-image", "zoom-prev"])
      $(name).addEventListener("click", () => setImage(state.imageIndex - 1));
    for (const name of ["next-image", "zoom-next"])
      $(name).addEventListener("click", () => setImage(state.imageIndex + 1));
    $("toggle-zoom").addEventListener("click", () => {
      const zoom = $("image-dialog").querySelector(".pd-dialog-image-scroll");
      const enabled = zoom.classList.toggle("is-zoomed");
      $("toggle-zoom").textContent = enabled
        ? "Ver foto inteira"
        : "Ampliar detalhes";
    });
    $("image-dialog").addEventListener("keydown", (event) => {
      if (event.key === "ArrowRight") setImage(state.imageIndex + 1);
      if (event.key === "ArrowLeft") setImage(state.imageIndex - 1);
    });
    let touch = null;
    $("zoom-product").addEventListener(
      "touchstart",
      (event) => {
        touch = event.changedTouches[0]?.clientX;
      },
      { passive: true },
    );
    $("zoom-product").addEventListener(
      "touchend",
      (event) => {
        const delta = event.changedTouches[0]?.clientX - touch;
        if (touch !== null && Math.abs(delta) > 45) {
          setImage(state.imageIndex + (delta < 0 ? 1 : -1));
        }
        touch = null;
      },
      { passive: true },
    );
    document
      .querySelectorAll("[data-close-dialog]")
      .forEach((btn) =>
        btn.addEventListener("click", () => btn.closest("dialog").close()),
      );
    document.querySelectorAll("dialog").forEach((dialog) => {
      dialog.addEventListener("click", (event) => {
        if (event.target === dialog) {
          const r = dialog.getBoundingClientRect();
          if (
            event.clientX < r.left ||
            event.clientX > r.right ||
            event.clientY < r.top ||
            event.clientY > r.bottom
          )
            dialog.close();
        }
      });
      dialog.addEventListener("close", () => {
        $("image-dialog")
          .querySelector(".pd-dialog-image-scroll")
          .classList.remove("is-zoomed");
        $("toggle-zoom").textContent = "Ampliar detalhes";
      });
    });
    $("write-review").addEventListener("click", () => {
      if (!account()) return;
      $("review-form").hidden = false;
      $("review-rating").focus();
    });
    $("cancel-review").addEventListener("click", () => {
      $("review-form").hidden = true;
      $("write-review").focus();
    });
    $("review-form").addEventListener("submit", review);
    $("clear-recent").addEventListener("click", () => {
      writeStorage("recentProductIds", []);
      $("recent-products").replaceChildren();
      $("recent-section").hidden = true;
    });
    window.addEventListener("pagehide", saveSelection);
    const syncHeader = () => {
      const header = $("header-top"),
        nav = $("category-nav");
      const bottom = Math.max(
        0,
        header?.getBoundingClientRect().bottom || 0,
        nav?.getBoundingClientRect().bottom || 0,
      );
      document.documentElement.style.setProperty(
        "--pd-header-height",
        `${Math.ceil(bottom + 18)}px`,
      );
    };
    const observer = new MutationObserver(() => {
      syncHeader();
      if ($("header-top")) {
        if (typeof ResizeObserver !== "undefined") {
          const resize = new ResizeObserver(syncHeader);
          resize.observe($("header-top"));
          if ($("category-nav")) resize.observe($("category-nav"));
        }
        observer.disconnect();
      }
    });
    observer.observe($("header-placeholder"), {
      childList: true,
      subtree: true,
    });
    window.addEventListener("resize", syncHeader);
    window.addEventListener("scroll", syncHeader, { passive: true });
    syncHeader();
  }
  document.addEventListener("DOMContentLoaded", () => {
    bind();
    void loadProduct();
  });
})();
