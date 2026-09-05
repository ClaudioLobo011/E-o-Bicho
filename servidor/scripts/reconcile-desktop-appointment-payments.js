const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const Appointment = require('../models/Appointment');
const PdvStateSale = require('../models/PdvStateSale');

const APPLY = process.argv.includes('--apply');
const cents = (value) => Math.round(Number(value || 0) * 100);
const clean = (value) => String(value || '').trim();
const references = (payload = {}) => Array.from(new Set([
  ...(Array.isArray(payload.appointmentIds) ? payload.appointmentIds : []),
  payload.appointmentId,
].map(clean).filter(Boolean)));
const mutationFromReference = (reference) => {
  const source = clean(reference).split(':occurrence:')[0];
  return source.startsWith('local:') ? source.slice('local:'.length) : '';
};

async function main() {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI não configurada em servidor/.env.');
  await mongoose.connect(process.env.MONGO_URI, { compressors: ['zlib'], zlibCompressionLevel: 6 });

  const sales = await PdvStateSale.find({
    $or: [
      { 'payload.appointmentId': /^local:/ },
      { 'payload.appointmentIds': /^local:/ },
    ],
  }).lean();
  const byMutation = new Map();
  for (const sale of sales) {
    for (const reference of references(sale.payload)) {
      const mutationId = mutationFromReference(reference);
      if (!mutationId) continue;
      if (!byMutation.has(mutationId)) byMutation.set(mutationId, []);
      byMutation.get(mutationId).push(sale);
    }
  }

  const appointments = await Appointment.find({
    clientMutationId: { $in: [...byMutation.keys()] },
    deletedAt: null,
  }).setOptions({ includeDeleted: true }).lean();
  const candidates = [];
  const skipped = [];
  for (const appointment of appointments) {
    const linkedSales = (byMutation.get(clean(appointment.clientMutationId)) || [])
      .filter((sale) => String(sale.empresa || '') === String(appointment.store || ''))
      .filter((sale) => clean(sale.payload?.status || 'completed').toLowerCase() === 'completed');
    const uniqueSales = [...new Map(linkedSales.map((sale) => [clean(sale.saleCode || sale.payload?.saleCode), sale])).values()];
    if (appointment.pago && appointment.codigoVenda) continue;
    if (uniqueSales.length !== 1) {
      skipped.push({ appointmentId: String(appointment._id), clientMutationId: appointment.clientMutationId, reason: uniqueSales.length ? 'mais de uma venda candidata' : 'venda concluída não encontrada' });
      continue;
    }
    const sale = uniqueSales[0];
    const saleCode = clean(sale.saleCode || sale.payload?.saleCode);
    if (!saleCode || (appointment.codigoVenda && appointment.codigoVenda !== saleCode)) {
      skipped.push({ appointmentId: String(appointment._id), clientMutationId: appointment.clientMutationId, reason: 'código de venda ausente ou divergente' });
      continue;
    }
    const appointmentTotal = cents(appointment.valor);
    const saleTotal = cents(sale.payload?.total ?? sale.payload?.netTotal ?? sale.payload?.totalLiquido);
    candidates.push({
      appointment,
      sale,
      saleCode,
      warning: appointmentTotal === saleTotal
        ? ''
        : `A venda inclui outros itens ou atendimentos (${appointmentTotal} de ${saleTotal} centavos).`,
    });
  }

  let backupPath = '';
  let modified = 0;
  if (APPLY && candidates.length) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDir = path.resolve(__dirname, '..', '..', '.codex-artifacts');
    fs.mkdirSync(backupDir, { recursive: true });
    backupPath = path.join(backupDir, `appointment-payment-reconciliation-${stamp}.json`);
    fs.writeFileSync(backupPath, JSON.stringify({ createdAt: new Date().toISOString(), candidates }, null, 2));
    for (const candidate of candidates) {
      const result = await Appointment.updateOne({
        _id: candidate.appointment._id,
        clientMutationId: candidate.appointment.clientMutationId,
        $or: [{ pago: { $ne: true } }, { codigoVenda: { $in: [null, ''] } }],
      }, {
        $set: { pago: true, codigoVenda: candidate.saleCode },
        $inc: { version: 1 },
      });
      modified += Number(result.modifiedCount || 0);
    }
  }

  const report = {
    ok: true,
    mode: APPLY ? 'apply' : 'dry-run',
    scannedSales: sales.length,
    candidates: candidates.map(({ appointment, saleCode, warning }) => ({
      appointmentId: String(appointment._id),
      clientMutationId: appointment.clientMutationId,
      customerId: String(appointment.cliente),
      petId: String(appointment.pet),
      storeId: String(appointment.store),
      saleCode,
      total: Number(appointment.valor || 0),
      warning,
      occurrences: (appointment.itens || []).map((item) => ({ date: item.data, time: item.hora, professionalId: String(item.profissional || ''), status: item.status })),
    })),
    skipped,
    modified,
    backupPath,
  };
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, mode: APPLY ? 'apply' : 'dry-run', message: error.message, stack: error.stack }, null, 2));
  process.exitCode = 1;
}).finally(async () => {
  await mongoose.disconnect().catch(() => {});
});
