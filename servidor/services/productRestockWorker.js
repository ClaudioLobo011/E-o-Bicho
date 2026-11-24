const Notice = require("../models/ProductRestockNotice");
const Product = require("../models/Product");
const User = require("../models/User");
const { availableStock } = require("../utils/cartAvailability");
const { sendMail } = require("../utils/mailer");
const { getCompany } = require("../../scripts/core/config");
let timer = null;
let running = false;
async function processRestockNotices({
  mail = sendMail,
  now = new Date(),
} = {}) {
  const company = getCompany(process.env.SITE_EMPRESA || undefined);
  const siteUrl = company.siteUrl;
  if (!siteUrl) return;
  if (running) return;
  running = true;
  try {
    const pending = await Notice.find({
      expiresAt: { $gt: now },
      nextAttemptAt: { $lte: now },
      $or: [
        { status: "pending" },
        { status: "sending", lockedUntil: { $lte: now } },
      ],
    })
      .sort({ nextAttemptAt: 1 })
      .limit(30)
      .lean();
    for (const notice of pending) {
      const product = await Product.findById(notice.product)
        .populate("fracionado.itens.produto")
        .lean();
      if (availableStock(product) < 1) {
        await Notice.updateOne(
          { _id: notice._id, updatedAt: notice.updatedAt },
          {
            $set: {
              status: "pending",
              nextAttemptAt: new Date(now.getTime() + 15 * 60000),
            },
          },
        );
        continue;
      }
      const user = await User.findById(notice.user)
        .select("email emailVerified")
        .lean();
      if (!user?.emailVerified || !user.email) continue;
      const claim = await Notice.findOneAndUpdate(
        { _id: notice._id, updatedAt: notice.updatedAt },
        {
          $set: {
            status: "sending",
            lockedUntil: new Date(now.getTime() + 10 * 60000),
          },
          $inc: { attempts: 1 },
        },
        { new: true },
      ).lean();
      if (!claim) continue;
      try {
        const url = `${siteUrl}/pages/menu-departments-item/product.html?id=${product._id}`;
        const result = await mail({
          to: user.email,
          subject: `O produto que você esperava voltou — ${company.name}`,
          text: `Olá!\n\n${product.nome} está disponível novamente em nossa loja.\n\nConfira o preço e a disponibilidade atual: ${url}\n\nEste aviso foi solicitado por você e não reserva o produto. O estoque pode mudar.\n\nEquipe ${company.name}`,
        });
        if (result?.accepted && !result.accepted.length)
          throw new Error("Email not accepted");
        await Notice.updateOne(
          { _id: claim._id, status: "sending", updatedAt: claim.updatedAt },
          { $set: { status: "sent", sentAt: new Date(), lockedUntil: null } },
        );
      } catch {
        await Notice.updateOne(
          { _id: claim._id, status: "sending", updatedAt: claim.updatedAt },
          {
            $set: {
              status: "pending",
              lockedUntil: null,
              nextAttemptAt: new Date(
                now.getTime() +
                  Math.min(1440, 15 * 2 ** Math.min(claim.attempts, 6)) * 60000,
              ),
            },
          },
        );
      }
    }
  } finally {
    running = false;
  }
}
function startProductRestockWorker() {
  if (timer) return;
  timer = setInterval(() => {
    processRestockNotices().catch((error) =>
      console.error("Falha ao consultar avisos de reposição:", error.message),
    );
  }, 60000);
  timer.unref();
}
module.exports = { processRestockNotices, startProductRestockWorker };
