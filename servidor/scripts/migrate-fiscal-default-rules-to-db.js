#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const connectDB = require('../config/db');
const Store = require('../models/Store');
const FiscalDefaultRule = require('../models/FiscalDefaultRule');
const { normalizeFiscalData } = require('../services/fiscalRuleEngine');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const rulesFilePath = path.join(__dirname, '..', 'data', 'fiscal-default-rules.json');

const parseDateOrNow = (value) => {
  if (!value) return new Date();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
};

const loadRulesFile = () => {
  if (!fs.existsSync(rulesFilePath)) {
    throw new Error(`Arquivo nao encontrado: ${rulesFilePath}`);
  }
  const raw = fs.readFileSync(rulesFilePath, 'utf8');
  const parsed = JSON.parse(raw);
  const stores = parsed?.stores;
  if (!stores || typeof stores !== 'object' || Array.isArray(stores)) {
    throw new Error('Formato invalido do arquivo fiscal-default-rules.json (esperado: { stores: { ... } }).');
  }
  return stores;
};

async function run() {
  const storesMap = loadRulesFile();
  const storeIds = Object.keys(storesMap);

  if (!storeIds.length) {
    console.log('Nenhuma empresa encontrada no arquivo. Nada para migrar.');
    process.exit(0);
  }

  await connectDB();

  const summary = {
    storesInFile: storeIds.length,
    storesMigrated: 0,
    storesSkipped: 0,
    totalRulesInFile: 0,
    totalUpserts: 0,
  };

  for (const storeId of storeIds) {
    const rules = Array.isArray(storesMap[storeId]) ? storesMap[storeId] : [];
    summary.totalRulesInFile += rules.length;

    if (!rules.length) {
      console.log(`[SKIP] Empresa ${storeId} sem regras no arquivo.`);
      summary.storesSkipped += 1;
      continue;
    }

    const storeExists = await Store.exists({ _id: storeId });
    if (!storeExists) {
      console.log(`[SKIP] Empresa ${storeId} nao encontrada no banco. Regras nao migradas (${rules.length}).`);
      summary.storesSkipped += 1;
      continue;
    }

    const ops = [];
    for (const rule of rules) {
      const code = Number.parseInt(rule?.code, 10);
      if (!Number.isFinite(code) || code <= 0) {
        console.log(`[WARN] Empresa ${storeId}: regra ignorada por codigo invalido (${rule?.code}).`);
        continue;
      }

      const name = typeof rule?.name === 'string' ? rule.name.trim() : '';
      if (!name) {
        console.log(`[WARN] Empresa ${storeId}: regra ${code} ignorada por nome vazio.`);
        continue;
      }

      const createdAt = parseDateOrNow(rule?.createdAt);
      const updatedAt = parseDateOrNow(rule?.updatedAt || rule?.createdAt);

      ops.push({
        updateOne: {
          filter: { empresa: storeId, code },
          update: {
            $set: {
              empresa: storeId,
              code,
              name,
              fiscal: normalizeFiscalData(rule?.fiscal || {}),
              updatedBy: rule?.updatedBy || '',
              updatedAt,
            },
            $setOnInsert: {
              createdAt,
            },
          },
          upsert: true,
        },
      });
    }

    if (!ops.length) {
      console.log(`[SKIP] Empresa ${storeId} sem regras validas para migrar.`);
      summary.storesSkipped += 1;
      continue;
    }

    const result = await FiscalDefaultRule.bulkWrite(ops, {
      ordered: false,
      timestamps: false,
    });

    const upserts = Number(result?.upsertedCount || 0);
    const modified = Number(result?.modifiedCount || 0);
    const matched = Number(result?.matchedCount || 0);
    summary.totalUpserts += upserts;
    summary.storesMigrated += 1;

    console.log(`[OK] Empresa ${storeId}: processadas ${ops.length} regras (inseridas: ${upserts}, atualizadas: ${modified}, encontradas: ${matched}).`);
  }

  console.log('');
  console.log('Resumo da migracao:');
  console.log(`- Empresas no arquivo: ${summary.storesInFile}`);
  console.log(`- Empresas migradas: ${summary.storesMigrated}`);
  console.log(`- Empresas ignoradas: ${summary.storesSkipped}`);
  console.log(`- Total de regras no arquivo: ${summary.totalRulesInFile}`);
  console.log(`- Total de insercoes (upsert insert): ${summary.totalUpserts}`);

  process.exit(0);
}

run().catch((error) => {
  console.error('Erro na migracao de regras fiscais padrao:', error);
  process.exit(1);
});
