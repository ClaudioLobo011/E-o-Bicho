#!/usr/bin/env node

const path = require('path');
const dotenv = require('dotenv');
const connectDB = require('../config/db');
const PdvState = require('../models/PdvState');
const Pdv = require('../models/Pdv');
const Store = require('../models/Store');
const { moveFileToFolder } = require('../utils/googleDrive');
const { buildFiscalDrivePath } = require('../utils/fiscalDrivePath');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const isDryRun = process.argv.includes('--dry-run');

const toMap = (items) => {
  const map = new Map();
  items.forEach((item) => {
    if (item && item._id) {
      map.set(String(item._id), item);
    }
  });
  return map;
};

const resolveEmissionDate = (sale = {}) => {
  const candidates = [sale.fiscalEmittedAt, sale.createdAt];
  for (const candidate of candidates) {
    const date = candidate instanceof Date ? candidate : candidate ? new Date(candidate) : null;
    if (date instanceof Date && !Number.isNaN(date.getTime())) {
      return date;
    }
  }
  return new Date();
};

async function run() {
  await connectDB();

  const states = await PdvState.find(
    { 'completedSales.fiscalDriveFileId': { $exists: true, $ne: '' } },
    { pdv: 1, empresa: 1, completedSales: 1 }
  ).lean();

  if (!states.length) {
    console.log('Nenhuma venda fiscal com arquivo no Drive foi encontrada.');
    process.exit(0);
  }

  const pdvIds = new Set();
  const storeIds = new Set();
  states.forEach((state) => {
    if (state?.pdv) {
      pdvIds.add(String(state.pdv));
    }
    if (state?.empresa) {
      storeIds.add(String(state.empresa));
    }
  });

  const pdvs = await Pdv.find(
    { _id: { $in: Array.from(pdvIds) } },
    { codigo: 1, nome: 1 }
  ).lean();
  const stores = await Store.find(
    { _id: { $in: Array.from(storeIds) } },
    { nomeFantasia: 1, nome: 1, razaoSocial: 1, cnpj: 1 }
  ).lean();

  const pdvMap = toMap(pdvs);
  const storeMap = toMap(stores);

  let processed = 0;
  let moved = 0;
  let skipped = 0;
  let errors = 0;

  for (const state of states) {
    const store = storeMap.get(String(state?.empresa || '')) || null;
    const pdv = pdvMap.get(String(state?.pdv || '')) || null;

    if (!pdv) {
      const stateId = state?._id ? String(state._id) : 'desconhecido';
      console.warn(
        `PDV não encontrado para o estado ${stateId}. Pulando ${state?.completedSales?.length || 0} registros.`,
      );
    }

    for (const sale of state.completedSales || []) {
      const fileId = sale?.fiscalDriveFileId;
      if (!fileId) {
        continue;
      }

      processed += 1;

      if (!pdv) {
        skipped += 1;
        continue;
      }

      const emissionDate = resolveEmissionDate(sale);
      const folderPath = buildFiscalDrivePath({ store, pdv, emissionDate });

      const targetLabel = folderPath.join(' / ');
      if (isDryRun) {
        moved += 1;
        console.log(`[DRY-RUN] ${fileId} -> ${targetLabel}`);
        continue;
      }

      try {
        await moveFileToFolder(fileId, { folderPath });
        moved += 1;
        console.log(`Movido ${fileId} -> ${targetLabel}`);
      } catch (error) {
        errors += 1;
        console.error(`Erro ao mover arquivo ${fileId}:`, error?.message || error);
      }
    }
  }

  console.log('Resumo da reorganização:');
  console.log(`- Arquivos analisados: ${processed}`);
  console.log(`- Arquivos movidos${isDryRun ? ' (simulados)' : ''}: ${moved}`);
  console.log(`- Registros ignorados: ${skipped}`);
  console.log(`- Falhas: ${errors}`);

  process.exit(errors ? 1 : 0);
}

run().catch((error) => {
  console.error('Erro ao reorganizar pastas fiscais:', error);
  process.exit(1);
});
