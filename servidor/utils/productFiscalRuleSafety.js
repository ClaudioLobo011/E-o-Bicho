const mongoose = require('mongoose');

async function assertProductFiscalRuleTypes(assignments = {}, model) {
  const references = Object.entries(assignments).map(([empresa, fiscal]) => ({ empresa, code: Number(fiscal?.fiscalRuleCode) }))
    .filter((entry) => mongoose.isValidObjectId(entry.empresa) && Number.isInteger(entry.code) && entry.code > 0);
  if (!references.length) return;
  const FiscalDefaultRule = model || require('../models/FiscalDefaultRule');
  const wrong = await FiscalDefaultRule.findOne({ tipo: 'servico', $or: references }).select('code name').lean();
  if (wrong) throw Object.assign(new Error(`A regra ${wrong.code} (${wrong.name}) é de serviço. Selecione uma regra de mercadoria para este produto.`), { statusCode: 400 });
}

module.exports = { assertProductFiscalRuleTypes };
