const mongoose = require('mongoose');

const { Schema } = mongoose;

const whatsappMessageHistoryEventSchema = new Schema(
  {
    store: { type: Schema.Types.ObjectId, ref: 'Store', required: true, index: true },
    messageHistoryId: { type: String, trim: true, required: true, index: true },
    eventKey: { type: String, trim: true, required: true },
    eventId: { type: String, trim: true, default: '' },
    cursor: { type: String, trim: true, default: '' },
    deliveryStatus: { type: String, trim: true, default: '' },
    errorDescription: { type: String, trim: true, default: '' },
    occurrenceTimestamp: { type: Date, default: null },
    statusTimestamp: { type: Date, default: null },
    eventTimestamp: { type: Date, default: null, index: true },
    applicationId: { type: String, trim: true, default: '' },
    applicationName: { type: String, trim: true, default: '' },
    raw: { type: Schema.Types.Mixed, default: null },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

whatsappMessageHistoryEventSchema.index(
  { store: 1, messageHistoryId: 1, eventKey: 1 },
  { unique: true }
);
whatsappMessageHistoryEventSchema.index({ store: 1, messageHistoryId: 1, eventTimestamp: -1 });

module.exports = mongoose.model('WhatsappMessageHistoryEvent', whatsappMessageHistoryEventSchema);
