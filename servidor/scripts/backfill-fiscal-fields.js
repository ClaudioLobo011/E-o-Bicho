#!/usr/bin/env node

const path = require('path');
const dotenv = require('dotenv');
const connectDB = require('../config/db');
const Product = require('../models/Product');
const { mergeFiscalData } = require('../services/fiscalRuleEngine');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const defaultMapping = require('../data/fiscal-rules.json');
const baseFiscalDefaults = defaultMapping?.defaults || {};

async function run() {
  await connectDB();

  const cursor = Product.find({}).cursor();
  let processed = 0;
  let updated = 0;

  for await (const product of cursor) {
    processed += 1;
    const mergedFiscal = mergeFiscalData(baseFiscalDefaults, product.fiscal || {});
    if (!product.fiscal || JSON.stringify(mergedFiscal) !== JSON.stringify(product.fiscal)) {
      mergedFiscal.atualizadoEm = product.fiscal?.atualizadoEm || null;
      mergedFiscal.atualizadoPor = product.fiscal?.atualizadoPor || '';
      product.fiscal = mergedFiscal;
      await product.save();
      updated += 1;
    }
  }

  console.log(`Processados ${processed} produtos. Atualizados ${updated}.`);
  process.exit(0);
}

run().catch((error) => {
  console.error('Erro ao atualizar campos fiscais:', error);
  process.exit(1);
});
