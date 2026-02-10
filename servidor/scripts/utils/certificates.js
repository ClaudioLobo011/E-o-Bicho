const fs = require('fs');
const path = require('path');
const forge = require('node-forge');

const loadPfxBuffer = (pfxPath) => {
  const absolutePath = path.resolve(pfxPath);
  const buffer = fs.readFileSync(absolutePath);
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error(`Certificado PFX vazio ou inválido em ${absolutePath}`);
  }
  return buffer;
};

const extractCertificatePair = (pfxBuffer, password) => {
  const passwordValue = password != null ? String(password) : '';
  const pfxDer = forge.asn1.fromDer(pfxBuffer.toString('binary'));
  const pfx = forge.pkcs12.pkcs12FromAsn1(pfxDer, passwordValue);

  const normalizeAttributes = (attributes) => {
    if (!attributes) return [];
    if (Array.isArray(attributes)) return attributes;
    if (typeof attributes === 'object') {
      return Object.keys(attributes).map((key) => ({
        type: key,
        value: attributes[key],
      }));
    }
    return [];
  };

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
    throw new Error('Chave privada não encontrada no PFX.');
  }

  const certBags = pfx.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || [];
  if (!certBags.length) {
    throw new Error('Nenhum certificado encontrado no PFX.');
  }

  const keyId = (() => {
    const attribute = normalizeAttributes(keyBag.attributes).find(
      (attr) => attr && attr.type === forge.pki.oids.localKeyId
    );
    if (!attribute || !attribute.value || !attribute.value.length) {
      return null;
    }
    const raw = attribute.value[0];
    if (!raw) return null;
    if (typeof raw === 'string') {
      return Buffer.from(raw, 'binary').toString('hex');
    }
    if (raw.value && typeof raw.value === 'string') {
      return Buffer.from(raw.value, 'binary').toString('hex');
    }
    if (raw.bytes) {
      return Buffer.from(raw.bytes, 'binary').toString('hex');
    }
    return null;
  })();

  let leafCert = null;
  const certificateChain = [];

  for (const bag of certBags) {
    if (!bag.cert) continue;
    const pem = forge.pki.certificateToPem(bag.cert);
    if (!pem || !pem.includes('BEGIN CERTIFICATE')) {
      continue;
    }
    certificateChain.push(pem);
    if (!leafCert && keyId && bag.attributes) {
      const certAttr = normalizeAttributes(bag.attributes).find(
        (attr) => attr && attr.type === forge.pki.oids.localKeyId
      );
      if (certAttr && certAttr.value && certAttr.value[0]) {
        const raw = certAttr.value[0];
        const certId =
          typeof raw === 'string'
            ? Buffer.from(raw, 'binary').toString('hex')
            : raw?.value && typeof raw.value === 'string'
            ? Buffer.from(raw.value, 'binary').toString('hex')
            : null;
        if (certId && certId === keyId) {
          leafCert = pem;
        }
      }
    }
    if (!keyId && !leafCert) {
      leafCert = pem;
    }
  }

  if (!leafCert) {
    leafCert = certificateChain[0];
  }

  const privateKeyPem = forge.pki.privateKeyToPem(keyBag.key);
  return { privateKeyPem, certificatePem: leafCert, certificateChain };
};

module.exports = {
  loadPfxBuffer,
  extractCertificatePair,
};
