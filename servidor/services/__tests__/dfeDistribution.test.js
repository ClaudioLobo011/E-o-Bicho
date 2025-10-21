const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  collectDistributedDocuments,
  __TESTING__,
} = require('../dfeDistribution');
const { SefazTransmissionError } = require('../sefazTransmitter');

const {
  buildSoap12Headers,
  buildSoap11Headers,
  buildEnvelopeConsNSU,
  parseSoapFault,
  shouldDowngradeToSoap11,
} = __TESTING__;

describe('dfeDistribution helpers', () => {
  test('buildSoap12Headers inclui action no Content-Type', () => {
    const headers = buildSoap12Headers('urn:acao');
    assert.equal(headers['Content-Type'], 'application/soap+xml; charset=utf-8; action="urn:acao"');
    assert.equal(headers.Accept, 'application/soap+xml');
  });

  test('buildSoap11Headers configura SOAPAction separado', () => {
    const headers = buildSoap11Headers('urn:acao');
    assert.equal(headers['Content-Type'], 'text/xml; charset=utf-8');
    assert.equal(headers.SOAPAction, '"urn:acao"');
  });

  test('buildEnvelopeConsNSU monta envelope com namespaces esperados', () => {
    const envelope = buildEnvelopeConsNSU({
      tpAmb: '1',
      cUFAutor: '33',
      cnpj: '07919703000167',
      ultNSU: '1',
    });
    assert.match(envelope, /<soap12:Envelope/);
    assert.match(envelope, /<cUFAutor>33<\/cUFAutor>/);
    assert.match(envelope, /<ultNSU>000000000000001<\/ultNSU>/);
  });

  test('buildEnvelopeConsNSU usa envelope SOAP 1.1 quando solicitado', () => {
    const envelope = buildEnvelopeConsNSU({
      tpAmb: '1',
      cUFAutor: '33',
      cnpj: '07919703000167',
      ultNSU: '2',
      soapVersion: '1.1',
    });
    assert.match(envelope, /<soap:Envelope/);
    assert.match(envelope, /<soap:Body>/);
    assert.match(envelope, /<ultNSU>000000000000002<\/ultNSU>/);
  });

  test('parseSoapFault extrai reason e code', () => {
    const faultXml = `<?xml version="1.0" encoding="utf-8"?>
      <soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope">
        <soap:Body>
          <soap:Fault>
            <soap:Code><soap:Value>soap:Receiver</soap:Value></soap:Code>
            <soap:Reason><soap:Text xml:lang="en">Object reference not set to an instance of an object.</soap:Text></soap:Reason>
          </soap:Fault>
        </soap:Body>
      </soap:Envelope>`;
    const parsed = parseSoapFault(faultXml);
    assert.equal(parsed.code, 'soap:Receiver');
    assert.equal(parsed.reason, 'Object reference not set to an instance of an object.');
  });

  test('shouldDowngradeToSoap11 detecta NullReference', () => {
    const error = new SefazTransmissionError('SEFAZ retornou status HTTP 500.', {
      statusCode: 500,
      body: `<?xml version="1.0" encoding="utf-8"?>
        <soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope">
          <soap:Body>
            <soap:Fault>
              <soap:Code><soap:Value>soap:Receiver</soap:Value></soap:Code>
              <soap:Reason><soap:Text xml:lang="en">Object reference not set to an instance of an object.</soap:Text></soap:Reason>
            </soap:Fault>
          </soap:Body>
        </soap:Envelope>`,
    });

    assert.equal(shouldDowngradeToSoap11(error), true);
  });
});

describe('collectDistributedDocuments', () => {
  test('faz downgrade para SOAP 1.1 e persiste ultNSU', async () => {
    const calls = [];
    let persistedNsU = null;

    const sampleResponse = `<?xml version="1.0" encoding="utf-8"?>
      <soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope">
        <soap:Body>
          <nfeDistDFeInteresseResponse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe">
            <nfeDistDFeInteresseResult>
              <retDistDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01">
                <tpAmb>1</tpAmb>
                <verAplic>1.00</verAplic>
                <cStat>137</cStat>
                <xMotivo>Sem documentos</xMotivo>
                <ultNSU>000000000000123</ultNSU>
                <maxNSU>000000000000123</maxNSU>
              </retDistDFeInt>
            </nfeDistDFeInteresseResult>
          </nfeDistDFeInteresseResponse>
        </soap:Body>
      </soap:Envelope>`;

    const dependencies = {
      decryptBuffer: () => Buffer.from('pfx'),
      decryptText: () => 'senha',
      extractCertificatePair: () => ({
        certificatePem: '-----BEGIN CERTIFICATE-----\nFAKE\n-----END CERTIFICATE-----',
        certificateChain: [],
        privateKeyPem: '-----BEGIN PRIVATE KEY-----\nFAKE\n-----END PRIVATE KEY-----',
      }),
      soapClient: {
        performSoapRequest: async (options) => {
          calls.push(options.soapVersion);
          if (calls.length === 1) {
            throw new SefazTransmissionError('SEFAZ retornou status HTTP 500.', {
              statusCode: 500,
              body: `<?xml version="1.0" encoding="utf-8"?>
                <soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope">
                  <soap:Body>
                    <soap:Fault>
                      <soap:Code><soap:Value>soap:Receiver</soap:Value></soap:Code>
                      <soap:Reason><soap:Text xml:lang="en">Object reference not set to an instance of an object.</soap:Text></soap:Reason>
                    </soap:Fault>
                  </soap:Body>
                </soap:Envelope>`,
            });
          }
          return {
            body: sampleResponse,
            statusCode: 200,
            headers: { 'content-type': 'application/soap+xml' },
          };
        },
      },
      stateStore: {
        getLastNsU: async () => '000000000000000',
        setLastNsU: async ({ ultNSU }) => {
          persistedNsU = ultNSU;
        },
      },
    };

    const result = await collectDistributedDocuments(
      {
        store: {
          certificadoArquivoCriptografado: 'fake',
          certificadoSenhaCriptografada: 'fake',
          cnpj: '07919703000167',
          uf: 'RJ',
        },
      },
      dependencies
    );

    assert.deepEqual(calls, ['1.2', '1.1']);
    assert.equal(persistedNsU, '000000000000123');
    assert.equal(result.metadata.lastNsU, '000000000000123');
    assert.equal(Array.isArray(result.documents), true);
    assert.equal(result.documents.length, 0);
  });
});
