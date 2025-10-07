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

const RESIDUAL_THRESHOLD = 0.009;

function normalizeStatusToken(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  let normalized = trimmed;
  if (typeof normalized.normalize === 'function') {
    try {
      normalized = normalized.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    } catch (error) {
      /* ignore */
    }
  }
  normalized = normalized.replace(/[^a-z0-9\s-]/gi, ' ');
  return normalized.replace(/[\s_-]+/g, ' ').trim().toLowerCase();
}

const FINALIZED_STATUS_KEYS = new Set([
  'received',
  'recebido',
  'recebida',
  'paid',
  'pago',
  'paga',
  'finalized',
  'finalizado',
  'finalizada',
  'quitado',
  'quitada',
  'liquidado',
  'liquidada',
  'baixado',
  'baixada',
  'compensado',
  'compensada',
  'settled',
  'concluido',
  'concluida',
]);

const UNCOLLECTIBLE_STATUS_KEYS = new Set([
  'uncollectible',
  'incobravel',
  'impagavel',
  'perda',
  'perdido',
  'prejuizo',
  'writeoff',
]);

const PROTEST_STATUS_KEYS = new Set([
  'protest',
  'protesto',
  'protestado',
  'protestada',
  'em protesto',
]);

const OPEN_STATUS_KEYS = new Set([
  'open',
  'pending',
  'pendente',
  'aberto',
  'em aberto',
  'overdue',
  'vencido',
  'vencida',
  'atrasado',
  'atrasada',
  'late',
  'aguardando',
  'aguardando pagamento',
  'em atraso',
  'inadimplente',
  'inadimplencia',
  'partial',
  'parcial',
]);

function canonicalStatus(value) {
  const token = normalizeStatusToken(value);
  if (!token) return '';
  if (FINALIZED_STATUS_KEYS.has(token)) return 'finalized';
  if (UNCOLLECTIBLE_STATUS_KEYS.has(token)) return 'uncollectible';
  if (PROTEST_STATUS_KEYS.has(token)) return 'protest';
  if (OPEN_STATUS_KEYS.has(token)) return 'open';
  return '';
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
    originalValue: formatCurrency(plain.originalValue || plain.value),
    paidValue: formatCurrency(plain.paidValue),
    paidDate: plain.paidDate,
    bankAccount: plain.bankAccount ? {
      _id: plain.bankAccount._id,
      label: buildBankLabel(plain.bankAccount),
    } : null,
    accountingAccount: plain.accountingAccount ? {
      _id: plain.accountingAccount._id,
      label: buildAccountingLabel(plain.accountingAccount),
    } : null,
    paymentMethod: plain.paymentMethod
      ? {
          _id: plain.paymentMethod._id,
          name: plain.paymentMethod.name,
          type: plain.paymentMethod.type,
        }
      : null,
    paymentDocument: plain.paymentDocument || '',
    paymentNotes: plain.paymentNotes || '',
    residualValue: formatCurrency(plain.residualValue),
    residualDueDate: plain.residualDueDate,
    originInstallmentNumber: plain.originInstallmentNumber || null,
    status: canonicalStatus(plain.status) || 'open',
  };
}

function computeStatus(receivable) {
  if (!receivable) return 'open';
  const receivableStatus = canonicalStatus(receivable?.status);

  if (receivable?.uncollectible || receivableStatus === 'uncollectible') {
    return 'uncollectible';
  }
  if (receivable?.protest || receivableStatus === 'protest') {
    return 'protest';
  }

  const installments = Array.isArray(receivable?.installments) ? receivable.installments : [];
  if (installments.length > 0) {
    const anyUncollectible = installments.some((item) => canonicalStatus(item?.status) === 'uncollectible');
    if (anyUncollectible) {
      return 'uncollectible';
    }
    const anyProtest = installments.some((item) => canonicalStatus(item?.status) === 'protest');
    if (anyProtest) {
      return 'protest';
    }
    const allFinalized = installments.every((item) => canonicalStatus(item?.status) === 'finalized');
    if (allFinalized) {
      return 'finalized';
    }
  }

  if (receivableStatus === 'finalized') {
    return 'finalized';
  }

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

function recalculateReceivable(receivable) {
  if (!receivable) return;
  const installments = Array.isArray(receivable.installments) ? receivable.installments : [];
  receivable.installmentsCount = installments.length;
  const total = installments.reduce((acc, installment) => acc + Number(installment.value || 0), 0);
  receivable.totalValue = formatCurrency(total);
  const latestDue = installments.reduce((latest, installment) => {
    const due = parseDate(installment.dueDate);
    if (!due) return latest;
    if (!latest || due > latest) return due;
    return latest;
  }, null);
  if (latestDue) {
    receivable.dueDate = latestDue;
  }
}

function computeInstallmentStatus(receivable, installment) {
  if (!receivable) return 'open';

  const receivableStatus = canonicalStatus(receivable?.status);

  if (receivable?.uncollectible || receivableStatus === 'uncollectible') {
    return 'uncollectible';
  }

  if (receivable?.protest || receivableStatus === 'protest') {
    return 'protest';
  }

  const installmentStatus = canonicalStatus(installment?.status);
  if (installmentStatus) {
    return installmentStatus;
  }

  if (receivableStatus === 'finalized') {
    return 'finalized';
  }

  const installments = Array.isArray(receivable?.installments) ? receivable.installments : [];
  if (!installment && installments.length > 0) {
    const allFinalized = installments.every(
      (item) => canonicalStatus(item?.status) === 'finalized'
    );
    if (allFinalized) {
      return 'finalized';
    }
  }

  return 'open';
}

function summarizeReceivables(receivables) {
  const summary = {
    open: { count: 0, total: 0 },
    finalized: { count: 0, total: 0 },
    uncollectible: { count: 0, total: 0 },
    protest: { count: 0, total: 0 },
  };

  receivables.forEach((receivable) => {
    const installments = Array.isArray(receivable?.installments) && receivable.installments.length
      ? receivable.installments
      : [
          {
            value: receivable?.totalValue,
            status: receivable?.status,
          },
        ];

    installments.forEach((installment) => {
      const status = computeInstallmentStatus(receivable, installment);
      const key = Object.prototype.hasOwnProperty.call(summary, status) ? status : 'open';
      const value = formatCurrency(
        installment?.value !== undefined && installment?.value !== null
          ? installment.value
          : receivable?.totalValue
      );
      summary[key].count += 1;
      summary[key].total += value;
    });
  });

  summary.open.total = formatCurrency(summary.open.total);
  summary.finalized.total = formatCurrency(summary.finalized.total);
  summary.uncollectible.total = formatCurrency(summary.uncollectible.total);
  summary.protest.total = formatCurrency(summary.protest.total);

  return summary;
}

const RECEIVABLE_POPULATE = [
  { path: 'company', select: 'nome nomeFantasia razaoSocial cnpj' },
  { path: 'customer', select: 'nomeCompleto razaoSocial email cpf cnpj' },
  { path: 'bankAccount', select: 'alias bankName bankCode agency accountNumber accountDigit' },
  { path: 'accountingAccount', select: 'name code' },
  { path: 'paymentMethod', select: 'name type' },
  { path: 'responsible', select: 'nomeCompleto razaoSocial email' },
  { path: 'installments.bankAccount', select: 'alias bankName bankCode agency accountNumber accountDigit' },
  { path: 'installments.accountingAccount', select: 'name code' },
  { path: 'installments.paymentMethod', select: 'name type' },
];

async function assembleReceivablePayload(body, { existing = null } = {}) {
  const company = normalizeString(body.company) || (existing ? String(existing.company) : '');
  if (!company || !mongoose.Types.ObjectId.isValid(company)) {
    throw Object.assign(new Error('Selecione a empresa responsável pelo lançamento.'), { status: 400 });
  }

  const customer = normalizeString(body.customer) || (existing ? String(existing.customer) : '');
  if (!customer || !mongoose.Types.ObjectId.isValid(customer)) {
    throw Object.assign(new Error('Selecione o cliente vinculado à conta a receber.'), { status: 400 });
  }

  const bankAccountId = normalizeString(body.bankAccount) || (existing ? String(existing.bankAccount) : '');
  if (!bankAccountId || !mongoose.Types.ObjectId.isValid(bankAccountId)) {
    throw Object.assign(new Error('Selecione a conta corrente para o recebimento.'), { status: 400 });
  }

  const accountingAccountId = normalizeString(body.accountingAccount) || (existing ? String(existing.accountingAccount) : '');
  if (!accountingAccountId || !mongoose.Types.ObjectId.isValid(accountingAccountId)) {
    throw Object.assign(new Error('Selecione a conta contábil do lançamento.'), { status: 400 });
  }

  const installmentsCountRaw =
    body.installments ?? body.installmentsCount ?? existing?.installmentsCount ?? 1;
  const installmentsCount = Math.max(1, parseInt(installmentsCountRaw, 10) || 1);

  const issueDate = parseDate(body.issueDate || body.issue || existing?.issueDate);
  if (!issueDate) {
    throw Object.assign(new Error('Informe a data de emissão.'), { status: 400 });
  }

  const dueDate = parseDate(body.dueDate || body.due || existing?.dueDate);
  if (!dueDate) {
    throw Object.assign(new Error('Informe a data de vencimento.'), { status: 400 });
  }

  const totalValue = formatCurrency(
    parseLocaleNumber(body.totalValue || body.value || existing?.totalValue || 0)
  );
  if (!(totalValue > 0)) {
    throw Object.assign(new Error('Informe um valor total maior que zero.'), { status: 400 });
  }

  const paymentMethodId = normalizeString(body.paymentMethod || body.paymentMethodId);
  const responsibleId = normalizeString(body.responsible || body.responsibleId);
  const document = normalizeString(body.document || existing?.document);
  const documentNumber = normalizeString(body.documentNumber || existing?.documentNumber);
  const notes = normalizeString(body.notes || existing?.notes);

  const [companyExists, customerExists] = await Promise.all([
    Store.exists({ _id: company }),
    User.exists({ _id: customer }),
  ]);

  if (!companyExists) {
    throw Object.assign(new Error('Empresa selecionada não foi encontrada.'), { status: 404 });
  }

  if (!customerExists) {
    throw Object.assign(new Error('Cliente selecionado não foi encontrado.'), { status: 404 });
  }

  const [bankAccount, accountingAccount] = await Promise.all([
    BankAccount.findById(bankAccountId),
    AccountingAccount.findById(accountingAccountId),
  ]);

  if (!bankAccount) {
    throw Object.assign(new Error('Conta corrente selecionada não foi encontrada.'), { status: 404 });
  }
  if (String(bankAccount.company) !== company) {
    throw Object.assign(new Error('A conta corrente informada não pertence à empresa selecionada.'), {
      status: 400,
    });
  }

  if (!accountingAccount) {
    throw Object.assign(new Error('Conta contábil selecionada não foi encontrada.'), { status: 404 });
  }
  const accountingCompanies = Array.isArray(accountingAccount.companies)
    ? accountingAccount.companies.map((value) => String(value))
    : [];
  if (!accountingCompanies.includes(company)) {
    throw Object.assign(
      new Error('A conta contábil informada não está vinculada à empresa selecionada.'),
      { status: 400 }
    );
  }

  if (paymentMethodId) {
    const paymentMethodExists = await PaymentMethod.exists({ _id: paymentMethodId, company });
    if (!paymentMethodExists) {
      throw Object.assign(
        new Error('Meio de pagamento selecionado não foi encontrado para a empresa informada.'),
        { status: 404 }
      );
    }
  }

  if (responsibleId) {
    const responsibleExists = await User.exists({ _id: responsibleId, role: 'funcionario' });
    if (!responsibleExists) {
      throw Object.assign(new Error('Funcionário responsável não foi encontrado.'), { status: 404 });
    }
  }

  const forecast = parseBoolean(
    Object.prototype.hasOwnProperty.call(body, 'forecast') ? body.forecast : existing?.forecast
  );
  const uncollectible = parseBoolean(
    Object.prototype.hasOwnProperty.call(body, 'uncollectible')
      ? body.uncollectible
      : existing?.uncollectible
  );
  const protest = parseBoolean(
    Object.prototype.hasOwnProperty.call(body, 'protest') ? body.protest : existing?.protest
  );

  const rawInstallments = Array.isArray(body.installmentsData) ? body.installmentsData : [];
  const detailsMap = new Map();
  const overrideBankIds = new Set();

  rawInstallments.forEach((item) => {
    const number = Number.parseInt(item?.number, 10);
    if (!Number.isFinite(number) || number < 1 || number > installmentsCount) return;
    const dueOverride = parseDate(item?.dueDate || item?.due);
    const bankOverride = normalizeString(item?.bankAccount || item?.bank);
    if (bankOverride && mongoose.Types.ObjectId.isValid(bankOverride)) {
      overrideBankIds.add(bankOverride);
    }
    detailsMap.set(number, {
      dueDate: dueOverride || null,
      bankAccount: bankOverride || null,
    });
  });

  if (overrideBankIds.size > 0) {
    const overrideList = Array.from(overrideBankIds);
    const validBanks = await BankAccount.find({
      _id: { $in: overrideList },
      company,
    }).select('_id');
    const validSet = new Set(validBanks.map((account) => String(account._id)));
    overrideList.forEach((id) => {
      if (!validSet.has(id)) {
        throw Object.assign(
          new Error('Conta corrente informada em uma das parcelas não foi encontrada.'),
          { status: 404 }
        );
      }
    });
  }

  const centsTotal = Math.round(totalValue * 100);
  const baseCents = Math.floor(centsTotal / installmentsCount);
  const remainder = centsTotal - baseCents * installmentsCount;

  const installments = [];
  for (let index = 0; index < installmentsCount; index += 1) {
    const amountCents = baseCents + (index < remainder ? 1 : 0);
    const value = amountCents / 100;
    const baseDueDate = addMonths(dueDate, index);
    const override = detailsMap.get(index + 1) || {};
    installments.push({
      number: index + 1,
      issueDate,
      dueDate: override.dueDate || baseDueDate,
      value,
      originalValue: value,
      paidValue: 0,
      paidDate: null,
      bankAccount: override.bankAccount || bankAccountId,
      accountingAccount: accountingAccountId,
      paymentMethod: paymentMethodId || undefined,
      paymentDocument: '',
      paymentNotes: '',
      residualValue: 0,
      residualDueDate: null,
      originInstallmentNumber: undefined,
    });
  }

  const providedCode = normalizeString(body.code);
  const code = providedCode || existing?.code || (await generateSequentialCode());

  return {
    code,
    company,
    customer,
    installmentsCount: installments.length,
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
      const { company, customer, party } = req.query;
      const filter = {};
      if (company && mongoose.Types.ObjectId.isValid(company)) {
        filter.company = company;
      }
      const customerParam = normalizeString(customer || party);
      if (customerParam && mongoose.Types.ObjectId.isValid(customerParam)) {
        filter.customer = customerParam;
      }

      const receivables = await AccountReceivable.find(filter)
        .sort({ createdAt: -1 })
        .populate(RECEIVABLE_POPULATE);

      const payload = receivables.map((item) => buildPublicReceivable(item));
      const summary = summarizeReceivables(payload);

      res.json({ receivables: payload, summary });
    } catch (error) {
      console.error('Erro ao listar contas a receber:', error);
      res.status(500).json({ message: 'Erro ao listar contas a receber.' });
    }
  }
);

router.get(
  '/:id',
  requireAuth,
  authorizeRoles(...AUTH_ROLES),
  async (req, res) => {
    try {
      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ message: 'Identificador inválido.' });
      }

      const receivable = await AccountReceivable.findById(id).populate(RECEIVABLE_POPULATE);
      if (!receivable) {
        return res.status(404).json({ message: 'Conta a receber não encontrada.' });
      }

      res.json(buildPublicReceivable(receivable));
    } catch (error) {
      console.error('Erro ao carregar conta a receber:', error);
      res.status(500).json({ message: 'Erro ao carregar a conta a receber.' });
    }
  }
);

router.put(
  '/:id',
  requireAuth,
  authorizeRoles(...AUTH_ROLES),
  async (req, res) => {
    try {
      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ message: 'Identificador inválido.' });
      }

      const existing = await AccountReceivable.findById(id);
      if (!existing) {
        return res.status(404).json({ message: 'Conta a receber não encontrada.' });
      }

      const payload = await assembleReceivablePayload(req.body, { existing });
      if (payload.code && payload.code !== existing.code) {
        const duplicate = await AccountReceivable.findOne({ code: payload.code, _id: { $ne: id } }).lean();
        if (duplicate) {
          return res.status(409).json({ message: 'Já existe um lançamento com o código informado.' });
        }
      }

      const shouldUnsetPaymentMethod =
        Object.prototype.hasOwnProperty.call(req.body, 'paymentMethod') &&
        !normalizeString(req.body.paymentMethod);

      const setPayload = { ...payload };
      if (shouldUnsetPaymentMethod) {
        delete setPayload.paymentMethod;
      }

      Object.keys(setPayload).forEach((key) => {
        if (setPayload[key] === undefined) {
          delete setPayload[key];
        }
      });

      const updateQuery = shouldUnsetPaymentMethod
        ? { $set: setPayload, $unset: { paymentMethod: 1 } }
        : { $set: setPayload };

      const updated = await AccountReceivable.findByIdAndUpdate(id, updateQuery, {
        new: true,
        runValidators: true,
      });

      if (!updated) {
        return res.status(404).json({ message: 'Conta a receber não encontrada.' });
      }

      await updated.populate(RECEIVABLE_POPULATE);
      res.json(buildPublicReceivable(updated));
    } catch (error) {
      if (error?.status) {
        return res.status(error.status).json({ message: error.message });
      }
      if (error?.code === 11000) {
        return res.status(409).json({ message: 'Já existe um lançamento com o código informado.' });
      }
      console.error('Erro ao atualizar conta a receber:', error);
      res.status(500).json({ message: 'Erro ao atualizar a conta a receber.' });
    }
  }
);

router.delete(
  '/:id',
  requireAuth,
  authorizeRoles(...AUTH_ROLES),
  async (req, res) => {
    try {
      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ message: 'Identificador inválido.' });
      }

      const installmentParam = normalizeString(req.query.installmentNumber);
      const installmentNumber = installmentParam ? Number.parseInt(installmentParam, 10) : null;

      const receivable = await AccountReceivable.findById(id);
      if (!receivable) {
        return res.status(404).json({ message: 'Conta a receber não encontrada.' });
      }

      const installmentsArray = Array.isArray(receivable.installments) ? receivable.installments : [];

      if (installmentNumber && installmentsArray.length > 1) {
        const filtered = installmentsArray.filter((installment) => installment.number !== installmentNumber);
        if (filtered.length === installmentsArray.length) {
          return res.status(404).json({ message: 'Parcela informada não foi encontrada.' });
        }

        receivable.installments = filtered;
        receivable.markModified('installments');
        receivable.installmentsCount = filtered.length;
        receivable.totalValue = formatCurrency(
          filtered.reduce((acc, installment) => acc + Number(installment.value || 0), 0)
        );

        const latestDue = filtered.reduce((latest, installment) => {
          const due = parseDate(installment.dueDate);
          if (!due) return latest;
          if (!latest || due > latest) return due;
          return latest;
        }, null);

        if (latestDue) {
          receivable.dueDate = latestDue;
        }

        await receivable.save();
        await receivable.populate(RECEIVABLE_POPULATE);
        return res.json(buildPublicReceivable(receivable));
      }

      await receivable.deleteOne();
      return res.status(204).send();
    } catch (error) {
      console.error('Erro ao excluir conta a receber:', error);
      res.status(500).json({ message: 'Erro ao excluir a conta a receber.' });
    }
  }
);

router.post(
  '/:id/payments',
  requireAuth,
  authorizeRoles(...AUTH_ROLES),
  async (req, res) => {
    try {
      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ message: 'Identificador inválido.' });
      }

      const installmentParam =
        req.body?.installmentNumber ?? req.body?.installment ?? req.body?.parcel ?? null;
      const installmentNumber = installmentParam ? Number.parseInt(installmentParam, 10) : null;
      if (!Number.isFinite(installmentNumber) || installmentNumber < 1) {
        return res.status(400).json({ message: 'Informe a parcela que está sendo quitada.' });
      }

      const paymentDate = parseDate(req.body?.paymentDate || req.body?.date);
      if (!paymentDate) {
        return res.status(400).json({ message: 'Informe uma data de pagamento válida.' });
      }

      const paidValue = formatCurrency(
        parseLocaleNumber(req.body?.paidValue ?? req.body?.value ?? req.body?.amount ?? 0, 0)
      );
      if (!(paidValue > 0)) {
        return res.status(400).json({ message: 'Informe um valor pago maior que zero.' });
      }

      const residualProvided = formatCurrency(
        parseLocaleNumber(req.body?.residualValue ?? req.body?.residual ?? 0, 0)
      );
      const residualDueRaw = req.body?.residualDueDate || req.body?.residualDue || null;
      const paymentDocument = normalizeString(req.body?.paymentDocument || req.body?.documento);
      const paymentNotes = normalizeString(req.body?.notes || req.body?.paymentNotes);

      const receivable = await AccountReceivable.findById(id);
      if (!receivable) {
        return res.status(404).json({ message: 'Conta a receber não encontrada.' });
      }

      const installmentsArray = Array.isArray(receivable.installments)
        ? receivable.installments
        : [];
      const targetInstallment = installmentsArray.find(
        (installment) => Number(installment.number) === Number(installmentNumber)
      );

      if (!targetInstallment) {
        return res.status(404).json({ message: 'Parcela informada não foi encontrada.' });
      }

      const originalValue = formatCurrency(
        targetInstallment.originalValue || targetInstallment.value || 0
      );
      if (!(originalValue > 0)) {
        return res
          .status(400)
          .json({ message: 'Parcela selecionada não possui valor válido para pagamento.' });
      }

      if (paidValue - originalValue > RESIDUAL_THRESHOLD) {
        return res
          .status(400)
          .json({ message: 'O valor pago não pode ser maior que o valor da parcela.' });
      }

      const companyId = String(receivable.company);

      const bankAccountParam =
        normalizeString(req.body?.bankAccount || req.body?.bankAccountId) || '';
      const finalBankAccount =
        bankAccountParam
        || (targetInstallment.bankAccount ? String(targetInstallment.bankAccount) : '');
      if (!finalBankAccount || !mongoose.Types.ObjectId.isValid(finalBankAccount)) {
        return res.status(400).json({ message: 'Selecione a conta corrente do recebimento.' });
      }

      const bankAccountExists = await BankAccount.exists({
        _id: finalBankAccount,
        company: companyId,
      });
      if (!bankAccountExists) {
        return res.status(404).json({ message: 'Conta corrente informada não foi encontrada.' });
      }

      let finalPaymentMethod = normalizeString(
        req.body?.paymentMethod || req.body?.paymentMethodId
      );
      if (!finalPaymentMethod && targetInstallment.paymentMethod) {
        finalPaymentMethod = String(targetInstallment.paymentMethod);
      }
      if (!finalPaymentMethod && receivable.paymentMethod) {
        finalPaymentMethod = String(receivable.paymentMethod);
      }

      let paymentMethodDoc = null;
      if (finalPaymentMethod) {
        if (!mongoose.Types.ObjectId.isValid(finalPaymentMethod)) {
          return res.status(400).json({ message: 'Meio de pagamento informado é inválido.' });
        }
        paymentMethodDoc = await PaymentMethod.findOne({
          _id: finalPaymentMethod,
          company: companyId,
        }).select('type name');
        if (!paymentMethodDoc) {
          return res
            .status(404)
            .json({ message: 'Meio de pagamento informado não foi encontrado.' });
        }
        if ((paymentMethodDoc.type || '').toLowerCase() === 'crediario') {
          return res
            .status(400)
            .json({ message: 'Não é permitido utilizar um meio de pagamento do tipo crediário.' });
        }
      }

      const missingValue = formatCurrency(originalValue - paidValue);

      let residualValue = residualProvided;
      if (missingValue > RESIDUAL_THRESHOLD && residualValue <= RESIDUAL_THRESHOLD) {
        residualValue = missingValue;
      }

      const hasResidual = residualValue > RESIDUAL_THRESHOLD;
      const residualDueDate = hasResidual ? parseDate(residualDueRaw) : null;

      if (hasResidual && !residualDueDate) {
        return res
          .status(400)
          .json({ message: 'Informe uma data de vencimento válida para o resíduo.' });
      }

      if (hasResidual && Math.abs(residualValue - missingValue) > RESIDUAL_THRESHOLD) {
        return res
          .status(400)
          .json({ message: 'O valor do resíduo deve corresponder ao saldo da parcela.' });
      }

      if (!hasResidual && missingValue > RESIDUAL_THRESHOLD) {
        return res
          .status(400)
          .json({ message: 'O valor informado não quita a parcela. Cadastre o resíduo.' });
      }

      const accountingAccountId = targetInstallment.accountingAccount
        ? String(targetInstallment.accountingAccount)
        : receivable.accountingAccount
        ? String(receivable.accountingAccount)
        : null;
      if (!accountingAccountId) {
        return res
          .status(400)
          .json({ message: 'Conta contábil vinculada à parcela não foi encontrada.' });
      }

      targetInstallment.originalValue = originalValue;
      targetInstallment.value = formatCurrency(paidValue);
      targetInstallment.paidValue = formatCurrency(paidValue);
      targetInstallment.paidDate = paymentDate;
      targetInstallment.bankAccount = finalBankAccount;
      if (finalPaymentMethod) {
        targetInstallment.paymentMethod = finalPaymentMethod;
      } else {
        targetInstallment.paymentMethod = undefined;
      }
      targetInstallment.paymentDocument = paymentDocument;
      targetInstallment.paymentNotes = paymentNotes;
      targetInstallment.residualValue = hasResidual ? residualValue : 0;
      if (hasResidual) {
        targetInstallment.residualDueDate = residualDueDate;
      } else {
        targetInstallment.residualDueDate = undefined;
      }
      targetInstallment.status = 'received';

      if (hasResidual) {
        const maxNumber = installmentsArray.reduce(
          (acc, installment) => Math.max(acc, Number(installment.number) || 0),
          0
        );
        installmentsArray.push({
          number: maxNumber + 1,
          issueDate: paymentDate,
          dueDate: residualDueDate,
          value: residualValue,
          originalValue: residualValue,
          paidValue: 0,
          paidDate: null,
          bankAccount: finalBankAccount,
          accountingAccount: accountingAccountId,
          paymentMethod: finalPaymentMethod || undefined,
          paymentDocument: '',
          paymentNotes: '',
          residualValue: 0,
          residualDueDate: null,
          originInstallmentNumber: targetInstallment.number || installmentNumber,
          status: 'pending',
        });
      }

      receivable.markModified('installments');
      recalculateReceivable(receivable);
      await receivable.save();
      await receivable.populate(RECEIVABLE_POPULATE);

      return res.json(buildPublicReceivable(receivable));
    } catch (error) {
      if (error?.status) {
        return res.status(error.status).json({ message: error.message });
      }
      console.error('Erro ao registrar pagamento de conta a receber:', error);
      return res.status(500).json({ message: 'Erro ao registrar o pagamento da conta a receber.' });
    }
  }
);

router.post(
  '/',
  requireAuth,
  authorizeRoles(...AUTH_ROLES),
  async (req, res) => {
    try {
      const payload = await assembleReceivablePayload(req.body);
      const created = await AccountReceivable.create(payload);
      await created.populate(RECEIVABLE_POPULATE);
      res.status(201).json(buildPublicReceivable(created));
    } catch (error) {
      if (error?.status) {
        return res.status(error.status).json({ message: error.message });
      }
      if (error?.code === 11000) {
        return res.status(409).json({ message: 'Já existe um lançamento com o código informado.' });
      }
      console.error('Erro ao criar conta a receber:', error);
      res.status(500).json({ message: 'Erro ao criar conta a receber.' });
    }
  }
);

module.exports = router;
