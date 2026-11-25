const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { createCipheriv, createHmac, randomBytes } = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { MongoClient, ObjectId } = require('mongodb');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { masterIdentifierDigests } = require('../../services/masterIdentity');

const startApi = async (environment, t) => {
  const child = spawn(process.execPath, ['-e', `
    const express = require('express');
    const mongoose = require('mongoose');
    mongoose.connect(process.env.TEST_MONGO_URI, { dbName: process.env.TEST_DB }).then(() => {
      const app = express();
      app.use(express.json());
      app.use('/api/auth', require('./routes/auth'));
      const server = app.listen(0, '127.0.0.1', () => process.send(server.address().port));
    }).catch(error => { console.error(error); process.exit(1); });
  `], {
    cwd: path.resolve(__dirname, '../..'),
    env: { ...process.env, ...environment, NODE_ENV: 'test' },
    stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
  });
  t.after(async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, 'exit');
    child.kill();
    await exited;
  });
  const port = await new Promise((resolve, reject) => {
    child.once('message', resolve);
    child.once('error', reject);
    child.once('exit', code => reject(new Error(`API de teste encerrou com código ${code}.`)));
  });
  return `http://127.0.0.1:${port}/api/auth`;
};

function totpFixture() {
  const key = 'integration-test-totp-key'.padEnd(32, '0');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(key), iv);
  const ciphertext = Buffer.concat([cipher.update('JBSWY3DPEHPK3PXP'), cipher.final()]);
  const encryptedSecret = Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
  const code = () => {
    const counter = Buffer.alloc(8);
    counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
    const hash = createHmac('sha1', Buffer.from('48656c6c6f21deadbeef', 'hex')).update(counter).digest();
    return String((hash.readUInt32BE(hash[19] & 15) & 0x7fffffff) % 1000000).padStart(6, '0');
  };
  return { key, encryptedSecret, code };
}

function post(origin, resource, body, extraHeaders = {}, method = 'POST') {
  return fetch(`${origin}${resource}`, {
    method, headers: { 'Content-Type': 'application/json', ...extraHeaders }, body: JSON.stringify(body),
  });
}

test('autentica o master na origem e emite apenas sessões locais, preservando cadastros independentes', { timeout: 45000 }, async t => {
  const mongo = await MongoMemoryServer.create();
  const uri = mongo.getUri();
  const client = await new MongoClient(uri).connect();
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'master-identity-test-'));
  const config = path.join(folder, 'master.json');
  const subprocesses = [];
  t.after(async () => {
    await Promise.all(subprocesses.map(stop => stop()));
    await client.close();
    await mongo.stop();
    await fs.rm(config, { force: true });
    await fs.rmdir(folder);
  });
  const childScope = { after: stop => subprocesses.push(stop) };

  const id = new ObjectId();
  const localCustomerId = new ObjectId();
  const email = 'master@example.test';
  const senha = 'SenhaDeTeste123';
  const secret = randomBytes(32).toString('base64url');
  const totp = totpFixture();
  const identifiers = { cpf: '529.982.247-25', cnpj: '11.222.333/0001-81', celular: '(21) 98765-4321' };
  const shared = { subject: String(id), email, secret, identifierDigests: masterIdentifierDigests(secret, identifiers) };
  await fs.writeFile(config, JSON.stringify({ ...shared, origin: 'http://127.0.0.1:3000' }));

  const sourceUsers = client.db('source').collection('users');
  const palaceUsers = client.db('palace').collection('users');
  const otherUsers = client.db('other').collection('users');
  await sourceUsers.insertOne({
    _id: id, email, ...identifiers, role: 'admin_master', nomeCompleto: 'Master de teste', senha: await bcrypt.hash(senha, 4),
    totpEnabled: true, totpSecretEnc: totp.encryptedSecret,
  });
  await otherUsers.createIndex({ email: 1 }, { unique: true });
  const localPassword = 'SenhaLocal789';
  await otherUsers.insertOne({ _id: localCustomerId, email, role: 'cliente', senha: await bcrypt.hash(localPassword, 4) });

  const env = { TEST_MONGO_URI: uri, MASTER_AUTH_CONFIG_FILE: config, TOTP_SECRET_KEY: totp.key };
  const provider = await startApi({ ...env, SITE_EMPRESA: 'e_o_bicho', TEST_DB: 'source', JWT_SECRET: 'source-secret' }, childScope);
  await fs.writeFile(config, JSON.stringify({ ...shared, origin: new URL(provider).origin }));
  const palace = await startApi({ ...env, SITE_EMPRESA: 'palace_do_pet', TEST_DB: 'palace', JWT_SECRET: 'palace-secret' }, childScope);
  const other = await startApi({ ...env, SITE_EMPRESA: 'outra_empresa', TEST_DB: 'other', JWT_SECRET: 'other-secret' }, childScope);

  assert.equal((await post(provider, '/master/validate', { identifier: email, senha, token: totp.code() })).status, 404);
  assert.equal((await post(palace, '/login', { identifier: email, senha: 'incorreta' })).status, 401);
  assert.equal((await post(palace, '/login', { identifier: 'outro@example.test', senha })).status, 400);
  const challenge = await post(palace, '/login', { identifier: email, senha });
  assert.equal(challenge.status, 428);
  assert.equal((await challenge.json()).code, 'MASTER_TOTP_REQUIRED');
  assert.equal(await palaceUsers.countDocuments(), 0);
  const successful = await post(palace, '/login', { identifier: email, senha, token: totp.code() });
  assert.equal(successful.status, 200, await successful.clone().text());
  const session = await successful.json();
  const decoded = jwt.verify(session.token, 'palace-secret');
  assert.equal(decoded.exp - decoded.iat, 3600);
  assert.equal(decoded.role, 'admin_master');
  assert.equal((await palaceUsers.findOne({ _id: id })).senha, '!');
  for (const identifier of [identifiers.cpf, '52998224725', identifiers.cnpj, '+55 (21) 98765-4321']) {
    const result = await post(palace, '/login', { identifier, senha });
    assert.equal(result.status, 428);
    assert.equal((await result.json()).code, 'MASTER_TOTP_REQUIRED');
  }
  const cpfLogin = await post(palace, '/login', { identifier: identifiers.cpf, senha, token: totp.code() });
  assert.equal(cpfLogin.status, 200);
  assert.equal((await palaceUsers.findOne({ _id: id })).cpf, undefined);
  assert.equal((await post(palace, '/login', { identifier: email, senha })).status, 428);
  const locallyOwnedEmail = await post(other, '/login', { identifier: email, senha: localPassword });
  assert.equal(locallyOwnedEmail.status, 200);
  assert.equal((await locallyOwnedEmail.json()).user.role, 'cliente');
  assert.equal((await post(other, '/login', { identifier: email, senha, token: totp.code() })).status, 400);
  assert.equal((await otherUsers.findOne({ _id: localCustomerId })).role, 'cliente');

  const check = (origin, token) => fetch(`${origin}/check`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal((await check(palace, session.token)).status, 200);
  assert.equal((await check(other, session.token)).status, 403);
  assert.equal((await check(provider, session.token)).status, 403);
  assert.equal((await post(palace, '/login', { identifier: email, senha, token: totp.code() })).status, 200);
  assert.equal(await palaceUsers.countDocuments(), 1);

  const customerSession = jwt.sign({ id: localCustomerId, role: 'cliente' }, 'other-secret');
  const profile = await post(other, `/users/${localCustomerId}`, { nomeCompleto: 'Perfil', role: 'admin_master' },
    { Authorization: `Bearer ${customerSession}` }, 'PUT');
  assert.equal(profile.status, 200);
  assert.equal((await otherUsers.findOne({ _id: localCustomerId })).role, 'cliente');
  await otherUsers.updateOne({ _id: localCustomerId }, { $set: { email: 'cliente@example.test' } });
  const secondLogin = await post(other, '/login', { identifier: email, senha, token: totp.code() });
  assert.equal(secondLogin.status, 200);
  assert.equal((await check(other, (await secondLogin.json()).token)).status, 200);
  assert.equal((await check(other, session.token)).status, 403);
  await sourceUsers.updateOne({ _id: id }, { $set: { webAccountStatus: 'blocked' } });
  assert.equal((await post(palace, '/login', { identifier: email, senha, token: totp.code() })).status, 401);
});
