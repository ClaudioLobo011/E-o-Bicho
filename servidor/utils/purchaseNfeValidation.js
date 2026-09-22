const cleanString = (value) => (value === null || typeof value === 'undefined' ? '' : String(value).trim());

const digitsOnly = (value) => cleanString(value).replace(/\D+/g, '');

const toNumber = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const raw = cleanString(value);
  if (!raw) return null;

  let normalized = raw.replace(/\s+/g, '');
  if (normalized.includes(',') && normalized.includes('.')) {
    normalized = normalized.lastIndexOf(',') > normalized.lastIndexOf('.')
      ? normalized.replace(/\./g, '').replace(',', '.')
      : normalized.replace(/,/g, '');
  } else if (normalized.includes(',')) {
    normalized = normalized.replace(',', '.');
  }

  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : null;
};

const toMoneyCents = (value) => {
  const numeric = toNumber(value);
  return Number.isFinite(numeric) ? Math.round(numeric * 100) : null;
};

const isValidNfeAccessKey = (value) => {
  const accessKey = digitsOnly(value);
  if (accessKey.length !== 44) return false;

  const expectedDigit = Number(accessKey.charAt(43));
  let weight = 2;
  let sum = 0;
  for (let index = 42; index >= 0; index -= 1) {
    sum += Number(accessKey.charAt(index)) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const remainder = sum % 11;
  const calculatedDigit = remainder === 0 || remainder === 1 ? 0 : 11 - remainder;
  return calculatedDigit === expectedDigit;
};

const hasDateValue = (value) => {
  const raw = cleanString(value);
  if (!raw) return false;
  const normalized = raw.length === 10 ? `${raw}T00:00:00` : raw;
  return !Number.isNaN(new Date(normalized).getTime());
};

const getImportedData = (draft = {}) => {
  const direct = draft?.importedData;
  if (direct && typeof direct === 'object' && Object.keys(direct).length) return direct;
  const payloadData = draft?.payload?.importedData;
  return payloadData && typeof payloadData === 'object' ? payloadData : {};
};

const validatePurchaseNfeApproval = ({ draft = {}, company = {}, supplier = {}, isReciboEntry = false, recipientMismatchConfirmation = null } = {}) => {
  const issues = [];
  const addIssue = (message, focusTab, field) => {
    issues.push({ message, focusTab, ...(field ? { field } : {}) });
  };

  const header = draft?.header || {};
  if (!cleanString(header.number)) {
    addIssue('Informe o número do documento antes de aprovar.', 'dados', 'number');
  }
  if (!hasDateValue(header.issueDate)) {
    addIssue('Informe uma data de emissão válida antes de aprovar.', 'dados', 'issueDate');
  }
  if (!hasDateValue(header.entryDate)) {
    addIssue('Informe uma data de entrada válida antes de aprovar.', 'dados', 'entryDate');
  }
  if (!cleanString(header.entryType)) {
    addIssue('Selecione o tipo de entrada antes de aprovar.', 'dados', 'entryType');
  }

  if (isReciboEntry) return { valid: issues.length === 0, issues };

  const importedData = getImportedData(draft);
  const importedModel = cleanString(importedData?.ide?.model);
  const model = cleanString(header.model || importedModel);
  if (model !== '55' || (importedModel && importedModel !== '55')) {
    addIssue('A entrada aceita somente XML de NF-e modelo 55.', 'dados', 'model');
  }

  const snapshotAccessKey = digitsOnly(draft?.xml?.accessKey);
  const importedAccessKey = digitsOnly(importedData?.accessKey);
  const accessKey = snapshotAccessKey || importedAccessKey;
  if (!isValidNfeAccessKey(accessKey)) {
    addIssue('A chave de acesso da NF-e é inválida.', 'dados', 'accessKey');
  } else if (snapshotAccessKey && importedAccessKey && snapshotAccessKey !== importedAccessKey) {
    addIssue('A chave de acesso salva diverge do XML importado.', 'dados', 'accessKey');
  }

  const protocolStatus = cleanString(importedData?.protocol?.status);
  const protocolNumber = cleanString(importedData?.protocol?.number);
  if (protocolStatus !== '100' || !protocolNumber) {
    addIssue('O XML precisa ter protocolo de autorização válido (cStat 100).', 'dados', 'accessKey');
  }

  const destinationDocument = digitsOnly(importedData?.dest?.document);
  const companyDocument = digitsOnly(company?.cnpj);
  if (!destinationDocument) {
    addIssue('O documento do destinatário não foi encontrado no XML.', 'dados', 'company');
  } else if (!companyDocument) {
    addIssue('A empresa selecionada não possui CNPJ cadastrado.', 'dados', 'company');
  } else if (destinationDocument !== companyDocument) {
    const confirmation = recipientMismatchConfirmation;
    const confirmed = confirmation?.confirmed === true &&
      cleanString(confirmation.companyId) === cleanString(company._id) &&
      digitsOnly(confirmation.companyDocument) === companyDocument &&
      digitsOnly(confirmation.destinationDocument) === destinationDocument &&
      digitsOnly(confirmation.accessKey) === accessKey;
    if (!confirmed) {
      addIssue('Confirme a entrada com CNPJ da empresa divergente do destinatário da NF-e.', 'dados', 'company');
    }
  }

  const issuerDocument = digitsOnly(importedData?.emit?.document);
  const supplierDocument = digitsOnly(supplier?.cnpj);
  if (!issuerDocument) {
    addIssue('O documento do emitente não foi encontrado no XML.', 'dados', 'supplier');
  } else if (!supplierDocument) {
    addIssue('O fornecedor selecionado não possui CNPJ cadastrado.', 'dados', 'supplier');
  } else if (issuerDocument !== supplierDocument) {
    addIssue('O CNPJ do fornecedor selecionado diverge do emitente da NF-e.', 'dados', 'supplier');
  }

  const totalCents = toMoneyCents(draft?.totals?.totalValue);
  if (!Number.isInteger(totalCents) || totalCents <= 0) {
    addIssue('O valor total da NF-e deve ser maior que zero.', 'totais', 'totalValue');
  }

  const duplicates = Array.isArray(draft?.duplicates) ? draft.duplicates : [];
  if (!duplicates.length) {
    addIssue('Informe as duplicatas da nota antes de aprovar.', 'duplicatas');
  } else {
    const duplicateCents = duplicates.reduce((sum, duplicate) => {
      const valueCents = toMoneyCents(duplicate?.value);
      return sum + (Number.isInteger(valueCents) ? valueCents : 0);
    }, 0);
    if (Number.isInteger(totalCents) && totalCents > 0 && duplicateCents !== totalCents) {
      addIssue(
        'A soma das duplicatas deve ser exatamente igual ao valor total da NF-e.',
        'duplicatas',
        'value'
      );
    }
  }

  return { valid: issues.length === 0, issues };
};

module.exports = {
  digitsOnly,
  isValidNfeAccessKey,
  toMoneyCents,
  validatePurchaseNfeApproval,
};
