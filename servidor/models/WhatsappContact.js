const mongoose = require('mongoose');

const { Schema } = mongoose;

const whatsappContactSchema = new Schema(
  {
    store: { type: Schema.Types.ObjectId, ref: 'Store', required: true, index: true },
    phoneNumberId: { type: String, trim: true, required: true, index: true },
    waId: { type: String, trim: true, required: true, index: true },
    name: { type: String, trim: true, default: '' },
  lastMessage: { type: String, trim: true, default: '' },
  lastMessageAt: { type: Date, default: null, index: true },
  lastDirection: { type: String, trim: true, default: '' },
  lastMessageId: { type: String, trim: true, default: '' },
  lastStatus: { type: String, trim: true, default: '' },
  unreadCount: { type: Number, default: 0 },
  lastReadAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

whatsappContactSchema.index({ store: 1, phoneNumberId: 1, waId: 1 }, { unique: true });
whatsappContactSchema.index({ store: 1, phoneNumberId: 1, lastMessageAt: -1 });

module.exports = mongoose.model('WhatsappContact', whatsappContactSchema);
