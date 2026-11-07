(() => {
  "use strict";
  try {
  if (window.CatalogPage) return;
  // Product browsing must not wait for the menu, account or bag scripts.
  const U = window.ProductPageUtils;
  if (!U || !window.CatalogInfiniteFeed) throw Error("Não foi possível iniciar o catálogo. Tente novamente.");
  const $ = (s) => document.querySelector(s);
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const S = {
    esc, money: U.money,
    isFavorite: id => window.StorefrontShell?.isFavorite(id) || false,
    productUrl: id => '/pages/menu-departments-item/product.html?id=' + encodeURIComponent(id),
    safeImage: raw => {
      try { const url = new URL(raw, window.API_CONFIG?.SERVER_URL || 'https://api.peteobicho.com.br'); return ['https:','http:'].includes(url.protocol) ? url.href : '/public/image/placeholder.svg'; }
      catch { return '/public/image/placeholder.svg'; }
    },
    offer: p => {
      if (window.StorefrontShell) return window.StorefrontShell.offer(p);
      const regular = U.price(p, 1, false), club = Number(p.precoClube), promo = p.promocaoCondicional;
      let condition = '';
      if (U.active(promo)) {
        if (promo.tipo === 'acima_de' && Number(promo.quantidadeMinima) > 0 && Number(promo.descontoPorcentagem) > 0 && Number(promo.descontoPorcentagem) <= 100) condition = `${promo.descontoPorcentagem}% de desconto a partir de ${promo.quantidadeMinima} un.`;
        if (promo.tipo === 'leve_pague' && Number(promo.leve) > Number(promo.pague) && Number(promo.pague) >= 0) condition = `Leve ${promo.leve}, pague ${promo.pague}`;
      }
      return `${regular.saving > 0 ? `<small class="old-price">De <s>${U.money(regular.base)}</s> · ${esc(regular.label)}</small>` : ''}<span class="price">${U.money(regular.unit)}</span>${club > 0 && club < regular.unit ? `<p class="club-price">${U.money(club)} com preço Club*</p>` : ''}${condition ? `<p class="conditional-offer">${esc(condition)}*</p>` : ''}<small>* Confira as condições na página do produto.</small>`;
    },
  };
  const multi = ["brand", "age", "size", "presentation"];
  async function catalogue(params, {signal} = {}) {
    const url = window.CATALOG_PREVIEW ? (window.API_CONFIG?.BASE_URL || '/api') + '/catalog?' + params : '/api/storefront-catalog?' + params;
    for (let attempt = 0; attempt < 2; attempt++) {
      const request = new AbortController();
      let timer, onAbort;
      try {
        return await Promise.race([
          (async () => {
            const response = await fetch(url, {signal: request.signal});
            const body = await response.json();
            if (!response.ok) { const error = Error(body.message || 'Não foi possível carregar o catálogo.'); error.retryable = [408,429,500,502,503,504].includes(response.status); throw error; }
            if (!Array.isArray(body.products) || !body.facets || !Array.isArray(body.breadcrumb)) throw Error('A consulta não pôde ser concluída. Tente novamente.');
            return body;
          })(),
          new Promise((_, reject) => {
            onAbort = () => { request.abort(); const error = Error('Consulta cancelada.'); error.name = 'AbortError'; reject(error); };
            if (signal?.aborted) return onAbort();
            signal?.addEventListener('abort', onAbort, {once:true});
            timer = setTimeout(() => { const error = Error('A consulta demorou mais que o esperado. Tente novamente.'); error.name = 'TimeoutError'; reject(error); request.abort(); }, 8000);
          }),
        ]);
      } catch(error) {
        if (signal?.aborted || error.name === 'AbortError' || attempt || !(error.retryable || ['TimeoutError','TypeError'].includes(error.name))) throw error;
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      }
    }
  }
  let state = new URLSearchParams(location.search),
    draft = null,
    data = null,
    controller,
    sequence = 0;
  state.delete("page");
  const queryKey = () => {
    const params = new URLSearchParams(state);
    params.delete("page");
    return params.toString();
  };
  const feed = new CatalogInfiniteFeed({
    container: $("#catalog-grid"),
    loader: $("#catalog-loader"),
    itemsHTML: cardHTML,
    requestPage: (page) => {
      const params = new URLSearchParams(state);
      params.set("page", page);
      return catalogue(params, {
        signal: controller.signal,
      });
    },
    onProgress: (loaded, total) => {
      $("#result-range").textContent = total
        ? `${loaded} de ${total} produtos carregados`
        : "Ajuste os filtros para ampliar sua busca";
    },
  });
  const saveFeed = () => {
    const params = new URLSearchParams(location.search);
    params.delete("page");
    return {
      ...history.state,
      catalogScroll: window.scrollY,
      catalogKey: params.toString(),
      catalogFeed: feed.save(),
    };
  };
  const rootQuery = () => {
    const result = new URLSearchParams();
    for (const key of ["category", "parent", "grandparent", "search"])
      if (state.has(key)) result.set(key, state.get(key));
    if (!result.has("category") && !result.has("search"))
      result.set("category", "Cachorro");
    return result;
  };
  function setValue(params, key, value) {
    if (value === undefined || value === null || value === "")
      params.delete(key);
    else params.set(key, String(value));
  }
  function update(key, value) {
    setValue(state, key, value);
    state.delete("page");
    commit();
  }
  function commit({ replace = false, scroll = false } = {}) {
    const previous = saveFeed();
    history.replaceState(
      { ...previous, catalogScroll: window.scrollY },
      "",
      location.href,
    );
    history[replace ? "replaceState" : "pushState"](
      { catalogScroll: scroll ? 0 : window.scrollY },
      "",
      "?" + state,
    );
    load(scroll);
  }
  function skeleton() {
    return (
      '<div class="catalog-batch-grid">' +
      Array.from(
        { length: 6 },
        () =>
          '<div class="catalog-skeleton" aria-hidden="true"><i></i><i></i><i></i><i></i></div>',
      ).join("") +
      "</div>"
    );
  }
  function error(message) {
    window.CatalogStartup?.finish();
    $("#catalog-grid").innerHTML =
      `<div class="catalog-empty"><span>↻</span><h2>Vamos tentar de novo?</h2><p>${esc(message)}</p><button class="button" type="button" data-retry>Tentar novamente →</button></div>`;
    $("#catalog-grid").setAttribute("aria-busy", "false");
    $("#result-count").textContent = "Não foi possível carregar os produtos";
    $("#result-range").textContent = "";
    $("#catalog-loader").replaceChildren();
  }
  async function load(scroll = false) {
    window.CatalogStartup?.begin();
    const saved =
      history.state?.catalogKey === queryKey()
        ? history.state.catalogFeed
        : null;
    feed.clear();
    controller?.abort();
    controller = new AbortController();
    const ticket = ++sequence;
    $("#catalog-grid").setAttribute("aria-busy", "true");
    $("#catalog-grid").innerHTML = skeleton();
    try {
      const result = await catalogue(state, {
        signal: controller.signal,
      });
      if (ticket !== sequence) return;
      data = result;
      if (Number(state.get("page") || 1) !== data.page) {
        if (data.page === 1) state.delete("page");
        else state.set("page", data.page);
        history.replaceState(history.state, "", "?" + state);
      }
      await render(saved);
      if (ticket !== sequence) return;
      window.CatalogStartup?.finish();
      if (saved)
        window.scrollTo({
          top: history.state?.catalogScroll || 0,
          behavior: "instant",
        });
      if (scroll)
        $("#catalog-grid").scrollIntoView({
          block: "start",
          behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
            ? "instant"
            : "smooth",
        });
    } catch (e) {
      if (ticket !== sequence || controller.signal.aborted) return;
      error(
        e.name === "TimeoutError"
          ? "A consulta demorou mais que o esperado. Tente novamente."
          : e.message || "Não foi possível carregar o catálogo.",
      );
    }
  }
  async function render(saved) {
    const name = data.category?.nome || "";
    const titles = {
      Cachorro: "Tudo para seu cachorro",
      Gato: "Tudo para seu gato",
      Peixe: "Tudo para seus peixes",
      Pássaros: "Tudo para seus pássaros",
      "Outros Pets": "Cuidado para os pequenos pets",
    };
    const title = state.has("search")
      ? `Resultados para “${state.get("search")}”`
      : titles[name] || name || "Categoria não encontrada";
    $("#catalog-title").textContent = title;
    document.title = title + " · E o Bicho";
    $("#catalog-description").textContent = state.has("search")
      ? "Explore os resultados e use os filtros para encontrar o que procura."
      : name === "Cachorro"
        ? "Da alimentação à brincadeira, encontre o cuidado que faz parte da rotina."
        : "Alimentação, conforto e cuidado para cada momento com seu pet.";
    $("#catalog-breadcrumb").innerHTML =
      '<li><a href="/">Início</a></li>' +
      data.breadcrumb
        .map((c, i) => {
          const params = new URLSearchParams({ category: c.nome });
          if (i > 0) params.set("parent", data.breadcrumb[i - 1].nome);
          if (i > 1) params.set("grandparent", data.breadcrumb[i - 2].nome);
          return `<li>${i === data.breadcrumb.length - 1 ? `<span aria-current="page">${esc(c.nome)}</span>` : `<a href="?${esc(params)}">${esc(c.nome)}</a>`}</li>`;
        })
        .join("");
    $("#result-count").textContent =
      `${data.total} ${data.total === 1 ? "produto encontrado" : "produtos encontrados"}`;
    $("#result-range").textContent = data.total
      ? `Mostrando ${(data.page - 1) * data.limit + 1}–${Math.min(data.page * data.limit, data.total)} de ${data.total}`
      : "Ajuste os filtros para ampliar sua busca";
    $("#catalog-sort").value = data.sort;
    renderFilters($("#desktop-filters"), state, "desktop");
    renderChips();
    await renderProducts(saved);
  }
  function option(key, bucket, params, index) {
    const checked = multi.includes(key)
      ? params.getAll(key).includes(bucket.value)
      : params.get(key) === bucket.value;
    return `<label class="filter-option" ${index >= 8 ? "data-extra hidden" : ""} data-filter-label="${esc(ProductPageUtils.normalize(bucket.label))}"><input type="${key === "sub" ? "radio" : "checkbox"}" name="${esc(key)}" value="${esc(bucket.value)}" ${checked ? "checked" : ""}><span>${esc(bucket.label)}</span><small>${bucket.count}</small></label>`;
  }
  function group(key, title, buckets, params) {
    if (!buckets.length) return "";
    return `<details class="filter-group" data-group="${key}" open><summary>${title}</summary>${buckets.length > 8 ? `<label class="sr">Buscar em ${title}</label><input class="filter-search" data-facet-search placeholder="Buscar em ${title.toLowerCase()}" aria-label="Buscar em ${title}">` : ""}<div class="filter-options">${key === "sub" ? `<label class="filter-option"><input type="radio" name="sub" value="" ${!params.has("sub") ? "checked" : ""}><span>Todos os produtos</span></label>` : ""}${buckets.map((b, i) => option(key, b, params, i)).join("")}${buckets.length > 8 ? '<button type="button" class="filter-more" data-show-options>Ver todas as opções +</button>' : ""}</div></details>`;
  }
  function renderFilters(container, params, prefix) {
    const f = data.facets;
    container.innerHTML =
      group(
        "sub",
        "Categorias",
        data.subcategories.map((c) => ({
          value: c._id,
          label: c.nome,
          count: c.count,
        })),
        params,
      ) +
      `<details class="filter-group" open><summary>Preferências</summary><div class="filter-options"><label class="filter-option"><input type="checkbox" name="available" value="1" ${params.get("available") === "1" ? "checked" : ""}><span>Com estoque</span><small>${f.available}</small></label><label class="filter-option"><input type="checkbox" name="offer" value="1" ${params.get("offer") === "1" ? "checked" : ""}><span>Com ofertas ou preço Club</span><small>${f.offer}</small></label></div></details>` +
      `<details class="filter-group" open><summary>Preço por unidade</summary><div class="price-fields"><label for="${prefix}-min">De (R$)<input id="${prefix}-min" data-price="min" type="number" min="0" step="0.01" inputmode="decimal" placeholder="${f.price.min.toFixed(2)}" value="${esc(params.get("min") || "")}"></label><label for="${prefix}-max">Até (R$)<input id="${prefix}-max" data-price="max" type="number" min="0" step="0.01" inputmode="decimal" placeholder="${f.price.max.toFixed(2)}" value="${esc(params.get("max") || "")}"></label></div>${prefix === "desktop" ? '<button class="price-apply" type="button" data-price-apply>Aplicar preço →</button>' : ""}<p class="price-error" role="status" hidden></p></details>` +
      group("brand", "Marcas", f.brand, params) +
      group("age", "Fase de vida", f.age, params) +
      group("size", "Porte", f.size, params) +
      group("presentation", "Apresentação", f.presentation, params);
    container.querySelectorAll("input[type=radio]").forEach((input) => {
      input.dataset.key = input.name;
      input.name = prefix + "-" + input.name;
    });
    // Keep selected options visible even when they occur beyond the first eight.
    container
      .querySelectorAll(".filter-option[data-extra]")
      .forEach((label) => {
        if (label.querySelector("input").checked) label.hidden = false;
      });
  }
  function filtersCount() {
    return [...state.entries()].filter(
      ([key]) =>
        ![
          "category",
          "parent",
          "grandparent",
          "sort",
          "page",
          "search",
          "limit",
        ].includes(key),
    ).length;
  }
  function renderChips() {
    const labels = {
      brand: "Marca",
      age: "Fase de vida",
      size: "Porte",
      presentation: "Apresentação",
    };
    const chips = [];
    for (const [key, value] of state) {
      let label;
      if (multi.includes(key))
        label = data.facets[key].find((b) => b.value === value)?.label || value;
      else if (key === "sub")
        label =
          data.subcategories.find((c) => c._id === value)?.nome ||
          "Categoria selecionada";
      else if (key === "available") label = "Com estoque";
      else if (key === "offer") label = "Ofertas e Club";
      else if (key === "min") label = "A partir de " + S.money(value);
      else if (key === "max") label = "Até " + S.money(value);
      else if (key === "q") label = "Busca: " + value;
      else continue;
      chips.push(
        `<button type="button" data-remove-filter="${key}" data-value="${esc(value)}" aria-label="Remover filtro ${esc(label)}">${esc(labels[key] ? labels[key] + ": " + label : label)} <span aria-hidden="true">✕</span></button>`,
      );
    }
    $("#active-filters").innerHTML =
      chips.join("") +
      (chips.length
        ? '<button type="button" data-clear>Limpar todos</button>'
        : "");
    $("#filter-count").textContent = chips.length
      ? "(" + chips.length + ")"
      : "";
  }
  function cardHTML(products) {
    return products
      .map((p) => {
        const pricing = ProductPageUtils.price(p);
        return `<article class="product"><div class="product-topline"><span class="product-brand">${esc(p.marca || "E o Bicho")}</span>${pricing.saving > 0 ? `<span class="offer-badge">${esc(pricing.label)}</span>` : Number(p.precoClube) > 0 && p.precoClube < pricing.unit ? '<span class="offer-badge">PREÇO CLUB</span>' : ""}</div><button type="button" class="favorite" data-id="${esc(p._id)}" aria-label="Favoritar ${esc(p.nome)}" aria-pressed="${S.isFavorite(p._id)}">${S.isFavorite(p._id) ? "♥" : "♡"}</button><a href="${S.productUrl(p._id)}"><img src="${esc(S.safeImage(p.imagemPrincipal))}" alt="${esc(p.nome)}" loading="lazy" width="300" height="180"><h3>${esc(p.nome)}</h3></a>${S.offer(p)}<p class="stock-note">${p.stock > 0 ? "Com estoque · confirme a loja e a entrega" : "Reposição: consulte nossas lojas"}</p><a class="product-link" href="${S.productUrl(p._id)}">${p.stock > 0 ? "Escolher produto →" : "Ver disponibilidade →"}</a>${window.CATALOG_PREVIEW ? `<button type="button" class="preview-quick-add" data-preview-add="${esc(p._id)}" aria-label="Adicionar ${esc(p.nome)} à sacola de teste">Adicionar à sacola de teste +</button>` : ""}</article>`;
      })
      .join("");
  }
  async function renderProducts(saved) {
    $("#catalog-grid").setAttribute("aria-busy", "false");
    if (!data.products.length) {
      $("#catalog-grid").innerHTML =
        `<div class="catalog-empty"><span>⌕</span><h2> Nenhum produto nesta seleção</h2><p>Experimente remover um filtro ou escolher outra categoria para continuar explorando.</p><button class="button" type="button" data-clear>Limpar filtros →</button></div>`;
      return;
    }
    await feed.reset(data, data.products, saved);
  }
  function capturePrice(container, params) {
    const low = container.querySelector("[data-price=min]"),
      high = container.querySelector("[data-price=max]");
    if (!low || !high) return true;
    const a = low.value,
      b = high.value;
    const invalid =
      (a !== "" && (!Number.isFinite(Number(a)) || Number(a) < 0)) ||
      (b !== "" && (!Number.isFinite(Number(b)) || Number(b) < 0)) ||
      (a !== "" && b !== "" && Number(a) > Number(b));
    const error = container.querySelector(".price-error");
    error.hidden = !invalid;
    error.textContent = invalid
      ? "Confira os valores: o preço mínimo deve ser menor ou igual ao máximo."
      : "";
    if (invalid) {
      low.focus();
      return false;
    }
    setValue(params, "min", a);
    setValue(params, "max", b);
    return true;
  }
  document.addEventListener("click", (e) => {
    if (e.target.closest('.favorite') && !window.StorefrontShell) {
      const message = document.createElement('p');
      message.setAttribute('role', 'status');
      message.textContent = 'Os favoritos estão temporariamente indisponíveis. Você pode continuar consultando os produtos.';
      $('#result-range').replaceChildren(message);
      return;
    }
    const button = e.target.closest("button");
    if (!button) return;
    if (button.hasAttribute("data-retry")) load();
    if (button.hasAttribute("data-clear")) {
      state = rootQuery();
      commit();
    }
    if (button.hasAttribute("data-remove-filter")) {
      const key = button.dataset.removeFilter;
      const keep = state.getAll(key).filter((v) => v !== button.dataset.value);
      state.delete(key);
      keep.forEach((v) => state.append(key, v));
      state.delete("page");
      commit();
    }
    if (button.hasAttribute("data-show-options")) {
      const group = button.closest(".filter-group");
      const more = button.textContent.includes("todas");
      group
        .querySelectorAll("[data-extra]")
        .forEach(
          (label) =>
            (label.hidden = !more && !label.querySelector("input").checked),
        );
      button.textContent = more ? "Mostrar menos" : "Ver todas as opções +";
    }
    if (
      button.hasAttribute("data-price-apply") &&
      capturePrice($("#desktop-filters"), state)
    ) {
      state.delete("page");
      commit();
    }
  });
  function filterChange(e) {
    const input = e.target;
    if (!input.matches("input[type=checkbox],input[type=radio]")) return;
    const params = e.currentTarget.id === "mobile-filters" ? draft : state;
    const key = input.dataset.key || input.name;
    if (multi.includes(key)) {
      const selected = params.getAll(key).filter((v) => v !== input.value);
      if (input.checked) selected.push(input.value);
      params.delete(key);
      selected.forEach((v) => params.append(key, v));
    } else setValue(params, key, input.checked ? input.value : "");
    params.delete("page");
    if (params === state) commit();
  }
  for (const id of ["desktop-filters", "mobile-filters"]) {
    $("#" + id).addEventListener("change", filterChange);
    $("#" + id).addEventListener("input", (e) => {
      if (!e.target.matches("[data-facet-search]")) return;
      const term = ProductPageUtils.normalize(e.target.value);
      e.target
        .closest(".filter-group")
        .querySelectorAll(".filter-option")
        .forEach(
          (label) =>
            (label.hidden = term
              ? !label.dataset.filterLabel?.includes(term)
              : label.hasAttribute("data-extra") &&
                !label.querySelector("input").checked),
        );
    });
    $("#" + id).addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.target.matches("[data-price]")) {
        e.preventDefault();
        if (
          id === "desktop-filters" &&
          capturePrice($("#desktop-filters"), state)
        ) {
          state.delete("page");
          commit();
        }
      }
    });
  }
  $("#catalog-sort").addEventListener("change", (e) =>
    update("sort", e.target.value),
  );
  $("#open-filters").addEventListener("click", () => {
    if (!data) return;
    draft = new URLSearchParams(state);
    renderFilters($("#mobile-filters"), draft, "mobile");
    $("#filter-dialog").showModal();
  });
  $("#mobile-clear").addEventListener("click", () => {
    draft = rootQuery();
    renderFilters($("#mobile-filters"), draft, "mobile");
  });
  $("#apply-filters").addEventListener("click", () => {
    if (!capturePrice($("#mobile-filters"), draft)) return;
    state = draft;
    draft = null;
    $("#filter-dialog").close();
    commit();
  });
  window.addEventListener("storefront:favorites", () =>
    document.querySelectorAll(".favorite").forEach((button) => {
      const active = S.isFavorite(button.dataset.id);
      button.setAttribute("aria-pressed", active);
      button.textContent = active ? "♥" : "♡";
    }),
  );
  window.addEventListener("popstate", async (event) => {
    state = new URLSearchParams(location.search);
    state.delete("page");
    await load();
    window.scrollTo({
      top: event.state?.catalogScroll || 0,
      behavior: "instant",
    });
  });
  window.addEventListener('pagehide', () => {
    try { history.replaceState(saveFeed(), '', location.href); } catch {}
    sequence++;
    controller?.abort();
    window.CatalogStartup?.finish();
  });
  window.addEventListener('pageshow', event => {
    if (event.persisted) { state = new URLSearchParams(location.search); state.delete('page'); load(); }
  });
  window.CatalogPage = {reload: load, cancel: () => { sequence++; controller?.abort(); feed.clear(); }};
  load();
  } catch(error) {
    console.error('Catálogo:', error.message);
    window.CatalogStartup?.fail('Não foi possível iniciar o catálogo. Tente novamente.');
  }
})();
