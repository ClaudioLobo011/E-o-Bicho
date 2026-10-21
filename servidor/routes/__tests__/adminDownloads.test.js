const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const User = require('../../models/User');
const router = require('../adminDownloads');

test('Aspia exige autenticação e administrador; envia bytes privados e trata pacote ausente', async () => {
  const originalFind = User.findById;
  const originalSecret = process.env.JWT_SECRET;
  const originalPackage = process.env.ASPIA_HOST_PACKAGE_PATH;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aspia-download-test-'));
  let role = 'funcionario';
  User.findById = () => ({ select: () => ({ lean: async () => ({ _id: 'test', role }) }) });
  process.env.JWT_SECRET = 'aspia-test-only';
  process.env.ASPIA_HOST_PACKAGE_PATH = path.join(dir, 'package.zip');
  const bytes = Buffer.from('PK\x03\x04test-package');
  fs.writeFileSync(process.env.ASPIA_HOST_PACKAGE_PATH, bytes);
  const app = express();
  app.use('/downloads', router);
  const token = jwt.sign({ id: 'test' }, process.env.JWT_SECRET);
  try {
    assert.equal((await request(app).get('/downloads/aspia')).status, 401);
    assert.equal((await request(app).get('/downloads/aspia').auth(token, { type: 'bearer' })).status, 403);
    for (role of ['admin', 'admin_master']) {
      const result = await request(app).get('/downloads/aspia').auth(token, { type: 'bearer' })
        .buffer(true).parse((response, callback) => {
          const chunks = [];
          response.on('data', (chunk) => chunks.push(chunk));
          response.on('end', () => callback(null, Buffer.concat(chunks)));
          response.on('error', callback);
        });
      assert.equal(result.status, 200);
      assert.equal(result.headers['cache-control'], 'private, no-store');
      assert.match(result.headers['content-disposition'], /Aspia-EoBicho-Host-Setup-2026\.10\.21\.4\.zip/);
      assert.deepEqual(result.body, bytes);
    }
    process.env.ASPIA_HOST_PACKAGE_PATH = path.join(dir, 'missing.zip');
    assert.equal((await request(app).get('/downloads/aspia').auth(token, { type: 'bearer' })).status, 503);
  } finally {
    User.findById = originalFind;
    if (originalSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalSecret;
    if (originalPackage === undefined) delete process.env.ASPIA_HOST_PACKAGE_PATH;
    else process.env.ASPIA_HOST_PACKAGE_PATH = originalPackage;
    fs.unlinkSync(path.join(dir, 'package.zip'));
    fs.rmdirSync(dir);
  }
});
