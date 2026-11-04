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
    const children = (id) =>
      categories
        .filter((c) => c.parent === id)
        .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    const byId = new Map(categories.map((c) => [c._id, c]));
    const roots = categories.filter((c) => !c.parent);
    document.querySelectorAll("[data-category]").forEach((card) => {
      const category = roots.find((c) => c.nome === card.dataset.category);
      if (category)
        card.href =
          "/pages/menu-departments-item/search.html?" +
          new URLSearchParams({ category: category.nome });
    });
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
    const link = (c) => `<a href="${esc(url(c))}">${esc(c.nome)}</a>`;
    const branch = (c, depth = 0) => {
      const nested = children(c._id);
      return nested.length && depth < 5
        ? `<details class="category-branch"><summary>${esc(c.nome)}</summary><div>${link(c).replace(">" + esc(c.nome) + "</a>", ">Ver tudo em " + esc(c.nome) + " ↗</a>")}${nested.map((x) => branch(x, depth + 1)).join("")}</div></details>`
        : link(c);
    };
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
    const item = (id, label, content, viewAll = "") =>
      `<div class="nav-department"><button class="department-trigger" type="button" id="trigger-${id}" aria-expanded="false" aria-controls="panel-${id}">${esc(label)} <span aria-hidden="true">⌄</span></button><div class="category-panel" id="panel-${id}" aria-labelledby="trigger-${id}" hidden><div class="category-panel-heading"><div><span class="eyebrow">ENCONTRE O QUE SEU PET PRECISA</span><h2>${esc(label)}</h2></div>${viewAll}<button type="button" class="category-close" aria-label="Fechar subcategorias">✕</button></div><div class="category-columns">${content}</div></div></div>`;
    nav.innerHTML =
      item(
        "all",
        "☷ Todos os departamentos",
        roots
          .map(
            (c) =>
              `<div class="category-group"><h3>${link(c)}</h3>${children(c._id)
                .map((x) => branch(x))
                .join("")}</div>`,
          )
          .join(""),
      ) +
      departments
        .map(({ category: c, label }) =>
          item(
            c._id,
            label,
            children(c._id)
              .map(
                (x) =>
                  `<div class="category-group"><h3>${link(x)}</h3>${children(
                    x._id,
                  )
                    .map((y) => branch(y))
                    .join("")}</div>`,
              )
              .join(""),
            `<a class="category-view-all" href="${esc(url(c))}">Ver todos os produtos ↗</a>`,
          ),
        )
        .join("") +
      '<a href="#club">E o Bicho Club <span class="tiny">CONHEÇA</span></a><a href="#lojas">Nossas lojas</a>';
    const items = [...nav.querySelectorAll(".nav-department")];
    let timer;
    const close = () => {
      clearTimeout(timer);
      items.forEach((i) => {
        i.querySelector(".department-trigger").setAttribute(
          "aria-expanded",
          "false",
        );
        i.querySelector(".category-panel").hidden = true;
      });
    };
    const open = (item) => {
      close();
      item
        .querySelector(".department-trigger")
        .setAttribute("aria-expanded", "true");
      item.querySelector(".category-panel").hidden = false;
    };
    items.forEach((item) => {
      const trigger = item.querySelector(".department-trigger");
      trigger.addEventListener("click", () =>
        trigger.getAttribute("aria-expanded") === "true" ? close() : open(item),
      );
      item.addEventListener("pointerenter", (e) => {
        if (
          e.pointerType === "mouse" &&
          matchMedia("(min-width:681px)").matches
        )
          open(item);
      });
      item.addEventListener("pointerleave", (e) => {
        if (e.pointerType === "mouse") timer = setTimeout(close, 160);
      });
      item.addEventListener("focusin", (e) => {
        if (
          e.target !== trigger &&
          trigger.getAttribute("aria-expanded") !== "true"
        )
          open(item);
      });
      item.addEventListener("focusout", (e) => {
        if (!item.contains(e.relatedTarget)) close();
      });
      trigger.addEventListener("keydown", (e) => {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          open(item);
          item
            .querySelector(".category-panel a, .category-panel summary")
            ?.focus();
        }
      });
      item.querySelector(".category-close").addEventListener("click", () => {
        close();
        trigger.focus();
      });
    });
    nav.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        const trigger = nav.querySelector(
          '.department-trigger[aria-expanded="true"]',
        );
        close();
        trigger?.focus();
      }
    });
    document.addEventListener("click", (e) => {
      if (!nav.contains(e.target)) close();
    });
    $(".menu-toggle").addEventListener("click", () => {
      if (!nav.classList.contains("open")) close();
    });
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
