const express = require('express');
const mongoose = require('mongoose');

const multer = require('multer');
const XLSX = require('xlsx');

const AccountingAccount = require('../models/AccountingAccount');
const Store = require('../models/Store');
const requireAuth = require('../middlewares/requireAuth');
const authorizeRoles = require('../middlewares/authorizeRoles');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
});

const normalizeString = (value) => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
};

const removeDiacritics = (value) => {
  const normalized = normalizeString(value);
  return normalized ? normalized.normalize('NFD').replace(/\p{Diacritic}/gu, '') : '';
};

const toSlug = (value) => removeDiacritics(value).toLowerCase();

const mapAccountType = (value) => {
  const slug = toSlug(value);
  if (!slug) return '';
  if (slug.startsWith('ana')) return 'analitica';
  if (slug.startsWith('sin')) return 'sintetica';
  return '';
};

const mapAccountingOrigin = (value) => {
  const slug = toSlug(value);
  if (!slug) return '';
  if (ACCOUNTING_ORIGINS.has(slug)) return slug;
  return '';
};

const mapCostClassification = (value) => {
  const slug = toSlug(value).replace(/\s+/g, '');
  if (!slug) return '';
  if (slug === 'custo') return '';
  if (slug === 'custo fixo') return 'fixo';
  if (slug === 'custovariavel') return 'variavel';
  if (slug === 'variavel') return 'variavel';
  if (slug === 'custofixo') return 'fixo';
  if (slug === 'fixo') return 'fixo';
  if (slug === 'cmv') return 'cmv';
  if (slug === 'impostos') return 'impostos';
  if (slug === 'outros') return 'outros';
  return '';
};

const mapSystemOrigin = (value) => {
  const normalized = normalizeString(value);
  if (!normalized) return '';
  const match = normalized.match(/[0-4]/);
  if (!match) return '';
  const systemOrigin = match[0];
  return SYSTEM_ORIGINS.has(systemOrigin) ? systemOrigin : '';
};

const mapPaymentNature = (value) => {
  const slug = toSlug(value).replace(/\s+/g, '');
  if (!slug) return '';
  if (slug.includes('pagar')) return 'contas_pagar';
  if (slug.includes('receber')) return 'contas_receber';
  return '';
};

const getColumnValue = (row, keys = []) => {
  if (!row || typeof row !== 'object') return '';
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(row, key)) {
      return row[key];
    }
  }
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
    const natureRaw = req.query?.nature || req.query?.paymentNature;
    const filter = {};
    if (company && mongoose.Types.ObjectId.isValid(company)) {
      filter.companies = company;
    }

    const paymentNature = normalizeString(natureRaw).toLowerCase();
    if (paymentNature && PAYMENT_NATURES.has(paymentNature)) {
      filter.paymentNature = paymentNature;
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

router.post('/import', upload.single('file'), async (req, res) => {
  try {
    const companies = parseCompanies(req.body?.companies);
    if (!companies.length) {
      return res.status(400).json({ message: 'Selecione ao menos uma empresa para vincular as contas importadas.' });
    }

    const stores = await Store.find({ _id: { $in: companies } }, '_id');
    if (stores.length !== companies.length) {
      return res.status(400).json({ message: 'Uma ou mais empresas informadas não foram encontradas.' });
    }

    if (!req.file || !req.file.buffer?.length) {
      return res.status(400).json({ message: 'Envie uma planilha Excel válida (.xlsx).' });
    }

    let workbook;
    try {
      workbook = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: false });
    } catch (error) {
      console.error('Erro ao ler planilha de contas contábeis:', error);
      return res.status(400).json({ message: 'Não foi possível ler a planilha enviada. Verifique o formato do arquivo.' });
    }

    const sheetName = Array.isArray(workbook.SheetNames) ? workbook.SheetNames[0] : null;
    if (!sheetName) {
      return res.status(400).json({ message: 'A planilha enviada não possui abas válidas.' });
    }

    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });

    let consideredRows = 0;
    const validRows = [];
    const errors = [];
    let skippedInvalid = 0;
    let skippedDuplicates = 0;
    let skippedExisting = 0;

    rows.forEach((row, index) => {
      const rowNumber = index + 2;

      const rawName = getColumnValue(row, ['Nome', 'nome', 'Name']);
      const rawCode = getColumnValue(row, ['Codigo Contábil', 'Código Contábil', 'Código contabil', 'Codigo contabil', 'Código', 'Codigo']);
      const rawType = getColumnValue(row, ['Tipo', 'tipo']);
      const rawAccountingOrigin = getColumnValue(row, ['Origem (BP/DRE)', 'Origem (BP / DRE)', 'Origem', 'Origem BP/DRE']);
      const rawCost = getColumnValue(row, ['Custo', 'Classificação de Custo']);
      const rawSystemOrigin = getColumnValue(row, ['Origem (0-4)', 'Origem (0 - 4)', 'Origem Sistema', 'Origem Sistema (0-4)']);
      const rawPaymentNature = getColumnValue(row, ['Natureza do Pagamento', 'Natureza Pagamento']);
      const rawSpedCode = getColumnValue(row, ['Plano de Contas SPED', 'Plano SPED', 'SPED']);

      const name = normalizeString(rawName);
      const code = normalizeString(rawCode);
      const type = mapAccountType(rawType);
      const accountingOriginRaw = normalizeString(rawAccountingOrigin);
      const accountingOrigin = accountingOriginRaw ? mapAccountingOrigin(rawAccountingOrigin) : '';
      const costClassificationRaw = normalizeString(rawCost);
      const costClassification = costClassificationRaw ? mapCostClassification(rawCost) : '';
      const systemOriginRaw = normalizeString(rawSystemOrigin);
      const systemOrigin = systemOriginRaw ? mapSystemOrigin(rawSystemOrigin) : '';
      const paymentNatureRaw = normalizeString(rawPaymentNature);
      const paymentNature = paymentNatureRaw ? mapPaymentNature(rawPaymentNature) : '';
      const spedCode = normalizeString(rawSpedCode);

      const hasContent = [name, code, normalizeString(rawType), accountingOriginRaw, costClassificationRaw, systemOriginRaw, paymentNatureRaw, spedCode].some(Boolean);
      if (!hasContent) {
        return;
      }

      consideredRows += 1;
      const issues = [];

      if (!name) {
        issues.push('Informe o nome da conta contábil.');
      }
      if (!code) {
        issues.push('Informe o código contábil.');
      }
      if (!type) {
        issues.push('Tipo da conta inválido. Utilize Analítico ou Sintético.');
      }
      if (accountingOriginRaw && !accountingOrigin) {
        issues.push('Origem (BP/DRE) inválida.');
      }
      if (costClassificationRaw && !costClassification) {
        issues.push('Classificação de custo inválida.');
      }
      if (systemOriginRaw && !systemOrigin) {
        issues.push('Origem (0-4) inválida.');
      }
      if (paymentNatureRaw && !paymentNature) {
        issues.push('Natureza do pagamento inválida.');
      }

      if (issues.length) {
        skippedInvalid += 1;
        errors.push({ row: rowNumber, issues, type: 'invalid' });
        return;
      }

      validRows.push({
        rowNumber,
        name,
        code,
        type,
        accountingOrigin,
        costClassification,
        systemOrigin,
        paymentNature,
        spedCode,
      });
    });

    if (!consideredRows) {
      return res.status(400).json({ message: 'Nenhuma linha com dados foi encontrada na planilha enviada.' });
    }

    const uniqueRows = [];
    const seenCodes = new Map();

    validRows.forEach((row) => {
      if (seenCodes.has(row.code)) {
        skippedDuplicates += 1;
        errors.push({ row: row.rowNumber, issues: ['Código contábil duplicado na planilha.'], type: 'duplicate' });
        return;
      }
      seenCodes.set(row.code, row);
      uniqueRows.push(row);
    });

    if (!uniqueRows.length) {
      return res.status(400).json({
        message: 'Nenhuma linha válida foi encontrada na planilha enviada.',
        summary: {
          totalRows: consideredRows,
          imported: 0,
          skippedInvalid,
          skippedDuplicates,
          skippedExisting,
        },
        errors,
      });
    }

    const existingAccounts = await AccountingAccount.find({ code: { $in: Array.from(seenCodes.keys()) } }, 'code');
    const existingCodes = new Set(existingAccounts.map((account) => account.code));

    const rowsToCreate = uniqueRows.filter((row) => {
      if (existingCodes.has(row.code)) {
        skippedExisting += 1;
        errors.push({ row: row.rowNumber, issues: ['Código contábil já cadastrado.'], type: 'existing' });
        return false;
      }
      return true;
    });

    const rowByCode = new Map(rowsToCreate.map((row) => [row.code, row]));
    const documents = rowsToCreate.map((row) => ({
      companies,
      name: row.name,
      code: row.code,
      type: row.type,
      accountingOrigin: row.accountingOrigin,
      costClassification: row.costClassification,
      systemOrigin: row.systemOrigin,
      paymentNature: row.paymentNature,
      spedCode: row.spedCode,
      notes: '',
      status: 'ativa',
    }));

    let insertedDocs = [];
    if (documents.length) {
      try {
        insertedDocs = await AccountingAccount.insertMany(documents, { ordered: false });
      } catch (error) {
        if (error?.writeErrors?.length || error?.code === 11000) {
          insertedDocs = Array.isArray(error.insertedDocs) ? error.insertedDocs : [];
          const writeErrors = Array.isArray(error.writeErrors) ? error.writeErrors : [];
          writeErrors.forEach((writeError) => {
            const duplicatedCode = writeError?.err?.op?.code || writeError?.err?.keyValue?.code;
            if (duplicatedCode && rowByCode.has(duplicatedCode)) {
              const failedRow = rowByCode.get(duplicatedCode);
              errors.push({
                row: failedRow?.rowNumber || null,
                issues: ['Código contábil já cadastrado.'],
                type: 'existing',
              });
            } else {
              errors.push({ row: null, issues: ['Falha ao inserir um dos registros importados.'], type: 'unknown' });
            }
            skippedExisting += 1;
          });
        } else {
          console.error('Erro ao inserir contas contábeis importadas:', error);
          return res.status(500).json({ message: 'Erro ao importar contas contábeis.' });
        }
      }
    }

    const createdCount = Array.isArray(insertedDocs) ? insertedDocs.length : 0;

    const summary = {
      totalRows: consideredRows,
      imported: createdCount,
      skippedInvalid,
      skippedDuplicates,
      skippedExisting,
    };

    res.json({ message: 'Importação concluída.', summary, errors });
  } catch (error) {
    console.error('Erro ao importar contas contábeis:', error);
    res.status(500).json({ message: 'Erro ao importar contas contábeis.' });
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
