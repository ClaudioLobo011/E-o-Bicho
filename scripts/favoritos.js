(() => {
  "use strict";
  async function initializeFavorites() {
    const $ = (id) => document.getElementById(id),
      list = $("favorites-list-container"),
      empty = $("favorites-empty-state");
    if (!list || list.dataset.initialized) return;
    list.dataset.initialized = "true";
    if (window.storefrontReady) await window.storefrontReady;
    const U = window.ProductPageUtils,
      S = window.StorefrontShell;
    const search = $("favorites-search"),
      availability = $("favorites-availability"),
      sort = $("favorites-sort"),
      dialog = $("favorite-remove-dialog");
    let ids = [],
      products = [],
      loaded = false,
      loading = false,
      ownerId = "",
      revision = 0,
      controller,
      limit = 18,
      pending = null,
      removing = false,
      previousFocus = null,
      previousOverflow = null,
      cartQueue = Promise.resolve();
    const preview = () => !!window.CATALOG_PREVIEW;
    const esc = (value) =>
      String(value ?? "").replace(
        /[&<>"']/g,
        (char) =>
          ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
          })[char],
      );
    const numeric = (value) =>
      value === null ||
      value === undefined ||
      typeof value === "boolean" ||
      String(value).trim() === ""
        ? NaN
        : Number(value);
    const normalize = (value) => U.normalize(value);
    const productUrl = (id) =>
      "/pages/menu-departments-item/product.html?id=" + encodeURIComponent(id);
    function session() {
      try {
        const user = JSON.parse(localStorage.getItem("loggedInUser"));
        return user?.id && user?.token ? user : null;
      } catch {
        return null;
      }
    }
    function feedback(text = "") {
      $("favorites-feedback").textContent = text;
      $("favorites-feedback").hidden = !text;
    }
    function controls() {
      list.setAttribute("aria-busy", String(loading));
      for (const el of [
        search,
        availability,
        sort,
        $("favorites-refresh"),
        $("favorites-clear"),
      ])
        el.disabled = loading || removing;
      for (const el of dialog.querySelectorAll("button"))
        el.disabled = removing;
    }
    async function request(path, options = {}) {
      const current = session();
      if (!current || current.id !== ownerId)
        throw Error("Entre na sua conta e atualize a lista para continuar.");
      const response = await fetch(API_CONFIG.BASE_URL + path, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + current.token,
          ...options.headers,
        },
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = Error(
          response.status === 401
            ? "Entre novamente para consultar seus favoritos. Seu cadastro foi preservado."
            : result.message || "Não foi possível concluir a solicitação.",
        );
        error.status = response.status;
        throw error;
      }
      return result;
    }
    function badge() {
      if (S?.setFavoriteIds) S.setFavoriteIds(ids);
      else if ($("favorite-count"))
        $("favorite-count").textContent = ids.length;
    }
    function visible(product) {
      return !product.missing && !product.inativo && !product.naoMostrarNoSite;
    }
    function price(product) {
      return visible(product) &&
        Number.isFinite(numeric(product.venda)) &&
        numeric(product.venda) > 0
        ? U.price(product, 1, false).unit
        : NaN;
    }
    function available(product) {
      return (
        visible(product) &&
        Number.isFinite(price(product)) &&
        numeric(product.stock) > 0
      );
    }
    function safeImage(raw) {
      if (!raw || typeof raw !== "string")
        return "/public/image/placeholder.svg";
      try {
        const url = new URL(raw, API_CONFIG.SERVER_URL || location.origin);
        return ["http:", "https:"].includes(url.protocol)
          ? url.href
          : "/public/image/placeholder.svg";
      } catch {
        return "/public/image/placeholder.svg";
      }
    }
    const placeholder = (id) => ({
      _id: id,
      missing: true,
      nome: "Produto indisponível",
    });
    async function details(favoriteIds, signal) {
      const result = [];
      if (preview()) {
        let next = 0;
        await Promise.all(
          Array.from({ length: Math.min(4, favoriteIds.length) }, async () => {
            while (next < favoriteIds.length) {
              const id = favoriteIds[next++];
              try {
                const product = await request(
                  "/products/" + encodeURIComponent(id),
                  { signal },
                );
                if (String(product?._id) !== id)
                  throw Error("Não foi possível confirmar o produto.");
                result.push(product);
              } catch (error) {
                if (error.status === 404) result.push(placeholder(id));
                else throw error;
              }
            }
          }),
        );
      } else {
        for (let start = 0; start < favoriteIds.length; start += 100) {
          const payload = await request("/products/by-ids", {
            method: "POST",
            body: JSON.stringify({
              ids: favoriteIds.slice(start, start + 100),
            }),
            signal,
          });
          const batch = Array.isArray(payload) ? payload : payload?.products;
          if (!Array.isArray(batch))
            throw Error("Não foi possível consultar os produtos salvos.");
          result.push(...batch);
        }
      }
      const map = new Map(
        result
          .filter((product) => product?._id)
          .map((product) => [String(product._id), product]),
      );
      return favoriteIds.map((id) => {
        const product = map.get(id);
        return product && !product.inativo && !product.naoMostrarNoSite
          ? product
          : placeholder(id);
      });
    }
    function blank(title, description, action) {
      empty.hidden = false;
      empty.innerHTML = `<span aria-hidden="true">♡</span><h2>${esc(title)}</h2><p>${esc(description)}</p>${action}`;
    }
    function card(product) {
      const id = String(product._id),
        known = visible(product),
        enabled = available(product),
        validPrice = Number.isFinite(price(product));
      return `<article class="saved-product"><button type="button" class="saved-remove" data-favorite-remove="${esc(id)}" aria-label="Remover ${esc(product.nome)} dos favoritos" title="Remover dos favoritos">♥</button><a class="saved-product-image" href="${productUrl(id)}"><img src="${esc(safeImage(known ? product.imagemPrincipal : ""))}" alt="${esc(product.nome)}" width="140" height="120" loading="lazy" decoding="async"></a><div class="saved-product-body">${known && product.marca ? `<span class="saved-brand">${esc(product.marca)}</span>` : ""}<h2><a href="${productUrl(id)}">${esc(product.nome || "Produto sem nome")}</a></h2><div class="saved-pricing">${validPrice ? S.offer(product) : '<span class="saved-price-unknown">Consulte o preço na loja</span>'}</div><p class="saved-stock">${enabled ? "Disponível · confirme a entrega" : known ? "Consulte a disponibilidade" : "Este produto não está disponível no catálogo."}</p><div class="saved-actions"><a href="${productUrl(id)}">${enabled ? "Ver produto" : "Ver disponibilidade"} →</a><button type="button" data-favorite-cart="${esc(id)}" ${!enabled ? "disabled" : ""}>${preview() ? "Adicionar à sacola de teste" : "Adicionar à sacola"}</button></div></div></article>`;
    }
    function render() {
      if (!loaded) return;
      const q = normalize(search.value.trim());
      const filtered = products.filter(
        (product) =>
          (!q ||
            normalize(
              [product.nome, product.marca, product.cod, product.codbarras]
                .filter(Boolean)
                .join(" "),
            ).includes(q)) &&
          (!availability.value ||
            (availability.value === "available"
              ? available(product)
              : !available(product))),
      );
      if (sort.value === "name")
        filtered.sort((a, b) =>
          String(a.nome).localeCompare(String(b.nome), "pt-BR"),
        );
      else if (sort.value.startsWith("price"))
        filtered.sort((a, b) => {
          const av = price(a),
            bv = price(b);
          if (!Number.isFinite(av)) return Number.isFinite(bv) ? 1 : 0;
          if (!Number.isFinite(bv)) return -1;
          return sort.value === "price-asc" ? av - bv : bv - av;
        });
      list.innerHTML = filtered.slice(0, limit).map(card).join("");
      list.classList.remove("hidden");
      empty.hidden = true;
      $("favorites-more").hidden = filtered.length <= limit;
      $("favorites-clear").hidden =
        !search.value && !availability.value && sort.value === "saved";
      $("favorites-count").textContent = filtered.length
        ? `Exibindo ${Math.min(limit, filtered.length)} de ${filtered.length} ${filtered.length === 1 ? "produto salvo" : "produtos salvos"}`
        : products.length
          ? "Nenhum resultado para os filtros"
          : "Seu próximo favorito pode estar por perto";
      if (!products.length)
        blank(
          "Guarde seus preferidos por aqui",
          "Toque no coração dos produtos para encontrar seus favoritos em um só lugar.",
          '<a href="/pages/menu-departments-item/search.html?search=*">Explorar produtos →</a>',
        );
      else if (!filtered.length)
        blank(
          "Não encontramos esse produto",
          "Tente outro nome, marca ou filtro.",
          '<button type="button" data-clear-favorites>Limpar filtros →</button>',
        );
    }
    async function loadFavorites() {
      if (removing) return;
      const ticket = ++revision;
      controller?.abort();
      const currentController = new AbortController();
      controller = currentController;
      const current = session();
      if (!current) {
        ids = [];
        products = [];
        loaded = false;
        list.replaceChildren();
        $("favorites-more").hidden = true;
        $("favorites-count").textContent =
          "Entre para consultar seus favoritos";
        list.setAttribute("aria-busy", "false");
        blank(
          "Seus favoritos ficam na sua conta",
          "Entre para consultar os produtos que você salvou.",
          '<a href="/pages/login.html">Entrar na minha conta →</a>',
        );
        return;
      }
      ownerId = current.id;
      loading = true;
      controls();
      feedback(
        loaded ? "Atualizando seus favoritos…" : "Carregando seus favoritos…",
      );
      try {
        const result = await request(
          "/favorites/" + encodeURIComponent(ownerId),
          { signal: currentController.signal },
        );
        if (
          !Array.isArray(result) ||
          result.some(
            (id) => typeof id !== "string" || !/^[a-f\d]{24}$/i.test(id),
          )
        )
          throw Error("Não foi possível confirmar a lista de favoritos.");
        const nextIds = [...new Set(result)],
          nextProducts = await details(nextIds, currentController.signal);
        if (ticket !== revision) return;
        ids = nextIds;
        products = nextProducts;
        loaded = true;
        limit = 18;
        badge();
        render();
        feedback();
      } catch (error) {
        if (ticket !== revision || error.name === "AbortError") return;
        currentController.abort();
        feedback(
          loaded
            ? "Não foi possível atualizar. Sua lista anterior continua disponível."
            : error.message,
        );
        if (!loaded) {
          $("favorites-count").textContent = "Consulta indisponível";
          blank(
            error.status === 401
              ? "Vamos renovar seu acesso?"
              : "Vamos tentar novamente?",
            "Seus favoritos continuam na conta. Não alteramos o seu cadastro.",
            error.status === 401
              ? '<a href="/pages/login.html">Entrar na conta →</a>'
              : '<button type="button" data-retry-favorites>Tentar novamente →</button>',
          );
        }
      } finally {
        if (ticket === revision) {
          loading = false;
          controls();
        }
      }
    }
    function confirmRemoveFavorite(productId) {
      if (loading || removing) return;
      pending = products.find(
        (product) => String(product._id) === String(productId),
      );
      if (!pending) return;
      previousFocus =
        [...list.querySelectorAll("[data-favorite-remove]")].find(
          (button) => button.dataset.favoriteRemove === String(productId),
        ) || document.activeElement;
      previousOverflow = {
        html: document.documentElement.style.overflow,
        body: document.body.style.overflow,
      };
      $("favorite-remove-message").textContent = preview()
        ? `Remover “${pending.nome}” da cópia de teste? Sua lista real será mantida.`
        : `Deseja remover “${pending.nome}” dos seus favoritos?`;
      $("favorite-remove-error").hidden = true;
      document.documentElement.style.overflow = "hidden";
      document.body.style.overflow = "hidden";
      if (!dialog.open) dialog.showModal();
      $("favorite-remove-cancel").focus();
    }
    $("favorite-remove-confirm").addEventListener("click", async () => {
      if (!pending || removing || !dialog.open) return;
      const id = String(pending._id);
      removing = true;
      controls();
      try {
        if (!preview())
          await request(
            "/favorites/" +
              encodeURIComponent(ownerId) +
              "/" +
              encodeURIComponent(id),
            { method: "DELETE" },
          );
        ids = ids.filter((value) => value !== id);
        products = products.filter((product) => String(product._id) !== id);
        badge();
        render();
        removing = false;
        controls();
        dialog.close();
        feedback(
          preview()
            ? "Produto removido apenas da cópia de teste."
            : "Produto removido dos favoritos.",
        );
      } catch (error) {
        $("favorite-remove-error").textContent = error.message;
        $("favorite-remove-error").hidden = false;
      } finally {
        removing = false;
        controls();
      }
    });
    for (const id of ["favorite-remove-cancel", "favorite-remove-close"])
      $(id).addEventListener("click", () => {
        if (!removing) dialog.close();
      });
    dialog.addEventListener("cancel", (event) => {
      if (removing) event.preventDefault();
    });
    dialog.addEventListener("close", () => {
      pending = null;
      if (previousOverflow) {
        document.documentElement.style.overflow = previousOverflow.html;
        document.body.style.overflow = previousOverflow.body;
        previousOverflow = null;
      }
      const target = previousFocus?.isConnected
        ? previousFocus
        : $("favorites-refresh");
      if (!target.disabled) target.focus({ preventScroll: true });
    });
    dialog.addEventListener("click", (event) => {
      if (removing || event.target !== dialog) return;
      const r = dialog.getBoundingClientRect();
      if (
        event.clientX < r.left ||
        event.clientX > r.right ||
        event.clientY < r.top ||
        event.clientY > r.bottom
      )
        dialog.close();
    });
    async function addToCart(id, button) {
      const expectedOwner = ownerId,
        original = button.textContent;
      button.disabled = true;
      button.textContent = "Adicionando…";
      const run = cartQueue.then(async () => {
        const current = session();
        if (!current || current.id !== expectedOwner)
          throw Error("Entre na sua conta e atualize a lista para continuar.");
        if (preview()) {
          if (!window.PreviewCartStore)
            throw Error("A sacola de teste não carregou. Atualize a página.");
          await PreviewCartStore.add(id, 1);
        } else {
          const cart = await request(
            "/cart/" + encodeURIComponent(expectedOwner),
            {
              method: "POST",
              body: JSON.stringify({ productId: id, quantity: 1 }),
            },
          );
          if (Array.isArray(cart) && $("cart-count"))
            $("cart-count").textContent = cart.reduce(
              (sum, row) => sum + Number(row.quantity || 0),
              0,
            );
          document.dispatchEvent(new CustomEvent("storefront:cart-updated"));
          await window.StorefrontCart?.refresh();
        }
        feedback(
          preview()
            ? "Produto adicionado à sacola de teste."
            : "Produto adicionado à sacola.",
        );
      });
      cartQueue = run.catch(() => {});
      try {
        await run;
      } catch (error) {
        feedback(error.message);
      } finally {
        if (button.isConnected) {
          button.disabled = false;
          button.textContent = original;
        }
      }
    }
    list.addEventListener("click", (event) => {
      const remove = event.target.closest("[data-favorite-remove]"),
        add = event.target.closest("[data-favorite-cart]");
      if (remove) confirmRemoveFavorite(remove.dataset.favoriteRemove);
      if (add && !add.disabled && !loading && !removing) {
        const product = products.find(
          (product) => String(product._id) === add.dataset.favoriteCart,
        );
        if (product && available(product))
          addToCart(add.dataset.favoriteCart, add);
      }
    });
    list.addEventListener(
      "error",
      (event) => {
        if (
          event.target.tagName === "IMG" &&
          event.target.getAttribute("src") !== "/public/image/placeholder.svg"
        )
          event.target.src = "/public/image/placeholder.svg";
      },
      true,
    );
    function clear() {
      search.value = "";
      availability.value = "";
      sort.value = "saved";
      limit = 18;
      render();
    }
    $("favorites-filters").addEventListener("submit", (event) =>
      event.preventDefault(),
    );
    search.addEventListener("input", () => {
      limit = 18;
      render();
    });
    [availability, sort].forEach((el) =>
      el.addEventListener("change", () => {
        limit = 18;
        render();
      }),
    );
    $("favorites-clear").addEventListener("click", clear);
    $("favorites-refresh").addEventListener("click", loadFavorites);
    $("favorites-more").addEventListener("click", () => {
      limit += 18;
      render();
    });
    empty.addEventListener("click", (event) => {
      if (event.target.closest("[data-clear-favorites]")) clear();
      if (event.target.closest("[data-retry-favorites]")) loadFavorites();
    });
    $("favorites-preview-note").hidden = !preview();
    window.loadFavorites = loadFavorites;
    window.confirmRemoveFavorite = confirmRemoveFavorite;
    loadFavorites();
  }
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", initializeFavorites, {
      once: true,
    });
  else initializeFavorites();
})();
