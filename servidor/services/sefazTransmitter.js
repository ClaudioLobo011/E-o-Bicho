const https = require('https');
const { URL } = require('url');
const tls = require('tls');
const forge = require('node-forge');
const fs = require('fs');
const path = require('path');

class SefazTransmissionError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'SefazTransmissionError';
    this.details = details;
  }
}

const AUTORIZACAO_ENDPOINTS = {
  homologacao: {
    MS: 'https://nfcehomologacao.sefaz.ms.gov.br/ws/NFeAutorizacao4/NFeAutorizacao4.asmx',
    default: 'https://nfce-homologacao.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx',
  },
  producao: {
    MS: 'https://nfce.sefaz.ms.gov.br/ws/NFeAutorizacao4/NFeAutorizacao4.asmx',
    default: 'https://nfce.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx',
  },
};

const SOAP_ACTION =
  'http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4/nfeAutorizacaoLote';

const CERTIFICATE_PATTERN = /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g;

const EXTRA_CA_TEXT_ENV_VARS = [
  'NFCE_EXTRA_CA',
  'NFCE_EXTRA_CA_BUNDLE',
  'NFCE_ADDITIONAL_CA',
  'NFCE_ADDITIONAL_CA_BUNDLE',
];

const EXTRA_CA_PATH_ENV_VARS = [
  'NFCE_EXTRA_CA_FILE',
  'NFCE_EXTRA_CA_PATH',
  'NFCE_EXTRA_CA_FILES',
  'NFCE_EXTRA_CA_PATHS',
  'NFCE_ADDITIONAL_CA_FILE',
  'NFCE_ADDITIONAL_CA_PATH',
  'NFCE_ADDITIONAL_CA_FILES',
  'NFCE_ADDITIONAL_CA_PATHS',
];

const DEFAULT_EXTRA_CA_FILES = [
  path.resolve(__dirname, '../config/sefaz-ca-bundle.pem'),
];

const removeXmlDeclaration = (xml) => {
  if (!xml) return '';
  return String(xml).replace(/^\s*<\?xml[^>]*>\s*/i, '').trim();
};

const indentXml = (xml, indent = '') => {
  return removeXmlDeclaration(xml)
    .split('\n')
    .map((line) => `${indent}${line}`)
    .join('\n');
};

const buildEnviNfePayload = ({ xml, loteId, synchronous = true }) => {
  const normalizedNfe = removeXmlDeclaration(xml);
  const lote = String(loteId || Date.now())
    .replace(/\D+/g, '')
    .padStart(15, '0')
    .slice(-15);

  const nfeIndented = indentXml(normalizedNfe, '  ');

  return [
    '<enviNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">',
    `  <idLote>${lote}</idLote>`,
    `  <indSinc>${synchronous ? '1' : '0'}</indSinc>`,
    nfeIndented,
    '</enviNFe>',
  ].join('\n');
};

const buildSoapEnvelope = (enviNfeXml) => {
  const nfeBody = enviNfeXml
    .split('\n')
    .map((line) => `        ${line}`)
    .join('\n');

  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<soap12:Envelope',
    '  xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"',
    '  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"',
    '  xmlns:xsd="http://www.w3.org/2001/XMLSchema"',
    '>',
    '  <soap12:Body>',
    '    <nfeAutorizacaoLote xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4">',
    '      <nfeDadosMsg>',
    nfeBody,
    '      </nfeDadosMsg>',
    '    </nfeAutorizacaoLote>',
    '  </soap12:Body>',
    '</soap12:Envelope>',
  ].join('\n');
};

const resolveEndpoint = (uf, environment) => {
  const envKey = environment === 'producao' ? 'producao' : 'homologacao';
  const map = AUTORIZACAO_ENDPOINTS[envKey] || {};
  const normalizedUf = (uf || '').toString().trim().toUpperCase();
  const endpoint = map[normalizedUf] || map.default;
  if (!endpoint) {
    throw new SefazTransmissionError('Endpoint da SEFAZ não configurado para o estado informado.');
  }
  return endpoint;
};

const distinguishNameToString = (name = {}) => {
  if (!name || !Array.isArray(name.attributes)) {
    return '';
  }

  return name.attributes
    .map((attribute) => {
      if (!attribute) return '';
      const key = attribute.shortName || attribute.name || '';
      const value = attribute.value || '';
      if (!key) {
        return value ? String(value) : '';
      }
      return `${key}=${value}`;
    })
    .filter(Boolean)
    .join(',');
};

const normalizePem = (pem) => {
  if (!pem) return '';
  const trimmed = String(pem).trim();
  if (!trimmed) return '';
  return trimmed.endsWith('\n') ? trimmed : `${trimmed}\n`;
};

const orderCertificateChain = (chain = []) => {
  if (!Array.isArray(chain) || chain.length <= 1) {
    return Array.isArray(chain) ? chain.filter(Boolean) : [];
  }

  try {
    const parsed = chain
      .map((pem) => {
        const normalized = (pem || '').trim();
        if (!normalized) return null;
        const certificate = forge.pki.certificateFromPem(normalized);
        return {
          pem: normalized,
          subject: distinguishNameToString(certificate.subject),
          issuer: distinguishNameToString(certificate.issuer),
        };
      })
      .filter(Boolean);

    if (!parsed.length) {
      return [];
    }

    const issuerSubjects = new Set(parsed.map((entry) => entry.issuer));
    const used = new Set();

    const leaf = parsed.find((entry) => !issuerSubjects.has(entry.subject)) || parsed[0];
    const ordered = [];

    let current = leaf;
    while (current && !used.has(current.pem)) {
      ordered.push(current.pem);
      used.add(current.pem);
      const next = parsed.find(
        (candidate) => !used.has(candidate.pem) && candidate.subject === current.issuer
      );
      current = next || null;
    }

    for (const entry of parsed) {
      if (!used.has(entry.pem)) {
        ordered.push(entry.pem);
        used.add(entry.pem);
      }
    }

    return ordered;
  } catch (error) {
    return chain.filter((entry) => entry && String(entry).trim());
  }
};

const collectCertificateAuthorities = (chain = []) => {
  if (!Array.isArray(chain) || chain.length <= 1) {
    return [];
  }

  const authorities = [];

  for (const entry of chain.slice(1)) {
    const normalizedEntry = normalizePem(entry);
    if (!normalizedEntry) {
      continue;
    }

    try {
      const certificate = forge.pki.certificateFromPem(normalizedEntry);
      const basicConstraints = Array.isArray(certificate.extensions)
        ? certificate.extensions.find((extension) => extension?.name === 'basicConstraints')
        : null;

      const isCertificateAuthority = Boolean(basicConstraints?.cA);
      const subject = distinguishNameToString(certificate.subject);
      const issuer = distinguishNameToString(certificate.issuer);
      const isSelfSigned = subject && issuer && subject === issuer;

      if ((isCertificateAuthority || isSelfSigned) && !authorities.includes(normalizedEntry)) {
        authorities.push(normalizedEntry);
      }
    } catch (error) {
      // Ignore parsing errors and skip certificates that cannot be processed.
    }
  }

  return authorities;
};

const splitCertificatesFromPem = (input) => {
  if (!input) {
    return [];
  }

  const asString = Buffer.isBuffer(input) ? input.toString('utf8') : String(input);
  const matches = asString.match(CERTIFICATE_PATTERN);
  if (!matches || !matches.length) {
    const trimmed = asString.trim();
    return trimmed ? [trimmed] : [];
  }

  return matches.map((entry) => entry.trim()).filter(Boolean);
};

const loadExtraCertificateAuthorities = () => {
  const collected = [];
  const seen = new Set();

  for (const envVar of EXTRA_CA_TEXT_ENV_VARS) {
    const value = process.env[envVar];
    if (!value) continue;
    for (const certificate of splitCertificatesFromPem(value)) {
      const trimmed = certificate.trim();
      if (trimmed && !seen.has(trimmed)) {
        seen.add(trimmed);
        collected.push(trimmed);
      }
    }
  }

  const candidatePaths = new Set();

  for (const envVar of EXTRA_CA_PATH_ENV_VARS) {
    const value = process.env[envVar];
    if (!value) continue;
    const parts = String(value)
      .split(/[;,\n]+/)
      .map((part) => part.trim())
      .filter(Boolean);
    for (const part of parts) {
      candidatePaths.add(part);
    }
  }

  for (const defaultPath of DEFAULT_EXTRA_CA_FILES) {
    candidatePaths.add(defaultPath);
  }

  const processedFiles = new Set();

  for (const candidate of candidatePaths) {
    try {
      const resolved = path.isAbsolute(candidate)
        ? candidate
        : path.resolve(process.cwd(), candidate);
      if (processedFiles.has(resolved)) {
        continue;
      }
      const content = fs.readFileSync(resolved, 'utf8');
      processedFiles.add(resolved);
      for (const certificate of splitCertificatesFromPem(content)) {
        const trimmed = certificate.trim();
        if (trimmed && !seen.has(trimmed)) {
          seen.add(trimmed);
          collected.push(trimmed);
        }
      }
    } catch (error) {
      // Ignore missing files or read errors.
    }
  }

  return collected;
};

const performSoapRequest = ({
  endpoint,
  envelope,
  certificate,
  certificateChain = [],
  privateKey,
  timeout = 45000,
}) => {
  return new Promise((resolve, reject) => {
    try {
      const url = new URL(endpoint);
      const isHttps = url.protocol === 'https:';
      const normalizedChain = Array.isArray(certificateChain)
        ? certificateChain
            .map((entry) => {
              if (!entry) return null;
              if (Buffer.isBuffer(entry)) {
                const asString = entry.toString();
                return asString.trim() ? asString : null;
              }
              const asString = String(entry);
              return asString.trim() ? asString : null;
            })
            .filter((pem, index, array) => pem && array.indexOf(pem) === index)
        : [];

      const normalizedCertificate = (() => {
        if (!certificate) return '';
        if (Buffer.isBuffer(certificate)) {
          const asString = certificate.toString();
          return asString.trim() ? asString : '';
        }
        const asString = String(certificate);
        return asString.trim() ? asString : '';
      })();

      if (normalizedCertificate) {
        const existingIndex = normalizedChain.indexOf(normalizedCertificate);
        if (existingIndex >= 0) {
          normalizedChain.splice(existingIndex, 1);
        }
        normalizedChain.unshift(normalizedCertificate);
      }

      const orderedChain = orderCertificateChain(normalizedChain);

      const certificateList = [];
      for (const entry of orderedChain) {
        const normalizedEntry = (entry || '').trim();
        if (normalizedEntry && !certificateList.includes(normalizedEntry)) {
          certificateList.push(normalizedEntry);
        }
      }

      const formattedCertificate = certificateList.map((entry) => normalizePem(entry)).join('');

      const options = {
        method: 'POST',
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: `${url.pathname}${url.search || ''}`,
        headers: {
          'Content-Type': 'application/soap+xml; charset=utf-8',
          SOAPAction: SOAP_ACTION,
          'Content-Length': Buffer.byteLength(envelope),
          'User-Agent': 'EoBicho-PDV/1.0',
        },
        key: privateKey,
      };

      if (formattedCertificate) {
        options.cert = formattedCertificate;
      }

      const defaultCaBundle = Array.isArray(tls.rootCertificates)
        ? tls.rootCertificates.map((entry) => normalizePem(entry)).filter(Boolean)
        : [];
      const additionalAuthorities = collectCertificateAuthorities(certificateList)
        .map((entry) => normalizePem(entry))
        .filter((entry) => entry && !defaultCaBundle.includes(entry));
      const extraAuthorities = loadExtraCertificateAuthorities()
        .map((entry) => normalizePem(entry))
        .filter((entry) => entry && !defaultCaBundle.includes(entry));

      const caBundle = [...defaultCaBundle];
      let caBundleModified = false;

      for (const authority of additionalAuthorities) {
        if (!caBundle.includes(authority)) {
          caBundle.push(authority);
          caBundleModified = true;
        }
      }

      for (const authority of extraAuthorities) {
        if (!caBundle.includes(authority)) {
          caBundle.push(authority);
          caBundleModified = true;
        }
      }

      if (caBundleModified) {
        options.ca = caBundle;
      }

      const request = https.request(options, (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          body += chunk;
        });
        response.on('end', () => {
          if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) {
            resolve(body.trim());
          } else {
            reject(
              new SefazTransmissionError(
                `SEFAZ retornou status HTTP ${response.statusCode || 'desconhecido'}.`,
                { statusCode: response.statusCode, body }
              )
            );
          }
        });
      });

      if (typeof timeout === 'number' && timeout > 0) {
        request.setTimeout(timeout);
      }

      request.on('error', (error) => {
        reject(new SefazTransmissionError('Falha de comunicação com a SEFAZ.', { cause: error }));
      });

      request.on('timeout', () => {
        request.destroy();
        reject(new SefazTransmissionError('Tempo limite excedido ao comunicar com a SEFAZ.'));
      });

      request.write(envelope);
      request.end();
    } catch (error) {
      reject(new SefazTransmissionError('Não foi possível enviar a requisição para a SEFAZ.', { cause: error }));
    }
  });
};

const escapeTagName = (tag) => tag.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&');

const buildNamespacedTagRegex = (tag) => {
  const escapedTag = escapeTagName(tag);
  return new RegExp(`<((?:[A-Za-z_][\\w.-]*:)?${escapedTag})[^>]*>([\\s\\S]*?)</\\1>`, 'i');
};

const extractTagContent = (xml, tag) => {
  if (!xml) return null;
  const regex = buildNamespacedTagRegex(tag);
  const match = regex.exec(xml);
  return match ? match[2].trim() : null;
};

const extractSection = (xml, tag) => {
  if (!xml) return null;
  const regex = buildNamespacedTagRegex(tag);
  const match = regex.exec(xml);
  return match ? match[0] : null;
};

const transmitNfceToSefaz = async ({
  xml,
  uf,
  environment,
  certificate,
  certificateChain,
  privateKey,
  lotId,
}) => {
  const endpoint = resolveEndpoint(uf, environment);
  const enviNfe = buildEnviNfePayload({ xml, loteId: lotId, synchronous: true });
  const envelope = buildSoapEnvelope(enviNfe);

  const responseXml = await performSoapRequest({
    endpoint,
    envelope,
    certificate,
    certificateChain,
    privateKey,
  });

  const retEnviSection = extractSection(responseXml, 'retEnviNFe');
  if (!retEnviSection) {
    throw new SefazTransmissionError('Resposta da SEFAZ não contém o retorno do envio da NFC-e.', {
      response: responseXml,
    });
  }

  const loteStatus = extractTagContent(retEnviSection, 'cStat');
  const loteMessage = extractTagContent(retEnviSection, 'xMotivo');
  const receipt = extractTagContent(retEnviSection, 'nRec');

  if (loteStatus !== '104') {
    throw new SefazTransmissionError(
      `SEFAZ não processou o lote (${loteStatus || 'sem código'} - ${loteMessage || 'sem mensagem'}).`,
      {
        response: responseXml,
        loteStatus,
        loteMessage,
      }
    );
  }

  const protSection = extractSection(retEnviSection, 'protNFe');
  if (!protSection) {
    throw new SefazTransmissionError('SEFAZ não retornou protocolo para a NFC-e enviada.', {
      response: responseXml,
      loteStatus,
      loteMessage,
    });
  }

  const protocolStatus = extractTagContent(protSection, 'cStat');
  const protocolMessage = extractTagContent(protSection, 'xMotivo');
  const protocolNumber = extractTagContent(protSection, 'nProt');
  const processedAt = extractTagContent(protSection, 'dhRecbto');

  if (!['100', '150'].includes(protocolStatus)) {
    throw new SefazTransmissionError(
      `SEFAZ rejeitou a NFC-e (${protocolStatus || 'sem código'} - ${protocolMessage || 'sem mensagem'}).`,
      {
        response: responseXml,
        loteStatus,
        loteMessage,
        protocolStatus,
        protocolMessage,
      }
    );
  }

  return {
    endpoint,
    responseXml,
    receipt,
    status: protocolStatus,
    message: protocolMessage,
    protocol: protocolNumber,
    processedAt,
    loteStatus,
    loteMessage,
  };
};

module.exports = {
  transmitNfceToSefaz,
  SefazTransmissionError,
  __TESTING__: {
    performSoapRequest,
    normalizePem,
    collectCertificateAuthorities,
    loadExtraCertificateAuthorities,
    splitCertificatesFromPem,
    extractTagContent,
    extractSection,
  },
};
