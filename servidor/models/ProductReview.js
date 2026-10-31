const mongoose = require("mongoose");
const schema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
      index: true,
    },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    author: { type: String, required: true, maxlength: 50 },
    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
      validate: Number.isInteger,
    },
    text: {
      type: String,
      required: true,
      trim: true,
      minlength: 10,
      maxlength: 2000,
    },
    verifiedOrder: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "WebOrder",
      required: true,
    },
  },
  { timestamps: true },
);
schema.index({ product: 1, user: 1 }, { unique: true });
schema.index({ product: 1, createdAt: -1 });
module.exports = mongoose.model("ProductReview", schema);
