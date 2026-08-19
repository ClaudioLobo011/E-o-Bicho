const crypto = require('crypto');
const { sendWhatsappOtp } = require('./whatsappOtpProvider');

const OTP_TTL_MS = Math.max(60_000, Number(process.env.AUTH_PHONE_OTP_TTL_MS) || 5 * 60_000);
const OTP_MAX_ATTEMPTS = Math.max(3, Number(process.env.AUTH_PHONE_OTP_MAX_ATTEMPTS) || 5);
const OTP_RESEND_MS = Math.max(15_000, Number(process.env.AUTH_PHONE_OTP_RESEND_MS) || 60_000);

function hashOtp(code) {
  const secret = String(process.env.AUTH_PHONE_OTP_SECRET || process.env.JWT_SECRET || 'development-phone-otp');
  return crypto.createHmac('sha256', secret).update(String(code)).digest('hex');
}

function createOtp() {
  const code = String(crypto.randomInt(100000, 1000000));
  return { code, hash: hashOtp(code), expiresAt: new Date(Date.now() + OTP_TTL_MS) };
}

function otpMatches(code, expectedHash) {
  const actual = Buffer.from(hashOtp(code), 'hex');
  const expected = Buffer.from(String(expectedHash || ''), 'hex');
  return actual.length === expected.length && actual.length > 0 && crypto.timingSafeEqual(actual, expected);
}

async function sendPhoneOtp({ phone, code }) {
  const provider = String(process.env.AUTH_PHONE_OTP_PROVIDER || 'whatsapp').trim().toLowerCase();
  if (provider === 'whatsapp') {
    if (['development', 'test'].includes(String(process.env.NODE_ENV || '').toLowerCase())
      && process.env.AUTH_PHONE_OTP_WHATSAPP_LIVE_TEST !== 'true') {
      console.info(`[auth-phone-otp] ${phone}: ${code}`);
      return { provider: 'development' };
    }
    return sendWhatsappOtp({ phone, code });
  }

  const webhookUrl = String(process.env.AUTH_PHONE_OTP_WEBHOOK_URL || '').trim();
  if (!webhookUrl) {
    if (['development', 'test'].includes(String(process.env.NODE_ENV || '').toLowerCase())) {
      console.info(`[auth-phone-otp] ${phone}: ${code}`);
      return { provider: 'development' };
    }
    const error = new Error('O envio de código por celular ainda não está configurado.');
    error.code = 'PHONE_OTP_PROVIDER_NOT_CONFIGURED';
    throw error;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.AUTH_PHONE_OTP_WEBHOOK_TOKEN
          ? { Authorization: `Bearer ${process.env.AUTH_PHONE_OTP_WEBHOOK_TOKEN}` }
          : {}),
      },
      body: JSON.stringify({ phone: `55${phone}`, code, purpose: 'account_completion' }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const error = new Error('Não foi possível enviar o código para o celular.');
      error.code = 'PHONE_OTP_SEND_FAILED';
      throw error;
    }
    return { provider: 'webhook' };
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_MS,
  createOtp,
  otpMatches,
  sendPhoneOtp,
};
