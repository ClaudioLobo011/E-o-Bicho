const path = require('path');
const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '..', '.env'), quiet: true });
mongoose.set('autoIndex', false);

const CommissionClosing = require('../models/CommissionClosing');
const AccountPayable = require('../models/AccountPayable');
const CommissionConfig = require('../models/CommissionConfig');

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^\d{2}:\d{2}$/;

function argValue(name) {
  const entry = process.argv.find((arg) => arg.startsWith(`${name}=`));
  return entry ? entry.slice(name.length + 1) : '';
}

function addSample(samples, category, closing, extra = {}) {
  if (!samples[category]) samples[category] = [];
  if (samples[category].length >= 20) return;
  samples[category].push({ id: String(closing._id), store: String(closing.store || ''), ...extra });
}

async function main() {
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI || process.env.DATABASE_URL;
  if (!mongoUri) throw new Error('Defina MONGO_URI no servidor/.env.');
  const storeArg = argValue('--store');
  const filter = {};
  if (storeArg) {
    if (!mongoose.Types.ObjectId.isValid(storeArg)) throw new Error('--store deve ser um ObjectId válido.');
    filter.store = new mongoose.Types.ObjectId(storeArg);
  }

  await mongoose.connect(mongoUri, {
    autoIndex: false,
    compressors: ['zlib'],
    zlibCompressionLevel: 6,
  });
  const closings = await CommissionClosing.collection.find(filter).toArray();
  const payableIds = closings.map((closing) => closing.payable).filter(Boolean);
  const payables = payableIds.length
    ? await AccountPayable.collection.find({ _id: { $in: payableIds } }).toArray()
    : [];
  const configs = await CommissionConfig.collection
    .find(storeArg ? { store: new mongoose.Types.ObjectId(storeArg) } : {})
    .toArray();
  const payableById = new Map(payables.map((payable) => [String(payable._id), payable]));
  const configuredStores = new Set(
    configs
      .filter((config) => config.accountingAccount && config.bankAccount)
      .map((config) => String(config.store)),
  );

  const counts = {
    closings: closings.length,
    active: 0,
    paid: 0,
    scheduled: 0,
    pending: 0,
    cancelled: 0,
    missingLiteralPeriod: 0,
    invalidLiteralPeriod: 0,
    missingSnapshot: 0,
    nonPositiveActive: 0,
    missingPayableReference: 0,
    danglingPayableReference: 0,
    payableStatusMismatch: 0,
    paidMissingActualDateTime: 0,
    storesMissingConfiguration: 0,
  };
  const samples = {};
  const stores = new Set();
  let mismatchValue = 0;

  closings.forEach((closing) => {
    const status = String(closing.status || 'pendente');
    stores.add(String(closing.store || ''));
    const statusKey = {
      pago: 'paid',
      agendado: 'scheduled',
      pendente: 'pending',
      cancelado: 'cancelled',
    }[status];
    if (statusKey) counts[statusKey] += 1;
    if (status !== 'cancelado') counts.active += 1;

    const literalStart = String(closing.periodoInicioData || '');
    const literalEnd = String(closing.periodoFimData || '');
    if (!literalStart || !literalEnd) {
      counts.missingLiteralPeriod += 1;
      addSample(samples, 'missingLiteralPeriod', closing);
    } else if (!DATE_PATTERN.test(literalStart) || !DATE_PATTERN.test(literalEnd) || literalStart > literalEnd) {
      counts.invalidLiteralPeriod += 1;
      addSample(samples, 'invalidLiteralPeriod', closing, { literalStart, literalEnd });
    }
    if (Number(closing.snapshotVersion || 0) < 1 || !Array.isArray(closing.snapshotItems)) {
      counts.missingSnapshot += 1;
    }
    if (status !== 'cancelado' && Number(closing.totalPeriodo || 0) <= 0) {
      counts.nonPositiveActive += 1;
      addSample(samples, 'nonPositiveActive', closing, { totalPeriodo: closing.totalPeriodo || 0 });
    }
    if (status === 'pago' && (!DATE_PATTERN.test(String(closing.paidDate || '')) || !TIME_PATTERN.test(String(closing.paidTime || '')))) {
      counts.paidMissingActualDateTime += 1;
      addSample(samples, 'paidMissingActualDateTime', closing);
    }
    if (!closing.payable) {
      if (status !== 'cancelado') {
        counts.missingPayableReference += 1;
        addSample(samples, 'missingPayableReference', closing);
      }
      return;
    }
    const payable = payableById.get(String(closing.payable));
    if (!payable) {
      counts.danglingPayableReference += 1;
      addSample(samples, 'danglingPayableReference', closing, { payable: String(closing.payable) });
      return;
    }
    const expected = status === 'pago' ? 'paid' : status === 'cancelado' ? 'cancelled' : 'pending';
    const installments = Array.isArray(payable.installments) ? payable.installments : [];
    if (!installments.length || installments.some((installment) => installment.status !== expected)) {
      counts.payableStatusMismatch += 1;
      mismatchValue += Number(closing.totalPago || closing.totalPeriodo || 0);
      addSample(samples, 'payableStatusMismatch', closing, {
        expected,
        actual: installments.map((installment) => installment.status),
      });
    }
  });

  const validStores = Array.from(stores).filter((value) => mongoose.Types.ObjectId.isValid(value));
  counts.storesMissingConfiguration = validStores.filter((store) => !configuredStores.has(store)).length;

  console.log(
    JSON.stringify(
      {
        ok: true,
        mode: 'read-only',
        store: storeArg || 'all',
        counts,
        payableMismatchValue: Math.round((mismatchValue + Number.EPSILON) * 100) / 100,
        configuredStores: configuredStores.size,
        samples,
        guidance: {
          deterministicMigration:
            'Use migrate-commission-closing-literal-dates.js em dry-run; --apply exige backup e confirmação explícita.',
          financialStatus:
            'Não alterar pagamentos históricos automaticamente. Validar comprovantes e conciliação antes de qualquer escrita.',
        },
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(JSON.stringify({ ok: false, mode: 'read-only', message: error.message }, null, 2));
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => {});
  });
