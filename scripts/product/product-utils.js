(function (root, factory) {
  const utils = factory();
  if (typeof module === "object" && module.exports) module.exports = utils;
  else root.ProductPageUtils = utils;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const number = (value, fallback = 0) =>
    Number.isFinite(Number(value)) ? Number(value) : fallback;
  const money = (value) =>
    new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(number(value));
  const round = (value) => Math.round((value + Number.EPSILON) * 100) / 100;
  const normalize = (value) =>
    String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  function active(promo, now = new Date()) {
    if (!promo?.ativa) return false;
    if (promo.semValidade) return true;
    const date = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "America/Sao_Paulo",
    }).format(now);
    const start = String(promo.periodoInicio || "").slice(0, 10);
    const end = String(promo.periodoFim || "").slice(0, 10);
    return (
      (!/^\d{4}-\d{2}-\d{2}$/.test(start) || date >= start) &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(end) || date <= end)
    );
  }
  function price(
    product,
    quantity = 1,
    subscribed = false,
    groupQuantity = null,
    now = new Date(),
  ) {
    const base = number(product?.venda);
    let unit = base;
    let label = "";
    const promotion = product?.promocao;
    const percentage = number(promotion?.porcentagem);
    if (active(promotion, now) && percentage > 0 && percentage <= 100) {
      unit = base * (1 - percentage / 100);
      label = `${percentage}% OFF`;
    }
    const conditional = product?.promocaoCondicional;
    const qty = Math.max(1, Math.trunc(number(quantity, 1)));
    const grouped =
      conditional?.produtosDiferentes &&
      String(conditional?.codigoGrupo || "").trim();
    const ruleQty = grouped && groupQuantity !== null ? groupQuantity : qty;
    if (active(conditional, now)) {
      let candidate = base;
      const minimum = number(conditional.quantidadeMinima);
      const discount = number(conditional.descontoPorcentagem);
      if (
        conditional.tipo === "acima_de" &&
        minimum > 0 &&
        ruleQty >= minimum &&
        discount > 0 &&
        discount <= 100
      ) {
        candidate = base * (1 - discount / 100);
      }
      const take = number(conditional.leve);
      const pay = number(conditional.pague);
      if (
        conditional.tipo === "leve_pague" &&
        Number.isInteger(take) &&
        Number.isInteger(pay) &&
        take > 0 &&
        pay >= 0 &&
        pay < take &&
        ruleQty >= take
      ) {
        candidate =
          (base * (Math.floor(ruleQty / take) * pay + (ruleQty % take))) /
          ruleQty;
      }
      if (candidate < unit) {
        unit = candidate;
        label =
          conditional.tipo === "leve_pague"
            ? `Leve ${take}, pague ${pay}`
            : `${discount}% por quantidade`;
      }
    }
    const club = number(product?.precoClube);
    if (subscribed && club > 0 && club < unit) {
      unit = club;
      label = "Preço Clube";
    }
    return {
      unit,
      total: round(unit * qty),
      label,
      base,
      saving: round((base - unit) * qty),
    };
  }
  function quantity(value, stock) {
    return Math.min(
      Math.max(1, Math.trunc(number(value, 1))),
      Math.max(1, Math.floor(number(stock))),
    );
  }
  function specifications(p) {
    const s = p?.especificacoes || {};
    const values = (value) =>
      [
        ...new Set(
          (Array.isArray(value) ? value : [value])
            .map((x) => String(x || "").trim())
            .filter(Boolean),
        ),
      ].join(", ");
    return [
      ["Marca", p?.marca],
      ["Indicado para", s.pet?.length ? s.pet : s.tipo],
      ["Fase de vida", s.idade],
      ["Porte", s.porteRaca?.length ? s.porteRaca : s.porte],
      ["Castração", s.castracao],
      ["Apresentação", s.apresentacao],
      ["Referência", p?.referencia],
      ["Código do produto", p?.cod],
      ["EAN", p?.semGtin ? "" : p?.codbarras],
    ]
      .map(([key, value]) => [key, values(value)])
      .filter(([, value]) => value);
  }
  function unitPrice(p, value) {
    // Only explicit presentation quantities; never infer the weight of a kit or pack.
    const label = String(p?.especificacoes?.apresentacao || "").trim();
    const m = label.match(/^(\d+(?:[.,]\d+)?)\s*(kg|g|ml|l)\s*$/i);
    if (!m || number(m[1].replace(",", ".")) <= 0) return "";
    const amount = number(m[1].replace(",", "."));
    const unit = m[2].toLowerCase();
    return `${money(value / (amount / (unit === "g" || unit === "ml" ? 1000 : 1)))} / ${unit === "kg" || unit === "g" ? "kg" : "litro"}`;
  }
  const medicine = (p) =>
    /farmacia|medicamento/.test(
      normalize(
        (p?.breadcrumbPath || p?.categorias || []).map((x) => x.nome).join(" "),
      ),
    ) || /uso veterinario|principio ativo/.test(normalize(p?.descricao));
  const safeUrl = (value, base) => {
    try {
      const u = new URL(String(value || ""), base);
      return /^https?:$/.test(u.protocol) ? u.href : "";
    } catch {
      return "";
    }
  };
  return {
    number,
    money,
    round,
    normalize,
    active,
    price,
    quantity,
    specifications,
    unitPrice,
    medicine,
    safeUrl,
  };
});
