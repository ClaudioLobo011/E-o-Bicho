const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const supertest = require('supertest');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { MongoMemoryServer } = require('mongodb-memory-server');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'customer-completion-test-secret';

const User = require('../../models/User');
const { createOtp } = require('../../services/phoneOtpService');
const authRouter = require('../../routes/auth');

let mongo;
const app = express();
app.use(express.json());
app.use('/auth', authRouter);
const request = supertest(app);

test.before(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri(), { dbName: 'auth-customer-completion' });
});
test.after(async () => { await mongoose.disconnect(); await mongo?.stop(); });
test.beforeEach(async () => mongoose.connection.db.dropDatabase());

test('cliente criado sem CPF na loja conclui o cadastro sem duplicar o usuário', async () => {
  const original = await User.create({
    tipoConta: 'pessoa_fisica', nomeCompleto: 'Cliente da Loja',
    email: 'cadastro.desktop+cliente@eobicho.local', senha: await bcrypt.hash('temporaria', 4),
    celular: '21986754310', celularNormalizado: '21986754310', role: 'cliente',
    webAccountStatus: 'store_only', registrationSource: 'pdv',
  });
  const lookup = await request.post('/auth/account/lookup').send({ celular: '(21) 98675-4310' });
  assert.equal(lookup.status, 200);
  assert.equal(lookup.body.code, 'ACCOUNT_COMPLETION_REQUIRED');

  const denied = await request.post('/auth/login').send({ identifier: '21986754310', senha: 'temporaria' });
  assert.equal(denied.status, 409);

  const otp = createOtp();
  await User.updateOne({ _id: original._id }, { $set: { phoneOtpHash: otp.hash, phoneOtpExpires: otp.expiresAt, phoneOtpAttempts: 0, webAccountStatus: 'pending_completion' } });
  const verified = await request.post('/auth/account/phone/verify').send({ celular: '21986754310', code: otp.code });
  assert.equal(verified.status, 200, verified.text);
  assert.ok(verified.body.completionToken);

  const completed = await request.post('/auth/account/complete')
    .set('Authorization', `Bearer ${verified.body.completionToken}`)
    .send({
      tipoConta: 'pessoa_fisica', nomeCompleto: 'Cliente da Loja Corrigido', email: 'cliente@exemplo.com',
      celular: '21986754310', cpf: '52998224725', senha: 'SenhaForte1', confirm_password: 'SenhaForte1', terms: 'on',
    });
  assert.equal(completed.status, 200, completed.text);
  assert.equal(await User.countDocuments({ celularNormalizado: '21986754310' }), 1);
  const saved = await User.findById(original._id).lean();
  assert.equal(saved.webAccountStatus, 'active');
  assert.equal(saved.cpf, '52998224725');
  assert.equal(saved.email, 'cliente@exemplo.com');
});
