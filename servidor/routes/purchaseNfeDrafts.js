const express = require('express');
const mongoose = require('mongoose');
const NfeDraft = require('../models/NfeDraft');
const Product = require('../models/Product');
const Deposit = require('../models/Deposit');
const Store = require('../models/Store');
const Supplier = require('../models/Supplier');
const BankAccount = require('../models/BankAccount');
const AccountingAccount = require('../models/AccountingAccount');
const AccountPayable = require('../models/AccountPayable');

const router = express.Router();

const cleanString = (value) => (typeof value === 'string' ? value.trim() : '');
const digitsOnly = (value) => cleanString(value).replace(/\D+/g, '');

const toNumber = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.replace(/\./g, '').replace(',', '.');
    const numeric = Number.parseFloat(normalized);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }
  return null;
};

const toInteger = (value) => {
  const numeric = toNumber(value);
  return Number.isFinite(numeric) ? Math.round(numeric) : null;
};

const clonePlain = (value) => {
  if (value === null || typeof value === 'undefined') return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (error) {
    return null;
  }
};

const normalizeStatusToken = (status) => String(status || '').trim().toLowerCase();

const isApprovedStatus = (status) => {
  const token = normalizeStatusToken(status);
  return token === 'approved' || token === 'aprovado' || token === 'aprovada';
};

const parseDateInput = (value) => {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const raw = String(value).trim();
  if (!raw) return null;
  const iso = raw.length === 10 ? `${raw}T00:00:00` : raw;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
};

const formatCurrencyValue = (value) => Math.round(Number(value || 0) * 100) / 100;

const extractProductId = (record) => {
  if (!record || typeof record !== 'object') return null;
  const candidates = [
    record._id,
    record.id,
    record.uuid,
    record.productId,
    record.product_id,
    record.produtoId,
    record.produto_id,
    record.product?.id,
    record.product?.productId,
    record.matchedProduct?._id,
    record.matchedProduct?.id,
    record.matchedProduct?.uuid,
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const normalized = String(candidate).trim();
    if (mongoose.Types.ObjectId.isValid(normalized)) {
      return normalized;
    }
  }
  return null;
};

const computeEntryStockQuantity = (item) => {
  if (!item || typeof item !== 'object') return null;

  const entryStock = toNumber(item.entryStockQuantity);
  if (Number.isFinite(entryStock)) {
    return entryStock;
  }

  const quantityValue = toNumber(item.quantity);
  let conversionFactor = toNumber(item.conversion);

  if (!Number.isFinite(conversionFactor) || conversionFactor <= 0) {
    const multiplierValue = toNumber(item.conversionMultiplier);
    const dividerValue = toNumber(item.conversionDivider);

    if (
      Number.isFinite(multiplierValue) &&
      multiplierValue > 0 &&
      Number.isFinite(dividerValue) &&
      dividerValue > 0
    ) {
      conversionFactor = multiplierValue / dividerValue;
    } else if (Number.isFinite(multiplierValue) && multiplierValue > 0) {
      conversionFactor = multiplierValue;
    } else if (Number.isFinite(dividerValue) && dividerValue > 0) {
      conversionFactor = 1 / dividerValue;
    }
  }

  if (Number.isFinite(quantityValue) && Number.isFinite(conversionFactor) && conversionFactor > 0) {
    return quantityValue * conversionFactor;
  }

  const qTribValue = toNumber(item.qTrib);
  if (Number.isFinite(qTribValue)) {
    return qTribValue;
  }

  return Number.isFinite(quantityValue) ? quantityValue : null;
};

const collectProductEntrySummary = (items = []) => {
  const quantities = new Map();
  const details = new Map();

  if (!Array.isArray(items)) {
    return { quantities, details };
  }

  items.forEach((item) => {
    if (!item || typeof item !== 'object') return;

    const productId = extractProductId(item.matchedProduct || item);
    if (!productId) return;

    const quantityValue = computeEntryStockQuantity(item);
    if (!Number.isFinite(quantityValue) || quantityValue <= 0) {
      return;
    }

    const normalizedQuantity = quantityValue > 0 ? quantityValue : 0;
    if (normalizedQuantity <= 0) return;

    const key = String(productId);
    const current = quantities.get(key) || 0;
    quantities.set(key, current + normalizedQuantity);

    if (!details.has(key)) {
      const source = item.matchedProduct || item || {};
      const nameCandidates = [
        source?.nome,
        source?.name,
        source?.description,
        item?.description,
        source?.descricao,
        source?.title,
      ];
      const codeCandidates = [
        source?.sku,
        source?.codigo,
        source?.code,
        source?.codigoProduto,
        source?.productCode,
        item?.sku,
        item?.code,
      ];
      const name = nameCandidates.find((value) => typeof value === 'string' && value.trim());
      const code = codeCandidates.find((value) => typeof value === 'string' && value.trim());
      details.set(key, {
        name: name ? name.trim() : '',
        code: code ? code.trim() : '',
      });
    }
  });

  return { quantities, details };
};

const generatePayableSequentialCode = async (session) => {
  const now = new Date();
  const year = now.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const filter = { createdAt: { $gte: yearStart } };
  const count = await AccountPayable.countDocuments(filter).session(session);
  const sequential = String(count + 1).padStart(5, '0');
  return `CP-${year}-${sequential}`;
};

const buildHttpError = (status, message, details = null) => {
  const error = new Error(message);
  error.status = status;
  if (details) {
    error.details = details;
  }
  return error;
};

const sanitizeDuplicate = (duplicate = {}) => ({
  number: cleanString(duplicate.number),
  dueDate: cleanString(duplicate.dueDate),
  manualDueDate: cleanString(duplicate.manualDueDate),
  originalDueDate: cleanString(duplicate.originalDueDate),
  value: toNumber(duplicate.value),
  manualValue: toNumber(duplicate.manualValue),
  originalValue: toNumber(duplicate.originalValue),
  paymentMethod: cleanString(duplicate.paymentMethod),
  paymentDescription: cleanString(duplicate.paymentDescription),
  paymentType: cleanString(duplicate.paymentType),
  termDays: toInteger(duplicate.termDays),
  bankAccount: cleanString(duplicate.bankAccount),
  bankAccountIsManual: Boolean(duplicate.bankAccountIsManual),
  accountingAccountId: cleanString(
    duplicate.accountingAccountId || duplicate.accountingAccount
  ),
  accountingAccountCode: cleanString(duplicate.accountingAccountCode),
  accountingAccountName: cleanString(duplicate.accountingAccountName),
});

const computeDuplicatesSummary = (duplicates) => {
  if (!Array.isArray(duplicates) || !duplicates.length) {
    return { totalAmount: 0, count: 0 };
  }

  const totalAmount = duplicates.reduce((sum, duplicate) => {
    const numeric = toNumber(duplicate.value);
    return Number.isFinite(numeric) ? sum + numeric : sum;
  }, 0);

  return { totalAmount, count: duplicates.length };
};

const buildDraftDocumentFromPayload = (payload = {}) => {
  const header = payload.header || {};
  const totals = payload.totals || {};
  const supplier = payload.supplier || {};
  const selection = payload.selection || {};
  const additional = payload.additionalInfo || {};
  const xml = payload.xml || {};

  const duplicates = Array.isArray(payload.duplicates)
    ? payload.duplicates.map((entry) => sanitizeDuplicate(entry))
    : [];
  const duplicatesSummary = computeDuplicatesSummary(duplicates);

  const totalsRecord = {
    products: toNumber(totals.products) ?? 0,
    icmsBase: toNumber(totals.icmsBase) ?? 0,
    icmsValue: toNumber(totals.icmsValue) ?? 0,
    icmsSt: toNumber(totals.icmsSt) ?? 0,
    fcpSt: toNumber(totals.fcpSt) ?? 0,
    discount: toNumber(totals.discount) ?? 0,
    other: toNumber(totals.other) ?? 0,
    freight: toNumber(totals.freight) ?? 0,
    ipi: toNumber(totals.ipi) ?? 0,
    insurance: toNumber(totals.insurance) ?? 0,
    dollar: toNumber(totals.dollar) ?? 0,
    totalValue:
      toNumber(totals.totalValue) ??
      (duplicatesSummary.totalAmount > 0
        ? duplicatesSummary.totalAmount
        : toNumber(totals.products) ?? 0),
  };

  const headerRecord = {
    code: cleanString(header.code),
    number: cleanString(header.number),
    serie: cleanString(header.serie),
    type: cleanString(header.type),
    model: cleanString(header.model),
    issueDate: cleanString(header.issueDate),
    entryDate: cleanString(header.entryDate),
  };

  const selectionRecord = {
    companyId: cleanString(selection.companyId || payload.company?.id || ''),
    supplierId: cleanString(selection.supplierId || supplier.id || ''),
    depositId: cleanString(selection.depositId || ''),
    bankAccountId: cleanString(selection.bankAccountId || ''),
    accountingAccount: cleanString(selection.accountingAccount || ''),
    duplicataEmissionDate: cleanString(selection.duplicataEmissionDate || ''),
  };

  const transport = payload.transport || {};
  const transportRecord = {
    mode: cleanString(transport.mode),
    transporter: clonePlain(transport.transporter) || {},
    vehicle: clonePlain(transport.vehicle) || {},
    volume: clonePlain(transport.volume) || {},
  };

  const xmlRecord = {
    accessKey: cleanString(xml.accessKey || payload.accessKey),
    importAccessKey: cleanString(xml.importAccessKey),
    ambient: cleanString(xml.ambient),
  };

  const additionalInfo = {
    observation: cleanString(additional.observation),
    complementaryFiscal: cleanString(additional.complementaryFiscal),
    paymentCondition: cleanString(additional.paymentCondition),
    paymentForm: cleanString(additional.paymentForm),
  };

  const payloadClone = clonePlain(payload) || {};

  return {
    header: headerRecord,
    companyId: selectionRecord.companyId,
    supplierId: selectionRecord.supplierId,
    supplierName: cleanString(supplier.name),
    supplierDocument: digitsOnly(supplier.document),
    supplierStateRegistration: cleanString(supplier.stateRegistration),
    supplierEmail: cleanString(supplier.email),
    supplierAddressText: cleanString(supplier.addressText),
    totals: totalsRecord,
    duplicates,
    duplicatesSummary,
    items: clonePlain(payload.items) || [],
    references: clonePlain(payload.references) || [],
    payments: clonePlain(payload.payments) || [],
    additionalInfo,
    selection: selectionRecord,
    transport: transportRecord,
    xml: xmlRecord,
    metadata: clonePlain(payload.metadata) || {},
    importedData: clonePlain(payload.importedData) || {},
    payload: payloadClone,
  };
};

router.get('/', async (req, res) => {
  try {
    const { companyId, status, accessKey } = req.query || {};
    const filter = {};
    if (companyId) {
      filter.companyId = cleanString(companyId);
    }
    if (status) {
      filter.status = cleanString(status);
    }
    if (accessKey) {
      const normalizedAccessKey = digitsOnly(accessKey);
      if (normalizedAccessKey) {
        filter['xml.accessKey'] = normalizedAccessKey;
      }
    }

    const drafts = await NfeDraft.find(filter)
      .sort({ updatedAt: -1 })
      .select({
        code: 1,
        status: 1,
        companyId: 1,
        supplierName: 1,
        supplierDocument: 1,
        totals: 1,
        header: 1,
        xml: 1,
        createdAt: 1,
        updatedAt: 1,
      })
      .lean();

    const payload = Array.isArray(drafts)
      ? drafts.map((draft) => ({
          id: String(draft._id || ''),
          code: draft.code ?? null,
          status: draft.status || 'draft',
          companyId: draft.companyId || '',
          supplierName: draft.supplierName || '',
          supplierDocument: draft.supplierDocument || '',
          totalValue: draft.totals?.totalValue ?? null,
          headerCode: draft.header?.code || '',
          number: draft.header?.number || '',
          serie: draft.header?.serie || '',
          type: draft.header?.type || '',
          model: draft.header?.model || '',
          issueDate: draft.header?.issueDate || '',
          entryDate: draft.header?.entryDate || '',
          accessKey: draft.xml?.accessKey || '',
          updatedAt: draft.updatedAt || null,
          createdAt: draft.createdAt || null,
        }))
      : [];

    return res.json({ drafts: payload });
  } catch (error) {
    console.error('Erro ao listar rascunhos de NF-e:', error);
    return res
      .status(500)
      .json({ message: error.message || 'Falha ao consultar os rascunhos de NF-e cadastrados.' });
  }
});

router.post('/', async (req, res) => {
  try {
    const payload = req.body || {};
    const draftData = buildDraftDocumentFromPayload(payload);

    const lastDraft = await NfeDraft.findOne().sort({ code: -1 }).select('code').lean();
    const lastCode = lastDraft && Number.isFinite(lastDraft.code) ? lastDraft.code : 0;
    const nextCode = lastCode + 1;

    draftData.code = nextCode;
    if (!draftData.header.code) {
      draftData.header.code = String(nextCode).padStart(4, '0');
    }

    const draft = await NfeDraft.create(draftData);
    return res.status(201).json({ draft });
  } catch (error) {
    console.error('Erro ao salvar rascunho da NF-e:', error);
    return res
      .status(500)
      .json({ message: error.message || 'Falha ao salvar o rascunho da NF-e.' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ message: 'Identificador do rascunho não informado.' });
    }

    const draft = await NfeDraft.findById(id).lean();
    if (!draft) {
      return res.status(404).json({ message: 'Rascunho de NF-e não encontrado.' });
    }

    draft.id = String(draft._id || id);
    return res.json({ draft });
  } catch (error) {
    console.error('Erro ao consultar rascunho da NF-e:', error);
    return res
      .status(500)
      .json({ message: error.message || 'Falha ao recuperar os dados do rascunho da NF-e.' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ message: 'Identificador do rascunho não informado.' });
    }

    const existingDraft = await NfeDraft.findById(id);
    if (!existingDraft) {
      return res.status(404).json({ message: 'Rascunho de NF-e não encontrado.' });
    }

    const payload = req.body || {};
    const draftData = buildDraftDocumentFromPayload(payload);
    draftData.code = existingDraft.code;
    if (!draftData.header.code) {
      draftData.header.code = existingDraft.header?.code || String(existingDraft.code).padStart(4, '0');
    }

    existingDraft.set(draftData);
    const updatedDraft = await existingDraft.save();
    return res.json({ draft: updatedDraft });
  } catch (error) {
    console.error('Erro ao atualizar rascunho da NF-e:', error);
    return res
      .status(500)
      .json({ message: error.message || 'Falha ao atualizar o rascunho da NF-e.' });
  }
});

router.post('/:id/approve', async (req, res) => {
  const { id } = req.params;
  if (!id || !mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ message: 'Identificador da nota inválido.' });
  }

  let session = null;
  let accountPayableRecord = null;

  try {
    session = await mongoose.startSession();
    let updatedDraft = null;

    await session.withTransaction(async () => {
      const draft = await NfeDraft.findById(id).session(session);
      if (!draft) {
        throw buildHttpError(404, 'Entrada de NF-e não encontrada.');
      }

      if (isApprovedStatus(draft.status)) {
        throw buildHttpError(409, 'Esta entrada de NF-e já está aprovada e não pode ser alterada.');
      }

      if (req.body && typeof req.body === 'object' && Object.keys(req.body).length > 0) {
        const draftData = buildDraftDocumentFromPayload(req.body);
        draftData.code = draft.code;
        if (!draftData.header.code) {
          draftData.header.code = draft.header?.code || String(draft.code).padStart(4, '0');
        }
        draft.set(draftData);
      }

      const companyId = draft.companyId || draft.selection?.companyId || '';
      if (!companyId || !mongoose.Types.ObjectId.isValid(companyId)) {
        throw buildHttpError(400, 'Selecione a empresa responsável antes de aprovar a nota.', {
          focusTab: 'dados',
          field: 'company',
        });
      }
      const companyObjectId = new mongoose.Types.ObjectId(companyId);
      const company = await Store.findById(companyObjectId).session(session);
      if (!company) {
        throw buildHttpError(400, 'A empresa selecionada não foi encontrada.', {
          focusTab: 'dados',
          field: 'company',
        });
      }

      const supplierId = draft.supplierId || draft.selection?.supplierId || '';
      if (!supplierId || !mongoose.Types.ObjectId.isValid(supplierId)) {
        throw buildHttpError(400, 'Vincule o fornecedor cadastrado antes de aprovar a nota.', {
          focusTab: 'dados',
          field: 'supplier',
        });
      }
      const supplier = await Supplier.findById(supplierId)
        .populate({ path: 'otherInfo.accountingAccount', select: 'code name companies status' })
        .session(session);
      if (!supplier) {
        throw buildHttpError(400, 'O fornecedor selecionado não foi encontrado.', {
          focusTab: 'dados',
          field: 'supplier',
        });
      }

      const accountingAccountRef = supplier.otherInfo?.accountingAccount;
      if (!accountingAccountRef || !accountingAccountRef._id) {
        throw buildHttpError(400, 'Defina a conta contábil do fornecedor antes de aprovar.', {
          focusTab: 'duplicatas',
          field: 'accountingAccount',
        });
      }

      const accountingAccount = await AccountingAccount.findById(accountingAccountRef._id).session(session);
      if (!accountingAccount) {
        throw buildHttpError(400, 'A conta contábil vinculada ao fornecedor não foi encontrada.', {
          focusTab: 'duplicatas',
          field: 'accountingAccount',
        });
      }

      if (
        Array.isArray(accountingAccount.companies) &&
        accountingAccount.companies.length > 0 &&
        !accountingAccount.companies.some(
          (companyEntry) => companyEntry.toString() === companyObjectId.toString()
        )
      ) {
        throw buildHttpError(
          400,
          'A conta contábil do fornecedor não está vinculada à empresa selecionada.',
          {
            focusTab: 'duplicatas',
            field: 'accountingAccount',
          }
        );
      }

      const depositId = draft.selection?.depositId || '';
      if (!depositId || !mongoose.Types.ObjectId.isValid(depositId)) {
        throw buildHttpError(400, 'Selecione o depósito para lançar o estoque de entrada.', {
          focusTab: 'dados',
          field: 'deposit',
        });
      }
      const deposit = await Deposit.findById(depositId).session(session);
      if (!deposit) {
        throw buildHttpError(400, 'O depósito selecionado não foi encontrado.', {
          focusTab: 'dados',
          field: 'deposit',
        });
      }
      if (deposit.empresa?.toString() !== companyObjectId.toString()) {
        throw buildHttpError(400, 'O depósito selecionado não pertence à empresa informada.', {
          focusTab: 'dados',
          field: 'deposit',
        });
      }

      const items = Array.isArray(draft.items) ? draft.items : [];
      if (!items.length) {
        throw buildHttpError(
          400,
          'Nenhum item foi importado para esta nota. Importe o XML antes de aprovar.',
          {
            focusTab: 'produtos',
          }
        );
      }

      const unmatchedItems = items.filter(
        (item) => !item || item.validationStatus !== 'matched' || !extractProductId(item.matchedProduct || item)
      );
      if (unmatchedItems.length) {
        throw buildHttpError(
          400,
          'Existe produto sem vinculação ao cadastro. Resolva todos os itens antes de aprovar.',
          {
            focusTab: 'produtos',
          }
        );
      }

      const productQuantities = new Map();
      items.forEach((item) => {
        const productId = extractProductId(item.matchedProduct || item);
        const quantity = computeEntryStockQuantity(item);
        if (!productId) return;
        if (!Number.isFinite(quantity)) return;
        const normalizedQuantity = quantity > 0 ? quantity : 0;
        const key = String(productId);
        const current = productQuantities.get(key) || 0;
        productQuantities.set(key, current + normalizedQuantity);
      });

      if (!productQuantities.size) {
        throw buildHttpError(400, 'Informe o estoque de entrada dos produtos antes de aprovar.', {
          focusTab: 'produtos',
        });
      }

      const duplicates = Array.isArray(draft.duplicates) ? draft.duplicates : [];
      if (!duplicates.length) {
        throw buildHttpError(400, 'Informe as duplicatas da nota antes de aprovar.', {
          focusTab: 'duplicatas',
        });
      }

      const bankAccountFallback = draft.selection?.bankAccountId || '';
      const installmentsData = [];
      const bankAccountIds = new Set();
      let duplicatesTotal = 0;

      duplicates.forEach((duplicate, index) => {
        const dueDate = parseDateInput(
          duplicate?.manualDueDate || duplicate?.dueDate || duplicate?.originalDueDate
        );
        if (!dueDate) {
          throw buildHttpError(400, `Defina o vencimento da parcela ${duplicate?.number || index + 1}.`, {
            focusTab: 'duplicatas',
            duplicateIndex: index,
            field: 'dueDate',
          });
        }

        const valueNumeric = toNumber(duplicate?.value);
        if (!Number.isFinite(valueNumeric) || valueNumeric <= 0) {
          throw buildHttpError(400, `Informe um valor válido para a parcela ${duplicate?.number || index + 1}.`, {
            focusTab: 'duplicatas',
            duplicateIndex: index,
            field: 'value',
          });
        }

        const bankAccountId = duplicate?.bankAccount || bankAccountFallback;
        if (!bankAccountId || !mongoose.Types.ObjectId.isValid(bankAccountId)) {
          throw buildHttpError(400, `Selecione a conta corrente da parcela ${duplicate?.number || index + 1}.`, {
            focusTab: 'duplicatas',
            duplicateIndex: index,
            field: 'bankAccount',
          });
        }

        bankAccountIds.add(String(bankAccountId));
        duplicatesTotal += valueNumeric;

        const numericNumber = Number.parseInt(duplicate?.number, 10);
        const parcelNumber = Number.isFinite(numericNumber) && numericNumber > 0 ? numericNumber : index + 1;
        const dueDateString = dueDate.toISOString().slice(0, 10);

        duplicate.number = parcelNumber;
        duplicate.dueDate = dueDateString;
        duplicate.manualDueDate = dueDateString;
        duplicate.value = valueNumeric;
        duplicate.bankAccount = String(bankAccountId);
        duplicate.bankAccountIsManual = true;

        installmentsData.push({
          index,
          number: parcelNumber,
          dueDate,
          value: valueNumeric,
          bankAccountId: String(bankAccountId),
        });
      });

      const bankAccounts = bankAccountIds.size
        ? await BankAccount.find({ _id: { $in: Array.from(bankAccountIds) } })
            .session(session)
            .lean()
        : [];
      const bankAccountMap = new Map(bankAccounts.map((account) => [String(account._id), account]));

      bankAccountIds.forEach((bankId) => {
        const account = bankAccountMap.get(bankId);
        if (!account) {
          throw buildHttpError(400, 'Alguma conta corrente informada nas duplicatas não foi encontrada.', {
            focusTab: 'duplicatas',
            field: 'bankAccount',
          });
        }
        if (account.company?.toString() !== companyObjectId.toString()) {
          throw buildHttpError(
            400,
            'As contas correntes das duplicatas devem pertencer à empresa selecionada.',
            {
              focusTab: 'duplicatas',
              field: 'bankAccount',
            }
          );
        }
      });

      const issueDate =
        parseDateInput(draft.selection?.duplicataEmissionDate) ||
        parseDateInput(draft.header?.issueDate) ||
        new Date();

      const dueDate =
        installmentsData.reduce((latest, installment) => {
          if (!installment.dueDate) return latest;
          if (!latest) return installment.dueDate;
          return installment.dueDate > latest ? installment.dueDate : latest;
        }, null) || issueDate;

      const roundedTotal = formatCurrencyValue(duplicatesTotal);

      draft.duplicatesSummary = computeDuplicatesSummary(draft.duplicates);
      draft.duplicatesSummary.totalAmount = roundedTotal;
      draft.duplicatesSummary.count = duplicates.length;

      if (!draft.totals || typeof draft.totals !== 'object') {
        draft.totals = {};
      }
      draft.totals.totalValue = roundedTotal;
      draft.markModified('duplicates');
      draft.markModified('totals');

      for (const [productId, quantity] of productQuantities.entries()) {
        if (!Number.isFinite(quantity)) continue;
        const product = await Product.findById(productId).session(session);
        if (!product) {
          throw buildHttpError(
            400,
            'Alguns produtos vinculados não foram encontrados. Atualize a página e valide os itens novamente.',
            { focusTab: 'produtos' }
          );
        }
        if (!Array.isArray(product.estoques)) {
          product.estoques = [];
        }
        const depositKey = deposit._id.toString();
        let stockEntry = product.estoques.find(
          (entry) => entry?.deposito && entry.deposito.toString() === depositKey
        );
        if (!stockEntry) {
          stockEntry = { deposito: deposit._id, quantidade: 0, unidade: product.unidade || 'UN' };
          product.estoques.push(stockEntry);
        }
        const currentQuantity =
          typeof stockEntry.quantidade === 'number'
            ? stockEntry.quantidade
            : toNumber(stockEntry.quantidade);
        const baseQuantity = Number.isFinite(currentQuantity) ? currentQuantity : 0;
        const nextQuantity = Math.round((baseQuantity + quantity) * 1000000) / 1000000;
        stockEntry.quantidade = nextQuantity;
        product.markModified('estoques');
        await product.save({ session });
      }

      const payableInstallments = installmentsData.map((installment) => {
        const account = bankAccountMap.get(installment.bankAccountId);
        return {
          number: installment.number,
          issueDate,
          dueDate: installment.dueDate,
          value: formatCurrencyValue(installment.value),
          bankAccount: account._id,
          accountingAccount: accountingAccount._id,
          status: 'pending',
        };
      });

      const payablePayload = {
        code: await generatePayableSequentialCode(session),
        company: companyObjectId,
        partyType: 'Supplier',
        party: supplier._id,
        installmentsCount: payableInstallments.length,
        issueDate,
        dueDate,
        totalValue: roundedTotal,
        bankAccount: payableInstallments[0].bankAccount,
        accountingAccount: accountingAccount._id,
        paymentMethod: undefined,
        carrier: '',
        bankDocumentNumber: '',
        interestFeeValue: 0,
        monthlyInterestPercent: 0,
        interestPercent: 0,
        notes: '',
        installments: payableInstallments,
      };

      const createdPayable = await AccountPayable.create([payablePayload], { session });
      accountPayableRecord = createdPayable[0].toObject();

      draft.status = 'approved';
      const metadata = draft.metadata && typeof draft.metadata === 'object' ? draft.metadata : {};
      metadata.accountPayableId = accountPayableRecord._id;
      metadata.approvedAt = new Date().toISOString();
      draft.metadata = metadata;
      draft.markModified('metadata');

      await draft.save({ session });
      updatedDraft = draft;
    });

    const draftPayload = updatedDraft
      ? await NfeDraft.findById(updatedDraft._id).lean()
      : null;

    return res.json({
      draft: draftPayload,
      accountPayable: accountPayableRecord
        ? {
            _id: accountPayableRecord._id,
            code: accountPayableRecord.code,
            totalValue: accountPayableRecord.totalValue,
            dueDate: accountPayableRecord.dueDate,
            installmentsCount: accountPayableRecord.installmentsCount,
          }
        : null,
    });
  } catch (error) {
    console.error('Erro ao aprovar entrada de NF-e:', error);
    const status = Number.isInteger(error.status) ? error.status : 500;
    const responsePayload = {
      message: error.message || 'Não foi possível aprovar a entrada da NF-e.',
    };
    if (error.details) {
      responsePayload.details = error.details;
    }
    if (status === 409 && !responsePayload.draft) {
      try {
        const draftSnapshot = await NfeDraft.findById(id).lean();
        if (draftSnapshot) {
          responsePayload.draft = draftSnapshot;
        }
      } catch (_) {
        /* ignore */
      }
    }
    return res.status(status).json(responsePayload);
  } finally {
    if (session) {
      await session.endSession();
    }
  }
});

router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  if (!id || !mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ message: 'Identificador da nota inválido.' });
  }

  let session = null;
  let removedPayableId = null;

  try {
    session = await mongoose.startSession();

    await session.withTransaction(async () => {
      const draft = await NfeDraft.findById(id).session(session);
      if (!draft) {
        throw buildHttpError(404, 'Entrada de NF-e não encontrada.');
      }

      const approved = isApprovedStatus(draft.status);

      if (approved) {
        const depositId = draft.selection?.depositId;
        if (!depositId || !mongoose.Types.ObjectId.isValid(depositId)) {
          throw buildHttpError(
            400,
            'Não foi possível estornar o estoque da nota aprovada: depósito vinculado inválido.'
          );
        }

        const deposit = await Deposit.findById(depositId).session(session);
        if (!deposit) {
          throw buildHttpError(
            400,
            'Não foi possível estornar o estoque da nota aprovada: depósito vinculado não encontrado.'
          );
        }

        const { quantities: productQuantities, details: productDetails } =
          collectProductEntrySummary(Array.isArray(draft.items) ? draft.items : []);
        const depositKey = deposit._id.toString();

        for (const [productId, quantity] of productQuantities.entries()) {
          if (!Number.isFinite(quantity) || quantity <= 0) continue;

          const product = await Product.findById(productId).session(session);
          if (!product) {
            const info = productDetails.get(productId) || {};
            const label = info.name || info.code || 'produto vinculado';
            throw buildHttpError(
              400,
              `Não foi possível localizar o produto ${label} para estornar o estoque da nota.`
            );
          }

          if (!Array.isArray(product.estoques)) {
            const label =
              product.nome || product.name || (productDetails.get(productId) || {}).name || 'produto';
            throw buildHttpError(
              400,
              `O produto ${label} não possui controle de estoque para o depósito vinculado à nota.`
            );
          }

          const stockEntry = product.estoques.find(
            (entry) => entry?.deposito && entry.deposito.toString() === depositKey
          );
          if (!stockEntry) {
            const info = productDetails.get(productId) || {};
            const label =
              info.name || product.nome || product.name || info.code || 'produto vinculado';
            throw buildHttpError(
              400,
              `Não foi possível estornar o estoque do produto ${label}: depósito não localizado no cadastro do produto.`
            );
          }

          const currentQuantityValue =
            typeof stockEntry.quantidade === 'number'
              ? stockEntry.quantidade
              : toNumber(stockEntry.quantidade);
          const baseQuantity = Number.isFinite(currentQuantityValue) ? currentQuantityValue : 0;
          const nextQuantityRaw = Math.round((baseQuantity - quantity) * 1000000) / 1000000;
          const nextQuantity = Math.abs(nextQuantityRaw) <= 0.0000005 ? 0 : nextQuantityRaw;
          stockEntry.quantidade = nextQuantity;
          product.markModified('estoques');
          await product.save({ session });
        }

        const accountPayableId = draft.metadata?.accountPayableId;
        if (accountPayableId && mongoose.Types.ObjectId.isValid(accountPayableId)) {
          const payable = await AccountPayable.findById(accountPayableId).session(session);
          if (payable) {
            await payable.deleteOne({ session });
            removedPayableId = payable._id.toString();
          }
        }
      }

      await draft.deleteOne({ session });
    });

    return res.json({
      message: 'Entrada da NF-e removida com sucesso.',
      accountPayableRemoved: Boolean(removedPayableId),
      accountPayableId: removedPayableId,
    });
  } catch (error) {
    console.error('Erro ao excluir entrada de NF-e:', error);
    const status = Number.isInteger(error.status) ? error.status : 500;
    const responsePayload = {
      message: error.message || 'Não foi possível excluir a entrada da NF-e.',
    };
    if (error.details) {
      responsePayload.details = error.details;
    }
    return res.status(status).json(responsePayload);
  } finally {
    if (session) {
      await session.endSession();
    }
  }
});

module.exports = router;
