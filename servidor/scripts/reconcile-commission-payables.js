const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '..', '.env'), quiet: true });
mongoose.set('autoIndex', false);

const AccountPayable = require('../models/AccountPayable');
const CommissionClosing = require('../models/CommissionClosing');

const APPLY = process.argv.includes('--apply');
const CONFIRMED = process.argv.includes('--confirm-closing-payment-status');

function roundMoney(value) {
  const number = Number(value || 0);
  return Math.round((number + Number.EPSILON) * 100) / 100;
}

function sameId(left, right) {
  return Boolean(left && right && String(left) === String(right));
}

function block(blocked, reason, closing, payable = null) {
  blocked.push({
    reason,
    closingId: String(closing._id),
    payableId: payable?._id ? String(payable._id) : String(closing.payable || ''),
  });
}

async function main() {
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI || process.env.DATABASE_URL;
  if (!mongoUri) throw new Error('Defina MONGO_URI no servidor/.env.');
  if (APPLY && !CONFIRMED) {
    throw new Error('Para aplicar, use --apply --confirm-closing-payment-status.');
  }

  await mongoose.connect(mongoUri, {
    autoIndex: false,
    compressors: ['zlib'],
    zlibCompressionLevel: 6,
  });

  const closings = await CommissionClosing.collection
    .find({ status: 'pago', payable: { $type: 'objectId' } })
    .toArray();
  const payableIds = closings.map((closing) => closing.payable);
  const payables = payableIds.length
    ? await AccountPayable.collection.find({ _id: { $in: payableIds } }).toArray()
    : [];
  const payableById = new Map(payables.map((payable) => [String(payable._id), payable]));
  const eligible = [];
  const alreadyCorrect = [];
  const blocked = [];

  closings.forEach((closing) => {
    const payable = payableById.get(String(closing.payable));
    if (!payable) return block(blocked, 'conta-a-pagar-inexistente', closing);

    const total = roundMoney(closing.totalPeriodo);
    const totalPaid = roundMoney(closing.totalPago);
    const totalPending = roundMoney(closing.totalPendente);
    if (total <= 0 || totalPaid !== total || totalPending !== 0) {
      return block(blocked, 'fechamento-sem-confirmacao-integral', closing, payable);
    }
    if (
      !sameId(payable.company, closing.store) ||
      payable.partyType !== 'User' ||
      !sameId(payable.party, closing.profissional)
    ) {
      return block(blocked, 'empresa-ou-profissional-divergente', closing, payable);
    }
    if (roundMoney(payable.totalValue) !== total) {
      return block(blocked, 'valor-total-divergente', closing, payable);
    }
    const installments = Array.isArray(payable.installments) ? payable.installments : [];
    if (installments.length !== 1 || roundMoney(installments[0]?.value) !== total) {
      return block(blocked, 'parcela-divergente', closing, payable);
    }
    if (installments[0].status === 'paid') {
      alreadyCorrect.push({ closing, payable });
      return;
    }
    if (installments[0].status !== 'pending') {
      return block(blocked, 'status-nao-reconciliavel-automaticamente', closing, payable);
    }
    eligible.push({ closing, payable });
  });

  let backupPath = '';
  let modified = 0;
  if (APPLY && eligible.length) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDir = path.resolve(__dirname, '..', '..', '.codex-artifacts');
    fs.mkdirSync(backupDir, { recursive: true });
    backupPath = path.join(backupDir, `commission-payables-before-${stamp}.json`);
    fs.writeFileSync(
      backupPath,
      JSON.stringify(
        {
          createdAt: new Date().toISOString(),
          purpose: 'Reconciliar somente o status da parcela com fechamentos integralmente marcados como pagos.',
          entries: eligible.map(({ closing, payable }) => ({ closing, payable })),
        },
        null,
        2,
      ),
    );

    const result = await AccountPayable.collection.bulkWrite(
      eligible.map(({ closing, payable }) => ({
        updateOne: {
          filter: {
            _id: payable._id,
            'installments.0.status': 'pending',
            totalValue: payable.totalValue,
          },
          update: {
            $set: {
              'installments.0.status': 'paid',
              updatedAt: new Date(),
            },
          },
        },
      })),
      { ordered: true },
    );
    modified = result.modifiedCount || 0;
    if (modified !== eligible.length) {
      throw new Error(`Foram atualizadas ${modified} de ${eligible.length} contas; verifique concorrência.`);
    }
  }

  const verification = APPLY && eligible.length
    ? await AccountPayable.collection.countDocuments({
        _id: { $in: eligible.map(({ payable }) => payable._id) },
        'installments.0.status': 'paid',
      })
    : 0;

  console.log(
    JSON.stringify(
      {
        ok: true,
        mode: APPLY ? 'apply' : 'dry-run',
        paidClosingsWithReference: closings.length,
        eligible: eligible.length,
        alreadyCorrect: alreadyCorrect.length,
        blocked: blocked.length,
        blockedByReason: blocked.reduce((result, entry) => {
          result[entry.reason] = (result[entry.reason] || 0) + 1;
          return result;
        }, {}),
        blockedSamples: blocked.slice(0, 20),
        modified,
        verifiedPaid: verification,
        backupPath,
        untouched: [
          'CommissionClosing',
          'datas e horas históricas',
          'valores',
          'contas contábeis',
          'contas correntes',
        ],
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(JSON.stringify({ ok: false, mode: APPLY ? 'apply' : 'dry-run', message: error.message }, null, 2));
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => {});
  });
