const express = require('express');
const mongoose = require('mongoose');

const router = express.Router();

const AccountReceivable = require('../models/AccountReceivable');
const Store = require('../models/Store');
const User = require('../models/User');
const BankAccount = require('../models/BankAccount');
const AccountingAccount = require('../models/AccountingAccount');
const PaymentMethod = require('../models/PaymentMethod');
const requireAuth = require('../middlewares/requireAuth');
const authorizeRoles = require('../middlewares/authorizeRoles');

const AUTH_ROLES = ['admin', 'admin_master', 'funcionario'];

function normalizeString(value) {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

function parseBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  const normalized = normalizeString(value).toLowerCase();
  if (!normalized) return fallback;
  return ['true', '1', 'yes', 'on', 'sim'].includes(normalized);
}

function parseLocaleNumber(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return fallback;
  const normalized = value
    .trim()
    .replace(/\s+/g, '')
    .replace(/\.(?=\d{3}(?:\D|$))/g, '')
    .replace(',', '.')
    .replace(/[^0-9.+-]/g, '');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseDate(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const normalized = normalizeString(value);
  if (!normalized) return null;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function addMonths(date, months) {
  const base = new Date(date.getTime());
  const year = base.getUTCFullYear();
  const month = base.getUTCMonth();
  const day = base.getUTCDate();
  const next = new Date(Date.UTC(year, month + months, 1));
  const lastDayOfTargetMonth = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(day, lastDayOfTargetMonth));
  next.setUTCHours(base.getUTCHours(), base.getUTCMinutes(), base.getUTCSeconds(), base.getUTCMilliseconds());
  return next;
}

function formatCurrency(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

async function generateSequentialCode() {
  const now = new Date();
  const year = now.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const count = await AccountReceivable.countDocuments({ createdAt: { $gte: yearStart } });
  const sequential = String(count + 1).padStart(5, '0');
  return `CR-${year}-${sequential}`;
}

function buildDisplayName(user) {
  if (!user) return '';
  const plain = typeof user.toObject === 'function' ? user.toObject() : user;
  return plain.nomeCompleto || plain.razaoSocial || plain.email || 'Sem nome';
}

function buildCompanyName(company) {
  if (!company) return '';
  const plain = typeof company.toObject === 'function' ? company.toObject() : company;
  return plain.nomeFantasia || plain.nome || plain.razaoSocial || 'Empresa';
}

function buildBankLabel(account) {
  if (!account) return '';
  const plain = typeof account.toObject === 'function' ? account.toObject() : account;
  const alias = plain.alias ? `${plain.alias}` : '';
  const bank = plain.bankName || plain.bankCode || '';
  const accountNumber = [plain.accountNumber, plain.accountDigit].filter(Boolean).join('-');
  const agency = plain.agency ? `Ag. ${plain.agency}` : '';
  const doc = [bank, agency, accountNumber].filter(Boolean).join(' ');
  if (alias && doc) return `${alias} (${doc})`;
  return alias || doc || 'Conta bancária';
}

function buildAccountingLabel(account) {
  if (!account) return '';
  const plain = typeof account.toObject === 'function' ? account.toObject() : account;
  return [plain.code, plain.name].filter(Boolean).join(' - ') || 'Conta contábil';
}

function buildInstallmentPayload(installment) {
  if (!installment) return null;
  const plain = typeof installment.toObject === 'function' ? installment.toObject() : installment;
  return {
    number: plain.number,
    issueDate: plain.issueDate,
    dueDate: plain.dueDate,
    value: formatCurrency(plain.value),
    bankAccount: plain.bankAccount ? {
      _id: plain.bankAccount._id,
      label: buildBankLabel(plain.bankAccount),
    } : null,
    accountingAccount: plain.accountingAccount ? {
      _id: plain.accountingAccount._id,
      label: buildAccountingLabel(plain.accountingAccount),
    } : null,
    status: plain.status,
  };
}

function computeStatus(receivable, referenceDate = new Date()) {
  const ref = referenceDate instanceof Date ? referenceDate : new Date();
  const due = receivable?.dueDate ? new Date(receivable.dueDate) : null;
  if (receivable?.uncollectible) return 'uncollectible';
  if (receivable?.protest) return 'protest';
  if (receivable?.forecast) return 'forecast';
  if (!due || Number.isNaN(due.getTime())) return 'open';
  const normalizedDue = new Date(Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate()));
  const normalizedRef = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate()));
  if (normalizedDue.getTime() < normalizedRef.getTime()) return 'overdue';
  if (normalizedDue.getTime() === normalizedRef.getTime()) return 'confirmed';
  return 'open';
}

function buildPublicReceivable(receivable, referenceDate = new Date()) {
  if (!receivable) return null;
  const plain = typeof receivable.toObject === 'function' ? receivable.toObject({ virtuals: true }) : receivable;
  return {
    _id: plain._id,
    code: plain.code,
    company: plain.company ? {
      _id: plain.company._id,
      name: buildCompanyName(plain.company),
    } : null,
    customer: plain.customer ? {
      _id: plain.customer._id,
      name: buildDisplayName(plain.customer),
      document: plain.customer.cpf || plain.customer.cnpj || null,
    } : null,
    installmentsCount: plain.installmentsCount,
    issueDate: plain.issueDate,
    dueDate: plain.dueDate,
    totalValue: formatCurrency(plain.totalValue),
    bankAccount: plain.bankAccount ? {
      _id: plain.bankAccount._id,
      label: buildBankLabel(plain.bankAccount),
    } : null,
    accountingAccount: plain.accountingAccount ? {
      _id: plain.accountingAccount._id,
      label: buildAccountingLabel(plain.accountingAccount),
    } : null,
    paymentMethod: plain.paymentMethod ? {
      _id: plain.paymentMethod._id,
      name: plain.paymentMethod.name,
      type: plain.paymentMethod.type,
    } : null,
    responsible: plain.responsible ? {
      _id: plain.responsible._id,
      name: buildDisplayName(plain.responsible),
    } : null,
    document: plain.document || '',
    documentNumber: plain.documentNumber || '',
    notes: plain.notes || '',
    forecast: !!plain.forecast,
    uncollectible: !!plain.uncollectible,
    protest: !!plain.protest,
    installments: Array.isArray(plain.installments)
      ? plain.installments.map(buildInstallmentPayload).filter(Boolean)
      : [],
    status: computeStatus(plain, referenceDate),
    createdAt: plain.createdAt,
    updatedAt: plain.updatedAt,
  };
}

function summarizeReceivables(receivables, referenceDate = new Date()) {
  const summary = {
    confirmed: { count: 0, total: 0 },
    open: { count: 0, total: 0 },
    overdue: { count: 0, total: 0 },
  };

  receivables.forEach((item) => {
    const status = computeStatus(item, referenceDate);
    const total = formatCurrency(item.totalValue);
    if (status === 'confirmed') {
      summary.confirmed.count += 1;
      summary.confirmed.total += total;
    } else if (status === 'overdue') {
      summary.overdue.count += 1;
      summary.overdue.total += total;
    } else {
      summary.open.count += 1;
      summary.open.total += total;
    }
  });

  summary.confirmed.total = formatCurrency(summary.confirmed.total);
  summary.open.total = formatCurrency(summary.open.total);
  summary.overdue.total = formatCurrency(summary.overdue.total);

  return summary;
}

router.get(
  '/options',
  requireAuth,
  authorizeRoles(...AUTH_ROLES),
  async (req, res) => {
    try {
      const [companies, customers, employees] = await Promise.all([
        Store.find({}, 'nome nomeFantasia razaoSocial cnpj').sort({ nomeFantasia: 1, nome: 1 }),
        User.find({}, 'nomeCompleto razaoSocial email cpf cnpj role').sort({ nomeCompleto: 1, razaoSocial: 1 }),
        User.find({ role: 'funcionario' }, 'nomeCompleto razaoSocial email role').sort({ nomeCompleto: 1, razaoSocial: 1 }),
      ]);

      res.json({
        companies: companies.map((company) => ({
          _id: company._id,
          name: buildCompanyName(company),
          document: company.cnpj || null,
        })),
        customers: customers.map((customer) => ({
          _id: customer._id,
          name: buildDisplayName(customer),
          document: customer.cpf || customer.cnpj || null,
          role: customer.role,
        })),
        employees: employees.map((employee) => ({
          _id: employee._id,
          name: buildDisplayName(employee),
        })),
      });
    } catch (error) {
      console.error('Erro ao carregar opções para contas a receber:', error);
      res.status(500).json({ message: 'Erro ao carregar opções para o formulário.' });
    }
  }
);

router.get(
  '/',
  requireAuth,
  authorizeRoles(...AUTH_ROLES),
  async (req, res) => {
    try {
      const { company } = req.query;
      const filter = {};
      if (company && mongoose.Types.ObjectId.isValid(company)) {
        filter.company = company;
      }

      const receivables = await AccountReceivable.find(filter)
        .sort({ createdAt: -1 })
        .populate('company', 'nome nomeFantasia razaoSocial cnpj')
        .populate('customer', 'nomeCompleto razaoSocial email cpf cnpj')
        .populate('bankAccount', 'alias bankName bankCode agency accountNumber accountDigit')
        .populate('accountingAccount', 'name code')
        .populate('paymentMethod', 'name type')
        .populate('responsible', 'nomeCompleto razaoSocial email')
        .populate('installments.bankAccount', 'alias bankName bankCode agency accountNumber accountDigit')
        .populate('installments.accountingAccount', 'name code');

      const payload = receivables.map((item) => buildPublicReceivable(item));
      const summary = summarizeReceivables(payload);

      res.json({ receivables: payload, summary });
    } catch (error) {
      console.error('Erro ao listar contas a receber:', error);
      res.status(500).json({ message: 'Erro ao listar contas a receber.' });
    }
  }
);

router.post(
  '/',
  requireAuth,
  authorizeRoles(...AUTH_ROLES),
  async (req, res) => {
    try {
      const company = normalizeString(req.body.company);
      const customer = normalizeString(req.body.customer);
      const bankAccountId = normalizeString(req.body.bankAccount);
      const accountingAccountId = normalizeString(req.body.accountingAccount);
      const paymentMethodId = normalizeString(req.body.paymentMethod);
      const responsibleId = normalizeString(req.body.responsible);
      const document = normalizeString(req.body.document);
      const documentNumber = normalizeString(req.body.documentNumber);
      const notes = normalizeString(req.body.notes);

      if (!company || !mongoose.Types.ObjectId.isValid(company)) {
        return res.status(400).json({ message: 'Selecione a empresa responsável pelo lançamento.' });
      }

      if (!customer || !mongoose.Types.ObjectId.isValid(customer)) {
        return res.status(400).json({ message: 'Selecione o cliente vinculado à conta a receber.' });
      }

      if (!bankAccountId || !mongoose.Types.ObjectId.isValid(bankAccountId)) {
        return res.status(400).json({ message: 'Selecione a conta corrente para o recebimento.' });
      }

      if (!accountingAccountId || !mongoose.Types.ObjectId.isValid(accountingAccountId)) {
        return res.status(400).json({ message: 'Selecione a conta contábil do lançamento.' });
      }

      const installmentsCount = Math.max(1, parseInt(req.body.installments, 10) || 1);
      const issueDate = parseDate(req.body.issueDate || req.body.issue);
      const dueDate = parseDate(req.body.dueDate || req.body.due);
      const totalValue = formatCurrency(parseLocaleNumber(req.body.totalValue || req.body.value, 0));

      if (!issueDate) {
        return res.status(400).json({ message: 'Informe a data de emissão.' });
      }

      if (!dueDate) {
        return res.status(400).json({ message: 'Informe a data de vencimento.' });
      }

      if (!(totalValue > 0)) {
        return res.status(400).json({ message: 'Informe um valor total maior que zero.' });
      }

      const [companyExists, customerExists] = await Promise.all([
        Store.exists({ _id: company }),
        User.exists({ _id: customer }),
      ]);

      if (!companyExists) {
        return res.status(404).json({ message: 'Empresa selecionada não foi encontrada.' });
      }

      if (!customerExists) {
        return res.status(404).json({ message: 'Cliente selecionado não foi encontrado.' });
      }

      const bankAccount = await BankAccount.findById(bankAccountId);
      if (!bankAccount) {
        return res.status(404).json({ message: 'Conta corrente selecionada não foi encontrada.' });
      }
      if (String(bankAccount.company) !== company) {
        return res.status(400).json({ message: 'A conta corrente informada não pertence à empresa selecionada.' });
      }

      const accountingAccount = await AccountingAccount.findById(accountingAccountId);
      if (!accountingAccount) {
        return res.status(404).json({ message: 'Conta contábil selecionada não foi encontrada.' });
      }
      if (!accountingAccount.companies?.some?.((companyId) => String(companyId) === company)) {
        return res.status(400).json({ message: 'A conta contábil informada não está vinculada à empresa selecionada.' });
      }

      let paymentMethod = null;
      if (paymentMethodId) {
        paymentMethod = await PaymentMethod.findOne({ _id: paymentMethodId, company });
        if (!paymentMethod) {
          return res.status(404).json({ message: 'Meio de pagamento selecionado não foi encontrado para a empresa informada.' });
        }
      }

      let responsible = null;
      if (responsibleId) {
        responsible = await User.findOne({ _id: responsibleId, role: 'funcionario' });
        if (!responsible) {
          return res.status(404).json({ message: 'Funcionário responsável não foi encontrado.' });
        }
      }

      const forecast = parseBoolean(req.body.forecast);
      const uncollectible = parseBoolean(req.body.uncollectible);
      const protest = parseBoolean(req.body.protest);

      const code = await generateSequentialCode();

      const rawInstallments = Array.isArray(req.body.installmentsData)
        ? req.body.installmentsData
        : [];

      const detailsMap = new Map();
      rawInstallments.forEach((item) => {
        const number = Number.parseInt(item?.number, 10);
        if (!Number.isFinite(number) || number < 1 || number > installmentsCount) return;
        const dueOverride = parseDate(item?.dueDate || item?.due);
        const bankOverride = normalizeString(item?.bankAccount || item?.bank);
        const normalizedBank = bankOverride && mongoose.Types.ObjectId.isValid(bankOverride) ? bankOverride : null;
        detailsMap.set(number, {
          dueDate: dueOverride && !Number.isNaN(dueOverride.getTime()) ? dueOverride : null,
          bankAccount: normalizedBank,
        });
      });

      const bankAccountsMap = new Map();
      bankAccountsMap.set(String(bankAccount._id), bankAccount);

      const overrideBankAccountIds = [...new Set(
        Array.from(detailsMap.values())
          .map((detail) => detail.bankAccount)
          .filter((id) => id && id !== bankAccountId),
      )];

      if (overrideBankAccountIds.length) {
        const overrideAccounts = await BankAccount.find({ _id: { $in: overrideBankAccountIds } });
        if (overrideAccounts.length !== overrideBankAccountIds.length) {
          return res.status(404).json({ message: 'Algumas contas correntes informadas nas parcelas não foram encontradas.' });
        }
        for (const account of overrideAccounts) {
          if (String(account.company) !== company) {
            return res.status(400).json({
              message: 'Uma das contas correntes informadas nas parcelas não pertence à empresa selecionada.',
            });
          }
          bankAccountsMap.set(String(account._id), account);
        }
      }

      const installments = [];
      const centsTotal = Math.round(totalValue * 100);
      const baseCents = Math.floor(centsTotal / installmentsCount);
      const remainder = centsTotal - baseCents * installmentsCount;

      for (let index = 0; index < installmentsCount; index += 1) {
        const amountCents = baseCents + (index < remainder ? 1 : 0);
        const installmentValue = formatCurrency(amountCents / 100);
        const number = index + 1;
        const details = detailsMap.get(number) || {};
        const installmentDue = details.dueDate || addMonths(dueDate, index);
        const bankAccountForInstallment = details.bankAccount && bankAccountsMap.has(details.bankAccount)
          ? details.bankAccount
          : bankAccountId;
        installments.push({
          number,
          issueDate,
          dueDate: installmentDue,
          value: installmentValue,
          bankAccount: bankAccountForInstallment,
          accountingAccount: accountingAccountId,
        });
      }

      const payload = {
        code,
        company,
        customer,
        installmentsCount,
        issueDate,
        dueDate,
        totalValue,
        bankAccount: bankAccountId,
        accountingAccount: accountingAccountId,
        paymentMethod: paymentMethodId || undefined,
        responsible: responsibleId || undefined,
        document,
        documentNumber,
        notes,
        forecast,
        uncollectible,
        protest,
        installments,
      };

      const created = await AccountReceivable.create(payload);
      const populated = await created.populate([
        { path: 'company', select: 'nome nomeFantasia razaoSocial cnpj' },
        { path: 'customer', select: 'nomeCompleto razaoSocial email cpf cnpj' },
        { path: 'bankAccount', select: 'alias bankName bankCode agency accountNumber accountDigit' },
        { path: 'accountingAccount', select: 'name code' },
        { path: 'paymentMethod', select: 'name type' },
        { path: 'responsible', select: 'nomeCompleto razaoSocial email' },
        { path: 'installments.bankAccount', select: 'alias bankName bankCode agency accountNumber accountDigit' },
        { path: 'installments.accountingAccount', select: 'name code' },
      ]);

      res.status(201).json(buildPublicReceivable(populated));
    } catch (error) {
      console.error('Erro ao criar conta a receber:', error);
      res.status(500).json({ message: 'Erro ao criar conta a receber.' });
    }
  }
);

module.exports = router;
