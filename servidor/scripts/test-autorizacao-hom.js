#!/usr/bin/env node

require('dotenv').config();

const crypto = require('crypto');
const { SignedXml } = require('xml-crypto');
const {
  transmitNfceToSefaz,
  SefazTransmissionError,
  __TESTING__,
} = require('../services/sefazTransmitter');
const { loadPfxBuffer, extractCertificatePair } = require('./utils/certificates');

const { resolveUfCode } = __TESTING__;

const sanitizeDigits = (value, fallback = '') => {
  if (value === null || value === undefined) {
    return fallback;
  }
  const digits = String(value).replace(/\D+/g, '');
  return digits || fallback;
};

const modulo11 = (value) => {
  const reversed = String(value).split('').reverse();
  let weight = 2;
  let total = 0;
  for (const digit of reversed) {
    total += Number(digit) * weight;
    weight += 1;
    if (weight > 9) {
      weight = 2;
    }
  }
  const remainder = total % 11;
  return remainder === 0 || remainder === 1 ? 0 : 11 - remainder;
};

const buildAccessKey = ({
  ufCode,
  emissionDate,
  cnpj,
  model,
  serie,
  numero,
  emissionType,
  cnf,
}) => {
  const yy = String(emissionDate.getFullYear()).slice(-2);
  const mm = String(emissionDate.getMonth() + 1).padStart(2, '0');
  const datePart = `${yy}${mm}`;
  const body = `${String(ufCode).padStart(2, '0')}${datePart}${String(cnpj).padStart(14, '0')}${String(model).padStart(2, '0')}${String(serie).padStart(3, '0')}${String(numero).padStart(9, '0')}${String(emissionType).padStart(1, '0')}${String(cnf).padStart(8, '0')}`;
  const dv = modulo11(body);
  return `${body}${dv}`;
};

const formatDateTime = (date) => {
  const tzOffset = date.getTimezoneOffset();
  const sign = tzOffset > 0 ? '-' : '+';
  const abs = Math.abs(tzOffset);
  const offsetHours = String(Math.floor(abs / 60)).padStart(2, '0');
  const offsetMinutes = String(abs % 60).padStart(2, '0');
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}${sign}${offsetHours}:${offsetMinutes}`;
};

const buildCnf = () => {
  const hash = crypto.createHash('sha256').update(`${Date.now()}-${Math.random()}`).digest('hex');
  const numeric = BigInt(`0x${hash.slice(-12)}`);
  return String(Number(numeric % BigInt(100000000))).padStart(8, '0');
};

const buildNfceXml = ({
  uf,
  environment,
  emitter,
  destination,
  item,
  totals,
  cscId,
  cscToken,
  certificatePem,
  privateKeyPem,
}) => {
  const emissionDate = new Date();
  const ufCode = resolveUfCode(uf);
  const serie = String(emitter.serie || '1').padStart(3, '0');
  const numero = String(emitter.numero || 1).padStart(9, '0');
  const cnf = buildCnf();
  const tpAmb = environment === 'producao' ? '1' : '2';
  const accessKey = buildAccessKey({
    ufCode,
    emissionDate,
    cnpj: sanitizeDigits(emitter.cnpj, '00000000000000'),
    model: '65',
    serie,
    numero,
    emissionType: '1',
    cnf,
  });

  const dhEmi = formatDateTime(emissionDate);
  const cMun = sanitizeDigits(emitter.cMun, '5002704');
  const cpfDest = sanitizeDigits(destination.cpf || '', '');
  const idDest = cpfDest ? '1' : '2';

  const xmlLines = [];
  xmlLines.push('<?xml version="1.0" encoding="UTF-8"?>');
  xmlLines.push('<NFe xmlns="http://www.portalfiscal.inf.br/nfe">');
  xmlLines.push(`  <infNFe Id="NFe${accessKey}" versao="4.00">`);
  xmlLines.push('    <ide>');
  xmlLines.push(`      <cUF>${ufCode}</cUF>`);
  xmlLines.push(`      <cNF>${cnf}</cNF>`);
  xmlLines.push(`      <natOp>${emitter.natureza || 'VENDA AO CONSUMIDOR'}</natOp>`);
  xmlLines.push('      <mod>65</mod>');
  xmlLines.push(`      <serie>${serie}</serie>`);
  xmlLines.push(`      <nNF>${Number(numero)}</nNF>`);
  xmlLines.push(`      <dhEmi>${dhEmi}</dhEmi>`);
  xmlLines.push('      <tpNF>1</tpNF>');
  xmlLines.push(`      <idDest>${idDest}</idDest>`);
  xmlLines.push(`      <cMunFG>${cMun}</cMunFG>`);
  xmlLines.push('      <tpImp>4</tpImp>');
  xmlLines.push('      <tpEmis>1</tpEmis>');
  xmlLines.push(`      <cDV>${accessKey.slice(-1)}</cDV>`);
  xmlLines.push(`      <tpAmb>${tpAmb}</tpAmb>`);
  xmlLines.push('      <finNFe>1</finNFe>');
  xmlLines.push('      <indFinal>1</indFinal>');
  xmlLines.push('      <indPres>1</indPres>');
  xmlLines.push('      <procEmi>0</procEmi>');
  xmlLines.push('      <verProc>EoBicho-PDV/1.0</verProc>');
  xmlLines.push('    </ide>');
  xmlLines.push('    <emit>');
  xmlLines.push(`      <CNPJ>${sanitizeDigits(emitter.cnpj, '00000000000000')}</CNPJ>`);
  xmlLines.push(`      <xNome>${emitter.razao || 'EMPRESA HOMOLOGACAO'}</xNome>`);
  xmlLines.push(`      <xFant>${emitter.fantasia || emitter.razao || 'EMPRESA HOMOLOGACAO'}</xFant>`);
  xmlLines.push('      <enderEmit>');
  xmlLines.push(`        <xLgr>${emitter.logradouro || 'Rua Teste'}</xLgr>`);
  xmlLines.push(`        <nro>${emitter.numeroEndereco || '100'}</nro>`);
  xmlLines.push(`        <xBairro>${emitter.bairro || 'Centro'}</xBairro>`);
  xmlLines.push(`        <cMun>${cMun}</cMun>`);
  xmlLines.push(`        <xMun>${emitter.municipio || 'CAMPO GRANDE'}</xMun>`);
  xmlLines.push(`        <UF>${uf}</UF>`);
  xmlLines.push(`        <CEP>${sanitizeDigits(emitter.cep, '79000000')}</CEP>`);
  xmlLines.push('        <cPais>1058</cPais>');
  xmlLines.push('        <xPais>BRASIL</xPais>');
  if (emitter.fone) {
    xmlLines.push(`        <fone>${sanitizeDigits(emitter.fone)}</fone>`);
  }
  xmlLines.push('      </enderEmit>');
  xmlLines.push(`      <IE>${sanitizeDigits(emitter.ie, '000000000')}</IE>`);
  xmlLines.push(`      <CRT>${emitter.crt || '1'}</CRT>`);
  xmlLines.push('    </emit>');
  xmlLines.push('    <dest>');
  if (cpfDest) {
    xmlLines.push(`      <CPF>${cpfDest}</CPF>`);
  }
  xmlLines.push(`      <xNome>${destination.nome || 'CONSUMIDOR NÃO IDENTIFICADO'}</xNome>`);
  xmlLines.push('      <enderDest>');
  xmlLines.push(`        <xLgr>${destination.logradouro || 'Rua Consumidor'}</xLgr>`);
  xmlLines.push(`        <nro>${destination.numero || '0'}</nro>`);
  xmlLines.push(`        <xBairro>${destination.bairro || 'Centro'}</xBairro>`);
  xmlLines.push(`        <cMun>${cMun}</cMun>`);
  xmlLines.push(`        <xMun>${emitter.municipio || 'CAMPO GRANDE'}</xMun>`);
  xmlLines.push(`        <UF>${uf}</UF>`);
  xmlLines.push('        <cPais>1058</cPais>');
  xmlLines.push('        <xPais>BRASIL</xPais>');
  xmlLines.push('      </enderDest>');
  xmlLines.push('      <indIEDest>9</indIEDest>');
  xmlLines.push('    </dest>');
  xmlLines.push('    <det nItem="1">');
  xmlLines.push('      <prod>');
  xmlLines.push(`        <cProd>${item.codigo || '0001'}</cProd>`);
  xmlLines.push('        <cEAN>SEM GTIN</cEAN>');
  xmlLines.push(`        <xProd>${item.descricao || 'Produto de Teste'}</xProd>`);
  xmlLines.push(`        <NCM>${item.ncm || '19059020'}</NCM>`);
  xmlLines.push('        <CFOP>5102</CFOP>');
  xmlLines.push(`        <uCom>${item.unidade || 'UN'}</uCom>`);
  xmlLines.push(`        <qCom>${item.quantidade}</qCom>`);
  xmlLines.push(`        <vUnCom>${item.precoUnitario}</vUnCom>`);
  xmlLines.push(`        <vProd>${item.valorTotal}</vProd>`);
  xmlLines.push('        <cEANTrib>SEM GTIN</cEANTrib>');
  xmlLines.push(`        <uTrib>${item.unidade || 'UN'}</uTrib>`);
  xmlLines.push(`        <qTrib>${item.quantidade}</qTrib>`);
  xmlLines.push(`        <vUnTrib>${item.precoUnitario}</vUnTrib>`);
  xmlLines.push('        <indTot>1</indTot>');
  xmlLines.push('      </prod>');
  xmlLines.push('      <imposto>');
  xmlLines.push('        <ICMS>');
  xmlLines.push('          <ICMS40>');
  xmlLines.push('            <orig>0</orig>');
  xmlLines.push('            <CST>40</CST>');
  xmlLines.push('          </ICMS40>');
  xmlLines.push('        </ICMS>');
  xmlLines.push('        <PIS>');
  xmlLines.push('          <PISNT>');
  xmlLines.push('            <CST>07</CST>');
  xmlLines.push('          </PISNT>');
  xmlLines.push('        </PIS>');
  xmlLines.push('        <COFINS>');
  xmlLines.push('          <COFINSNT>');
  xmlLines.push('            <CST>07</CST>');
  xmlLines.push('          </COFINSNT>');
  xmlLines.push('        </COFINS>');
  xmlLines.push('      </imposto>');
  xmlLines.push('    </det>');
  xmlLines.push('    <total>');
  xmlLines.push('      <ICMSTot>');
  xmlLines.push('        <vBC>0.00</vBC>');
  xmlLines.push('        <vICMS>0.00</vICMS>');
  xmlLines.push('        <vICMSDeson>0.00</vICMSDeson>');
  xmlLines.push('        <vFCPUFDest>0.00</vFCPUFDest>');
  xmlLines.push('        <vICMSUFDest>0.00</vICMSUFDest>');
  xmlLines.push('        <vICMSUFRemet>0.00</vICMSUFRemet>');
  xmlLines.push('        <vFCP>0.00</vFCP>');
  xmlLines.push('        <vBCST>0.00</vBCST>');
  xmlLines.push('        <vST>0.00</vST>');
  xmlLines.push('        <vFCPST>0.00</vFCPST>');
  xmlLines.push('        <vFCPSTRet>0.00</vFCPSTRet>');
  xmlLines.push(`        <vProd>${totals.vProd}</vProd>`);
  xmlLines.push('        <vFrete>0.00</vFrete>');
  xmlLines.push('        <vSeg>0.00</vSeg>');
  xmlLines.push('        <vDesc>0.00</vDesc>');
  xmlLines.push('        <vII>0.00</vII>');
  xmlLines.push('        <vIPI>0.00</vIPI>');
  xmlLines.push('        <vIPIDevol>0.00</vIPIDevol>');
  xmlLines.push('        <vPIS>0.00</vPIS>');
  xmlLines.push('        <vCOFINS>0.00</vCOFINS>');
  xmlLines.push('        <vOutro>0.00</vOutro>');
  xmlLines.push(`        <vNF>${totals.vNF}</vNF>`);
  xmlLines.push('      </ICMSTot>');
  xmlLines.push('    </total>');
  xmlLines.push('    <pag>');
  xmlLines.push('      <detPag>');
  xmlLines.push('        <tPag>01</tPag>');
  xmlLines.push(`        <vPag>${totals.vNF}</vPag>`);
  xmlLines.push('      </detPag>');
  xmlLines.push('      <vTroco>0.00</vTroco>');
  xmlLines.push('    </pag>');
  xmlLines.push('    <infAdic>');
  xmlLines.push('      <infCpl>DOCUMENTO GERADO PARA HOMOLOGAÇÃO</infCpl>');
  xmlLines.push('    </infAdic>');
  xmlLines.push('  </infNFe>');
  xmlLines.push('</NFe>');

  const baseXml = xmlLines.join('\n');

  const certB64 = certificatePem
    .replace('-----BEGIN CERTIFICATE-----', '')
    .replace('-----END CERTIFICATE-----', '')
    .replace(/\s+/g, '');

  if (!/-----BEGIN (?:RSA )?PRIVATE KEY-----/.test(privateKeyPem)) {
    throw new Error('Chave privada inválida/ausente.');
  }

  const signer = new SignedXml({
    privateKey: Buffer.isBuffer(privateKeyPem)
      ? privateKeyPem
      : Buffer.from(String(privateKeyPem)),
    signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
  });
  signer.canonicalizationAlgorithm = 'http://www.w3.org/2001/10/xml-exc-c14n#';
  signer.keyInfoProvider = {
    getKeyInfo: () => `<X509Data><X509Certificate>${certB64}</X509Certificate></X509Data>`,
  };
  signer.addReference({
    xpath: "//*[local-name(.)='infNFe' and @Id]",
    transforms: [
      'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
      'http://www.w3.org/2001/10/xml-exc-c14n#',
    ],
    digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
  });
  signer.computeSignature(baseXml, { prefix: '' });

  const signedXml = signer.getSignedXml();
  const digestValue = signer.references?.[0]?.digestValue || '';

  const qrParams = new URLSearchParams();
  qrParams.set('chNFe', accessKey);
  qrParams.set('nVersao', '100');
  qrParams.set('tpAmb', tpAmb);
  qrParams.set('dhEmi', dhEmi);
  qrParams.set('vNF', totals.vNF);
  qrParams.set('vICMS', '0.00');
  qrParams.set('digVal', digestValue);
  qrParams.set('cIdToken', String(cscId));
  const qrBase = qrParams.toString();
  const cHashQRCode = crypto.createHash('sha1').update(`${qrBase}${cscToken}`).digest('hex');
  const qrPayload = `${qrBase}&cHashQRCode=${cHashQRCode}`;
  const urlChave = process.env.NFCE_URL_CONSULTA || 'https://www.sefaz.ms.gov.br/nfce/consulta';

  const signatureIndex = signedXml.indexOf('<Signature');
  const supl = [
    '  <infNFeSupl>',
    `    <qrCode><![CDATA[${qrPayload}]]></qrCode>`,
    `    <urlChave>${urlChave}</urlChave>`,
    '  </infNFeSupl>',
  ].join('\n');

  const finalXml =
    signatureIndex === -1
      ? signedXml.replace('</NFe>', `${supl}\n</NFe>`)
      : `${signedXml.slice(0, signatureIndex)}${supl}\n${signedXml.slice(signatureIndex)}`;

  const normalizedXml = finalXml.startsWith('<?xml')
    ? finalXml
    : `<?xml version="1.0" encoding="UTF-8"?>\n${finalXml}`;

  return {
    xml: normalizedXml,
    accessKey,
    digestValue,
    dhEmi,
    cnf,
  };
};

const buildEnviNfe = ({ xml, loteId }) => {
  const payload = xml.replace(/^\s*<\?xml[^>]*>\s*/i, '');
  return [
    '<enviNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">',
    `  <idLote>${loteId}</idLote>`,
    '  <indSinc>1</indSinc>',
    payload
      .split('\n')
      .map((line) => `  ${line}`)
      .join('\n'),
    '</enviNFe>',
  ].join('\n');
};

const ensureEnv = (key, fallback = null) => {
  const value = process.env[key];
  if (value === undefined || value === null) {
    if (fallback !== null) {
      return fallback;
    }
    throw new Error(`Variável de ambiente obrigatória não definida: ${key}`);
  }
  return String(value).trim();
};

const main = async () => {
  try {
    const ambiente = process.env.NFCE_AMBIENTE || 'homologacao';
    const uf = (process.env.NFCE_UF || 'MS').toUpperCase();
    const pfxPath = ensureEnv('CERT_PFX_PATH');
    const pfxPassword = ensureEnv('CERT_PFX_PASSWORD');
    const cscId = ensureEnv('NFCE_CSC_ID');
    const cscToken = ensureEnv('NFCE_CSC_TOKEN');

    const emitter = {
      cnpj: ensureEnv('NFCE_EMIT_CNPJ', '99999999000191'),
      ie: ensureEnv('NFCE_EMIT_IE', '123456789'),
      razao: ensureEnv('NFCE_EMIT_RAZAO', 'EMPRESA HOMOLOGACAO'),
      fantasia: process.env.NFCE_EMIT_FANTASIA || undefined,
      logradouro: process.env.NFCE_EMIT_LOGRADOURO || 'Rua Teste',
      numeroEndereco: process.env.NFCE_EMIT_NUMERO || '100',
      bairro: process.env.NFCE_EMIT_BAIRRO || 'Centro',
      municipio: process.env.NFCE_EMIT_MUNICIPIO || 'CAMPO GRANDE',
      cep: process.env.NFCE_EMIT_CEP || '79000000',
      fone: process.env.NFCE_EMIT_FONE || null,
      crt: process.env.NFCE_EMIT_CRT || '1',
      natureza: process.env.NFCE_EMIT_NATUREZA || 'VENDA AO CONSUMIDOR',
      serie: process.env.NFCE_EMIT_SERIE || '1',
      numero: process.env.NFCE_EMIT_NUMERO || '1',
      cMun: process.env.NFCE_EMIT_CMUN || '5002704',
    };

    const destination = {
      cpf: process.env.NFCE_DEST_CPF || '',
      nome: process.env.NFCE_DEST_NOME || 'CONSUMIDOR NÃO IDENTIFICADO',
      logradouro: process.env.NFCE_DEST_LOGRADOURO || 'Rua Consumidor',
      numero: process.env.NFCE_DEST_NUMERO || '0',
      bairro: process.env.NFCE_DEST_BAIRRO || 'Centro',
    };

    const quantity = Number(process.env.NFCE_ITEM_QTD || '1').toFixed(4);
    const unitPrice = Number(process.env.NFCE_ITEM_PRECO || '10.00').toFixed(2);
    const totalValue = (Number(quantity) * Number(unitPrice)).toFixed(2);

    const item = {
      codigo: process.env.NFCE_ITEM_CODIGO || '0001',
      descricao: process.env.NFCE_ITEM_DESCRICAO || 'Produto de Teste NFC-e',
      ncm: process.env.NFCE_ITEM_NCM || '19059020',
      unidade: process.env.NFCE_ITEM_UNIDADE || 'UN',
      quantidade,
      precoUnitario: Number(unitPrice).toFixed(2),
      valorTotal: Number(totalValue).toFixed(2),
    };

    const totals = {
      vProd: Number(totalValue).toFixed(2),
      vNF: Number(totalValue).toFixed(2),
    };

    const pfxBuffer = loadPfxBuffer(pfxPath);
    const { privateKeyPem, certificatePem, certificateChain } = extractCertificatePair(
      pfxBuffer,
      pfxPassword
    );

    const { xml, accessKey, digestValue, dhEmi, cnf } = buildNfceXml({
      uf,
      environment: ambiente,
      emitter,
      destination,
      item,
      totals,
      cscId,
      cscToken,
      certificatePem,
      privateKeyPem,
    });

    const loteId = sanitizeDigits(`${cnf}${Date.now()}`, '1').padStart(15, '0');
    const enviNfe = buildEnviNfe({ xml, loteId });

    const { responseXml, status, message, protocol, receipt } = await transmitNfceToSefaz({
      xml,
      uf,
      environment: ambiente,
      certificate: certificatePem,
      certificateChain,
      privateKey: privateKeyPem,
      lotId: loteId,
    });

    console.log('Chave de acesso gerada:', accessKey);
    console.log('Digest Value:', digestValue);
    console.log('Data/hora de emissão:', dhEmi);
    console.log('Resposta da SEFAZ:');
    console.log(responseXml);
    console.log('Status do protocolo:', status);
    console.log('Mensagem:', message);
    console.log('Número do protocolo:', protocol);
    console.log('Número do recibo:', receipt);
    console.log('XML assinado pronto para envio salvo na memória.');
  } catch (error) {
    if (error instanceof SefazTransmissionError) {
      console.error('Falha na autorização da NFC-e:', error.message);
      if (error.details) {
        console.error('Detalhes:', JSON.stringify(error.details, null, 2));
      }
    } else {
      console.error('Erro ao executar envio de NFC-e em homologação:', error.message || error);
    }
    process.exitCode = 1;
  }
};

main();
