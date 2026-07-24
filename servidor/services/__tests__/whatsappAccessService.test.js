const test = require('node:test');
const assert = require('node:assert/strict');

const {
  canAccessStore,
  findIntegrationNumber,
  getUserStoreIds,
  hasGlobalStoreAccess,
  isWhatsappAdmin,
  normalizePhoneNumberId,
} = require('../whatsappAccessService');

const STORE_A = '64b000000000000000000001';
const STORE_B = '64b000000000000000000002';

test('funcionário acessa somente as lojas vinculadas ao token autenticado', () => {
  const user = {
    role: 'funcionario',
    originalRole: 'funcionario',
    storeIds: [STORE_A],
  };

  assert.equal(canAccessStore(user, STORE_A), true);
  assert.equal(canAccessStore(user, STORE_B), false);
});

test('cliente não recebe acesso ao ambiente do WhatsApp mesmo vinculado à loja', () => {
  const user = {
    role: 'cliente',
    originalRole: 'cliente',
    storeIds: [STORE_A],
  };

  assert.equal(canAccessStore(user, STORE_A), false);
});

test('admin master global acessa qualquer loja e perde o acesso global no modo restrito', () => {
  const globalAdmin = {
    role: 'admin_master',
    originalRole: 'admin_master',
    adminMasterModeActive: true,
    storeIds: [],
  };
  const restrictedAdmin = {
    ...globalAdmin,
    role: 'admin',
    adminMasterModeActive: false,
    storeIds: [STORE_A],
  };

  assert.equal(hasGlobalStoreAccess(globalAdmin), true);
  assert.equal(canAccessStore(globalAdmin, STORE_B), true);
  assert.equal(hasGlobalStoreAccess(restrictedAdmin), false);
  assert.equal(canAccessStore(restrictedAdmin, STORE_A), true);
  assert.equal(canAccessStore(restrictedAdmin, STORE_B), false);
});

test('IDs de loja repetidos ou inválidos são normalizados antes da autorização', () => {
  assert.deepEqual(
    getUserStoreIds({ storeIds: [STORE_A, STORE_A, 'inválido', null] }),
    [STORE_A]
  );
});

test('permissão administrativa do WhatsApp não é concedida a funcionário comum', () => {
  assert.equal(isWhatsappAdmin({ role: 'admin' }), true);
  assert.equal(isWhatsappAdmin({ role: 'franqueado' }), true);
  assert.equal(isWhatsappAdmin({ role: 'funcionario' }), false);
});

test('número é encontrado somente dentro da integração informada', () => {
  const integration = {
    phoneNumbers: [
      {
        _id: '64c000000000000000000001',
        phoneNumberId: '109876543210',
        displayName: 'Loja A',
      },
    ],
  };

  assert.equal(
    findIntegrationNumber(integration, { phoneNumberId: '109876543210' })?.displayName,
    'Loja A'
  );
  assert.equal(
    findIntegrationNumber(integration, { phoneNumberId: '209876543210' }),
    null
  );
});

test('Phone Number ID inválido não é aceito nem convertido silenciosamente', () => {
  assert.equal(normalizePhoneNumberId('109876543210'), '109876543210');
  assert.equal(normalizePhoneNumberId('+55 11 99999-0000'), '');
  assert.equal(normalizePhoneNumberId('abc'), '');
});
