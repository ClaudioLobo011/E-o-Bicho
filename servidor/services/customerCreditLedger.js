const mongoose = require('mongoose');
const { createHash } = require('node:crypto');
const User = require('../models/User');

// Do not expire these records: an old retry must never spend/refund twice.
const schema = new mongoose.Schema({
  _id: String, scope: String, eventId: String,
  customerId: mongoose.Schema.Types.ObjectId, cents: Number,
  status: { type: String, enum: ['used', 'reversed'] },
}, { timestamps: true });
const Ledger = mongoose.models.CustomerCreditUse || mongoose.model('CustomerCreditUse', schema);
const error = (message, code = 'CUSTOMER_CREDIT_INVALID') => Object.assign(new Error(message), { code, status: 409, statusCode: 409 });
const key = (scope, eventId) => createHash('sha256').update(JSON.stringify([scope, eventId])).digest('hex');
function validate({ scope, eventId, customerId, amount }) {
  if (!scope || !eventId || String(eventId).length > 160 || !mongoose.isValidObjectId(customerId)) throw error('Identificação do uso de crédito inválida.');
  const cents = Math.round(Number(amount) * 100);
  if (!Number.isSafeInteger(cents) || cents <= 0 || Math.abs(Number(amount) * 100 - cents) > 0.000001) throw error('Valor do crédito inválido.');
  return cents;
}
async function balance(customerId) {
  if (!mongoose.isValidObjectId(customerId)) throw error('Cliente inválido.');
  const user = await User.findById(customerId).select('valorPendente').lean();
  if (!user) throw error('Cliente não encontrado.');
  return { customerId: String(customerId), balance: Math.max(0, Math.round(Number(user.valorPendente || 0) * 100) / 100) };
}
async function change(input, reverse = false, write = null) {
  const cents = validate(input);
  const { scope, eventId, customerId } = input;
  const id = key(scope, eventId);
  let result;
  // Balance and journal commit together, including retries/concurrent PDVs.
  // _id is indexed even with automatic index creation disabled in production.
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await mongoose.connection.transaction(async session => {
        const existing = await Ledger.findById(id).session(session).lean();
        if (existing && (String(existing.customerId) !== String(customerId) || existing.cents !== cents)) throw error('A tentativa de pagamento não corresponde à venda original.');
        if (!reverse && existing?.status === 'reversed') throw error('Esta tentativa de crédito já foi desfeita. Inicie uma nova tentativa.', 'CUSTOMER_CREDIT_REVERSED');
        let user;
        if (!existing && !reverse) {
          user = await User.findOneAndUpdate({ _id: customerId, valorPendente: { $gte: cents / 100 } },
            [{ $set: { valorPendente: { $round: [{ $subtract: ['$valorPendente', cents / 100] }, 2] } } }], { new: true, session }).select('valorPendente');
          if (!user) throw error('O saldo de crédito mudou ou é insuficiente. Confira o saldo e o pagamento.', 'CUSTOMER_CREDIT_INSUFFICIENT');
        } else if (reverse && existing?.status === 'used') {
          user = await User.findByIdAndUpdate(customerId,
            [{ $set: { valorPendente: { $round: [{ $add: [{ $ifNull: ['$valorPendente', 0] }, cents / 100] }, 2] } } }], { new: true, session }).select('valorPendente');
          if (!user) throw error('Cliente não encontrado para devolver o crédito.');
        } else {
          user = await User.findById(customerId).session(session).select('valorPendente');
          if (!user) throw error('Cliente não encontrado.');
        }
        if (!existing) await Ledger.create([{ _id: id, scope, eventId, customerId, cents, status: reverse ? 'reversed' : 'used' }], { session });
        else if (reverse && existing.status !== 'reversed') await Ledger.updateOne({ _id: id }, { $set: { status: 'reversed' } }, { session });
        // A reversal arriving before a timed-out debit leaves a tombstone.
        result = { ...input, status: reverse ? 'reversed' : 'used', balance: Math.max(0, Math.round(Number(user.valorPendente || 0) * 100) / 100), replayed: Boolean(existing && (!reverse || existing.status === 'reversed')) };
        result.pendingAmount = Math.round(Number(user.valorPendente || 0) * 100) / 100;
        if (write) result.writeResult = await write(session);
      });
      return result;
    } catch (err) {
      if (err.code !== 11000 || attempt === 3) throw err;
    }
  }
}
async function verify(input) {
  const cents = validate(input);
  const entry = await Ledger.findById(key(input.scope, input.eventId)).lean();
  if (!entry || entry.cents !== cents || String(entry.customerId) !== String(input.customerId)) throw error('O uso do crédito desta venda não foi confirmado pelo servidor.');
  // A locally cancelled sale may reach the cloud after its refund. Import its
  // history without spending again; the cancellation event follows it.
  return entry;
}
const isCredit = p => p?.customerCreditPayment === true || p?.type === 'customer_credit' || String(p?.paymentMethodId || p?.id || '').startsWith('customer-credit:');
function intentFor({ payload = {}, pdvId, idempotencyKey, desktopHost }) {
  const payments = (payload.payments || []).filter(isCredit);
  if (!payments.length) return null;
  if (!desktopHost && payload.customerCreditProtocolVersion !== 1) throw error('Atualize a página do PDV antes de usar o crédito do cliente.', 'CUSTOMER_CREDIT_UPDATE_REQUIRED');
  const customerId = String(payload.customerId || payload.customer?._id || payload.customer?.id || '');
  const amount = payments.reduce((sum, p) => {
    const value = Number(p.amount ?? p.valor);
    if (!Number.isFinite(value) || value <= 0 || Math.abs(value * 100 - Math.round(value * 100)) > 0.000001) throw error('Valor de crédito inválido.');
    return sum + Math.round(value * 100);
  }, 0) / 100;
  const total = Number(payload.totalLiquido ?? payload.total ?? 0);
  if (!(total > 0) || amount > total) throw error('O crédito não pode ultrapassar o total da venda.');
  const saleId = String(payload.saleId || payload.saleRecordId || payload.id || '');
  if (!saleId) throw error('Informe a venda para utilizar crédito.');
  const input = { scope: `pdv:${pdvId}`, eventId: desktopHost ? String(idempotencyKey) : `web:${saleId}`, customerId, amount };
  validate(input);
  return input;
}
module.exports = { balance, verify, intentFor, isCredit, use: input => change(input), reverse: input => change(input, true),
  withUse: (input, write) => change(input, false, write),
  withReversal: async (input, write) => input ? (await change(input, true, write)).writeResult : write(null), Ledger };
