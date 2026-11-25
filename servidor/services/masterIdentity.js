const fs = require('node:fs');
const path = require('node:path');
const { createHmac, timingSafeEqual } = require('node:crypto');
const { normalizeCpf, normalizeCnpj, normalizeBrazilPhone } = require('../utils/customerIdentity');

const MASTER_ROLE = 'admin_master';
const MAX_FAILED_ATTEMPTS = 10;
const ATTEMPT_WINDOW_MS = 5 * 60 * 1000;

function loadMasterIdentityConfig(filename) {
  if (!filename) {
    const sharedFile = path.resolve(__dirname, '../../..', '.private', 'master-auth.json');
    if (!fs.existsSync(sharedFile)) return null;
    filename = sharedFile;
  }
  const { subject, email, origin, secret, identifierDigests = [] } = JSON.parse(fs.readFileSync(filename, 'utf8'));
  const provider = new URL(origin);
  if (!/^[a-f0-9]{24}$/.test(subject) || typeof email !== 'string' || email.length > 254 ||
      !/^[^\s@]+@[^\s@]+$/.test(email) || !/^[A-Za-z0-9_-]{43}$/.test(secret) ||
      !Array.isArray(identifierDigests) || identifierDigests.length > 4 ||
      identifierDigests.some(digest => typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest)) ||
      provider.protocol !== 'http:' || provider.hostname !== '127.0.0.1' || provider.origin !== origin || !provider.port) {
    throw new Error('Configuração da identidade administrativa inválida. Use o endereço local do provedor.');
  }
  return { subject, email: email.toLowerCase(), origin, secret, identifierDigests };
}

function digestIdentifiers(secret, entries) {
  return [...new Set(entries.filter(([, value]) => value)
    .map(([kind, value]) => createHmac('sha256', secret).update(`master-login:${kind}:${value}`).digest('hex')))];
}

function masterIdentifierDigests(secret, user) {
  return digestIdentifiers(secret, [
    ['cpf', normalizeCpf(user.cpf)], ['cnpj', normalizeCnpj(user.cnpj)],
    ['phone', normalizeBrazilPhone(user.celular)], ['phone', normalizeBrazilPhone(user.celularNormalizado)],
  ]);
}

function matchesMasterIdentifier(config, identifier) {
  if (typeof identifier !== 'string' || identifier.length > 254) return false;
  const value = identifier.trim().toLowerCase();
  if (value === config.email) return true;
  if (!/^[+\d.()/\s-]+$/.test(value)) return false;
  const possibleDigests = digestIdentifiers(config.secret, [
    ['cpf', normalizeCpf(value)], ['cnpj', normalizeCnpj(value)], ['phone', normalizeBrazilPhone(value)],
  ]);
  return possibleDigests.some(digest => config.identifierDigests.includes(digest));
}

function isProviderRequest(req, config) {
  if (!config || !['127.0.0.1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) return false;
  const authorization = req.get('authorization') || '';
  const expected = `Bearer ${config.secret}`;
  if (authorization.length !== expected.length) return false;
  const supplied = Buffer.from(authorization);
  const reference = Buffer.from(expected);
  return supplied.length === reference.length && timingSafeEqual(supplied, reference);
}

function createAttemptLimiter(now = Date.now) {
  const windows = new Map();
  return {
    reserve(key) {
      const time = now();
      let window = windows.get(key);
      if (!window || time >= window.end) {
        if (windows.size >= 2048) {
          for (const [id, entry] of windows) if (entry.end <= time) windows.delete(id);
          if (windows.size >= 2048 && !windows.has(key)) return false;
        }
        window = { attempts: 0, end: time + ATTEMPT_WINDOW_MS };
        windows.set(key, window);
      }
      if (window.attempts >= MAX_FAILED_ATTEMPTS) return false;
      window.attempts += 1;
      return true;
    },
    reset(key) {
      windows.delete(key);
    },
  };
}

function readCredentials(body) {
  const { identifier, senha, token } = body || {};
  if (typeof identifier !== 'string' || typeof senha !== 'string') return null;
  if (!identifier.trim() || identifier.length > 254 || !senha.length || senha.length > 1024 ||
      (token !== undefined && (typeof token !== 'string' || !/^\d{6}$/.test(token)))) return null;
  return { identifier: identifier.trim().toLowerCase(), senha, token };
}

async function authenticateWithProvider(config, credentials) {
  const response = await fetch(`${config.origin}/api/auth/master/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.secret}` },
    body: JSON.stringify(credentials),
    signal: AbortSignal.timeout(5000),
    redirect: 'error',
  });
  if ([401, 428, 429].includes(response.status)) return { status: response.status };
  if (!response.ok) throw new Error('Provedor de acesso administrativo indisponível.');
  const identity = await response.json();
  if (identity.id !== config.subject || typeof identity.email !== 'string' || typeof identity.name !== 'string') {
    throw new Error('Resposta inesperada do provedor de acesso administrativo.');
  }
  return { status: 200, identity };
}

async function provisionMaster(User, identity) {
  return User.findOneAndUpdate(
    { _id: identity.id, role: MASTER_ROLE, masterIdentity: true },
    {
      $set: { email: identity.email, nomeCompleto: identity.name },
      $setOnInsert: {
        masterIdentity: true,
        role: MASTER_ROLE,
        tipoConta: 'pessoa_fisica',
        senha: '!',
        criadoEm: new Date(),
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: false, overwriteImmutable: true },
  );
}

module.exports = {
  MASTER_ROLE, loadMasterIdentityConfig, isProviderRequest, createAttemptLimiter,
  readCredentials, authenticateWithProvider, provisionMaster, masterIdentifierDigests, matchesMasterIdentifier,
};
