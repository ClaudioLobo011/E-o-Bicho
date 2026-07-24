const STAFF_ROLES = new Set([
  'admin_master',
  'admin',
  'franqueador',
  'franqueado',
  'funcionario',
]);

const WHATSAPP_ADMIN_ROLES = new Set([
  'admin_master',
  'admin',
  'franqueador',
  'franqueado',
]);

const OBJECT_ID_PATTERN = /^[a-fA-F0-9]{24}$/;
const PHONE_NUMBER_ID_PATTERN = /^\d{6,}$/;

function normalizeId(value) {
  if (!value) return '';
  if (typeof value === 'object' && value._id) return String(value._id).trim();
  return String(value).trim();
}

function isObjectId(value) {
  return OBJECT_ID_PATTERN.test(normalizeId(value));
}

function normalizePhoneNumberId(value) {
  const normalized = String(value || '').trim();
  return PHONE_NUMBER_ID_PATTERN.test(normalized) ? normalized : '';
}

function getUserStoreIds(user = {}) {
  const values = Array.isArray(user.storeIds) ? user.storeIds : [];
  return Array.from(new Set(values.map(normalizeId).filter(isObjectId)));
}

function hasGlobalStoreAccess(user = {}) {
  return (
    user.originalRole === 'admin_master'
    && user.adminMasterModeActive !== false
  );
}

function isWhatsappStaff(user = {}) {
  return STAFF_ROLES.has(String(user.role || '').trim());
}

function isWhatsappAdmin(user = {}) {
  return WHATSAPP_ADMIN_ROLES.has(String(user.role || '').trim());
}

function canAccessStore(user = {}, storeId) {
  const normalizedStoreId = normalizeId(storeId);
  if (!isObjectId(normalizedStoreId) || !isWhatsappStaff(user)) return false;
  if (hasGlobalStoreAccess(user)) return true;
  return getUserStoreIds(user).includes(normalizedStoreId);
}

function findIntegrationNumber(integration, candidate = {}) {
  const numbers = Array.isArray(integration?.phoneNumbers) ? integration.phoneNumbers : [];
  const numberId = normalizeId(candidate.numberId);
  const phoneNumberId = normalizePhoneNumberId(candidate.phoneNumberId);

  if (numberId && isObjectId(numberId)) {
    const bySubdocumentId = numbers.find((number) => normalizeId(number?._id) === numberId);
    if (bySubdocumentId) return bySubdocumentId;
  }

  if (phoneNumberId) {
    return numbers.find(
      (number) => normalizePhoneNumberId(number?.phoneNumberId) === phoneNumberId
    ) || null;
  }

  return null;
}

module.exports = {
  STAFF_ROLES,
  WHATSAPP_ADMIN_ROLES,
  normalizeId,
  isObjectId,
  normalizePhoneNumberId,
  getUserStoreIds,
  hasGlobalStoreAccess,
  isWhatsappStaff,
  isWhatsappAdmin,
  canAccessStore,
  findIntegrationNumber,
};
