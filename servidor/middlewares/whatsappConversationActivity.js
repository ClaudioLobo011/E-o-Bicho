const {
  buildRequestMeta,
  handleHumanReply,
} = require('../services/whatsappConversationService');

const digitsOnly = (value) => String(value || '').replace(/\D+/g, '');

async function markWhatsappHumanReply(req, _res, next) {
  try {
    const storeId = req.whatsappContext?.storeId || req.params?.storeId;
    const phoneNumberId =
      req.whatsappContext?.phoneNumberId
      || req.body?.phoneNumberId
      || '';
    const waId = digitsOnly(
      req.body?.destination
      || req.body?.waId
      || req.params?.waId
    );
    if (!storeId || !phoneNumberId || !waId) return next();
    req.whatsappConversationState = await handleHumanReply({
      storeId,
      phoneNumberId,
      waId,
      userId: req.user?.id,
      source: 'human_web',
      io: req.app?.get('socketio'),
      requestMeta: buildRequestMeta(req),
    });
    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  markWhatsappHumanReply,
};
