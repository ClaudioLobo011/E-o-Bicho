#!/usr/bin/env node

const path = require('path');
const forge = require('node-forge');

const stubModule = (relativePath, exports) => {
  const resolved = require.resolve(path.join(__dirname, relativePath));
  require.cache[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    exports,
  };
};

stubModule('../services/fiscalRuleEngine.js', {
  computeMissingFields: () => ({}),
  describeMissingFields: () => [],
  getFiscalDataForStore: () => ({
    cfop: { nfce: { dentroEstado: '5102' } },
    origem: '0',
    csosn: '102',
    pis: { cst: '49', aliquota: 0 },
    cofins: { cst: '49', aliquota: 0 },
  }),
});

stubModule('../models/Product.js', {
  find: () => ({
    lean: async () => [
      {
        _id: '507f1f77bcf86cd799439011',
        nome: 'Produto teste',
        unidade: 'UN',
        ncm: '12345678',
      },
    ],
  }),
});

class DummySefazError extends Error {}
stubModule('../services/sefazTransmitter.js', {
  transmitNfceToSefaz: async () => ({ status: 'mock', recibo: 'OK' }),
  SefazTransmissionError: DummySefazError,
});

stubModule('../utils/certificates.js', {
  decryptBuffer: (value) => (Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'base64')),
  decryptText: (value) => String(value),
});

const { emitPdvSaleFiscal } = require('../services/nfceEmitter');

const buildDemoPfx = () => {
  const keyPair = forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 });
  const cert = forge.pki.createCertificate();
  cert.publicKey = keyPair.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);
  const attrs = [{ name: 'commonName', value: 'Teste Endereço NFC-e' }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keyPair.privateKey, forge.md.sha256.create());

  const password = 'teste';
  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(keyPair.privateKey, [cert], password, { algorithm: '3des' });
  const p12Der = forge.asn1.toDer(p12Asn1).getBytes();
  return {
    base64: Buffer.from(p12Der, 'binary').toString('base64'),
    password,
  };
};

const main = async () => {
  const { base64, password } = buildDemoPfx();

  const store = {
    cnpj: '07919703000167',
    codigoUf: '33',
    serieFiscal: 1,
    codigoIbgeMunicipio: '3304557',
    logradouro: 'Rua Duque de Caxias',
    numero: '68',
    complemento: '',
    bairro: 'Centro',
    municipio: 'Rio de Janeiro',
    uf: 'RJ',
    cep: '20551050',
    inscricaoEstadual: '78149906',
    certificadoArquivoCriptografado: base64,
    certificadoSenhaCriptografada: password,
    cscIdHomologacao: '000001',
    cscTokenHomologacaoCriptografado: 'token-demo',
  };

  const sale = {
    saleCode: 'TESTE-225',
    receiptSnapshot: {
      meta: {},
      totais: { descontoValor: 0, acrescimoValor: 0, trocoValor: 0 },
      pagamentos: { items: [{ descricao: 'Dinheiro', valor: 10, forma: '01' }] },
      cliente: { nome: 'Consumidor Teste' },
    },
    fiscalItemsSnapshot: [
      {
        productId: '507f1f77bcf86cd799439011',
        quantity: 1,
        unitPrice: 10,
        totalPrice: 10,
        name: 'Produto teste',
        barcode: '1234567890123',
        productSnapshot: { unidade: 'UN', ncm: '12345678' },
      },
    ],
    discountValue: 0,
    additionValue: 0,
  };

  try {
    const result = await emitPdvSaleFiscal({
      sale,
      pdv: { codigo: 'PDV1', nome: 'PDV Teste' },
      store,
      emissionDate: new Date(),
      environment: 'homologacao',
      serie: 1,
      numero: 1,
    });

    const xml = result.xml;
    const emitBlock = xml.match(/<enderEmit>[\s\S]*?<\/enderEmit>/);
    const hasEmitComplement = /<xCpl>/.test(emitBlock ? emitBlock[0] : '');
    const hasDestBlock = /<enderDest>/.test(xml);

    console.log('Bloco enderEmit sem xCpl vazio:', !hasEmitComplement);
    console.log('Bloco enderDest gerado:', hasDestBlock);
    if (emitBlock) {
      console.log('Trecho enderEmit:\n', emitBlock[0]);
    }
  } catch (error) {
    console.error('Falha no teste de endereço:', error);
    process.exitCode = 1;
  }
};

main();
