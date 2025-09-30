const https = require('https');
const { URL } = require('url');
const tls = require('tls');
const dgram = require('dgram');
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

const STATUS_ENDPOINTS = {
  homologacao: {
    MS: 'https://nfcehomologacao.sefaz.ms.gov.br/ws/NFeStatusServico4/NFeStatusServico4.asmx',
    default: 'https://nfce-homologacao.svrs.rs.gov.br/ws/NfeStatusServico/NFeStatusServico4.asmx',
  },
  producao: {
    MS: 'https://nfce.sefaz.ms.gov.br/ws/NFeStatusServico4/NFeStatusServico4.asmx',
    default: 'https://nfce.svrs.rs.gov.br/ws/NfeStatusServico/NFeStatusServico4.asmx',
  },
};

const STATUS_SOAP_ACTION =
  'http://www.portalfiscal.inf.br/nfe/wsdl/NFeStatusServico4/nfeStatusServicoNF';

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

const wait = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, Number(ms) || 0));
  });

const NTP_PACKET_SIZE = 48;
const NTP_PORT = 123;
const NTP_UNIX_EPOCH_DELTA = 2208988800; // seconds between 1900-01-01 and 1970-01-01
const CLOCK_RESYNC_INTERVAL = 10 * 60 * 1000;
const DEFAULT_NTP_SERVER = process.env.NFCE_NTP_SERVER || 'pool.ntp.org';

let lastClockSync = 0;
let clockOffsetMs = 0;

const queryClockOffset = (server = DEFAULT_NTP_SERVER) => {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    const packet = Buffer.alloc(NTP_PACKET_SIZE);
    packet[0] = 0x1b;

    const handleError = (error) => {
      try {
        socket.close();
      } catch (closeError) {
        // ignore
      }
      reject(error);
    };

    const timeout = setTimeout(() => {
      clearTimeout(timeout);
      handleError(new Error('Timeout ao consultar servidor NTP.'));
    }, 5000);

    socket.once('error', (error) => {
      clearTimeout(timeout);
      handleError(error);
    });

    socket.once('message', (message) => {
      clearTimeout(timeout);
      try {
        if (!message || message.length < NTP_PACKET_SIZE) {
          throw new Error('Resposta NTP inválida.');
        }
        const seconds = message.readUInt32BE(40);
        const fractions = message.readUInt32BE(44);
        const ntpTime = seconds - NTP_UNIX_EPOCH_DELTA + fractions / 0x100000000;
        const serverMs = ntpTime * 1000;
        const offset = serverMs - Date.now();
        resolve(offset);
      } catch (error) {
        reject(error);
      } finally {
        try {
          socket.close();
        } catch (closeError) {
          // ignore
        }
      }
    });

    socket.send(packet, 0, packet.length, NTP_PORT, server, (error) => {
      if (error) {
        clearTimeout(timeout);
        handleError(error);
      }
    });
  });
};

const ensureClockSynchronization = async () => {
  const now = Date.now();
  if (now - lastClockSync < CLOCK_RESYNC_INTERVAL) {
    return clockOffsetMs;
  }

  lastClockSync = now;
  try {
    const offset = await queryClockOffset();
    clockOffsetMs = offset;
    if (Math.abs(offset) > 1000) {
      console.info(`[SEFAZ] Ajuste de relógio estimado: ${offset.toFixed(0)}ms.`);
    }
  } catch (error) {
    console.warn(`[SEFAZ] Falha ao sincronizar relógio via NTP: ${error.message}`);
  }
  return clockOffsetMs;
};

const getSynchronizedDate = () => new Date(Date.now() + clockOffsetMs);

const removeXmlDeclaration = (xml) => {
  if (!xml) return '';
  return String(xml).replace(/^\s*<\?xml[^>]*>\s*/i, '').trim();
};

const buildEnviNfePayload = ({ xml, loteId, synchronous = true }) => {
  const normalizedNfe = removeXmlDeclaration(xml);
  const lote = String(loteId || Date.now())
    .replace(/\D+/g, '')
    .padStart(15, '0')
    .slice(-15);

  return (
    '<enviNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">' +
    `<idLote>${lote}</idLote>` +
    `<indSinc>${synchronous ? '1' : '0'}</indSinc>` +
    normalizedNfe +
    '</enviNFe>'
  );
};

const UF_CODE_BY_ACRONYM = {
  AC: '12',
  AL: '27',
  AM: '13',
  AP: '16',
  BA: '29',
  CE: '23',
  DF: '53',
  ES: '32',
  GO: '52',
  MA: '21',
  MG: '31',
  MS: '50',
  MT: '51',
  PA: '15',
  PB: '25',
  PE: '26',
  PI: '22',
  PR: '41',
  RJ: '33',
  RN: '24',
  RO: '11',
  RR: '14',
  RS: '43',
  SC: '42',
  SE: '28',
  SP: '35',
  TO: '17',
};

const resolveUfCode = (uf) => {
  if (!uf && uf !== 0) {
    return '00';
  }

  const normalized = String(uf).trim();
  if (!normalized) {
    return '00';
  }

  if (/^\d{2}$/.test(normalized)) {
    return normalized;
  }

  const acronym = normalized.toUpperCase();
  return UF_CODE_BY_ACRONYM[acronym] || '00';
};

const buildSoapEnvelope = ({ enviNfeXml, uf }) => {
  const sanitized = removeXmlDeclaration(enviNfeXml);

  const ufCode = resolveUfCode(uf);

  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"',
    '                 xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"',
    '                 xmlns:xsd="http://www.w3.org/2001/XMLSchema">',
    '  <soap12:Header>',
    '    <nfeCabecMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4">',
    `      <cUF>${ufCode}</cUF>`,
    '      <versaoDados>4.00</versaoDados>',
    '    </nfeCabecMsg>',
    '  </soap12:Header>',
    '  <soap12:Body>',
    `    <nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4">${sanitized}</nfeDadosMsg>`,
    '  </soap12:Body>',
    '</soap12:Envelope>',
  ].join('\n');
};

const buildStatusSoapEnvelope = ({ payloadXml, uf }) => {
  const sanitized = removeXmlDeclaration(payloadXml);

  const ufCode = resolveUfCode(uf);

  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"',
    '                 xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"',
    '                 xmlns:xsd="http://www.w3.org/2001/XMLSchema">',
    '  <soap12:Header>',
    '    <nfeCabecMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeStatusServico4">',
    `      <cUF>${ufCode}</cUF>`,
    '      <versaoDados>4.00</versaoDados>',
    '    </nfeCabecMsg>',
    '  </soap12:Header>',
    '  <soap12:Body>',
    `    <nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeStatusServico4">${sanitized}</nfeDadosMsg>`,
    '  </soap12:Body>',
    '</soap12:Envelope>',
  ].join('\n');
};

const buildStatusPayload = ({ uf, environment }) => {
  const ufCode = resolveUfCode(uf);
  const tpAmb = environment === 'producao' ? '1' : '2';
  return [
    '<consStatServ xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">',
    `  <tpAmb>${tpAmb}</tpAmb>`,
    `  <cUF>${ufCode}</cUF>`,
    '  <xServ>STATUS</xServ>',
    '</consStatServ>',
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

const resolveStatusEndpoint = (uf, environment) => {
  const envKey = environment === 'producao' ? 'producao' : 'homologacao';
  const map = STATUS_ENDPOINTS[envKey] || {};
  const normalizedUf = (uf || '').toString().trim().toUpperCase();
  const endpoint = map[normalizedUf] || map.default;
  if (!endpoint) {
    throw new SefazTransmissionError('Endpoint de status da SEFAZ não configurado para o estado informado.');
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

const performSoapRequest = async ({
  endpoint,
  envelope,
  certificate,
  certificateChain = [],
  privateKey,
  timeout = 45000,
  soapAction = SOAP_ACTION,
}) => {
  await ensureClockSynchronization();

  const envelopeString = typeof envelope === 'string' ? envelope : String(envelope || '');
  const envelopePreview = envelopeString.slice(0, 2000);
  const maxAttempts = 2;

  const attemptRequest = (attempt = 1) => {
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
        if (formattedCertificate && !/-----BEGIN CERTIFICATE-----/.test(formattedCertificate)) {
          throw new SefazTransmissionError('Certificado do cliente inválido.');
        }

        const normalizedPrivateKey = normalizePem(privateKey);
        if (!normalizedPrivateKey || !/-----BEGIN (?:RSA )?PRIVATE KEY-----/.test(normalizedPrivateKey)) {
          throw new SefazTransmissionError('Chave privada inválida/ausente.');
        }

        const headers = {
          'Content-Type': `application/soap+xml; charset=utf-8; action="${soapAction}"`,
          'Content-Length': Buffer.byteLength(envelopeString, 'utf8'),
          'User-Agent': 'EoBicho-PDV/1.0',
        };

        const options = {
          method: 'POST',
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port || (isHttps ? 443 : 80),
          path: `${url.pathname}${url.search || ''}`,
          headers,
          key: normalizedPrivateKey,
          minVersion: 'TLSv1.2',
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

        const logPrefix = `[SEFAZ] [SOAP tentativa ${attempt}]`;
        console.info(`${logPrefix} Envelope (máx. 2000 chars): ${envelopePreview}`);

        const request = https.request(options, (response) => {
          let body = '';
          response.setEncoding('utf8');
          response.on('data', (chunk) => {
            body += chunk;
          });
          response.on('end', () => {
            const trimmed = body.trim();
            const firstLine = trimmed.split(/\r?\n/).find((line) => line.trim()) || '';
            console.info(`${logPrefix} Primeira linha da resposta: ${firstLine}`);
            if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) {
              resolve(trimmed);
            } else {
              reject(
                new SefazTransmissionError(
                  `SEFAZ retornou status HTTP ${response.statusCode || 'desconhecido'}.`,
                  { statusCode: response.statusCode, body: trimmed }
                )
              );
            }
          });
        });

        if (typeof timeout === 'number' && timeout > 0) {
          request.setTimeout(timeout);
        }

        request.on('error', (error) => {
          reject(
            new SefazTransmissionError('Falha de comunicação com a SEFAZ.', {
              cause: error,
              attempt,
            })
          );
        });

        request.on('timeout', () => {
          request.destroy();
          reject(
            new SefazTransmissionError('Tempo limite excedido ao comunicar com a SEFAZ.', {
              timeout: true,
              attempt,
            })
          );
        });

        request.write(envelopeString, 'utf8');
        request.end();
      } catch (error) {
        if (error instanceof SefazTransmissionError) {
          reject(error);
        } else {
          reject(
            new SefazTransmissionError('Não foi possível enviar a requisição para a SEFAZ.', {
              cause: error,
            })
          );
        }
      }
    }).catch(async (error) => {
      const isTimeout =
        error instanceof SefazTransmissionError && error.details && error.details.timeout === true;
      if (isTimeout && attempt < maxAttempts) {
        const delay = 1000 * 2 ** (attempt - 1);
        console.warn(
          `[SEFAZ] [SOAP tentativa ${attempt}] Tempo limite. Repetindo em ${delay}ms (máx. ${maxAttempts} tentativas).`
        );
        await wait(delay);
        return attemptRequest(attempt + 1);
      }
      throw error;
    });
  };

  return attemptRequest();
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
  if (!/versao="4\.00"/.test(enviNfe)) {
    throw new SefazTransmissionError('enviNFe deve ser gerado na versão 4.00.');
  }

  const loteMatch = /<idLote>([^<]+)<\/idLote>/.exec(enviNfe);
  if (!loteMatch || !/^\d+$/.test(loteMatch[1])) {
    throw new SefazTransmissionError('IdLote inválido: informe apenas dígitos.');
  }
  const envelope = buildSoapEnvelope({ enviNfeXml: enviNfe, uf });

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

const consultNfceStatusServico = async ({
  uf,
  environment,
  certificate,
  certificateChain,
  privateKey,
}) => {
  const endpoint = resolveStatusEndpoint(uf, environment);
  const payload = buildStatusPayload({ uf, environment });
  const envelope = buildStatusSoapEnvelope({ payloadXml: payload, uf });

  const responseXml = await performSoapRequest({
    endpoint,
    envelope,
    certificate,
    certificateChain,
    privateKey,
    soapAction: STATUS_SOAP_ACTION,
  });

  return {
    endpoint,
    responseXml,
  };
};

module.exports = {
  transmitNfceToSefaz,
  consultNfceStatusServico,
  SefazTransmissionError,
  __TESTING__: {
    performSoapRequest,
    normalizePem,
    collectCertificateAuthorities,
    loadExtraCertificateAuthorities,
    splitCertificatesFromPem,
    extractTagContent,
    extractSection,
    resolveUfCode,
    buildSoapEnvelope,
    buildStatusSoapEnvelope,
    buildStatusPayload,
    buildEnviNfePayload,
    ensureClockSynchronization,
    getSynchronizedDate,
  },
};
