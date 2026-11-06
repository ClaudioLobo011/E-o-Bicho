(async () => {
  "use strict";
  if (window.storefrontReady) await window.storefrontReady;
  const S = window.StorefrontShell;
  if (!S) return;
  const $ = (s) => document.querySelector(s),
    esc = S.esc,
    money = S.money,
    productUrl = S.productUrl,
    safeImage = S.safeImage,
    offer = S.offer,
    request = S.request,
    normalize = ProductPageUtils.normalize;
  let products = [],
    filter = "all";
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
            `<article class="product"><button class="favorite" data-id="${esc(p._id)}" aria-pressed="${S.isFavorite(p._id)}" aria-label="Favoritar ${esc(p.nome)}">${S.isFavorite(p._id) ? "♥" : "♡"}</button><a href="${productUrl(p._id)}"><img loading="lazy" src="${esc(safeImage(p.imagemPrincipal))}" alt="${esc(p.nome)}" width="300" height="180"><h3>${esc(p.nome)}</h3></a>${offer(p)}<p class="stock-note">${Number(p.stock) > 0 ? "Consulte disponibilidade na sua região" : "Reposição: consulte a loja"}</p><a class="product-link" href="${productUrl(p._id)}">${Number(p.stock) > 0 ? "Escolher produto" : "Ver disponibilidade"} →</a>${window.CATALOG_PREVIEW ? `<button type="button" class="preview-quick-add" data-preview-add="${esc(p._id)}" aria-label="Adicionar ${esc(p.nome)} à sacola de teste">Adicionar à sacola de teste +</button>` : ""}</article>`,
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
          const data = await request("/product-experience/stores");
          $("#stores").innerHTML = data.map(storeMarkup).join("");
        } catch {
          $("#stores").innerHTML =
            '<a href="/pages/nossas-lojas.html">Conheça nossas lojas →</a>';
        }
      })(),
    ]);
  }
  document.querySelectorAll("[data-filter]").forEach((button) =>
    button.addEventListener("click", () => {
      filter = button.dataset.filter;
      document
        .querySelectorAll("[data-filter]")
        .forEach((b) => b.setAttribute("aria-pressed", b === button));
      render();
    }),
  );
  window.addEventListener("storefront:favorites", () => {
    document.querySelectorAll(".favorite").forEach((button) => {
      button.setAttribute("aria-pressed", S.isFavorite(button.dataset.id));
      button.textContent = S.isFavorite(button.dataset.id) ? "♥" : "♡";
    });
  });
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

  init();
})();
