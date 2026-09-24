const { SignedXml } = require('xml-crypto');
const { DOMParser } = require('@xmldom/xmldom');
const xpath = require('xpath');

// Schemas oficiais NFSe-ESQUEMAS_XSD-v1.01-20260209, e manual integrado
// https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual
const NS = 'http://www.sped.fazenda.gov.br/nfse';
const C14N = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315';
const escapeXml = (v) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const tag = (name, value) => value === undefined || value === null || value === '' ? '' : `<${name}>${escapeXml(value)}</${name}>`;
const money = (n) => Number(n).toFixed(2);
// Sefin Nacional valida o horário de emissão em Brasília. Representar o mesmo
// instante em -03:00 evita E0008 observado com +00:00 em homologação.
const dateTime = (date) => new Date(new Date(date).getTime() - 3 * 60 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, '-03:00');
const buildDpsId = ({ municipality, cnpj, serie, number }) => `DPS${municipality}2${cnpj}${String(serie).padStart(5, '0')}${String(number).padStart(15, '0')}`;

function addressXml(address) {
  if (!address) return '';
  return `<end><endNac>${tag('cMun', address.municipality)}${tag('CEP', address.zip)}</endNac>${tag('xLgr', address.street)}${tag('nro', address.number)}${tag('xCpl', address.complement)}${tag('xBairro', address.district)}</end>`;
}

function totalsTaxXml(rule) {
  if (rule.totalTributosModo === 'nao_informar') return '<totTrib><indTotTrib>0</indTotTrib></totTrib>';
  if (rule.totalTributosModo === 'simples') return `<totTrib>${tag('pTotTribSN', money(rule.pTotTribSN))}</totTrib>`;
  return `<totTrib><pTotTrib>${['Fed', 'Est', 'Mun'].map((suffix) => tag(`pTotTrib${suffix}`, money(rule[`pTotTrib${suffix}`]))).join('')}</pTotTrib></totTrib>`;
}

function ibsCbsXml(ibs) {
  if (!ibs?.enabled) return '';
  return `<IBSCBS>${tag('finNFSe', ibs.finNFSe)}${tag('indFinal', ibs.indFinal)}${tag('cIndOp', ibs.cIndOp)}${tag('indDest', ibs.indDest)}<valores><trib><gIBSCBS>${tag('CST', ibs.CST)}${tag('cClassTrib', ibs.cClassTrib)}</gIBSCBS></trib></valores></IBSCBS>`;
}

function buildDpsXml({ snapshot, number, issuedAt }) {
  const { issuer, customer, group, environment, serie } = snapshot;
  const rule = group.rule;
  const id = buildDpsId({ municipality: issuer.municipality, cnpj: issuer.cnpj, serie, number });
  const prest = `<prest>${tag('CNPJ', issuer.cnpj)}${tag('IM', issuer.includeIm ? issuer.im : '')}<regTrib>${tag('opSimpNac', issuer.opSimpNac)}${tag('regApTribSN', issuer.opSimpNac === '3' ? issuer.regApTribSN : '')}${tag('regEspTrib', issuer.regimeEspecialTributacao)}</regTrib></prest>`;
  const toma = customer.identification === 'not_informed' ? '' : `<toma>${tag(customer.document.length === 14 ? 'CNPJ' : 'CPF', customer.document)}${tag('xNome', customer.name)}${addressXml(customer.address)}${tag('email', customer.email)}</toma>`;
  const serv = `<serv><locPrest>${tag('cLocPrestacao', group.municipality)}</locPrest><cServ>${tag('cTribNac', rule.codigoTributacaoNacional)}${tag('cTribMun', rule.codigoTributacaoMunicipal)}${tag('xDescServ', group.description)}${tag('cNBS', rule.codigoNbs)}</cServ></serv>`;
  const discount = group.discount > 0 ? `<vDescCondIncond>${tag('vDescIncond', money(group.discount))}</vDescCondIncond>` : '';
  const tribMun = `<tribMun>${tag('tribISSQN', rule.tributacaoIss)}${tag('cPaisResult', rule.paisResultado)}${tag('tpImunidade', rule.tributacaoIss === '2' ? rule.tipoImunidade : '')}${tag('tpRetISSQN', rule.tipoRetencaoIss)}${tag('pAliq', rule.aliquotaIss !== '' && rule.aliquotaIss !== null && rule.aliquotaIss !== undefined ? money(rule.aliquotaIss) : '')}</tribMun>`;
  const valores = `<valores><vServPrest>${tag('vServ', money(group.gross + group.addition))}</vServPrest>${discount}<trib>${tribMun}${totalsTaxXml(rule)}</trib></valores>`;
  return `<?xml version="1.0" encoding="UTF-8"?><DPS xmlns="${NS}" versao="1.01"><infDPS Id="${id}">${tag('tpAmb', environment === 'producao' ? '1' : '2')}${tag('dhEmi', dateTime(issuedAt))}<verAplic>EoBicho_NFSe_1.0</verAplic>${tag('serie', String(Number(serie)))}${tag('nDPS', number)}${tag('dCompet', group.competence)}<tpEmit>1</tpEmit>${tag('cLocEmi', issuer.municipality)}${prest}${toma}${serv}${valores}${ibsCbsXml(rule.ibsCbs)}</infDPS></DPS>`;
}

function signXml(xml, pair, element = 'infDPS') {
  // SHA-1/C14N são exigências do protocolo nacional XMLDSig (não senha/hash local).
  const signer = new SignedXml({ privateKey: pair.privateKeyPem, publicCert: pair.certificatePem, canonicalizationAlgorithm: C14N, signatureAlgorithm: 'http://www.w3.org/2000/09/xmldsig#rsa-sha1' });
  signer.addReference({ xpath: `//*[local-name()='${element}']`, transforms: ['http://www.w3.org/2000/09/xmldsig#enveloped-signature', C14N], digestAlgorithm: 'http://www.w3.org/2000/09/xmldsig#sha1' });
  signer.computeSignature(xml, { location: { reference: `//*[local-name()='${element}']`, action: 'after' } });
  return signer.getSignedXml();
}

function parseXml(xml) {
  if (!xml || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('XML da NFS-e inválido ou contém declaração não permitida.');
  const errors = [];
  const doc = new DOMParser({ errorHandler: { warning: (m) => errors.push(m), error: (m) => errors.push(m), fatalError: (m) => errors.push(m) } }).parseFromString(xml, 'application/xml');
  if (errors.length) throw new Error('XML da NFS-e não pôde ser interpretado.');
  return doc;
}

function parseAuthorizedXml(xml, expected = {}) {
  const doc = parseXml(xml);
  const get = (path) => String(xpath.select1(`string(${path})`, doc) || '').trim();
  const inf = "/*[local-name()='NFSe']/*[local-name()='infNFSe']";
  const accessKey = get(`${inf}/@Id`).replace(/^NFS/, '');
  const dpsId = get(`${inf}/*[local-name()='DPS']/*[local-name()='infDPS']/@Id`);
  const number = get(`${inf}/*[local-name()='nNFSe']`);
  const status = get(`${inf}/*[local-name()='cStat']`);
  const environment = get(`${inf}/*[local-name()='DPS']/*[local-name()='infDPS']/*[local-name()='tpAmb']`) === '1' ? 'producao' : 'homologacao';
  if (!/^\d{50}$/.test(accessKey) || !number || !dpsId) throw new Error('Resposta da NFS-e sem documento autorizado completo.');
  if (!['100', '102', '103', '107'].includes(status)) throw new Error('Resposta sem situação autorizada da NFS-e.');
  if (expected.dpsId && dpsId !== expected.dpsId) throw new Error('A NFS-e retornada pertence a outra DPS.');
  if (expected.environment && environment !== expected.environment) throw new Error('A NFS-e retornada pertence a outro ambiente.');
  if (expected.dpsXml) {
    // Detecta colisão com uma série/DPS previamente usada por outro emissor.
    // Prefixos e espaços de formatação não alteram o conteúdo fiscal comparado.
    const semantic = (node) => {
      const children = [];
      for (let child = node.firstChild; child; child = child.nextSibling) {
        if (child.nodeType === 1) children.push(semantic(child));
        else if (child.nodeType === 3 && child.nodeValue.trim()) children.push(child.nodeValue);
      }
      const attrs = [];
      for (let i = 0; i < node.attributes.length; i += 1) { const attr = node.attributes.item(i); if (!attr.name.startsWith('xmlns')) attrs.push([attr.localName, attr.value]); }
      return [node.localName, attrs.sort((a, b) => a[0].localeCompare(b[0])), children];
    };
    const original = xpath.select1("//*[local-name()='infDPS']", parseXml(expected.dpsXml));
    const returned = xpath.select1(`${inf}/*[local-name()='DPS']/*[local-name()='infDPS']`, doc);
    if (!original || !returned || JSON.stringify(semantic(original)) !== JSON.stringify(semantic(returned))) throw new Error('O conteúdo da DPS retornada difere do enviado. Verifique colisão de série/numeração; nenhuma nota será vinculada automaticamente.');
  }
  const issuedAt = get(`${inf}/*[local-name()='dhProc']`);
  const issuerName = get(`${inf}/*[local-name()='emit']/*[local-name()='xNome']`);
  const issuerCnpj = get(`${inf}/*[local-name()='emit']/*[local-name()='CNPJ']`);
  const dpsIssuer = get(`${inf}/*[local-name()='DPS']/*[local-name()='infDPS']/*[local-name()='prest']/*[local-name()='CNPJ']`);
  if (issuerCnpj && issuerCnpj !== dpsIssuer) throw new Error('O emitente da NFS-e difere do prestador da DPS.');
  return { accessKey, dpsId, number, environment, issuerName, issuerCnpj, issuedAt: issuedAt ? new Date(issuedAt) : null, verificationCode: get(`${inf}/*[local-name()='cVerif']`), xmlContent: xml, consultationUrl: `https://${environment === 'homologacao' ? 'www.producaorestrita' : 'www'}.nfse.gov.br/ConsultaPublica/?tpc=1&chave=${accessKey}`, status: 'authorized' };
}

function buildCancellationXml({ accessKey, environment, cnpj, reasonCode, reason, issuedAt }) {
  if (!/^\d{50}$/.test(accessKey) || !['1', '2', '9'].includes(String(reasonCode)) || String(reason || '').trim().length < 15 || String(reason || '').trim().length > 255) throw Object.assign(new Error('Informe nota válida, motivo 1/2/9 e justificativa de 15 a 255 caracteres.'), { status: 422 });
  return `<?xml version="1.0" encoding="UTF-8"?><pedRegEvento xmlns="${NS}" versao="1.01"><infPedReg Id="PRE${accessKey}101101">${tag('tpAmb', environment === 'producao' ? '1' : '2')}<verAplic>EoBicho_NFSe_1.0</verAplic>${tag('dhEvento', dateTime(issuedAt))}${tag('CNPJAutor', cnpj)}${tag('chNFSe', accessKey)}<e101101><xDesc>Cancelamento de NFS-e</xDesc>${tag('cMotivo', reasonCode)}${tag('xMotivo', reason)}</e101101></infPedReg></pedRegEvento>`;
}

module.exports = { NS, escapeXml, buildDpsId, buildDpsXml, signXml, parseAuthorizedXml, parseXml, buildCancellationXml };
