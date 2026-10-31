const models = ['ReceivingReceipt', 'ReceivingDevice', 'ReceivingBarcodeLink', 'ReceivingPhoto', 'ReceivingExtraction'].map(name => require(`../models/${name}`));
let ready;
function ensureReceivingIndexes() {
  if (!ready) ready = Promise.all([
    ...models.map(model => model.createIndexes()),
    require('../models/NfeDraft').collection.createIndex({ sourceReceivingReceiptId: 1 }, { unique: true, sparse: true }),
  ]).catch(error => { ready = null; throw error; });
  return ready;
}
module.exports = { ensureReceivingIndexes };
