const express = require("express");
const mongoose = require("mongoose");
const Product = require("../models/Product");
const Store = require("../models/Store");
const User = require("../models/User");
const WebOrder = require("../models/WebOrder");
const Review = require("../models/ProductReview");
const Notice = require("../models/ProductRestockNotice");
const Content = require("../models/ProductPageContent");
const Metric = require("../models/ProductPageMetric");
const requireAuth = require("../middlewares/requireAuth");
const { applyProductImageUrls } = require("../utils/productImageUrl");
const { availableStock } = require("../utils/cartAvailability");
const router = express.Router();
const visible = { naoMostrarNoSite: { $ne: true }, inativo: { $ne: true } };
const publicFields =
  "_id cod nome descricao marca venda precoClube promocao promocaoCondicional stock unidade imagemPrincipal imagens especificacoes categorias";

router.get("/stores", async (req, res) => {
  try {
    const stores = await Store.find({})
      .select("nome endereco cep telefone whatsapp horario")
      .sort({ nome: 1 })
      .lean();
    res.json(stores);
  } catch {
    res.status(503).json({ message: "Não foi possível consultar as lojas." });
  }
});
router.param("id", (req, res, next, id) => {
  if (!/^[a-f0-9]{24}$/i.test(id))
    return res.status(400).json({ message: "Produto inválido." });
  next();
});
const editorOnly = (req, res, next) =>
  ["admin", "admin_master"].includes(req.user?.role)
    ? next()
    : res
        .status(403)
        .json({ message: "Edição disponível apenas para administradores." });
const metricEvents = new Set([
  "view_item",
  "add_to_cart",
  "add_to_wishlist",
  "shipping_quote",
  "cart_error",
  "product_error",
  "view_product_image",
  "share",
  "restock_request",
  "select_subscription",
  "submit_review",
  "compare_products",
]);
// Short-lived in-memory flood protection; no IP, account or session is persisted in metrics.
const metricLimits = new Map();
router.post("/:id/events", async (req, res) => {
  const { event, device } = req.body;
  if (!metricEvents.has(event) || !["mobile", "desktop"].includes(device))
    return res.status(400).json({ message: "Evento inválido." });
  const minute = Math.floor(Date.now() / 60000);
  const key = `${req.ip}|${minute}`;
  const count = (metricLimits.get(key) || 0) + 1;
  if (metricLimits.size > 2000)
    for (const stored of metricLimits.keys())
      if (!stored.endsWith(`|${minute}`)) metricLimits.delete(stored);
  if (metricLimits.size > 5000 && !metricLimits.has(key))
    return res.sendStatus(429);
  metricLimits.set(key, count);
  if (count > 120) return res.sendStatus(429);
  try {
    if (!(await Product.exists({ _id: req.params.id, ...visible })))
      return res.sendStatus(204);
    const day = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "America/Sao_Paulo",
    }).format(new Date());
    await Metric.updateOne(
      { product: req.params.id, day, event, device },
      { $inc: { count: 1 } },
      { upsert: true },
    );
    res.sendStatus(204);
  } catch {
    res.sendStatus(204);
  } // Measurements must not interrupt shopping.
});
router.get("/:id/events", requireAuth, editorOnly, async (req, res) => {
  try {
    const since = new Date(Date.now() - 30 * 86400000)
      .toISOString()
      .slice(0, 10);
    const rows = await Metric.find({
      product: req.params.id,
      day: { $gte: since },
    })
      .select("day event device count -_id")
      .sort({ day: 1 })
      .lean();
    res.json({ days: 30, rows });
  } catch {
    res
      .status(503)
      .json({ message: "Não foi possível consultar os indicadores." });
  }
});
const publicContent =
  "manufacturer composition usage care material dimensions videoUrl documents variants related kits updatedAt";
const safeHttps = (value) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.href
      : "";
  } catch {
    return "";
  }
};
router.get("/:id/content", async (req, res) => {
  try {
    if (!(await Product.exists({ _id: req.params.id, ...visible })))
      return res.status(404).json({ message: "Produto indisponível." });
    const content = await Content.findOne({ product: req.params.id })
      .select(publicContent)
      .lean();
    if (!content) return res.json({});
    for (const field of ["variants", "related", "kits"]) {
      const ids = content[field] || [];
      const products = await Product.find({ _id: { $in: ids }, ...visible })
        .select(publicFields)
        .lean();
      products.forEach(applyProductImageUrls);
      content[field] = ids
        .map((id) => products.find((p) => String(p._id) === String(id)))
        .filter(Boolean);
    }
    res.json(content);
  } catch {
    res
      .status(503)
      .json({
        message: "Não foi possível carregar as informações adicionais.",
      });
  }
});
router.put("/:id/content", requireAuth, editorOnly, async (req, res) => {
  try {
    if (!(await Product.exists({ _id: req.params.id })))
      return res.status(404).json({ message: "Produto não encontrado." });
    const data = {};
    for (const [field, max] of Object.entries({
      manufacturer: 150,
      composition: 10000,
      usage: 10000,
      care: 10000,
      material: 2000,
      dimensions: 2000,
    })) {
      const value = req.body[field] ?? "";
      if (typeof value !== "string" || value.length > max)
        return res
          .status(400)
          .json({ message: `Conteúdo inválido no campo ${field}.` });
      data[field] = value.trim();
    }
    data.videoUrl = req.body.videoUrl ? safeHttps(req.body.videoUrl) : "";
    if (req.body.videoUrl && !data.videoUrl)
      return res
        .status(400)
        .json({ message: "Use um link HTTPS válido para o vídeo." });
    const documents = req.body.documents || [];
    if (
      !Array.isArray(documents) ||
      documents.length > 10 ||
      documents.some(
        (d) =>
          typeof d?.title !== "string" ||
          !d.title.trim() ||
          d.title.length > 150 ||
          !safeHttps(d.url),
      )
    )
      return res
        .status(400)
        .json({
          message:
            "Informe título e link HTTPS para cada documento (máximo de 10).",
        });
    data.documents = documents.map((d) => ({
      title: d.title.trim(),
      url: safeHttps(d.url),
    }));
    for (const field of ["variants", "related", "kits"]) {
      const codes = req.body[field] || [];
      if (
        !Array.isArray(codes) ||
        codes.length > 12 ||
        codes.some(
          (c) => typeof c !== "string" || !/^[a-zA-Z0-9-]{1,40}$/.test(c),
        )
      )
        return res
          .status(400)
          .json({
            message: "Informe até 12 códigos de produtos em cada seleção.",
          });
      const distinct = [...new Set(codes)];
      const products = await Product.find({
        cod: { $in: distinct },
        ...visible,
      })
        .select("_id cod")
        .lean();
      if (products.length !== distinct.length)
        return res
          .status(400)
          .json({
            message: `Há códigos inexistentes ou ocultos em ${field}. Confira os códigos de produto.`,
          });
      data[field] = distinct
        .map((code) => products.find((p) => p.cod === code)._id)
        .filter((value) => String(value) !== req.params.id);
    }
    const existing = await Content.findOne({ product: req.params.id }).lean();
    const expected = req.body.expectedUpdatedAt;
    if (
      existing &&
      String(existing.updatedAt.toISOString()) !== String(expected || "")
    )
      return res
        .status(409)
        .json({
          message:
            "O conteúdo mudou em outra tela. Reabra o editor antes de salvar.",
        });
    const query = existing
      ? { _id: existing._id, updatedAt: existing.updatedAt }
      : { product: req.params.id };
    const updated = existing
      ? await Content.findOneAndUpdate(
          query,
          { $set: { ...data, product: req.params.id, updatedBy: req.user.id } },
          { new: true, runValidators: true },
        )
      : await Content.create({
          ...data,
          product: req.params.id,
          updatedBy: req.user.id,
        });
    if (!updated)
      return res
        .status(409)
        .json({
          message:
            "O conteúdo mudou em outra tela. Reabra o editor antes de salvar.",
        });
    res.json({ updatedAt: updated.updatedAt });
  } catch (error) {
    if (error.code === 11000)
      return res
        .status(409)
        .json({
          message:
            "O conteúdo mudou em outra tela. Reabra o editor antes de salvar.",
        });
    res
      .status(503)
      .json({
        message: "Não foi possível salvar o conteúdo. Tente novamente.",
      });
  }
});
router.get("/:id/related", async (req, res) => {
  try {
    const product = await Product.findOne({ _id: req.params.id, ...visible })
      .select("categorias")
      .lean();
    if (!product)
      return res.status(404).json({ message: "Produto indisponível." });
    const categories = product.categorias || [];
    if (!categories.length) return res.json({ products: [], variants: [] });
    // No inferred replacements, therapeutic combinations, kits or variant families.
    const products = await Product.find({
      ...visible,
      _id: { $ne: product._id },
      categorias: categories.at(-1),
      venda: { $gt: 0 },
      stock: { $gt: 0 },
    })
      .select(publicFields)
      .sort({ marca: 1, nome: 1 })
      .limit(4)
      .lean();
    products.forEach(applyProductImageUrls);
    res.json({ products, variants: [] });
  } catch {
    res
      .status(503)
      .json({
        message: "Não foi possível consultar os produtos relacionados.",
      });
  }
});
router.get("/:id/availability", async (req, res) => {
  try {
    require("../models/Deposit");
    const product = await Product.findOne({ _id: req.params.id, ...visible })
      .select("estoques fracionado")
      .populate("estoques.deposito")
      .lean();
    if (!product)
      return res.status(404).json({ message: "Produto indisponível." });
    if (product.fracionado?.ativo) return res.json({ stores: [] });
    const quantities = new Map();
    for (const entry of product.estoques || []) {
      const store = String(entry.deposito?.empresa || "");
      if (!store) continue;
      quantities.set(
        store,
        (quantities.get(store) || 0) + (Number(entry.quantidade) || 0),
      );
    }
    res.json({
      stores: [...quantities].map(([store, quantity]) => ({
        store,
        available: Math.floor(quantity) > 0,
      })),
    });
  } catch {
    res
      .status(503)
      .json({
        message: "Não foi possível consultar a disponibilidade por loja.",
      });
  }
});
router.get("/:id/reviews", async (req, res) => {
  try {
    if (!(await Product.exists({ _id: req.params.id, ...visible })))
      return res.status(404).json({ message: "Produto indisponível." });
    const offset = Math.min(
      100000,
      Math.max(0, parseInt(req.query.offset, 10) || 0),
    );
    const product = new mongoose.Types.ObjectId(req.params.id);
    const [reviews, summary] = await Promise.all([
      Review.find({ product })
        .select("author rating text createdAt -_id")
        .sort({ createdAt: -1, _id: -1 })
        .skip(offset)
        .limit(10)
        .lean(),
      Review.aggregate([
        { $match: { product } },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            average: { $avg: "$rating" },
          },
        },
      ]),
    ]);
    res.json({
      reviews,
      total: summary[0]?.total || 0,
      average: Math.round((summary[0]?.average || 0) * 10) / 10,
    });
  } catch {
    res
      .status(503)
      .json({ message: "Não foi possível consultar as avaliações." });
  }
});
router.post("/:id/reviews", requireAuth, async (req, res) => {
  try {
    const rating = req.body.rating;
    const text = typeof req.body.text === "string" ? req.body.text.trim() : "";
    if (
      !Number.isInteger(rating) ||
      rating < 1 ||
      rating > 5 ||
      text.length < 10 ||
      text.length > 2000
    )
      return res
        .status(400)
        .json({
          message:
            "Selecione uma nota de 1 a 5 e escreva entre 10 e 2.000 caracteres.",
        });
    if (!(await Product.exists({ _id: req.params.id, ...visible })))
      return res.status(404).json({ message: "Produto indisponível." });
    // Payment is verified server-side by the existing web-order flow. No client-supplied proof.
    const order = await WebOrder.findOne({
      "customer.id": req.user.id,
      "items.productId": req.params.id,
      "payment.status": "approved",
      status: { $nin: ["CANCELADO", "CANCELADA", "ESTORNADO", "REEMBOLSADO"] },
    })
      .select("_id")
      .lean();
    if (!order)
      return res
        .status(403)
        .json({
          message:
            "Para avaliar, é necessário ter uma compra confirmada deste produto na sua conta.",
        });
    const user = await User.findById(req.user.id)
      .select("nomeCompleto nomeContato")
      .lean();
    const author =
      String(user?.nomeCompleto || user?.nomeContato || "Cliente")
        .trim()
        .split(/\s+/)[0]
        .slice(0, 50) || "Cliente";
    await Review.create({
      product: req.params.id,
      user: req.user.id,
      author,
      rating,
      text,
      verifiedOrder: order._id,
    });
    return res.status(201).json({ message: "Avaliação publicada." });
  } catch (error) {
    if (error.code === 11000)
      return res.status(409).json({ message: "Você já avaliou este produto." });
    return res
      .status(503)
      .json({
        message: "Não foi possível enviar sua avaliação. Tente novamente.",
      });
  }
});
router.get("/:id/restock", requireAuth, async (req, res) => {
  try {
    const notice = await Notice.exists({
      product: req.params.id,
      user: req.user.id,
      status: { $in: ["pending", "sending"] },
      expiresAt: { $gt: new Date() },
    });
    res.json({ subscribed: Boolean(notice) });
  } catch {
    res.status(503).json({ message: "Não foi possível consultar seu aviso." });
  }
});
router.post("/:id/restock", requireAuth, async (req, res) => {
  try {
    const product = await Product.findOne({ _id: req.params.id, ...visible })
      .populate("fracionado.itens.produto")
      .lean();
    if (!product)
      return res.status(404).json({ message: "Produto indisponível." });
    if (availableStock(product) > 0)
      return res
        .status(409)
        .json({
          message:
            "Este produto já está disponível. Atualize a página para comprar.",
        });
    const user = await User.findById(req.user.id)
      .select("email emailVerified")
      .lean();
    if (!user?.email || !user.emailVerified)
      return res
        .status(400)
        .json({
          message: "Confirme o e-mail da sua conta antes de solicitar o aviso.",
        });
    // A repeat click reuses the same notice; it never creates duplicate subscriptions.
    await Notice.updateOne(
      { product: req.params.id, user: req.user.id },
      {
        $set: {
          status: "pending",
          consentAt: new Date(),
          nextAttemptAt: new Date(),
          lockedUntil: null,
          expiresAt: new Date(Date.now() + 180 * 86400000),
        },
      },
      { upsert: true },
    );
    return res.json({ message: "Aviso cadastrado." });
  } catch (error) {
    if (error.code === 11000) return res.json({ message: "Aviso cadastrado." });
    return res
      .status(503)
      .json({
        message: "Não foi possível cadastrar o aviso. Tente novamente.",
      });
  }
});
router.delete("/:id/restock", requireAuth, async (req, res) => {
  try {
    await Notice.deleteOne({ product: req.params.id, user: req.user.id });
    res.json({ message: "Aviso cancelado." });
  } catch {
    res.status(503).json({ message: "Não foi possível cancelar o aviso." });
  }
});
module.exports = router;
