const express = require('express');
const NfeDraft = require('../models/NfeDraft');

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
    const { companyId, status } = req.query || {};
    const filter = {};
    if (companyId) {
      filter.companyId = cleanString(companyId);
    }
    if (status) {
      filter.status = cleanString(status);
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

module.exports = router;
