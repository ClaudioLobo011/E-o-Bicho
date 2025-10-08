const express = require('express');
const mongoose = require('mongoose');

const router = express.Router();

const AccountPayable = require('../models/AccountPayable');
const Store = require('../models/Store');
const Supplier = require('../models/Supplier');
const User = require('../models/User');
const BankAccount = require('../models/BankAccount');
const AccountingAccount = require('../models/AccountingAccount');
const PaymentMethod = require('../models/PaymentMethod');
const requireAuth = require('../middlewares/requireAuth');
const authorizeRoles = require('../middlewares/authorizeRoles');

const AUTH_ROLES = ['admin', 'admin_master', 'funcionario'];

const normalizeString = (value) => {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
};

const normalizeLower = (value) => normalizeString(value).toLowerCase();

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

const PENDING_STATUS_KEYS = new Set([
  'pending',
  'pendente',
  'pendentes',
  'open',
  'em aberto',
  'aberto',
  'aguardando pagamento',
  'aguardando',
  'overdue',
  'vencido',
  'vencida',
  'em atraso',
  'atrasado',
  'atrasada',
]);

const PAID_STATUS_KEYS = new Set([
  'paid',
  'pago',
  'paga',
  'quitado',
  'quitada',
  'liquidado',
  'liquidada',
  'finalizado',
  'finalizada',
  'concluido',
  'concluida',
]);

const PROTEST_STATUS_KEYS = new Set([
  'protest',
  'protesto',
  'protestado',
  'protestada',
  'em protesto',
]);

const CANCELLED_STATUS_KEYS = new Set([
  'cancelled',
  'cancel',
  'cancelar',
  'cancelado',
  'cancelada',
  'cancelamento',
  'anulado',
  'anulada',
]);

function canonicalInstallmentStatus(value) {
  const token = normalizeStatusToken(value);
  if (!token) return 'pending';
  if (PAID_STATUS_KEYS.has(token)) return 'paid';
  if (PROTEST_STATUS_KEYS.has(token)) return 'protest';
  if (CANCELLED_STATUS_KEYS.has(token)) return 'cancelled';
  return 'pending';
}

const parseLocaleNumber = (value, fallback = 0) => {
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
};

const parseDate = (value) => {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const normalized = normalizeString(value);
  if (!normalized) return null;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const formatCurrency = (value) => Math.round(Number(value || 0) * 100) / 100;

const clampAgendaRange = (value) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 7;
  return Math.min(parsed, 90);
};

const derivePayableStatus = (installments = []) => {
  const entries = Array.isArray(installments) ? installments : [];
  if (!entries.length) {
    return 'pending';
  }

  let hasPending = false;
  let hasPaid = false;
  let hasCancelled = false;
  let hasProtest = false;

  entries.forEach((installment) => {
    const status = canonicalInstallmentStatus(installment?.status);
    if (status === 'paid') {
      hasPaid = true;
    } else if (status === 'protest') {
      hasProtest = true;
    } else if (status === 'cancelled') {
      hasCancelled = true;
    } else {
      hasPending = true;
    }
  });

  if (hasPending) {
    return 'pending';
  }
  if (hasProtest) {
    return 'protest';
  }
  if (hasPaid && !hasPending && !hasCancelled) {
    return 'paid';
  }
  if (hasCancelled && !hasPending && !hasPaid) {
    return 'cancelled';
  }
  if (hasPaid && hasCancelled && !hasPending) {
    return 'paid';
  }
  return 'pending';
};

const createHttpError = (status, message) => {
  const error = new Error(message);
  error.status = status;
  return error;
};

const extractObjectId = (value) => {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (value instanceof mongoose.Types.ObjectId) return value.toHexString();
  if (value._id) return extractObjectId(value._id);
  return null;
};

const PAYABLE_POPULATE = [
  { path: 'company', select: 'nome nomeFantasia razaoSocial cnpj' },
  { path: 'party' },
  { path: 'bankAccount', select: 'alias bankName bankCode agency accountNumber accountDigit' },
  { path: 'accountingAccount', select: 'name code' },
  { path: 'paymentMethod', select: 'name type' },
  {
    path: 'installments.bankAccount',
    select: 'alias bankName bankCode agency accountNumber accountDigit',
  },
  { path: 'installments.accountingAccount', select: 'name code' },
];

async function assemblePayablePayload(body, { existing } = {}) {
  const companyId = normalizeString(body.company);
  if (!companyId || !mongoose.Types.ObjectId.isValid(companyId)) {
    throw createHttpError(400, 'Selecione a empresa responsável pelo pagamento.');
  }

  const companyExists = await Store.exists({ _id: companyId });
  if (!companyExists) {
    throw createHttpError(404, 'Empresa informada não foi encontrada.');
  }

  const partyId = normalizeString(body.party);
  const partyTypeRaw = normalizeString(body.partyType);
  const resolvedPartyType = resolvePartyType(partyTypeRaw);

  if (!partyId || !mongoose.Types.ObjectId.isValid(partyId) || !resolvedPartyType) {
    throw createHttpError(400, 'Selecione um cliente ou fornecedor válido.');
  }

  const partyExists =
    resolvedPartyType === 'User'
      ? await User.exists({ _id: partyId })
      : await Supplier.exists({ _id: partyId });

  if (!partyExists) {
    throw createHttpError(404, 'Cliente ou fornecedor informado não foi encontrado.');
  }

  const bankAccountId = normalizeString(body.bankAccount);
  if (!bankAccountId || !mongoose.Types.ObjectId.isValid(bankAccountId)) {
    throw createHttpError(400, 'Selecione a conta corrente para o pagamento.');
  }

  const bankAccount = await BankAccount.findOne({ _id: bankAccountId, company: companyId });
  if (!bankAccount) {
    throw createHttpError(404, 'Conta corrente informada não pertence à empresa selecionada.');
  }

  const accountingAccountId = normalizeString(body.accountingAccount);
  if (!accountingAccountId || !mongoose.Types.ObjectId.isValid(accountingAccountId)) {
    throw createHttpError(400, 'Selecione a conta contábil para o pagamento.');
  }

  const accountingAccount = await AccountingAccount.findOne({
    _id: accountingAccountId,
    companies: companyId,
    paymentNature: 'contas_pagar',
  });

  if (!accountingAccount) {
    throw createHttpError(
      404,
      'Conta contábil informada não pertence à empresa ou não é de contas a pagar.'
    );
  }

  const paymentMethodId = normalizeString(body.paymentMethod);
  let paymentMethod = null;
  if (paymentMethodId) {
    if (!mongoose.Types.ObjectId.isValid(paymentMethodId)) {
      throw createHttpError(400, 'Meio de pagamento inválido.');
    }
    paymentMethod = await PaymentMethod.findOne({ _id: paymentMethodId, company: companyId });
    if (!paymentMethod) {
      throw createHttpError(
        404,
        'Meio de pagamento informado não pertence à empresa selecionada.'
      );
    }
  }

  const issueDate = parseDate(body.issueDate);
  if (!issueDate) {
    throw createHttpError(400, 'Informe a data de emissão do título.');
  }

  const dueDate = parseDate(body.dueDate);
  if (!dueDate) {
    throw createHttpError(400, 'Informe a data de vencimento do título.');
  }

  const bankDocumentNumber = normalizeString(body.bankDocumentNumber);
  const carrier = normalizeString(body.carrier);
  const notes = normalizeString(body.notes);

  const interestFeeValue = formatCurrency(
    parseLocaleNumber(body.interestFeeValue || body.interestFee, 0)
  );
  const monthlyInterestPercent = formatCurrency(
    parseLocaleNumber(body.monthlyInterestPercent || body.monthlyInterest, 0)
  );
  const interestPercent = formatCurrency(parseLocaleNumber(body.interestPercent, 0));

  const installmentsRaw = Array.isArray(body.installments) ? body.installments : [];
  if (!installmentsRaw.length) {
    throw createHttpError(400, 'Informe ao menos uma parcela para o título.');
  }

  const installments = [];
  let installmentsTotal = 0;

  for (let index = 0; index < installmentsRaw.length; index += 1) {
    const entry = installmentsRaw[index];
    const number = Number.parseInt(entry.number ?? index + 1, 10);
    const installmentIssue = parseDate(entry.issueDate) || issueDate;
    const installmentDue = parseDate(entry.dueDate);
    const value = formatCurrency(parseLocaleNumber(entry.value, 0));
    const installmentBankAccountId =
      normalizeString(entry.bankAccount) || extractObjectId(entry.bankAccount) || bankAccountId;
    const installmentAccountingAccountId =
      normalizeString(entry.accountingAccount) ||
      extractObjectId(entry.accountingAccount) ||
      accountingAccountId;

    if (!number || number <= 0) {
      throw createHttpError(400, `Número da parcela inválido (parcela ${index + 1}).`);
    }
    if (!installmentDue) {
      throw createHttpError(400, `Informe a data de vencimento da parcela ${index + 1}.`);
    }
    if (!(value > 0)) {
      throw createHttpError(400, `Informe o valor da parcela ${index + 1}.`);
    }
    if (!mongoose.Types.ObjectId.isValid(installmentBankAccountId)) {
      throw createHttpError(400, `Conta corrente inválida na parcela ${index + 1}.`);
    }
    if (!mongoose.Types.ObjectId.isValid(installmentAccountingAccountId)) {
      throw createHttpError(400, `Conta contábil inválida na parcela ${index + 1}.`);
    }

    const [installmentBankAccount, installmentAccountingAccount] = await Promise.all([
      BankAccount.findOne({ _id: installmentBankAccountId, company: companyId }),
      AccountingAccount.findOne({
        _id: installmentAccountingAccountId,
        companies: companyId,
        paymentNature: 'contas_pagar',
      }),
    ]);

    if (!installmentBankAccount) {
      throw createHttpError(
        404,
        `Conta corrente da parcela ${index + 1} não pertence à empresa selecionada.`
      );
    }

    if (!installmentAccountingAccount) {
      throw createHttpError(
        404,
        `Conta contábil da parcela ${index + 1} não pertence à empresa ou não é de contas a pagar.`
      );
    }

    const status = canonicalInstallmentStatus(entry.status);

    installmentsTotal += value;
    installments.push({
      number,
      issueDate: installmentIssue,
      dueDate: installmentDue,
      value,
      bankAccount: installmentBankAccountId,
      accountingAccount: installmentAccountingAccountId,
      status,
    });
  }

  const totalValueRaw = parseLocaleNumber(body.totalValue, 0);
  const totalValue = formatCurrency(totalValueRaw || installmentsTotal);

  if (totalValue <= 0) {
    throw createHttpError(400, 'Informe o valor total do título.');
  }

  if (Math.abs(totalValue - installmentsTotal) > 0.01) {
    throw createHttpError(
      400,
      'O valor total precisa ser igual à soma das parcelas informadas.'
    );
  }

  let code = normalizeString(body.code);
  if (!code) {
    code = existing?.code || (await generateSequentialCode());
  }

  return {
    code,
    company: companyId,
    partyType: resolvedPartyType,
    party: partyId,
    installmentsCount: installments.length,
    issueDate,
    dueDate,
    totalValue,
    bankAccount: bankAccountId,
    accountingAccount: accountingAccountId,
    paymentMethod: paymentMethod ? paymentMethod._id : undefined,
    carrier,
    bankDocumentNumber,
    interestFeeValue,
    monthlyInterestPercent,
    interestPercent,
    notes,
    installments,
  };
}
async function generateSequentialCode() {
  const now = new Date();
  const year = now.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const count = await AccountPayable.countDocuments({ createdAt: { $gte: yearStart } });
  const sequential = String(count + 1).padStart(5, '0');
  return `CP-${year}-${sequential}`;
}

const buildCompanyName = (company) => {
  if (!company) return '';
  const plain = typeof company.toObject === 'function' ? company.toObject() : company;
  return plain.nomeFantasia || plain.nome || plain.razaoSocial || 'Empresa';
};

const buildPartyName = (party) => {
  if (!party) return '';
  const plain = typeof party.toObject === 'function' ? party.toObject() : party;
  return (
    plain.nomeCompleto ||
    plain.razaoSocial ||
    plain.legalName ||
    plain.fantasyName ||
    plain.email ||
    'Sem identificação'
  );
};

const buildPartyDocument = (party) => {
  if (!party) return null;
  const plain = typeof party.toObject === 'function' ? party.toObject() : party;
  return plain.cnpj || plain.cpf || plain.documento || null;
};

const buildBankLabel = (account) => {
  if (!account) return '';
  const plain = typeof account.toObject === 'function' ? account.toObject() : account;
  const alias = plain.alias ? `${plain.alias}` : '';
  const bank = plain.bankName || plain.bankCode || '';
  const accountNumber = [plain.accountNumber, plain.accountDigit].filter(Boolean).join('-');
  const agency = plain.agency ? `Ag. ${plain.agency}` : '';
  const doc = [bank, agency, accountNumber].filter(Boolean).join(' ');
  if (alias && doc) return `${alias} (${doc})`;
  return alias || doc || 'Conta bancária';
};

const buildAccountingLabel = (account) => {
  if (!account) return '';
  const plain = typeof account.toObject === 'function' ? account.toObject() : account;
  return [plain.code, plain.name].filter(Boolean).join(' - ') || 'Conta contábil';
};

const buildInstallmentPayload = (installment) => {
  if (!installment) return null;
  const plain = typeof installment.toObject === 'function' ? installment.toObject() : installment;
  return {
    number: plain.number,
    issueDate: plain.issueDate,
    dueDate: plain.dueDate,
    value: formatCurrency(plain.value),
    bankAccount: plain.bankAccount
      ? { _id: plain.bankAccount._id, label: buildBankLabel(plain.bankAccount) }
      : null,
    accountingAccount: plain.accountingAccount
      ? { _id: plain.accountingAccount._id, label: buildAccountingLabel(plain.accountingAccount) }
      : null,
    status: canonicalInstallmentStatus(plain.status),
  };
};

const buildPublicPayable = (payable) => {
  if (!payable) return null;
  const plain =
    typeof payable.toObject === 'function' ? payable.toObject({ virtuals: true }) : payable;

  return {
    _id: plain._id,
    code: plain.code,
    company: plain.company
      ? { _id: plain.company._id, name: buildCompanyName(plain.company) }
      : null,
    party: plain.party
      ? { _id: plain.party._id, name: buildPartyName(plain.party), document: buildPartyDocument(plain.party) }
      : null,
    partyType: plain.partyType,
    installmentsCount: plain.installmentsCount,
    issueDate: plain.issueDate,
    dueDate: plain.dueDate,
    totalValue: formatCurrency(plain.totalValue),
    bankAccount: plain.bankAccount
      ? { _id: plain.bankAccount._id, label: buildBankLabel(plain.bankAccount) }
      : null,
    accountingAccount: plain.accountingAccount
      ? { _id: plain.accountingAccount._id, label: buildAccountingLabel(plain.accountingAccount) }
      : null,
    paymentMethod: plain.paymentMethod
      ? { _id: plain.paymentMethod._id, name: plain.paymentMethod.name }
      : null,
    carrier: plain.carrier || '',
    bankDocumentNumber: plain.bankDocumentNumber || '',
    interestFeeValue: formatCurrency(plain.interestFeeValue),
    monthlyInterestPercent: formatCurrency(plain.monthlyInterestPercent),
    interestPercent: formatCurrency(plain.interestPercent),
    installments: Array.isArray(plain.installments)
      ? plain.installments.map(buildInstallmentPayload).filter(Boolean)
      : [],
    status: derivePayableStatus(plain.installments),
    createdAt: plain.createdAt,
    updatedAt: plain.updatedAt,
  };
};

const resolvePartyType = (value) => {
  const normalized = normalizeLower(value);
  if (normalized === 'user' || normalized === 'cliente' || normalized === 'cliente/fornecedor') {
    return 'User';
  }
  if (normalized === 'supplier' || normalized === 'fornecedor') {
    return 'Supplier';
  }
  if (value === 'User' || value === 'Supplier') return value;
  return null;
};

router.get(
  '/options',
  requireAuth,
  authorizeRoles(...AUTH_ROLES),
  async (req, res) => {
    try {
      const { company } = req.query;

      if (company && mongoose.Types.ObjectId.isValid(company)) {
        const [bankAccounts, accountingAccounts, paymentMethods] = await Promise.all([
          BankAccount.find({ company })
            .sort({ alias: 1, bankName: 1 })
            .populate('company', 'nome nomeFantasia razaoSocial'),
          AccountingAccount.find({ companies: company, paymentNature: 'contas_pagar' }).sort({
            code: 1,
            name: 1,
          }),
          PaymentMethod.find({ company }).sort({ name: 1 }),
        ]);

        return res.json({
          bankAccounts: bankAccounts.map((account) => ({
            _id: account._id,
            label: buildBankLabel(account),
          })),
          accountingAccounts: accountingAccounts.map((account) => ({
            _id: account._id,
            label: buildAccountingLabel(account),
          })),
          paymentMethods: paymentMethods.map((method) => ({
            _id: method._id,
            name: method.name,
            type: method.type,
          })),
        });
      }

      const companies = await Store.find({}, 'nome nomeFantasia razaoSocial cnpj')
        .sort({ nomeFantasia: 1, nome: 1 });

      res.json({
        companies: companies.map((companyDoc) => ({
          _id: companyDoc._id,
          name: buildCompanyName(companyDoc),
          document: companyDoc.cnpj || null,
        })),
      });
    } catch (error) {
      console.error('Erro ao carregar opções de contas a pagar:', error);
      res.status(500).json({ message: 'Erro ao carregar opções para o formulário.' });
    }
  }
);

router.get(
  '/parties',
  requireAuth,
  authorizeRoles(...AUTH_ROLES),
  async (req, res) => {
    try {
      const query = normalizeString(req.query.query);
      if (!query) {
        return res.json({ parties: [] });
      }

      const regex = new RegExp(query.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'), 'i');
      const digits = query.replace(/\D+/g, '');

      const [users, suppliers] = await Promise.all([
        User.find(
          {
            $or: [
              { nomeCompleto: regex },
              { razaoSocial: regex },
              { email: regex },
              { celular: regex },
              digits ? { cpf: new RegExp(digits) } : null,
              digits ? { cnpj: new RegExp(digits) } : null,
            ].filter(Boolean),
          },
          'nomeCompleto razaoSocial email celular cpf cnpj'
        )
          .sort({ nomeCompleto: 1, razaoSocial: 1 })
          .limit(10),
        Supplier.find(
          {
            $or: [
              { legalName: regex },
              { fantasyName: regex },
              { 'contact.email': regex },
              { 'contact.mobile': regex },
              { 'contact.phone': regex },
              digits ? { cnpj: new RegExp(digits) } : null,
            ].filter(Boolean),
          },
          {
            legalName: 1,
            fantasyName: 1,
            cnpj: 1,
            'contact.email': 1,
            'contact.mobile': 1,
            'contact.phone': 1,
          }
        )
          .sort({ legalName: 1, fantasyName: 1 })
          .limit(10),
      ]);

      const parties = [
        ...users.map((user) => ({
          _id: user._id,
          type: 'User',
          label: buildPartyName(user),
          document: user.cpf || user.cnpj || null,
          email: user.email || null,
          mobile: user.celular || null,
        })),
        ...suppliers.map((supplier) => ({
          _id: supplier._id,
          type: 'Supplier',
          label: buildPartyName(supplier),
          document: supplier.cnpj || null,
          email: supplier.contact?.email || null,
          mobile: supplier.contact?.mobile || supplier.contact?.phone || null,
        })),
      ];

      parties.sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));

      res.json({ parties });
    } catch (error) {
      console.error('Erro ao buscar clientes/fornecedores:', error);
      res.status(500).json({ message: 'Erro ao buscar clientes ou fornecedores.' });
    }
  }
);

router.get(
  '/agenda',
  requireAuth,
  authorizeRoles(...AUTH_ROLES),
  async (req, res) => {
    try {
      const rangeDays = clampAgendaRange(req.query.range);
      const match = {};
      const { company } = req.query;

      if (company && mongoose.Types.ObjectId.isValid(company)) {
        match.company = company;
      }

      const now = new Date();
      const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      const periodEndExclusive = new Date(periodStart);
      periodEndExclusive.setUTCDate(periodEndExclusive.getUTCDate() + rangeDays);

      const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const monthEndExclusive = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

      const [upcomingDocs, pendingDocs, paidDocs] = await Promise.all([
        AccountPayable.find({
          ...match,
          'installments.dueDate': { $gte: periodStart, $lt: periodEndExclusive },
        })
          .select('code party partyType bankDocumentNumber installments')
          .populate('party', 'nomeCompleto razaoSocial legalName fantasyName email'),
        AccountPayable.find({
          ...match,
          'installments.status': 'pending',
        }).select('installments'),
        AccountPayable.find({
          ...match,
          'installments.status': 'paid',
          'installments.dueDate': { $gte: monthStart, $lt: monthEndExclusive },
        }).select('installments'),
      ]);

      const agendaItems = [];
      let upcomingTotal = 0;
      let upcomingCount = 0;

      upcomingDocs.forEach((doc) => {
        const plain = typeof doc.toObject === 'function' ? doc.toObject({ virtuals: true }) : doc;
        const partyName = buildPartyName(plain.party);
        const documentNumber = plain.bankDocumentNumber || '';
        const payableCode = plain.code || '';
        (plain.installments || []).forEach((installment) => {
          if (!installment || !installment.dueDate) return;
          const dueDate = new Date(installment.dueDate);
          if (Number.isNaN(dueDate.getTime())) return;
          if (dueDate < periodStart || dueDate >= periodEndExclusive) return;
          const rawValue = Number(installment.value || 0);
          const canonicalStatus = canonicalInstallmentStatus(installment.status);
          upcomingTotal += rawValue;
          upcomingCount += 1;
          agendaItems.push({
            payableId: plain._id,
            installmentNumber: installment.number || null,
            partyName,
            document: documentNumber,
            payableCode,
            dueDate,
            value: formatCurrency(rawValue),
            status: canonicalStatus,
          });
        });
      });

      agendaItems.sort((a, b) => {
        const aTime = a.dueDate instanceof Date ? a.dueDate.getTime() : 0;
        const bTime = b.dueDate instanceof Date ? b.dueDate.getTime() : 0;
        if (aTime !== bTime) return aTime - bTime;
        return (a.installmentNumber || 0) - (b.installmentNumber || 0);
      });

      let pendingTotal = 0;
      let pendingCount = 0;
      pendingDocs.forEach((doc) => {
        const plain = typeof doc.toObject === 'function' ? doc.toObject() : doc;
        (plain.installments || []).forEach((installment) => {
          const canonicalStatus = canonicalInstallmentStatus(installment?.status);
          if (canonicalStatus !== 'pending') return;
          pendingTotal += Number(installment.value || 0);
          pendingCount += 1;
        });
      });

      let paidTotal = 0;
      let paidCount = 0;
      paidDocs.forEach((doc) => {
        const plain = typeof doc.toObject === 'function' ? doc.toObject() : doc;
        (plain.installments || []).forEach((installment) => {
          const canonicalStatus = canonicalInstallmentStatus(installment?.status);
          if (!installment || canonicalStatus !== 'paid' || !installment.dueDate) return;
          const dueDate = new Date(installment.dueDate);
          if (Number.isNaN(dueDate.getTime())) return;
          if (dueDate < monthStart || dueDate >= monthEndExclusive) return;
          paidTotal += Number(installment.value || 0);
          paidCount += 1;
        });
      });

      const inclusiveEnd = new Date(periodEndExclusive);
      inclusiveEnd.setUTCDate(inclusiveEnd.getUTCDate() - 1);

      res.json({
        rangeDays,
        periodStart,
        periodEnd: inclusiveEnd,
        summary: {
          upcoming: {
            totalValue: formatCurrency(upcomingTotal),
            installments: upcomingCount,
          },
          pending: {
            totalValue: formatCurrency(pendingTotal),
            installments: pendingCount,
          },
          paidThisMonth: {
            totalValue: formatCurrency(paidTotal),
            installments: paidCount,
          },
        },
        items: agendaItems,
      });
    } catch (error) {
      console.error('Erro ao carregar agenda de pagamentos:', error);
      res.status(500).json({ message: 'Erro ao carregar a agenda de pagamentos.' });
    }
  }
);

router.get(
  '/',
  requireAuth,
  authorizeRoles(...AUTH_ROLES),
  async (req, res) => {
    try {
      const { company, party, partyType } = req.query;
      const filter = {};

      if (company && mongoose.Types.ObjectId.isValid(company)) {
        filter.company = company;
      }

      if (party && mongoose.Types.ObjectId.isValid(party)) {
        const resolvedType = resolvePartyType(partyType);
        if (!resolvedType) {
          return res.status(400).json({ message: 'Tipo de participante inválido.' });
        }
        filter.party = party;
        filter.partyType = resolvedType;
      }

      const payables = await AccountPayable.find(filter)
        .sort({ createdAt: -1 })
        .populate('company', 'nome nomeFantasia razaoSocial cnpj')
        .populate('party')
        .populate('bankAccount', 'alias bankName bankCode agency accountNumber accountDigit')
        .populate('accountingAccount', 'name code')
        .populate('paymentMethod', 'name type')
        .populate('installments.bankAccount', 'alias bankName bankCode agency accountNumber accountDigit')
        .populate('installments.accountingAccount', 'name code');

      res.json({ payables: payables.map((item) => buildPublicPayable(item)) });
    } catch (error) {
      console.error('Erro ao listar contas a pagar:', error);
      res.status(500).json({ message: 'Erro ao listar contas a pagar.' });
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

      const payable = await AccountPayable.findById(id);
      if (!payable) {
        return res.status(404).json({ message: 'Conta a pagar não encontrada.' });
      }

      await payable.populate(PAYABLE_POPULATE);
      res.json(buildPublicPayable(payable));
    } catch (error) {
      console.error('Erro ao buscar conta a pagar:', error);
      res.status(500).json({ message: 'Erro ao buscar a conta a pagar.' });
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

      const existing = await AccountPayable.findById(id);
      if (!existing) {
        return res.status(404).json({ message: 'Conta a pagar não encontrada.' });
      }

      const payload = await assemblePayablePayload(req.body, { existing });
      if (payload.code && payload.code !== existing.code) {
        const duplicate = await AccountPayable.findOne({ code: payload.code, _id: { $ne: id } }).lean();
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

      const updated = await AccountPayable.findByIdAndUpdate(id, updateQuery, {
        new: true,
        runValidators: true,
      });

      if (!updated) {
        return res.status(404).json({ message: 'Conta a pagar não encontrada.' });
      }

      await updated.populate(PAYABLE_POPULATE);
      res.json(buildPublicPayable(updated));
    } catch (error) {
      if (error?.status) {
        return res.status(error.status).json({ message: error.message });
      }
      if (error?.code === 11000) {
        return res.status(409).json({ message: 'Já existe um lançamento com o código informado.' });
      }
      console.error('Erro ao atualizar conta a pagar:', error);
      res.status(500).json({ message: 'Erro ao atualizar a conta a pagar.' });
    }
  }
);

router.patch(
  '/:id/installments/:installmentNumber/status',
  requireAuth,
  authorizeRoles(...AUTH_ROLES),
  async (req, res) => {
    try {
      const { id, installmentNumber: installmentParam } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ message: 'Identificador inválido.' });
      }

      const installmentNumber = Number.parseInt(installmentParam, 10);
      if (!Number.isFinite(installmentNumber) || installmentNumber < 1) {
        return res.status(400).json({ message: 'Informe a parcela que deseja atualizar.' });
      }

      const rawStatus = normalizeString(
        req.body?.status || req.body?.value || req.body?.statusCode || req.body?.targetStatus
      );
      const token = normalizeStatusToken(rawStatus);

      let targetStatus = null;
      if (!token || PENDING_STATUS_KEYS.has(token)) {
        targetStatus = 'pending';
      } else if (PAID_STATUS_KEYS.has(token)) {
        targetStatus = 'paid';
      } else if (PROTEST_STATUS_KEYS.has(token)) {
        targetStatus = 'protest';
      } else if (CANCELLED_STATUS_KEYS.has(token)) {
        targetStatus = 'cancelled';
      }

      if (!targetStatus) {
        return res.status(400).json({ message: 'Status informado é inválido para atualização.' });
      }

      const payable = await AccountPayable.findById(id);
      if (!payable) {
        return res.status(404).json({ message: 'Conta a pagar não encontrada.' });
      }

      const installmentsArray = Array.isArray(payable.installments)
        ? payable.installments
        : [];
      const targetInstallment = installmentsArray.find(
        (installment) => Number(installment.number) === Number(installmentNumber)
      );

      if (!targetInstallment) {
        return res.status(404).json({ message: 'Parcela informada não foi encontrada.' });
      }

      const currentStatus = canonicalInstallmentStatus(targetInstallment.status);
      if (currentStatus === targetStatus) {
        await payable.populate(PAYABLE_POPULATE);
        return res.json(buildPublicPayable(payable));
      }

      targetInstallment.status = targetStatus;
      payable.markModified('installments');

      await payable.save();
      await payable.populate(PAYABLE_POPULATE);

      return res.json(buildPublicPayable(payable));
    } catch (error) {
      console.error('Erro ao atualizar status da parcela de conta a pagar:', error);
      return res.status(500).json({ message: 'Erro ao atualizar o status da parcela.' });
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

      const payable = await AccountPayable.findById(id);
      if (!payable) {
        return res.status(404).json({ message: 'Conta a pagar não encontrada.' });
      }

      const installmentsArray = Array.isArray(payable.installments) ? payable.installments : [];

      if (installmentNumber && installmentsArray.length > 1) {
        const filtered = installmentsArray.filter((installment) => installment.number !== installmentNumber);
        if (filtered.length === installmentsArray.length) {
          return res.status(404).json({ message: 'Parcela informada não foi encontrada.' });
        }

        payable.installments = filtered;
        payable.markModified('installments');
        payable.installmentsCount = filtered.length;
        payable.totalValue = formatCurrency(
          filtered.reduce((acc, installment) => acc + Number(installment.value || 0), 0)
        );

        const latestDue = filtered.reduce((latest, installment) => {
          const due = parseDate(installment.dueDate);
          if (!due) return latest;
          if (!latest || due > latest) return due;
          return latest;
        }, null);

        if (latestDue) {
          payable.dueDate = latestDue;
        }

        await payable.save();
        await payable.populate(PAYABLE_POPULATE);
        return res.json(buildPublicPayable(payable));
      }

      await payable.deleteOne();
      return res.status(204).send();
    } catch (error) {
      console.error('Erro ao excluir conta a pagar:', error);
      res.status(500).json({ message: 'Erro ao excluir a conta a pagar.' });
    }
  }
);

router.post(
  '/',
  requireAuth,
  authorizeRoles(...AUTH_ROLES),
  async (req, res) => {
    try {
      const payload = await assemblePayablePayload(req.body);
      const created = await AccountPayable.create(payload);
      await created.populate(PAYABLE_POPULATE);
      res.status(201).json(buildPublicPayable(created));
    } catch (error) {
      if (error?.status) {
        return res.status(error.status).json({ message: error.message });
      }
      if (error?.code === 11000) {
        return res.status(409).json({ message: 'Já existe um lançamento com o código informado.' });
      }
      console.error('Erro ao criar conta a pagar:', error);
      res.status(500).json({ message: 'Erro ao criar a conta a pagar.' });
    }
  }
);

module.exports = router;
