const mongoose = require("mongoose");
const schema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
      unique: true,
    },
    manufacturer: { type: String, trim: true, maxlength: 150, default: "" },
    composition: { type: String, trim: true, maxlength: 10000, default: "" },
    usage: { type: String, trim: true, maxlength: 10000, default: "" },
    care: { type: String, trim: true, maxlength: 10000, default: "" },
    material: { type: String, trim: true, maxlength: 2000, default: "" },
    dimensions: { type: String, trim: true, maxlength: 2000, default: "" },
    videoUrl: { type: String, trim: true, default: "" },
    documents: [
      { _id: false, title: { type: String, maxlength: 150 }, url: String },
    ],
    variants: [{ type: mongoose.Schema.Types.ObjectId, ref: "Product" }],
    related: [{ type: mongoose.Schema.Types.ObjectId, ref: "Product" }],
    kits: [{ type: mongoose.Schema.Types.ObjectId, ref: "Product" }],
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);
module.exports = mongoose.model("ProductPageContent", schema);
