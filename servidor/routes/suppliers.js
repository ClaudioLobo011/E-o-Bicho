const express = require('express');
const mongoose = require('mongoose');
const Supplier = require('../models/Supplier');
const Store = require('../models/Store');
const AccountingAccount = require('../models/AccountingAccount');
const requireAuth = require('../middlewares/requireAuth');
const authorizeRoles = require('../middlewares/authorizeRoles');

const router = express.Router();

const SUPPLIER_TYPES = new Set(['fisico', 'juridico', 'mei', 'produtor-rural']);
const SUPPLIER_KINDS = new Set(['fabricante', 'distribuidora', 'representante', 'servico']);
const RETENTION_TYPES = new Set(['IR', 'CSLL', 'COFINS', 'PIS', 'ISS', 'CPRB', 'INSS']);
const ICMS_CONTRIBUTION_TYPES = new Set(['1', '2', '9']);

const normalizeString = (value) => (typeof value === 'string' ? value.trim() : '');
const normalizeLower = (value) => normalizeString(value).toLowerCase();
const normalizeUpper = (value) => normalizeString(value).toUpperCase();
const normalizeDigits = (value) => normalizeString(value).replace(/\D+/g, '');

const parseBoolean = (value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const normalized = normalizeLower(value);
  return normalized === 'true' || normalized === '1' || normalized === 'on' || normalized === 'yes';
};

const ensureObjectId = (value) => {
  const normalized = normalizeString(value);
  if (!normalized) return null;
  return mongoose.Types.ObjectId.isValid(normalized) ? normalized : null;
};

const parseCompanies = (value) => {
  if (!value) return [];
  const raw = Array.isArray(value) ? value : [value];
  const ids = raw
    .map((item) => {
      if (item && typeof item === 'object' && item._id) {
        return ensureObjectId(item._id);
      }
      return ensureObjectId(item);
    })
    .filter(Boolean);
  return Array.from(new Set(ids));
};

const parseRepresentatives = (value) => {
  if (!value) return [];

  let entries = [];
  if (Array.isArray(value)) {
    entries = value;
  } else if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        entries = parsed;
      } else if (parsed && typeof parsed === 'object') {
        entries = [parsed];
      }
    } catch (_) {
      entries = [];
    }
  } else if (value && typeof value === 'object') {
    entries = [value];
  }

  return entries
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const name = normalizeString(entry.name ?? entry.nome);
      const mobile = normalizeString(entry.mobile ?? entry.celular ?? entry.phone);
      const email = normalizeString(entry.email);
      if (!name && !mobile && !email) {
        return null;
      }
      return { name, mobile, email };
    })
    .filter(Boolean);
};

const parseRetentions = (value) => {
  if (!value) return [];
  let raw = [];
  if (Array.isArray(value)) {
    raw = value;
  } else if (typeof value === 'string') {
    raw = value.split(/[;,]/);
  } else {
    raw = [value];
  }
  const mapped = raw
    .map((item) => normalizeUpper(item))
    .filter((item) => RETENTION_TYPES.has(item));
  return Array.from(new Set(mapped));
};

const mapSupplierType = (value) => {
  const normalized = normalizeLower(value);
  if (SUPPLIER_TYPES.has(normalized)) {
    return normalized;
  }
  return 'juridico';
};

const mapSupplierKind = (value) => {
  const normalized = normalizeLower(value);
  if (SUPPLIER_KINDS.has(normalized)) {
    return normalized;
  }
  return 'distribuidora';
};

const mapIcmsContribution = (value) => {
  const normalized = normalizeString(value);
  if (ICMS_CONTRIBUTION_TYPES.has(normalized)) {
    return normalized;
  }
  return '2';
};

const sanitizeAddress = (body = {}) => {
  const source = body.address && typeof body.address === 'object' ? body.address : body;
  return {
    cep: normalizeDigits(source.cep),
    logradouro: normalizeString(source.logradouro),
    numero: normalizeString(source.numero),
    complemento: normalizeString(source.complemento),
    bairro: normalizeString(source.bairro),
    cidade: normalizeString(source.cidade),
    uf: normalizeUpper(source.uf).slice(0, 2),
  };
};

const sanitizeContact = (body = {}) => {
  const source = body.contact && typeof body.contact === 'object' ? body.contact : body;
  return {
    email: normalizeString(source.email),
    phone: normalizeString(source.phone),
    mobile: normalizeString(source.mobile),
    secondaryPhone: normalizeString(source.secondaryPhone ?? source.phoneSecondary),
    responsible: normalizeString(source.responsible ?? source.pessoaResponsavel),
  };
};

const sanitizeOtherInfo = (body = {}) => {
  const source = body.otherInfo && typeof body.otherInfo === 'object' ? body.otherInfo : body;
  return {
    supplierKind: mapSupplierKind(source.supplierKind),
    accountingAccount: ensureObjectId(source.accountingAccount),
    icmsContribution: mapIcmsContribution(source.icmsContribution),
    observation: normalizeString(source.observation),
    bank: normalizeString(source.bank),
    agency: normalizeString(source.agency),
    accountNumber: normalizeString(source.accountNumber ?? source.account),
  };
};

const sanitizeFlags = (body = {}) => {
  const source = body.flags && typeof body.flags === 'object' ? body.flags : body;
  return {
    inactive: parseBoolean(source.inactive),
    ong: parseBoolean(source.ong),
    bankSupplier: parseBoolean(source.bankSupplier ?? source.fornecedorBancario),
  };
};

const sanitizeSupplierPayload = (body = {}) => {
  const country = normalizeString(body.country ?? body.pais) || 'Brasil';
  const legalName = normalizeString(body.legalName ?? body.razaoSocial);
  const fantasyName = normalizeString(body.fantasyName ?? body.nomeFantasia);
  const cnpj = normalizeDigits(body.cnpj);
  const stateRegistration = normalizeString(body.stateRegistration ?? body.inscricaoEstadual);
  const type = mapSupplierType(body.type ?? body.tipo);
  const companies = parseCompanies(body.companies ?? body.empresas);
  const flags = sanitizeFlags(body.flags ? body : { ...body, flags: body.flags });
  const address = sanitizeAddress(body.address ? body : body);
  const contact = sanitizeContact(body.contact ? body : body);
  const otherInfo = sanitizeOtherInfo(body.otherInfo ? body : body);
  const representatives = parseRepresentatives(body.representatives ?? body.representantes);
  const retentions = parseRetentions(body.retentions ?? body.retencoes ?? body.retencoesSelecionadas);

  return {
    country,
    legalName,
    fantasyName,
    cnpj,
    stateRegistration,
    type,
    companies,
    flags,
    address,
    contact,
    otherInfo,
    representatives,
    retentions,
  };
};

const buildPublicSupplier = (supplier) => {
  if (!supplier) return null;
  const plain = typeof supplier.toObject === 'function' ? supplier.toObject({ virtuals: false }) : supplier;
  return {
    _id: plain._id,
    codeNumber: plain.codeNumber,
    code: plain.code,
    country: plain.country,
    legalName: plain.legalName,
    fantasyName: plain.fantasyName,
    cnpj: plain.cnpj,
    stateRegistration: plain.stateRegistration,
    type: plain.type,
    companies: Array.isArray(plain.companies)
      ? plain.companies
          .map((company) => {
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
          })
          .filter(Boolean)
      : [],
    flags: {
      inactive: Boolean(plain.flags?.inactive),
      ong: Boolean(plain.flags?.ong),
      bankSupplier: Boolean(plain.flags?.bankSupplier),
    },
    address: {
      cep: plain.address?.cep || '',
      logradouro: plain.address?.logradouro || '',
      numero: plain.address?.numero || '',
      complemento: plain.address?.complemento || '',
      bairro: plain.address?.bairro || '',
      cidade: plain.address?.cidade || '',
      uf: plain.address?.uf || '',
    },
    contact: {
      email: plain.contact?.email || '',
      phone: plain.contact?.phone || '',
      mobile: plain.contact?.mobile || '',
      secondaryPhone: plain.contact?.secondaryPhone || '',
      responsible: plain.contact?.responsible || '',
    },
    otherInfo: {
      supplierKind: plain.otherInfo?.supplierKind || 'distribuidora',
      accountingAccount: plain.otherInfo?.accountingAccount
        ? {
            _id: plain.otherInfo.accountingAccount._id || plain.otherInfo.accountingAccount,
            code: plain.otherInfo.accountingAccount.code,
            name: plain.otherInfo.accountingAccount.name,
          }
        : null,
      icmsContribution: plain.otherInfo?.icmsContribution || '2',
      observation: plain.otherInfo?.observation || '',
      bank: plain.otherInfo?.bank || '',
      agency: plain.otherInfo?.agency || '',
      accountNumber: plain.otherInfo?.accountNumber || '',
    },
    representatives: Array.isArray(plain.representatives)
      ? plain.representatives.map((rep) => ({
          name: rep.name || '',
          mobile: rep.mobile || '',
          email: rep.email || '',
        }))
      : [],
    retentions: Array.isArray(plain.retentions) ? plain.retentions : [],
    createdAt: plain.createdAt,
    updatedAt: plain.updatedAt,
  };
};

const ensureCompaniesExist = async (companyIds = []) => {
  if (!companyIds.length) return;
  const count = await Store.countDocuments({ _id: { $in: companyIds } });
  if (count !== companyIds.length) {
    throw new Error('Uma ou mais empresas informadas não foram encontradas.');
  }
};

const ensureAccountingAccountExists = async (accountId) => {
  if (!accountId) return;
  const exists = await AccountingAccount.exists({ _id: accountId });
  if (!exists) {
    throw new Error('Conta contábil não encontrada.');
  }
};

const createSupplierWithSequentialCode = async (payload) => {
  let candidateNumber = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (attempt === 0) {
      const last = await Supplier.findOne({}, { codeNumber: 1 })
        .sort({ codeNumber: -1 })
        .lean();
      const base = last?.codeNumber || 1000;
      candidateNumber = base + 1;
    } else {
      candidateNumber += 1;
    }

    const candidateCode = String(candidateNumber).padStart(4, '0');
    const supplier = new Supplier({
      ...payload,
      codeNumber: candidateNumber,
      code: candidateCode,
    });

    try {
      const saved = await supplier.save();
      return saved;
    } catch (error) {
      if (error?.code === 11000 && /(codeNumber|code)/.test(error?.message || '')) {
        continue;
      }
      throw error;
    }
  }

  throw new Error('Não foi possível gerar um código único para o fornecedor.');
};

router.use(requireAuth, authorizeRoles('admin', 'admin_master', 'funcionario'));

router.get('/next-code', async (req, res) => {
  try {
    const last = await Supplier.findOne({}, { codeNumber: 1 })
      .sort({ codeNumber: -1 })
      .lean();
    const nextNumber = (last?.codeNumber || 1000) + 1;
    const nextCode = String(nextNumber).padStart(4, '0');
    res.json({ nextCode, nextNumber });
  } catch (error) {
    console.error('Erro ao calcular próximo código de fornecedor:', error);
    res.status(500).json({ message: 'Erro ao calcular o próximo código de fornecedor.' });
  }
});

router.get('/', async (req, res) => {
  try {
    const suppliers = await Supplier.find({})
      .sort({ legalName: 1 })
      .populate('companies', 'nome nomeFantasia razaoSocial cnpj')
      .populate('otherInfo.accountingAccount', 'code name');
    res.json({ suppliers: suppliers.map(buildPublicSupplier) });
  } catch (error) {
    console.error('Erro ao listar fornecedores:', error);
    res.status(500).json({ message: 'Erro ao listar fornecedores.' });
  }
});

router.post('/', async (req, res) => {
  try {
    const payload = sanitizeSupplierPayload(req.body || {});

    if (!payload.legalName) {
      return res.status(400).json({ message: 'Informe a razão social do fornecedor.' });
    }
    if (!payload.cnpj) {
      return res.status(400).json({ message: 'Informe o CNPJ do fornecedor.' });
    }

    await ensureCompaniesExist(payload.companies);
    await ensureAccountingAccountExists(payload.otherInfo.accountingAccount);

    const duplicate = await Supplier.findOne({ cnpj: payload.cnpj }).lean();
    if (duplicate) {
      return res.status(409).json({ message: 'Já existe um fornecedor cadastrado com este CNPJ.' });
    }

    const supplier = await createSupplierWithSequentialCode(payload);
    const populated = await supplier
      .populate('companies', 'nome nomeFantasia razaoSocial cnpj')
      .populate('otherInfo.accountingAccount', 'code name');

    res.status(201).json({ supplier: buildPublicSupplier(populated) });
  } catch (error) {
    console.error('Erro ao criar fornecedor:', error);
    if (error?.message && error.message.includes('empresas')) {
      return res.status(400).json({ message: error.message });
    }
    if (error?.message && error.message.includes('Conta contábil')) {
      return res.status(400).json({ message: error.message });
    }
    res.status(500).json({ message: 'Erro ao criar fornecedor.' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Identificador inválido.' });
    }

    const supplier = await Supplier.findById(id);
    if (!supplier) {
      return res.status(404).json({ message: 'Fornecedor não encontrado.' });
    }

    const payload = sanitizeSupplierPayload(req.body || {});

    if (!payload.legalName) {
      return res.status(400).json({ message: 'Informe a razão social do fornecedor.' });
    }
    if (!payload.cnpj) {
      return res.status(400).json({ message: 'Informe o CNPJ do fornecedor.' });
    }

    await ensureCompaniesExist(payload.companies);
    await ensureAccountingAccountExists(payload.otherInfo.accountingAccount);

    const duplicate = await Supplier.findOne({
      _id: { $ne: supplier._id },
      cnpj: payload.cnpj,
    }).lean();
    if (duplicate) {
      return res.status(409).json({ message: 'Já existe um fornecedor cadastrado com este CNPJ.' });
    }

    supplier.country = payload.country || 'Brasil';
    supplier.legalName = payload.legalName;
    supplier.fantasyName = payload.fantasyName;
    supplier.cnpj = payload.cnpj;
    supplier.stateRegistration = payload.stateRegistration;
    supplier.type = payload.type;
    supplier.companies = payload.companies;
    supplier.flags = {
      inactive: Boolean(payload.flags?.inactive),
      ong: Boolean(payload.flags?.ong),
      bankSupplier: Boolean(payload.flags?.bankSupplier),
    };
    supplier.address = payload.address;
    supplier.contact = payload.contact;
    supplier.otherInfo = {
      supplierKind: payload.otherInfo?.supplierKind || 'distribuidora',
      accountingAccount: payload.otherInfo?.accountingAccount || null,
      icmsContribution: payload.otherInfo?.icmsContribution || '2',
      observation: payload.otherInfo?.observation || '',
      bank: payload.otherInfo?.bank || '',
      agency: payload.otherInfo?.agency || '',
      accountNumber: payload.otherInfo?.accountNumber || '',
    };
    supplier.representatives = payload.representatives;
    supplier.retentions = payload.retentions;

    await supplier.save();

    const populated = await supplier
      .populate('companies', 'nome nomeFantasia razaoSocial cnpj')
      .populate('otherInfo.accountingAccount', 'code name');

    res.json({ supplier: buildPublicSupplier(populated) });
  } catch (error) {
    console.error('Erro ao atualizar fornecedor:', error);
    if (error?.message && error.message.includes('empresas')) {
      return res.status(400).json({ message: error.message });
    }
    if (error?.message && error.message.includes('Conta contábil')) {
      return res.status(400).json({ message: error.message });
    }
    res.status(500).json({ message: 'Erro ao atualizar fornecedor.' });
  }
});

module.exports = router;
