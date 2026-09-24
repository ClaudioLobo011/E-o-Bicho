const test = require('node:test');
const assert = require('node:assert/strict');
const https = require('node:https');
const dgram = require('node:dgram');
const { EventEmitter } = require('node:events');
const {
  consultNfeProtocolOnSefaz,
  consultNfceProtocolOnSefaz,
  resolveNfceConsultaProtocoloEndpoint,
  __TESTING__,
} = require('../sefazTransmitter');

const key = (model = '65', uf = '33') => `${uf}260900000000000001${model}0010000000011100000001`;
const args = (model = '65') => ({
  accessKey: key(model), uf: 'RJ', environment: 'homologacao',
  certificate: '-----BEGIN CERTIFICATE-----\nTESTONLY\n-----END CERTIFICATE-----',
  privateKey: '-----BEGIN PRIVATE KEY-----\nTESTONLY\n-----END PRIVATE KEY-----',
});
const soap = ({ accessKey = key(), environment = '2', status = '217', protocol = '' } = {}) =>
  `<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body>`
  + `<retConsSitNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">`
  + `<tpAmb>${environment}</tpAmb><cStat>${status}</cStat><xMotivo>Retorno de teste</xMotivo>`
  + `<chNFe>${accessKey}</chNFe>${protocol}</retConsSitNFe></soap:Body></soap:Envelope>`;

function fakeTransport(t, responseXml) {
  const calls = [];
  // performSoapRequest também sincroniza o relógio; isolar UDP além de HTTPS.
  t.mock.method(dgram, 'createSocket', () => {
    const socket = new EventEmitter();
    socket.close = () => {};
    socket.send = (_packet, _offset, _length, _port, _host, callback) => {
      callback();
      const response = Buffer.alloc(48);
      response.writeUInt32BE(Math.floor(Date.now() / 1000) + 2208988800, 40);
      process.nextTick(() => socket.emit('message', response));
    };
    return socket;
  });
  t.mock.method(https, 'request', (options, callback) => {
    const captured = { options, body: '' };
    calls.push(captured);
    const response = new EventEmitter();
    response.statusCode = 200;
    response.setEncoding = () => {};
    const request = new EventEmitter();
    request.setTimeout = () => {};
    request.write = (part) => { captured.body += part; };
    request.destroy = () => {};
    request.end = () => {
      callback(response);
      process.nextTick(() => {
        response.emit('data', responseXml);
        response.emit('end');
      });
    };
    return request;
  });
  return calls;
}

test('consulta NFC-e usa hosts próprios de RJ/SVRS e RS nos dois ambientes', () => {
  for (const uf of ['RJ', 'Rio de Janeiro', '33', 'SVRS']) {
    assert.equal(resolveNfceConsultaProtocoloEndpoint(uf, 'homologacao'),
      'https://nfce-homologacao.svrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx');
    assert.equal(resolveNfceConsultaProtocoloEndpoint(uf, 'producao'),
      'https://nfce.svrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx');
  }
  assert.equal(resolveNfceConsultaProtocoloEndpoint('Rio Grande do Sul', 'homologacao'),
    'https://nfce-homologacao.sefazrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx');
  assert.equal(resolveNfceConsultaProtocoloEndpoint('43', 'producao'),
    'https://nfce.sefazrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx');
  assert.throws(() => resolveNfceConsultaProtocoloEndpoint('XX', 'producao'), /UF inválida/);
});

test('consulta NFC-e respeita autorizadores próprios publicados pela SVRS', () => {
  const hosts = {
    AM: ['homnfce.sefaz.am.gov.br', 'nfce.sefaz.am.gov.br'],
    GO: ['homolog.sefaz.go.gov.br', 'nfe.sefaz.go.gov.br'],
    MS: ['hom.nfce.sefaz.ms.gov.br', 'nfce.sefaz.ms.gov.br'],
    MT: ['homologacao.sefaz.mt.gov.br', 'nfce.sefaz.mt.gov.br'],
    PR: ['homologacao.nfce.sefa.pr.gov.br', 'nfce.sefa.pr.gov.br'],
    SP: ['homologacao.nfce.fazenda.sp.gov.br', 'nfce.fazenda.sp.gov.br'],
  };
  for (const [uf, [homolog, production]] of Object.entries(hosts)) {
    assert.equal(new URL(resolveNfceConsultaProtocoloEndpoint(uf, 'homologacao')).hostname, homolog);
    assert.equal(new URL(resolveNfceConsultaProtocoloEndpoint(uf, 'producao')).hostname, production);
  }
});

test('consulta NFC-e 217 usa modelo 65 e transporte de consulta sem transmitir lote', async (t) => {
  const calls = fakeTransport(t, soap());
  const result = await consultNfceProtocolOnSefaz(args());
  assert.equal(result.status, '217');
  assert.equal(result.authorizationStatus, '');
  assert.equal(result.protocol, '');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.hostname, 'nfce-homologacao.svrs.rs.gov.br');
  assert.equal(calls[0].options.path, '/ws/NfeConsulta/NfeConsulta4.asmx');
  assert.match(calls[0].options.headers['Content-Type'], /NFeConsultaProtocolo4\/nfeConsultaNF/);
  assert.match(calls[0].body, /<tpAmb>2<\/tpAmb><xServ>CONSULTAR<\/xServ>/);
  assert.ok(calls[0].body.includes(`<chNFe>${key()}</chNFe>`));
  assert.doesNotMatch(calls[0].body, /enviNFe|nfeAutorizacaoLote/);
});

test('consulta NFC-e autorizada preserva protocolo e ambiente de produção', async (t) => {
  const calls = fakeTransport(t, soap({ environment: '1', status: '100', protocol:
    `<protNFe><infProt><tpAmb>1</tpAmb><chNFe>${key()}</chNFe>`
    + '<dhRecbto>2026-09-24T10:00:00-03:00</dhRecbto><nProt>100000000000001</nProt>'
    + '<cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo></infProt></protNFe>',
  }));
  const result = await consultNfceProtocolOnSefaz({ ...args(), environment: 'producao' });
  assert.equal(result.status, '100');
  assert.equal(result.authorizationStatus, '100');
  assert.equal(result.protocol, '100000000000001');
  assert.equal(result.processedAt, '2026-09-24T10:00:00-03:00');
  assert.equal(calls[0].options.hostname, 'nfce.svrs.rs.gov.br');
  assert.match(calls[0].body, /<tpAmb>1<\/tpAmb>/);
});

test('consulta NF-e 55 mantém endpoint anterior independente da NFC-e', async (t) => {
  const calls = fakeTransport(t, soap({ accessKey: key('55') }));
  const result = await consultNfeProtocolOnSefaz(args('55'));
  assert.equal(result.status, '217');
  assert.equal(calls[0].options.hostname, 'nfe-homologacao.svrs.rs.gov.br');
  assert.equal(__TESTING__.resolveNfeConsultaProtocoloEndpoint('RS', 'producao'),
    'https://nfe.sefazrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx');
});

test('modelo ou UF divergentes são rejeitados antes de qualquer conexão', async (t) => {
  const calls = fakeTransport(t, soap());
  await assert.rejects(consultNfceProtocolOnSefaz(args('55')), /modelo 65/);
  await assert.rejects(consultNfeProtocolOnSefaz(args('65')), /modelo 55/);
  await assert.rejects(consultNfceProtocolOnSefaz({ ...args(), uf: 'RS' }), /UF informada/);
  await assert.rejects(consultNfceProtocolOnSefaz({ ...args(), accessKey: '123' }), /inválida/);
  assert.equal(calls.length, 0);
});

test('resposta de outra chave não pode comprovar ausência ou autorização', async (t) => {
  fakeTransport(t, soap({ accessKey: key('55') }));
  await assert.rejects(consultNfceProtocolOnSefaz(args()), /não corresponde à chave ou ao ambiente/);
});

test('resposta de outro ambiente não pode comprovar ausência', async (t) => {
  fakeTransport(t, soap({ environment: '1' }));
  await assert.rejects(consultNfceProtocolOnSefaz(args()), /não corresponde à chave ou ao ambiente/);
});

test('SOAP sem retorno de consulta não vira status 217', async (t) => {
  fakeTransport(t, '<soap:Envelope><soap:Body><Fault>Indisponível</Fault></soap:Body></soap:Envelope>');
  await assert.rejects(consultNfceProtocolOnSefaz(args()), /não contém retorno da consulta/);
});
