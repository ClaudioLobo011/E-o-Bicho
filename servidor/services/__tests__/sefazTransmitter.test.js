const test = require('node:test');
const assert = require('node:assert');
const https = require('https');
const tls = require('tls');
const forge = require('node-forge');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('node:events');
const { sanitizeXmlContent } = require('../../utils/xmlSanitizer');

test('performSoapRequest forwards intermediate certificates via options.ca', async () => {
  const originalRequest = https.request;
  let capturedOptions = null;

  const soapResponse = `<?xml version="1.0" encoding="utf-8"?>
  <soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">
    <soap12:Body>
      <nfeAutorizacaoLoteResponse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4">
        <nfeResultMsg>
          <retEnviNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
            <cStat>104</cStat>
            <xMotivo>Lote processado</xMotivo>
            <nRec>123456789012345</nRec>
            <protNFe>
              <infProt>
                <tpAmb>2</tpAmb>
                <verAplic>SVRS</verAplic>
                <chNFe>12345678901234567890123456789012345678901234</chNFe>
                <dhRecbto>2025-01-01T00:00:00-03:00</dhRecbto>
                <nProt>135220000000000</nProt>
                <digVal>abc123==</digVal>
                <cStat>100</cStat>
                <xMotivo>Autorizado o uso da NF-e</xMotivo>
              </infProt>
            </protNFe>
          </retEnviNFe>
        </nfeResultMsg>
      </nfeAutorizacaoLoteResponse>
    </soap12:Body>
  </soap12:Envelope>`;

  https.request = (options, callback) => {
    capturedOptions = options;
    const response = new EventEmitter();
    response.setEncoding = () => {};
    callback(response);

    const request = new EventEmitter();
    request.setTimeout = () => {};
    request.write = () => {};
    request.end = () => {
      process.nextTick(() => {
        response.statusCode = 200;
        response.emit('data', soapResponse);
        response.emit('end');
      });
    };
    request.destroy = () => {};
    request.on = function (event, handler) {
      EventEmitter.prototype.on.call(this, event, handler);
      return this;
    };
    return request;
  };

  delete require.cache[require.resolve('../sefazTransmitter')];
  const { __TESTING__ } = require('../sefazTransmitter');
  const { performSoapRequest, normalizePem } = __TESTING__;

  const certificateChain = [
    '-----BEGIN CERTIFICATE-----\nMIIFleaf\n-----END CERTIFICATE-----\n',
    '-----BEGIN CERTIFICATE-----\nMIIFintermediate\n-----END CERTIFICATE-----\n',
    '-----BEGIN CERTIFICATE-----\nMIIFroot\n-----END CERTIFICATE-----\n',
  ];

  const originalCertificateFromPem = forge.pki.certificateFromPem;

  const certificatesMap = new Map([
    [
      certificateChain[0].trim(),
      {
        subject: { attributes: [{ name: 'commonName', value: 'Client Certificate' }] },
        issuer: { attributes: [{ name: 'commonName', value: 'Intermediate CA' }] },
        extensions: [{ name: 'basicConstraints', cA: false }],
      },
    ],
    [
      certificateChain[1].trim(),
      {
        subject: { attributes: [{ name: 'commonName', value: 'Intermediate CA' }] },
        issuer: { attributes: [{ name: 'commonName', value: 'Root CA' }] },
        extensions: [{ name: 'basicConstraints', cA: true }],
      },
    ],
    [
      certificateChain[2].trim(),
      {
        subject: { attributes: [{ name: 'commonName', value: 'Root CA' }] },
        issuer: { attributes: [{ name: 'commonName', value: 'Root CA' }] },
        extensions: [{ name: 'basicConstraints', cA: true }],
      },
    ],
  ]);

  forge.pki.certificateFromPem = (pem) => {
    const normalized = (pem || '').trim();
    if (certificatesMap.has(normalized)) {
      return certificatesMap.get(normalized);
    }
    return originalCertificateFromPem(pem);
  };

  try {
    const body = await performSoapRequest({
      endpoint: 'https://nfcehomologacao.sefaz.ms.gov.br/ws/NFeAutorizacao4/NFeAutorizacao4.asmx',
      envelope: '<xml />',
      certificate: certificateChain[0],
      certificateChain,
      privateKey: '-----BEGIN PRIVATE KEY-----\nMIIFfake\n-----END PRIVATE KEY-----\n',
    });

    assert.strictEqual(body, soapResponse.trim());
    assert.strictEqual(capturedOptions.cert, certificateChain.map((entry) => normalizePem(entry)).join(''));

    const defaultCaBundle = Array.isArray(tls.rootCertificates)
      ? tls.rootCertificates.map((entry) => normalizePem(entry)).filter(Boolean)
      : [];

    assert.ok(Array.isArray(capturedOptions.ca));
    for (const defaultCa of defaultCaBundle) {
      assert.ok(
        capturedOptions.ca.includes(defaultCa),
        'A lista de CAs deve incluir os certificados raiz padrão do Node.'
      );
    }

    const additionalAuthorities = certificateChain
      .slice(1)
      .map((entry) => normalizePem(entry));

    for (const authority of additionalAuthorities) {
      assert.ok(
        capturedOptions.ca.includes(authority),
        'Os certificados intermediários do cliente devem ser anexados ao bundle de CAs.'
      );
    }

    assert.ok(
      !capturedOptions.ca.includes(normalizePem(certificateChain[0])),
      'O certificado do cliente não deve ser adicionado ao bundle de CAs.'
    );
  } finally {
    https.request = originalRequest;
    forge.pki.certificateFromPem = originalCertificateFromPem;
  }
});

test('performSoapRequest merges extra CA bundles configured via environment', async () => {
  const originalRequest = https.request;
  const originalReadFileSync = fs.readFileSync;

  let capturedOptions = null;

  https.request = (options, callback) => {
    capturedOptions = options;
    const response = new EventEmitter();
    response.setEncoding = () => {};
    callback(response);

    const request = new EventEmitter();
    request.setTimeout = () => {};
    request.write = () => {};
    request.end = () => {
      process.nextTick(() => {
        response.statusCode = 200;
        response.emit('data', '<soap />');
        response.emit('end');
      });
    };
    request.destroy = () => {};
    request.on = function (event, handler) {
      EventEmitter.prototype.on.call(this, event, handler);
      return this;
    };
    return request;
  };

  const fileCertificates = new Map();
  const fakeAbsolutePath = path.join('/etc', 'sefaz-extra-ca.pem');
  const fakeRelativePath = path.join('config', 'custom-sefaz-ca.pem');
  fileCertificates.set(
    fakeAbsolutePath,
    '-----BEGIN CERTIFICATE-----\nFILEABSOLUTE\n-----END CERTIFICATE-----'
  );
  fileCertificates.set(
    path.resolve(process.cwd(), fakeRelativePath),
    '-----BEGIN CERTIFICATE-----\nFILERELATIVE\n-----END CERTIFICATE-----'
  );

  fs.readFileSync = (candidate, encoding) => {
    const normalized = path.isAbsolute(candidate) ? candidate : path.resolve(process.cwd(), candidate);
    if (fileCertificates.has(candidate)) {
      return fileCertificates.get(candidate);
    }
    if (fileCertificates.has(normalized)) {
      return fileCertificates.get(normalized);
    }
    return originalReadFileSync(candidate, encoding || 'utf8');
  };

  process.env.NFCE_EXTRA_CA = '-----BEGIN CERTIFICATE-----\nENVCONFIG\n-----END CERTIFICATE-----';
  process.env.NFCE_EXTRA_CA_PATHS = `${fakeAbsolutePath};${fakeRelativePath}`;

  delete require.cache[require.resolve('../sefazTransmitter')];
  const { __TESTING__ } = require('../sefazTransmitter');
  const { performSoapRequest, normalizePem } = __TESTING__;

  try {
    await performSoapRequest({
      endpoint: 'https://nfce.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx',
      envelope: '<xml />',
      certificate: '-----BEGIN CERTIFICATE-----\nCLIENT\n-----END CERTIFICATE-----',
      certificateChain: ['-----BEGIN CERTIFICATE-----\nCLIENT\n-----END CERTIFICATE-----'],
      privateKey: '-----BEGIN PRIVATE KEY-----\nMIIFfake\n-----END PRIVATE KEY-----',
    });

    const defaultCaBundle = Array.isArray(tls.rootCertificates)
      ? tls.rootCertificates.map((entry) => normalizePem(entry)).filter(Boolean)
      : [];

    const expectedExtras = [
      '-----BEGIN CERTIFICATE-----\nENVCONFIG\n-----END CERTIFICATE-----',
      '-----BEGIN CERTIFICATE-----\nFILEABSOLUTE\n-----END CERTIFICATE-----',
      '-----BEGIN CERTIFICATE-----\nFILERELATIVE\n-----END CERTIFICATE-----',
    ].map((entry) => normalizePem(entry));

    assert.ok(Array.isArray(capturedOptions.ca));
    for (const certificate of defaultCaBundle) {
      assert.ok(
        capturedOptions.ca.includes(certificate),
        'O bundle de CAs deve manter os certificados raiz padrão do Node.'
      );
    }

    for (const certificate of expectedExtras) {
      assert.ok(
        capturedOptions.ca.includes(certificate),
        'Os certificados adicionais devem ser mesclados ao bundle de CAs.'
      );
    }
  } finally {
    https.request = originalRequest;
    fs.readFileSync = originalReadFileSync;
    delete process.env.NFCE_EXTRA_CA;
    delete process.env.NFCE_EXTRA_CA_PATHS;
  }
});

test('loadExtraCertificateAuthorities returns entries from default bundle when present', () => {
  delete process.env.NFCE_EXTRA_CA;
  delete process.env.NFCE_EXTRA_CA_BUNDLE;
  delete process.env.NFCE_EXTRA_CA_FILE;
  delete process.env.NFCE_EXTRA_CA_PATH;
  delete process.env.NFCE_EXTRA_CA_FILES;
  delete process.env.NFCE_EXTRA_CA_PATHS;
  delete process.env.NFCE_ADDITIONAL_CA;
  delete process.env.NFCE_ADDITIONAL_CA_BUNDLE;
  delete process.env.NFCE_ADDITIONAL_CA_FILE;
  delete process.env.NFCE_ADDITIONAL_CA_PATH;
  delete process.env.NFCE_ADDITIONAL_CA_FILES;
  delete process.env.NFCE_ADDITIONAL_CA_PATHS;

  delete require.cache[require.resolve('../sefazTransmitter')];
  const { __TESTING__ } = require('../sefazTransmitter');
  const { loadExtraCertificateAuthorities } = __TESTING__;

  const authorities = loadExtraCertificateAuthorities();

  assert.ok(Array.isArray(authorities), 'O resultado deve ser um array.');
  assert.ok(authorities.length > 0, 'O bundle padrão de CAs da SEFAZ deve ser carregado.');
  for (const entry of authorities) {
    assert.strictEqual(typeof entry, 'string');
    assert.ok(entry.includes('BEGIN CERTIFICATE'), 'Cada CA adicional deve estar em formato PEM.');
  }
});

test('extract helpers tolerate namespace prefixes in SEFAZ responses', () => {
  delete require.cache[require.resolve('../sefazTransmitter')];
  const { __TESTING__ } = require('../sefazTransmitter');
  const { extractSection, extractTagContent } = __TESTING__;

  const soapResponse = `<?xml version="1.0" encoding="utf-8"?>
  <soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope">
    <soap:Body>
      <nfe:autorizacaoResponse xmlns:nfe="http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4">
        <nfe:result>
          <ns2:retEnviNFe xmlns:ns2="http://www.portalfiscal.inf.br/nfe" versao="4.00">
            <ns2:cStat>104</ns2:cStat>
            <ns2:xMotivo>Lote processado</ns2:xMotivo>
            <ns2:nRec>123456789012345</ns2:nRec>
            <ns3:protNFe xmlns:ns3="http://www.portalfiscal.inf.br/nfe">
              <ns3:infProt>
                <ns3:tpAmb>2</ns3:tpAmb>
                <ns3:verAplic>SVRS</ns3:verAplic>
                <ns3:chNFe>12345678901234567890123456789012345678901234</ns3:chNFe>
                <ns3:dhRecbto>2025-01-01T00:00:00-03:00</ns3:dhRecbto>
                <ns3:nProt>135220000000000</ns3:nProt>
                <ns3:digVal>abc123==</ns3:digVal>
                <ns3:cStat>100</ns3:cStat>
                <ns3:xMotivo>Autorizado o uso da NF-e</ns3:xMotivo>
              </ns3:infProt>
            </ns3:protNFe>
          </ns2:retEnviNFe>
        </nfe:result>
      </nfe:autorizacaoResponse>
    </soap:Body>
  </soap:Envelope>`;

  const retEnviSection = extractSection(soapResponse, 'retEnviNFe');
  assert.ok(retEnviSection.startsWith('<ns2:retEnviNFe'), 'A seção retEnviNFe deve ser localizada mesmo com prefixo.');

  const loteStatus = extractTagContent(retEnviSection, 'cStat');
  assert.strictEqual(loteStatus, '104');

  const protSection = extractSection(retEnviSection, 'protNFe');
  assert.ok(protSection.startsWith('<ns3:protNFe'), 'O protocolo deve ser localizado mesmo com prefixo.');

  const protocolStatus = extractTagContent(protSection, 'cStat');
  assert.strictEqual(protocolStatus, '100');
});

test('buildEnviNfePayload preserva integralmente o XML assinado', () => {
  delete require.cache[require.resolve('../sefazTransmitter')];
  const { __TESTING__ } = require('../sefazTransmitter');
  const { buildEnviNfePayload } = __TESTING__;

  const originalXml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<NFe xmlns="http://www.portalfiscal.inf.br/nfe">',
    '  <infNFe Id="NFe123" versao="4.00">',
    '    <ide>',
    '      <cUF>33</cUF>',
    '    </ide>',
    '    <det nItem="1">',
    '      <prod>',
    '        <cProd>001</cProd>',
    '      </prod>',
    '    </det>',
    '  </infNFe>',
    '</NFe>',
  ].join('\n');

  const payload = buildEnviNfePayload({ xml: originalXml, loteId: '42', synchronous: true });

  const originalInf = originalXml.match(/<infNFe[\s\S]*<\/infNFe>/)[0];
  const payloadInf = payload.match(/<infNFe[\s\S]*<\/infNFe>/)[0];

  const sanitizedOriginalInf = sanitizeXmlContent(originalInf);
  assert.strictEqual(payloadInf, sanitizedOriginalInf);
  assert.match(payload, /<idLote>000000000000042<\/idLote>/);
  assert.match(payload, /<indSinc>1<\/indSinc>/);
});

test('buildEnviNfePayload remove caracteres de edição fora do infNFe', () => {
  delete require.cache[require.resolve('../sefazTransmitter')];
  const { __TESTING__ } = require('../sefazTransmitter');
  const { buildEnviNfePayload } = __TESTING__;

  const originalXml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<NFe xmlns="http://www.portalfiscal.inf.br/nfe">',
    '  <infNFe Id="NFe123" versao="4.00">',
    '    <ide>',
    '      <cUF>33</cUF>',
    '    </ide>',
    '  </infNFe>',
    '',
    '  <infNFeSupl>',
    '    <qrCode>123</qrCode>',
    '  </infNFeSupl>',
    '',
    '  <Signature xmlns="http://www.w3.org/2000/09/xmldsig#">',
    '    <SignedInfo />',
    '  </Signature>',
    '</NFe>',
  ].join('\n');

  const payload = buildEnviNfePayload({ xml: originalXml, loteId: '1', synchronous: false });

  const originalInf = originalXml.match(/<infNFe[\s\S]*?<\/infNFe>/)[0];
  const payloadInf = payload.match(/<infNFe[\s\S]*?<\/infNFe>/)[0];

  const sanitizedOriginalInf = sanitizeXmlContent(originalInf);
  assert.strictEqual(payloadInf, sanitizedOriginalInf);
  assert.match(payload, /<NFe[^>]*><infNFe/);
  assert.match(payload, /<\/infNFe><infNFeSupl>/);
  assert.match(payload, /<\/infNFeSupl><Signature/);
  assert.match(payload, /<\/Signature><\/NFe>/);
});
