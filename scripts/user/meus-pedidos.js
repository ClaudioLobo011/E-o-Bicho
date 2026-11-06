(() => {
  "use strict";
  function initialize() {
    const $ = (id) => document.getElementById(id),
      list = $("my-orders-list"),
      empty = $("my-orders-empty");
    if (!list || list.dataset.initialized) return;
    list.dataset.initialized = "true";
    const search = $("orders-search"),
      status = $("orders-status"),
      sort = $("orders-sort");
    let orders = [],
      loaded = false,
      limit = 20,
      revision = 0,
      controller;
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
    const normalize = (value) =>
      String(value ?? "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();
    const numeric = (value) =>
      value === null ||
      value === undefined ||
      typeof value === "boolean" ||
      String(value).trim() === ""
        ? NaN
        : Number(value);
    const money = (value) =>
      Number.isFinite(numeric(value))
        ? numeric(value).toLocaleString("pt-BR", {
            style: "currency",
            currency: "BRL",
          })
        : "Não informado";
    const timestamp = (value) => (value ? new Date(value).getTime() : NaN);
    const date = (value) =>
      Number.isFinite(timestamp(value))
        ? new Date(value).toLocaleString("pt-BR", {
            timeZone: "America/Sao_Paulo",
            dateStyle: "short",
            timeStyle: "short",
          })
        : "Data não informada";
    const statuses = {
      RECEBIDO: "Recebido",
      PAGO_RESERVADO: "Pago · estoque reservado",
      EM_SEPARACAO: "Em separação",
      PRONTO_PARA_ENVIO: "Pronto para envio",
      ENVIADO: "Enviado",
      CONCLUIDO: "Concluído",
      CANCELADO: "Cancelado",
      DEVOLVIDO: "Devolvido",
    };
    const payments = {
      approved: "Aprovado",
      pending: "Pendente",
      in_process: "Em análise",
      authorized: "Autorizado",
      rejected: "Recusado",
      cancelled: "Cancelado",
      refunded: "Reembolsado",
      charged_back: "Contestado",
    };
    const methods = {
      pix: "Pix",
      credit_card: "Cartão de crédito",
      debit_card: "Cartão de débito",
      ticket: "Boleto",
      boleto: "Boleto",
      account_money: "Saldo da conta",
      cash: "Dinheiro",
    };
    const state = (order) => String(order.status || "");
    const label = (order) =>
      statuses[state(order)] || state(order) || "Status não informado";
    const total = (order) => order.totals?.total ?? order.total;
    const items = (order) =>
      Array.isArray(order.items)
        ? order.items.filter((item) => item && typeof item === "object")
        : [];
    const name = (item) => item.name || item.produto || "Produto não informado";
    function imageUrl(raw) {
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
    function feedback(text = "") {
      $("orders-feedback").textContent = text;
      $("orders-feedback").hidden = !text;
    }
    function busy(value) {
      list.setAttribute("aria-busy", String(value));
      [search, status, sort, $("orders-refresh")].forEach(
        (control) => (control.disabled = value),
      );
    }
    function blank(title, description, action) {
      empty.hidden = false;
      empty.innerHTML = `<span class="orders-empty-icon" aria-hidden="true">◇</span><h2>${esc(title)}</h2><p>${esc(description)}</p>${action}`;
    }
    function card(order) {
      const rows = items(order),
        customer = order.customer || {},
        address = customer.address || {},
        totals = order.totals || {};
      const code = order.number ?? order.code ?? order._id ?? "Não informado";
      const addressLines = [
        [address.logradouro, address.numero].filter(Boolean).join(", "),
        address.complemento,
        [address.bairro, address.cidade, address.uf]
          .filter(Boolean)
          .join(" · "),
        address.cep ? "CEP " + address.cep : "",
      ].filter(Boolean);
      const tone =
        state(order) === "CANCELADO"
          ? "cancelled"
          : state(order) === "DEVOLVIDO"
            ? "returned"
            : state(order) === "CONCLUIDO"
              ? "completed"
              : "progress";
      const payment = order.payment || {};
      const delivery = {
        pickup: "Retirada na loja",
        retirada: "Retirada na loja",
        padrao: "Entrega padrão",
        express: "Entrega expressa",
        agendada: "Entrega agendada",
      };
      const products = rows
        .map(
          (item) =>
            `<li><div><strong>${esc(name(item))}</strong><small>${Number.isFinite(numeric(item.quantity ?? item.quantidade)) ? esc(item.quantity ?? item.quantidade) + " un." : "Quantidade não informada"} · ${esc(money(item.unitPrice ?? item.valorUnitario))} por unidade</small></div><b>${esc(money(item.total ?? item.valorTotal))}</b></li>`,
        )
        .join("");
      return `<article class="order-card">
        <div class="order-card-header"><div><h2>Pedido ${esc(code)}</h2><p>${esc(date(order.createdAt))}${order.store?.name ? " · " + esc(order.store.name) : ""}</p></div><span class="order-status ${tone}">${esc(label(order))}</span></div>
        <div class="order-card-summary"><div class="order-products-preview"><div class="order-thumbnails">${rows
          .slice(0, 2)
          .map(
            (item) =>
              `<img src="${esc(imageUrl(item.imageUrl))}" alt="" width="44" height="48" loading="lazy" decoding="async">`,
          )
          .join(
            "",
          )}</div><div><p>${esc(rows.slice(0, 2).map(name).join(" · ") || "Nenhum item registrado.")}</p><small>${rows.length} ${rows.length === 1 ? "produto" : "produtos"}${rows.length > 2 ? " · veja todos nos detalhes" : ""}</small></div></div><div class="order-amount"><small>Total do pedido</small><strong>${esc(money(total(order)))}</strong><span>${esc(methods[payment.method] || payment.method || "Método não informado")}</span></div></div>
        <details class="order-details"><summary><span>Ver detalhes do pedido</span><span class="order-details-chevron" aria-hidden="true">⌄</span></summary><div class="order-detail-content">
          <div class="order-info-grid"><section><h3>Dados do pedido</h3><p>${esc(customer.name || "Nome não informado")}</p>${customer.email ? `<p>${esc(customer.email)}</p>` : ""}${customer.phone ? `<p>${esc(customer.phone)}</p>` : ""}</section><section><h3>${["pickup", "retirada"].includes(order.delivery?.type) ? "Retirada / endereço do pedido" : "Endereço do pedido"}</h3>${addressLines.length ? addressLines.map((line) => `<p>${esc(line)}</p>`).join("") : "<p>Endereço não informado.</p>"}${order.delivery?.type ? `<p class="order-secondary">Modalidade: ${esc(delivery[order.delivery.type] || order.delivery.type)}</p>` : ""}</section><section><h3>Pagamento</h3><p>${esc(methods[payment.method] || payment.method || "Método não informado")}</p><p>Situação: ${esc(payments[payment.status] || payment.status || "Não informada")}</p></section></div>
          <h3 class="order-items-title">Todos os produtos</h3><ul class="order-items">${products || "<li>Nenhum item registrado.</li>"}</ul>
          <dl class="order-values"><div><dt>Subtotal</dt><dd>${esc(money(totals.subtotal))}</dd></div><div><dt>Descontos</dt><dd>${esc(money(totals.discounts))}</dd></div><div><dt>Entrega</dt><dd>${esc(money(totals.deliveryCost))}</dd></div><div><dt>Total</dt><dd>${esc(money(total(order)))}</dd></div></dl><a class="order-help" href="/pages/nossas-lojas.html">Preciso de ajuda com este pedido ↗</a>
        </div></details></article>`;
    }
    function render() {
      if (!loaded) return;
      const q = normalize(search.value.trim());
      const filtered = orders.filter(
        (order) =>
          (!status.value || state(order) === status.value) &&
          (!q ||
            normalize(
              [
                order.number,
                order.code,
                order._id,
                ...items(order).map(name),
              ].join(" "),
            ).includes(q)),
      );
      filtered.sort((a, b) => {
        const av =
            sort.value === "total" ? numeric(total(a)) : timestamp(a.createdAt),
          bv =
            sort.value === "total" ? numeric(total(b)) : timestamp(b.createdAt);
        if (!Number.isFinite(av)) return Number.isFinite(bv) ? 1 : 0;
        if (!Number.isFinite(bv)) return -1;
        return sort.value === "oldest" ? av - bv : bv - av;
      });
      list.innerHTML = filtered.slice(0, limit).map(card).join("");
      empty.hidden = true;
      $("orders-more").hidden = filtered.length <= limit;
      $("orders-clear").hidden =
        !search.value && !status.value && sort.value === "recent";
      $("orders-count").textContent = filtered.length
        ? `Exibindo ${Math.min(limit, filtered.length)} de ${filtered.length} ${filtered.length === 1 ? "pedido" : "pedidos"}`
        : orders.length
          ? "Nenhum resultado para os filtros"
          : "Seus pedidos aparecerão aqui";
      if (!orders.length)
        blank(
          "Seu próximo carinho começa aqui",
          "Você ainda não tem pedidos registrados nesta conta.",
          '<a href="/pages/menu-departments-item/search.html?search=*">Explorar produtos →</a>',
        );
      else if (!filtered.length)
        blank(
          "Não encontramos esse pedido",
          "Tente outro número, nome de produto ou status.",
          '<button type="button" data-clear-orders>Limpar filtros →</button>',
        );
    }
    async function load() {
      const ticket = ++revision;
      controller?.abort();
      controller = new AbortController();
      let auth;
      try {
        auth = JSON.parse(localStorage.getItem("loggedInUser"));
      } catch {}
      if (!auth?.token) {
        orders = [];
        loaded = false;
        list.replaceChildren();
        $("orders-more").hidden = true;
        feedback();
        busy(true);
        list.setAttribute("aria-busy", "false");
        $("orders-count").textContent = "Entre para consultar suas compras";
        blank(
          "Seus pedidos ficam na sua conta",
          "Acesse sua conta para consultar os pedidos e seus detalhes.",
          '<a href="/pages/login.html">Entrar na minha conta →</a>',
        );
        return;
      }
      busy(true);
      feedback(
        loaded ? "Atualizando seus pedidos…" : "Carregando seus pedidos…",
      );
      try {
        const response = await fetch(`${API_CONFIG.BASE_URL}/orders/my`, {
          headers: { Authorization: `Bearer ${auth.token}` },
          signal: controller.signal,
        });
        const data = await response.json();
        if (ticket !== revision) return;
        if (!response.ok) {
          const error = Error("Pedidos indisponíveis");
          error.status = response.status;
          throw error;
        }
        const result = Array.isArray(data?.orders)
          ? data.orders
          : Array.isArray(data)
            ? data
            : null;
        if (!result) throw Error("Resposta de pedidos inválida");
        orders = result.filter((order) => order && typeof order === "object");
        loaded = true;
        limit = 20;
        const selected = status.value;
        status.innerHTML =
          '<option value="">Todos os status</option>' +
          [...new Set(orders.map(state).filter(Boolean))]
            .map(
              (value) =>
                `<option value="${esc(value)}">${esc(statuses[value] || value)}</option>`,
            )
            .join("");
        status.value = [...status.options].some(
          (option) => option.value === selected,
        )
          ? selected
          : "";
        feedback();
        render();
      } catch (error) {
        if (ticket !== revision || error.name === "AbortError") return;
        feedback(
          loaded
            ? "Não foi possível atualizar. Os pedidos já carregados continuam disponíveis."
            : "Não foi possível consultar seus pedidos agora.",
        );
        if (!loaded) {
          $("orders-count").textContent = "Consulta indisponível";
          blank(
            error.status === 401
              ? "Vamos renovar seu acesso?"
              : "Vamos tentar novamente?",
            error.status === 401
              ? "Entre novamente para consultar os pedidos. Seus dados foram preservados."
              : "Confira sua conexão e tente carregar os pedidos outra vez.",
            error.status === 401
              ? '<a href="/pages/login.html">Entrar na conta →</a>'
              : '<button type="button" data-retry-orders>Tentar novamente →</button>',
          );
        }
      } finally {
        if (ticket === revision) busy(false);
      }
    }
    function clear() {
      search.value = "";
      status.value = "";
      sort.value = "recent";
      limit = 20;
      render();
    }
    $("orders-filters").addEventListener("submit", (event) =>
      event.preventDefault(),
    );
    search.addEventListener("input", () => {
      limit = 20;
      render();
    });
    [status, sort].forEach((control) =>
      control.addEventListener("change", () => {
        limit = 20;
        render();
      }),
    );
    $("orders-clear").addEventListener("click", clear);
    $("orders-refresh").addEventListener("click", load);
    $("orders-more").addEventListener("click", () => {
      limit += 20;
      render();
    });
    empty.addEventListener("click", (event) => {
      if (event.target.closest("[data-retry-orders]")) load();
      if (event.target.closest("[data-clear-orders]")) clear();
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
    load();
  }
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  else initialize();
})();
