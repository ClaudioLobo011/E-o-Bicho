const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const mongoose = require('mongoose');

const { app } = require('../../server');

test('GET /healthz exposes only a minimal liveness response', async () => {
  const response = await request(app).get('/healthz');

  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.service, 'e-o-bicho-api');
  assert.equal(typeof response.body.version, 'string');
  assert.deepEqual(Object.keys(response.body).sort(), ['ok', 'service', 'version']);
});

test('GET /readyz reflects the current MongoDB connection state', async () => {
  const response = await request(app).get('/readyz');
  const expectedReady = mongoose.connection.readyState === 1;

  assert.equal(response.status, expectedReady ? 200 : 503);
  assert.equal(response.body.ok, expectedReady);
  assert.equal(response.body.database, expectedReady ? 'ready' : 'not-ready');
});
