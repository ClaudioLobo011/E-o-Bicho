const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '..', '.env'), quiet: true });
mongoose.set('autoIndex', false);

const CommissionClosing = require('../models/CommissionClosing');

const APPLY = process.argv.includes('--apply');
const CONFIRMED = process.argv.includes('--confirm-literal-dates');
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_ZONE = 'America/Sao_Paulo';

function dateInSaoPaulo(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  return `${byType.get('year')}-${byType.get('month')}-${byType.get('day')}`;
}

function buildUpdate(closing) {
  const update = {};
  if (!DATE_PATTERN.test(String(closing.periodoInicioData || '')) && closing.periodoInicio) {
    update.periodoInicioData = dateInSaoPaulo(closing.periodoInicio);
  }
  if (!DATE_PATTERN.test(String(closing.periodoFimData || '')) && closing.periodoFim) {
    update.periodoFimData = dateInSaoPaulo(closing.periodoFim);
  }
  if (closing.previsaoPagamento) {
    if (!DATE_PATTERN.test(String(closing.previsaoPagamentoData || ''))) {
      update.previsaoPagamentoData = dateInSaoPaulo(closing.previsaoPagamento);
    }
  }
  return Object.fromEntries(Object.entries(update).filter(([, value]) => Boolean(value)));
}

async function main() {
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI || process.env.DATABASE_URL;
  if (!mongoUri) throw new Error('Defina MONGO_URI no servidor/.env.');
  if (APPLY && !CONFIRMED) {
    throw new Error('Para aplicar, use --apply --confirm-literal-dates. O modo padrão é dry-run.');
  }

  await mongoose.connect(mongoUri, {
    autoIndex: false,
    compressors: ['zlib'],
    zlibCompressionLevel: 6,
  });
  const closings = await CommissionClosing.collection.find({}).toArray();
  const candidates = closings
    .map((closing) => ({ closing, update: buildUpdate(closing) }))
    .filter(({ update }) => Object.keys(update).length > 0);

  let backupPath = '';
  let modified = 0;
  if (APPLY && candidates.length) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDir = path.resolve(__dirname, '..', '..', '.codex-artifacts');
    fs.mkdirSync(backupDir, { recursive: true });
    backupPath = path.join(backupDir, `commission-closing-literal-dates-before-${stamp}.json`);
    fs.writeFileSync(
      backupPath,
      JSON.stringify(
        {
          createdAt: new Date().toISOString(),
          count: candidates.length,
          documents: candidates.map(({ closing }) => closing),
        },
        null,
        2,
      ),
    );
    const result = await CommissionClosing.collection.bulkWrite(
      candidates.map(({ closing, update }) => ({
        updateOne: { filter: { _id: closing._id }, update: { $set: update } },
      })),
      { ordered: true },
    );
    modified = result.modifiedCount || 0;
  }

  const report = {
    ok: true,
    mode: APPLY ? 'apply' : 'dry-run',
    scanned: closings.length,
    candidates: candidates.length,
    modified,
    backupPath,
    fields: candidates.reduce((acc, entry) => {
      Object.keys(entry.update).forEach((field) => {
        acc[field] = (acc[field] || 0) + 1;
      });
      return acc;
    }, {}),
    sample: candidates.slice(0, 20).map(({ closing, update }) => ({
      id: String(closing._id),
      update,
    })),
    intentionallyNotInferred: [
      'previsaoPagamentoHora',
      'paidAt',
      'paidDate',
      'paidTime',
    ],
    untouchedFinancialFields: ['status', 'totalPago', 'payable'],
  };
  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((error) => {
    console.error(JSON.stringify({ ok: false, mode: APPLY ? 'apply' : 'dry-run', message: error.message }, null, 2));
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => {});
  });
