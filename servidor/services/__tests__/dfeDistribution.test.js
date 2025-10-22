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
