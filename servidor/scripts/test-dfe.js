#!/usr/bin/env node

require('dotenv').config();

const fs = require('fs');
const path = require('path');

const {
  performSoapRequest,
  resolveUfCode,
  SefazTransmissionError,
} = require('../services/sefazTransmitter');
const { extractCertificatePair } = require('../utils/pkcs12');
const {
  buildEnvelopeConsNSU,
  buildEnvelopeConsChNFe,
  buildSoap11Headers,
  buildSoap12Headers,
  parseDistDFeRet,
  parseSoapFault,
  padNsU,
  resolveAuthorUfCode,
  shouldDowngradeToSoap11,
} = require('../services/dfeDistribution').__TESTING__;

const SOAP_VERSIONS = {
  SOAP12: '1.2',
  SOAP11: '1.1',
};

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

const DEFAULT_ENVIRONMENT = (process.env.SEFAZ_DFE_ENVIRONMENT || 'producao').toLowerCase();

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

const args = process.argv.slice(2);
const cliOptions = args.reduce((acc, arg) => {
  const [key, value] = arg.split('=');
  if (key && value) {
    acc[key.replace(/^--/, '')] = value;
  }
  return acc;
}, {});

const mode = (cliOptions.mode || 'consNSU').trim();
const environment = (cliOptions.ambiente || DEFAULT_ENVIRONMENT).trim().toLowerCase();
const cnpj = (cliOptions.cnpj || process.env.NFE_DFE_CNPJ || '').trim();
const uf = (cliOptions.uf || process.env.NFE_DFE_UF || '').trim();
const ultNsUArg = cliOptions.ultnsu || process.env.NFE_DFE_ULT_NSU || '000000000000000';
const chave = (cliOptions.chave || process.env.NFE_DFE_CHAVE || '').trim();
const endpoint =
  cliOptions.endpoint || DFE_ENDPOINTS[environment] || DFE_ENDPOINTS.producao;

if (!cnpj) {
  console.error('Informe o CNPJ via --cnpj= ou variável NFE_DFE_CNPJ.');
  process.exit(1);
}

if (!uf) {
  console.error('Informe a UF via --uf= ou variável NFE_DFE_UF.');
  process.exit(1);
}

if (mode === 'consChNFe' && !chave) {
  console.error('Para o modo consChNFe informe a chave via --chave= ou NFE_DFE_CHAVE.');
  process.exit(1);
}

const pfxPath = process.env.NFE_PFX_PATH;
const pfxPassword = process.env.NFE_PFX_PASSWORD || '';

if (!pfxPath || !pfxPassword) {
  console.error('Configure NFE_PFX_PATH e NFE_PFX_PASSWORD para executar o diagnóstico.');
  process.exit(1);
}

const absolutePfxPath = path.isAbsolute(pfxPath)
  ? pfxPath
  : path.resolve(process.cwd(), pfxPath);

let pfxBuffer;
try {
  pfxBuffer = fs.readFileSync(absolutePfxPath);
} catch (error) {
  console.error(`Não foi possível ler o PFX informado: ${error.message}`);
  process.exit(1);
}

let certificatePair;
try {
  certificatePair = extractCertificatePair(pfxBuffer, pfxPassword);
} catch (error) {
  console.error(`Falha ao extrair certificados do PFX: ${error.message}`);
  process.exit(1);
}

const storeStub = {
  uf,
  codigoUf: resolveUfCode(uf),
};

const authorUfCode = resolveAuthorUfCode({ store: storeStub, endpoint });

const soapVersionPreference = normalizeSoapVersion(process.env.NFE_DFE_SOAP_VERSION);

const buildEnvelope = (soapVersion) => {
  if (mode === 'consChNFe') {
    return buildEnvelopeConsChNFe({
      tpAmb: environment === 'homologacao' ? '2' : '1',
      cUFAutor: authorUfCode,
      cnpj,
      accessKey: chave,
      soapVersion,
    });
  }
  return buildEnvelopeConsNSU({
    tpAmb: environment === 'homologacao' ? '2' : '1',
    cUFAutor: authorUfCode,
    cnpj,
    ultNSU: padNsU(ultNsUArg),
    soapVersion,
  });
};

const executeRequest = async () => {
  const attempt = async (version) => {
    const headers =
      version === SOAP_VERSIONS.SOAP11
        ? buildSoap11Headers(DFE_SOAP_ACTION)
        : buildSoap12Headers(DFE_SOAP_ACTION);

    return performSoapRequest({
      endpoint,
      envelope: buildEnvelope(version),
      certificate: certificatePair.certificatePem,
      certificateChain: certificatePair.certificateChain,
      privateKey: certificatePair.privateKeyPem,
      soapVersion: version,
      soapAction: DFE_SOAP_ACTION,
      extraHeaders: headers,
      timeout: 60000,
      returnResponseDetails: true,
    });
  };

  try {
    return await attempt(soapVersionPreference);
  } catch (error) {
    if (soapVersionPreference === SOAP_VERSIONS.SOAP11) {
      throw error;
    }
    if (shouldDowngradeToSoap11(error)) {
      console.warn('Downgrade automático para SOAP 1.1 após falha em SOAP 1.2.');
      return attempt(SOAP_VERSIONS.SOAP11);
    }
    throw error;
  }
};

(async () => {
  try {
    const response = await executeRequest();
    const preview = response.body.replace(/\s+/g, ' ').slice(0, 400);
    console.log('--- Diagnóstico DF-e ---');
    console.log(`Endpoint: ${endpoint}`);
    console.log(`HTTP status: ${response.statusCode}`);
    console.log(`Content-Type: ${response.headers['content-type'] || 'desconhecido'}`);
    console.log(`Body (primeiros 400 chars): ${preview}`);

    try {
      const parsed = parseDistDFeRet(response.body);
      console.log(`cStat: ${parsed.status}`);
      console.log(`xMotivo: ${parsed.message}`);
      console.log(`ultNSU: ${parsed.ultNSU}`);
      console.log(`maxNSU: ${parsed.maxNSU}`);
      console.log(`Documentos no lote: ${parsed.documents.length}`);
    } catch (parseError) {
      console.error(`Falha ao interpretar retorno: ${parseError.message}`);
    }
  } catch (error) {
    if (error instanceof SefazTransmissionError) {
      const fault = parseSoapFault(error.details?.body || '');
      console.error(
        `Erro SOAP: ${error.message} | Detalhes: ${fault?.reason || 'sem motivo informado'}`
      );
    } else {
      console.error(`Erro inesperado: ${error.message}`);
    }
    process.exit(1);
  }
})();
