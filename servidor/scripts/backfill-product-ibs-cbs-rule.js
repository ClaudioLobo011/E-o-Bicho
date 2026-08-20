require('dotenv').config();

const mongoose = require('mongoose');
const Product = require('../models/Product');
const FiscalDefaultRule = require('../models/FiscalDefaultRule');
const Store = require('../models/Store');

const APPLY = process.argv.includes('--apply');
const IBS_CBS = Object.freeze({
  cst: '000',
  cClassTrib: '000001',
  pIBSUF: 0.1,
  pIBSMun: 0,
  pCBS: 0.9,
});

const completeIbsCbs = (value = {}) => Boolean(
  String(value.cst || '').trim() && String(value.cClassTrib || '').trim()
);

async function main() {
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI || process.env.DATABASE_URL;
  if (!mongoUri) throw new Error('MONGO_URI/MONGODB_URI não configurada.');
  await mongoose.connect(mongoUri);

  const rules = await FiscalDefaultRule.find({}).sort({ empresa: 1, code: 1 }).lean();
  const incomplete = rules.filter((rule) => !completeIbsCbs(rule.fiscal?.ibsCbs));
  const stores = await Store.find({ _id: { $in: incomplete.map((rule) => rule.empresa) } })
    .select('nome nomeFantasia')
    .lean();
  const storeNames = new Map(stores.map((store) => [String(store._id), store.nomeFantasia || store.nome || '']));

  const report = {
    mode: APPLY ? 'apply' : 'read-only',
    defaultIbsCbs: IBS_CBS,
    rules: incomplete.map((rule) => ({
      id: String(rule._id),
      storeId: String(rule.empresa),
      store: storeNames.get(String(rule.empresa)) || '',
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
  let productsTouched = 0;
  for (const rule of incomplete) {
    await FiscalDefaultRule.updateOne(
      { _id: rule._id },
      {
        $set: {
          'fiscal.ibsCbs': IBS_CBS,
          updatedBy: 'codex-backfill-ibs-cbs-2026',
          updatedAt: now,
        },
      },
      { timestamps: false }
    );
    const assignmentPath = `fiscalPorEmpresa.${rule.empresa}.fiscalRuleCode`;
    const touched = await Product.updateMany(
      { [assignmentPath]: String(rule.code) },
      { $set: { updatedAt: now } },
      { timestamps: false }
    );
    productsTouched += Number(touched.modifiedCount || 0);
  }

  report.rulesUpdated = incomplete.length;
  report.productsTouched = productsTouched;
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
