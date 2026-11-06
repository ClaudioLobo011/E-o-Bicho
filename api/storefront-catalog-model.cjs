const U = require("../scripts/product/product-utils");
const fields = [
  "_id",
  "nome",
  "venda",
  "precoClube",
  "stock",
  "marca",
  "imagemPrincipal",
  "especificacoes",
  "promocao",
  "promocaoCondicional",
];
const publicProduct = (p) =>
  Object.fromEntries(
    fields.filter((k) => p[k] !== undefined).map((k) => [k, p[k]]),
  );
const values = (v) =>
  (Array.isArray(v) ? v : [v])
    .map((x) => String(x ?? "").trim())
    .filter(Boolean);
const array = (v) => values(v).map(U.normalize);
function resolveCategory(categories, query) {
  const match = (c, name) => U.normalize(c?.nome) === U.normalize(name);
  return categories.find(
    (c) =>
      match(c, query.category || "Cachorro") &&
      (!query.parent ||
        match(
          categories.find((x) => String(x._id) === String(c.parent)),
          query.parent,
        )) &&
      (!query.grandparent ||
        match(
          categories.find(
            (x) =>
              String(x._id) ===
              String(
                categories.find((p) => String(p._id) === String(c.parent))
                  ?.parent,
              ),
          ),
          query.grandparent,
        )),
  );
}
function catalogue(products, categories, query = {}, now = new Date()) {
  const selected =
    query.search && !query.category ? null : resolveCategory(categories, query);
  const byId = new Map(categories.map((c) => [String(c._id), c]));
  const descendants = (id) => {
    const ids = new Set([String(id)]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const c of categories)
        if (ids.has(String(c.parent)) && !ids.has(String(c._id))) {
          ids.add(String(c._id));
          changed = true;
        }
    }
    return ids;
  };
  const belongs = (p, ids) =>
    (p.categorias || []).some((c) => ids.has(String(c._id || c)));
  const base = products.filter(
    (p) =>
      !p.inativo &&
      !p.naoMostrarNoSite &&
      (selected ? belongs(p, descendants(selected._id)) : !!query.search),
  );
  const sub = String(query.sub || "");
  const validSub = sub && selected && descendants(selected._id).has(sub);
  const subIds = validSub ? descendants(sub) : null;
  const wanted = {
    brand: array(query.brand),
    age: array(query.age),
    size: array(query.size),
    presentation: array(query.presentation),
  };
  const specs = {
    age: "idade",
    size: "porteRaca",
    presentation: "apresentacao",
  };
  const numeric = (value) =>
    value === undefined || value === ""
      ? null
      : Number(String(value).replace(",", "."));
  const min = numeric(query.min),
    max = numeric(query.max);
  if (
    (min !== null && (!Number.isFinite(min) || min < 0)) ||
    (max !== null && (!Number.isFinite(max) || max < 0)) ||
    (min !== null && max !== null && min > max)
  ) {
    const e = Error("Informe uma faixa de preço válida.");
    e.status = 400;
    throw e;
  }
  const priceCache = new Map(),
    offerCache = new Map();
  const pricing = (p) => {
    if (!priceCache.has(p)) priceCache.set(p, U.price(p, 1, false, null, now));
    return priceCache.get(p);
  };
  const unit = (p) => pricing(p).unit;
  const offerRule = (p) =>
    pricing(p).saving > 0 ||
    (U.active(p.promocaoCondicional, now) &&
      ((p.promocaoCondicional.tipo === "acima_de" &&
        p.promocaoCondicional.quantidadeMinima > 0 &&
        p.promocaoCondicional.descontoPorcentagem > 0 &&
        p.promocaoCondicional.descontoPorcentagem <= 100) ||
        (p.promocaoCondicional.tipo === "leve_pague" &&
          p.promocaoCondicional.leve > p.promocaoCondicional.pague &&
          p.promocaoCondicional.pague >= 0))) ||
    (Number(p.precoClube) > 0 && Number(p.precoClube) < unit(p));
  const offered = (p) => {
    if (!offerCache.has(p)) offerCache.set(p, offerRule(p));
    return offerCache.get(p);
  };
  const terms = U.normalize(query.q || query.search || "")
    .split(/\s+/)
    .filter((t) => t && t !== "*");
  const matches = (p, except) => {
    if (except !== "sub" && sub && (!subIds || !belongs(p, subIds)))
      return false;
    if (
      except !== "brand" &&
      wanted.brand.length &&
      !wanted.brand.includes(U.normalize(p.marca))
    )
      return false;
    for (const [key, field] of Object.entries(specs))
      if (
        except !== key &&
        wanted[key].length &&
        !array(p.especificacoes?.[field]).some((v) => wanted[key].includes(v))
      )
        return false;
    if (except !== "available" && query.available === "1" && !(p.stock > 0))
      return false;
    if (except !== "offer" && query.offer === "1" && !offered(p)) return false;
    const price = unit(p);
    if (
      except !== "price" &&
      ((min !== null && price < min) || (max !== null && price > max))
    )
      return false;
    if (
      terms.length &&
      !terms.every((t) =>
        U.normalize(p.nome + " " + (p.marca || "")).includes(t),
      )
    )
      return false;
    return true;
  };
  const buckets = (key) => {
    const map = new Map();
    for (const p of base.filter((p) => matches(p, key))) {
      const seen = new Set();
      for (const label of values(
        key === "brand" ? p.marca : p.especificacoes?.[specs[key]],
      )) {
        const value = U.normalize(label);
        if (seen.has(value)) continue;
        seen.add(value);
        const bucket = map.get(value) || { value, label, count: 0 };
        bucket.count++;
        map.set(value, bucket);
      }
    }
    return [...map.values()].sort((a, b) =>
      a.label.localeCompare(b.label, "pt-BR"),
    );
  };
  const subPool = base.filter((p) => matches(p, "sub"));
  const subcategories = categories
    .filter((c) => String(c.parent) === String(selected?._id))
    .map((c) => {
      const ids = descendants(c._id);
      return {
        _id: String(c._id),
        nome: c.nome,
        count: subPool.filter((p) => belongs(p, ids)).length,
      };
    })
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  const prices = base.filter((p) => matches(p, "price")).map(unit);
  let result = base.filter((p) => matches(p));
  const sort = ["name", "price-asc", "price-desc"].includes(query.sort)
    ? query.sort
    : "name";
  result.sort(
    (a, b) =>
      (sort === "price-asc"
        ? unit(a) - unit(b)
        : sort === "price-desc"
          ? unit(b) - unit(a)
          : a.nome.localeCompare(b.nome, "pt-BR")) ||
      String(a._id).localeCompare(String(b._id)),
  );
  const limit = Math.min(
      48,
      Math.max(1, Math.trunc(Number(query.limit) || 24)),
    ),
    total = result.length,
    pages = Math.max(1, Math.ceil(total / limit)),
    page = Math.min(pages, Math.max(1, Math.trunc(Number(query.page) || 1)));
  const breadcrumb = [];
  let current = selected;
  const visited = new Set();
  while (current && !visited.has(String(current._id))) {
    visited.add(String(current._id));
    breadcrumb.unshift({ _id: String(current._id), nome: current.nome });
    current = byId.get(String(current.parent));
  }
  return {
    category: selected
      ? { _id: String(selected._id), nome: selected.nome }
      : null,
    breadcrumb,
    products: result.slice((page - 1) * limit, page * limit).map(publicProduct),
    total,
    unfilteredTotal: base.length,
    page,
    pages,
    limit,
    sort,
    subcategories,
    facets: {
      brand: buckets("brand"),
      age: buckets("age"),
      size: buckets("size"),
      presentation: buckets("presentation"),
      available: base.filter((p) => matches(p, "available") && p.stock > 0)
        .length,
      offer: base.filter((p) => matches(p, "offer") && offered(p)).length,
      price: {
        min: prices.length ? Math.min(...prices) : 0,
        max: prices.length ? Math.max(...prices) : 0,
      },
    },
  };
}
module.exports = { catalogue, resolveCategory, publicProduct };
