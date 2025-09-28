const crypto = require('crypto');

const CERTIFICATE_KEY = (process.env.CERTIFICATE_SECRET_KEY || 'dev-cert-key-por-favor-altere')
  .padEnd(32, '0')
  .slice(0, 32);

const ensureBuffer = (value) => {
  if (Buffer.isBuffer(value)) {
    return value;
  }
  if (typeof value === 'string') {
    return Buffer.from(value, 'utf8');
  }
  throw new TypeError('Valor fornecido deve ser uma string ou Buffer.');
};

const encryptBuffer = (buffer) => {
  const normalized = ensureBuffer(buffer);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(CERTIFICATE_KEY), iv);
  const encrypted = Buffer.concat([cipher.update(normalized), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
};

const encryptText = (value) => encryptBuffer(Buffer.from(String(value || ''), 'utf8'));

const decryptBuffer = (payload) => {
  if (!payload) {
    throw new Error('Nenhum dado fornecido para descriptografia.');
  }
  const raw = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'base64');
  if (raw.length < 28) {
    throw new Error('Carga criptografada inválida.');
  }
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const encrypted = raw.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(CERTIFICATE_KEY), iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted;
};

const decryptText = (payload) => decryptBuffer(payload).toString('utf8');

module.exports = {
  CERTIFICATE_KEY,
  encryptBuffer,
  encryptText,
  decryptBuffer,
  decryptText,
};
