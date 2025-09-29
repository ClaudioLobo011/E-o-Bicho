const test = require('node:test');
const assert = require('node:assert');
const https = require('https');
const tls = require('tls');
const forge = require('node-forge');
const { EventEmitter } = require('node:events');

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
