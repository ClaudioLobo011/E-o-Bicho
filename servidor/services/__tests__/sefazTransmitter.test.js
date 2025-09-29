const test = require('node:test');
const assert = require('node:assert');
const https = require('https');
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
  const { performSoapRequest } = __TESTING__;

  const certificateChain = [
    '-----BEGIN CERTIFICATE-----\nMIIFleaf\n-----END CERTIFICATE-----\n',
    '-----BEGIN CERTIFICATE-----\nMIIFintermediate\n-----END CERTIFICATE-----\n',
  ];

  try {
    const body = await performSoapRequest({
      endpoint: 'https://nfcehomologacao.sefaz.ms.gov.br/ws/NFeAutorizacao4/NFeAutorizacao4.asmx',
      envelope: '<xml />',
      certificate: certificateChain[0],
      certificateChain,
      privateKey: '-----BEGIN PRIVATE KEY-----\nMIIFfake\n-----END PRIVATE KEY-----\n',
    });

    assert.strictEqual(body, soapResponse.trim());
    assert.strictEqual(capturedOptions.cert, certificateChain[0]);
    assert.deepStrictEqual(capturedOptions.ca, [certificateChain[1]]);
  } finally {
    https.request = originalRequest;
  }
});
