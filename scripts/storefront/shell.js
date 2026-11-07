(() => {
  "use strict";
  if (window.StorefrontShell) return;
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
    favoritesRevision = 0,
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
    if (window.CATALOG_PREVIEW && options.method && options.method !== "GET")
      throw Error("Esta prévia não altera sua conta nem faz compras.");
    const response = await fetch(api + path, {
      ...options,
      signal: options.signal || AbortSignal.timeout(15000),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401) {
        const error = Error(
          "Sua sessão expirou. Entre novamente na sua conta.",
        );
        error.status = 401;
        throw error;
      }
      const error = Error(
        body.message || "Não foi possível concluir. Tente novamente.",
      );
      error.status = response.status;
      throw error;
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
    if (window.CATALOG_PREVIEW) {
      show(
        "Prévia do catálogo",
        '<p>Você está na versão de teste. A conta e as compras reais continuam no site oficial.</p><a href="https://www.peteobicho.com.br/pages/login.html">Entrar no site oficial →</a>',
      );
      return;
    }
    location.href = "/pages/login.html";
  }
  function count() {
    $("#favorite-count").textContent = favorites.size;
  }
  let dialogFocus = null,
    dialogOverflow = null;
  function show(title, body, account = false) {
    const dialog = $("#info");
    dialog.classList.toggle("account-dialog", account);
    $(".close-action").textContent = account
      ? "Voltar à loja"
      : "Continuar explorando";
    $("#dialog-title").textContent = title;
    $("#dialog-body").innerHTML = body;
    if (!dialog.open) {
      dialogFocus = document.activeElement;
      dialogOverflow = {
        html: document.documentElement.style.overflow,
        body: document.body.style.overflow,
      };
      document.documentElement.style.overflow = "hidden";
      document.body.style.overflow = "hidden";
      dialog.showModal();
      dialog.querySelector(".close").focus();
    }
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
    window.dispatchEvent(new CustomEvent("storefront:favorites"));
  }
  document.addEventListener("click", async (e) => {
    const favorite = e.target.closest(".favorite");
    if (favorite) {
      if (window.CATALOG_PREVIEW) {
        if (user()) {
          notify(
            "Nesta prévia, os dados da sua conta são apenas para consulta.",
          );
          return;
        }
        const id = favorite.dataset.id;
        favorites.has(id) ? favorites.delete(id) : favorites.add(id);
        favorite.setAttribute("aria-pressed", favorites.has(id));
        favorite.textContent = favorites.has(id) ? "♥" : "♡";
        try {
          const details = JSON.parse(
            localStorage.getItem("catalog-preview-favorite-names") || "{}",
          );
          if (favorites.has(id))
            details[id] =
              favorite.closest(".product")?.querySelector("h3")?.textContent ||
              "";
          else delete details[id];
          localStorage.setItem(
            "catalog-preview-favorite-names",
            JSON.stringify(details),
          );
          localStorage.setItem(
            "catalog-preview-favorites",
            JSON.stringify([...favorites]),
          );
        } catch {}
        count();
        notify("Favoritos salvos apenas nesta prévia.");
        return;
      }
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
  $("#open-favorites").addEventListener("click", () => {
    if (window.CATALOG_PREVIEW && !user()) {
      let details = {};
      try {
        details = JSON.parse(
          localStorage.getItem("catalog-preview-favorite-names") || "{}",
        );
      } catch {}
      show(
        "Seus favoritos nesta prévia",
        favorites.size
          ? [...favorites]
              .map(
                (id) =>
                  `<a href="${productUrl(id)}">${esc(details[id] || "Ver produto salvo")} →</a>`,
              )
              .join("")
          : "<p>Toque no coração de um produto para salvar aqui. Esta lista fica apenas neste navegador.</p>",
      );
      return;
    }
    location.href = "/pages/favoritos.html";
  });
  $("#account-button").addEventListener("click", () => {
    const current = user();
    if (!current) {
      location.href = "/pages/login.html";
      return;
    }
    const icon = (paths) =>
      `<svg viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;
    const symbols = {
      user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
      box: '<path d="m3 7 9-4 9 4v10l-9 4-9-4V7Zm0 0 9 4 9-4M12 11v10M7 5l10 5v5"/>',
      paw: '<ellipse cx="7" cy="7" rx="2" ry="3"/><ellipse cx="17" cy="7" rx="2" ry="3"/><ellipse cx="3" cy="12" rx="1.5" ry="2"/><ellipse cx="21" cy="12" rx="1.5" ry="2"/><path d="M6 19c-2-3 2-8 6-8s8 5 6 8c-2 3-4 0-6 0s-4 3-6 0Z"/>',
      heart:
        '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>',
      lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4M12 14v3"/>',
      grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    };
    const links = [
      ["meus-pedidos", "box", "Meus pedidos", "Acompanhe suas compras"],
      ["meus-pets", "paw", "Meus pets", "Os companheiros da sua vida"],
      ["favoritos", "heart", "Meus favoritos", "Seus produtos salvos"],
      ["meus-dados", "user", "Meus dados", "Informações da sua conta"],
      [
        "alterar-senha",
        "lock",
        "Segurança da conta",
        "Senha e opções de proteção",
      ],
    ];
    if (["admin", "admin_master"].includes(current.role))
      links.push([
        "admin",
        "grid",
        "Painel administrativo",
        "Acesse a gestão da loja",
      ]);
    const name = String(current.nomeCompleto || current.nome || "").trim();
    const initials = name
      ? name
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 2)
          .map((part) => Array.from(part)[0])
          .join("")
          .toLocaleUpperCase("pt-BR")
      : "♡";
    show(
      "Minha conta",
      `
      <section class="account-profile"><span class="account-avatar" aria-hidden="true">${esc(initials)}</span><div><span>QUE BOM TER VOCÊ POR AQUI</span><h3>${name ? "Olá, " + esc(name.split(/\s+/)[0]) + "!" : "Bem-vindo!"}</h3><p>O cuidado com seu pet começa aqui.</p></div></section>
      <nav class="account-shortcuts" aria-label="Opções da sua conta">${links.map(([path, symbol, title, description]) => `<a href="/pages/${path}.html"><span class="account-icon">${icon(symbols[symbol])}</span><span class="account-link-copy"><strong>${title}</strong><small>${description}</small></span><span class="account-chevron" aria-hidden="true">›</span></a>`).join("")}</nav>
      <a class="account-help" href="/pages/nossas-lojas.html"><span aria-hidden="true">♡</span><span><strong>Precisou? Estamos por perto.</strong><small>Fale com a equipe da sua loja →</small></span></a>
      <button type="button" data-storefront-logout>${icon('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>')}Sair da conta</button>`,
      true,
    );
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest("[data-storefront-logout]")) return;
    localStorage.removeItem("loggedInUser");
    location.href = "/";
  });
  $(".close").addEventListener("click", () => $("#info").close());
  $(".close-action").addEventListener("click", () => $("#info").close());
  $("#info").addEventListener("close", () => {
    if (dialogOverflow) {
      document.documentElement.style.overflow = dialogOverflow.html;
      document.body.style.overflow = dialogOverflow.body;
      dialogOverflow = null;
    }
    if (dialogFocus?.isConnected) dialogFocus.focus();
  });
  $("#info").addEventListener("click", (event) => {
    const dialog = $("#info");
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    )
      dialog.close();
  });
  async function cartItems() {
    const u = user();
    return u
      ? await request("/cart/" + encodeURIComponent(u.id), authorized())
      : [];
  }
  async function refreshCartCount() {
    try {
      const items = await cartItems();
      const previewCount = window.StorefrontCart?.previewCount?.();
      if (previewCount !== null && previewCount !== undefined) {
        $("#cart-count").textContent = previewCount;
        return;
      }
      $("#cart-count").textContent = Array.isArray(items)
        ? items.reduce((n, item) => n + Number(item.quantity || 0), 0)
        : 0;
    } catch {
      $("#cart-count").textContent = "";
    }
  }
  const categoryCacheKey = 'storefront-category-menu-v1';
  let categoryTask = null, categoryBuilt = false;
  const validCategories = value => Array.isArray(value) && value.length > 0 && value.length <= 5000 && value.every(c => c && typeof c._id === 'string' && typeof c.nome === 'string' && (!c.parent || typeof c.parent === 'string'));
  function categoryNotice(failed = false) {
    let status = document.getElementById('category-menu-status');
    if (categoryBuilt) { status?.remove(); return; }
    if (!status) { status=document.createElement('div');status.id='category-menu-status';status.setAttribute('role','status');status.style.cssText='padding:5px 16px;font-size:12px;text-align:center;color:#47562b';$('#navigation').after(status); }
    status.replaceChildren(document.createTextNode(failed ? 'As subcategorias estão temporariamente indisponíveis. ' : 'Carregando subcategorias…'));
    if(failed){const retry=document.createElement('button');retry.type='button';retry.textContent='Tentar novamente';retry.style.cssText='cursor:pointer;text-decoration:underline';retry.addEventListener('click',()=>refreshNavigation());status.append(retry);}
  }
  function refreshNavigation() {
    if (categoryTask) return categoryTask;
    categoryTask = (async () => {
      if (!categoryBuilt) {
        try {
          const cached=JSON.parse(localStorage.getItem(categoryCacheKey));
          if(cached?.expires>Date.now() && validCategories(cached.categories)){buildCategoryNavigation(cached.categories);categoryBuilt=true;}
        } catch {}
      }
      categoryNotice();
      for(let attempt=0;attempt<2;attempt++){
        const controller=new AbortController();let timer;
        try {
          const categories=await Promise.race([
            request('/categories',{signal:controller.signal}),
            new Promise((_,reject)=>{timer=setTimeout(()=>{reject(Error('A consulta das categorias demorou.'));controller.abort();},4000);}),
          ]);
          if(!validCategories(categories))throw Error('Categorias indisponíveis.');
          // Keep an open submenu stable. Updated taxonomy is available on the next page.
          if(!categoryBuilt){buildCategoryNavigation(categories);categoryBuilt=true;}
          try {localStorage.setItem(categoryCacheKey,JSON.stringify({expires:Date.now()+86400000,categories:categories.map(c=>({_id:c._id,nome:c.nome,parent:c.parent||null}))}));}catch{}
          categoryNotice();return true;
        }catch(error){if(attempt){categoryNotice(true);return false;}}
        finally{clearTimeout(timer);}
      }
    })().finally(()=>{categoryTask=null;});
    return categoryTask;
  }
  window.addEventListener('online',()=>{if(!categoryBuilt)refreshNavigation();});
  window.addEventListener('pageshow',event=>{if(event.persisted&&!categoryBuilt)refreshNavigation();});
  async function init() {
    const current = user(),
      greeting = $("#account-button > span");
    const displayName = current?.nomeCompleto || current?.nome || "";
    if (
      greeting &&
      typeof displayName === "string" &&
      displayName.trim() &&
      greeting.firstChild?.nodeType === 3
    )
      greeting.firstChild.textContent =
        "Olá, " + displayName.trim().split(/\s+/)[0] + " ";
    await Promise.allSettled([
      refreshNavigation(),
      (async () => {
        if (window.CATALOG_PREVIEW && !user()) {
          try {
            favorites = new Set(
              JSON.parse(
                localStorage.getItem("catalog-preview-favorites") || "[]",
              ),
            );
          } catch {}
          count();
          render();
          return;
        }
        const u = user();
        if (!u) return;
        try {
          const ticket = favoritesRevision;
          const ids = await request(
            "/favorites/" + encodeURIComponent(u.id),
            authorized(),
          );
          if (ticket !== favoritesRevision) return;
          favorites = new Set(Array.isArray(ids) ? ids : []);
          count();
          render();
        } catch {}
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
      id === "all"
        ? `<button type="button" class="department-trigger" data-root="all" aria-expanded="false" aria-controls="category-cascade">${esc(label)} <span aria-hidden="true">⌄</span></button>`
        : `<div class="department-entry"><a class="department-trigger" data-root="${esc(id)}" href="${esc(url(byId.get(id)))}" aria-expanded="false" aria-controls="category-cascade">${esc(label)}</a><button type="button" class="department-toggle" data-toggle-root="${esc(id)}" aria-label="Abrir subcategorias de ${esc(label)}" aria-expanded="false" aria-controls="category-cascade">⌄</button></div>`;
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
      '<a href="/#club">E o Bicho Club <span class="tiny">CONHEÇA</span></a><a href="/pages/nossas-lojas.html">Nossas lojas</a>' +
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
      triggers.forEach((t) => {
        t.setAttribute("aria-expanded", "false");
        t.closest(".department-entry")
          ?.querySelector(".department-toggle")
          ?.setAttribute("aria-expanded", "false");
      });
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
      const navRect = nav.getBoundingClientRect();
      const navWidth = navRect.width || 1240;
      const trigger = triggers.find((t) => t.dataset.root === activeRoot);
      const anchor = trigger?.closest(".department-entry") || trigger;
      const triggerLeft = anchor
        ? anchor.getBoundingClientRect().left - navRect.left
        : 0;
      const units = (id) =>
        Math.max(1, Math.ceil(children(id === "all" ? "" : id).length / rows));
      // Reserve only the width of this category, not a fixed 800px panel.
      // Measure relative to the navigation, even when the link has a nested offset parent.
      const rootWidth = Math.min(navWidth, units(activeRoot) * 240 + 36);
      const anchorLeft = Math.max(
        0,
        Math.min(triggerLeft, navWidth - rootWidth),
      );
      const budget = Math.max(
        1,
        Math.floor((navWidth - anchorLeft - 36) / 254),
      );
      let visible = ids.slice();
      while (
        visible.length > 1 &&
        visible.reduce((sum, id) => sum + units(id), 0) > budget
      )
        visible.shift();
      if (!desktop()) visible = [ids.at(-1)];
      if (desktop()) {
        const width =
          visible.reduce((sum, id) => sum + units(id) * 240, 0) +
          Math.max(0, visible.length - 1) * 14 +
          36;
        panel.style.width = Math.min(navWidth - anchorLeft, width) + "px";
        panel.style.left = anchorLeft + "px";
        panel.style.right = "auto";
      } else {
        panel.style.width = "100%";
        panel.style.left = "";
        panel.style.right = "";
      }

      levels.forEach((level) => {
        const index = visible.indexOf(level.dataset.level);
        level.hidden = index < 0;
        level.style.order = String(index);
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
            ? "0 0 " + Math.max(1, Math.ceil(count / rows)) * 240 + "px"
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
      triggers.forEach((t) => {
        t.setAttribute("aria-expanded", t.dataset.root === root);
        t.closest(".department-entry")
          ?.querySelector(".department-toggle")
          ?.setAttribute("aria-expanded", t.dataset.root === root);
      });
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
      (t.closest(".department-entry") || t).addEventListener(
        "pointerleave",
        (e) => {
          if (e.pointerType !== "mouse" || !desktop()) return;
          clearTimeout(timer);
          if (!panel.contains(e.relatedTarget)) timer = setTimeout(close, 180);
        },
      );
      t.addEventListener("pointerenter", (e) => {
        if (e.pointerType === "mouse" && desktop()) open(t.dataset.root);
      });
      t.addEventListener("click", () => {
        if (t.tagName === "A") {
          close();
          return;
        }
        activeRoot === t.dataset.root && !panel.hidden
          ? close()
          : open(t.dataset.root);
      });
      const entry = t.closest(".department-entry");
      entry?.addEventListener("pointerenter", (e) => {
        if (e.pointerType === "mouse" && desktop()) open(t.dataset.root);
      });
      entry
        ?.querySelector(".department-toggle")
        ?.addEventListener("click", () =>
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
    // A pointer can leave a category while remaining inside the navigation
    // (for example, over Club or Stores). Those links have no category panel.
    nav.addEventListener("pointerover", (e) => {
      if (e.pointerType !== "mouse" || !desktop() || panel.contains(e.target))
        return;
      const action = e.target.closest("a,button");
      if (
        action &&
        !action.closest(".department-entry") &&
        !action.matches(".department-trigger")
      )
        close();
    });
    $(".header-main").addEventListener("pointerenter", (e) => {
      if (e.pointerType === "mouse" && desktop()) close();
    });
    panel.addEventListener("pointerenter", () => clearTimeout(timer));
    panel.addEventListener("pointerleave", (e) => {
      if (e.pointerType !== "mouse" || !desktop()) return;
      clearTimeout(timer);
      const trigger = triggers.find((t) => t.dataset.root === activeRoot);
      const entry = trigger?.closest(".department-entry") || trigger;
      if (!entry?.contains(e.relatedTarget)) timer = setTimeout(close, 180);
    });
    nav.addEventListener("pointerleave", (e) => {
      if (e.pointerType === "mouse" && desktop()) {
        clearTimeout(timer);
        timer = setTimeout(close, 180);
      }
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

  window.StorefrontShell = {
    refreshNavigation,
    offer,
    safeImage,
    money,
    esc,
    request,
    notify,
    productUrl,
    user,
    authorized,
    login,
    isFavorite: (id) => favorites.has(id),
    setFavoriteIds: (ids) => {
      favoritesRevision++;
      favorites = new Set(Array.isArray(ids) ? ids.map(String) : []);
      count();
      render();
    },
  };
})();
