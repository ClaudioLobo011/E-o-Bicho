const Store = require('../models/Store');
const WhatsappIntegration = require('../models/WhatsappIntegration');
const {
  canAccessStore,
  findIntegrationNumber,
  isObjectId,
  isWhatsappAdmin,
  normalizeId,
  normalizePhoneNumberId,
} = require('../services/whatsappAccessService');

function sendDenied(
  res,
  message = 'Você não possui acesso ao WhatsApp desta loja.',
  code = 'WHATSAPP_STORE_ACCESS_DENIED'
) {
  return res.status(403).json({
    message,
    code,
  });
}

async function requireWhatsappStoreAccess(req, res, next) {
  try {
    const storeId = normalizeId(req.params?.storeId);
    if (!isObjectId(storeId)) {
      return res.status(400).json({
        message: 'Identificador de loja inválido.',
        code: 'INVALID_STORE_ID',
      });
    }

    if (!canAccessStore(req.user, storeId)) {
      return sendDenied(res);
    }

    const store = await Store.findById(storeId)
      .select('_id nome nomeFantasia razaoSocial cnpj')
      .lean();
    if (!store) {
      return res.status(404).json({
        message: 'Loja não encontrada.',
        code: 'STORE_NOT_FOUND',
      });
    }

    req.whatsappContext = {
      ...(req.whatsappContext || {}),
      storeId,
      store,
    };
    return next();
  } catch (error) {
    return next(error);
  }
}

function requireWhatsappAdminAccess(req, res, next) {
  if (!isWhatsappAdmin(req.user)) {
    return sendDenied(res, 'Somente administradores da loja podem alterar a integração do WhatsApp.');
  }
  return next();
}

function readNumberCandidate(req) {
  return {
    numberId:
      req.body?.numberId
      || req.query?.numberId
      || req.params?.numberId
      || '',
    phoneNumberId:
      req.body?.phoneNumberId
      || req.query?.phoneNumberId
      || req.params?.phoneNumberId
      || '',
  };
}

function requireWhatsappNumberAccess(options = {}) {
  const required = options.required !== false;

  return async (req, res, next) => {
    try {
      const storeId = normalizeId(req.whatsappContext?.storeId || req.params?.storeId);
      const candidate = readNumberCandidate(req);
      const hasCandidate = Boolean(
        normalizeId(candidate.numberId)
        || String(candidate.phoneNumberId || '').trim()
      );

      if (!hasCandidate && !required) return next();
      if (!hasCandidate) {
        return res.status(400).json({
          message: 'Selecione um número do WhatsApp.',
          code: 'WHATSAPP_NUMBER_REQUIRED',
        });
      }

      const integration = await WhatsappIntegration.findOne({ store: storeId })
        .select('store phoneNumbers')
        .lean();
      const number = findIntegrationNumber(integration, candidate);
      if (!number) {
        return sendDenied(
          res,
          'O número informado não pertence à integração do WhatsApp desta loja.',
          'WHATSAPP_NUMBER_ACCESS_DENIED'
        );
      }

      req.whatsappContext = {
        ...(req.whatsappContext || {}),
        integrationId: normalizeId(integration?._id),
        numberId: normalizeId(number._id),
        phoneNumberId: normalizePhoneNumberId(number.phoneNumberId),
        number,
      };
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = {
  requireWhatsappStoreAccess,
  requireWhatsappAdminAccess,
  requireWhatsappNumberAccess,
};
