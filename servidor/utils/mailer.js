const nodemailer = require('nodemailer');

function readEnv() {
  return {
    host: process.env.ZOHO_SMTP_HOST || 'smtp.zoho.com',
    port: Number(process.env.ZOHO_SMTP_PORT || 465),
    secure: String(process.env.ZOHO_SMTP_SECURE || 'true') === 'true',
    user: (process.env.ZOHO_SMTP_USER || '').trim(),
    pass: (process.env.ZOHO_SMTP_PASS || '').trim(),
    fromName: process.env.ZOHO_FROM_NAME || 'E o Bicho',
    fromEmail:
      (process.env.ZOHO_FROM_EMAIL || process.env.ZOHO_SMTP_USER || '').trim(),
  };
}

function assertCreds(env) {
  if (!env.user || !env.pass) {
    const msg =
      'SMTP sem credenciais: verifique ZOHO_SMTP_USER e ZOHO_SMTP_PASS no .env (use App Password do Zoho).';
    throw new Error(msg);
  }
}

let _transporter = null;

function getTransporter() {
  if (_transporter) return _transporter;

  const env = readEnv();
  assertCreds(env);

  _transporter = nodemailer.createTransport({
    host: env.host,
    port: env.port,
    secure: env.secure, // true p/ 465, false p/ 587
    auth: { user: env.user, pass: env.pass },
    tls: { rejectUnauthorized: true },
  });

  return _transporter;
}

async function sendMail({ to, subject, html, text, replyTo, fromEmail, fromName }) {
  const env = readEnv();
  const transporter = getTransporter();

  const from = `${fromName || env.fromName} <${fromEmail || env.fromEmail}>`;

  const info = await transporter.sendMail({
    from,
    to,
    subject,
    html,
    text,
    replyTo,
  });

  return {
    messageId: info.messageId,
    accepted: info.accepted,
    rejected: info.rejected,
    response: info.response,
  };
}

async function verifyMailer() {
  try {
    const env = readEnv();
    assertCreds(env);
    const transporter = getTransporter();
    await transporter.verify();
    console.log(`📨 SMTP Zoho OK (${env.host}:${env.port}, user=${env.user})`);
  } catch (err) {
    console.error('❌ Falha ao verificar SMTP Zoho:', err.message);
  }
}

module.exports = { sendMail, verifyMailer };
