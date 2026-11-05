(() => {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const esc = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  const money = ProductPageUtils.money;
  const api = API_CONFIG.BASE_URL;
  const productUrl = (id) =>
    "/pages/menu-departments-item/product.html?id=" + encodeURIComponent(id);
  const normalize = (s) => ProductPageUtils.normalize(s);
  const safeImage = (raw) => {
    try {
      const url = new URL(raw, API_CONFIG.SERVER_URL);
      return ["https:", "http:"].includes(url.protocol)
        ? url.href
        : "/public/image/placeholder.svg";
    } catch {
      return "/public/image/placeholder.svg";
    }
  };
  let products = [],
    favorites = new Set(),
    filter = "all",
    cartBusy = false;
  function user() {
    try {
      const value = JSON.parse(localStorage.getItem("loggedInUser"));
      return value?.id && value?.token ? value : null;
    } catch {
      return null;
    }
  }
  async function request(path, options = {}) {
    const response = await fetch(api + path, {
      ...options,
      signal: options.signal || AbortSignal.timeout(15000),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401)
        throw Error("Sua sessão expirou. Entre novamente na sua conta.");
      throw Error(
        body.message || "Não foi possível concluir. Tente novamente.",
      );
    }
    return body;
  }
  function authorized(options = {}) {
    const u = user();
    return {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + u?.token,
        ...options.headers,
      },
    };
  }
  function login() {
    location.href = "/pages/login.html";
  }
  function count() {
    $("#favorite-count").textContent = favorites.size;
  }
  function show(title, body) {
    $("#dialog-title").textContent = title;
    $("#dialog-body").innerHTML = body;
    if (!$("#info").open) $("#info").showModal();
  }
  function notify(message) {
    $("#toast").textContent = message;
    $("#toast").style.display = "block";
    clearTimeout(window.toastTimer);
    window.toastTimer = setTimeout(
      () => ($("#toast").style.display = "none"),
      3500,
    );
  }
  function offer(p) {
    const regular = ProductPageUtils.price(p, 1, false);
    const club = Number(p.precoClube);
    const conditional = p.promocaoCondicional;
    let condition = "";
    if (ProductPageUtils.active(conditional)) {
      if (
        conditional.tipo === "acima_de" &&
        Number(conditional.quantidadeMinima) > 0 &&
        Number(conditional.descontoPorcentagem) > 0 &&
        Number(conditional.descontoPorcentagem) <= 100
      )
        condition = `${conditional.descontoPorcentagem}% de desconto a partir de ${conditional.quantidadeMinima} un.`;
      if (
        conditional.tipo === "leve_pague" &&
        Number(conditional.leve) > Number(conditional.pague) &&
        Number(conditional.pague) >= 0
      )
        condition = `Leve ${conditional.leve}, pague ${conditional.pague}`;
    }
    return `${regular.saving > 0 ? `<small class="old-price">De <s>${money(regular.base)}</s> · ${esc(regular.label)}</small>` : ""}<span class="price">${money(regular.unit)}</span>${club > 0 && club < regular.unit ? `<p class="club-price">${money(club)} com preço Club*</p>` : ""}${condition ? `<p class="conditional-offer">${esc(condition)}*</p>` : ""}<small>* Confira as condições na página do produto.</small>`;
  }
  function render() {
    const shelf = $("#products");
    shelf.scrollLeft = 0;
    const list = products.filter(
      (p) =>
        filter === "all" ||
        (filter === "cats" ? /gato/ : /caes|cachorro/).test(normalize(p.nome)),
    );
    shelf.innerHTML =
      list
        .map(
          (p) =>
            `<article class="product"><button class="favorite" data-id="${esc(p._id)}" aria-pressed="${favorites.has(p._id)}" aria-label="Favoritar ${esc(p.nome)}">${favorites.has(p._id) ? "♥" : "♡"}</button><a href="${productUrl(p._id)}"><img loading="lazy" src="${esc(safeImage(p.imagemPrincipal))}" alt="${esc(p.nome)}" width="300" height="180"><h3>${esc(p.nome)}</h3></a>${offer(p)}<p class="stock-note">${Number(p.stock) > 0 ? "Consulte disponibilidade na sua região" : "Reposição: consulte a loja"}</p><a class="product-link" href="${productUrl(p._id)}">${Number(p.stock) > 0 ? "Escolher produto" : "Ver disponibilidade"} →</a></article>`,
        )
        .join("") ||
      '<p>Nenhum produto nesta seleção. <a href="/pages/menu-departments-item/search.html?search=*">Explore o catálogo completo →</a></p>';
    shelf.querySelectorAll("img").forEach((img) =>
      img.addEventListener(
        "error",
        () => {
          img.src = "/public/image/placeholder.svg";
        },
        { once: true },
      ),
    );
  }
  document.addEventListener("click", async (e) => {
    const favorite = e.target.closest(".favorite");
    if (favorite) {
      const u = user();
      if (!u) return login();
      if (favorite.disabled) return;
      favorite.disabled = true;
      const id = favorite.dataset.id;
      try {
        const remove = favorites.has(id);
        const result = await request(
          "/favorites/" +
            encodeURIComponent(u.id) +
            (remove ? "/" + encodeURIComponent(id) : ""),
          authorized({
            method: remove ? "DELETE" : "POST",
            ...(!remove ? { body: JSON.stringify({ productId: id }) } : {}),
          }),
        );
        favorites = new Set(Array.isArray(result) ? result : []);
        favorite.setAttribute("aria-pressed", favorites.has(id));
        favorite.textContent = favorites.has(id) ? "♥" : "♡";
        count();
        notify(
          remove ? "Removido dos favoritos." : "Produto salvo nos favoritos.",
        );
      } catch (err) {
        notify(err.message);
      } finally {
        favorite.disabled = false;
      }
    }
    const search = e.target.closest("[data-search]");
    if (search) {
      e.preventDefault();
      openSearch(search.dataset.search);
    }
  });
  function openSearch(term) {
    location.href =
      "/pages/menu-departments-item/search.html?search=" +
      encodeURIComponent(term);
  }
  $(".search").addEventListener("submit", (e) => {
    e.preventDefault();
    const q = $("#search").value.trim();
    if (q) openSearch(q);
    else $("#search").focus();
  });
  let searchTimer, searchController;
  $("#search").addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchController?.abort();
    const q = $("#search").value.trim();
    $("#suggestions").hidden = true;
    if (q.length < 2) return;
    searchTimer = setTimeout(async () => {
      searchController = new AbortController();
      try {
        const data = await request(
          "/search/suggest?q=" + encodeURIComponent(q) + "&limit=4",
          { signal: searchController.signal },
        );
        if ($("#search").value.trim() !== q) return;
        const matches = Array.isArray(data.products) ? data.products : [];
        $("#suggestions").innerHTML =
          matches
            .map((p) => `<a href="${productUrl(p._id)}">${esc(p.nome)}</a>`)
            .join("") +
          `<a href="/pages/menu-departments-item/search.html?search=${encodeURIComponent(q)}">Ver todos os resultados de “${esc(q)}” →</a>`;
        $("#suggestions").hidden = false;
      } catch {
        /* Full search remains available on Enter. */
      }
    }, 220);
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".search")) {
      clearTimeout(searchTimer);
      searchController?.abort();
      $("#suggestions").hidden = true;
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      clearTimeout(searchTimer);
      searchController?.abort();
      $("#suggestions").hidden = true;
    }
  });
  $(".menu-toggle").addEventListener("click", () => {
    const open = $("#navigation").classList.toggle("open");
    $(".menu-toggle").setAttribute("aria-expanded", open);
  });
  $("#navigation").addEventListener("click", (e) => {
    if (e.target.closest("a")) {
      $("#navigation").classList.remove("open");
      $(".menu-toggle").setAttribute("aria-expanded", "false");
    }
  });
  document.querySelectorAll("[data-filter]").forEach((b) =>
    b.addEventListener("click", () => {
      filter = b.dataset.filter;
      document
        .querySelectorAll("[data-filter]")
        .forEach((x) => x.setAttribute("aria-pressed", x === b));
      render();
    }),
  );
  $("#open-favorites").addEventListener("click", () => {
    location.href = "/pages/favoritos.html";
  });
  $("#account-button").addEventListener("click", () => {
    location.href = user() ? "/pages/meus-dados.html" : "/pages/login.html";
  });
  $(".close").addEventListener("click", () => $("#info").close());
  $(".close-action").addEventListener("click", () => $("#info").close());
  async function cartItems() {
    const u = user();
    return u
      ? await request("/cart/" + encodeURIComponent(u.id), authorized())
      : [];
  }
  async function refreshCartCount() {
    try {
      const items = await cartItems();
      $("#cart-count").textContent = Array.isArray(items)
        ? items.reduce((n, item) => n + Number(item.quantity || 0), 0)
        : 0;
    } catch {
      $("#cart-count").textContent = "";
    }
  }
  async function openCart() {
    if (!user()) return login();
    show("Sua sacola", "<p>Carregando sua sacola…</p>");
    try {
      const items = await cartItems();
      const rows = Array.isArray(items) ? items : [];
      const valid = rows.filter((item) => item.product?._id);
      $("#dialog-body").innerHTML = valid.length
        ? valid
            .map(
              (item) =>
                `<div class="cart-row"><img src="${esc(safeImage(item.product.imagemPrincipal))}" alt="" width="65" height="65"><div><a href="${productUrl(item.product._id)}">${esc(item.product.nome)}</a><p>${Number(item.quantity)} un. · ${money(Number.isFinite(Number(item.effectivePrice)) ? Number(item.effectivePrice) * Number(item.quantity) : ProductPageUtils.price(item.product, item.quantity, !!item.isSubscribed).total)}</p>${item.isSubscribed ? "<small>Preço Club selecionado</small>" : ""}</div><button class="cart-remove" data-remove="${esc(item.product._id)}" aria-label="Remover ${esc(item.product.nome)}">✕</button></div>`,
            )
            .join("") +
          '<a class="button cart-checkout" href="/pages/checkout.html">Conferir e finalizar pedido →</a>'
        : "<p>Sua sacola está vazia. Explore o catálogo e escolha os produtos para seu pet.</p>";
      $("#cart-count").textContent = rows.reduce(
        (n, item) => n + Number(item.quantity || 0),
        0,
      );
    } catch (err) {
      $("#dialog-body").innerHTML =
        `<p>${esc(err.message)}</p><a href="/pages/login.html">Entrar na conta →</a>`;
    }
  }
  $("#cart-button").addEventListener("click", openCart);
  $("#dialog-body").addEventListener("click", async (e) => {
    const button = e.target.closest("[data-remove]");
    if (!button || cartBusy) return;
    const u = user();
    if (!u) return login();
    cartBusy = true;
    button.disabled = true;
    try {
      await request(
        "/cart/" +
          encodeURIComponent(u.id) +
          "/" +
          encodeURIComponent(button.dataset.remove),
        authorized({ method: "DELETE" }),
      );
      await openCart();
    } catch (err) {
      notify(err.message);
      button.disabled = false;
    } finally {
      cartBusy = false;
    }
  });
  function storeMarkup(s) {
    const address = String(s.endereco || "").replaceAll(" | ", ", ");
    const days = [
      ["segunda", "Segunda"],
      ["terca", "Terça"],
      ["quarta", "Quarta"],
      ["quinta", "Quinta"],
      ["sexta", "Sexta"],
      ["sabado", "Sábado"],
      ["domingo", "Domingo"],
    ];
    const hours = days
      .filter(([key]) => s.horario?.[key])
      .map(([key, label]) => {
        const h = s.horario[key];
        return `${label}: ${h.fechada ? "fechado" : h.abre && h.fecha ? esc(h.abre) + " às " + esc(h.fecha) : "consulte a loja"}`;
      })
      .join("<br>");
    const phone = String(s.whatsapp || "").replace(/\D/g, "");
    return `<article class="store"><span class="store-tag">⌖ SUA LOJA NO BAIRRO</span><h3>${esc(s.nome)}</h3><p>${esc(address)}${s.cep ? "<br>CEP " + esc(s.cep) : ""}</p><details class="store-hours"><summary>Ver horários de atendimento</summary><div class="hours">${hours || "Consulte os horários com nossa equipe."}</div></details><div class="store-links">${phone ? `<a href="https://wa.me/${phone.startsWith("55") ? phone : "55" + phone}" target="_blank" rel="noopener">Conversar no WhatsApp ↗</a>` : ""}<a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}" target="_blank" rel="noopener">Como chegar ↗</a></div></article>`;
  }
  async function init() {
    await Promise.allSettled([
      (async () => {
        try {
          const data = await request("/products/destaques");
          products = (Array.isArray(data) ? data : []).filter(
            (p) => !p.inativo && !p.naoMostrarNoSite,
          );
          render();
        } catch {
          $("#products").innerHTML =
            '<p>Não foi possível carregar a vitrine. <a href="/pages/menu-departments-item/search.html?search=*">Explorar o catálogo →</a></p>';
        }
      })(),
      (async () => {
        try {
          buildCategoryNavigation(await request("/categories"));
        } catch {
          $("#navigation").insertAdjacentHTML(
            "beforeend",
            '<a href="/pages/menu-departments-item/search.html?search=*">Explorar todo o catálogo →</a>',
          );
        }
      })(),
      (async () => {
        try {
          const data = await request("/product-experience/stores");
          $("#stores").innerHTML =
            (Array.isArray(data) ? data : []).map(storeMarkup).join("") ||
            '<p><a href="/pages/nossas-lojas.html">Conheça nossas lojas →</a></p>';
        } catch {
          $("#stores").innerHTML =
            '<p><a href="/pages/nossas-lojas.html">Consulte os endereços e contatos das lojas →</a></p>';
        }
      })(),
      (async () => {
        const u = user();
        if (!u) return;
        try {
          const data = await request(
            "/favorites/" + encodeURIComponent(u.id),
            authorized(),
          );
          favorites = new Set(Array.isArray(data) ? data : []);
          count();
          render();
        } catch {
          /* Public shopping stays available when the saved session expires. */
        }
      })(),
      refreshCartCount(),
    ]);
  }
  init();

  /* Category navigation and shelf interactions follow. */
  function buildCategoryNavigation(categories) {
    const nav = $("#navigation");
    const byId = new Map(categories.map((c) => [String(c._id), c]));
    const children = (id) =>
      categories
        .filter((c) => (c.parent || "") === id)
        .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    const roots = children("");
    const url = (c) => {
      const query = new URLSearchParams({ category: c.nome });
      const parent = byId.get(c.parent);
      if (parent) {
        query.set("parent", parent.nome);
        const grandparent = byId.get(parent.parent);
        if (grandparent) query.set("grandparent", grandparent.nome);
      }
      return "/pages/menu-departments-item/search.html?" + query;
    };
    document.querySelectorAll("[data-category]").forEach((card) => {
      const c = roots.find((c) => c.nome === card.dataset.category);
      if (c) card.href = url(c);
    });
    const departments = [
      ["Cachorro", "Cachorros"],
      ["Gato", "Gatos"],
      ["Pássaros", "Pássaros"],
      ["Peixe", "Peixes"],
      ["Outros Pets", "Outros pets"],
    ]
      .map(([name, label]) => ({
        category: roots.find((c) => c.nome === name),
        label,
      }))
      .filter((x) => x.category);
    const trigger = (id, label) =>
      `<button type="button" class="department-trigger" data-root="${esc(id)}" aria-expanded="false" aria-controls="category-cascade">${esc(label)} <span aria-hidden="true">⌄</span></button>`;
    const row = (c) => {
      const hasChildren = children(c._id).length > 0;
      return `<div class="cascade-row" data-node="${esc(c._id)}"><a href="${esc(url(c))}" title="${esc(c.nome)}">${esc(c.nome)}</a>${hasChildren ? `<button type="button" class="cascade-expand" data-expand="${esc(c._id)}" aria-label="Abrir subcategorias de ${esc(c.nome)}" aria-expanded="false" aria-controls="level-${esc(c._id)}">›</button>` : ""}</div>`;
    };
    const level = (id, nodes) =>
      `<div class="cascade-level" id="level-${esc(id)}" data-level="${esc(id)}" hidden>${id === "all" ? "" : `<a class="cascade-view-all" href="${esc(url(byId.get(id)))}">Ver tudo em ${esc(byId.get(id).nome)} →</a>`}<div class="cascade-list">${nodes.map(row).join("")}</div></div>`;
    nav.innerHTML =
      trigger("all", "☷ Todos os departamentos") +
      departments
        .map(({ category: c, label }) => trigger(c._id, label))
        .join("") +
      '<a href="#club">E o Bicho Club <span class="tiny">CONHEÇA</span></a><a href="#lojas">Nossas lojas</a>' +
      `<div id="category-cascade" class="cascade-panel" aria-label="Subcategorias" hidden><div class="cascade-heading"><div class="cascade-trail" aria-label="Caminho de categorias"></div><button type="button" class="cascade-close" aria-label="Fechar subcategorias">✕</button></div><div class="cascade-columns">${level("all", roots)}${categories
        .filter((c) => children(c._id).length)
        .map((c) => level(c._id, children(c._id)))
        .join("")}</div></div>`;
    const panel = $("#category-cascade"),
      levels = [...panel.querySelectorAll(".cascade-level")],
      triggers = [...nav.querySelectorAll(".department-trigger")];
    let activeRoot = null,
      path = [],
      timer;
    const desktop = () => matchMedia("(min-width:681px)").matches;
    function close() {
      clearTimeout(timer);
      panel.hidden = true;
      activeRoot = null;
      path = [];
      triggers.forEach((t) => t.setAttribute("aria-expanded", "false"));
      panel
        .querySelectorAll("[aria-expanded=true]")
        .forEach((t) => t.setAttribute("aria-expanded", "false"));
    }
    function layout() {
      if (panel.hidden) return;
      const ids = [activeRoot, ...path];
      // A short viewport distributes the current list into columns rather than adding an inner scrollbar.
      const available = Math.max(
        120,
        window.innerHeight - panel.getBoundingClientRect().top - 88,
      );
      const rows = desktop()
        ? Math.max(3, Math.min(16, Math.floor(available / 32)))
        : 16;
      const budget = Math.max(
        1,
        Math.floor(nav.getBoundingClientRect().width / 210),
      );
      let visible = ids.slice(),
        units = (id) =>
          Math.max(
            1,
            Math.ceil(children(id === "all" ? "" : id).length / rows),
          );
      while (
        visible.length > 1 &&
        visible.reduce((sum, id) => sum + units(id), 0) > budget
      )
        visible.shift();
      if (!desktop()) visible = [ids.at(-1)];
      if (desktop()) {
        const navWidth = nav.getBoundingClientRect().width || 1240;
        const width = Math.min(
          navWidth,
          visible.reduce((sum, id) => sum + units(id), 0) * 250 + 36,
        );
        const trigger = triggers.find((t) => t.dataset.root === activeRoot);
        panel.style.width = width + "px";
        panel.style.left =
          Math.max(0, Math.min(trigger?.offsetLeft || 0, navWidth - width)) +
          "px";
        panel.style.right = "auto";
      } else {
        panel.style.width = "100%";
        panel.style.left = "";
        panel.style.right = "";
      }

      levels.forEach((level) => {
        const index = visible.indexOf(level.dataset.level);
        level.hidden = index < 0;
        if (index >= 0) {
          const count = children(
            level.dataset.level === "all" ? "" : level.dataset.level,
          ).length;
          level.style.setProperty(
            "--level-columns",
            desktop() ? Math.max(1, Math.ceil(count / rows)) : 1,
          );
          level.style.setProperty(
            "--level-rows",
            String(
              Math.ceil(
                count / (desktop() ? Math.max(1, Math.ceil(count / rows)) : 1),
              ),
            ),
          );
          level.style.flex = desktop()
            ? String(Math.max(1, Math.ceil(count / rows)))
            : "1";
        }
      });
      panel.querySelectorAll(".cascade-row").forEach((row) => {
        const selected = path.includes(row.dataset.node);
        row.classList.toggle("is-selected", selected);
        row.querySelector("button")?.setAttribute("aria-expanded", selected);
      });
      const names = ids.map(
        (id, index) =>
          `<button type="button" data-crumb="${index}">${id === "all" ? "Todos os departamentos" : esc(byId.get(id)?.nome || "")}</button>`,
      );
      panel.querySelector(".cascade-trail").innerHTML = names.join(
        '<span aria-hidden="true">›</span>',
      );
    }
    function open(root) {
      clearTimeout(timer);
      if (activeRoot !== root) path = [];
      activeRoot = root;
      panel.hidden = false;
      triggers.forEach((t) =>
        t.setAttribute("aria-expanded", t.dataset.root === root),
      );
      layout();
    }
    function expand(row) {
      clearTimeout(timer);
      const parent = row.closest(".cascade-level").dataset.level;
      const ids = [activeRoot, ...path],
        index = ids.indexOf(parent);
      if (index < 0) return;
      const next = row.querySelector("[data-expand]")?.dataset.expand;
      const nextPath = path.slice(0, index);
      if (next) nextPath.push(next);
      if (JSON.stringify(path) === JSON.stringify(nextPath)) return;
      path = nextPath;
      layout();
    }
    triggers.forEach((t) => {
      t.addEventListener("pointerenter", (e) => {
        if (e.pointerType === "mouse" && desktop()) open(t.dataset.root);
      });
      t.addEventListener("click", () =>
        activeRoot === t.dataset.root && !panel.hidden
          ? close()
          : open(t.dataset.root),
      );
      t.addEventListener("keydown", (e) => {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          open(t.dataset.root);
          panel.querySelector(".cascade-level:not([hidden]) a")?.focus();
        }
      });
    });
    panel.querySelectorAll(".cascade-row").forEach((row) => {
      row.addEventListener("pointerenter", (e) => {
        if (e.pointerType === "mouse" && desktop()) expand(row);
      });
      row.querySelector("button")?.addEventListener("click", () => {
        expand(row);
        if (!desktop())
          panel.querySelector(".cascade-level:not([hidden]) a")?.focus();
      });
      row.addEventListener("keydown", (e) => {
        if (e.key === "ArrowRight" && row.querySelector("button")) {
          e.preventDefault();
          expand(row);
          panel.querySelector(`#level-${row.dataset.node} a`)?.focus();
        }
      });
    });
    panel.querySelector(".cascade-trail").addEventListener("click", (e) => {
      const crumb = e.target.closest("[data-crumb]");
      if (!crumb) return;
      path = path.slice(0, Number(crumb.dataset.crumb));
      layout();
    });
    nav.addEventListener("pointerleave", (e) => {
      if (e.pointerType === "mouse" && desktop())
        timer = setTimeout(close, 180);
    });
    nav.addEventListener("pointerenter", () => clearTimeout(timer));
    nav.addEventListener("focusout", (e) => {
      if (!nav.contains(e.relatedTarget)) close();
    });
    nav.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        const root = activeRoot;
        close();
        triggers.find((t) => t.dataset.root === root)?.focus();
      } else if (e.key === "ArrowLeft" && path.length) {
        e.preventDefault();
        const previous = path.pop();
        layout();
        panel
          .querySelector(
            `.cascade-level:not([hidden]) [data-expand="${previous}"]`,
          )
          ?.focus();
      }
    });
    panel.querySelector(".cascade-close").addEventListener("click", () => {
      const root = activeRoot;
      close();
      triggers.find((t) => t.dataset.root === root)?.focus();
    });
    document.addEventListener("click", (e) => {
      if (!nav.contains(e.target)) close();
    });
    $(".menu-toggle").addEventListener("click", () => {
      if (!nav.classList.contains("open")) close();
    });
    window.addEventListener("resize", layout);
  }

  document.querySelectorAll("[data-slide]").forEach((button) =>
    button.addEventListener("click", () => {
      const shelf = $("#products");
      const card = shelf.querySelector(".product");
      if (!card) return;
      const step =
        card.getBoundingClientRect().width +
        parseFloat(getComputedStyle(shelf).gap || 0);
      shelf.scrollBy({
        left: Number(button.dataset.slide) * step,
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
      });
    }),
  );
  $("#products").addEventListener("keydown", (event) => {
    if (
      event.target !== event.currentTarget ||
      !["ArrowLeft", "ArrowRight"].includes(event.key)
    )
      return;
    event.preventDefault();
    document
      .querySelector(
        '[data-slide="' + (event.key === "ArrowRight" ? "1" : "-1") + '"]',
      )
      .click();
  });
})();
