const https = require('https');
const { URL } = require('url');

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
    '<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope" xmlns:nfe="http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4">',
    '  <soap12:Body>',
    '    <nfe:nfeAutorizacaoLote>',
    '      <nfe:nfeDadosMsg>',
    nfeBody,
    '      </nfe:nfeDadosMsg>',
    '    </nfe:nfeAutorizacaoLote>',
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

      const [leafFromChain, ...intermediateChain] = normalizedChain;
      const effectiveCertificate = (() => {
        if (certificate) {
          if (Buffer.isBuffer(certificate)) {
            const asString = certificate.toString();
            return asString.trim() ? asString : leafFromChain;
          }
          const asString = String(certificate);
          return asString.trim() ? asString : leafFromChain;
        }
        return leafFromChain || '';
      })();

      const certificateList = [];

      const normalizedEffective = (effectiveCertificate || '').trim();
      const normalizedLeaf = (leafFromChain || '').trim();

      if (normalizedEffective) {
        certificateList.push(normalizedEffective);
      } else if (normalizedLeaf) {
        certificateList.push(normalizedLeaf);
      }

      for (const entry of intermediateChain) {
        const normalizedEntry = (entry || '').trim();
        if (normalizedEntry && !certificateList.includes(normalizedEntry)) {
          certificateList.push(normalizedEntry);
        }
      }

      const formattedCertificate = certificateList.filter(Boolean).join('\n');

      const options = {
        method: 'POST',
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: `${url.pathname}${url.search || ''}`,
        headers: {
          'Content-Type': `application/soap+xml; charset=utf-8; action="${SOAP_ACTION}"`,
          'Content-Length': Buffer.byteLength(envelope),
          'User-Agent': 'EoBicho-PDV/1.0',
        },
        key: privateKey,
      };

      if (formattedCertificate) {
        options.cert = formattedCertificate;
      }

      if (intermediateChain.length) {
        options.ca = intermediateChain
          .map((entry) => (entry && entry.trim() ? entry.trim() : ''))
          .filter(Boolean);
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

const extractTagContent = (xml, tag) => {
  if (!xml) return null;
  const regex = new RegExp(`<${tag}[^>]*>([\s\S]*?)</${tag}>`, 'i');
  const match = regex.exec(xml);
  return match ? match[1].trim() : null;
};

const extractSection = (xml, tag) => {
  if (!xml) return null;
  const regex = new RegExp(`<${tag}[^>]*>([\s\S]*?)</${tag}>`, 'i');
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
  },
};
