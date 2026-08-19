require('dotenv').config();

const mongoose = require('mongoose');
const Product = require('../models/Product');
const FiscalDefaultRule = require('../models/FiscalDefaultRule');

const PRODUCT_ID = '68a609824652d5650cfbbd6e';
const APPLY = process.argv.includes('--apply');
const IBS_CBS = Object.freeze({
  cst: '000',
  cClassTrib: '000001',
  pIBSUF: 0.1,
  pIBSMun: 0,
  pCBS: 0.9,
});

async function main() {
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI || process.env.DATABASE_URL;
  if (!mongoUri) throw new Error('MONGO_URI/MONGODB_URI não configurada.');
  await mongoose.connect(mongoUri);

  const product = await Product.findById(PRODUCT_ID).lean();
  if (!product) throw new Error(`Produto ${PRODUCT_ID} não encontrado.`);

  const assignments = Object.entries(product.fiscalPorEmpresa || {})
    .map(([storeId, fiscal]) => ({ storeId, ruleCode: Number(fiscal?.fiscalRuleCode) }))
    .filter(({ storeId, ruleCode }) => mongoose.Types.ObjectId.isValid(storeId) && Number.isInteger(ruleCode) && ruleCode > 0);

  const rules = await FiscalDefaultRule.find({
    $or: assignments.map(({ storeId, ruleCode }) => ({ empresa: storeId, code: ruleCode })),
  }).lean();

  const report = {
    mode: APPLY ? 'apply' : 'read-only',
    product: { id: String(product._id), cod: product.cod, nome: product.nome },
    assignments,
    rules: rules.map((rule) => ({
      id: String(rule._id),
      storeId: String(rule.empresa),
      code: rule.code,
      name: rule.name,
      previous: rule.fiscal?.ibsCbs || null,
      next: IBS_CBS,
    })),
  };

  if (!APPLY) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const now = new Date();
  const operations = rules.map((rule) => ({
    updateOne: {
      filter: { _id: rule._id },
      update: {
        $set: {
          'fiscal.ibsCbs': IBS_CBS,
          updatedBy: 'codex-backfill-ibs-cbs-2026',
          updatedAt: now,
        },
      },
    },
  }));
  if (operations.length) await FiscalDefaultRule.bulkWrite(operations);

  const productSet = { updatedAt: now };
  assignments.forEach(({ storeId }) => {
    productSet[`fiscalPorEmpresa.${storeId}.ibsCbs`] = IBS_CBS;
  });
  await Product.collection.updateOne({ _id: product._id }, { $set: productSet });

  report.updatedRules = operations.length;
  report.productTouched = true;
  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
