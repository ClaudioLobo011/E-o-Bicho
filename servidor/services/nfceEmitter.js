const crypto = require('crypto');
const mongoose = require('mongoose');
const forge = require('node-forge');
const { DOMParser, XMLSerializer } = require('@xmldom/xmldom');
const xpath = require('xpath');
const { SignedXml } = require('xml-crypto');
const Product = require('../models/Product');
const {
  computeMissingFields,
  describeMissingFields,
  getFiscalDataForStore,
} = require('./fiscalRuleEngine');
const { transmitNfceToSefaz, SefazTransmissionError } = require('./sefazTransmitter');
const { decryptBuffer, decryptText } = require('../utils/certificates');
const { sanitizeXmlAttribute, sanitizeXmlContent, sanitizeXmlText } = require('../utils/xmlSanitizer');

const UF_BY_CODE = {
  '11': 'RO',
  '12': 'AC',
  '13': 'AM',
  '14': 'RR',
  '15': 'PA',
  '16': 'AP',
  '17': 'TO',
  '21': 'MA',
  '22': 'PI',
  '23': 'CE',
  '24': 'RN',
  '25': 'PB',
  '26': 'PE',
  '27': 'AL',
  '28': 'SE',
  '29': 'BA',
  '31': 'MG',
  '32': 'ES',
  '33': 'RJ',
  '35': 'SP',
  '41': 'PR',
  '42': 'SC',
  '43': 'RS',
  '50': 'MS',
  '51': 'MT',
  '52': 'GO',
  '53': 'DF',
};

const sanitizeDigits = (value, { fallback = '' } = {}) => {
  if (!value) return fallback;
  const digits = String(value).replace(/\D+/g, '');
  return digits || fallback;
};

const BRAZILIAN_CNPJ_OID = '2.16.76.1.3.3';
const HOMOLOGATION_FIRST_ITEM_DESCRIPTION =
  'NOTA FISCAL EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL';

const describeCertificate = (pem) => {
  if (!pem) {
    return null;
  }

  try {
    const certificate = forge.pki.certificateFromPem(pem);
    const subject = certificate?.subject?.attributes || [];
    const issuer = certificate?.issuer?.attributes || [];

    const subjectString = subject
      .map((attr) => `${attr?.shortName || attr?.name || attr?.type}=${attr?.value}`)
      .filter(Boolean)
      .join(', ');

    const issuerString = issuer
      .map((attr) => `${attr?.shortName || attr?.name || attr?.type}=${attr?.value}`)
      .filter(Boolean)
      .join(', ');

    const findAttributeValue = (attributes, identifier) => {
      if (!attributes) return null;
      for (const attr of attributes) {
        if (!attr) continue;
        if (attr.type === identifier || attr.name === identifier || attr.shortName === identifier) {
          if (attr.value && typeof attr.value === 'string') {
            return attr.value;
          }
        }
      }
      try {
        const field = certificate.subject.getField(identifier);
        if (field?.value) {
          return field.value;
        }
      } catch (error) {
        // Ignore forge lookup errors.
      }
      return null;
    };

    const subjectCnpj = findAttributeValue(subject, BRAZILIAN_CNPJ_OID) || findAttributeValue(subject, 'CNPJ');

    return {
      subject: subjectString,
      issuer: issuerString,
      serialNumber: certificate?.serialNumber || null,
      validFrom: certificate?.validity?.notBefore || null,
      validTo: certificate?.validity?.notAfter || null,
      cnpj: subjectCnpj ? onlyDigits(subjectCnpj) : null,
    };
  } catch (error) {
    return null;
  }
};

const normalizeStringSafe = (value) => {
  if (!value && value !== 0) {
    return '';
  }
  const source = String(value)
    .trim()
    .replace(/\s+/g, ' ');
  if (!source) {
    return '';
  }
  let normalized = source;
  if (typeof normalized.normalize === 'function') {
    normalized = normalized.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }
  return normalized
    .replace(/[^0-9a-zA-Z]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
};

const onlyDigits = (s) => String(s ?? '').replace(/\D/g, '');
const dec = (n) => Number(n ?? 0).toFixed(2);
const sanitize = (value) => sanitizeXmlText(value);
const pushTagIf = (arr, tag, value, indent = '        ') => {
  const v = sanitize(value);
  if (v) arr.push(`${indent}<${tag}>${v}</${tag}>`);
};

const PAYMENT_TYPE_MAP = {
  '01': '01',
  dinheiro: '01',
  cash: '01',
  '02': '02',
  cheque: '02',
  '03': '03',
  credito: '03',
  cartaocredito: '03',
  '04': '04',
  debito: '04',
  cartaodebito: '04',
  '05': '05',
  crediario: '05',
  loja: '05',
  '15': '15',
  boleto: '15',
  '16': '16',
  deposito: '16',
  '17': '17',
  pix: '17',
  '18': '18',
  transferencia: '18',
  transferenciabancaria: '18',
  '90': '90',
  semdinheiro: '90',
  sempagamento: '90',
  '99': '99',
  outros: '99',
};

const resolvePaymentCode = (raw) => {
  const source = String(raw ?? '').trim();
  if (!source) {
    return '01';
  }

  const digits = onlyDigits(source).padStart(2, '0');
  if (PAYMENT_TYPE_MAP[digits]) {
    return PAYMENT_TYPE_MAP[digits];
  }

  const normalizedSource =
    typeof source.normalize === 'function' ? source.normalize('NFD') : source;
  const normalized = normalizedSource.replace(/[^\p{Letter}\p{Number}]+/gu, '').toLowerCase();
  if (PAYMENT_TYPE_MAP[normalized]) {
    return PAYMENT_TYPE_MAP[normalized];
  }

  return '99';
};

const resolveIndPag = (raw) => {
  const digits = onlyDigits(raw);
  return digits === '0' || digits === '1' || digits === '2' ? digits : '';
};

const CARD_PAYMENT_CODES = new Set(['03', '04']);

const resolveStoreUf = (store = {}) => {
  const ufSource = store.uf || store.estado || store.state || '';
  if (ufSource) {
    const normalized = String(ufSource).trim().toUpperCase();
    if (normalized.length === 2) {
      return normalized;
    }
  }

  const codeCandidates = [
    store.codigoUf,
    store.codigoUF,
    store.codigoEstado,
    store.codigoUfIbge,
    store.codigoIbgeUf,
    store.codigoEstadoIbge,
  ];

  for (const candidate of codeCandidates) {
    if (!candidate && candidate !== 0) continue;
    const digits = sanitizeDigits(candidate, { fallback: '' });
    if (!digits) continue;
    const normalizedCode = digits.padStart(2, '0').slice(-2);
    const resolved = UF_BY_CODE[normalizedCode];
    if (resolved) {
      return resolved;
    }
  }

  return '';
};

const safeNumber = (value, fallback = 0) => {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : fallback;
};

const toDecimal = (value, fractionDigits = 2) => {
  const number = safeNumber(value, 0);
  return number.toFixed(fractionDigits);
};

const TAX_NT_CODES = new Set(['04', '05', '06', '07', '08', '09']);
const TAX_ALIQ_CODES = new Set(['01', '02']);
const TAX_QTDE_CODES = new Set(['03']);

const buildTaxGroup = ({ lines, tag, data = {}, baseValue = 0, quantity = 0 }) => {
  const upperTag = tag.toUpperCase();
  const subgroupIndent = '          ';
  const valueIndent = '            ';
  const baseNumber = safeNumber(baseValue, 0);
  const quantityNumber = safeNumber(quantity, 0);
  const aliquotNumber = safeNumber(data?.aliquota, 0);
  const amountByAliquot = (baseNumber * aliquotNumber) / 100;
  const quantityAmount = quantityNumber * aliquotNumber;
  const cstDigitsRaw = onlyDigits(data?.cst);
  const normalizedCst = cstDigitsRaw ? cstDigitsRaw.padStart(2, '0').slice(-2) : '';
  const effectiveCst = normalizedCst || '99';
  let summaryAmount = 0;

  lines.push(`        <${upperTag}>`);

  if (TAX_NT_CODES.has(effectiveCst)) {
    lines.push(`${subgroupIndent}<${upperTag}NT>`);
    lines.push(`${valueIndent}<CST>${effectiveCst}</CST>`);
    lines.push(`${subgroupIndent}</${upperTag}NT>`);
  } else if (TAX_QTDE_CODES.has(effectiveCst)) {
    lines.push(`${subgroupIndent}<${upperTag}Qtde>`);
    lines.push(`${valueIndent}<CST>${effectiveCst}</CST>`);
    lines.push(`${valueIndent}<qBCProd>${toDecimal(quantityNumber, 4)}</qBCProd>`);
    lines.push(`${valueIndent}<vAliqProd>${toDecimal(aliquotNumber, 4)}</vAliqProd>`);
    lines.push(`${valueIndent}<v${upperTag}>${toDecimal(quantityAmount)}</v${upperTag}>`);
    lines.push(`${subgroupIndent}</${upperTag}Qtde>`);
    summaryAmount = quantityAmount;
  } else if (effectiveCst === '60') {
    lines.push(`${subgroupIndent}<${upperTag}ST>`);
    lines.push(`${valueIndent}<CST>${effectiveCst}</CST>`);
    lines.push(`${valueIndent}<vBC>${toDecimal(baseNumber)}</vBC>`);
    lines.push(`${valueIndent}<p${upperTag}>${toDecimal(aliquotNumber)}</p${upperTag}>`);
    lines.push(`${valueIndent}<v${upperTag}>${toDecimal(amountByAliquot)}</v${upperTag}>`);
    lines.push(`${subgroupIndent}</${upperTag}ST>`);
    summaryAmount = amountByAliquot;
  } else {
    const groupTag = TAX_ALIQ_CODES.has(effectiveCst) ? `${upperTag}Aliq` : `${upperTag}Outr`;
    lines.push(`${subgroupIndent}<${groupTag}>`);
    lines.push(`${valueIndent}<CST>${effectiveCst}</CST>`);
    lines.push(`${valueIndent}<vBC>${toDecimal(baseNumber)}</vBC>`);
    lines.push(`${valueIndent}<p${upperTag}>${toDecimal(aliquotNumber)}</p${upperTag}>`);
    lines.push(`${valueIndent}<v${upperTag}>${toDecimal(amountByAliquot)}</v${upperTag}>`);
    lines.push(`${subgroupIndent}</${groupTag}>`);
    summaryAmount = amountByAliquot;
  }

  lines.push(`        </${upperTag}>`);
  return { amount: summaryAmount };
};

const formatDateTimeWithOffset = (date) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return new Date().toISOString();
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  const offsetMinutes = date.getTimezoneOffset();
  const sign = offsetMinutes > 0 ? '-' : '+';
  const abs = Math.abs(offsetMinutes);
  const offsetHours = String(Math.floor(abs / 60)).padStart(2, '0');
  const offsetMins = String(abs % 60).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}${sign}${offsetHours}:${offsetMins}`;
};

// Gera o QR Code v2 on-line exigido pela SEFAZ/RJ para NFC-e autorizada em emissão normal.
const buildQrCodeRJ = ({ chNFe, tpAmb, idToken, csc }) => {
  const versaoQR = '2';
  const base = 'https://consultadfe.fazenda.rj.gov.br/consultaNFCe/QRCode';
  const idT = String(idToken ?? '').replace(/^0+/, '');
  const pSemHash = `${chNFe}|${versaoQR}|${tpAmb}|${idT}`;
  const hashInput = `${pSemHash}|${csc}`.replace('||', '|');
  const cHash = crypto
    .createHash('sha1')
    .update(hashInput, 'utf8')
    .digest('hex')
    .toUpperCase();
  const url = `${base}?p=${chNFe}|${versaoQR}|${tpAmb}|${idT}|${cHash}`;
  return { url, base };
};

const buildCnf = (sale) => {
  const base =
    sale?.saleCode ||
    sale?.receiptSnapshot?.meta?.saleCode ||
    sale?.id ||
    `${Date.now()}-${Math.random()}`;
  const hash = crypto.createHash('sha256').update(String(base)).digest('hex');
  const numeric = BigInt(`0x${hash.slice(-12)}`);
  const cnfNumber = Number(numeric % BigInt(100000000));
  return String(cnfNumber).padStart(8, '0');
};

const modulo11 = (value) => {
  const reversed = String(value).split('').reverse();
  let weight = 2;
  let total = 0;
  for (const char of reversed) {
    total += Number(char) * weight;
    weight += 1;
    if (weight > 9) weight = 2;
  }
  const remainder = total % 11;
  const dv = remainder === 0 || remainder === 1 ? 0 : 11 - remainder;
  return dv;
};

const buildAccessKey = ({
  ufCode,
  emissionDate,
  cnpj,
  model,
  serie,
  numero,
  emissionType,
  cnf,
}) => {
  const yy = String(emissionDate.getFullYear()).slice(-2);
  const mm = String(emissionDate.getMonth() + 1).padStart(2, '0');
  const datePart = `${yy}${mm}`;
  const normalizedSerie = String(serie).padStart(3, '0');
  const normalizedNumero = String(numero).padStart(9, '0');
  const body = `${String(ufCode).padStart(2, '0')}${datePart}${String(cnpj).padStart(14, '0')}${String(model).padStart(
    2,
    '0'
  )}${normalizedSerie}${normalizedNumero}${String(emissionType).padStart(1, '0')}${String(cnf).padStart(8, '0')}`;
  const dv = modulo11(body);
  return `${body}${dv}`;
};

const extractCertificatePair = (pfxBuffer, password) => {
  const collectBagAttributes = (bag = {}) => {
    const { attributes } = bag;
    if (!attributes) {
      return [];
    }
    if (Array.isArray(attributes)) {
      return attributes.filter(Boolean);
    }
    if (attributes instanceof Map) {
      return Array.from(attributes.values()).reduce((acc, value) => {
        if (!value) {
          return acc;
        }
        if (Array.isArray(value)) {
          acc.push(...value.filter(Boolean));
        } else {
          acc.push(value);
        }
        return acc;
      }, []);
    }
    if (typeof attributes === 'object') {
      if (typeof attributes[Symbol.iterator] === 'function') {
        return Array.from(attributes).filter(Boolean);
      }
      return Object.values(attributes).reduce((acc, value) => {
        if (!value) {
          return acc;
        }
        if (Array.isArray(value)) {
          acc.push(...value.filter(Boolean));
        } else {
          acc.push(value);
        }
        return acc;
      }, []);
    }
    if (typeof attributes === 'function') {
      try {
        const result = attributes();
        return Array.isArray(result) ? result.filter(Boolean) : [];
      } catch (error) {
        return [];
      }
    }
    if (attributes && typeof attributes[Symbol.iterator] === 'function') {
      return Array.from(attributes).filter(Boolean);
    }
    return [];
  };

  const decodeLocalKeyId = (bag = {}) => {
    const attributes = collectBagAttributes(bag);
    if (!attributes || typeof attributes[Symbol.iterator] !== 'function') {
      return null;
    }

    let attribute = null;
    for (const candidate of attributes) {
      if (candidate && candidate.type === forge.pki.oids.localKeyId) {
        attribute = candidate;
        break;
      }
    }

    if (!attribute || !attribute.value || !attribute.value.length) {
      return null;
    }
    const raw = attribute.value[0];
    if (!raw) {
      return null;
    }
    if (typeof raw === 'string') {
      return Buffer.from(raw, 'binary').toString('hex');
    }
    if (raw.value && typeof raw.value === 'string') {
      return Buffer.from(raw.value, 'binary').toString('hex');
    }
    if (typeof raw.getBytes === 'function') {
      return Buffer.from(raw.getBytes(), 'binary').toString('hex');
    }
    if (Array.isArray(raw)) {
      return Buffer.from(raw).toString('hex');
    }
    return null;
  };

  const decodeFriendlyName = (bag = {}) => {
    const attributes = collectBagAttributes(bag);
    if (!attributes || typeof attributes[Symbol.iterator] !== 'function') {
      return null;
    }

    let attribute = null;
    for (const candidate of attributes) {
      if (candidate && candidate.type === forge.pki.oids.friendlyName) {
        attribute = candidate;
        break;
      }
    }

    if (!attribute || !attribute.value || !attribute.value.length) {
      return null;
    }
    const raw = attribute.value[0];
    if (!raw) {
      return null;
    }
    if (typeof raw === 'string') {
      return raw;
    }
    if (raw.value && typeof raw.value === 'string') {
      return raw.value;
    }
    if (typeof raw.getBytes === 'function') {
      return raw.getBytes();
    }
    return null;
  };

  const normalizePfxBuffer = (value) => {
    if (!value) {
      throw new Error('O arquivo do certificado digital está vazio.');
    }
    if (Buffer.isBuffer(value)) {
      return Buffer.from(value);
    }
    if (ArrayBuffer.isView(value)) {
      return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) {
        throw new Error('O arquivo do certificado digital está vazio.');
      }
      const sanitized = trimmed.replace(/\s+/g, '');
      if (sanitized.length >= 4 && sanitized.length % 4 === 0 && /^[A-Za-z0-9+/=]+$/.test(sanitized)) {
        try {
          const asBase64 = Buffer.from(sanitized, 'base64');
          if (
            asBase64.length &&
            asBase64.toString('base64').replace(/=+$/, '') === sanitized.replace(/=+$/, '')
          ) {
            return asBase64;
          }
        } catch (error) {
          // Ignore and fall back to binary decoding when base64 parsing fails.
        }
      }
      return Buffer.from(trimmed, 'binary');
    }
    throw new Error('Formato de certificado digital não suportado.');
  };

  const collectBagEntries = (p12) => {
    const keys = [];
    const certificates = [];

    const pushKeyBag = (bag) => {
      if (!bag) return;
      let privateKey;
      if (bag.key) {
        privateKey = bag.key;
      } else if (bag.asn1) {
        privateKey = forge.pki.privateKeyFromAsn1(bag.asn1);
      } else if (bag.rsaPrivateKey) {
        privateKey = forge.pki.privateKeyFromAsn1(bag.rsaPrivateKey);
      }
      if (!privateKey) {
        return;
      }
      const pem = forge.pki.privateKeyToPem(privateKey);
      keys.push({
        pem,
        localKeyId: decodeLocalKeyId(bag),
        friendlyName: decodeFriendlyName(bag),
      });
    };

    const pushCertificateBag = (bag) => {
      if (!bag) return;
      const certificate = bag.cert || bag.bagValue?.cert || bag.bagValue;
      if (!certificate) {
        return;
      }
      const pem = forge.pki.certificateToPem(certificate);
      certificates.push({
        pem,
        localKeyId: decodeLocalKeyId(bag),
        friendlyName: decodeFriendlyName(bag),
      });
    };

    const traverseSafeContents = (safeContents = []) => {
      for (const content of safeContents) {
        if (content.safeBags) {
          for (const bag of content.safeBags) {
            if (bag.type === forge.pki.oids.pkcs8ShroudedKeyBag || bag.type === forge.pki.oids.keyBag) {
              pushKeyBag(bag);
            } else if (bag.type === forge.pki.oids.certBag) {
              pushCertificateBag(bag);
            }
          }
        }
        if (content.safeContents) {
          traverseSafeContents(content.safeContents);
        }
      }
    };

    traverseSafeContents(p12.safeContents || []);

    if (!keys.length) {
      const bagTypes = [forge.pki.oids.pkcs8ShroudedKeyBag, forge.pki.oids.keyBag];
      for (const bagType of bagTypes) {
        const bags = p12.getBags({ bagType })?.[bagType] || [];
        bags.forEach(pushKeyBag);
      }
    }

    if (!certificates.length) {
      const bags = p12.getBags({ bagType: forge.pki.oids.certBag })?.[forge.pki.oids.certBag] || [];
      bags.forEach(pushCertificateBag);
    }

    return { keys, certificates };
  };

  const computePrivateKeyFingerprint = (pem) => {
    if (!pem) return null;
    try {
      const privateKey = forge.pki.privateKeyFromPem(pem);
      if (privateKey && privateKey.n && privateKey.e) {
        return privateKey.n.toString(16);
      }
    } catch (error) {
      // Ignore forge parsing issues and fall back to node's crypto implementation below.
    }
    try {
      const keyObject = crypto.createPrivateKey({ key: pem, format: 'pem' });
      const publicKeyDer = crypto
        .createPublicKey(keyObject)
        .export({ type: 'spki', format: 'der' });
      return crypto.createHash('sha1').update(publicKeyDer).digest('hex');
    } catch (error) {
      return null;
    }
  };

  const computeCertificateFingerprint = (pem) => {
    if (!pem) return null;
    try {
      const certificate = forge.pki.certificateFromPem(pem);
      if (certificate?.publicKey?.n && certificate.publicKey.e) {
        return certificate.publicKey.n.toString(16);
      }
    } catch (error) {
      // Ignore forge parsing issues and fall back to node's crypto implementation below.
    }
    try {
      const x509 = new crypto.X509Certificate(pem);
      const publicKeyDer = x509.publicKey.export({ type: 'spki', format: 'der' });
      return crypto.createHash('sha1').update(publicKeyDer).digest('hex');
    } catch (error) {
      return null;
    }
  };

  const keysMatch = (keyPem, certificatePem) => {
    if (!keyPem || !certificatePem) {
      return false;
    }
    try {
      const privateKey = crypto.createPrivateKey({ key: keyPem, format: 'pem' });
      const publicFromPrivate = crypto
        .createPublicKey(privateKey)
        .export({ type: 'spki', format: 'der' });
      const certificatePublicKey = new crypto.X509Certificate(certificatePem)
        .publicKey.export({ type: 'spki', format: 'der' });
      return Buffer.compare(publicFromPrivate, certificatePublicKey) === 0;
    } catch (error) {
      return false;
    }
  };

  const matchKeyWithCertificate = ({ keys, certificates }) => {
    if (!keys.length) {
      throw new Error('Não foi possível extrair a chave privada do certificado.');
    }
    if (!certificates.length) {
      throw new Error('Não foi possível extrair o certificado digital.');
    }

    const enrichedKeys = keys.map((entry) => ({
      ...entry,
      fingerprint: computePrivateKeyFingerprint(entry.pem),
    }));
    const enrichedCertificates = certificates.map((entry) => ({
      ...entry,
      fingerprint: computeCertificateFingerprint(entry.pem),
    }));

    for (const keyEntry of enrichedKeys) {
      const certificateEntry = enrichedCertificates.find((candidate) => {
        if (keyEntry.localKeyId && candidate.localKeyId && candidate.localKeyId === keyEntry.localKeyId) {
          return keysMatch(keyEntry.pem, candidate.pem);
        }
        if (keyEntry.friendlyName && candidate.friendlyName && candidate.friendlyName === keyEntry.friendlyName) {
          return keysMatch(keyEntry.pem, candidate.pem);
        }
        if (keyEntry.fingerprint && candidate.fingerprint && keyEntry.fingerprint === candidate.fingerprint) {
          return keysMatch(keyEntry.pem, candidate.pem);
        }
        return false;
      });
      if (certificateEntry) {
        return { keyEntry, certificateEntry };
      }
    }

    for (const keyEntry of enrichedKeys) {
      if (!keyEntry.fingerprint) {
        continue;
      }
      const certificateEntry = enrichedCertificates.find(
        (candidate) =>
          candidate.fingerprint &&
          candidate.fingerprint === keyEntry.fingerprint &&
          keysMatch(keyEntry.pem, candidate.pem)
      );
      if (certificateEntry) {
        return { keyEntry, certificateEntry };
      }
    }

    for (const keyEntry of enrichedKeys) {
      const certificateEntry = enrichedCertificates.find((candidate) => keysMatch(keyEntry.pem, candidate.pem));
      if (certificateEntry) {
        return { keyEntry, certificateEntry };
      }
    }

    throw new Error(
      'O certificado digital não contém um par de chave privada e certificado compatível. Verifique o arquivo PFX.'
    );
  };

  try {
    const normalizedPassword = typeof password === 'string' ? password : String(password || '');
    const buffer = normalizePfxBuffer(pfxBuffer);
    const der = forge.util.createBuffer(buffer.toString('binary'), 'binary');
    const asn1 = forge.asn1.fromDer(der);
    const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, normalizedPassword);

    const entries = collectBagEntries(p12);
    const { keyEntry, certificateEntry } = matchKeyWithCertificate(entries);

    let normalizedPrivateKeyPem = keyEntry?.pem ? String(keyEntry.pem) : '';
    if (!normalizedPrivateKeyPem.trim()) {
      throw new Error('Não foi possível extrair a chave privada do certificado.');
    }

    try {
      const keyObject = crypto.createPrivateKey({ key: normalizedPrivateKeyPem, format: 'pem' });
      try {
        normalizedPrivateKeyPem = keyObject.export({ type: 'pkcs1', format: 'pem' }).toString();
      } catch (innerError) {
        normalizedPrivateKeyPem = keyObject.export({ type: 'pkcs8', format: 'pem' }).toString();
      }
    } catch (error) {
      throw new Error('A chave privada do certificado é inválida ou está protegida por senha desconhecida.');
    }

    const certificatePem = certificateEntry?.pem ? String(certificateEntry.pem) : '';
    if (!certificatePem.trim()) {
      throw new Error('Não foi possível extrair o certificado digital.');
    }

    try {
      const signer = crypto.createSign('RSA-SHA1');
      signer.update('nfce-signature-validation');
      signer.end();
      const signature = signer.sign(normalizedPrivateKeyPem);
      const verifier = crypto.createVerify('RSA-SHA1');
      verifier.update('nfce-signature-validation');
      verifier.end();
      if (!verifier.verify(certificatePem, signature)) {
        throw new Error('A chave privada não corresponde ao certificado digital informado.');
      }
    } catch (error) {
      if (error instanceof Error && error.message === 'A chave privada não corresponde ao certificado digital informado.') {
        throw error;
      }
      throw new Error('Falha ao validar o par chave/certificado do arquivo PFX.');
    }

    if (!keysMatch(normalizedPrivateKeyPem, certificatePem)) {
      throw new Error('A chave privada não corresponde ao certificado digital informado.');
    }

    const rawCertificates = Array.isArray(entries?.certificates)
      ? entries.certificates.map((entry) => (entry?.pem ? String(entry.pem) : '')).filter(Boolean)
      : [];

    const certificateChain = [];
    const normalizedLeaf = certificatePem;
    certificateChain.push(normalizedLeaf);

    for (const candidate of rawCertificates) {
      if (!candidate.trim()) {
        continue;
      }
      if (normalizedLeaf && candidate === normalizedLeaf) {
        continue;
      }
      if (certificateChain.includes(candidate)) {
        continue;
      }
      certificateChain.push(candidate);
    }

    return { privateKeyPem: normalizedPrivateKeyPem, certificatePem: normalizedLeaf, certificateChain };
  } catch (error) {
    if (error instanceof Error && error.message) {
      if (error.message.startsWith('Falha ao processar o certificado digital da empresa')) {
        throw error;
      }
      throw new Error(`Falha ao processar o certificado digital da empresa: ${error.message}`);
    }
    throw new Error('Falha ao processar o certificado digital da empresa.');
  }
};

const normalizeFiscalItem = (item = {}) => {
  const quantity = safeNumber(item.quantity ?? item.quantidade ?? item.qtd ?? 0, 0);
  const unitPrice = safeNumber(item.unitPrice ?? item.valor ?? item.preco ?? item.valorUnitario ?? 0, 0);
  const total = safeNumber(item.totalPrice ?? item.subtotal ?? unitPrice * quantity, 0);
  const productId = item.productId || item.id || item._id || item.productSnapshot?._id || null;
  return {
    productId: productId ? String(productId) : null,
    quantity,
    unitPrice,
    total,
    productSnapshot: item.productSnapshot ? { ...item.productSnapshot } : null,
    name: item.name || item.nome || item.product || item.descricao || '',
    barcode: item.barcode || item.codigoBarras || item.codigo || '',
    internalCode: item.codigoInterno || item.internalCode || '',
    unit: item.unit || item.unidade || item.productSnapshot?.unidade || 'UN',
  };
};

const loadProductsByIds = async (ids = []) => {
  const uniqueIds = Array.from(
    new Set(
      ids
        .map((id) => {
          if (!id) return null;
          if (mongoose.Types.ObjectId.isValid(id)) {
            return id;
          }
          return null;
        })
        .filter(Boolean)
    )
  );
  if (!uniqueIds.length) {
    return new Map();
  }
  const products = await Product.find({ _id: { $in: uniqueIds } }).lean();
  const map = new Map();
  for (const product of products) {
    map.set(String(product._id), product);
  }
  return map;
};

const buildInfAdicObservations = ({ pdv, sale, environmentLabel }) => {
  const observations = [];
  if (pdv?.codigo) {
    observations.push({ tag: 'PDVCodigo', value: pdv.codigo });
  }
  if (pdv?.nome) {
    observations.push({ tag: 'PDVNome', value: pdv.nome });
  }
  if (sale?.saleCode) {
    observations.push({ tag: 'VendaCodigo', value: sale.saleCode });
  }
  const operador = sale?.receiptSnapshot?.meta?.operador || sale?.receiptSnapshot?.meta?.operadorNome;
  if (operador) {
    observations.push({ tag: 'Operador', value: operador });
  }
  if (environmentLabel) {
    observations.push({ tag: 'Ambiente', value: environmentLabel });
  }
  return observations;
};

const emitPdvSaleFiscal = async ({ sale, pdv, store, emissionDate, environment, serie, numero }) => {
  if (!sale || typeof sale !== 'object') {
    throw new Error('Venda inválida para emissão fiscal.');
  }
  const snapshot = sale.receiptSnapshot || {};
  const saleCodeForFile = normalizeStringSafe(sale?.saleCode) || normalizeStringSafe(sale?.id);
  let xmlFileBaseName = saleCodeForFile ? `NFCe-${saleCodeForFile}` : '';
  const fiscalItemsRaw = Array.isArray(sale.fiscalItemsSnapshot)
    ? sale.fiscalItemsSnapshot
    : Array.isArray(sale.itemsSnapshot)
    ? sale.itemsSnapshot
    : [];
  const fiscalItems = fiscalItemsRaw.map((item) => normalizeFiscalItem(item));
  if (!fiscalItems.length) {
    throw new Error('Itens da venda não estão disponíveis para emissão fiscal.');
  }

  const productsMap = await loadProductsByIds(fiscalItems.map((item) => item.productId));
  const storeObject = store && typeof store.toObject === 'function' ? store.toObject() : store || {};
  const storeUf = resolveStoreUf(storeObject);
  if (!storeUf) {
    throw new Error('UF da empresa não está configurada para transmissão fiscal.');
  }
  const regime = storeObject?.regimeTributario || storeObject?.regime || '';
  const missingByProduct = [];

  for (const item of fiscalItems) {
    const product = item.productId ? productsMap.get(String(item.productId)) : null;
    if (!product) {
      missingByProduct.push({
        name: item.name || item.productSnapshot?.nome || 'Produto sem identificação',
        issues: ['Produto não localizado na base de dados para validação fiscal.'],
      });
      continue;
    }
    const fiscalData = getFiscalDataForStore(product, storeObject);
    const missing = computeMissingFields(fiscalData, { regime });
    const issues = [
      ...describeMissingFields(missing.comum || []),
      ...describeMissingFields(missing.nfce || []),
    ];
    if (issues.length) {
      missingByProduct.push({ name: product.nome || item.name || 'Produto', issues });
    }
  }

  if (missingByProduct.length) {
    const message = missingByProduct
      .map((entry) => `• ${entry.name}: ${entry.issues.join(', ')}`)
      .join('\n');
    throw new Error(`Ajuste a configuração fiscal dos itens antes da emissão:\n${message}`);
  }

  const emissionRef = emissionDate instanceof Date && !Number.isNaN(emissionDate.getTime())
    ? emissionDate
    : new Date();

  const ufCode = sanitizeDigits(storeObject?.codigoUf, { fallback: '00' }).padStart(2, '0');
  const cnpj = sanitizeDigits(storeObject?.cnpj, { fallback: '00000000000000' }).padStart(14, '0');
  const resolvedSerie = serie ?? storeObject?.serieFiscal ?? 1;
  const serieNumber = Number.parseInt(resolvedSerie, 10);
  if (!Number.isInteger(serieNumber) || serieNumber <= 0 || serieNumber > 999) {
    throw new Error('Série fiscal inválida. Informe um valor inteiro entre 1 e 999.');
  }
  const serieFiscal = String(serieNumber).padStart(3, '0');
  const numeroFiscal = Number(numero);
  const cnf = buildCnf(sale);
  const tpAmb = environment === 'producao' ? '1' : '2';
  const accessKey = buildAccessKey({
    ufCode,
    emissionDate: emissionRef,
    cnpj,
    model: '65',
    serie: serieFiscal,
    numero: numeroFiscal,
    emissionType: '1',
    cnf,
  });
  if (!xmlFileBaseName) {
    xmlFileBaseName = `NFCe-${accessKey}`;
  }

  const totalProducts = fiscalItems.reduce((sum, item) => sum + item.total, 0);
  const desconto = safeNumber(snapshot?.totais?.descontoValor ?? snapshot?.totais?.desconto ?? sale.discountValue ?? 0, 0);
  const acrescimo = safeNumber(snapshot?.totais?.acrescimoValor ?? snapshot?.totais?.acrescimo ?? sale.additionValue ?? 0, 0);
  const totalLiquido = Math.max(0, totalProducts - desconto + acrescimo);
  const pagamentosRaw = Array.isArray(snapshot?.pagamentos?.items) ? snapshot.pagamentos.items : [];
  const pagamentos = pagamentosRaw.length
    ? pagamentosRaw.map((payment) => ({
        descricao: payment?.descricao || payment?.label || payment?.nome || 'Pagamento',
        valor: safeNumber(payment?.valor ?? payment?.formatted ?? 0, 0),
        forma: payment?.forma || payment?.codigo || payment?.tipo || '01',
        indPag: payment?.indPag ?? payment?.indicador ?? payment?.indicadorPagamento,
        integracao: payment?.tpIntegra ?? payment?.integracao ?? payment?.tipoIntegracao,
        card: payment?.card || payment?.cartao || null,
        cnpj: payment?.cnpjCredenciadora || payment?.cnpj || null,
        tBand: payment?.tBand || payment?.bandeira || null,
        cAut: payment?.cAut || payment?.autorizacao || null,
      }))
    : [
        {
          descricao: 'Dinheiro',
          valor: totalLiquido,
          forma: '01',
        },
      ];
  const troco = safeNumber(snapshot?.totais?.trocoValor ?? snapshot?.totais?.troco ?? 0, 0);

  const delivery = snapshot?.delivery || null;
  const cliente = snapshot?.cliente || null;

  const encryptedCertificate = storeObject?.certificadoArquivoCriptografado;
  if (!encryptedCertificate) {
    throw new Error('O certificado digital da empresa não está configurado.');
  }

  const encryptedCertificatePassword = storeObject?.certificadoSenhaCriptografada;
  if (!encryptedCertificatePassword) {
    throw new Error('A senha do certificado digital não está configurada.');
  }

  let certificateBuffer;
  try {
    certificateBuffer = decryptBuffer(encryptedCertificate);
  } catch (error) {
    throw new Error(`Não foi possível descriptografar o certificado digital: ${error.message}`);
  }

  let certificatePassword;
  try {
    certificatePassword = decryptText(encryptedCertificatePassword);
  } catch (error) {
    throw new Error(`Não foi possível recuperar a senha do certificado digital: ${error.message}`);
  }
  if (!certificatePassword) {
    throw new Error('A senha do certificado digital descriptografada está vazia.');
  }
  const { privateKeyPem, certificatePem, certificateChain } = extractCertificatePair(
    certificateBuffer,
    certificatePassword
  );

  const certificateInfo = describeCertificate(certificatePem);
  const storeCnpjDigits = sanitizeDigits(storeObject?.cnpj, { fallback: '' });
  if (certificateInfo?.cnpj && storeCnpjDigits && certificateInfo.cnpj !== storeCnpjDigits) {
    throw new Error(
      `O certificado digital pertence ao CNPJ ${certificateInfo.cnpj}, diferente do CNPJ configurado (${storeCnpjDigits}).`
    );
  }

  if (certificateInfo?.validTo instanceof Date && Number.isFinite(certificateInfo.validTo.getTime())) {
    if (certificateInfo.validTo < new Date()) {
      throw new Error('O certificado digital configurado está vencido e não pode ser utilizado.');
    }
  }

  const cscIdRaw = environment === 'producao' ? storeObject.cscIdProducao : storeObject.cscIdHomologacao;
  const cscId = String(cscIdRaw ?? '').trim();
  const cscTokenEncrypted =
    environment === 'producao'
      ? storeObject.cscTokenProducaoCriptografado
      : storeObject.cscTokenHomologacaoCriptografado;
  if (!cscId || !cscTokenEncrypted) {
    throw new Error('O CSC do ambiente selecionado não está configurado para a empresa.');
  }
  let cscToken;
  try {
    cscToken = decryptText(cscTokenEncrypted).trim();
  } catch (error) {
    throw new Error(`Não foi possível recuperar o CSC do ambiente selecionado: ${error.message}`);
  }
  if (!cscToken) {
    throw new Error('O CSC configurado para a empresa está vazio após a descriptografia.');
  }

  const environmentLabel = environment === 'producao' ? 'Produção' : 'Homologação';

  const emLgr = sanitize(storeObject?.logradouro || storeObject?.endereco);
  const emNro = onlyDigits(storeObject?.numero);
  const emCompl = sanitize(storeObject?.complemento);
  const emBairro = sanitize(storeObject?.bairro);
  const emCMun = onlyDigits(
    storeObject?.cMun || storeObject?.codigoMunicipio || storeObject?.codigoIbgeMunicipio || ''
  );
  const emXMun = sanitize(storeObject?.xMun || storeObject?.municipio);
  const emUF = sanitize(storeObject?.uf || storeObject?.UF || '').toUpperCase();
  const emCEP = onlyDigits(storeObject?.cep);

  if (!emLgr) throw new Error('Endereço do emitente inválido: xLgr é obrigatório.');
  if (!emNro) throw new Error('Endereço do emitente inválido: nro é obrigatório (apenas dígitos).');
  if (!emBairro) throw new Error('Endereço do emitente inválido: xBairro é obrigatório.');
  if (!/^\d{7}$/.test(emCMun)) {
    throw new Error('Endereço do emitente inválido: cMun deve ter 7 dígitos IBGE.');
  }
  if (!emXMun) throw new Error('Endereço do emitente inválido: xMun é obrigatório.');
  if (!/^[A-Z]{2}$/.test(emUF)) throw new Error('Endereço do emitente inválido: UF inválida.');
  if (!/^\d{8}$/.test(emCEP)) {
    throw new Error('Endereço do emitente inválido: CEP deve ter 8 dígitos.');
  }

  const emissionIso = formatDateTimeWithOffset(emissionRef);

  const infNfeLines = [];
  infNfeLines.push(`  <infNFe Id="NFe${accessKey}" versao="4.00">`);
  infNfeLines.push('    <ide>');
  infNfeLines.push(`      <cUF>${ufCode}</cUF>`);
  infNfeLines.push(`      <cNF>${cnf}</cNF>`);
  const naturezaOperacao = sanitize(snapshot?.meta?.naturezaOperacao) || 'VENDA AO CONSUMIDOR';
  infNfeLines.push(`      <natOp>${naturezaOperacao}</natOp>`);
  infNfeLines.push('      <mod>65</mod>');
  infNfeLines.push(`      <serie>${serieNumber}</serie>`);
  infNfeLines.push(`      <nNF>${String(numeroFiscal)}</nNF>`);
  infNfeLines.push(`      <dhEmi>${emissionIso}</dhEmi>`);
  infNfeLines.push(`      <tpNF>1</tpNF>`);
  infNfeLines.push('      <idDest>1</idDest>');
  infNfeLines.push(`      <cMunFG>${emCMun}</cMunFG>`);
  infNfeLines.push(`      <tpImp>4</tpImp>`);
  infNfeLines.push(`      <tpEmis>1</tpEmis>`);
  infNfeLines.push(`      <cDV>${accessKey.slice(-1)}</cDV>`);
  infNfeLines.push(`      <tpAmb>${tpAmb}</tpAmb>`);
  infNfeLines.push('      <finNFe>1</finNFe>');
  infNfeLines.push('      <indFinal>1</indFinal>');
  infNfeLines.push('      <indPres>1</indPres>');
  infNfeLines.push('      <procEmi>0</procEmi>');
  const verProcSource = snapshot?.meta?.versaoProcesso || snapshot?.meta?.verProc || '1.0';
  let verProcValue = sanitize(verProcSource);
  if (!verProcValue) {
    verProcValue = '1.0';
  }
  infNfeLines.push(`      <verProc>${verProcValue}</verProc>`);
  infNfeLines.push('    </ide>');
  infNfeLines.push('    <emit>');
  infNfeLines.push(`      <CNPJ>${cnpj}</CNPJ>`);
  infNfeLines.push(`      <xNome>${sanitize(storeObject?.razaoSocial || storeObject?.nome || '')}</xNome>`);
  infNfeLines.push(`      <xFant>${sanitize(storeObject?.nomeFantasia || storeObject?.razaoSocial || '')}</xFant>`);
  infNfeLines.push('      <enderEmit>');
  infNfeLines.push(`        <xLgr>${emLgr}</xLgr>`);
  infNfeLines.push(`        <nro>${emNro}</nro>`);
  // Complemento opcional não deve aparecer vazio para o Schema 4.00
  pushTagIf(infNfeLines, 'xCpl', emCompl);
  infNfeLines.push(`        <xBairro>${emBairro}</xBairro>`);
  infNfeLines.push(`        <cMun>${emCMun}</cMun>`);
  infNfeLines.push(`        <xMun>${emXMun}</xMun>`);
  infNfeLines.push(`        <UF>${emUF}</UF>`);
  infNfeLines.push(`        <CEP>${emCEP}</CEP>`);
  infNfeLines.push('        <cPais>1058</cPais>');
  infNfeLines.push('        <xPais>Brasil</xPais>');
  infNfeLines.push('      </enderEmit>');
  infNfeLines.push(`      <IE>${sanitizeDigits(storeObject?.inscricaoEstadual, { fallback: '' })}</IE>`);
  infNfeLines.push('      <CRT>1</CRT>');
  infNfeLines.push('    </emit>');

  const destCPF = onlyDigits(cliente?.cpf || delivery?.cpf);
  const destCNPJ = onlyDigits(cliente?.cnpj);
  const destIdE = sanitize(cliente?.idEstrangeiro);

  const hasCPF = /^\d{11}$/.test(destCPF);
  const hasCNPJ = /^\d{14}$/.test(destCNPJ);
  const hasIdE = !!destIdE;

  const xNome = sanitize(cliente?.nome || cliente?.razaoSocial || delivery?.nome || '');
  const xNome60 = (xNome || 'CONSUMIDOR').slice(0, 60);

  if (hasCPF || hasCNPJ || hasIdE) {
    const dLgr = sanitize(delivery?.logradouro || cliente?.logradouro);
    const dNro = onlyDigits(delivery?.numero ?? cliente?.numero);
    const dCompl = sanitize(delivery?.complemento || cliente?.complemento);
    const dBairro = sanitize(delivery?.bairro || cliente?.bairro);
    const dCMun = onlyDigits(
      delivery?.cMun ??
        delivery?.codigoIbgeMunicipio ??
        cliente?.cMun ??
        cliente?.codigoIbgeMunicipio
    );
    const dXMun = sanitize(
      delivery?.xMun ?? delivery?.cidade ?? cliente?.xMun ?? cliente?.cidade
    );
    const dUF = sanitize(
      (delivery?.UF ?? delivery?.uf ?? cliente?.UF ?? cliente?.uf) || ''
    ).toUpperCase();
    const dCEP = onlyDigits(delivery?.CEP ?? delivery?.cep ?? cliente?.CEP ?? cliente?.cep);

    const hasAddr = dLgr || dNro || dCompl || dBairro || dCMun || dXMun || dUF || dCEP;

    infNfeLines.push('    <dest>');
    if (hasCNPJ) infNfeLines.push(`      <CNPJ>${destCNPJ}</CNPJ>`);
    else if (hasCPF) infNfeLines.push(`      <CPF>${destCPF}</CPF>`);
    else infNfeLines.push(`      <idEstrangeiro>${destIdE}</idEstrangeiro>`);

    if (xNome60) infNfeLines.push(`      <xNome>${xNome60}</xNome>`);

    if (hasAddr) {
      infNfeLines.push('      <enderDest>');
      pushTagIf(infNfeLines, 'xLgr', dLgr, '        ');
      infNfeLines.push(`        <nro>${dNro || '0'}</nro>`);
      pushTagIf(infNfeLines, 'xCpl', dCompl, '        ');
      pushTagIf(infNfeLines, 'xBairro', dBairro, '        ');
      if (dCMun) infNfeLines.push(`        <cMun>${dCMun}</cMun>`);
      pushTagIf(infNfeLines, 'xMun', dXMun, '        ');
      if (/^[A-Z]{2}$/.test(dUF)) infNfeLines.push(`        <UF>${dUF}</UF>`);
      if (/^\d{8}$/.test(dCEP)) infNfeLines.push(`        <CEP>${dCEP}</CEP>`);
      infNfeLines.push('      </enderDest>');
    }

    infNfeLines.push('      <indIEDest>9</indIEDest>');
    if (cliente?.email) {
      infNfeLines.push(`      <email>${sanitize(cliente.email)}</email>`);
    }
    infNfeLines.push('    </dest>');
  }

  let totalPis = 0;
  let totalCofins = 0;

  const isHomologation = tpAmb === '2';

  fiscalItems.forEach((item, index) => {
    const product = item.productId ? productsMap.get(String(item.productId)) : null;
    const fiscalData = product ? getFiscalDataForStore(product, storeObject) : {};
    const cfop =
      fiscalData?.cfop?.nfce?.dentroEstado ||
      fiscalData?.cfop?.nfce?.foraEstado ||
      fiscalData?.cfop?.nfe?.dentroEstado ||
      '5102';
    const ncm = sanitizeDigits(product?.ncm || item.productSnapshot?.ncm, { fallback: '00000000' });
    const cEAN = sanitizeDigits(item.barcode, { fallback: 'SEM GTIN' });
    const cEANTrib = cEAN === 'SEM GTIN' ? 'SEM GTIN' : cEAN;
    const orig = fiscalData?.origem || '0';
    const csosn = fiscalData?.csosn || '';
    const cst = fiscalData?.cst || '';
    infNfeLines.push(`    <det nItem="${index + 1}">`);
    infNfeLines.push('      <prod>');
    const productCode = item.internalCode || item.productId || String(index + 1).padStart(4, '0');
    infNfeLines.push(`        <cProd>${sanitize(productCode)}</cProd>`);
    infNfeLines.push(`        <cEAN>${cEAN}</cEAN>`);
    const productDescription =
      index === 0 && isHomologation
        ? HOMOLOGATION_FIRST_ITEM_DESCRIPTION
        : item.name;
    infNfeLines.push(`        <xProd>${sanitize(productDescription)}</xProd>`);
    infNfeLines.push(`        <NCM>${ncm.padStart(8, '0')}</NCM>`);
    if (fiscalData?.cest) {
      infNfeLines.push(`        <CEST>${fiscalData.cest}</CEST>`);
    }
    infNfeLines.push(`        <CFOP>${cfop}</CFOP>`);
    infNfeLines.push(`        <uCom>${sanitize(item.unit)}</uCom>`);
    infNfeLines.push(`        <qCom>${toDecimal(item.quantity, 4)}</qCom>`);
    infNfeLines.push(`        <vUnCom>${toDecimal(item.unitPrice)}</vUnCom>`);
    infNfeLines.push(`        <vProd>${toDecimal(item.total)}</vProd>`);
    infNfeLines.push(`        <cEANTrib>${cEANTrib}</cEANTrib>`);
    infNfeLines.push(`        <uTrib>${sanitize(item.unit)}</uTrib>`);
    infNfeLines.push(`        <qTrib>${toDecimal(item.quantity, 4)}</qTrib>`);
    infNfeLines.push(`        <vUnTrib>${toDecimal(item.unitPrice)}</vUnTrib>`);
    infNfeLines.push('        <indTot>1</indTot>');
    infNfeLines.push('      </prod>');
    infNfeLines.push('      <imposto>');
    infNfeLines.push('        <ICMS>');
    if (csosn) {
      infNfeLines.push('          <ICMSSN102>');
      infNfeLines.push(`            <orig>${orig}</orig>`);
      infNfeLines.push(`            <CSOSN>${csosn}</CSOSN>`);
      infNfeLines.push('          </ICMSSN102>');
    } else {
      infNfeLines.push('          <ICMS00>');
      infNfeLines.push(`            <orig>${orig}</orig>`);
      infNfeLines.push(`            <CST>${cst || '00'}</CST>`);
      infNfeLines.push('            <modBC>3</modBC>');
      infNfeLines.push(`            <vBC>${toDecimal(item.total)}</vBC>`);
      infNfeLines.push('            <pICMS>0.00</pICMS>');
      infNfeLines.push('            <vICMS>0.00</vICMS>');
      infNfeLines.push('          </ICMS00>');
    }
    infNfeLines.push('        </ICMS>');
    const pisSummary = buildTaxGroup({
      lines: infNfeLines,
      tag: 'PIS',
      data: fiscalData?.pis,
      baseValue: item.total,
      quantity: item.quantity,
    });
    totalPis += pisSummary.amount || 0;
    const cofinsSummary = buildTaxGroup({
      lines: infNfeLines,
      tag: 'COFINS',
      data: fiscalData?.cofins,
      baseValue: item.total,
      quantity: item.quantity,
    });
    totalCofins += cofinsSummary.amount || 0;
    infNfeLines.push('      </imposto>');
    infNfeLines.push('    </det>');
  });

  infNfeLines.push('    <total>');
  infNfeLines.push('      <ICMSTot>');
  infNfeLines.push('        <vBC>0.00</vBC>');
  infNfeLines.push('        <vICMS>0.00</vICMS>');
  infNfeLines.push('        <vICMSDeson>0.00</vICMSDeson>');
  infNfeLines.push('        <vFCPUFDest>0.00</vFCPUFDest>');
  infNfeLines.push('        <vICMSUFDest>0.00</vICMSUFDest>');
  infNfeLines.push('        <vICMSUFRemet>0.00</vICMSUFRemet>');
  infNfeLines.push('        <vFCP>0.00</vFCP>');
  infNfeLines.push(`        <vBCST>0.00</vBCST>`);
  infNfeLines.push('        <vST>0.00</vST>');
  infNfeLines.push('        <vFCPST>0.00</vFCPST>');
  infNfeLines.push('        <vFCPSTRet>0.00</vFCPSTRet>');
  infNfeLines.push(`        <vProd>${toDecimal(totalProducts)}</vProd>`);
  infNfeLines.push(`        <vFrete>0.00</vFrete>`);
  infNfeLines.push(`        <vSeg>0.00</vSeg>`);
  infNfeLines.push(`        <vDesc>${toDecimal(desconto)}</vDesc>`);
  infNfeLines.push(`        <vII>0.00</vII>`);
  infNfeLines.push(`        <vIPI>0.00</vIPI>`);
  infNfeLines.push(`        <vIPIDevol>0.00</vIPIDevol>`);
  infNfeLines.push(`        <vPIS>${toDecimal(totalPis)}</vPIS>`);
  infNfeLines.push(`        <vCOFINS>${toDecimal(totalCofins)}</vCOFINS>`);
  infNfeLines.push(`        <vOutro>${toDecimal(acrescimo)}</vOutro>`);
  infNfeLines.push(`        <vNF>${toDecimal(totalLiquido)}</vNF>`);
  infNfeLines.push('      </ICMSTot>');
  infNfeLines.push('    </total>');
  infNfeLines.push('    <transp>');
  infNfeLines.push('      <modFrete>9</modFrete>');
  infNfeLines.push('    </transp>');

  const paymentDetails = pagamentos.map((payment) => {
    const valor = safeNumber(payment.valor, 0);
    const tPag = resolvePaymentCode(payment.forma);
    const indPag = resolveIndPag(payment.indPag);
    let card = null;

    if (CARD_PAYMENT_CODES.has(tPag)) {
      const cardSource = payment.card || {};
      const integraRaw = payment.integracao ?? cardSource.tpIntegra ?? cardSource.integracao;
      const integraDigits = onlyDigits(integraRaw);
      const tpIntegra = integraDigits === '1' ? '1' : '2';
      const cnpjCred = onlyDigits(
        cardSource.cnpj || cardSource.cnpjCredenciadora || payment.cnpj || payment.cnpjCredenciadora
      );
      const bandDigits = onlyDigits(cardSource.tBand || cardSource.bandeira || payment.tBand);
      const cAutValue = sanitize(cardSource.cAut || cardSource.autorizacao || payment.cAut);
      card = {
        tpIntegra,
        cnpj: cnpjCred.length === 14 ? cnpjCred : '',
        tBand: bandDigits ? bandDigits.padStart(2, '0').slice(-2) : '',
        cAut: cAutValue ? cAutValue.slice(0, 20) : '',
      };
    }

    return { valor, tPag, indPag, card };
  });

  if (!paymentDetails.length) {
    throw new Error('NFC-e inválida: grupo <pag> requer ao menos um <detPag>.');
  }

  const totalPagamentos = paymentDetails.reduce((sum, item) => sum + item.valor, 0);
  const difference = Math.abs(totalPagamentos - troco - totalLiquido);
  if (difference > 0.01) {
    throw new Error('NFC-e inválida: soma dos pagamentos não confere com o vNF.');
  }

  infNfeLines.push('    <pag>');
  paymentDetails.forEach((payment) => {
    infNfeLines.push('      <detPag>');
    if (payment.indPag) {
      infNfeLines.push(`        <indPag>${payment.indPag}</indPag>`);
    }
    infNfeLines.push(`        <tPag>${payment.tPag}</tPag>`);
    infNfeLines.push(`        <vPag>${dec(payment.valor)}</vPag>`);
    if (payment.card) {
      infNfeLines.push('        <card>');
      infNfeLines.push(`          <tpIntegra>${payment.card.tpIntegra}</tpIntegra>`);
      if (payment.card.cnpj) {
        infNfeLines.push(`          <CNPJ>${payment.card.cnpj}</CNPJ>`);
      }
      if (payment.card.tBand) {
        infNfeLines.push(`          <tBand>${payment.card.tBand}</tBand>`);
      }
      if (payment.card.cAut) {
        infNfeLines.push(`          <cAut>${payment.card.cAut}</cAut>`);
      }
      infNfeLines.push('        </card>');
    }
    infNfeLines.push('      </detPag>');
  });
  if (Math.abs(troco) > 0.009) {
    infNfeLines.push(`      <vTroco>${dec(troco)}</vTroco>`);
  }
  infNfeLines.push('    </pag>');

  const obs = buildInfAdicObservations({ pdv, sale, environmentLabel });
  const infAdicLines = [];
  if (obs.length) {
    obs.forEach((entry) => {
      const campo = sanitizeXmlAttribute(entry.tag);
      const texto = sanitize(entry.value);
      infAdicLines.push(`      <obsCont xCampo="${campo}"><xTexto>${texto}</xTexto></obsCont>`);
    });
  }
  if (snapshot?.meta?.observacoes || snapshot?.meta?.observacaoGeral) {
    infAdicLines.push(
      `      <infCpl>${sanitize(snapshot.meta.observacoes || snapshot.meta.observacaoGeral)}</infCpl>`
    );
  }
  if (infAdicLines.length) {
    infNfeLines.push('    <infAdic>');
    infAdicLines.forEach((line) => infNfeLines.push(line));
    infNfeLines.push('    </infAdic>');
  }
  infNfeLines.push('  </infNFe>');

  const certB64 = certificatePem
    .replace('-----BEGIN CERTIFICATE-----', '')
    .replace('-----END CERTIFICATE-----', '')
    .replace(/\s+/g, '');

  const baseXmlLines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<NFe xmlns="http://www.portalfiscal.inf.br/nfe">',
    ...infNfeLines,
    '</NFe>',
  ];
  const xmlForSignature = sanitizeXmlContent(baseXmlLines.join('\n'));

  const xmlDocument = new DOMParser().parseFromString(xmlForSignature, 'text/xml');
  const [infNfeNode] = xpath.select("/*[local-name()='NFe']/*[local-name()='infNFe']", xmlDocument);
  if (!infNfeNode) {
    throw new Error('Estrutura NFC-e inválida: nó <infNFe> ausente.');
  }
  const infId = infNfeNode.getAttribute('Id');
  if (!infId) {
    throw new Error('Estrutura NFC-e inválida: atributo Id ausente em <infNFe>.');
  }

  const keyPemString = Buffer.isBuffer(privateKeyPem)
    ? privateKeyPem.toString('utf8')
    : String(privateKeyPem || '');

  if (!/-----BEGIN (?:RSA )?PRIVATE KEY-----/.test(keyPemString)) {
    throw new Error('Chave privada inválida/ausente.');
  }

  const signer = new SignedXml({
    privateKey: Buffer.from(keyPemString),
    idAttribute: 'Id',
    canonicalizationAlgorithm: 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
    signatureAlgorithm: 'http://www.w3.org/2000/09/xmldsig#rsa-sha1',
    digestAlgorithm: 'http://www.w3.org/2000/09/xmldsig#sha1',
  });
  signer.keyInfoProvider = {
    getKeyInfo: () =>
      `<X509Data><X509Certificate>${certB64}</X509Certificate></X509Data>`,
  };
  const refXPath = "/*[local-name()='NFe']/*[local-name()='infNFe']";
  signer.addReference({
    xpath: refXPath,
    transforms: [
      'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
      'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
    ],
    digestAlgorithm: 'http://www.w3.org/2000/09/xmldsig#sha1',
  });
  console.debug('XPath ref:', refXPath);
  signer.computeSignature(xmlForSignature, {
    prefix: '',
    location: {
      reference: refXPath,
      action: 'after',
    },
  });

  let signedXmlContent = signer.getSignedXml();
  let signedDocument = null;

  if (process.env.NODE_ENV === 'development') {
    console.debug('[NFCE] XML assinado para transmissão:', signedXmlContent);
  }
  const digestValue = signer.references?.[0]?.digestValue || '';
  const signatureValue = signer.signatureValue || '';

  let qrCodePayload = '';
  let qrCodeBaseUrl = 'https://www.sefaz.br.gov.br/nfce/consulta';
  if (storeUf === 'RJ') {
    const { url, base } = buildQrCodeRJ({
      chNFe: accessKey,
      tpAmb,
      idToken: cscId,
      csc: cscToken,
    });
    qrCodePayload = url;
    qrCodeBaseUrl = base;
  } else {
    const qrParams = new URLSearchParams();
    qrParams.set('chNFe', accessKey);
    qrParams.set('nVersao', '100');
    qrParams.set('tpAmb', tpAmb);
    qrParams.set('dhEmi', emissionIso);
    qrParams.set('vNF', toDecimal(totalLiquido));
    qrParams.set('vICMS', '0.00');
    qrParams.set('digVal', digestValue);
    qrParams.set('cIdToken', cscId);
    const qrBase = qrParams.toString();
    const cHashQRCode = crypto
      .createHash('sha1')
      .update(`${qrBase}${cscToken}`)
      .digest('hex')
      .toUpperCase();
    qrCodePayload = `${qrBase}&cHashQRCode=${cHashQRCode}`;
  }

  if (!qrCodePayload) {
    throw new Error('Falha ao gerar QR Code da NFC-e.');
  }

  const hasKeyInfo = /<KeyInfo\b/.test(signedXmlContent);
  if (!hasKeyInfo) {
    const signatureValueClose = '</SignatureValue>';
    const signatureValueIndex = signedXmlContent.indexOf(signatureValueClose);
    if (signatureValueIndex === -1) {
      throw new Error('Assinatura NFC-e invalida: bloco <SignatureValue> ausente.');
    }
    const insertPosition = signatureValueIndex + signatureValueClose.length;
    const keyInfoXml =
      '<KeyInfo><X509Data><X509Certificate>' +
      certB64 +
      '</X509Certificate></X509Data></KeyInfo>';
    signedXmlContent =
      signedXmlContent.slice(0, insertPosition) +
      keyInfoXml +
      signedXmlContent.slice(insertPosition);
  }

  const qrCodeText = sanitize(qrCodePayload);
  const urlChaveText = sanitize(qrCodeBaseUrl);
  const infNfeSuplXml = [
    '  <infNFeSupl>',
    '    <qrCode>' + qrCodeText + '</qrCode>',
    '    <urlChave>' + urlChaveText + '</urlChave>',
    '  </infNFeSupl>',
  ].join('\n');

  const cleanedXmlContent = signedXmlContent.replace(
    /\s*<infNFeSupl[\s\S]*?<\/infNFeSupl>\s*/g,
    ''
  );

  const signatureMatch = /<(?:ds:)?Signature(?=\s|>)/.exec(cleanedXmlContent);
  if (signatureMatch) {
    const insertIndex = signatureMatch.index;
    const prefix = cleanedXmlContent.slice(0, insertIndex);
    const suffix = cleanedXmlContent.slice(insertIndex);
    const needsPrefixBreak = prefix.length && !prefix.endsWith('\n');
    const needsSuffixBreak = suffix.length && !suffix.startsWith('\n');
    signedXmlContent =
      prefix +
      (needsPrefixBreak ? '\n' : '') +
      infNfeSuplXml +
      (needsSuffixBreak ? '\n' : '') +
      suffix;
  } else {
    const closingTag = '</NFe>';
    if (cleanedXmlContent.includes(closingTag)) {
      signedXmlContent = cleanedXmlContent.replace(
        closingTag,
        infNfeSuplXml + '\n' + closingTag
      );
    } else {
      signedXmlContent = cleanedXmlContent + '\n' + infNfeSuplXml;
    }
  }

  const xml = signedXmlContent.startsWith('<?xml')
    ? signedXmlContent
    : `<?xml version="1.0" encoding="UTF-8"?>\n${signedXmlContent}`;

  const sanitizedXml = sanitizeXmlContent(xml);

  let transmission = null;
  try {
    transmission = await transmitNfceToSefaz({
      xml: sanitizedXml,
      uf: storeUf,
      environment,
      certificate: certificatePem,
      certificateChain,
      privateKey: privateKeyPem,
      lotId: `${cnf}${Date.now()}`,
    });
  } catch (error) {
    const fileNameHint = xmlFileBaseName || `NFCe-${Date.now()}`;
    const buildEnrichedError = (message) => {
      const enriched = new Error(message);
      enriched.name = 'NfceTransmissionError';
      enriched.cause = error;
      enriched.xmlContent = xml;
      enriched.xmlAccessKey = accessKey;
      enriched.xmlFileBaseName = fileNameHint;
      return enriched;
    };

    if (error instanceof SefazTransmissionError || error?.name === 'SefazTransmissionError') {
      const causeMessage = error?.details?.cause?.message || error?.cause?.message || '';
      const detailedMessage = causeMessage
        ? `${error.message || 'Falha ao transmitir NFC-e para a SEFAZ.'} (${causeMessage})`
        : error.message || 'Falha ao transmitir NFC-e para a SEFAZ.';
      throw buildEnrichedError(detailedMessage);
    }

    throw buildEnrichedError(
      `Falha ao transmitir NFC-e para a SEFAZ: ${error?.message || 'erro desconhecido.'}`
    );
  }

  return {
    xml: sanitizedXml,
    qrCodePayload,
    digestValue,
    signatureValue,
    accessKey,
    transmission,
    totals: {
      totalProducts,
      totalLiquido,
      desconto,
      acrescimo,
      troco,
    },
  };
};

module.exports = {
  emitPdvSaleFiscal,
};
