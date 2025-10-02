const express = require('express');
const mongoose = require('mongoose');

const router = express.Router();

const PaymentMethod = require('../models/PaymentMethod');
const Store = require('../models/Store');
const AccountingAccount = require('../models/AccountingAccount');
const BankAccount = require('../models/BankAccount');
const requireAuth = require('../middlewares/requireAuth');
const authorizeRoles = require('../middlewares/authorizeRoles');

const normalizeString = (value) => {
  if (value === undefined || value === null) return '';
  return String(value).trim();
};

const parseNumber = (value, fallback = 0) => {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const VALID_TYPES = new Set(['avista', 'debito', 'credito', 'crediario']);

const validateAccountingAccount = async (accountingAccountId) => {
  if (!accountingAccountId) return null;
  if (!mongoose.Types.ObjectId.isValid(accountingAccountId)) {
    const error = new Error('Conta contábil selecionada é inválida.');
    error.statusCode = 400;
    throw error;
  }

  const accountExists = await AccountingAccount.exists({ _id: accountingAccountId });
  if (!accountExists) {
    const error = new Error('Conta contábil selecionada não foi encontrada.');
    error.statusCode = 404;
    throw error;
  }

  return accountingAccountId;
};

const validateBankAccount = async (bankAccountId) => {
  if (!bankAccountId) return null;
  if (!mongoose.Types.ObjectId.isValid(bankAccountId)) {
    const error = new Error('Conta corrente selecionada é inválida.');
    error.statusCode = 400;
    throw error;
  }

  const accountExists = await BankAccount.exists({ _id: bankAccountId });
  if (!accountExists) {
    const error = new Error('Conta corrente selecionada não foi encontrada.');
    error.statusCode = 404;
    throw error;
  }

  return bankAccountId;
};

const extractNumericValue = (value) => {
  const normalized = normalizeString(value);
  if (!normalized) return 0;
  const matches = normalized.match(/\d+/g);
  if (!matches) {
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return matches.reduce((max, part) => {
    const parsed = Number(part);
    return Number.isFinite(parsed) && parsed > max ? parsed : max;
  }, 0);
};

const generateNextCode = async (companyId) => {
  const query = companyId ? { company: companyId } : {};
  const methods = await PaymentMethod.find(query, 'code').lean();
  const highest = methods.reduce((max, method) => {
    const current = extractNumericValue(method?.code);
    return current > max ? current : max;
  }, 0);
  return `MP-${String(highest + 1).padStart(3, '0')}`;
};

const normalizeInstallmentConfigurations = (raw, totalInstallments, defaultDays) => {
  const map = new Map();
  if (Array.isArray(raw)) {
    raw.forEach((item) => {
      const number = parseNumber(item?.number ?? item?.installment, null);
      if (!number) return;
      if (number < 1 || number > totalInstallments) return;
      const discount = Math.max(0, parseNumber(item?.discount, 0));
      const days = Math.max(0, parseNumber(item?.days, defaultDays));
      map.set(number, { number, discount, days });
    });
  }

  for (let installment = 1; installment <= totalInstallments; installment += 1) {
    if (!map.has(installment)) {
      map.set(installment, {
        number: installment,
        discount: 0,
        days: defaultDays,
      });
    }
  }

  return Array.from(map.values()).sort((a, b) => a.number - b.number);
};

router.get('/', async (req, res) => {
  try {
    const { company } = req.query;
    const query = {};
    if (company) {
      query.company = company;
    }

    const methods = await PaymentMethod.find(query)
      .sort({ createdAt: -1 })
      .populate('company', 'nome nomeFantasia razaoSocial cnpj cpf')
      .populate('accountingAccount', 'name code')
      .populate('bankAccount', 'alias bankName agency accountNumber accountDigit accountType');

    res.json({ paymentMethods: methods });
  } catch (error) {
    console.error('Erro ao listar meios de pagamento:', error);
    res.status(500).json({ message: 'Erro ao listar meios de pagamento.' });
  }
});

router.post('/', requireAuth, authorizeRoles('admin', 'admin_master'), async (req, res) => {
  try {
    const name = normalizeString(req.body.name);
    const company = normalizeString(req.body.company);
    const type = normalizeString(req.body.type).toLowerCase();

    if (!name) {
      return res.status(400).json({ message: 'Informe o nome do meio de pagamento.' });
    }

    if (!company) {
      return res.status(400).json({ message: 'Selecione a empresa vinculada ao meio de pagamento.' });
    }

    const storeExists = await Store.exists({ _id: company });
    if (!storeExists) {
      return res.status(404).json({ message: 'Empresa informada não foi encontrada.' });
    }

    if (!VALID_TYPES.has(type)) {
      return res.status(400).json({ message: 'Tipo de recebimento inválido.' });
    }

    const rawCode = normalizeString(req.body.code);
    let code = rawCode && rawCode.toLowerCase() !== 'gerado automaticamente' ? rawCode : await generateNextCode(company);

    let accountingAccountId = null;
    try {
      accountingAccountId = await validateAccountingAccount(normalizeString(req.body.accountingAccount));
    } catch (validationError) {
      const statusCode = validationError.statusCode || 400;
      return res.status(statusCode).json({ message: validationError.message || 'Conta contábil inválida.' });
    }

    let bankAccountId = null;
    try {
      bankAccountId = await validateBankAccount(normalizeString(req.body.bankAccount));
    } catch (validationError) {
      const statusCode = validationError.statusCode || 400;
      return res.status(statusCode).json({ message: validationError.message || 'Conta corrente inválida.' });
    }

    let attempts = 0;
    while (await PaymentMethod.exists({ company, code }) && attempts < 5) {
      const next = extractNumericValue(code) + 1;
      code = `MP-${String(next).padStart(3, '0')}`;
      attempts += 1;
    }

    if (await PaymentMethod.exists({ company, code })) {
      return res.status(409).json({ message: 'Já existe um meio de pagamento com este código para a empresa selecionada.' });
    }

    const days = Math.max(0, parseNumber(req.body.days, 0));
    const discount = Math.max(0, parseNumber(req.body.discount, 0));

    const payload = {
      company,
      code,
      name,
      type,
      days,
      discount,
    };

    if (type === 'credito') {
      const installments = Math.max(1, Math.min(12, parseNumber(req.body.installments, 1)));
      const installmentConfigurations = normalizeInstallmentConfigurations(
        req.body.installmentConfigurations,
        installments,
        days
      );
      payload.installments = installments;
      payload.installmentConfigurations = installmentConfigurations;
      if (installmentConfigurations.length) {
        payload.discount = installmentConfigurations[0].discount;
      }
    } else if (type === 'crediario') {
      const installments = Math.max(1, Math.min(24, parseNumber(req.body.installments, 1)));
      payload.installments = installments;
    }

    if (accountingAccountId) {
      payload.accountingAccount = accountingAccountId;
    }

    if (bankAccountId) {
      payload.bankAccount = bankAccountId;
    }

    const created = await PaymentMethod.create(payload);
    const populated = await created
      .populate('company', 'nome nomeFantasia razaoSocial cnpj cpf')
      .populate('accountingAccount', 'name code')
      .populate('bankAccount', 'alias bankName agency accountNumber accountDigit accountType');
    res.status(201).json(populated);
  } catch (error) {
    console.error('Erro ao criar meio de pagamento:', error);
    res.status(500).json({ message: 'Erro ao criar meio de pagamento.' });
  }
});

router.put('/:id', requireAuth, authorizeRoles('admin', 'admin_master'), async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ message: 'Identificador inválido do meio de pagamento.' });
    }

    const existing = await PaymentMethod.findById(id);
    if (!existing) {
      return res.status(404).json({ message: 'Meio de pagamento não encontrado.' });
    }

    const name = normalizeString(req.body.name);
    if (!name) {
      return res.status(400).json({ message: 'Informe o nome do meio de pagamento.' });
    }

    const company = normalizeString(req.body.company) || String(existing.company);
    if (!company) {
      return res.status(400).json({ message: 'Selecione a empresa vinculada ao meio de pagamento.' });
    }

    const storeExists = await Store.exists({ _id: company });
    if (!storeExists) {
      return res.status(404).json({ message: 'Empresa informada não foi encontrada.' });
    }

    let type = normalizeString(req.body.type).toLowerCase();
    if (!VALID_TYPES.has(type)) {
      type = existing.type;
    }

    let code = normalizeString(req.body.code) || existing.code || '';
    if (!code || code.toLowerCase() === 'gerado automaticamente') {
      code = existing.code || (await generateNextCode(company));
    }

    let attempts = 0;
    let candidateCode = code;
    while (
      await PaymentMethod.exists({ company, code: candidateCode, _id: { $ne: existing._id } }) &&
      attempts < 5
    ) {
      const next = extractNumericValue(candidateCode) + 1;
      candidateCode = `MP-${String(next).padStart(3, '0')}`;
      attempts += 1;
    }

    if (await PaymentMethod.exists({ company, code: candidateCode, _id: { $ne: existing._id } })) {
      return res
        .status(409)
        .json({ message: 'Já existe um meio de pagamento com este código para a empresa selecionada.' });
    }

    const days = Math.max(0, parseNumber(req.body.days, existing.days || 0));
    let discount = Math.max(0, parseNumber(req.body.discount, existing.discount || 0));

    let accountingAccountIdToApply = existing.accountingAccount ? String(existing.accountingAccount) : undefined;
    if (Object.prototype.hasOwnProperty.call(req.body, 'accountingAccount')) {
      const normalizedAccount = normalizeString(req.body.accountingAccount);
      try {
        accountingAccountIdToApply = await validateAccountingAccount(normalizedAccount);
      } catch (validationError) {
        const statusCode = validationError.statusCode || 400;
        return res.status(statusCode).json({ message: validationError.message || 'Conta contábil inválida.' });
      }

      if (!accountingAccountIdToApply) {
        accountingAccountIdToApply = undefined;
      }
    }

    let bankAccountIdToApply = existing.bankAccount ? String(existing.bankAccount) : undefined;
    if (Object.prototype.hasOwnProperty.call(req.body, 'bankAccount')) {
      const normalizedBankAccount = normalizeString(req.body.bankAccount);
      try {
        bankAccountIdToApply = await validateBankAccount(normalizedBankAccount);
      } catch (validationError) {
        const statusCode = validationError.statusCode || 400;
        return res.status(statusCode).json({ message: validationError.message || 'Conta corrente inválida.' });
      }

      if (!bankAccountIdToApply) {
        bankAccountIdToApply = undefined;
      }
    }

    existing.company = company;
    existing.code = candidateCode;
    existing.name = name;
    existing.type = type;
    existing.days = days;
    existing.discount = discount;
    existing.accountingAccount = accountingAccountIdToApply;
    existing.bankAccount = bankAccountIdToApply;

    if (type === 'credito') {
      const installments = Math.max(1, Math.min(12, parseNumber(req.body.installments, existing.installments || 1)));
      const installmentConfigurations = normalizeInstallmentConfigurations(
        req.body.installmentConfigurations,
        installments,
        days
      );
      existing.installments = installments;
      existing.installmentConfigurations = installmentConfigurations;
      if (installmentConfigurations.length) {
        discount = installmentConfigurations[0].discount;
        existing.discount = discount;
      }
      existing.markModified('installmentConfigurations');
    } else {
      if (type === 'crediario') {
        existing.installments = Math.max(
          1,
          Math.min(24, parseNumber(req.body.installments, existing.installments || 1))
        );
      } else {
        existing.installments = 1;
      }
      existing.installmentConfigurations = undefined;
      existing.markModified('installmentConfigurations');
    }

    const saved = await existing.save();
    const populated = await saved
      .populate('company', 'nome nomeFantasia razaoSocial cnpj cpf')
      .populate('accountingAccount', 'name code')
      .populate('bankAccount', 'alias bankName agency accountNumber accountDigit accountType');
    res.json(populated);
  } catch (error) {
    console.error('Erro ao atualizar meio de pagamento:', error);
    res.status(500).json({ message: 'Erro ao atualizar meio de pagamento.' });
  }
});

router.delete('/:id', requireAuth, authorizeRoles('admin', 'admin_master'), async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ message: 'Identificador inválido do meio de pagamento.' });
    }

    const deleted = await PaymentMethod.findByIdAndDelete(id);
    if (!deleted) {
      return res.status(404).json({ message: 'Meio de pagamento não encontrado.' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Erro ao remover meio de pagamento:', error);
    res.status(500).json({ message: 'Erro ao remover meio de pagamento.' });
  }
});

module.exports = router;
