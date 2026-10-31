const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Product",
    required: true,
  },
  day: { type: String, required: true },
  event: { type: String, required: true },
  device: { type: String, enum: ["mobile", "desktop"], required: true },
  count: { type: Number, default: 0 },
  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + 400 * 86400000),
  },
});
schema.index({ product: 1, day: 1, event: 1, device: 1 }, { unique: true });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
module.exports = mongoose.model("ProductPageMetric", schema);
