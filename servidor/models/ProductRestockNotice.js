const mongoose = require("mongoose");
const schema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    status: {
      type: String,
      enum: ["pending", "sending", "sent"],
      default: "pending",
    },
    consentAt: { type: Date, required: true, default: Date.now },
    sentAt: { type: Date, default: null },
    lockedUntil: { type: Date, default: null },
    nextAttemptAt: { type: Date, default: Date.now },
    attempts: { type: Number, default: 0 },
    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 180 * 86400000),
    },
  },
  { timestamps: true },
);
schema.index({ product: 1, user: 1 }, { unique: true });
schema.index({ status: 1, nextAttemptAt: 1 });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
module.exports = mongoose.model("ProductRestockNotice", schema);
