#!/usr/bin/env node

const path = require('path');
const dotenv = require('dotenv');
const mongoose = require('mongoose');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const MONGO_URI =
  process.env.MONGODB_URI || process.env.MONGO_URI || process.env.DATABASE_URL || '';
const DB_NAME = process.env.DB_NAME || undefined;

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run') || !args.includes('--confirm');

if (!MONGO_URI) {
  console.error('[reset-pdv-data] Defina MONGODB_URI (ou MONGO_URI/DATABASE_URL) no .env');
  process.exit(1);
}

function toDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function resolveSaleDate(sale) {
  const candidates = [sale?.fiscalEmittedAt, sale?.fiscalSefazProcessedAt, sale?.createdAt];
  for (const candidate of candidates) {
    const date = toDate(candidate);
    if (date) return date;
  }
  return null;
}

function deriveFiscalType(sale = {}) {
  const fiscalStatus = String(sale.fiscalStatus || '').toLowerCase();
  const hasFiscalEmission =
    ['emitted', 'authorized', 'autorizado', 'approved', 'aprovado'].includes(fiscalStatus) ||
    (sale.fiscalXmlName && sale.fiscalXmlName.trim()) ||
    (sale.fiscalAccessKey && sale.fiscalAccessKey.trim());

  if (!hasFiscalEmission) return 'matricial';

  const joinedHints = [
    sale.fiscalXmlName,
    sale.fiscalXmlUrl,
    sale.fiscalEnvironment,
    sale.fiscalAccessKey,
    sale.fiscalSerie,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  const xmlContent = String(sale.fiscalXmlContent || '').toLowerCase();
  const contentHints = `${joinedHints} ${xmlContent}`;

  if (contentHints.includes('nfse')) return 'nfse';
  if (contentHints.includes('nfce')) return 'nfce';
  if (contentHints.includes('nfe')) return 'nfe';

  return 'nfe';
}

function parseFiscalNumber(sale) {
  const raw = sale?.fiscalNumber ?? sale?.fiscalReceiptNumber ?? null;
  if (raw === null || raw === undefined) return null;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return null;
  return parsed > 0 ? parsed : null;
}

async function main() {
  await mongoose.connect(MONGO_URI, DB_NAME ? { dbName: DB_NAME } : {});

  const Appointment = require('../models/Appointment');
  const AccountReceivable = require('../models/AccountReceivable');
  const AccountPayable = require('../models/AccountPayable');
  const Pdv = require('../models/Pdv');
  const PdvState = require('../models/PdvState');

  const [appointmentsCount, receivableCount, payableCount] = await Promise.all([
    Appointment.estimatedDocumentCount(),
    AccountReceivable.estimatedDocumentCount(),
    AccountPayable.estimatedDocumentCount(),
  ]);

  const states = await PdvState.find({}, { empresa: 1, pdv: 1, completedSales: 1 }).lean();
  const lastNfceByPdv = new Map();

  for (const state of states) {
    const pdvId = state?.pdv ? String(state.pdv) : '';
    const sales = Array.isArray(state?.completedSales) ? state.completedSales : [];
    for (const sale of sales) {
      if (deriveFiscalType(sale) !== 'nfce') continue;
      const fiscalNumber = parseFiscalNumber(sale);
      if (!fiscalNumber) continue;
      const saleDate = resolveSaleDate(sale);
      const current = lastNfceByPdv.get(pdvId);
      if (
        !current ||
        fiscalNumber > current.number ||
        (fiscalNumber === current.number && saleDate && (!current.date || saleDate > current.date))
      ) {
        lastNfceByPdv.set(pdvId, {
          number: fiscalNumber,
          date: saleDate,
          sale,
          stateId: state._id,
        });
      }
    }
  }

  console.log(`[reset-pdv-data] PDV states: ${states.length}`);
  console.log(`[reset-pdv-data] Appointments: ${appointmentsCount}`);
  console.log(`[reset-pdv-data] Accounts receivable: ${receivableCount}`);
  console.log(`[reset-pdv-data] Accounts payable: ${payableCount}`);
  console.log(`[reset-pdv-data] PDVs com NFCe encontrada: ${lastNfceByPdv.size}`);

  const pdvIds = Array.from(lastNfceByPdv.keys()).filter(Boolean);
  const pdvDocs = pdvIds.length
    ? await Pdv.find(
        { _id: { $in: pdvIds } },
        { numeroNfceAtual: 1, empresa: 1, codigo: 1, nome: 1 }
      ).lean()
    : [];
  const pdvMap = new Map(pdvDocs.map((doc) => [String(doc._id), doc]));

  for (const [pdvId, info] of lastNfceByPdv.entries()) {
    const pdv = pdvMap.get(pdvId);
    const codeLabel = pdv?.codigo || pdv?.nome || pdvId;
    const dateLabel = info.date ? info.date.toISOString() : 'sem-data';
    console.log(
      `[reset-pdv-data] PDV ${codeLabel} -> NFCe numero=${info.number} data=${dateLabel}`
    );
  }

  const updates = states.map((state) => {
    return {
      updateOne: {
        filter: { _id: state._id },
        update: {
          $set: {
            caixaAberto: false,
            summary: { abertura: 0, recebido: 0, saldo: 0 },
            caixaInfo: {
              aberturaData: null,
              fechamentoData: null,
              fechamentoPrevisto: 0,
              fechamentoApurado: 0,
              previstoPagamentos: [],
              apuradoPagamentos: [],
            },
            pagamentos: [],
            history: [],
            completedSales: [],
            budgets: [],
            lastMovement: null,
            inventoryMovements: [],
            accountsReceivable: [],
            saleCodeSequence: 1,
            budgetSequence: 1,
          },
        },
      },
    };
  });

  const pdvUpdates = [];
  for (const [pdvId, info] of lastNfceByPdv.entries()) {
    if (!pdvId) continue;
    const pdv = pdvMap.get(pdvId);
    const existing = pdv?.numeroNfceAtual;
    const existingNumber = Number.isInteger(existing) ? existing : null;
    const nextNumber =
      existingNumber !== null && existingNumber > info.number ? existingNumber : info.number;
    pdvUpdates.push({
      updateOne: {
        filter: { _id: pdvId },
        update: { $set: { numeroNfceAtual: nextNumber } },
      },
    });
  }

  if (isDryRun) {
    console.log('[reset-pdv-data] Dry run ativo. Nenhuma alteracao foi gravada.');
    console.log('[reset-pdv-data] Para executar, rode com: --confirm');
    await mongoose.disconnect();
    process.exit(0);
  }

  const [appointmentResult, receivableResult, payableResult] = await Promise.all([
    Appointment.deleteMany({}),
    AccountReceivable.deleteMany({}),
    AccountPayable.deleteMany({}),
  ]);

  let pdvStateResult = { modifiedCount: 0 };
  if (updates.length) {
    pdvStateResult = await PdvState.bulkWrite(updates, { ordered: false });
  }

  let pdvResult = { modifiedCount: 0 };
  if (pdvUpdates.length) {
    pdvResult = await Pdv.bulkWrite(pdvUpdates, { ordered: false });
  }

  console.log(
    `[reset-pdv-data] Appointments removidos: ${appointmentResult.deletedCount || 0}`
  );
  console.log(
    `[reset-pdv-data] Accounts receivable removidos: ${receivableResult.deletedCount || 0}`
  );
  console.log(
    `[reset-pdv-data] Accounts payable removidos: ${payableResult.deletedCount || 0}`
  );
  console.log(
    `[reset-pdv-data] PDV states atualizados: ${pdvStateResult.modifiedCount || 0}`
  );
  console.log(`[reset-pdv-data] PDVs atualizados: ${pdvResult.modifiedCount || 0}`);

  await mongoose.disconnect();
}

main().catch((error) => {
  console.error('[reset-pdv-data] Erro inesperado:', error);
  mongoose
    .disconnect()
    .catch((disconnectError) =>
      console.error('[reset-pdv-data] Falha ao desconectar do MongoDB:', disconnectError)
    )
    .finally(() => process.exit(1));
});
