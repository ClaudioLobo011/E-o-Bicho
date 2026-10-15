const models = ['ReceivingReceipt', 'ReceivingDevice', 'ReceivingBarcodeLink', 'ReceivingPhoto', 'ReceivingExtraction'].map(name => require(`../models/${name}`));
let ready;
function ensureReceivingIndexes() {
  if (!ready) ready = Promise.all(models.map(model => model.createIndexes())).catch(error => { ready = null; throw error; });
  return ready;
}
module.exports = { ensureReceivingIndexes };
