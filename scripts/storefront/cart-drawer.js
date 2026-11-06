(() => {
  "use strict";
  const S = window.StorefrontShell;
  if (!S) return;
  const drawer = document.getElementById("cart-drawer");
  if (!drawer || drawer.dataset.initialized) return;
  drawer.dataset.initialized = "true";
  const $ = (selector) => drawer.querySelector(selector),
    readOnly = () => Boolean(window.CATALOG_PREVIEW);
  let previousFocus = null,
    previousOverflow = null,
    revision = 0,
    controller,
    busy = false,
    lastRows = [];
  function draftKey() {
    return "storefront-preview-cart:" + S.user()?.id;
  }
  function draft() {
    if (!readOnly() || !S.user()) return null;
    try {
      const value = JSON.parse(sessionStorage.getItem(draftKey()));
      return Array.isArray(value) ? value : null;
    } catch {
      return null;
    }
  }
  function saveDraft(rows) {
    const fields = [
      "_id",
      "nome",
      "venda",
      "precoClube",
      "stock",
      "imagemPrincipal",
      "especificacoes",
      "promocao",
      "promocaoCondicional",
      "inativo",
      "naoMostrarNoSite",
    ];
    const copy = rows.map((row) => ({
      quantity: row.quantity,
      isSubscribed: !!row.isSubscribed,
      effectivePrice: row.effectivePrice,
      promoText: row.promoText,
      product: Object.fromEntries(
        fields
          .filter((key) => row.product[key] !== undefined)
          .map((key) => [key, row.product[key]]),
      ),
    }));
    try {
      sessionStorage.setItem(draftKey(), JSON.stringify(copy));
    } catch {
      S.notify(
        "As alterações ficam disponíveis enquanto esta sacola estiver aberta.",
      );
    }
    return copy;
  }
  function recalculate(rows) {
    const groups = new Map();
    for (const row of rows) {
      const promo = row.product.promocaoCondicional;
      if (
        !ProductPageUtils.active(promo) ||
        !promo?.produtosDiferentes ||
        !String(promo.codigoGrupo || "").trim()
      )
        continue;
      const key = promo.tipo + "|" + promo.codigoGrupo;
      groups.set(key, (groups.get(key) || 0) + Number(row.quantity));
    }
    return rows.map((row) => {
      const promo = row.product.promocaoCondicional,
        key = promo?.tipo + "|" + promo?.codigoGrupo;
      const group =
        promo?.produtosDiferentes && String(promo.codigoGrupo || "").trim()
          ? groups.get(key) || 0
          : null;
      const price = ProductPageUtils.price(
        row.product,
        row.quantity,
        !!row.isSubscribed,
        group,
      );
      return {
        ...row,
        effectivePrice: price.unit,
        promoText: price.label || null,
      };
    });
  }
  function setCheckout(enabled) {
    const link = $("#bag-checkout");
    link.setAttribute("aria-disabled", String(!enabled));
    if (enabled) {
      link.href = "/pages/checkout.html";
      link.removeAttribute("tabindex");
    } else {
      link.removeAttribute("href");
      link.tabIndex = -1;
    }
  }
  function footer({ total = null, saving = 0, empty = false } = {}) {
    $("#bag-total").textContent = total === null ? "—" : S.money(total);
    $("#bag-savings").hidden = !(saving > 0);
    $("#bag-savings").textContent =
      saving > 0 ? "Você está economizando " + S.money(saving) : "";
    setCheckout(!empty && total !== null);
    $("#bag-preview-note").hidden = !readOnly();
    if (readOnly())
      $("#bag-preview-note").innerHTML =
        'Prévia: alterações apenas na cópia local da sacola. <button type="button" data-bag-reset>Restaurar sacola da conta</button>';
  }
  function open() {
    if (!drawer.open) {
      previousFocus = document.activeElement;
      previousOverflow = {
        html: document.documentElement.style.overflow,
        body: document.body.style.overflow,
      };
      document.documentElement.style.overflow = "hidden";
      document.body.style.overflow = "hidden";
      drawer.showModal();
      $(".bag-close").focus();
    }
    load();
  }
  function close() {
    drawer.close();
  }
  drawer.addEventListener("close", () => {
    revision++;
    controller?.abort();
    busy = false;
    if (previousOverflow) {
      document.documentElement.style.overflow = previousOverflow.html;
      document.body.style.overflow = previousOverflow.body;
      previousOverflow = null;
    }
    if (previousFocus?.isConnected) previousFocus.focus();
  });
  drawer.addEventListener("click", (event) => {
    if (event.target !== drawer) return;
    const r = drawer.getBoundingClientRect();
    if (
      event.clientX < r.left ||
      event.clientX > r.right ||
      event.clientY < r.top ||
      event.clientY > r.bottom
    )
      close();
  });
  drawer
    .querySelectorAll("[data-bag-close]")
    .forEach((button) => button.addEventListener("click", close));
  function empty(guest = false) {
    lastRows = [];
    if (!guest) document.getElementById("cart-count").textContent = "0";
    $("#bag-count").textContent = guest
      ? "Entre para ver seus produtos"
      : "Sua sacola está esperando por um carinho";
    $("#bag-body").innerHTML =
      `<div class="bag-empty"><span aria-hidden="true">♡</span><h3>${guest ? "Seu pet merece esse cuidado." : "Vamos encher de carinho?"}</h3><p>${guest ? "Acesse sua conta para consultar a sacola e continuar de onde parou." : "Sua sacola está vazia. Explore os produtos e escolha o próximo mimo para seu pet."}</p>${guest ? '<a class="bag-outline" href="/pages/login.html">Entrar na minha conta →</a>' : '<button class="bag-outline" type="button" data-bag-browse>Explorar produtos →</button>'}</div>`;
    footer({ total: guest ? null : 0, empty: true });
  }
  function unit(item) {
    return item.effectivePrice !== null &&
      item.effectivePrice !== undefined &&
      Number.isFinite(Number(item.effectivePrice)) &&
      Number(item.effectivePrice) >= 0
      ? Number(item.effectivePrice)
      : null;
  }
  function render(rows) {
    const items = Array.isArray(rows)
      ? rows.filter((item) => item.product?._id && Number(item.quantity) > 0)
      : [];
    lastRows = items;
    if (!items.length) {
      empty();
      return;
    }
    let total = 0,
      saving = 0,
      units = 0,
      valid = true;
    const oldScroll = $("#bag-body").scrollTop;
    $("#bag-body").innerHTML = items
      .map((item) => {
        const p = item.product,
          qty = Number(item.quantity),
          price = unit(item),
          stock = Number(p.stock);
        units += qty;
        if (price === null) valid = false;
        else {
          total += price * qty;
          saving += Math.max(0, (Number(p.venda) || price) - price) * qty;
        }
        const unavailable =
          p.inativo ||
          p.naoMostrarNoSite ||
          !Number.isFinite(stock) ||
          stock < qty;
        const condition = item.promoText
          ? `<p class="bag-promotion">${S.esc(item.promoText)}</p>`
          : item.isSubscribed
            ? '<p class="bag-promotion">Preço Club selecionado</p>'
            : "";
        return `<article class="bag-item" data-bag-item="${S.esc(p._id)}"><a class="bag-image" href="${S.productUrl(p._id)}"><img src="${S.esc(S.safeImage(p.imagemPrincipal))}" alt="${S.esc(p.nome)}" width="84" height="84"></a><div class="bag-item-details"><a class="bag-item-name" href="${S.productUrl(p._id)}">${S.esc(p.nome)}</a>${p.especificacoes?.apresentacao ? `<p class="bag-presentation">${S.esc(p.especificacoes.apresentacao)}</p>` : ""}<p class="bag-unit">${item.promoText ? "Preço médio por unidade" : "Preço por unidade"}: <b>${price === null ? "A confirmar" : S.money(price)}</b></p>${condition}${unavailable ? '<p class="bag-warning">Confirme a disponibilidade deste item antes de continuar.</p>' : ""}<div class="bag-item-bottom"><div class="bag-quantity" role="group" aria-label="Quantidade de ${S.esc(p.nome)}"><button type="button" data-bag-quantity="${qty - 1}" data-id="${S.esc(p._id)}" aria-label="Diminuir quantidade de ${S.esc(p.nome)}" ${qty <= 1 ? "disabled" : ""}>−</button><span aria-label="${qty} unidades">${qty}</span><button type="button" data-bag-quantity="${qty + 1}" data-id="${S.esc(p._id)}" aria-label="Aumentar quantidade de ${S.esc(p.nome)}" ${(!readOnly() && (!Number.isFinite(stock) || qty >= stock)) || qty >= 999 ? "disabled" : ""}>+</button></div><div class="bag-line-total"><small>Total do item</small><strong>${price === null ? "A confirmar" : S.money(price * qty)}</strong></div></div><button type="button" class="bag-remove" data-bag-remove="${S.esc(p._id)}" aria-label="Remover ${S.esc(p.nome)}" >Remover</button></div></article>`;
      })
      .join("");
    if (!valid)
      $("#bag-body").insertAdjacentHTML(
        "beforeend",
        '<p class="bag-warning">Não foi possível confirmar todos os preços. Atualize a sacola para continuar.</p><button type="button" class="bag-outline" data-bag-retry>Atualizar sacola</button>',
      );
    $("#bag-body").scrollTop = oldScroll;
    $("#bag-body")
      .querySelectorAll("img")
      .forEach((img) =>
        img.addEventListener(
          "error",
          () => (img.src = "/public/image/placeholder.svg"),
          { once: true },
        ),
      );
    $("#bag-count").textContent =
      `${items.length} ${items.length === 1 ? "produto" : "produtos"} · ${units} ${units === 1 ? "unidade" : "unidades"}`;
    document.getElementById("cart-count").textContent = String(units);
    footer({ total: valid ? total : null, saving: valid ? saving : 0 });
  }
  async function load({ keep = false } = {}) {
    const current = S.user();
    if (!current) {
      empty(true);
      return;
    }
    controller?.abort();
    controller = new AbortController();
    const ticket = ++revision;
    const local = draft();
    if (local !== null) {
      render(local);
      $("#bag-body").setAttribute("aria-busy", "false");
      return;
    }
    $("#bag-body").setAttribute("aria-busy", "true");
    footer();
    if (!keep) {
      $("#bag-count").textContent = "Buscando seus produtos…";
      $("#bag-body").innerHTML =
        '<div class="bag-loading" role="status"><span class="bag-loading-circle" aria-hidden="true"></span>Carregando sua sacola…</div>';
    }
    try {
      const rows = await S.request(
        "/cart/" + encodeURIComponent(current.id),
        S.authorized({
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(15000),
          ]),
        }),
      );
      if (ticket !== revision || !drawer.open) return;
      render(rows);
    } catch (error) {
      if (ticket !== revision || error.name === "AbortError") return;
      $("#bag-count").textContent =
        "Seus produtos continuam salvos na sua conta";
      $("#bag-body").innerHTML =
        `<div class="bag-empty"><span aria-hidden="true">↻</span><h3>${error.status === 401 ? "Entre novamente na sua conta" : "Vamos tentar de novo?"}</h3><p>${S.esc(error.status === 401 ? "Sua sessão precisa ser renovada para consultar a sacola." : "Não conseguimos consultar sua sacola agora. Tente novamente em instantes.")}</p>${error.status === 401 ? '<a class="bag-outline" href="/pages/login.html">Entrar na conta →</a>' : '<button type="button" class="bag-outline" data-bag-retry>Tentar novamente →</button>'}</div>`;
      footer();
    } finally {
      if (ticket === revision)
        $("#bag-body").setAttribute("aria-busy", "false");
    }
  }
  drawer.addEventListener("click", async (event) => {
    if (event.target.closest("[data-bag-reset]")) {
      try {
        sessionStorage.removeItem(draftKey());
      } catch {}
      load();
      return;
    }
    if (event.target.closest("[data-bag-retry]")) {
      load();
      return;
    }
    if (event.target.closest("[data-bag-browse]")) {
      close();
      if (document.querySelector("#products"))
        document
          .querySelector("#products")
          .scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    const control = event.target.closest(
      "[data-bag-remove],[data-bag-quantity]",
    );
    if (!control || control.disabled || busy) return;
    if (readOnly()) {
      const remove = control.hasAttribute("data-bag-remove"),
        id = control.dataset.bagRemove || control.dataset.id,
        quantity = Number(control.dataset.bagQuantity);
      if (
        !remove &&
        (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 999)
      )
        return;
      const next = remove
        ? lastRows.filter((row) => row.product._id !== id)
        : lastRows.map((row) =>
            row.product._id === id ? { ...row, quantity } : row,
          );
      render(saveDraft(recalculate(next)));
      return;
    }
    const current = S.user();
    if (!current) return;
    busy = true;
    const ticket = revision;
    drawer
      .querySelectorAll("[data-bag-remove],[data-bag-quantity]")
      .forEach((button) => (button.disabled = true));
    setCheckout(false);
    const remove = control.hasAttribute("data-bag-remove"),
      id = control.dataset.bagRemove || control.dataset.id;
    try {
      await S.request(
        "/cart/" +
          encodeURIComponent(current.id) +
          "/" +
          encodeURIComponent(id),
        S.authorized({
          method: remove ? "DELETE" : "PUT",
          ...(!remove
            ? {
                body: JSON.stringify({
                  quantity: Number(control.dataset.bagQuantity),
                }),
              }
            : {}),
        }),
      );
      document.dispatchEvent(new CustomEvent("storefront:cart-updated"));
      if (drawer.open) await load({ keep: true });
    } catch (error) {
      S.notify(error.message);
      if (drawer.open && ticket === revision) await load({ keep: true });
    } finally {
      busy = false;
    }
  });
  document.getElementById("cart-button")?.addEventListener("click", open);
  window.StorefrontCart = {
    open,
    close,
    previewCount: () => {
      const rows = draft();
      return rows === null
        ? null
        : rows.reduce((sum, row) => sum + Number(row.quantity || 0), 0);
    },
    refresh: () => (drawer.open ? load({ keep: true }) : Promise.resolve()),
  };
  const initialDraft = draft();
  if (initialDraft !== null)
    document.getElementById("cart-count").textContent = String(
      initialDraft.reduce((sum, row) => sum + Number(row.quantity || 0), 0),
    );
  document.dispatchEvent(new CustomEvent("storefront:cart-ready"));
  if (new URLSearchParams(location.search).get("sacola") === "1") open();
})();
