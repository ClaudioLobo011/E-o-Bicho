const zlib = require('zlib');
const { DOMParser } = require('@xmldom/xmldom');
const forge = require('node-forge');

const { decryptBuffer, decryptText } = require('../utils/certificates');
const { extractCertificatePair } = require('../utils/pkcs12');
const {
  performSoapRequest,
  resolveUfCode,
  extractSection,
  extractTagContent,
  SefazTransmissionError,
} = require('./sefazTransmitter');

const SOAP_VERSIONS = {
  SOAP12: '1.2',
  SOAP11: '1.1',
};

const digitsOnly = (value) => String(value || '').replace(/\D+/g, '');

const normalizeSoapVersion = (input) => {
  const normalized = String(input || '').trim().toLowerCase();
  if (!normalized) {
    return SOAP_VERSIONS.SOAP12;
  }
  if (normalized === '11' || normalized === '1.1' || normalized === 'soap11') {
    return SOAP_VERSIONS.SOAP11;
  }
  return SOAP_VERSIONS.SOAP12;
};

const DEFAULT_SOAP_VERSION = normalizeSoapVersion(process.env.NFE_DFE_SOAP_VERSION);
const DEBUG_LOG_ENABLED = String(process.env.NFE_DFE_DEBUG || '').trim() === '1';

const DEFAULT_ENVIRONMENT = (process.env.SEFAZ_DFE_ENVIRONMENT || 'producao').toLowerCase();
const VALID_ENVIRONMENTS = new Set(['producao', 'homologacao']);

const DFE_ENDPOINTS = {
  homologacao:
    process.env.NFE_AN_DFE_HOMOLOG_URL ||
    process.env.NFE_AN_DFE_URL_HOMOLOG ||
    'https://hom.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx',
  producao:
    process.env.NFE_AN_DFE_URL ||
    process.env.NFE_AN_DFE_URL_PROD ||
    'https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx',
};

const DFE_SOAP_ACTION =
  'http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe/nfeDistDFeInteresse';
const DFE_NAMESPACE = 'http://www.portalfiscal.inf.br/nfe';

const DEFAULT_NATIONAL_AUTHOR_UF = (() => {
  const fallback = (process.env.SEFAZ_DFE_NATIONAL_AUTHOR_UF || '33')
    .toString()
    .replace(/\D+/g, '')
    .padStart(2, '0');
  return /^[0-9]{2}$/.test(fallback) && fallback !== '00' ? fallback : '33';
})();

const AUTHOR_UF_OVERRIDES = {
  RJ: '33',
};

const MAX_ITERATIONS = 25;
const MAX_RESULTS = 500;

const normalizeEnvironment = (environment) => {
  if (!environment) return DEFAULT_ENVIRONMENT;
  const normalized = String(environment).trim().toLowerCase();
  if (VALID_ENVIRONMENTS.has(normalized)) {
    return normalized;
  }
  return DEFAULT_ENVIRONMENT;
};

const padNsU = (value) => {
  const digits = digitsOnly(value);
  return digits.padStart(15, '0');
};

const compareNsU = (a, b) => {
  try {
    const aBig = BigInt(padNsU(a));
    const bBig = BigInt(padNsU(b));
    if (aBig === bBig) return 0;
    return aBig > bBig ? 1 : -1;
  } catch (error) {
    const aNum = Number(padNsU(a));
    const bNum = Number(padNsU(b));
    if (!Number.isFinite(aNum) || !Number.isFinite(bNum)) {
      return String(padNsU(a)).localeCompare(String(padNsU(b)));
    }
    if (aNum === bNum) return 0;
    return aNum > bNum ? 1 : -1;
  }
};

const buildSoap12Headers = (action = DFE_SOAP_ACTION) => ({
  'Content-Type': `application/soap+xml; charset=utf-8; action="${action}"`,
  Accept: 'application/soap+xml',
  Connection: 'close',
});

const buildSoap11Headers = (action = DFE_SOAP_ACTION) => ({
  'Content-Type': 'text/xml; charset=utf-8',
  Accept: 'text/xml',
  Connection: 'close',
  SOAPAction: `"${action}"`,
});

const buildDistributionBody = ({ tpAmb, cUFAutor, cnpj, innerXml }) => {
  const normalizedCnpj = digitsOnly(cnpj).padStart(14, '0');
  return [
    `<distDFeInt xmlns="${DFE_NAMESPACE}" versao="1.01">`,
    `  <tpAmb>${tpAmb}</tpAmb>`,
    `  <cUFAutor>${cUFAutor}</cUFAutor>`,
    `  <CNPJ>${normalizedCnpj}</CNPJ>`,
    `  ${innerXml}`,
    '</distDFeInt>',
  ].join('\n');
};

const buildEnvelope = ({ body, soapVersion = SOAP_VERSIONS.SOAP12 }) => {
  const normalizedVersion =
    soapVersion === SOAP_VERSIONS.SOAP11 ? SOAP_VERSIONS.SOAP11 : SOAP_VERSIONS.SOAP12;

  const namespaceConfig =
    normalizedVersion === SOAP_VERSIONS.SOAP11
      ? { prefix: 'soap', uri: 'http://schemas.xmlsoap.org/soap/envelope/' }
      : { prefix: 'soap12', uri: 'http://www.w3.org/2003/05/soap-envelope' };

  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    `<${namespaceConfig.prefix}:Envelope xmlns:${namespaceConfig.prefix}="${namespaceConfig.uri}"`,
    '                 xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"',
    '                 xmlns:xsd="http://www.w3.org/2001/XMLSchema">',
    `  <${namespaceConfig.prefix}:Body>`,
    '    <nfeDistDFeInteresse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe">',
    `      ${body}`,
    '    </nfeDistDFeInteresse>',
    `  </${namespaceConfig.prefix}:Body>`,
    `</${namespaceConfig.prefix}:Envelope>`,
  ].join('\n');
};

const buildEnvelopeConsNSU = ({ tpAmb, cUFAutor, cnpj, ultNSU, nsu, soapVersion }) => {
  const hasSpecificNsu = nsu !== undefined && nsu !== null && String(nsu).trim() !== '';
  const normalizedNsU = padNsU(hasSpecificNsu ? nsu : ultNSU || '0');
  const tagName = hasSpecificNsu ? 'consNSU' : 'distNSU';
  const valueTag = hasSpecificNsu ? 'NSU' : 'ultNSU';
  const innerXml =
    [`<${tagName}>`, `  <${valueTag}>${normalizedNsU}</${valueTag}>`, `</${tagName}>`].join('\n');
  return buildEnvelope({
    body: buildDistributionBody({ tpAmb, cUFAutor, cnpj, innerXml }),
    soapVersion,
  });
};

const buildEnvelopeConsChNFe = ({ tpAmb, cUFAutor, cnpj, accessKey, soapVersion }) => {
  const normalizedKey = digitsOnly(accessKey).padStart(44, '0');
  const innerXml = [`<consChNFe>`, `  <chNFe>${normalizedKey}</chNFe>`, '</consChNFe>'].join('\n');
  return buildEnvelope({
    body: buildDistributionBody({ tpAmb, cUFAutor, cnpj, innerXml }),
    soapVersion,
  });
};

const decodeDocZip = (content) => {
  if (!content) return '';
  const buffer = Buffer.from(String(content).trim(), 'base64');
  if (!buffer.length) return '';
  try {
    return zlib.gunzipSync(buffer).toString('utf8');
  } catch (error) {
    try {
      return zlib.inflateRawSync(buffer).toString('utf8');
    } catch (inflateError) {
      throw new Error('Não foi possível descompactar o documento retornado pela SEFAZ.');
    }
  }
};

const getTextContent = (node, tagName) => {
  if (!node) return '';
  const elements = node.getElementsByTagName(tagName);
  if (!elements || !elements.length) return '';
  const [element] = elements;
  if (!element || !element.textContent) return '';
  return String(element.textContent).trim();
};

const parseSoapFault = (xml) => {
  if (!xml) return null;
  const faultSection = extractSection(xml, 'Fault') || xml;
  const code =
    extractTagContent(faultSection, 'Value') ||
    extractTagContent(faultSection, 'faultcode') ||
    extractTagContent(faultSection, 'Code');
  const reason =
    extractTagContent(faultSection, 'Text') ||
    extractTagContent(faultSection, 'faultstring') ||
    extractTagContent(faultSection, 'Reason');

  if (!code && !reason) {
    return null;
  }

  return {
    code: (code || '').trim(),
    reason: (reason || '').trim(),
  };
};

const parseDecimal = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (!value && value !== 0) return null;
  const normalized = String(value).trim().replace('.', '').replace(',', '.');
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

const toIsoString = (value) => {
  if (!value && value !== 0) return '';
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return '';
    return value.toISOString();
  }
  const raw = String(value).trim();
  if (!raw) return '';
  const date = new Date(raw);
  if (!Number.isNaN(date.getTime())) {
    return date.toISOString();
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const parsed = new Date(`${raw}T00:00:00`);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }
  return '';
};

const parseResNFe = (xmlContent, { companyDocument }) => {
  const parser = new DOMParser();
  const document = parser.parseFromString(xmlContent, 'text/xml');
  const root = document.getElementsByTagName('resNFe')[0] || document.documentElement;
  if (!root) return null;

  const accessKey = getTextContent(root, 'chNFe');
  const supplierDocument = digitsOnly(getTextContent(root, 'CNPJ') || getTextContent(root, 'CPF'));
  const supplierName = getTextContent(root, 'xNome');
  const issueDate = toIsoString(getTextContent(root, 'dhEmi'));
  const serie = getTextContent(root, 'serie');
  const number = getTextContent(root, 'nNF');
  const totalValue = parseDecimal(getTextContent(root, 'vNF'));
  const tpNF = getTextContent(root, 'tpNF');
  const statusCode = getTextContent(root, 'cSitNFe');

  const destinationDocument = digitsOnly(
    getTextContent(root, 'CNPJDest') || getTextContent(root, 'CPFDest')
  );
  if (companyDocument && destinationDocument && destinationDocument !== companyDocument) {
    return null;
  }

  if (!accessKey) {
    return null;
  }

  return {
    source: 'resNFe',
    accessKey,
    supplierDocument,
    supplierName,
    issueDate,
    serie,
    number,
    totalValue,
    tpNF,
    statusCode,
    xml: xmlContent,
  };
};

const parseProcNFe = (xmlContent, { companyDocument }) => {
  const parser = new DOMParser();
  const document = parser.parseFromString(xmlContent, 'text/xml');
  const procNFe = document.getElementsByTagName('procNFe')[0];
  const nfe = procNFe ? procNFe.getElementsByTagName('NFe')[0] : document.getElementsByTagName('NFe')[0];
  if (!nfe) return null;

  const infNFe = nfe.getElementsByTagName('infNFe')[0] || nfe;
  const ide = infNFe.getElementsByTagName('ide')[0];
  const emit = infNFe.getElementsByTagName('emit')[0];
  const dest = infNFe.getElementsByTagName('dest')[0];
  const totals = infNFe.getElementsByTagName('ICMSTot')[0];

  const accessKeyRaw = infNFe.getAttribute('Id') || '';
  const accessKey = digitsOnly(accessKeyRaw.replace(/^NFe/i, ''));
  const supplierDocument = digitsOnly(getTextContent(emit, 'CNPJ') || getTextContent(emit, 'CPF'));
  const supplierName = getTextContent(emit, 'xNome');
  const issueDate = toIsoString(getTextContent(ide, 'dhEmi') || getTextContent(ide, 'dEmi'));
  const serie = getTextContent(ide, 'serie');
  const number = getTextContent(ide, 'nNF');
  const totalValue = parseDecimal(getTextContent(totals, 'vNF'));
  const tpNF = getTextContent(ide, 'tpNF');

  const destinationDocument = digitsOnly(getTextContent(dest, 'CNPJ') || getTextContent(dest, 'CPF'));
  if (companyDocument && destinationDocument && destinationDocument !== companyDocument) {
    return null;
  }

  if (!accessKey) {
    return null;
  }

  return {
    source: 'procNFe',
    accessKey,
    supplierDocument,
    supplierName,
    issueDate,
    serie,
    number,
    totalValue,
    tpNF,
    statusCode: '1',
    xml: xmlContent,
  };
};

const parseDistributionDocument = (entry, context) => {
  if (!entry || !entry.xml) return null;
  const trimmed = entry.xml.trim();
  if (!trimmed) return null;
  if (/</.test(trimmed) === false) {
    return null;
  }
  if (/<resNFe[\s>]/i.test(trimmed)) {
    return parseResNFe(trimmed, context);
  }
  if (/<procNFe[\s>]/i.test(trimmed) || /<NFe[\s>]/i.test(trimmed)) {
    return parseProcNFe(trimmed, context);
  }
  return null;
};

const mapStatus = (statusCode) => {
  const normalized = String(statusCode || '').trim();
  if (normalized === '1') return 'approved';
  if (normalized === '2') return 'denied';
  if (normalized === '3') return 'cancelled';
  return 'pending';
};

const toStartOfDay = (date) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  const clone = new Date(date);
  clone.setHours(0, 0, 0, 0);
  return clone;
};

const toEndOfDay = (date) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  const clone = new Date(date);
  clone.setHours(23, 59, 59, 999);
  return clone;
};

const parseDistDFeRet = (responseXml) => {
  const retSection = extractSection(responseXml, 'retDistDFeInt');
  if (!retSection) {
    throw new Error('Resposta da SEFAZ não contém o retorno do serviço de distribuição.');
  }

  const status = extractTagContent(retSection, 'cStat');
  const message = extractTagContent(retSection, 'xMotivo');
  const ultNSU = extractTagContent(retSection, 'ultNSU');
  const maxNSU = extractTagContent(retSection, 'maxNSU');

  const parser = new DOMParser();
  const document = parser.parseFromString(retSection, 'text/xml');
  const lote = document.getElementsByTagName('loteDistDFeInt')[0];
  const documents = [];

  if (lote) {
    const docNodes = lote.getElementsByTagName('docZip');
    for (let index = 0; index < docNodes.length; index += 1) {
      const node = docNodes[index];
      if (!node || !node.textContent) continue;
      const schema = node.getAttribute('schema') || '';
      const nsu = node.getAttribute('NSU') || node.getAttribute('nsu') || '';
      const xml = decodeDocZip(node.textContent);
      documents.push({ schema, nsu: padNsU(nsu), xml });
    }
  }

  return {
    status,
    message,
    ultNSU: padNsU(ultNSU || '0'),
    maxNSU: padNsU(maxNSU || '0'),
    documents,
  };
};

const buildStateKey = (environment, cnpj) => {
  const safeEnv = normalizeEnvironment(environment);
  const safeCnpj = digitsOnly(cnpj).padStart(14, '0');
  return `${safeEnv}:${safeCnpj}`;
};

const createMemoryStateStore = () => {
  const map = new Map();
  return {
    async getLastNsU({ environment, cnpj }) {
      const key = buildStateKey(environment, cnpj);
      return map.get(key) || null;
    },
    async setLastNsU({ environment, cnpj, ultNSU }) {
      const key = buildStateKey(environment, cnpj);
      map.set(key, padNsU(ultNSU || '0'));
    },
  };
};

const createPersistentStateStore = () => {
  let Setting = null;
  try {
    // eslint-disable-next-line global-require
    Setting = require('../models/Setting');
  } catch (error) {
    return createMemoryStateStore();
  }

  const memoryStore = createMemoryStateStore();
  const warn = (message) => {
    console.warn(`[DF-e] ${message}`);
  };

  const isDatabaseReady = () => Boolean(Setting?.db) && Setting.db.readyState === 1;

  return {
    async getLastNsU({ environment, cnpj }) {
      const cached = await memoryStore.getLastNsU({ environment, cnpj });
      if (cached) {
        return cached;
      }

      if (!isDatabaseReady()) {
        return null;
      }

      try {
        const key = `dfe:last-nsu:${buildStateKey(environment, cnpj)}`;
        const existing = await Setting.findOne({ key }).lean().exec();
        const stored = existing?.value?.ultNSU;
        if (stored) {
          await memoryStore.setLastNsU({ environment, cnpj, ultNSU: stored });
          return stored;
        }
      } catch (error) {
        warn(`Falha ao carregar ultNSU persistido: ${error.message}`);
      }

      return null;
    },
    async setLastNsU({ environment, cnpj, ultNSU }) {
      await memoryStore.setLastNsU({ environment, cnpj, ultNSU });

      if (!isDatabaseReady()) {
        warn('Persistência de DF-e indisponível: conexão MongoDB não está ativa.');
        return;
      }

      try {
        const key = `dfe:last-nsu:${buildStateKey(environment, cnpj)}`;
        await Setting.findOneAndUpdate(
          { key },
          { value: { ultNSU: padNsU(ultNSU || '0') } },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        ).exec();
      } catch (error) {
        warn(`Falha ao persistir ultNSU: ${error.message}`);
      }
    },
  };
};

const shouldDowngradeToSoap11 = (error) => {
  if (!(error instanceof SefazTransmissionError)) {
    return false;
  }
  const statusCode = Number(error.details?.statusCode || 0);
  if (statusCode && statusCode !== 500) {
    return false;
  }
  const fault = parseSoapFault(error.details?.body || '');
  if (!fault) {
    return false;
  }
  const reason = (fault.reason || '').toLowerCase();
  const code = (fault.code || '').toLowerCase();
  if (reason.includes('object reference') || reason.includes('nullreference')) {
    return true;
  }
  if (code.includes('receiver') && (reason.includes('soap') || !reason)) {
    return true;
  }
  return false;
};

const extractUfFromCertificate = (certificatePem) => {
  if (!certificatePem) {
    return null;
  }

  try {
    const certificate = forge.pki.certificateFromPem(certificatePem);
    const attributes = certificate?.subject?.attributes || [];
    for (const attribute of attributes) {
      if (!attribute) continue;
      const key = String(attribute.shortName || attribute.name || '').toLowerCase();
      if (!key) continue;
      if (key === 'st' || key === 'stateorprovincename') {
        const code = resolveUfCode(attribute.value || '');
        if (/^[0-9]{2}$/.test(code) && code !== '00') {
          return code;
        }
      }
    }
  } catch (error) {
    if (DEBUG_LOG_ENABLED) {
      console.debug(`[DF-e] Não foi possível extrair UF do certificado: ${error.message}`);
    }
  }

  return null;
};

const resolveAuthorUfCode = ({ store, endpoint, certificatePem }) => {
  const warn = (message) => {
    console.warn(`[DF-e] ${message}`);
  };

  const ufAcronymCandidates = [
    store?.uf,
    store?.UF,
    store?.estadoSigla,
    store?.estado_abreviado,
    store?.estadoAbreviado,
    store?.dadosFiscais?.uf,
    store?.dadosFiscais?.UF,
  ];

  const preferredAcronym = ufAcronymCandidates
    .map((candidate) => String(candidate || '').trim().toUpperCase())
    .find((candidate) => /^[A-Z]{2}$/.test(candidate));

  const ufCandidates = [
    store?.codigoUf,
    store?.codigoUF,
    store?.uf,
    store?.UF,
    store?.estado,
    store?.estadoNome,
    store?.estadoCompleto,
    store?.estadoDescricao,
    store?.estadoSigla,
    store?.enderecoUf,
    store?.enderecoUF,
    store?.enderecoEstado,
    store?.endereco?.uf,
    store?.endereco?.UF,
    store?.endereco?.estado,
    store?.addressState,
    store?.addressUF,
    store?.addressUf,
    store?.companyState,
    store?.dadosFiscais?.uf,
    store?.dadosFiscais?.estado,
  ];

  let warnedAbout91 = false;

  for (const candidate of ufCandidates) {
    if (candidate == null) {
      continue;
    }
    const code = resolveUfCode(candidate);
    if (!/^[0-9]{2}$/.test(code) || code === '00') {
      continue;
    }
    if (code === '91') {
      if (!warnedAbout91) {
        warn('cUFAutor=91 bloqueado para consultas por NSU. Aplicando fallback.');
        warnedAbout91 = true;
      }
      continue;
    }
    if (preferredAcronym) {
      const forced = AUTHOR_UF_OVERRIDES[preferredAcronym];
      if (forced) {
        return forced;
      }
    }
    return code;
  }

  const certificateUf = extractUfFromCertificate(certificatePem);
  if (certificateUf) {
    if (certificateUf === '91') {
      if (!warnedAbout91) {
        warn('cUFAutor=91 extraído do certificado bloqueado para consultas por NSU. Ignorando valor.');
      }
    } else {
      return certificateUf;
    }
  }

  const isNationalEndpoint = /nfe\.(?:fazenda|sefaz)\.gov\.br/i.test(endpoint || '');
  if (isNationalEndpoint) {
    warn(`UF autora não encontrada. Utilizando fallback ${DEFAULT_NATIONAL_AUTHOR_UF}.`);
    return DEFAULT_NATIONAL_AUTHOR_UF;
  }

  warn('UF autora não encontrada. Utilizando fallback RJ (33).');
  return '33';
};

const BASE_DEPENDENCIES = {
  decryptBuffer,
  decryptText,
  extractCertificatePair,
  soapClient: { performSoapRequest },
  stateStore: createPersistentStateStore(),
};

const createDefaultDependencies = () => ({ ...BASE_DEPENDENCIES });

const collectDistributedDocuments = async (
  {
    store,
    startDate,
    endDate,
    environment,
    mode = 'consNSU',
    chave,
  },
  dependencyOverrides = {}
) => {
  if (!store) {
    throw new Error('Empresa não informada para consulta de DF-e.');
  }

  const dependencies = { ...createDefaultDependencies(), ...dependencyOverrides };
  const { decryptBuffer: decryptBufferFn, decryptText: decryptTextFn } = dependencies;
  const { extractCertificatePair: extractCertificatePairFn } = dependencies;
  const { soapClient = { performSoapRequest } } = dependencies;
  const { stateStore = createPersistentStateStore() } = dependencies;

  if (!soapClient || typeof soapClient.performSoapRequest !== 'function') {
    throw new Error('Cliente SOAP inválido informado.');
  }

  const encryptedCertificate = store.certificadoArquivoCriptografado;
  const encryptedPassword = store.certificadoSenhaCriptografada;
  if (!encryptedCertificate || !encryptedPassword) {
    throw new Error('Certificado digital da empresa não está configurado.');
  }

  let certificateBuffer;
  try {
    certificateBuffer = decryptBufferFn(encryptedCertificate);
  } catch (error) {
    throw new Error('Não foi possível descriptografar o certificado digital configurado.');
  }

  let certificatePassword;
  try {
    certificatePassword = decryptTextFn(encryptedPassword);
  } catch (error) {
    throw new Error('Não foi possível recuperar a senha do certificado digital.');
  }

  if (!certificatePassword) {
    throw new Error('Senha do certificado digital está vazia após descriptografia.');
  }

  let certificatePair;
  try {
    certificatePair = extractCertificatePairFn(certificateBuffer, certificatePassword);
  } catch (error) {
    throw new Error(
      `Não foi possível extrair chave privada e certificado do arquivo PFX: ${error.message}`
    );
  }

  const environmentToken = normalizeEnvironment(environment);
  const endpoint = DFE_ENDPOINTS[environmentToken] || DFE_ENDPOINTS.producao;
  const tpAmb = environmentToken === 'homologacao' ? '2' : '1';
  const companyDocument = digitsOnly(
    store.cnpj || store.documento || store.document || store.cpfCnpj || ''
  );
  if (!companyDocument) {
    throw new Error('CNPJ da empresa não está configurado para consulta de DF-e.');
  }

  const authorUfCode = resolveAuthorUfCode({
    store,
    endpoint,
    certificatePem: certificatePair.certificatePem,
  });
  if (!/^[0-9]{2}$/.test(authorUfCode) || authorUfCode === '00') {
    throw new Error('UF autora inválida para consulta de DF-e.');
  }

  const startBoundary = startDate ? toStartOfDay(startDate) : null;
  const endBoundary = endDate ? toEndOfDay(endDate) : null;

  const seenAccessKeys = new Set();
  const seenNsus = new Set();
  const collected = [];
  let iterations = 0;

  const initialNsU =
    (await stateStore.getLastNsU({ environment: environmentToken, cnpj: companyDocument })) ||
    '000000000000000';
  let currentNsU = padNsU(initialNsU);
  let reachedEnd = false;

  const buildEnvelopeForMode = (soapVersion) => {
    if (mode === 'consChNFe') {
      if (!chave) {
        throw new Error('Chave de acesso não informada para consulta por chave.');
      }
      return buildEnvelopeConsChNFe({
        tpAmb,
        cUFAutor: authorUfCode,
        cnpj: companyDocument,
        accessKey: chave,
        soapVersion,
      });
    }
    return buildEnvelopeConsNSU({
      tpAmb,
      cUFAutor: authorUfCode,
      cnpj: companyDocument,
      ultNSU: currentNsU,
      soapVersion,
    });
  };

  const requestOnce = async (soapVersionToUse) => {
    const headers =
      soapVersionToUse === SOAP_VERSIONS.SOAP11
        ? buildSoap11Headers(DFE_SOAP_ACTION)
        : buildSoap12Headers(DFE_SOAP_ACTION);

    return soapClient.performSoapRequest({
      endpoint,
      envelope: buildEnvelopeForMode(soapVersionToUse),
      certificate: certificatePair.certificatePem,
      certificateChain: certificatePair.certificateChain,
      privateKey: certificatePair.privateKeyPem,
      soapAction: DFE_SOAP_ACTION,
      soapVersion: soapVersionToUse,
      timeout: 60000,
      extraHeaders: headers,
      returnResponseDetails: true,
    });
  };

  const executeRequest = async () => {
    const preferredVersion = DEFAULT_SOAP_VERSION;
    let attemptVersion = preferredVersion;
    let hasDowngraded = false;

    try {
      return await requestOnce(attemptVersion);
    } catch (error) {
      const shouldFallback =
        attemptVersion === SOAP_VERSIONS.SOAP12 && shouldDowngradeToSoap11(error);
      if (shouldFallback) {
        console.warn('[DF-e] Downgrade automático para SOAP 1.1 após falha SOAP 1.2.');
        hasDowngraded = true;
        attemptVersion = SOAP_VERSIONS.SOAP11;
        return requestOnce(attemptVersion);
      }
      throw error;
    } finally {
      if (DEBUG_LOG_ENABLED) {
        console.debug(
          `[DF-e] Requisição SOAP finalizada usando versão ${hasDowngraded ? '1.1' : attemptVersion}.`
        );
      }
    }
  };

  while (!reachedEnd && iterations < MAX_ITERATIONS && collected.length < MAX_RESULTS) {
    iterations += 1;

    let response;
    try {
      response = await executeRequest();
    } catch (error) {
      if (error instanceof SefazTransmissionError) {
        const fault = parseSoapFault(error.details?.body || '');
        if (fault?.reason) {
          throw new Error(`Erro ao consultar DF-e na SEFAZ: ${fault.reason}`);
        }
        throw new Error(error.message || 'Falha ao comunicar com a SEFAZ.');
      }
      throw error;
    }

    const responseXml = response.body;
    const parsed = parseDistDFeRet(responseXml);

    console.info(
      `[DF-e] Resposta HTTP ${response.statusCode || 'desconhecido'} - cStat ${
        parsed.status || '??'
      } (${parsed.message || 'sem mensagem'})`
    );

    if (parsed.status && parsed.status !== '138' && parsed.status !== '137') {
      const message = parsed.message || 'Retorno inesperado da SEFAZ.';
      throw new Error(`SEFAZ retornou ${parsed.status} - ${message}`);
    }

    for (const entry of parsed.documents) {
      if (!entry || !entry.xml) continue;
      if (entry.nsu && seenNsus.has(entry.nsu)) {
        continue;
      }
      const parsedDocument = parseDistributionDocument(entry, { companyDocument });
      seenNsus.add(entry.nsu);
      if (!parsedDocument) continue;
      if (parsedDocument.tpNF && String(parsedDocument.tpNF).trim() === '1') {
        continue; // notas de saída
      }
      if (!parsedDocument.accessKey || seenAccessKeys.has(parsedDocument.accessKey)) {
        continue;
      }
      const issueDateIso = parsedDocument.issueDate;
      const issueDateObject = issueDateIso ? new Date(issueDateIso) : null;
      if (startBoundary && issueDateObject && issueDateObject < startBoundary) {
        continue;
      }
      if (endBoundary && issueDateObject && issueDateObject > endBoundary) {
        continue;
      }
      seenAccessKeys.add(parsedDocument.accessKey);
      collected.push({
        id: parsedDocument.accessKey,
        nsu: entry.nsu,
        accessKey: parsedDocument.accessKey,
        supplierName: parsedDocument.supplierName || '',
        supplierDocument: parsedDocument.supplierDocument || '',
        issueDate: issueDateIso || null,
        serie: parsedDocument.serie || '',
        number: parsedDocument.number || '',
        totalValue: parsedDocument.totalValue,
        status: mapStatus(parsedDocument.statusCode),
        xml: parsedDocument.xml,
      });
    }

    if (mode === 'consChNFe') {
      reachedEnd = true;
    } else if (!parsed.ultNSU || compareNsU(parsed.ultNSU, currentNsU) <= 0) {
      reachedEnd = true;
    } else {
      currentNsU = parsed.ultNSU;
      await stateStore.setLastNsU({
        environment: environmentToken,
        cnpj: companyDocument,
        ultNSU: currentNsU,
      });
      if (parsed.maxNSU && compareNsU(currentNsU, parsed.maxNSU) >= 0) {
        reachedEnd = true;
      }
    }
  }

  collected.sort((a, b) => {
    const dateA = a.issueDate ? new Date(a.issueDate).getTime() : 0;
    const dateB = b.issueDate ? new Date(b.issueDate).getTime() : 0;
    if (dateA === dateB) {
      return a.accessKey.localeCompare(b.accessKey);
    }
    return dateB - dateA;
  });

  return {
    documents: collected.slice(0, MAX_RESULTS),
    metadata: {
      iterations,
      environment: environmentToken,
      companyDocument,
      lastNsU: currentNsU,
      initialNsU,
    },
  };
};

module.exports = {
  collectDistributedDocuments,
  __TESTING__: {
    padNsU,
    compareNsU,
    buildSoap12Headers,
    buildSoap11Headers,
    buildEnvelopeConsNSU,
    buildEnvelopeConsChNFe,
    parseSoapFault,
    parseDistDFeRet,
    createMemoryStateStore,
    createPersistentStateStore,
    shouldDowngradeToSoap11,
    resolveAuthorUfCode,
  },
};
