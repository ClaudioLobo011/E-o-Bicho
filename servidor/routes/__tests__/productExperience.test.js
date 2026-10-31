const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const { MongoMemoryServer } = require("mongodb-memory-server");
const Product = require("../../models/Product");
const User = require("../../models/User");
const Store = require("../../models/Store");
const Deposit = require("../../models/Deposit");
const WebOrder = require("../../models/WebOrder");
const Review = require("../../models/ProductReview");
const Notice = require("../../models/ProductRestockNotice");
const Content = require("../../models/ProductPageContent");
const Metric = require("../../models/ProductPageMetric");
const {
  processRestockNotices,
} = require("../../services/productRestockWorker");
const U = require("../../../scripts/product/product-utils");
const { availableStock } = require("../../utils/cartAvailability");
process.env.JWT_SECRET = "isolated-product-experience-tests";
const app = express();
app.use(express.json());
app.use("/experience", require("../productExperience"));
app.use("/cart", require("../cart"));
let db;
before(async () => {
  db = await MongoMemoryServer.create();
  await mongoose.connect(db.getUri());
  await Promise.all(
    [Product, User, Store, WebOrder, Review, Notice, Content, Metric].map((m) =>
      m.init(),
    ),
  );
});
after(async () => {
  await mongoose.disconnect();
  await db?.stop();
});
async function fixture(overrides = {}) {
  const key = String(new mongoose.Types.ObjectId());
  const product = await Product.create({
    cod: `P${key}`,
    codbarras: key,
    nome: "Produto de teste",
    custo: 1,
    venda: 100,
    stock: 5,
    naoMostrarNoSite: false,
    ...overrides,
  });
  const user = await User.create({
    tipoConta: "pessoa_fisica",
    email: `${key}@example.invalid`,
    senha: "not-a-login",
    celular: key,
    nomeCompleto: "Maria Teste",
    emailVerified: true,
  });
  const token = jwt.sign({ id: String(user._id) }, process.env.JWT_SECRET);
  return { product, user, token, auth: `Bearer ${token}` };
}
test("public stores expose only contact and hours, without operational fields", async () => {
  await Store.create({
    nome: "Unidade teste",
    cnpj: "private-field",
    emailFiscal: "fiscal@example.invalid",
    whatsapp: "21999999999",
  });
  const res = await request(app).get("/experience/stores");
  assert.equal(res.status, 200);
  assert.equal(res.body[0].cnpj, undefined);
  assert.equal(res.body[0].emailFiscal, undefined);
  assert.equal(res.body[0].whatsapp, "21999999999");
});
test("invalid and missing products return controlled errors; reviews start empty", async () => {
  assert.equal(
    (await request(app).get("/experience/invalid/reviews")).status,
    400,
  );
  assert.equal(
    (
      await request(app).get(
        `/experience/${new mongoose.Types.ObjectId()}/reviews`,
      )
    ).status,
    404,
  );
  const f = await fixture();
  const res = await request(app).get(`/experience/${f.product._id}/reviews`);
  assert.deepEqual(res.body, { reviews: [], total: 0, average: 0 });
});
test("reviews require authentication, confirmed purchase and valid rating", async () => {
  const f = await fixture();
  const url = `/experience/${f.product._id}/reviews`;
  assert.equal(
    (
      await request(app)
        .post(url)
        .send({ rating: 5, text: "Produto muito bom." })
    ).status,
    401,
  );
  assert.equal(
    (
      await request(app)
        .post(url)
        .set("Authorization", f.auth)
        .send({ rating: 5, text: "Produto muito bom." })
    ).status,
    403,
  );
  assert.equal(
    (
      await request(app)
        .post(url)
        .set("Authorization", f.auth)
        .send({ rating: 6, text: "Produto muito bom." })
    ).status,
    400,
  );
  assert.equal(await Review.countDocuments({ product: f.product._id }), 0);
});
test("verified reviews persist once, use first name and do not expose account or order IDs", async () => {
  const f = await fixture();
  await WebOrder.create({
    number: Date.now(),
    code: String(f.product._id),
    store: { id: new mongoose.Types.ObjectId() },
    customer: { id: f.user._id },
    payment: { status: "approved" },
    items: [{ productId: f.product._id }],
  });
  const url = `/experience/${f.product._id}/reviews`;
  assert.equal(
    (
      await request(app)
        .post(url)
        .set("Authorization", f.auth)
        .send({ rating: 4, text: "Minha experiência com o produto." })
    ).status,
    201,
  );
  assert.equal(
    (
      await request(app)
        .post(url)
        .set("Authorization", f.auth)
        .send({ rating: 5, text: "Minha experiência com o produto." })
    ).status,
    409,
  );
  const res = await request(app).get(url);
  assert.equal(res.body.average, 4);
  assert.equal(res.body.total, 1);
  assert.equal(res.body.reviews[0].author, "Maria");
  assert.equal(res.body.reviews[0].user, undefined);
  assert.equal(res.body.reviews[0].verifiedOrder, undefined);
});
test("canceled orders cannot be used to verify a review", async () => {
  const f = await fixture();
  await WebOrder.create({
    number: Date.now() + 1,
    code: String(f.product._id),
    store: { id: new mongoose.Types.ObjectId() },
    status: "CANCELADO",
    customer: { id: f.user._id },
    payment: { status: "approved" },
    items: [{ productId: f.product._id }],
  });
  assert.equal(
    (
      await request(app)
        .post(`/experience/${f.product._id}/reviews`)
        .set("Authorization", f.auth)
        .send({ rating: 5, text: "Avaliação de compra cancelada." })
    ).status,
    403,
  );
});
test("cart validates integer quantities and stock on POST and PUT", async () => {
  const f = await fixture({ stock: 2 });
  const url = `/cart/${f.user._id}`;
  for (const quantity of [0, -1, 1.5, "1", null])
    assert.equal(
      (
        await request(app)
          .post(url)
          .set("Authorization", f.auth)
          .send({ productId: f.product._id, quantity })
      ).status,
      400,
    );
  assert.equal(
    (
      await request(app)
        .post(url)
        .set("Authorization", f.auth)
        .send({ productId: f.product._id, quantity: 3 })
    ).status,
    409,
  );
  assert.equal(
    (
      await request(app)
        .post(url)
        .set("Authorization", f.auth)
        .send({ productId: f.product._id, quantity: 2, isSubscribed: true })
    ).status,
    200,
  );
  assert.equal((await User.findById(f.user._id)).cart[0].isSubscribed, true);
  assert.equal(
    (
      await request(app)
        .post(url)
        .set("Authorization", f.auth)
        .send({ productId: f.product._id, quantity: 1 })
    ).status,
    409,
  );
  assert.equal(
    (
      await request(app)
        .put(`${url}/${f.product._id}`)
        .set("Authorization", f.auth)
        .send({ quantity: 3 })
    ).status,
    409,
  );
  assert.equal(
    (
      await request(app)
        .put(`${url}/${f.product._id}`)
        .set("Authorization", f.auth)
        .send({ quantity: 0 })
    ).status,
    200,
  );
  assert.equal((await User.findById(f.user._id)).cart.length, 0);
});
test("concurrent additions cannot duplicate a cart row or exceed stock", async () => {
  const f = await fixture({ stock: 1 });
  const submit = () =>
    request(app)
      .post(`/cart/${f.user._id}`)
      .set("Authorization", f.auth)
      .send({ productId: f.product._id, quantity: 1 });
  const results = await Promise.all([submit(), submit()]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  const user = await User.findById(f.user._id);
  assert.equal(user.cart.length, 1);
  assert.equal(user.cart[0].quantity, 1);
});
test("another customer cannot mutate the cart; hidden and inactive products cannot be added", async () => {
  const f = await fixture();
  const other = await fixture();
  assert.equal(
    (
      await request(app)
        .post(`/cart/${f.user._id}`)
        .set("Authorization", other.auth)
        .send({ productId: f.product._id, quantity: 1 })
    ).status,
    403,
  );
  for (const change of [
    { naoMostrarNoSite: true },
    { naoMostrarNoSite: false, inativo: true },
    { inativo: false, venda: 0 },
  ]) {
    await Product.updateOne({ _id: f.product._id }, { $set: change });
    assert.equal(
      (
        await request(app)
          .post(`/cart/${f.user._id}`)
          .set("Authorization", f.auth)
          .send({ productId: f.product._id, quantity: 1 })
      ).status,
      409,
    );
  }
});
test("restock notices are authenticated, idempotent, cancelable and require verified email", async () => {
  const f = await fixture({ stock: 0 });
  const url = `/experience/${f.product._id}/restock`;
  assert.equal((await request(app).post(url).send({})).status, 401);
  for (let i = 0; i < 2; i++)
    assert.equal(
      (await request(app).post(url).set("Authorization", f.auth).send({}))
        .status,
      200,
    );
  assert.equal(await Notice.countDocuments({ product: f.product._id }), 1);
  assert.equal(
    (await request(app).get(url).set("Authorization", f.auth)).body.subscribed,
    true,
  );
  assert.equal(
    (await request(app).delete(url).set("Authorization", f.auth)).status,
    200,
  );
  assert.equal(await Notice.countDocuments({ product: f.product._id }), 0);
  await User.updateOne({ _id: f.user._id }, { $set: { emailVerified: false } });
  assert.equal(
    (await request(app).post(url).set("Authorization", f.auth).send({})).status,
    400,
  );
});
test("restock worker waits for actual stock, sends once and respects cancellation", async () => {
  const f = await fixture({ stock: 0 });
  const notice = await Notice.create({
    product: f.product._id,
    user: f.user._id,
    nextAttemptAt: new Date(0),
  });
  const sent = [];
  const mail = async (message) => {
    sent.push(message);
    return { accepted: [message.to] };
  };
  await processRestockNotices({ mail });
  assert.equal(sent.length, 0);
  await Product.updateOne({ _id: f.product._id }, { $set: { stock: 1 } });
  await Notice.updateOne(
    { _id: notice._id },
    { $set: { nextAttemptAt: new Date(0) } },
  );
  await processRestockNotices({ mail });
  await processRestockNotices({ mail });
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /não reserva/);
  assert.equal((await Notice.findById(notice._id)).status, "sent");
});
test("restock delivery errors retry later rather than reporting success", async () => {
  const f = await fixture();
  const notice = await Notice.create({
    product: f.product._id,
    user: f.user._id,
    nextAttemptAt: new Date(0),
  });
  await processRestockNotices({
    mail: async () => {
      throw new Error("SMTP unavailable");
    },
  });
  const saved = await Notice.findById(notice._id);
  assert.equal(saved.status, "pending");
  assert.ok(saved.nextAttemptAt > Date.now());
  assert.equal(saved.sentAt, null);
});
test("content editing requires admin, validates links and preserves stock, price and fiscal data", async () => {
  const f = await fixture();
  const other = await fixture();
  const url = `/experience/${f.product._id}/content`;
  assert.equal(
    (
      await request(app)
        .put(url)
        .set("Authorization", f.auth)
        .send({ manufacturer: "Fabricante" })
    ).status,
    403,
  );
  await User.updateOne({ _id: f.user._id }, { $set: { role: "admin" } });
  assert.equal(
    (
      await request(app)
        .put(url)
        .set("Authorization", f.auth)
        .send({ videoUrl: "javascript:alert(1)" })
    ).status,
    400,
  );
  assert.equal(
    (
      await request(app)
        .put(url)
        .set("Authorization", f.auth)
        .send({ variants: ["missing-code"] })
    ).status,
    400,
  );
  const body = {
    manufacturer: "Fabricante confirmado",
    composition: "Composição original",
    variants: [other.product.cod],
    documents: [{ title: "Rótulo", url: "https://example.com/rotulo.pdf" }],
  };
  assert.equal(
    (await request(app).put(url).set("Authorization", f.auth).send(body))
      .status,
    200,
  );
  const publicRes = await request(app).get(url);
  assert.equal(publicRes.body.manufacturer, body.manufacturer);
  assert.equal(publicRes.body.variants[0].cod, other.product.cod);
  assert.equal(publicRes.body.updatedBy, undefined);
  const p = await Product.findById(f.product._id);
  assert.equal(p.stock, 5);
  assert.equal(p.venda, 100);
  assert.equal(p.custo, 1);
  assert.equal(
    (await request(app).put(url).set("Authorization", f.auth).send(body))
      .status,
    409,
  );
  assert.equal(
    (
      await request(app)
        .put(url)
        .set("Authorization", f.auth)
        .send({ ...body, expectedUpdatedAt: publicRes.body.updatedAt })
    ).status,
    200,
  );
});
test("anonymous metrics persist only aggregate counters and admin-only reporting", async () => {
  const f = await fixture();
  const url = `/experience/${f.product._id}/events`;
  assert.equal(
    (
      await request(app).post(url).send({
        event: "view_item",
        device: "mobile",
        email: "do-not-store@example.invalid",
      })
    ).status,
    204,
  );
  const metric = await Metric.findOne({ product: f.product._id }).lean();
  assert.equal(metric.count, 1);
  assert.equal(metric.email, undefined);
  assert.equal(metric.ip, undefined);
  assert.equal(
    (await request(app).post(url).send({ event: "unknown", device: "desktop" }))
      .status,
    400,
  );
  assert.equal(
    (await request(app).get(url).set("Authorization", f.auth)).status,
    403,
  );
});
test("fractional availability uses the limiting child instead of a stale parent balance", () => {
  assert.equal(
    availableStock({
      venda: 10,
      stock: 50,
      fracionado: {
        ativo: true,
        itens: [
          {
            produto: { stock: 9 },
            quantidadeOrigem: 1,
            quantidadeFracionada: 3,
          },
          {
            produto: { stock: 8 },
            quantidadeOrigem: 1,
            quantidadeFracionada: 4,
          },
        ],
      },
    }),
    2,
  );
});
test("price hierarchy matches quantity offers and subscription without stacking", () => {
  const p = {
    venda: 30,
    precoClube: 20,
    promocao: { ativa: true, porcentagem: 10 },
    promocaoCondicional: { ativa: true, tipo: "leve_pague", leve: 3, pague: 2 },
  };
  assert.equal(U.price(p, 1).total, 27);
  assert.equal(U.price(p, 3).total, 60);
  assert.equal(U.price(p, 4).total, 90);
  assert.equal(U.price(p, 4, true).total, 80);
  assert.equal(
    U.price(
      {
        ...p,
        promocao: { ativa: true, porcentagem: 10, periodoFim: "2020-01-01" },
        promocaoCondicional: null,
      },
      1,
    ).unit,
    30,
  );
  assert.equal(
    U.price(
      {
        venda: 100,
        promocaoCondicional: {
          ativa: true,
          tipo: "acima_de",
          quantidadeMinima: 3,
          descontoPorcentagem: 20,
          produtosDiferentes: true,
          codigoGrupo: "group",
        },
      },
      1,
      false,
      3,
    ).unit,
    80,
  );
  assert.equal(U.quantity("bad", 4), 1);
  assert.equal(U.quantity(999, 2), 2);
  assert.equal(U.quantity(-2, 3), 1);
  assert.equal(
    U.unitPrice({ especificacoes: { apresentacao: "500 g" } }, 10),
    "R$ 20,00 / kg",
  );
});
test("availability maps deposit balances to stores without exposing internal inventory records", async () => {
  const f = await fixture();
  const store = await Store.create({ nome: "Loja de disponibilidade" });
  const deposit = await Deposit.create({
    codigo: String(new mongoose.Types.ObjectId()),
    nome: "Depósito de teste",
    empresa: store._id,
  });
  await Product.updateOne(
    { _id: f.product._id },
    { $set: { estoques: [{ deposito: deposit._id, quantidade: 2 }] } },
  );
  const response = await request(app).get(
    `/experience/${f.product._id}/availability`,
  );
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    stores: [{ store: String(store._id), available: true }],
  });
});
test("canceling a restock notice prevents subsequent delivery", async () => {
  const f = await fixture({ stock: 0 });
  await request(app)
    .post(`/experience/${f.product._id}/restock`)
    .set("Authorization", f.auth)
    .send({})
    .expect(200);
  await request(app)
    .delete(`/experience/${f.product._id}/restock`)
    .set("Authorization", f.auth)
    .expect(200);
  await Product.updateOne({ _id: f.product._id }, { $set: { stock: 1 } });
  const messages = [];
  await processRestockNotices({
    mail: async (message) => {
      messages.push(message);
      return { accepted: [message.to] };
    },
  });
  assert.equal(messages.length, 0);
});
