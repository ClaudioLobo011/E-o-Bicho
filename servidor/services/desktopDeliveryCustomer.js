const PdvState = require('../models/PdvState');
const Pdv = require('../models/Pdv');

// Explicit opt-in from the Delivery customer editor. Finalized orders are historical snapshots.
async function syncActiveDeliveryCustomer({ customerId, source, host, mirror }) {
  if (!source.updateActiveDeliveries) return;
  const id = String(customerId);
  const active = { $nin: ['finalizado', 'cancelado'] };
  const matches = { status: active, $or: [{ customerId: id }, { 'customer.id': id }, { 'customer._id': id }] };
  const filter = { empresa: host.empresa, deliveryOrders: { $elemMatch: matches } };
  const states = await PdvState.find(filter).select('_id pdv').lean();
  if (!states.length) return;
  const phones = { celular: source.phone || '', telefone: source.phone || '', celular2: source.secondaryPhone || '', telefone2: source.secondaryPhone || '' };
  const values = {
    customerName: source.name, customerDocument: source.document || '', customerContact: source.phone || '',
    customerPhones: phones, customer: { id, nome: source.name, documento: source.document || '', contato: source.phone || '' },
    address: source.address, updatedAt: new Date().toISOString(),
  };
  const set = Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined).map(([key, value]) => [`deliveryOrders.$[order].${key}`, value]));
  await PdvState.updateMany({ _id: { $in: states.map((state) => state._id) } }, { $set: set }, {
    arrayFilters: [{ 'order.status': active, $or: [{ 'order.customerId': id }, { 'order.customer.id': id }, { 'order.customer._id': id }] }],
  });
  // Use the existing normalized mirror so incremental cursors observe the corrected orders.
  for (const state of states) {
    const [updatedState, pdvDoc] = await Promise.all([PdvState.findById(state._id), Pdv.findById(state.pdv)]);
    if (updatedState && pdvDoc) await mirror({ pdvDoc, updatedState });
  }
}

module.exports = { syncActiveDeliveryCustomer };
