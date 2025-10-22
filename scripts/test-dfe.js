#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const { extractCertificatePair } = require(path.join(projectRoot, 'servidor/utils/pkcs12'));
const { performSoapRequest } = require(path.join(projectRoot, 'servidor/services/sefazTransmitter'));
const dfeModule = require(path.join(projectRoot, 'servidor/services/dfeDistribution'));

const {
  buildSoap12Headers,
  buildSoap11Headers,
  buildEnvelopeSoap12,
  buildEnvelopeSoap11,
  parseDistDFeRet,
  parseSoapFault,
} = dfeModule.__TESTING__ || {};

const SOAP_ACTION =
  'http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe/nfeDistDFeInteresse';

const DEFAULT_ENDPOINTS = {
  '1':
    process.env.NFE_AN_DFE_URL ||
    process.env.NFE_AN_DFE_URL_PROD ||
    'https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx',
  '2':
    process.env.NFE_AN_DFE_HOMOLOG_URL ||
    process.env.NFE_AN_DFE_URL_HOMOLOG ||
    'https://hom.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx',
};

const digitsOnly = (value) => String(value || '').replace(/\D+/g, '');

const sanitizePreview = (value) => {
  const preview = String(value || '').slice(0, 400);
  return preview.replace(/\b(\d{6,})\b/g, (match) => {
    if (match.length <= 4) return match;
    const visible = match.slice(-2);
    return `${'*'.repeat(match.length - 2)}${visible}`;
  });
};

const parseArgs = () => {
  const args = {};
  for (const token of process.argv.slice(2)) {
    if (!token.startsWith('--')) continue;
    const [key, rawValue] = token.slice(2).split('=');
    const normalizedKey = key.trim();
    if (!normalizedKey) continue;
    args[normalizedKey] = rawValue === undefined ? 'true' : rawValue;
  }
  return args;
};

const ensure = (condition, message) => {
  if (!condition) {
    console.error(message);
    process.exit(1);
  }
};

const main = async () => {
  ensure(
    buildEnvelopeSoap12 && buildEnvelopeSoap11,
    'Funções de montagem de envelope não encontradas (verifique build).'
  );

  const args = parseArgs();
  const modeToken = String(args.mode || process.env.NFE_DFE_MODE || 'distNSU').trim().toLowerCase();
  const mode = ['consnsu', 'conschnfe', 'distnsu'].includes(modeToken) ? modeToken : 'distnsu';

  const tpAmb = ['1', '2'].includes(String(args.tpAmb || process.env.NFE_TP_AMB || '1'))
    ? String(args.tpAmb || process.env.NFE_TP_AMB || '1')
    : '1';

  const endpoint = String(args.url || process.env.NFE_AN_DFE_URL_OVERRIDE || DEFAULT_ENDPOINTS[tpAmb]);
  ensure(endpoint, 'URL do serviço DF-e não informada. Use --url ou configure NFE_AN_DFE_URL.');

  const ufCandidate = args.uf || process.env.NFE_EMPRESA_UF;
  ensure(ufCandidate, 'UF autora não informada. Use --uf=33 ou configure NFE_EMPRESA_UF.');
  const cUFAutor = digitsOnly(ufCandidate).padStart(2, '0');
  ensure(/^[0-9]{2}$/.test(cUFAutor) && cUFAutor !== '00', 'UF autora inválida.');

  const cnpjCandidate = args.cnpj || process.env.NFE_EMPRESA_CNPJ;
  ensure(cnpjCandidate, 'CNPJ não informado. Use --cnpj=xxxxxxxxxxxxx ou configure NFE_EMPRESA_CNPJ.');
  const cnpj = digitsOnly(cnpjCandidate).padStart(14, '0');
  ensure(/^[0-9]{14}$/.test(cnpj), 'CNPJ inválido informado.');

  const soapFlag = String(args.soap || process.env.NFE_DFE_SOAP_VERSION || '12').trim();
  const soapVersion = soapFlag === '11' || soapFlag === '1.1' ? '1.1' : '1.2';

  let valorParam = null;
  if (mode === 'consnsu') {
    valorParam = args.nsu || process.env.NFE_DFE_NSU;
    ensure(valorParam, 'Modo consNSU exige informar --nsu=000000000000001.');
  } else if (mode === 'conschnfe') {
    valorParam = args.chave || args.chNFe || process.env.NFE_DFE_CHAVE;
    ensure(valorParam, 'Modo consChNFe exige informar --chave=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.');
  } else {
    valorParam = args.nsu || process.env.NFE_DFE_NSU || '0';
  }

  const modeLabel = mode === 'conschnfe' ? 'consChNFe' : mode === 'consnsu' ? 'consNSU' : 'distNSU';

  const pfxPath = args.pfx || process.env.NFE_PFX_PATH;
  ensure(pfxPath, 'Informe caminho do certificado PFX via --pfx ou NFE_PFX_PATH.');
  const absolutePfx = path.isAbsolute(pfxPath) ? pfxPath : path.resolve(projectRoot, pfxPath);
  ensure(fs.existsSync(absolutePfx), `Arquivo PFX não encontrado em ${absolutePfx}.`);
  const pfxPassword = args.pwd || process.env.NFE_PFX_PASSWORD;
  ensure(pfxPassword, 'Senha do certificado PFX não informada. Use --pwd ou NFE_PFX_PASSWORD.');

  const pfxBuffer = fs.readFileSync(absolutePfx);
  const { certificatePem, certificateChain, privateKeyPem } = extractCertificatePair(
    pfxBuffer,
    pfxPassword
  );

  const envelopeBuilder = soapVersion === '1.1' ? buildEnvelopeSoap11 : buildEnvelopeSoap12;
  const headersBuilder = soapVersion === '1.1' ? buildSoap11Headers : buildSoap12Headers;

  const envelope = envelopeBuilder({
    tpAmb,
    cUFAutor,
    cnpj,
    modo: modeLabel,
    valor: valorParam,
  });

  const headers = headersBuilder(SOAP_ACTION);

  console.log('> Endpoint:', endpoint);
  console.log('> SOAP Version:', soapVersion);
  console.log('> Content-Type enviado:', headers['Content-Type']);

  const response = await performSoapRequest({
    endpoint,
    envelope,
    certificate: certificatePem,
    certificateChain,
    privateKey: privateKeyPem,
    soapAction: SOAP_ACTION,
    soapVersion,
    extraHeaders: headers,
    timeout: 60000,
    returnResponseDetails: true,
  });

  console.log('> HTTP Status:', response.statusCode);
  const responseContentType =
    response.headers?.['content-type'] || response.headers?.['Content-Type'] || 'desconhecido';
  console.log('> Content-Type recebido:', responseContentType);
  console.log('> Corpo (até 400 chars):', sanitizePreview(response.body));

  try {
    const parsed = parseDistDFeRet(response.body);
    console.log('> cStat:', parsed.status || 'N/A');
    console.log('> xMotivo:', parsed.message || '');
    console.log('> ultNSU:', parsed.ultNSU || '');
    console.log('> maxNSU:', parsed.maxNSU || '');
    console.log('> Documentos retornados:', parsed.documents.length);
  } catch (parseError) {
    const fault = parseSoapFault(response.body);
    if (fault) {
      console.error('> SOAP Fault:', fault.code, '-', fault.reason);
      process.exitCode = 2;
    } else {
      console.error('> Falha ao interpretar resposta:', parseError.message);
      process.exitCode = 2;
    }
  }
};

main().catch((error) => {
  const fault = parseSoapFault(error?.details?.body || error?.body || '');
  if (fault) {
    console.error('> SOAP Fault durante requisição:', fault.code, '-', fault.reason);
  } else if (error?.details?.statusCode) {
    console.error(
      `> Erro HTTP ${error.details.statusCode}:`,
      sanitizePreview(error.details.body || error.message)
    );
  } else {
    console.error('> Erro ao executar diagnóstico DF-e:', error.message || error);
  }
  process.exit(1);
});
