const zlib = require('zlib');
const { DOMParser } = require('@xmldom/xmldom');
const { decryptBuffer, decryptText } = require('../utils/certificates');
const { extractCertificatePair } = require('../utils/pkcs12');
const {
  performSoapRequest,
  resolveUfCode,
  extractSection,
  extractTagContent,
  SefazTransmissionError,
} = require('./sefazTransmitter');

const digitsOnly = (value) => String(value || '').replace(/\D+/g, '');

const DEFAULT_ENVIRONMENT = (process.env.SEFAZ_DFE_ENVIRONMENT || 'producao').toLowerCase();
const VALID_ENVIRONMENTS = new Set(['producao', 'homologacao']);
const DFE_ENDPOINTS = {
  homologacao: 'https://hom.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx',
  producao: 'https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx',
};
const DFE_SOAP_ACTION =
  'http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe/nfeDistDFeInteresse';
const DFE_NAMESPACE = 'http://www.portalfiscal.inf.br/nfe';
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

const buildDistributionPayload = ({ tpAmb, cUFAutor, cnpj, ultNSU }) => {
  const normalizedNsU = padNsU(ultNSU || '0');
  const normalizedCnpj = digitsOnly(cnpj).padStart(14, '0');
  return [
    `<distDFeInt xmlns="${DFE_NAMESPACE}" versao="1.01">`,
    `  <tpAmb>${tpAmb}</tpAmb>`,
    `  <cUFAutor>${cUFAutor || '00'}</cUFAutor>`,
    `  <CNPJ>${normalizedCnpj}</CNPJ>`,
    '  <consNSU>',
    `    <ultNSU>${normalizedNsU}</ultNSU>`,
    '  </consNSU>',
    '</distDFeInt>',
  ].join('');
};

const buildDistributionEnvelope = ({ payload }) =>
  [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"',
    '                 xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
    '  <soap12:Body>',
    '    <nfeDistDFeInteresse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe">',
    `      ${payload}`,
    '    </nfeDistDFeInteresse>',
    '  </soap12:Body>',
    '</soap12:Envelope>',
  ].join('\n');

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

const parseDistributionResponse = (responseXml) => {
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

const collectDistributedDocuments = async ({
  store,
  startDate,
  endDate,
  environment,
}) => {
  if (!store) {
    throw new Error('Empresa não informada para consulta de DF-e.');
  }

  const encryptedCertificate = store.certificadoArquivoCriptografado;
  const encryptedPassword = store.certificadoSenhaCriptografada;
  if (!encryptedCertificate || !encryptedPassword) {
    throw new Error('Certificado digital da empresa não está configurado.');
  }

  let certificateBuffer;
  try {
    certificateBuffer = decryptBuffer(encryptedCertificate);
  } catch (error) {
    throw new Error('Não foi possível descriptografar o certificado digital configurado.');
  }

  let certificatePassword;
  try {
    certificatePassword = decryptText(encryptedPassword);
  } catch (error) {
    throw new Error('Não foi possível recuperar a senha do certificado digital.');
  }

  if (!certificatePassword) {
    throw new Error('Senha do certificado digital está vazia após descriptografia.');
  }

  let certificatePair;
  try {
    certificatePair = extractCertificatePair(certificateBuffer, certificatePassword);
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
  const ufCode = resolveUfCode(
    store.codigoUf || store.codigoUF || store.uf || store.UF || store.estado || ''
  );

  const startBoundary = startDate ? toStartOfDay(startDate) : null;
  const endBoundary = endDate ? toEndOfDay(endDate) : null;

  const seenAccessKeys = new Set();
  const seenNsus = new Set();
  const collected = [];
  let iterations = 0;
  let currentNsU = '000000000000000';
  let reachedEnd = false;

  while (!reachedEnd && iterations < MAX_ITERATIONS && collected.length < MAX_RESULTS) {
    iterations += 1;
    const payload = buildDistributionPayload({
      tpAmb,
      cUFAutor: ufCode,
      cnpj: companyDocument,
      ultNSU: currentNsU,
    });
    const envelope = buildDistributionEnvelope({ payload });

    let responseXml;
    try {
      responseXml = await performSoapRequest({
        endpoint,
        envelope,
        certificate: certificatePair.certificatePem,
        certificateChain: certificatePair.certificateChain,
        privateKey: certificatePair.privateKeyPem,
        soapAction: DFE_SOAP_ACTION,
        timeout: 60000,
      });
    } catch (error) {
      if (error instanceof SefazTransmissionError) {
        throw new Error(error.message || 'Falha ao comunicar com a SEFAZ.');
      }
      throw error;
    }

    const parsed = parseDistributionResponse(responseXml);

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

    if (parsed.status === '137') {
      reachedEnd = true;
    }

    if (!parsed.ultNSU || compareNsU(parsed.ultNSU, currentNsU) <= 0) {
      reachedEnd = true;
    } else {
      currentNsU = parsed.ultNSU;
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
    },
  };
};

module.exports = {
  collectDistributedDocuments,
};
