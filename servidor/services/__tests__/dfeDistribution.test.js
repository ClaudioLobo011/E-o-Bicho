const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');

const {
  collectDistributedDocuments,
  __TESTING__,
} = require('../dfeDistribution');
const { SefazTransmissionError } = require('../sefazTransmitter');

const {
  buildSoap12Headers,
  buildSoap11Headers,
  buildEnvelopeSoap12,
  buildEnvelopeSoap11,
  buildDistributionQuery,
  parseSoapFault,
  parseResNFe,
  shouldDowngradeToSoap11,
  resolveAuthorUfCode,
} = __TESTING__;

describe('dfeDistribution helpers', () => {
  test('resolveAuthorUfCode aceita nomes completos de estado', () => {
    const code = resolveAuthorUfCode({
      store: { estado: 'Rio Grande do Sul' },
    });
    assert.equal(code, '43');
  });

  test('resolveAuthorUfCode extrai UF do certificado quando necessário', () => {
    const forge = require('node-forge');
    const original = forge.pki.certificateFromPem;
    forge.pki.certificateFromPem = () => ({
      subject: { attributes: [{ shortName: 'ST', value: 'SP' }] },
    });

    try {
      const code = resolveAuthorUfCode({
        store: {},
        certificatePem: '-----BEGIN CERTIFICATE-----\nFAKE\n-----END CERTIFICATE-----',
      });
      assert.equal(code, '35');
    } finally {
      forge.pki.certificateFromPem = original;
    }
  });

  test('resolveAuthorUfCode usa fallback 33 quando UF não é encontrada', () => {
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (message) => warnings.push(message);

    try {
      const code = resolveAuthorUfCode({ store: {} });
      assert.equal(code, '33');
      assert.ok(
        warnings.some((message) => message.includes('fallback RJ (33)')),
        'espera log de fallback'
      );
    } finally {
      console.warn = originalWarn;
    }
  });

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

  test('buildDistributionQuery gera distNSU com ultNSU', () => {
    const xml = buildDistributionQuery({ modo: 'distNSU', valor: '5' });
    assert.match(xml, /<distNSU>/);
    assert.match(xml, /<ultNSU>000000000000005<\/ultNSU>/);
  });

  test('buildDistributionQuery gera consNSU com NSU específico', () => {
    const xml = buildDistributionQuery({ modo: 'consNSU', valor: '7' });
    assert.match(xml, /<consNSU>/);
    assert.match(xml, /<NSU>000000000000007<\/NSU>/);
  });

  test('buildDistributionQuery gera consChNFe com chave normalizada', () => {
    const xml = buildDistributionQuery({
      modo: 'consChNFe',
      valor: '35191111111111111111550010000012345678901234',
    });
    assert.match(xml, /<consChNFe>/);
    assert.match(xml, /<chNFe>35191111111111111111550010000012345678901234<\/chNFe>/);
  });

  test('buildEnvelopeSoap12 inclui nfeDadosMsg com distDFeInt', () => {
    const envelope = buildEnvelopeSoap12({
      tpAmb: '1',
      cUFAutor: '33',
      cnpj: '07919703000167',
      modo: 'distNSU',
      valor: '1',
    });
    assert.match(envelope, /<soap12:Envelope/);
    assert.match(envelope, /<cUFAutor>33<\/cUFAutor>/);
    assert.match(envelope, /<nfeDadosMsg>[\s\S]*<distDFeInt/);
    assert.match(envelope, /<ultNSU>000000000000001<\/ultNSU>/);
  });

  test('buildEnvelopeSoap11 monta envelope SOAP 1.1 com consNSU', () => {
    const envelope = buildEnvelopeSoap11({
      tpAmb: '1',
      cUFAutor: '33',
      cnpj: '07919703000167',
      modo: 'consNSU',
      valor: '2',
    });
    assert.match(envelope, /<soap:Envelope/);
    assert.match(envelope, /<soap:Body>/);
    assert.match(envelope, /<NSU>000000000000002<\/NSU>/);
    assert.match(envelope, /<nfeDadosMsg>/);
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

  test('parseResNFe lê campos sem depender de NodeList iterável', () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
      <resNFe xmlns="http://www.portalfiscal.inf.br/nfe">
        <chNFe>35191111111111111111550010000012345678901234</chNFe>
        <CNPJ>12345678000190</CNPJ>
        <xNome>Fornecedor Exemplo LTDA</xNome>
        <dhEmi>2024-01-02T12:34:56-03:00</dhEmi>
        <serie>1</serie>
        <nNF>1234</nNF>
        <vNF>1500.55</vNF>
        <tpNF>1</tpNF>
        <cSitNFe>1</cSitNFe>
        <CNPJDest>07919703000167</CNPJDest>
      </resNFe>`;

    const parsed = parseResNFe(xml, { companyDocument: '07919703000167' });

    assert.ok(parsed, 'espera objeto retornado');
    assert.equal(parsed.accessKey, '35191111111111111111550010000012345678901234');
    assert.equal(parsed.supplierName, 'Fornecedor Exemplo LTDA');
    assert.equal(parsed.serie, '1');
    assert.equal(parsed.number, '1234');
    assert.equal(parsed.totalValue, 1500.55);
    assert.equal(parsed.statusCode, '1');
  });

  test('parseResNFe converte valores com ponto decimal padrão do XML', () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
      <resNFe xmlns="http://www.portalfiscal.inf.br/nfe">
        <chNFe>35191111111111111111550010000012345678901234</chNFe>
        <CNPJ>12345678000190</CNPJ>
        <xNome>Fornecedor Exemplo LTDA</xNome>
        <dhEmi>2024-01-02T12:34:56-03:00</dhEmi>
        <serie>1</serie>
        <nNF>1234</nNF>
        <vNF>1485.93</vNF>
        <tpNF>1</tpNF>
        <cSitNFe>1</cSitNFe>
        <CNPJDest>07919703000167</CNPJDest>
      </resNFe>`;

    const parsed = parseResNFe(xml, { companyDocument: '07919703000167' });

    assert.ok(parsed, 'espera objeto retornado');
    assert.equal(parsed.totalValue, 1485.93);
  });

  test('parseResNFe converte valores com separador decimal vírgula', () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
      <resNFe xmlns="http://www.portalfiscal.inf.br/nfe">
        <chNFe>35191111111111111111550010000012345678901234</chNFe>
        <CNPJ>12345678000190</CNPJ>
        <xNome>Fornecedor Exemplo LTDA</xNome>
        <dhEmi>2024-01-02T12:34:56-03:00</dhEmi>
        <serie>1</serie>
        <nNF>1234</nNF>
        <vNF>1.485,93</vNF>
        <tpNF>1</tpNF>
        <cSitNFe>1</cSitNFe>
        <CNPJDest>07919703000167</CNPJDest>
      </resNFe>`;

    const parsed = parseResNFe(xml, { companyDocument: '07919703000167' });

    assert.ok(parsed, 'espera objeto retornado');
    assert.equal(parsed.totalValue, 1485.93);
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
  test('utiliza o último ultNSU persistido nas consultas distNSU', async () => {
    let capturedEnvelope = '';
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
                <xMotivo>Nenhum documento localizado</xMotivo>
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
          capturedEnvelope = options.envelope || '';
          return {
            body: sampleResponse,
            statusCode: 200,
            headers: { 'content-type': 'application/soap+xml' },
          };
        },
      },
      stateStore: {
        getLastNsU: async () => '000000000000123',
        setLastNsU: async ({ ultNSU }) => {
          persistedNsU = ultNSU;
        },
      },
    };

    await collectDistributedDocuments(
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

    assert.ok(
      capturedEnvelope.includes('<ultNSU>000000000000123</ultNSU>'),
      'espera que a requisição reutilize o último NSU conhecido'
    );
    assert.equal(persistedNsU, null);
  });

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

  test('processa docZip com resNFe retornado pela SEFAZ', async () => {
    let capturedEnvelope = '';
    let persistedNsU = null;

    const sampleResponse = `<?xml version="1.0" encoding="utf-8"?>
      <soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope">
        <soap:Body>
          <nfeDistDFeInteresseResponse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe">
            <nfeDistDFeInteresseResult>
              <retDistDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01">
                <tpAmb>1</tpAmb>
                <verAplic>1.7.6</verAplic>
                <cStat>138</cStat>
                <xMotivo>Documento(s) localizado(s)</xMotivo>
                <dhResp>2025-10-27T18:33:55-03:00</dhResp>
                <ultNSU>000000000000003</ultNSU>
                <maxNSU>000000000000003</maxNSU>
                <loteDistDFeInt>
                  <docZip NSU="000000000000002" schema="resEvento_v1.01.xsd">H4sIAAAAAAAEAIVSy27DIBD8Fct3mwU/cCxiqWqbQ9U81PTQK7GJjRRDCjTO55ckrttKlcoBDbszu6MRzAj7eBLK6eDcH5Qtz7aZh51zxxKhYRjiIYm1aREBwOht+bytO9HzcCLL/8mRVNZxVYswOAljuZ6HOAY8zvilP2rj+GEvbc0PsVT7eGeQ2ouwYvXatFxXM8LQCNn9avNUFRSTNCv8RsCQMnQtsrpbLUSVZCTDADRJKS3yCyOnWQbXg71u5m9CfLsoqB971bCmu8VRESBZhCEC+gqkxKRMkwiSEoChicPccUR+UZ741lRgaiveR4wZ+vFi5xG8iFZaZ3TQiGDDreWt6IO7D6d77mStg7WRrVS80cHyYSEY+tJ5jy+i3v3pMf/2OHKY2hjtKnJJAwidpbTA4GO8lRmaPkD1Cb10q0IMAgAA</docZip>
                  <docZip NSU="000000000000003" schema="resNFe_v1.01.xsd">H4sIAAAAAAAEAIWSW2+jMBCF/wridRXs8SUmaGKJEpKybQmFJNp9pIQ0VAEioE323y8Jvaj7sn6wR0ffmTMaGZu8Dee5cS4PVeuc2+3U3Hfd0SHkdDpZJ27VzTNhlAL59XCfZPu8TM1PuPg/PCqqtkurLDeNt7xp03pqgkXhvcc3/7FuuvSwK9osPVhFtbOeGlLtclNjtu9H1FwyCZQqLpSyx7SPGSsp6fWAYrYQMBbSnlAFHMngQS+MfurvHiRXEc9hXeba88OVHxue+xAFoZsYsyBZxcHNOvDcpTHzjSheztarZWK4i3gZ+d7aRTI4MfA1E2IyAUE5AEPSC7jd+2WhGWVyBHTE1IraDucOlyPKHUqRDAB2x3CuAcn1xbf+kmBb0CuXGrfF8yY96Hjz+njnqeNd+UdsXqLN/evv3Xxxc7v4EUz7VgPUZ8Z59tTV/8ZKR7Cv2HcGq6ipOw2XdXLGuA0K2BjJIGOWFN1lc/0gHyWS4ZPov3+HOJotAgAA</docZip>
                </loteDistDFeInt>
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
          capturedEnvelope = options.envelope || '';
          return {
            body: sampleResponse,
            statusCode: 200,
            headers: { 'content-type': 'application/soap+xml' },
          };
        },
      },
      stateStore: {
        getLastNsU: async () => '000000000000002',
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

    assert.ok(
      capturedEnvelope.includes('<ultNSU>000000000000002</ultNSU>'),
      'espera que a consulta reutilize o último NSU armazenado'
    );
    assert.equal(persistedNsU, '000000000000003');
    assert.ok(Array.isArray(result.documents));
    assert.equal(result.documents.length, 1);
    const [document] = result.documents;
    assert.equal(document.accessKey, '35251007347786000167550000001728441645890713');
    assert.equal(document.totalValue, 518.11);
    assert.equal(document.status, 'approved');
    assert.ok(document.xml.includes('<resNFe'));
  });

  test('retorna documento de tpNF=1 destinado à empresa', async () => {
    const companyDocument = '07919703000167';
    const xml = `<?xml version="1.0" encoding="utf-8"?>
      <resNFe xmlns="http://www.portalfiscal.inf.br/nfe">
        <chNFe>35251007347786000167550000001728441645890713</chNFe>
        <CNPJ>07347786000167</CNPJ>
        <xNome>Fornecedor Exemplo LTDA</xNome>
        <dhEmi>2025-10-27T08:33:35-03:00</dhEmi>
        <tpNF>1</tpNF>
        <vNF>518.11</vNF>
        <cSitNFe>1</cSitNFe>
        <CNPJDest>${companyDocument}</CNPJDest>
      </resNFe>`;
    const docZip = zlib.gzipSync(xml).toString('base64');

    const sampleResponse = `<?xml version="1.0" encoding="utf-8"?>
      <soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope">
        <soap:Body>
          <nfeDistDFeInteresseResponse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe">
            <nfeDistDFeInteresseResult>
              <retDistDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01">
                <tpAmb>1</tpAmb>
                <verAplic>1.7.6</verAplic>
                <cStat>138</cStat>
                <xMotivo>Documento(s) localizado(s)</xMotivo>
                <ultNSU>000000000000003</ultNSU>
                <maxNSU>000000000000003</maxNSU>
                <loteDistDFeInt>
                  <docZip NSU="000000000000002" schema="resNFe_v1.01.xsd">${docZip}</docZip>
                </loteDistDFeInt>
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
        performSoapRequest: async () => ({
          body: sampleResponse,
          statusCode: 200,
          headers: { 'content-type': 'application/soap+xml' },
        }),
      },
      stateStore: {
        getLastNsU: async () => '000000000000002',
        setLastNsU: async () => {},
      },
    };

    const result = await collectDistributedDocuments(
      {
        store: {
          certificadoArquivoCriptografado: 'fake',
          certificadoSenhaCriptografada: 'fake',
          cnpj: companyDocument,
          uf: 'SP',
        },
      },
      dependencies
    );

    assert.equal(result.documents.length, 1);
    assert.equal(result.documents[0].accessKey, '35251007347786000167550000001728441645890713');
    assert.equal(result.documents[0].supplierName, 'Fornecedor Exemplo LTDA');
    assert.equal(result.documents[0].status, 'approved');
  });
});
