const express = require('express');
const mongoose = require('mongoose');

const AccountingAccount = require('../models/AccountingAccount');
const Store = require('../models/Store');
const requireAuth = require('../middlewares/requireAuth');
const authorizeRoles = require('../middlewares/authorizeRoles');

const router = express.Router();

const normalizeString = (value) => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
};

const normalizeArray = (value) => {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === '') return [];
  return [value];
};

const createValidationError = (message) => {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
};

const parseCompanies = (rawCompanies) => {
  const values = normalizeArray(rawCompanies);
  const ids = new Set();
  values.forEach((value) => {
    const normalized = normalizeString(value);
    if (normalized && mongoose.Types.ObjectId.isValid(normalized)) {
      ids.add(normalized);
    }
  });
  return Array.from(ids);
};

const sanitizeAccountPayload = (body = {}) => {
  const companies = parseCompanies(body.companies);
  const name = normalizeString(body.name);
  const code = normalizeString(body.code);
  const type = normalizeString(body.type).toLowerCase();
  const accountingOrigin = normalizeString(body.accountingOrigin).toLowerCase();
  const costClassification = normalizeString(body.costClassification).toLowerCase();
  const systemOrigin = normalizeString(body.systemOrigin);
  const paymentNature = normalizeString(body.paymentNature).toLowerCase();
  const spedCode = normalizeString(body.spedCode);
  const notes = normalizeString(body.notes);
  const status = normalizeString(body.status).toLowerCase() || 'ativa';

  return {
    companies,
    name,
    code,
    type,
    accountingOrigin,
    costClassification,
    systemOrigin,
    paymentNature,
    spedCode,
    notes,
    status,
  };
};

const ACCOUNT_TYPES = new Set(['analitica', 'sintetica']);
const ACCOUNTING_ORIGINS = new Set(['', 'receita', 'despesa', 'ativo', 'passivo', 'resultado', 'encerramento', 'transferencia']);
const COST_CLASSIFICATIONS = new Set(['', 'fixo', 'variavel', 'cmv', 'impostos', 'outros']);
const SYSTEM_ORIGINS = new Set(['', '0', '1', '2', '3', '4']);
const PAYMENT_NATURES = new Set(['', 'contas_pagar', 'contas_receber']);
const STATUS_VALUES = new Set(['ativa', 'inativa']);

const validatePayload = async (payload, currentId = null) => {
  if (!payload.name) {
    throw createValidationError('Informe o nome da conta contábil.');
  }
  if (!payload.code) {
    throw createValidationError('Informe o código contábil.');
  }
  if (!payload.type || !ACCOUNT_TYPES.has(payload.type)) {
    throw createValidationError('Selecione o tipo da conta contábil.');
  }
  if (!Array.isArray(payload.companies) || payload.companies.length === 0) {
    throw createValidationError('Selecione ao menos uma empresa para vincular a conta.');
  }
  if (!ACCOUNTING_ORIGINS.has(payload.accountingOrigin)) {
    throw createValidationError('Origem contábil inválida.');
  }
  if (!COST_CLASSIFICATIONS.has(payload.costClassification)) {
    throw createValidationError('Classificação de custo inválida.');
  }
  if (!SYSTEM_ORIGINS.has(payload.systemOrigin)) {
    throw createValidationError('Origem (sistema) inválida.');
  }
  if (!PAYMENT_NATURES.has(payload.paymentNature)) {
    throw createValidationError('Natureza do pagamento inválida.');
  }
  if (!STATUS_VALUES.has(payload.status)) {
    throw createValidationError('Situação inválida.');
  }

  const stores = await Store.find({ _id: { $in: payload.companies } }, '_id');
  if (stores.length !== payload.companies.length) {
    throw createValidationError('Uma ou mais empresas informadas não foram encontradas.');
  }

  const duplicate = await AccountingAccount.findOne({
    _id: { $ne: currentId },
    code: payload.code,
  }).lean();

  if (duplicate) {
    throw createValidationError('Já existe uma conta contábil cadastrada com o mesmo código.');
  }
};

const buildPublicAccount = (account) => {
  if (!account) return null;
  const plain = typeof account.toObject === 'function' ? account.toObject() : account;
  return {
    _id: plain._id,
    companies: Array.isArray(plain.companies)
      ? plain.companies.map((company) => {
          if (!company) return null;
          if (typeof company.toObject === 'function') {
            const companyObject = company.toObject();
            return {
              _id: companyObject._id,
              nome: companyObject.nome,
              nomeFantasia: companyObject.nomeFantasia,
              razaoSocial: companyObject.razaoSocial,
              cnpj: companyObject.cnpj,
            };
          }
          return {
            _id: company._id || company,
            nome: company.nome,
            nomeFantasia: company.nomeFantasia,
            razaoSocial: company.razaoSocial,
            cnpj: company.cnpj,
          };
        }).filter(Boolean)
      : [],
    name: plain.name,
    code: plain.code,
    type: plain.type,
    accountingOrigin: plain.accountingOrigin,
    costClassification: plain.costClassification,
    systemOrigin: plain.systemOrigin,
    paymentNature: plain.paymentNature,
    spedCode: plain.spedCode,
    notes: plain.notes,
    status: plain.status,
    createdAt: plain.createdAt,
    updatedAt: plain.updatedAt,
  };
};

router.use(requireAuth, authorizeRoles('admin', 'admin_master', 'funcionario'));

router.get('/', async (req, res) => {
  try {
    const { company } = req.query;
    const filter = {};
    if (company && mongoose.Types.ObjectId.isValid(company)) {
      filter.companies = company;
    }

    const accounts = await AccountingAccount.find(filter)
      .sort({ name: 1 })
      .populate('companies', 'nome nomeFantasia razaoSocial cnpj');

    res.json({ accounts: accounts.map(buildPublicAccount) });
  } catch (error) {
    console.error('Erro ao listar contas contábeis:', error);
    res.status(500).json({ message: 'Erro ao listar contas contábeis.' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Identificador inválido.' });
    }

    const account = await AccountingAccount.findById(id).populate(
      'companies',
      'nome nomeFantasia razaoSocial cnpj'
    );

    if (!account) {
      return res.status(404).json({ message: 'Conta contábil não encontrada.' });
    }

    res.json(buildPublicAccount(account));
  } catch (error) {
    console.error('Erro ao buscar conta contábil:', error);
    res.status(500).json({ message: 'Erro ao buscar conta contábil.' });
  }
});

router.post('/', async (req, res) => {
  try {
    const payload = sanitizeAccountPayload(req.body);
    await validatePayload(payload);

    const created = await AccountingAccount.create(payload);
    const populated = await created.populate('companies', 'nome nomeFantasia razaoSocial cnpj');
    res.status(201).json(buildPublicAccount(populated));
  } catch (error) {
    console.error('Erro ao criar conta contábil:', error);
    if (error?.statusCode === 400) {
      return res.status(400).json({ message: error.message });
    }
    res.status(500).json({ message: 'Erro ao criar conta contábil.' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Identificador inválido.' });
    }

    const existing = await AccountingAccount.findById(id);
    if (!existing) {
      return res.status(404).json({ message: 'Conta contábil não encontrada.' });
    }

    const payload = sanitizeAccountPayload(req.body);
    await validatePayload(payload, id);

    existing.set(payload);
    await existing.save();
    const populated = await existing.populate('companies', 'nome nomeFantasia razaoSocial cnpj');

    res.json(buildPublicAccount(populated));
  } catch (error) {
    console.error('Erro ao atualizar conta contábil:', error);
    if (error?.statusCode === 400) {
      return res.status(400).json({ message: error.message });
    }
    res.status(500).json({ message: 'Erro ao atualizar conta contábil.' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Identificador inválido.' });
    }

    const deleted = await AccountingAccount.findByIdAndDelete(id);
    if (!deleted) {
      return res.status(404).json({ message: 'Conta contábil não encontrada.' });
    }

    res.status(204).send();
  } catch (error) {
    console.error('Erro ao excluir conta contábil:', error);
    res.status(500).json({ message: 'Erro ao excluir conta contábil.' });
  }
});

module.exports = router;
