const forge = require('node-forge');

const extractCertificatePair = (pfxBuffer, password) => {
  if (!Buffer.isBuffer(pfxBuffer)) {
    throw new TypeError('O certificado fornecido deve ser um Buffer.');
  }
  const passwordValue = password != null ? String(password) : '';
  const pfxDer = forge.asn1.fromDer(pfxBuffer.toString('binary'));
  const pfx = forge.pkcs12.pkcs12FromAsn1(pfxDer, passwordValue);

  const findKeyBag = () => {
    const candidates = [forge.pki.oids.pkcs8ShroudedKeyBag, forge.pki.oids.keyBag];
    for (const bagType of candidates) {
      const bags = pfx.getBags({ bagType })[bagType] || [];
      if (bags.length) {
        return bags[0];
      }
    }
    return null;
  };

  const keyBag = findKeyBag();
  if (!keyBag || !keyBag.key) {
    throw new Error('Chave privada não encontrada no certificado PFX.');
  }

  const certBags = pfx.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || [];
  if (!certBags.length) {
    throw new Error('Nenhum certificado foi encontrado no PFX fornecido.');
  }

  const normalizeAttributes = (attributes) => {
    if (!attributes) return [];
    if (Array.isArray(attributes)) {
      return attributes.filter(Boolean);
    }
    if (typeof attributes === 'object') {
      return Object.values(attributes).filter(Boolean);
    }
    return [];
  };

  const readLocalKeyId = (attributes) => {
    const normalized = normalizeAttributes(attributes);
    const attribute = normalized.find((attr) => attr && attr.type === forge.pki.oids.localKeyId);
    if (!attribute) {
      return null;
    }

    const extractBinary = (value) => {
      if (!value) return null;
      if (typeof value === 'string') {
        return value;
      }
      if (Buffer.isBuffer(value)) {
        return value.toString('binary');
      }
      if (Array.isArray(value)) {
        for (const part of value) {
          const extracted = extractBinary(part);
          if (extracted) return extracted;
        }
        return null;
      }
      if (typeof value === 'object') {
        if (typeof value.value !== 'undefined') {
          return extractBinary(value.value);
        }
        if (typeof value.bytes !== 'undefined') {
          return extractBinary(value.bytes);
        }
      }
      return null;
    };

    const binary = extractBinary(attribute.value);
    if (!binary) {
      return null;
    }

    return Buffer.from(binary, 'binary').toString('hex');
  };

  const keyId = readLocalKeyId(keyBag.attributes);

  let leafCertificate = null;
  const certificateChain = [];

  for (const bag of certBags) {
    if (!bag.cert) continue;
    const pem = forge.pki.certificateToPem(bag.cert);
    if (!pem || !pem.includes('BEGIN CERTIFICATE')) {
      continue;
    }
    certificateChain.push(pem);
    if (!leafCertificate && keyId && bag.attributes) {
      const certId = readLocalKeyId(bag.attributes);
      if (certId && certId === keyId) {
        leafCertificate = pem;
      }
    }
    if (!keyId && !leafCertificate) {
      leafCertificate = pem;
    }
  }

  if (!leafCertificate) {
    leafCertificate = certificateChain[0];
  }

  const privateKeyPem = forge.pki.privateKeyToPem(keyBag.key);
  return { privateKeyPem, certificatePem: leafCertificate, certificateChain };
};

module.exports = {
  extractCertificatePair,
};
